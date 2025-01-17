# DevDB - Development Database Manager

DevDB is a service that makes it easy to spin up development databases for your team. It allows you to create and manage databases from the command line. Perfect for development teams that need quick access to database instances.

## ⚙️ Prerequisites

Before installing DevDB, ensure you have the following:

### Required Tools
- Kubernetes cluster (1.29+)
- Helm 3.0+
- `kubectl` CLI configured with cluster access
- AWS CLI configured with appropriate credentials

### Kubernetes Requirements
1. **EBS CSI Driver**:
   ```bash
   # Install EBS CSI Driver
   helm repo add aws-ebs-csi-driver https://kubernetes-sigs.github.io/aws-ebs-csi-driver
   helm repo update
   helm upgrade --install aws-ebs-csi-driver \
     --namespace kube-system \
     aws-ebs-csi-driver/aws-ebs-csi-driver
   ```

2. **AWS Load Balancer Controller**:
   ```bash
   # Install AWS Load Balancer Controller
   helm repo add eks https://aws.github.io/eks-charts
   helm repo update
   helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
     --namespace kube-system \
     --set clusterName=your-cluster-name \
     --set serviceAccount.create=true \
     --set serviceAccount.name=aws-load-balancer-controller
   ```

### AWS Requirements
1. **IAM Role** with the following permissions:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "s3:PutObject",
           "s3:GetObject",
           "s3:ListBucket"
         ],
         "Resource": [
           "arn:aws:s3:::your-backup-bucket",
           "arn:aws:s3:::your-backup-bucket/*"
         ]
       },
       {
         "Effect": "Allow",
         "Action": [
           "ec2:CreateVolume",
           "ec2:DeleteVolume",
           "ec2:CreateSnapshot",
           "ec2:DeleteSnapshot",
           "ec2:DescribeVolumes",
           "ec2:DescribeSnapshots",
           "elasticloadbalancing:*",
           "ec2:DescribeInstances",
           "ec2:DescribeSubnets",
           "ec2:DescribeSecurityGroups",
           "ec2:DescribeVpcs"
         ],
         "Resource": "*"
       }
     ]
   }
   ```

2. **S3 Bucket** for storing database backups:
   - Create a bucket for storing backups
   - Enable versioning (recommended)
   - Configure lifecycle rules for backup retention (optional)

3. **VPC Configuration**:
   - Ensure nodes are in the correct subnets
   - Configure security groups to allow database traffic
   - Set up VPC endpoints for S3 and EBS if using private subnets

Note: The Helm chart will automatically set up all necessary Kubernetes resources including service accounts and RBAC permissions.

## 🚀 Getting Started

1. **Install DevDB**
```bash
# Add the DevDB Helm repository
helm repo add devdb https://meido-ai.github.io/devdb
helm repo update

# Install DevDB into your cluster
helm install devdb devdb/devdb \
  --create-namespace \
  --namespace devdb \
  --set aws.region=us-west-2 \
  --set aws.ebsEnabled=true
