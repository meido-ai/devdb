import express, { Request, Response } from "express";
import cors from "cors";
import bodyParser from "body-parser";
import * as k8s from "@kubernetes/client-node";
import { CustomObjectsApi } from '@kubernetes/client-node';
import { releaseHeader } from './middleware/releaseHeader';
import { ConfigData } from './types/config';
import { SnapshotInfo, SnapshotListItem, VolumeSnapshotList } from './types/kubernetes';
import * as dotenv from "dotenv";
dotenv.config();
const { RESTORE_FROM_BACKUP } = process.env;

const app = express();
const port: number = 5000;

app.use(cors());
app.use(bodyParser.json());
app.use(releaseHeader);

const kc = new k8s.KubeConfig();
kc.loadFromDefault();

const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
const k8sCustomApi = kc.makeApiClient(CustomObjectsApi);

async function getConfigMapData(): Promise<ConfigData> {
  try {
    const configMap = await k8sApi.readNamespacedConfigMap('postgres-config', 'default');
    const data = configMap.body.data;
    
    if (!data || 
        !data.POSTGRES_VERSION ||
        !data.POSTGRES_DB ||
        !data.POSTGRES_USER ||
        !data.POSTGRES_PASSWORD ||
        !data.BACKUP_LOCATION_URL) {
      throw new Error('ConfigMap is missing required fields');
    }
    
    return data as unknown as ConfigData;
  } catch (error) {
    console.error('Error reading ConfigMap:', error);
    throw error;
  }
}

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

async function getLatestSnapshot(): Promise<SnapshotInfo | null> {
  try {
    const response = await k8sCustomApi.listNamespacedCustomObject(
      'snapshot.storage.k8s.io',
      'v1',
      'default',
      'volumesnapshots'
    );
    
    const snapshots = response.body as VolumeSnapshotList;
    
    if (!snapshots.items?.length) {
      console.warn('No snapshots found in the cluster');
      return null;
    }

    const sortedSnapshots = snapshots.items.sort((a, b) => {
      const timeA = a.metadata?.creationTimestamp || '';
      const timeB = b.metadata?.creationTimestamp || '';
      return timeB.localeCompare(timeA);
    });

    const latestSnapshot = sortedSnapshots[0];
    return {
      name: latestSnapshot.metadata?.name || '',
      creationTime: latestSnapshot.metadata?.creationTimestamp || ''
    };
  } catch (error) {
    console.error('Error fetching snapshots:', error);
    return null;
  }
}

/** 
 * @swagger
 * /databases:
 *   get:
 *     description: Returns all databases
 *     responses:
 *       200:
 *         description: List of databases
 *       500:
 *         description: Server error
 */
app.get("/databases", async (req: Request, res: Response) => {
  try {
    const { body } = await k8sApi.listNamespace();

    let postgresServices: any[] = [];
    const labelSelector = "app=postgres";
    
    const namespaces = filteredNamespaces(body.items);
    for (const namespace of namespaces) {
      if (namespace.name) {
        const res = await k8sApi.listNamespacedService(namespace.name);
        const services = res.body.items;
        const pods = await k8sApi.listNamespacedPod(
          namespace.name,
          undefined,
          undefined,
          undefined,
          undefined,
          labelSelector
        );
        const serviceInfo = services.map((service) => ({
          namespace: namespace.name,
          labels: namespace.labels,
          creationTimestamp: namespace.creationTimestamp,
          status: pods.body.items[0].status?.phase, // there should be only one pod in namespace with app=postgres label
          hostname: service.status?.loadBalancer?.ingress
            ? service.status?.loadBalancer.ingress
                .map((ing) => ing.ip || ing.hostname)
                .join(", ")
            : "",
        }));
        postgresServices = postgresServices.concat(serviceInfo);
      }
    }
    res.json({ databases: postgresServices });
  } catch (error) {
    console.error(error);
    res.status(500).send("An error occurred while fetching databases");
  }
});

/** 
 * @swagger
 * /databases:
 *   post:
 *     description: Create a new database
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - owner
 *               - db_type
 *               - name
 *               - project_id
 *     responses:
 *       200:
 *         description: Database created successfully
 *       400:
 *         description: Invalid input parameters
 *       500:
 *         description: Server error
 */
