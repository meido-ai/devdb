import express, { Request, Response } from "express";
import cors from "cors";
import bodyParser from "body-parser";
import * as k8s from "@kubernetes/client-node";
import { releaseHeader } from './middleware/releaseHeader';

import * as dotenv from "dotenv";
dotenv.config();
const { POSTGRES_IMAGE, POSTGRES_DB, POSTGRES_USER, 
  POSTGRES_PASSWORD, RESTORE_FROM_BACKUP } = process.env;

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
 *               - backup_location
 *             properties:
 *               owner:
 *                 type: string
 *               db_type:
 *                 type: string
 *               name:
 *                 type: string
 *               project_id:
 *                 type: string
 *               backup_location:
 *                 type: string
 *     responses:
 *       200:
 *         description: Database created successfully
 *       400:
 *         description: Invalid input parameters
 *       500:
 *         description: Server error
 */
app.post("/databases", async (req, res) => {
  const owner = req.body.owner;
  const type = req.body.db_type;
  const namespaceName = req.body.name;
  const backupLocationUrl = req.body.backup_location;
  const projectId = req.body.project_id.toString();

  if (!owner || !type || !namespaceName || !projectId || !backupLocationUrl) {
    return res
      .status(400)
      .send("Missing required fields: owner, name, db_type, project_id");
  }

  if (type !== "postgres") {
    return res.status(400).send("Invalid db_type. Only 'postgres' is supported");
  }

  if (!validateURL(backupLocationUrl)) {
    return res.status(400).send("Invalid backup_location");
  }

  if (!POSTGRES_IMAGE || !POSTGRES_DB || !POSTGRES_USER || !POSTGRES_PASSWORD) {
    return res.status(500).send("Missing required environment variables");
  }

  const isAccessible = await verifyURL(backupLocationUrl);
  
  if (!isAccessible) { 
    return res.status(404).send("backup_location is not accessible");
  }

  
  const uniqueId = namespaceName.split("-").pop();
  const podName = `${type}-${uniqueId}`;

  try {
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

    const podManifest: k8s.V1Pod = {
      apiVersion: "v1",
      kind: "Pod",
      metadata: {
        name: podName,
        namespace: namespaceName,
        labels: {
          app: "postgres",
        },
      },
      spec: {
        containers: [
          {
            name: "postgres",
            image: POSTGRES_IMAGE,
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
                value: backupLocationUrl,
              },
              {
                name: "RESTORE_FROM_BACKUP",
                value: RESTORE_FROM_BACKUP,
              },
            ],
          },
        ],
      },
    };

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
  } catch (error) {
    console.error(error);
    res.status(500).send("Error creating namespace with pod.");
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

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