```

2. **Install the CLI**
```bash
# Download the latest release from GitHub
# For Windows:
curl -LO https://github.com/meido-ai/devdb/releases/latest/download/devdb-windows-amd64.exe
mv devdb-windows-amd64.exe devdb.exe
# Add to your PATH
```

3. **Configure the CLI**
```bash
# Get the API address
export DEVDB_API=$(kubectl get svc -n devdb devdb-api -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')

# Configure the CLI with the API address
devdb config set-server http://$DEVDB_API
```

4. **Create a Project**
```bash
# Create a new project with a backup location
devdb project create \
  --name my-project \
  --owner myteam \
  --backup-location s3://my-bucket/backups/latest.dump
```

5. **Create a Database**
```bash
# Create a new database instance for your project
devdb database create \
  --project my-project \
  --name dev-db
```

6. **Connect to Your Database**
```bash
# Get the connection details for your database
devdb database show --project my-project --name dev-db
```

That's it! Your database is now ready to use with your existing backup.

## 🔧 Advanced Setup

For advanced configuration options, you can customize the Helm installation:

```bash
helm install devdb devdb/devdb \
  --create-namespace \
  --namespace devdb \
  --set aws.region=us-west-2 \
  --set aws.ebsEnabled=true \
  --set api.logLevel=debug
```

### Available Configuration Options

| Parameter | Description | Default |
|-----------|-------------|---------|
| `aws.region` | AWS Region for S3 and EBS | `us-west-2` |
| `aws.ebsEnabled` | Enable EBS volume support | `true` |
| `api.logLevel` | API logging level | `info` |

### CLI Configuration

The CLI can be configured with various options:

```bash
# Set the API server address
devdb config set-server http://your-api-address

# View current configuration
devdb config view

# Set default project
devdb config set-default-project my-project
```

## 📖 Common Operations

### Project Management
```bash
# List projects
devdb project list

# Create a new project
devdb project create --name my-project --owner myteam

# Delete a project
devdb project delete my-project
```

### Database Management
```bash
# List databases in a project
devdb database list --project my-project

# Create a new database
devdb database create --project my-project --name dev-db

# Delete a database
devdb database delete --project my-project --name dev-db

# Get database connection details
devdb database show --project my-project --name dev-db
```

## 👩‍💻 Developer Guide

### API and Client Generation

The project uses an OpenAPI specification (`api/openapi/openapi.yaml`) as the source of truth for the API. When making changes to the API specification, you must regenerate both the TypeScript types and Go client code:

1. **Install Required Tools**
   ```bash
   # Install oapi-codegen for Go client generation
   go install github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@latest
   ```

2. **Generate TypeScript Types**
   ```bash
   # In the api directory
   cd api
   npm run generate:types
   ```

3. **Generate Go Client**
   ```bash
   # In the cli directory
   cd cli
   make generate
   ```

Always run both generation commands after modifying the OpenAPI specification to ensure consistency across the codebase.

### Development Setup

## 🚀 Advanced Configuration

### AWS EKS Optimizations

DevDB can be optimized for AWS EKS to improve performance and enable advanced features like volume snapshots. This configuration is optional but recommended for production environments.

#### EBS CSI Driver Installation

1. Install the EBS CSI Driver:
```bash
helm repo add aws-ebs-csi-driver https://kubernetes-sigs.github.io/aws-ebs-csi-driver
helm install aws-ebs-csi-driver aws-ebs-csi-driver/aws-ebs-csi-driver \
  --namespace kube-system \
  --set enableVolumeSnapshot=true \
  --set enableVolumeResizing=true \
  --set enableVolumeScheduling=true
```

2. Install Snapshot Controller and CRDs:
```bash
# Install Snapshot CRDs
kubectl apply -f https://raw.githubusercontent.com/kubernetes-csi/external-snapshotter/master/client/config/crd/snapshot.storage.k8s.io_volumesnapshotclasses.yaml
kubectl apply -f https://raw.githubusercontent.com/kubernetes-csi/external-snapshotter/master/client/config/crd/snapshot.storage.k8s.io_volumesnapshotcontents.yaml
kubectl apply -f https://raw.githubusercontent.com/kubernetes-csi/external-snapshotter/master/client/config/crd/snapshot.storage.k8s.io_volumesnapshots.yaml

# Install Snapshot Controller
kubectl apply -f https://raw.githubusercontent.com/kubernetes-csi/external-snapshotter/master/deploy/kubernetes/snapshot-controller/rbac-snapshot-controller.yaml
kubectl apply -f https://raw.githubusercontent.com/kubernetes-csi/external-snapshotter/master/deploy/kubernetes/snapshot-controller/setup-snapshot-controller.yaml
```

#### IAM Configuration

The EBS CSI Driver requires specific IAM permissions. Create an IAM role with the following policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ec2:CreateSnapshot",
        "ec2:DeleteSnapshot",
        "ec2:GetSnapshotState",
        "ec2:DescribeSnapshots",
        "ec2:ModifyVolume",
        "ec2:DescribeVolumes",
        "ec2:CreateVolume",
        "ec2:DeleteVolume",
        "ec2:DescribeVolumesModifications"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "kms:CreateGrant",
        "kms:ListGrants",
        "kms:RevokeGrant",
        "kms:Encrypt",
        "kms:Decrypt",
        "kms:ReEncrypt*",
        "kms:GenerateDataKey*",
        "kms:DescribeKey"
      ],
      "Resource": "*"
    }
  ]
}
```

#### Storage Configuration

DevDB includes optimized storage classes for AWS EBS:

1. **StorageClass** (for persistent volumes):
   - Uses GP3 volume type for better performance
   - Encryption enabled by default
   - 3000 IOPS for optimal database performance
   - WaitForFirstConsumer volume binding mode
   - Volume expansion enabled

2. **VolumeSnapshotClass** (for volume snapshots):
   - Fast snapshot creation and restoration
   - Encryption enabled
   - Automatic cleanup of old snapshots

These configurations are automatically applied when installing DevDB with the following Helm values:

```bash
helm install devdb devdb/devdb \
  --create-namespace \
  --namespace devdb \
  --set aws.ebs.enabled=true \
  --set aws.ebs.volumeType=gp3 \
  --set aws.ebs.iops=3000 \
  --set aws.ebs.encrypted=true
```
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