app.post("/databases", async (req: Request, res: Response) => {
  const owner = req.body.owner;
  const type = req.body.db_type;
  const namespaceName = req.body.name;
  const projectId = req.body.project_id.toString();

  if (!owner || !type || !namespaceName || !projectId) {
    return res
      .status(400)
      .send("Missing required fields: owner, name, db_type, project_id");
  }

  if (type !== "postgres") {
    return res.status(400).send("Invalid db_type. Only 'postgres' is supported");
  }

  let snapshot: SnapshotInfo | null = null;

  try {
    const config = await getConfigMapData();
    const { 
      POSTGRES_VERSION,
      POSTGRES_DB, 
      POSTGRES_USER, 
      POSTGRES_PASSWORD,
      BACKUP_LOCATION_URL 
    } = config;

    if (!POSTGRES_VERSION || !POSTGRES_DB || !POSTGRES_USER || !POSTGRES_PASSWORD || !BACKUP_LOCATION_URL) {
      return res.status(500).send("Missing required configuration in ConfigMap");
    }

    const supportedVersions = ['13', '14', '15']; 
    if (!supportedVersions.includes(POSTGRES_VERSION)) {
      return res.status(400).send("Invalid Postgres version. Supported versions are: 13, 14, 15");
    }

    const postgresImage = `postgres:${POSTGRES_VERSION}`;

    const uniqueId = namespaceName.split("-").pop();
    const podName = `${type}-${uniqueId}`;
    const pvcName = `postgres-data-${uniqueId}`;

    snapshot = await getLatestSnapshot();
    if (!snapshot) {
      return res.status(400).send('No valid database snapshot found. Please initialize a snapshot first.');
    }

    console.log(`Creating database using snapshot: ${snapshot.name} (created at ${snapshot.creationTime})`);

    // Modify PVC creation to include snapshot information
    const pvcManifest: k8s.V1PersistentVolumeClaim = {
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      metadata: {
        name: pvcName,
        namespace: namespaceName,
        annotations: {
          'devdb.io/source-snapshot': snapshot.name,
          'devdb.io/source-snapshot-time': snapshot.creationTime,
          'devdb.io/creation-time': new Date().toISOString()
        }
      },
      spec: {
        accessModes: ['ReadWriteOnce'],
        resources: {
          requests: {
            storage: '10Gi'
          }
        },
        dataSource: {
          name: snapshot.name,
          kind: 'VolumeSnapshot',
          apiGroup: 'snapshot.storage.k8s.io'
        }
      }
    };

    // Update pod manifest to use dynamic image
    const podManifest: k8s.V1Pod = {
      apiVersion: "v1",
      kind: "Pod",
      metadata: {
        name: podName,
        namespace: namespaceName,
        labels: {
          app: "postgres",
          "postgres-version": POSTGRES_VERSION,
        },
      },
      spec: {
        containers: [
          {
            name: "postgres",
            image: postgresImage,
            volumeMounts: [
              {
                name: 'postgres-data',
                mountPath: '/var/lib/postgresql/data'
              }
            ],
            env: [
              {
                name: "POSTGRES_DB",
                value: POSTGRES_DB,
              },
              {
                name: "POSTGRES_USER",
                value: POSTGRES_USER,
              },
              {
                name: "POSTGRES_PASSWORD",
                value: POSTGRES_PASSWORD,
              },
              {
                name: "DB_BACKUP_URL",
                value: BACKUP_LOCATION_URL,
              },
              {
                name: "RESTORE_FROM_BACKUP",
                value: RESTORE_FROM_BACKUP,
              },
            ],
          },
        ],
        volumes: [
          {
            name: 'postgres-data',
            persistentVolumeClaim: {
              claimName: pvcName
            }
          }
        ]
      },
    };

    // Create namespace first
    await k8sApi.createNamespace({
      metadata: {
        name: namespaceName,
        labels: {
          "devdb/owner": owner,
          "devdb/type": type,
          "devdb/projectId": projectId,
        },
      },
    });

    // Create PVC before Pod
    await k8sApi.createNamespacedPersistentVolumeClaim(namespaceName, pvcManifest);
    await k8sApi.createNamespacedPod(namespaceName, podManifest);

    const loadBalancerName = `${owner}-${podName}-lb`;

    // Define the service
    const postgresService = {
      apiVersion: "v1",
      kind: "Service",
      metadata: {
        name: "postgres-service",
        namespace: namespaceName,
        annotations: {
          "service.beta.kubernetes.io/aws-load-balancer-scheme":
            "internet-facing",
          "service.beta.kubernetes.io/aws-load-balancer-type": "external",
          "service.beta.kubernetes.io/aws-load-balancer-nlb-target-type": "ip",
          "service.beta.kubernetes.io/aws-load-balancer-name": loadBalancerName,
        },
      },
      spec: {
        type: "LoadBalancer",
        selector: {
          app: "postgres",
        },
        ports: [
          {
            protocol: "TCP",
            port: 5432,
            targetPort: 5432,
          },
        ],
      },
    };

    // Create the service
    k8sApi
      .createNamespacedService(namespaceName, postgresService)
      .then((response) => {
        res.json({ result: "success", namespace: namespaceName });
        console.log("Created service:", "postgres-service");
      })
      .catch((err) => {
        console.error("Failed to create service:", err);
      });

    // Enhanced response with snapshot details
    res.status(201).json({
      message: 'Database created successfully',
      database: {
        name: podName,
        namespace: namespaceName,
        sourceSnapshot: snapshot.name,
        sourceSnapshotCreationTime: snapshot.creationTime,
        createdAt: new Date().toISOString()
      }
    });

    console.log(`Successfully created database ${podName} in namespace ${namespaceName}`);
    console.log(`Source snapshot: ${snapshot.name}`);
    console.log(`Snapshot creation time: ${snapshot.creationTime}`);

  } catch (error) {
    console.error('Error creating database:', error);
    console.error('Snapshot details:', snapshot);
    res.status(500).send('Error creating database');
  }
});

