import { IncomingMessage } from 'http';
import express, { Request, Response } from "express";
import cors from "cors";
import bodyParser from "body-parser";
import * as k8s from "@kubernetes/client-node";
import { releaseHeader } from './middleware/releaseHeader';
import { components } from './types/generated/api';
import crypto from 'crypto';
import Redis from 'ioredis';
import { S3Client, HeadBucketCommand, CreateBucketCommand, HeadObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { pipeline } from 'stream/promises';

type Database = components['schemas']['Database'];
type Project = components['schemas']['Project'];
type CreateProjectRequest = components['schemas']['CreateProjectRequest'];

const app = express();
const port: number = 5000;

app.use(cors());
app.use(bodyParser.json());
app.use(releaseHeader);

// Initialize Kubernetes client
const kc = new k8s.KubeConfig();
kc.loadFromDefault();
const k8sApi = kc.makeApiClient(k8s.CoreV1Api);

// Initialize S3 client
const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-west-2' });

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
  postgres = 'postgres'
}

interface DatabaseCredentials {
  username: string;
  password?: string;
  database: string;
}

interface Config {
  aws: {
    region: string;
    ebs?: {
      enabled: boolean;
      storageClass?: string;
      snapshotClass?: string;
    };
  };
  s3: {
    bucket: string;
  };
}

const config: Config = {
  aws: {
    region: process.env.AWS_REGION || 'us-west-2',
    ebs: {
      enabled: process.env.AWS_EBS_ENABLED === 'true',
      storageClass: process.env.AWS_EBS_STORAGE_CLASS || 'ebs-sc',
      snapshotClass: process.env.AWS_EBS_SNAPSHOT_CLASS || 'ebs-snapshot-class'
    }
  },
  s3: {
    bucket: process.env.S3_BUCKET || 'devdb-backups'
  }
};

const getStorageConfig = () => {
  if (config.aws.ebs?.enabled) {
    return {
      storageClass: config.aws.ebs.storageClass,
      snapshotClass: config.aws.ebs.snapshotClass,
      useSnapshots: true
    };
  }
  return {
    storageClass: 'standard',
    snapshotClass: undefined,
    useSnapshots: false
  };
};

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

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

import { Signer } from "@aws-sdk/rds-signer";
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);

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
  password?: string;
  database: string;
  useIAMAuth?: boolean;
  vpcEndpoint?: string;
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

// Function to validate and download backup
async function prepareBackup(backupUrl: string): Promise<string | null> {
  try {
    // Parse S3 URL
    const url = new URL(backupUrl);
    if (!url.hostname.startsWith('s3://')) {
      throw new Error('Invalid S3 URL format');
    }
    
    const bucket = url.hostname.replace('s3://', '');
    const key = url.pathname.substring(1); // Remove leading slash
    
    // Check if backup exists
    try {
      await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    } catch (error) {
      console.error('Backup file not found in S3:', error);
      return null;
    }
    
    // Create local backup directory if it doesn't exist
    const backupDir = '/tmp/backups';
    await fs.promises.mkdir(backupDir, { recursive: true });
    
    // Download backup
    const localPath = `${backupDir}/${key.split('/').pop()}`;
    const writeStream = fs.createWriteStream(localPath);
    const response = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    
    if (!response.Body) {
      throw new Error('Empty response from S3');
    }
    
    await pipeline(response.Body as any, writeStream);
    return localPath;
  } catch (error) {
    console.error('Error preparing backup:', error);
    return null;
  }
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
      dbType: projectData.dbType || 'postgres', // Default to postgres if not specified
      dbVersion: projectData.dbVersion || '15.3', // Default version if not specified
      backupLocation: projectData.backupLocation || '', // Empty string if not provided
      defaultCredentials: {
        username: 'devdb',
        password: 'devdb',
        database: 'devdb'
      }
    };

    // Store project in Redis
    await redis.set(`project:${projectId}`, JSON.stringify(newProject));
    
    res.status(201).json(newProject);
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).send("Internal server error");
  }
});

app.get("/projects", async (req: Request, res: Response) => {
  try {
    const owner = req.query.owner as string | undefined;
    
    // Get all project keys
    const projectKeys = await redis.keys('project:*');
    const projects: Project[] = [];
    
    // Get all projects
    for (const key of projectKeys) {
      const projectJson = await redis.get(key);
      if (projectJson) {
        const project = JSON.parse(projectJson) as Project;
        if (!owner || project.owner === owner) {
          projects.push(project);
        }
      }
    }
    
    res.json(projects);
  } catch (error) {
    console.error('Error fetching projects:', error);
    res.status(500).send("Internal server error");
  }
});

