import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { RDSClient, DescribeDBInstancesCommand } from '@aws-sdk/client-rds';
import { spawn } from 'child_process';
import { createReadStream, createWriteStream } from 'fs';
import { join } from 'path';

interface BackupEvent {
  rdsInstance: string;
  sourceRegion: string;
  targetBucket: string;
  targetRegion: string;
  targetKey?: string;
  databaseName?: string;  // Optional database name, will use RDS default if not specified
}

export const handler = async (event: BackupEvent) => {
  const { rdsInstance, sourceRegion, targetBucket, targetRegion, targetKey, databaseName } = event;
  
  // Initialize RDS client in source region
  const rdsClient = new RDSClient({ region: sourceRegion });
  
  try {
    // Get RDS instance details
    const describeCmd = new DescribeDBInstancesCommand({
      DBInstanceIdentifier: rdsInstance
    });
    const response = await rdsClient.send(describeCmd);
    const instance = response.DBInstances?.[0];
    
    if (!instance) {
      throw new Error(`RDS instance ${rdsInstance} not found`);
    }

    const host = instance.Endpoint?.Address;
    const port = instance.Endpoint?.Port;
    // Use provided database name or fall back to RDS instance default
    const dbName = databaseName || instance.DBName;

    if (!host || !port || !dbName) {
      throw new Error('Missing required RDS instance details');
    }

    // Create backup using pg_dump
    const backupPath = join('/tmp', `${rdsInstance}-${dbName}-backup.dump`);
    const pgDumpProcess = spawn('pg_dump', [
      '-h', host,
      '-p', port.toString(),
      '-U', process.env.DB_USER!,
      '-d', dbName,
      '-F', 'c', // Use custom format for pg_restore compatibility
      '-f', backupPath
    ], {
      env: {
        ...process.env,
        PGPASSWORD: process.env.DB_PASSWORD
      }
    });

    await new Promise((resolve, reject) => {
      pgDumpProcess.on('close', (code) => {
        if (code === 0) {
          resolve(null);
        } else {
          reject(new Error(`pg_dump failed with code ${code}`));
        }
      });
      
      pgDumpProcess.stderr.on('data', (data) => {
        console.error(`pg_dump stderr: ${data}`);
      });
    });

    // Upload to S3
    const s3Client = new S3Client({ region: targetRegion });
    const key = targetKey || `backups/${rdsInstance}/${dbName}/${new Date().toISOString()}.dump`;
    
    await s3Client.send(new PutObjectCommand({
      Bucket: targetBucket,
      Key: key,
      Body: createReadStream(backupPath)
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Backup completed successfully',
        location: {
          bucket: targetBucket,
          key: key,
          region: targetRegion
        }
      })
    };
  } catch (error) {
    console.error('Backup failed:', error);
    throw error;
  }
};