// Simplified config endpoint
app.put("/config", async (req: Request, res: Response) => {
  try {
    const { 
      POSTGRES_VERSION,
      POSTGRES_DB, 
      POSTGRES_USER, 
      POSTGRES_PASSWORD 
    } = req.body;
    
    if (!POSTGRES_VERSION || !POSTGRES_DB || !POSTGRES_USER || !POSTGRES_PASSWORD) {
      return res.status(400).send("Missing required configuration fields");
    }

    const supportedVersions = ['13', '14', '15'];
    if (!supportedVersions.includes(POSTGRES_VERSION)) {
      return res.status(400).send("Invalid Postgres version. Supported versions are: 13, 14, 15");
    }

    const patch = {
      data: {
        POSTGRES_VERSION,
        POSTGRES_DB,
        POSTGRES_USER,
        POSTGRES_PASSWORD,
      }
    };

    await k8sApi.patchNamespacedConfigMap('postgres-config', 'default', patch);
    res.json({ message: "Configuration updated successfully" });
  } catch (error) {
    console.error('Error updating ConfigMap:', error);
    res.status(500).send("Error updating configuration");
  }
});

app.delete("/databases/:namespace", async (req, res) => {
  const { namespace } = req.params;
  try {
    const { body } = await k8sApi.listNamespace();

    const namespaces = filteredNamespaces(body.items).filter(
      (ns) => ns.name === namespace
    );

    if (namespaces.length > 0) {
      await k8sApi.deleteNamespacedService("postgres-service", namespace);
      const labelSelector = "app=postgres";
      const pods = await k8sApi.listNamespacedPod(
        namespace,
        undefined,
        undefined,
        undefined,
        undefined,
        labelSelector
      );
      for (const pod of pods.body.items) {
        if (pod.metadata && pod.metadata.name) {
          await k8sApi.deleteNamespacedPod(pod.metadata.name, namespace);
        }
      }
      await k8sApi.deleteNamespace(namespace);
      res.send(`Namespace ${namespace} deleted!`);
    } else {
      res
        .status(400)
        .send(`Namespace does not exist or was not created by devdb api`);
    }
  } catch (error) {
    console.error(error);
    if (
      (error as any).response &&
      (error as any).response.body &&
      (error as any).response.body.message
    ) {
      res
        .status(500)
        .send(
          `Error deleting namespace: ${(error as any).response.body.message}`
        );
    } else {
      res.status(500).send("Error deleting namespace.");
    }
  }
});

