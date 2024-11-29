# Development Database API

This is an API that exposes containerized databases running in a Kubernetes cluter. The API can be used to list, create, and delete containerized PostgreSQL databases from data snapshots (stored in blob storage).

The `pvcy/analyzer-app` provides the UI for this API.

When the new database endpoint is called, the API creates a new namespace within the cluster and starts a pod containing a PostgreSQL container. Data is restored into the database when the pod starts and a load balancer is created to make the database publicly accessible.

## Kubernetes deployment

The DevDB API is deployed in the `devdb` namespace of the QA Cloud Prem Cluster (`arn:aws:eks:us-west-1:827076270689:cluster/qa`) in the [AWS Dev account](https://github.com/pvcy/infrastructure). 
The DevDB API service is available at http://k8s-ingressn-ingressn-2bbc2f6f53-6dec9c7fd18d4c9b.elb.us-west-1.amazonaws.com.

Deployments are done manually, i.e., there is no automated deployment mechanism. The running API image can be updated with `kubectl apply -f kubernetes/deployment.yaml -n devdb`.

The DevDB API deployment is run with service account `devdb` which bound to a cluster role `devdb-role`. This cluster role has permissions to issue operations like get, list, etc., on Kubernetes resources like pods, namespaces, and services. 

## Updates to DevDB API

Container images for the API are stored in ECR and new images are built and pushed when changes are made to the `/api` directory. The images are stored in the `database-migration-anonymized` repositories in the `us-west-1` region.


## Database image

Containerized databases are launched from a Postgres base image defined in `/postgres-db`.

## Data snapshots

The client specifies where data backups should be pulled from when new containers are created. The API uses the parameter `backup_location` in the `POST` request to source the seed data and it expects the backup data to be publicly available. An example request payload with `backup_location` is below.

```json
{
  "project_id": "03724cc6-e082-4ac9-839c-930e181a41c4",
  "owner": "john",
  "name": "john-postgres-47ee4273",
  "db_type": "postgres",
  "backup_location": "https://storage.googleapis.com/db-backups/backup.sql"
}
```