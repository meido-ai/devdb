# Development Database API

This is an API that exposes containerized databases running in a Kubernetes cluter. The API can be used to list, create, and delete containerized PostgreSQL databases from data snapshots (stored in blob storage).

When the new database endpoint is called, the API creates a new namespace within the cluster and starts a pod containing a PostgreSQL container. Data is restored into the database when the pod starts and a load balancer is created to make the database publicly accessible.

## Kubernetes deployment

Deployments are done manually via Helm.

The DevDB API deployment is run with service account `devdb` which bound to a cluster role `devdb-role`. This cluster role has permissions to issue operations like get, list, etc., on Kubernetes resources like pods, namespaces, and services. 

## Updates to DevDB API

Container images for the API are stored in Docker Hub and new images are built and pushed when changes are made to the `/api` directory.


## Database image

Containerized databases are launched from a Postgres base image defined in `/postgres-db`.

