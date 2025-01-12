import express, { Request, Response } from "express";
import cors from "cors";
import bodyParser from "body-parser";
import * as k8s from "@kubernetes/client-node";
import { releaseHeader } from './middleware/releaseHeader';
import { components } from './types/generated/api';
import crypto from 'crypto';

type Database = components['schemas']['Database'];
type Project = components['schemas']['Project'];
type CreateProjectRequest = components['schemas']['CreateProjectRequest'];

const app = express();
const port: number = 5000;

app.use(cors());
app.use(bodyParser.json());
app.use(releaseHeader);

const kc = new k8s.KubeConfig();
kc.loadFromDefault();

const k8sApi = kc.makeApiClient(k8s.CoreV1Api);

const validateURL = (url: string) => {
  const regex = new RegExp(
      "^(https?:\\/\\/)" + // protocol
      "((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|" + // domain name
      "((\\d{1,3}\\.){3}\\d{1,3}))" + // OR ip (v4) address
      "(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*" + // port and path
      "(\\?[;&a-z\\d%_.~+=-]*)?" + // query string
      "(\\#[-a-z\\d_]*)?$", "i" // fragment locator
  );
  return !!regex.test(url);
}

async function verifyURL(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    return response.ok; // this will return true if the response is 200
  } catch (error) {
    return false;
  }
}

const filteredNamespaces = (namespaces: k8s.V1Namespace[]) => {
  // This label is used to identify namespaces that were created by devdb-api
  const labelKeyForNamespacesCreatedByDevDbApi = "devdb/type";
  const pattern = /kube|default/i;

  return namespaces
    .map((ns) => ({
      name: ns.metadata?.name,
      type: ns.metadata?.name?.search(pattern) !== -1 ? "system" : "user",
      labels: ns.metadata?.labels || {},
      creationTimestamp: ns.metadata?.creationTimestamp,
      status: ns.status,
    }))
    .filter(
      (ns) =>
        ns.type === "user" &&
        ns.labels &&
        ns.labels.hasOwnProperty(labelKeyForNamespacesCreatedByDevDbApi)
    );
};

enum DatabaseType {
  postgres = 'postgres',
  mysql = 'mysql'
}

interface DatabaseCredentials {
  username: string;
  password?: string;
  database: string;
}

const projects: Record<string, Project> = {};

function generateDatabaseId(name: string): string {
  return `db-${name}-${Date.now()}`;
}

function generateProjectId(owner: string, name: string): string {
  return `${owner}-${name}`;
}

function getBackupPaths(type: 'project', id: string, instanceName?: string): {
  backupDir: string;
  metadataPath: string;
} {
  const s3Bucket = process.env.S3_BUCKET || 'devdb-backups';
  return {
    backupDir: `s3://${s3Bucket}/projects/${id}/instances/${instanceName}/backups`,
    metadataPath: `s3://${s3Bucket}/projects/${id}/instances/${instanceName}/metadata.json`
  };
}

const SHARED_NAMESPACE = 'devdb-databases';

const getCurrentNamespace = (): string => {
  // In a Kubernetes cluster, namespace is available at this path
  try {
    return require('fs').readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/namespace', 'utf8');
  } catch (error) {
    // Fallback for local development
    return 'default';
  }
};

const CURRENT_NAMESPACE = getCurrentNamespace();

const POSTGRES_SERVICE_NAME = 'shared-postgres-service';
const MYSQL_SERVICE_NAME = 'shared-mysql-service';

import { S3Client, PutObjectCommand, CreateBucketCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { RDSClient } from "@aws-sdk/client-rds";
import { Signer } from "@aws-sdk/rds-signer";
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-west-2'
});

const rdsClient = new RDSClient({
  region: process.env.AWS_REGION || 'us-west-2'
});

const BACKUP_BUCKET = process.env.BACKUP_BUCKET || 'devdb-backups';