app.get("/projects/:projectId/databases", async (req: Request, res: Response) => {
  const { projectId } = req.params;
  try {
    const project = await getProject(projectId);
    if (!project) {
      return res.status(404).send("Project not found");
    }

    const pods = await k8sApi.listNamespacedPod(
      SHARED_NAMESPACE,
      undefined,
      undefined,
      undefined,
      undefined,
      `devdb/projectId=${projectId}`
    );

    const databases = pods.body.items.map(pod => ({
      name: pod.metadata?.name || '',
      status: pod.status?.phase?.toLowerCase() || 'unknown',
      project: projectId,
      host: `${pod.metadata?.name}.${SHARED_NAMESPACE}`,
      port: 5432,
      username: project.defaultCredentials.username,
      database: project.defaultCredentials.database
    }));

    res.json(databases);
  } catch (error) {
    console.error(error);
    res.status(500).send("Error listing databases");
  }
});

app.post("/projects/:projectId/databases", async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const { name } = req.body;

  if (!name) {
    return res.status(400).send("Missing required field: name");
  }

  try {
    const project = await getProject(projectId);
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

    if (project.dbType !== DatabaseType.postgres) {
      return res.status(400).send("Only PostgreSQL databases are currently supported");
    }

    const ownerPrefix = project.owner.slice(0, 7).toLowerCase();
    const podName = `${ownerPrefix}-${project.dbType}-${project.name}`;
    const pvcName = `${podName}-data`;

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

      // Check for existing databases and volume snapshots
      const existingPods = await k8sApi.listNamespacedPod(
        SHARED_NAMESPACE,
        undefined,
        undefined,
        undefined,
        undefined,
        `devdb/projectId=${project.id}`
      );

      let useSnapshot = false;
      let latestSnapshot = null;

      if (existingPods.body.items.length > 0) {
        // This is not the first database for this project
        latestSnapshot = await getLatestVolumeSnapshot(project.id, SHARED_NAMESPACE);
        if (latestSnapshot) {
          useSnapshot = true;
        }
      }

      // Create PVC, either from scratch or from snapshot
      if (useSnapshot && latestSnapshot) {
        await createPVCFromSnapshot(
          pvcName,
          SHARED_NAMESPACE,
          latestSnapshot.metadata.name
        );
      } else {
        await createPersistentVolumeClaim(pvcName, SHARED_NAMESPACE);
      }

      // Create pod manifest
      const podManifest: k8s.V1Pod = {
        apiVersion: "v1",
        kind: "Pod",
        metadata: {
          name: podName,
          namespace: SHARED_NAMESPACE,
          labels: {
            "devdb/type": String(project.dbType),
            "devdb/owner": project.owner,
            "devdb/projectId": project.id,
            "app": podName // Add label for service selector
          },
        },
        spec: {
          initContainers: useSnapshot ? [] : [
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
              command: useSnapshot ? undefined : ["/scripts/restore-backup.sh"],
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
                ...(!useSnapshot ? [{
                  name: "restore-script",
                  mountPath: "/scripts"
                }] : []),
                {
                  name: "data",
                  mountPath: "/var/lib/postgresql/data"
                }
              ]
            },
          ],
          volumes: [
            ...(!useSnapshot ? [{
              name: "restore-script",
              configMap: {
                name: `${project.dbType}-restore-script`
              }
            }] : []),
            {
              name: "data",
              persistentVolumeClaim: {
                claimName: pvcName
              }
            }
          ]
        },
      };

      await k8sApi.createNamespacedPod(SHARED_NAMESPACE, podManifest);

      // Create service for the pod
      const serviceManifest: k8s.V1Service = {
        apiVersion: "v1",
        kind: "Service",
        metadata: {
          name: podName,
          namespace: SHARED_NAMESPACE,
          labels: {
            "devdb/type": String(project.dbType),
            "devdb/owner": project.owner,
            "devdb/projectId": project.id
          },
          annotations: {
            "service.beta.kubernetes.io/aws-load-balancer-type": "nlb",
            "service.beta.kubernetes.io/aws-load-balancer-scheme": "internet-facing",
            "service.beta.kubernetes.io/aws-load-balancer-nlb-target-type": "ip"
          }
        },
        spec: {
          type: "LoadBalancer",
          ports: [
            {
              port: 5432,
              targetPort: 5432,
              protocol: "TCP"
            }
          ],
          selector: {
            app: podName
          }
        }
      };

      await k8sApi.createNamespacedService(SHARED_NAMESPACE, serviceManifest);

      // Create volume snapshot if this is the first database
      if (!useSnapshot) {
        try {
          // Wait a bit for the database to initialize
          await new Promise(resolve => setTimeout(resolve, 30000));
          await createVolumeSnapshot(pvcName, SHARED_NAMESPACE);
        } catch (error) {
          console.error('Error creating volume snapshot:', error);
          // Don't fail the request if snapshot creation fails
        }
      }
      
      res.json({ 
        result: "success", 
        name: podName,
        service: POSTGRES_SERVICE_NAME,
        restoredFromSnapshot: useSnapshot
      });
    } catch (error) {
      console.error(error);
      res.status(500).send("Error creating database pod and service.");
    }
  } catch (error) {
    console.error(error);
    res.status(500).send("Error creating database pod and service.");
  }
});