app.post("/initialize-snapshot", async (req: Request, res: Response) => {
  try {
    const config = await getConfigMapData();
    
    // Validate backup URL
    if (!validateURL(config.BACKUP_LOCATION_URL)) {
      return res.status(400).send('Invalid backup URL format');
    }

    const isBackupAccessible = await verifyURL(config.BACKUP_LOCATION_URL);
    if (!isBackupAccessible) {
      return res.status(400).send('Backup URL is not accessible');
    }

    const tempNamespace = `postgres-init-${Date.now()}`;
    const pvcName = 'postgres-init-data';
    const podName = 'postgres-init';

    // Create temporary namespace
    await k8sApi.createNamespace({
      metadata: { name: tempNamespace }
    });

    // Create PVC for init database
    const pvcManifest: k8s.V1PersistentVolumeClaim = {
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      metadata: { name: pvcName },
      spec: {
        accessModes: ['ReadWriteOnce'],
        resources: {
          requests: { storage: '10Gi' }
        }
      }
    };
    await k8sApi.createNamespacedPersistentVolumeClaim(tempNamespace, pvcManifest);

    // Create init Pod with pg_restore
    const initPodManifest: k8s.V1Pod = {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name: podName },
      spec: {
        containers: [{
          name: 'postgres-init',
          image: `postgres:${config.POSTGRES_VERSION}`,
          volumeMounts: [{
            name: 'postgres-data',
            mountPath: '/var/lib/postgresql/data'
          }],
          env: [
            { name: 'POSTGRES_DB', value: config.POSTGRES_DB },
            { name: 'POSTGRES_USER', value: config.POSTGRES_USER },
            { name: 'POSTGRES_PASSWORD', value: config.POSTGRES_PASSWORD }
          ],
          lifecycle: {
            postStart: {
              exec: {
                command: [
                  '/bin/sh', '-c',
                  `wget ${config.BACKUP_LOCATION_URL} -O /tmp/backup.dump && \
                   pg_restore -U ${config.POSTGRES_USER} -d ${config.POSTGRES_DB} /tmp/backup.dump`
                ]
              }
            }
          }
        }],
        volumes: [{
          name: 'postgres-data',
          persistentVolumeClaim: { claimName: pvcName }
        }]
      }
    };
    await k8sApi.createNamespacedPod(tempNamespace, initPodManifest);

    // Wait for pod to complete
    // TODO: Add proper pod completion check

    // Create VolumeSnapshot
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const snapshotManifest = {
      apiVersion: 'snapshot.storage.k8s.io/v1',
      kind: 'VolumeSnapshot',
      metadata: {
        name: `postgres-snapshot-${timestamp}`,
        labels: {
          'app.kubernetes.io/name': 'postgres',
          'app.kubernetes.io/component': 'database',
          'app.kubernetes.io/created-by': 'devdb-controller',
          'snapshot-timestamp': timestamp
        },
        annotations: {
          'devdb.io/creation-time': new Date().toISOString(),
          'devdb.io/backup-url': config.BACKUP_LOCATION_URL,
          'devdb.io/postgres-version': config.POSTGRES_VERSION
        }
      },
      spec: {
        source: {
          persistentVolumeClaimName: pvcName
        }
      }
    };
    await k8sCustomApi.createNamespacedCustomObject(
      'snapshot.storage.k8s.io',
      'v1',
      'default',
      'volumesnapshots',
      snapshotManifest
    );

    // Clean up
    await k8sApi.deleteNamespace(tempNamespace);

    res.json({ message: 'Database snapshot created successfully' });
  } catch (error) {
    console.error('Error creating database snapshot:', error);
    res.status(500).send('Error creating database snapshot');
  }
});

app.get("/snapshots", async (req: Request, res: Response) => {
  try {
    const response = await k8sCustomApi.listNamespacedCustomObject(
      'snapshot.storage.k8s.io',
      'v1',
      'default',
      'volumesnapshots'
    );
    
    const snapshots = response.body as VolumeSnapshotList;

    const snapshotList: SnapshotListItem[] = snapshots.items.map(snapshot => ({
      name: snapshot.metadata?.name,
      creationTime: snapshot.metadata?.annotations?.['devdb.io/creation-time'],
      postgresVersion: snapshot.metadata?.annotations?.['devdb.io/postgres-version'],
      backupUrl: snapshot.metadata?.annotations?.['devdb.io/backup-url'],
      status: snapshot.status?.readyToUse
    }));

    res.json(snapshotList);
  } catch (error) {
    console.error('Error listing snapshots:', error);
    res.status(500).send('Error listing snapshots');
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
