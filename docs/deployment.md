# DevDB Deployment into AWS EKS

This guide provides detailed instructions for deploying DevDB in AWS EKS.

## Requirements

- Kubernetes cluster (1.29+)
- Helm 3.0+
- `kubectl` CLI configured with cluster access
- `aws` CLI
- `eksctl`

## EBS CSI Driver

For AWS installations, EBS is used as the default storage backend. To use EBS, follow these steps:

### Create the EBS CSI Driver IAM role

```bash
# Create EBS CSI Driver IAM role
eksctl create iamserviceaccount \
  --region="${AWS_REGION}" \
  --name="ebs-csi-controller-sa" \
  --namespace="kube-system" \
  --cluster="${CLUSTER_NAME}" \
  --role-name="${CLUSTER_NAME}-ebs-csi-driver-role" \
  --role-only \
  --attach-policy-arn="arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy" \
  --approve
```

### Deploy the EBS CSI Driver addon

```bash
eksctl create addon \
  --region="${AWS_REGION}" \
  --name="aws-ebs-csi-driver" \
  --cluster="${CLUSTER_NAME}" \
  --service-account-role-arn="arn:aws:iam::${AWS_ACCOUNT_ID}:role/${CLUSTER_NAME}-ebs-csi-driver-role" \
  --force
```

### Create the default storage class for EBS:

```bash
cat <<EOF | kubectl apply -f -
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ebs-sc
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: ebs.csi.aws.com
volumeBindingMode: WaitForFirstConsumer
EOF
```

## AWS Load Balancer Controller

The load balancer controller is used to provide external access to the DevDB API, databas pods, and manage certificates.

1. Download the IAM policy for the Load Balancer Controller:

```bash
curl \
  -s \
  -o iam-policy.json \
  https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/v2.7.1/docs/install/iam_policy.json
```

2. Create the IAM policy:

```bash
aws iam create-policy \
  --policy-name="${CLUSTER_NAME}-load-balancer-controller-policy" \
  --policy-document file://iam-policy.json
```

3. Create the service account and IAM role:

```bash
eksctl create iamserviceaccount \
  --region="${AWS_REGION}" \
  --name="aws-load-balancer-controller" \
  --namespace="kube-system" \
  --cluster="${CLUSTER_NAME}" \
  --role-name="${CLUSTER_NAME}-aws-load-balancer-controller-role" \
  --attach-policy-arn="arn:aws:iam::${AWS_ACCOUNT_ID}:policy/${CLUSTER_NAME}-load-balancer-controller-policy" \
  --approve
```

### Install the Load Balancer Controller:

```bash
# Add the EKS chart repository
helm repo add eks https://aws.github.io/eks-charts
helm repo update

# Install the controller
helm upgrade --install \
  aws-load-balancer-controller \
  eks/aws-load-balancer-controller \
  --version="1.7.1" \
  --namespace="kube-system" \
  --set clusterName=${CLUSTER_NAME} \
  --set serviceAccount.create=false \
  --set serviceAccount.name=aws-load-balancer-controller
```

> [!NOTE]
> Before running these commands, ensure you have set the following environment variables:
> - `AWS_REGION`: Your AWS region
> - `CLUSTER_NAME`: Your EKS cluster name
> - `AWS_ACCOUNT_ID`: Your AWS account ID

## DevDB IAM Configuration

DevDB requires specific IAM permissions to manage database volumes and backups efficiently. These permissions enable two key features:
1. Initial databases are created from backup files in S3. DevDB needs access to the S3 buckets to download and create the primary database for a project.
2. Volume snapshots for faster database spin-up times. DevDB uses snapshots to create pre-configured database volumes, significantly reducing the time needed to spin up new database instances.

### Create the S3 Access Policy

Create a policy for S3 access:

```bash
cat <<EOF > devdb-s3-policy.json
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
        "arn:aws:s3:::${BACKUP_BUCKET_NAME}",
        "arn:aws:s3:::${BACKUP_BUCKET_NAME}/*"
      ]
    }
  ]
}
EOF

aws iam create-policy \
  --policy-name="${CLUSTER_NAME}-devdb-s3-policy" \
  --policy-document file://devdb-s3-policy.json
```

### Create the Volume Management Policy

Create a policy for managing EBS volumes and snapshots. These permissions are essential for DevDB's performance optimization - it uses volume snapshots to create pre-configured database volumes, significantly reducing the time needed to spin up new database instances.

```bash
cat <<EOF > devdb-volume-policy.json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ec2:CreateVolume",
        "ec2:DeleteVolume",
        "ec2:CreateSnapshot",
        "ec2:DeleteSnapshot",
        "ec2:DescribeVolumes",
        "ec2:DescribeSnapshots",
        "ec2:DescribeInstances",
        "ec2:DescribeSubnets",
        "ec2:DescribeSecurityGroups",
        "ec2:DescribeVpcs"
      ],
      "Resource": "*"
    }
  ]
}
EOF

aws iam create-policy \
  --policy-name="${CLUSTER_NAME}-devdb-volume-policy" \
  --policy-document file://devdb-volume-policy.json
```

### Create the Service Account

Create a service account for DevDB that combines both policies:

```bash
eksctl create iamserviceaccount \
  --region="${AWS_REGION}" \
  --name="devdb-controller" \
  --namespace="devdb-system" \
  --cluster="${CLUSTER_NAME}" \
  --role-name="${CLUSTER_NAME}-devdb-controller-role" \
  --attach-policy-arn="arn:aws:iam::${AWS_ACCOUNT_ID}:policy/${CLUSTER_NAME}-devdb-s3-policy" \
  --attach-policy-arn="arn:aws:iam::${AWS_ACCOUNT_ID}:policy/${CLUSTER_NAME}-devdb-volume-policy" \
  --approve
```

> [!NOTE]
> Make sure to set the `BACKUP_BUCKET_NAME` environment variable to your S3 bucket name before running these commands.

### Installation

After setting up the prerequisites, you can install DevDB using Helm:

```bash
helm install devdb devdb/devdb \
  --create-namespace \
  --namespace devdb \
  --set aws.region=us-west-2
```