app.delete("/projects/:projectId/databases/:name", async (req: Request, res: Response) => {
  const { projectId, name } = req.params;

  try {
    const project = await getProject(projectId);
    if (!project) {
      return res.status(404).send("Project not found");
    }

    // Delete the pod
    await k8sApi.deleteNamespacedPod(name, SHARED_NAMESPACE);
    
    // Delete the associated service
    try {
      await k8sApi.deleteNamespacedService(name, SHARED_NAMESPACE);
    } catch (error: any) {
      // Don't fail if service doesn't exist
      if (error.response?.statusCode !== 404) {
        throw error;
      }
    }

    res.json({ message: "Database deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error deleting database");
  }
});

app.post("/projects/:id/backup", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { connection } = req.body as { connection: DatabaseConnection };

    // Validate project exists
    const project = await getProject(id);
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

async function createVolumeSnapshot(
  pvcName: string,
  namespace: string,
  snapshotClassName?: string
): Promise<any | null> {
  const storage = getStorageConfig();
  
  if (!storage.useSnapshots) {
    console.log('Volume snapshots are not enabled. Skipping snapshot creation.');
    return null;
  }

  const k8sApiExt = kc.makeApiClient(k8s.CustomObjectsApi);
  const snapshotName = `${pvcName}-snapshot-${Date.now()}`;

  const snapshotManifest = {
    apiVersion: "snapshot.storage.k8s.io/v1",
    kind: "VolumeSnapshot",
    metadata: {
      name: snapshotName,
      namespace: namespace
    },
    spec: {
      source: {
        persistentVolumeClaimName: pvcName
      },
      volumeSnapshotClassName: snapshotClassName || storage.snapshotClass
    }
  };

  try {
    const response = await k8sApiExt.createNamespacedCustomObject(
      "snapshot.storage.k8s.io",
      "v1",
      namespace,
      "volumesnapshots",
      snapshotManifest
    );
    return response.body;
  } catch (error) {
    console.error('Error creating volume snapshot:', error);
    // Return null instead of throwing to handle the error gracefully
    return null;
  }
}

async function getLatestVolumeSnapshot(
  projectId: string,
  namespace: string
): Promise<any | null> {
  const storage = getStorageConfig();
  
  if (!storage.useSnapshots) {
    console.log('Volume snapshots are not enabled. Skipping snapshot lookup.');
    return null;
  }

  const k8sApiExt = kc.makeApiClient(k8s.CustomObjectsApi);

  try {
    const response = await k8sApiExt.listNamespacedCustomObject(
      'snapshot.storage.k8s.io',
      'v1',
      namespace,
      'volumesnapshots',
      undefined,
      undefined,
      undefined,
      undefined,
      `projectId=${projectId}`
    ) as {
      response: IncomingMessage;
      body: {
        items: Array<{
          metadata: {
            name: string;
            creationTimestamp: string;
          };
        }>;
      };
    };

    const snapshots = response.body.items;
    if (!snapshots || snapshots.length === 0) {
      return null;
    }

    // Sort by creation timestamp and get the latest
    return snapshots.sort((a: any, b: any) => {
      const timeA = new Date(a.metadata.creationTimestamp).getTime();
      const timeB = new Date(b.metadata.creationTimestamp).getTime();
      return timeB - timeA;
    })[0];
  } catch (error) {
    console.error('Error getting volume snapshots:', error);
    return null;
  }
}

async function createPVCFromSnapshot(
  name: string,
  namespace: string,
  snapshotName: string,
  size: string = "10Gi",
  storageClass: string = 'ebs-sc'
): Promise<k8s.V1PersistentVolumeClaim> {
  const pvcManifest: k8s.V1PersistentVolumeClaim = {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: {
      name: name,
      namespace: namespace
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      resources: {
        requests: {
          storage: size
        }
      },
      storageClassName: storageClass,
      dataSource: {
        name: snapshotName,
        kind: "VolumeSnapshot",
        apiGroup: "snapshot.storage.k8s.io"
      }
    }
  };

  return (await k8sApi.createNamespacedPersistentVolumeClaim(namespace, pvcManifest)).body;
}

async function createPersistentVolumeClaim(
  name: string,
  namespace: string,
  size: string = "10Gi",
  storageClass: string = 'ebs-sc'
): Promise<k8s.V1PersistentVolumeClaim> {
  const pvc: k8s.V1PersistentVolumeClaim = {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: {
      name: name,
      namespace: namespace
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      resources: {
        requests: {
          storage: size
        }
      },
      storageClassName: storageClass
    }
  };

  return (await k8sApi.createNamespacedPersistentVolumeClaim(namespace, pvc)).body;
}

async function getProject(projectId: string): Promise<Project | null> {
  const projectJson = await redis.get(`project:${projectId}`);
  if (projectJson) {
    return JSON.parse(projectJson) as Project;
  }
  return null;
}

// Add health check endpoint
app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({ status: "healthy" });
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