async function ensureBackupBucket() {
  try {
    // Check if bucket exists
    try {
      await s3Client.send(new HeadBucketCommand({ Bucket: BACKUP_BUCKET }));
    } catch (error: any) {
      if (error.name === 'NotFound') {
        // Create bucket if it doesn't exist
        await s3Client.send(new CreateBucketCommand({ 
          Bucket: BACKUP_BUCKET,
          ObjectOwnership: 'BucketOwnerPreferred'
        }));
        
        // Set bucket policy for public access if needed
        // This should be configured through AWS console or IaC for production
      }
    }
  } catch (error) {
    console.error('Error ensuring backup bucket exists:', error);
    throw error;
  }
}

interface DatabaseConnection {
  host: string;
  port: number;
  username: string;
  password?: string;  // Optional if using IAM authentication
  database: string;
  useIAMAuth?: boolean;  // Whether to use IAM authentication
  vpcEndpoint?: string;  // Optional VPC endpoint for RDS access
}

async function getConnectionPassword(connection: DatabaseConnection): Promise<string> {
  if (connection.useIAMAuth) {
    try {
      const signer = new Signer({
        region: process.env.AWS_REGION,
        hostname: connection.vpcEndpoint || connection.host,
        port: connection.port,
        username: connection.username
      });
      
      return signer.getAuthToken();
    } catch (error) {
      console.error('Error generating RDS auth token:', error);
      throw new Error('Failed to generate RDS authentication token. Check IAM permissions and network connectivity.');
    }
  }
  
  if (!connection.password) {
    throw new Error('Password is required when not using IAM authentication');
  }
  
  return connection.password;
}

async function createPostgresBackup(connection: DatabaseConnection): Promise<string> {
  const tempDir = os.tmpdir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(tempDir, `backup-${timestamp}.dump`);
  
  try {
    // Get password or IAM token
    const password = await getConnectionPassword(connection);
    
    const env = {
      PGPASSWORD: password,
      ...process.env
    };

    // Use appropriate hostname (VPC endpoint or direct)
    const host = connection.vpcEndpoint || connection.host;

    // Add SSL mode for RDS connections
    const sslMode = 'require';  // RDS requires SSL

    try {
      // Test connection first
      await execAsync(
        `pg_isready -h ${host} -p ${connection.port} -U ${connection.username}`,
        { env }
      );
    } catch (error) {
      console.error('Database connection test failed:', error);
      throw new Error(
        'Failed to connect to database. Check:\n' +
        '1. VPC connectivity (API must be in same VPC or have VPC peering)\n' +
        '2. Security group rules (allow port 5432 from API security group)\n' +
        '3. Database credentials and permissions\n' +
        '4. Network ACLs and routing tables'
      );
    }

    // Create backup using pg_dump with SSL
    await execAsync(
      `pg_dump -Fc --no-acl --no-owner -h ${host} -p ${connection.port} ` +
      `-U ${connection.username} -d ${connection.database} ` +
      `--sslmode=${sslMode} -f ${backupFile}`,
      { env }
    );

    return backupFile;
  } catch (error) {
    console.error('Error creating PostgreSQL backup:', error);
    throw error;
  }
}

async function createMySQLBackup(connection: DatabaseConnection): Promise<string> {
  const tempDir = os.tmpdir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(tempDir, `backup-${timestamp}.sql`);

  try {
    // Get password or IAM token
    const password = await getConnectionPassword(connection);

    // Use appropriate hostname (VPC endpoint or direct)
    const host = connection.vpcEndpoint || connection.host;

    try {
      // Test connection first
      await execAsync(
        `mysqladmin ping -h ${host} -P ${connection.port} -u ${connection.username} --password=${password} --ssl`
      );
    } catch (error) {
      console.error('Database connection test failed:', error);
      throw new Error(
        'Failed to connect to database. Check:\n' +
        '1. VPC connectivity (API must be in same VPC or have VPC peering)\n' +
        '2. Security group rules (allow port 3306 from API security group)\n' +
        '3. Database credentials and permissions\n' +
        '4. Network ACLs and routing tables'
      );
    }

    // Create backup using mysqldump with SSL
    await execAsync(
      `mysqldump --ssl --single-transaction --quick --no-tablespaces ` +
      `--set-gtid-purged=OFF -h ${host} -P ${connection.port} ` +
      `-u ${connection.username} -p${password} ${connection.database} > ${backupFile}`
    );

    return backupFile;
  } catch (error) {
    console.error('Error creating MySQL backup:', error);
    throw error;
  }
}

