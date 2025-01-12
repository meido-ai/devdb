# DevDB - Quick Database Containers for Development

DevDB is a service that makes it easy to spin up development databases for your team. It allows you to create and manage databases from the command line. Perfect for development teams that need quick access to database instances.

## 🚀 Getting Started

DevDB offers two setup paths depending on your needs:
1. **Quick Setup**: If you already have database backups (pg_dump/mysqldump) stored in S3
2. **Advanced Setup**: If you want to create backups from your managed databases (like RDS)

### Quick Setup (Using Existing S3 Backups)

1. **Install DevDB**
```bash
# Add the Helm repository
helm repo add devdb https://charts.devdb.io
helm repo update

# Install DevDB pointing to your existing backup location
helm install devdb devdb/devdb \
  --namespace devdb \
  --create-namespace \
  --set s3.bucket=your-backup-bucket \
  --set s3.backupPath=path/to/your/backup.dump \
  --set aws.region=us-west-2
```

2. **Access Your Database**
```bash
# Get the database connection details
kubectl get svc -n devdb devdb-postgres -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'
```

That's it! Your database is now ready to use with your existing backup.

### Advanced Setup (Managed Database Support)

If you need to create backups from managed databases like RDS, follow these additional steps:

1. **Install DevDB**
```bash
# Add the Helm repository and install (same as Quick Setup)
helm repo add devdb https://charts.devdb.io
helm repo update

helm install devdb devdb/devdb \
  --namespace devdb \
  --create-namespace \
  --set s3.bucket=your-backup-bucket \
  --set aws.region=us-west-2
```

2. **Get the API Address**
```bash
# Get the API service URL
export DEVDB_API=$(kubectl get svc -n devdb devdb-api -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
echo "DevDB API is available at: http://$DEVDB_API"
```

3. **Register Your Primary Database**
```bash
# Register a primary database (e.g., your RDS instance)
curl -X POST "http://$DEVDB_API/primary-databases" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "main-postgres",
    "dbType": "postgres",
    "dbVersion": "14",
    "credentials": {
      "username": "devuser",
      "database": "mydb"
    }
  }'

# Note the database ID from the response
export DB_ID="database-id-from-response"
```

4. **Create Development Projects**
```bash
# Create a new project
curl -X POST "http://$DEVDB_API/projects" \
  -H "Content-Type: application/json" \
  -d '{
    "owner": "team1",
    "name": "myproject",
    "primaryDatabaseId": "'$DB_ID'"
  }'

# Note the project ID from the response
export PROJECT_ID="project-id-from-response"

# Create a database instance for your project
curl -X POST "http://$DEVDB_API/databases" \
  -H "Content-Type: application/json" \
  -d '{
    "owner": "team1",
    "project_id": "'$PROJECT_ID'"
  }'
```

5. **Create Database Backups**
```bash
# Create a backup of your database
curl -X POST "http://$DEVDB_API/projects/$PROJECT_ID/backup" \
  -H "Content-Type: application/json" \
  -d '{
    "connection": {
      "host": "your-db-host",
      "port": 5432,
      "username": "devuser",
      "database": "mydb"
    }
  }'
```

## 📖 Common Operations

- List primary databases: `GET /primary-databases`
- List development instances: `GET /databases`
- Delete an instance: `DELETE /databases/{name}`
- View project details: `GET /projects/{id}`

## 🔧 Requirements

- Kubernetes cluster (1.29+)
- Helm 3.0+
- AWS account with:
  - S3 bucket for backups
  - IAM permissions (see below)

### AWS IAM Permissions

The following IAM permissions are required:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "rds-db:connect",
                "rds:GenerateAuthenticationToken"
            ],
            "Resource": [
                "arn:aws:rds-db:region:account:dbuser:*/backup_user"
            ]
        },
        {
            "Effect": "Allow",
            "Action": [
                "s3:PutObject",
                "s3:GetObject",
                "s3:ListBucket"
            ],
            "Resource": [
                "arn:aws:s3:::devdb-backups",
                "arn:aws:s3:::devdb-backups/*"
            ]
        }
    ]
}
```

### Deployment Checklist

Before deploying the API, ensure the following requirements are met:

1. **VPC Configuration**:
   - API and RDS instances are in the same VPC, or
   - VPC peering is configured between API and RDS VPCs
   - VPC endpoints are configured if using AWS PrivateLink

2. **Security Groups**:
   - RDS security groups allow inbound traffic from API security group
   - Required ports (5432 for PostgreSQL, 3306 for MySQL) are open
   - Security group rules are configured for the correct CIDR ranges

3. **Network Configuration**:
   - Network ACLs allow traffic between API and RDS
   - Route tables are configured correctly
   - DNS resolution is working (if using custom DNS)

4. **IAM Configuration**:
   - API has IAM role with necessary permissions (see above)
   - RDS is configured for IAM authentication (if using IAM auth)
   - S3 bucket exists and is accessible

5. **Database Configuration**:
   - Database users are created with appropriate permissions
   - SSL/TLS is enabled (required for RDS)
   - Backup user has necessary privileges

6. **Monitoring**:
   - CloudWatch logging is enabled
   - Metrics collection is configured
   - Alerts are set up for backup failures

### Backup Management

The API automatically manages database backups in your configured S3 bucket. When you install DevDB, you specify a single S3 bucket that the service uses to organize all backups. The API:

1. Creates a structured backup hierarchy:
   ```
   your-backup-bucket/
   ├── primary-databases/
   │   └── main-postgres/
   │       └── backups/
   │           ├── 2025-01-03-083000.dump
   │           └── metadata.json
   └── projects/
       └── myproject/
           └── instances/
               └── dev-instance-1/
                   ├── backups/
                   │   └── 2025-01-03-084000.dump
                   └── metadata.json
   ```

2. Manages backup retention and cleanup
3. Handles backup restoration when creating new instances
4. Provides backup metadata for tracking and management

You don't need to manage backup locations or storage - the API handles all of this automatically based on your installation configuration.