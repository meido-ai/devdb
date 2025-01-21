# Architecture

DevDB makes it possible for engineers to develop locally but use databases in cloud. All the benefits of developing locally with databases that contain up-to-date data. it's like using a cloud-based development environment, but without all the overhead and complexity of setting up CDEs. DevDB runs the application database in the cloud while everything else runs locally.

DevDB starts up database containers for each developers to use. The databases are isolated from one another and can be used concurrently. Each engineer has their own database instance and they can be easily created and destroyed which is great if you need to start over from scratch with your data. By running databases in containers, DevDB is more efficient and cost effective than running multple managed databases in the cloud (e.g. AWS RDS).

This is an application that runs in a namepsace in a kubernetes cluster and creates database containers for engineers to use. when developing a new feature or fixing a bug, a new container is created and deployed to the cluster. only postgres is supported for now. the api creates pods for the database containers dynamically and deploys them to the cluster. when the first database container for an associated project is created, the api pulls a database backup from object storage and uses it to restore the database so it has data. once the restore script completes, the database container stores its data in a persistent volume. the persisten volume is capabale of creating volume snapshots that can be used by other database instances to restore their data, improving performance.

## Getting started

The simplest and easiest way to use the software is to

1. install the helm chart from devdb/devdb. This will create a namespace called devdb and install the api into it.
2. determine the address of the api service and set the server address in the cli
3. use the cli to create a new project giving it a name and the address of the pg_dump file
4. use the cli to create a new database for the project that was created in the previous step. when the database is created, the cli will display the connection details for the database 

## How it works

There is a single API responsible for managing the database containers. The API code resides in the api directory which provides API endpoints to create new databases from projects. Projects define the database type and version and the source data to use. Theh database containers store their data in persistent volumes so the data can survive pod restarts. The persisten volumes are also used to create volume snapshots which can be used by other database containers to restore their data.

A load balancer is shared between the API and all of the database containers.

DNS records are created for all of the database containers using a whildcard. For example, if the hostname devdb.example.com is created, databases will be available at davd-pg.devdb.example.com, kate-pg.devdb.example.com, etc.

## Network Architecture

### Load Balancer Strategy

DevDB uses a dual Network Load Balancer (NLB) setup to handle external traffic:

1. **API Load Balancer** (`<release-name>-nlb`):
   - Handles all HTTP/HTTPS traffic to the API service
   - Ports:
     - 80: HTTP traffic
     - 443: HTTPS traffic (when SSL cert is configured)
   - Routes traffic only to pods with `app.kubernetes.io/component: api` label
   - Supports SSL termination for HTTPS traffic

2. **Database Load Balancer** (`<release-name>-db-nlb`):
   - Handles all PostgreSQL traffic to database instances
   - Ports:
     - 5432: PostgreSQL traffic
   - Routes traffic only to pods with `app.kubernetes.io/component: database` label
   - Supports SSL for encrypted database connections

This split architecture provides several benefits:
- **Independent Scaling**: Each NLB can be scaled and configured independently
- **Simplified Security**: Separate security groups and SSL certificates for API and database traffic
- **Traffic Isolation**: API traffic cannot interfere with database connections
- **Protocol Optimization**: Each NLB can be optimized for its specific protocol (HTTP vs PostgreSQL)

### Internal Services

All services within the cluster use ClusterIP for internal communication:

1. **API Service** (`devdb-api`):
   - Internal service for API pods
   - Accessed externally through the API NLB
   - Port 5000

2. **Database Services**:
   - Each database instance gets its own ClusterIP service
   - Accessed externally through the Database NLB
   - Port 5432

3. **Redis Service** (`devdb-redis`):
   - Internal-only ClusterIP service
   - Used exclusively by the API for metadata storage
   - Not exposed externally
   - Port 6379

### SSL/TLS Configuration

SSL/TLS can be configured independently for each NLB through the values.yaml file:

```yaml
loadBalancer:
  api:
    annotations:
      service.beta.kubernetes.io/aws-load-balancer-ssl-cert: "arn:aws:acm:region:account:certificate/api-cert"
      service.beta.kubernetes.io/aws-load-balancer-ssl-ports: "443"
  database:
    annotations:
      service.beta.kubernetes.io/aws-load-balancer-ssl-cert: "arn:aws:acm:region:account:certificate/db-cert"
      service.beta.kubernetes.io/aws-load-balancer-ssl-ports: "5432"
```

### DNS Configuration

When using both NLBs:
- API endpoints are available at the API NLB DNS (e.g., `api.devdb.example.com`)
- Database instances are available at the Database NLB DNS with instance-specific ports
- DNS records should be created using a wildcard pattern (e.g., `*.db.devdb.example.com`)

### Security Considerations

1. **Network Isolation**:
   - Redis is completely internal and not exposed
   - API and database traffic are physically separated at the load balancer level
   - Each service type has its own selector labels

2. **Access Control**:
   - API NLB handles public web traffic
   - Database NLB should be restricted to known IP ranges
   - Internal services are only accessible within the cluster