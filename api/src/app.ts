import { IncomingMessage } from 'http';
import express, { Request, Response } from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { KubeConfig, CoreV1Api, CustomObjectsApi } from "@kubernetes/client-node";
import { releaseHeader } from './middleware/releaseHeader.js';
import { components } from './types/generated/api.js';
import crypto from 'crypto';
import Redis from 'ioredis';
import { S3Client, HeadBucketCommand, CreateBucketCommand, HeadObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { pipeline } from 'stream/promises';

type Database = components['schemas']['Database'];
type Project = components['schemas']['Project'];
type CreateProjectRequest = components['schemas']['CreateProjectRequest'];
type DatabaseType = components['schemas']['DatabaseType'];
type DatabaseCredentials = components['schemas']['DatabaseCredentials'];

const app = express();
const port: number = 5000;

app.use(cors());
app.use(bodyParser.json());
app.use(releaseHeader);

// Initialize Kubernetes client
const kc = new KubeConfig();
kc.loadFromDefault();
const k8sApi = kc.makeApiClient(CoreV1Api);
const k8sApiExt = kc.makeApiClient(CustomObjectsApi);

const AWS_REGION = process.env.AWS_REGION || 'us-west-2';
const S3_BUCKET = process.env.S3_BUCKET || 'devdb-backups';
const EBS_ENABLED = process.env.AWS_EBS_ENABLED === 'true';
const EBS_STORAGE_CLASS = process.env.AWS_EBS_STORAGE_CLASS || 'ebs-sc';
const EBS_SNAPSHOT_CLASS = process.env.AWS_EBS_SNAPSHOT_CLASS || 'ebs-snapshot-class';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
// Get the current namespace from the Kubernetes environment
const SHARED_NAMESPACE = fs.existsSync('/var/run/secrets/kubernetes.io/serviceaccount/namespace')
  ? fs.readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/namespace', 'utf8')
  : 'default';
const POSTGRES_SERVICE_NAME = 'shared-postgres-service';

// Initialize S3 client
const s3Client = new S3Client({ region: AWS_REGION });

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
    region: AWS_REGION,
    ebs: {
      enabled: EBS_ENABLED,
      storageClass: EBS_STORAGE_CLASS,
      snapshotClass: EBS_SNAPSHOT_CLASS
    }
  },
  s3: {
    bucket: S3_BUCKET
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

const redis = new Redis(REDIS_URL);

function generateProjectId(owner: string, name: string): string {
  return `${owner}-${name}`;
}

import * as fs from 'fs';
import * as path from 'path';

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

    const pods = await k8sApi.listNamespacedPod({
      namespace: SHARED_NAMESPACE,
      labelSelector: `devdb/projectId=${projectId}`
    });

    const databases = pods.items.map((pod: any) => ({
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
  const { name, backupUrl } = req.body;

  if (!name) {
    return res.status(400).send("Name is required");
  }

  try {
    const project = await getProject(projectId);
    if (!project) {
      return res.status(404).send("Project not found");
    }

    // Check if there are any existing pods for this project
    const existingPods = await k8sApi.listNamespacedPod({
      namespace: SHARED_NAMESPACE,
      labelSelector: `devdb/projectId=${project.id}`
    });

    const podName = name;
    const pvcName = `${name}-data`;
    let useSnapshot = false;
    let latestSnapshot = null;

    // If backupUrl is provided and this is the first database, prepare the backup
    let backupPath = null;
    if (backupUrl && existingPods.items.length === 0) {
      backupPath = await prepareBackup(backupUrl);
      if (!backupPath) {
        return res.status(400).send("Failed to prepare backup from URL");
      }
    }

    if (existingPods.items.length > 0) {
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
    const podManifest: any = {
      apiVersion: "v1",
      kind: "Pod",
      metadata: {
        name: podName,
        namespace: SHARED_NAMESPACE,
        labels: {
          "devdb/type": String(project.dbType),
          "devdb/owner": project.owner,
          "devdb/projectId": project.id,
          "app": podName
        },
      },
      spec: {
        initContainers: backupPath ? [
          {
            name: "restore-backup",
            image: "postgres:latest",
            command: ["pg_restore", "-U", "postgres", "-d", "postgres", "/backup/backup.dump"],
            env: [
              {
                name: "PGPASSWORD",
                value: "postgres"  // This should be replaced with a secure password
              }
            ],
            volumeMounts: [
              {
                name: "data",
                mountPath: "/var/lib/postgresql/data"
              },
              {
                name: "backup",
                mountPath: "/backup"
              }
            ]
          }
        ] : [],
        containers: [
          {
            name: String(project.dbType),
            image: `${String(project.dbType)}:${project.dbVersion}`,
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
                name: "data",
                mountPath: "/var/lib/postgresql/data"
              }
            ]
          },
        ],
        volumes: [
          {
            name: "data",
            persistentVolumeClaim: {
              claimName: pvcName
            }
          },
          ...(backupPath ? [
            {
              name: "backup",
              hostPath: {
                path: path.dirname(backupPath),
                type: "Directory"
              }
            }
          ] : [])
        ]
      },
    };

    await k8sApi.createNamespacedPod({
      namespace: SHARED_NAMESPACE,
      body: podManifest
    });

    // Create service for the pod
    const serviceManifest: any = {
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

    await k8sApi.createNamespacedService({
      namespace: SHARED_NAMESPACE,
      body: serviceManifest
    });

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
});

app.delete("/projects/:projectId/databases/:name", async (req: Request, res: Response) => {
  const { projectId, name } = req.params;

  try {
    const project = await getProject(projectId);
    if (!project) {
      return res.status(404).send("Project not found");
    }

    // Delete the pod
    await k8sApi.deleteNamespacedPod({
      name: name,
      namespace: SHARED_NAMESPACE
    });
    
    // Delete the associated service
    try {
      await k8sApi.deleteNamespacedService({
        name: name,
        namespace: SHARED_NAMESPACE
      });
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
    const response = await k8sApiExt.createNamespacedCustomObject({
      group: "snapshot.storage.k8s.io",
      version: "v1",
      namespace: namespace,
      plural: "volumesnapshots",
      body: snapshotManifest
    });
    return response;
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

  try {
    const response = await k8sApiExt.listNamespacedCustomObject({
      group: "snapshot.storage.k8s.io",
      version: "v1",
      namespace: namespace,
      plural: "volumesnapshots",
    });

    const snapshots = response.items;
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
): Promise<any> {
  const pvcManifest: any = {
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

  return await k8sApi.createNamespacedPersistentVolumeClaim({
    namespace: namespace,
    body: pvcManifest
  });
}

async function createPersistentVolumeClaim(
  name: string,
  namespace: string,
  size: string = "10Gi",
  storageClass: string = 'ebs-sc'
): Promise<any> {
  const pvc: any = {
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

  return await k8sApi.createNamespacedPersistentVolumeClaim({
    namespace: namespace,
    body: pvc
  });
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