app.get("/databases", async (req: Request, res: Response) => {
  try {
    const labelSelector = "app=postgres";
    const pods = await k8sApi.listNamespacedPod(
      CURRENT_NAMESPACE,
      undefined,
      undefined,
      undefined,
      undefined,
      labelSelector
    );

    const services = await k8sApi.listNamespacedService(CURRENT_NAMESPACE);

    const postgresServices = services.body.items
      .filter(service => service.metadata?.labels?.["devdb/name"])
      .map(service => {
        const pod = pods.body.items.find(
          pod => pod.metadata?.labels?.["devdb/name"] === service.metadata?.labels?.["devdb/name"]
        );

        return {
          name: service.metadata?.labels?.["devdb/name"],
          labels: pod?.metadata?.labels || {},
          creationTimestamp: pod?.metadata?.creationTimestamp,
          status: pod?.status?.phase,
          hostname: service.status?.loadBalancer?.ingress
            ? service.status?.loadBalancer.ingress
                .map((ing) => ing.ip || ing.hostname)
                .join(", ")
            : "",
        };
      });

    res.json({ databases: postgresServices });
  } catch (error) {
    console.error(error);
    res.status(500).send("An error occurred while fetching databases");
  }
});

app.post("/databases", async (req, res) => {
  const { owner, project_id } = req.body;

  if (!owner || !project_id) {
    return res.status(400).send("Missing required fields: owner, project_id");
  }

  const project = projects[project_id];
  if (!project) {
    return res.status(404).send("Project not found");
  }

  if (project.dbType !== DatabaseType.postgres && project.dbType !== DatabaseType.mysql) {
    return res.status(400).send("Only PostgreSQL and MySQL databases are currently supported");
  }

  const ownerPrefix = owner.slice(0, 7).toLowerCase();
  const podName = `${ownerPrefix}-${project.dbType}-${project.name}`;

  try {
    // Ensure shared namespace exists
    try {
      await k8sApi.createNamespace({
        metadata: {
          name: SHARED_NAMESPACE,
          labels: {
            "devdb/type": "shared-database-namespace",
          },
        },
      });
    } catch (error: any) {
      // Ignore if namespace already exists
      if (error.response?.statusCode !== 409) {
        throw error;
      }
    }

    // Modify pod manifest to use shared namespace
    const podManifest: k8s.V1Pod = {
      apiVersion: "v1",
      kind: "Pod",
      metadata: {
        name: podName,
        namespace: SHARED_NAMESPACE,
        labels: {
          "devdb/type": String(project.dbType),
          "devdb/owner": project.owner,
          "devdb/projectId": project.id
        },
      },
      spec: {
        initContainers: [
          {
            name: "init-script",
            image: "busybox",
            command: ["sh", "-c", "chmod +x /scripts/restore-backup.sh"],
            volumeMounts: [
              {
                name: "restore-script",
                mountPath: "/scripts"
              }
            ]
          }
        ],
        containers: [
          {
            name: String(project.dbType),
            image: `${String(project.dbType)}:${project.dbVersion}`,
            command: ["/scripts/restore-backup.sh"],
            env: [
              {
                name: `${String(project.dbType).toUpperCase()}_DB`,
                value: project.name,
              },
              {
                name: `${String(project.dbType).toUpperCase()}_USER`,
                value: project.defaultCredentials.username
              },
              {
                name: `${String(project.dbType).toUpperCase()}_PASSWORD`,
                value: project.defaultCredentials.password
              },
            ],
            volumeMounts: [
              {
                name: "restore-script",
                mountPath: "/scripts"
              }
            ]
          },
        ],
        volumes: [
          {
            name: "restore-script",
            configMap: {
              name: `${project.dbType}-restore-script`
            }
          }
        ]
      },
    };

    await k8sApi.createNamespacedPod(SHARED_NAMESPACE, podManifest);
    
    // No need to create individual services anymore since we're using shared services
    res.json({ 
      result: "success", 
      name: podName,
      service: project.dbType === DatabaseType.postgres ? POSTGRES_SERVICE_NAME : MYSQL_SERVICE_NAME
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error creating database pod and service.");
  }
});

app.delete("/databases/:name", async (req, res) => {
  const { name } = req.params;
  try {
    // Delete the pod from shared namespace
    const labelSelector = `devdb/projectId=${name}`;
    const pods = await k8sApi.listNamespacedPod(
      SHARED_NAMESPACE,
      undefined,
      undefined,
      undefined,
      undefined,
      labelSelector
    );

    for (const pod of pods.body.items) {
      if (pod.metadata?.name) {
        await k8sApi.deleteNamespacedPod(pod.metadata.name, SHARED_NAMESPACE);
      }
    }

    res.send(`Database ${name} deleted!`);
  } catch (error) {
    console.error(error);
    if ((error as any).response?.body?.message) {
      res.status(500).send(`Error deleting database: ${(error as any).response.body.message}`);
    } else {
      res.status(500).send("Error deleting database.");
    }
  }
});

function generateProjectBackupLocation(owner: string, projectId: string): string {
  // Format: s3://devdb-backups/{owner}/{project-id}/backup.dump
  return `s3://${BACKUP_BUCKET}/${owner}/${projectId}/backup.dump`;
}

app.post("/projects", async (req: Request, res: Response) => {
  try {
    const projectData: CreateProjectRequest = req.body;

    // Validate required fields
    if (!projectData.owner || !projectData.name) {
      return res.status(400).send("Missing required fields");
    }

    // Validate backup location format if provided
    if (projectData.backupLocation && !projectData.backupLocation.startsWith('s3://')) {
      return res.status(400).send("Backup location must be an S3 URL (e.g., s3://bucket-name/path/to/backup.dump)");
    }

    const projectId = generateProjectId(projectData.owner, projectData.name);
    
    const newProject: Project = {
      id: projectId,
      owner: projectData.owner,
      name: projectData.name,
      dbType: 'postgres', // Default to postgres for now
      dbVersion: '15.3',  // Default version
      backupLocation: projectData.backupLocation || '', // Empty string if not provided
      defaultCredentials: {
        username: 'devdb',
        password: generateSecurePassword(),
        database: projectData.name
      }
    };

    projects[projectId] = newProject;

    res.status(201).json(newProject);
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).send("Error creating project");
  }
});

app.get("/projects", async (req: Request, res: Response) => {
  try {
    const { owner } = req.query;
    let projectList = Object.values(projects);

    // Filter by owner if provided
    if (owner && typeof owner === 'string') {
      projectList = projectList.filter(p => p.owner === owner);
    }

    res.json(projectList);
  } catch (error) {
    console.error('Error listing projects:', error);
    res.status(500).send("Error listing projects");
  }
});

app.post("/projects/:projectId/databases", async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const owner = req.header("X-DevDB-Owner");

  if (!owner) {
    return res.status(401).send("Owner header required");
  }

  const project = projects[projectId];
  if (!project) {
    return res.status(404).send("Project not found");
  }

  // Check if this is the first database and if we have a backup location
  const hasRunningDatabases = project.databases && project.databases.length > 0;
  if (!hasRunningDatabases && !project.backupLocation) {
    return res.status(400).send(
      "Cannot create first database container without a backup location. " +
      "Please set the backup location for this project before creating databases."
    );
  }

  if (project.dbType !== DatabaseType.postgres && project.dbType !== DatabaseType.mysql) {
    return res.status(400).send("Only PostgreSQL and MySQL databases are currently supported");
  }

  const ownerPrefix = owner.slice(0, 7).toLowerCase();
  const podName = `${ownerPrefix}-${project.dbType}-${project.name}`;

  try {
    // Ensure shared namespace exists
    try {
      await k8sApi.createNamespace({
        metadata: {
          name: SHARED_NAMESPACE,
          labels: {
            "devdb/type": "shared-database-namespace",
          },
        },
      });
    } catch (error: any) {
      // Ignore if namespace already exists
      if (error.response?.statusCode !== 409) {
        throw error;
      }
    }

    // Modify pod manifest to use shared namespace
    const podManifest: k8s.V1Pod = {
      apiVersion: "v1",
      kind: "Pod",
      metadata: {
        name: podName,
        namespace: SHARED_NAMESPACE,
        labels: {
          "devdb/type": String(project.dbType),
          "devdb/owner": project.owner,
          "devdb/projectId": project.id
        },
      },
      spec: {
        initContainers: [
          {
            name: "init-script",
            image: "busybox",
            command: ["sh", "-c", "chmod +x /scripts/restore-backup.sh"],
            volumeMounts: [
              {
                name: "restore-script",
                mountPath: "/scripts"
              }
            ]
          }
        ],
        containers: [
          {
            name: String(project.dbType),
            image: `${String(project.dbType)}:${project.dbVersion}`,
            command: ["/scripts/restore-backup.sh"],
            env: [
              {
                name: `${String(project.dbType).toUpperCase()}_DB`,
                value: project.name,
              },
              {
                name: `${String(project.dbType).toUpperCase()}_USER`,
                value: project.defaultCredentials.username
              },
              {
                name: `${String(project.dbType).toUpperCase()}_PASSWORD`,
                value: project.defaultCredentials.password
              },
            ],
            volumeMounts: [
              {
                name: "restore-script",
                mountPath: "/scripts"
              }
            ]
          },
        ],
        volumes: [
          {
            name: "restore-script",
            configMap: {
              name: `${project.dbType}-restore-script`
            }
          }
        ]
      },
    };

    await k8sApi.createNamespacedPod(SHARED_NAMESPACE, podManifest);
    
    // No need to create individual services anymore since we're using shared services
    res.json({ 
      result: "success", 
      name: podName,
      service: project.dbType === DatabaseType.postgres ? POSTGRES_SERVICE_NAME : MYSQL_SERVICE_NAME
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error creating database pod and service.");
  }
});

app.post("/projects/:id/backup", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { connection } = req.body as { connection: DatabaseConnection };

    // Validate project exists
    const project = projects[id];
    if (!project) {
      return res.status(404).send("Project not found");
    }

    // Validate connection details
    if (!connection || !connection.host || !connection.port || 
        !connection.username || !connection.database) {
      return res.status(400).send("Missing required connection details");
    }

    // Ensure backup bucket exists
    await ensureBackupBucket();

    // Create backup based on database type
    let backupFile: string;
    if (project.dbType === DatabaseType.postgres) {
      backupFile = await createPostgresBackup(connection);
    } else if (project.dbType === DatabaseType.mysql) {
      backupFile = await createMySQLBackup(connection);
    } else {
      return res.status(400).send("Unsupported database type");
    }

    // Get backup paths for this project
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const instanceName = `${project.owner}-${project.name}`;
    const { backupDir } = getBackupPaths('project', project.id, instanceName);
    
    // Upload backup to S3
    const objectKey = `${backupDir}/${timestamp}.${project.dbType === DatabaseType.postgres ? 'dump' : 'sql'}`;
    
    await s3Client.send(new PutObjectCommand({
      Bucket: BACKUP_BUCKET,
      Key: objectKey,
      Body: fs.createReadStream(backupFile),
      ContentType: project.dbType === DatabaseType.postgres ? 'application/octet-stream' : 'text/plain'
    }));

    // Clean up temporary file
    fs.unlinkSync(backupFile);

    res.json({
      message: "Backup created successfully",
      backupFile: objectKey
    });
  } catch (error) {
    console.error('Error creating backup:', error);
    res.status(500).send("Error creating backup");
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

function generateSecurePassword(length: number = 32): string {
  // Define character sets for password
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const numbers = '0123456789';
  const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?';
  
  // Combine all character sets
  const allChars = lowercase + uppercase + numbers + symbols;
  
  // Generate random bytes
  const bytes = crypto.randomBytes(length);
  
  // Convert bytes to password string
  let password = '';
  for (let i = 0; i < length; i++) {
    password += allChars[bytes[i] % allChars.length];
  }
  
  // Ensure password has at least one of each character type
  password = password.substring(4); // Make room for required chars
  password = lowercase[crypto.randomInt(lowercase.length)] +
            uppercase[crypto.randomInt(uppercase.length)] +
            numbers[crypto.randomInt(numbers.length)] +
            symbols[crypto.randomInt(symbols.length)] +
            password;
  
  return password;
}
