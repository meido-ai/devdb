# DevDB Deployment into AWS EKS

This guide provides detailed instructions for deploying DevDB in AWS EKS.

## Requirements

- Kubernetes cluster (1.29+)
- Helm 3.0+
- `kubectl` CLI configured with cluster access
- `aws` CLI
- `eksctl`
- An existing AWS Identity and Access Management (IAM) OpenID Connect (OIDC) provider for your cluster.

## EBS CSI Driver

Each database container mounts a volume to store its data. For AWS installations, EBS is used as the default storage backend. The EBS CSI driver is required for EBS volumes to work with Kubernetes.

### Create the EBS CSI Driver IAM role

```bash
# Create EBS CSI Driver IAM role
eksctl create iamserviceaccount \
  --name="ebs-csi-controller-sa" \
  --namespace="kube-system" \
  --cluster="${CLUSTER_NAME}" \
  --role-name="${CLUSTER_NAME}-ebs-csi-driver-role" \
  --role-only \
  --region="${AWS_REGION}" \
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

The load balancer controller is used to provide external access to the DevDB API, database pods, and manage certificates.

### 1. Download the IAM policy for the Load Balancer Controller:

```bash
curl -O https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/v2.11.0/docs/install/iam_policy.json
```

### 2. Create an IAM policy using the policy downloaded in the previous step.

```bash
aws iam create-policy \
  --policy-name="${CLUSTER_NAME}-load-balancer-controller-policy" \
  --policy-document file://iam-policy.json
```

> [!NOTE]
> You only need to create an IAM Role for the AWS Load Balancer Controller once per AWS account. Check if `AmazonEKSLoadBalancerControllerRole` exists.

### 3. Create the service account and IAM role.

```bash
eksctl create iamserviceaccount \
  --cluster=$CLUSTER_NAME \
  --namespace=kube-system \
  --name=aws-load-balancer-controller \
  --region=$AWS_REGION \
  --role-name=AmazonEKSLoadBalancerControllerRole \
  --attach-policy-arn="arn:aws:iam::${AWS_ACCOUNT_ID}:policy/AWSLoadBalancerControllerIAMPolicy" \
  --approve
```

### 4. Install the Load Balancer Controller

```bash
# Add the EKS chart repository
helm repo add eks https://aws.github.io/eks-charts
helm repo update eks

# Install the controller
helm upgrade --install \
  aws-load-balancer-controller \
  eks/aws-load-balancer-controller \
  --namespace=kube-system \
  --set clusterName=$CLUSTER_NAME \
  --set serviceAccount.create=false \
  --set serviceAccount.name=aws-load-balancer-controller
```

> [!NOTE]
> Before running these commands, ensure you have set the following environment variables:
> - `AWS_REGION`: Your AWS region
> - `CLUSTER_NAME`: Your EKS cluster name
> - `AWS_ACCOUNT_ID`: Your AWS account ID

## SSL/TLS Certificates with AWS Certificate Manager (ACM)

For production deployments, you'll want to secure your DevDB API and database endpoints with SSL/TLS certificates. AWS Certificate Manager (ACM) provides an easy way to provision and manage certificates.

### Prerequisites

- AWS CLI configured with appropriate permissions
- A domain name registered in Route 53 (or another DNS provider)
- AWS Load Balancer Controller installed (see section above)

### Set up Environment Variables

```bash
# Your DevDB domain
export DEVDB_DOMAIN="devdb.yourdomain.com"

# AWS Region where you're deploying
export AWS_REGION="$(aws configure get region)"

# Disable AWS CLI pagination (optional)
export AWS_PAGER=""
```

### Request a Certificate

Request a wildcard certificate that covers your DevDB domain and subdomains:

```bash
aws acm request-certificate \
  --domain-name="*.${DEVDB_DOMAIN}" \
  --validation-method="DNS" \
  --region="${AWS_REGION}"
```

Take note of the `CertificateArn` from the output:

```bash
export CERTIFICATE_ARN="arn:aws:acm:region:account:certificate/certificate-id"
```

### Configure DNS Validation

1. Get the DNS validation records:

```bash
aws acm describe-certificate \
  --certificate-arn="${CERTIFICATE_ARN}" \
  --region="${AWS_REGION}"
```

2. Create the validation CNAME records in your DNS. If using Route 53:

```bash
# Get your hosted zone ID
export HOSTED_ZONE_ID=$(aws route53 list-hosted-zones-by-name \
  --dns-name="${DEVDB_DOMAIN}" \
  --query="HostedZones[0].Id" \
  --output text)

# Create the validation record
aws route53 change-resource-record-sets \
  --hosted-zone-id="${HOSTED_ZONE_ID}" \
  --change-batch file://validation-records.json
```

### Update DevDB Helm Values

Once your certificate is validated, update your Helm values to use the ACM certificate:

```yaml
ingress:
  annotations:
    alb.ingress.kubernetes.io/certificate-arn: ${CERTIFICATE_ARN}
    alb.ingress.kubernetes.io/ssl-policy: ELBSecurityPolicy-TLS-1-2-2017-01
    alb.ingress.kubernetes.io/listen-ports: '[{"HTTP": 80}, {"HTTPS": 443}]'
    alb.ingress.kubernetes.io/ssl-redirect: "443"
```

## Enabling Volume Snapshots

When available, DevDB uses [Volume Snapshots](https://kubernetes.io/docs/concepts/storage/volume-snapshots/) to create pre-configured database volumes, significantly reducing the time needed to spin up new database instances. This requires specific IAM permissions to allow DevDB to manage database volumes efficiently.

### Create the Volume Management Policy

Create a policy for managing EBS volumes and snapshots:

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

This step creates an IAM-integrated service account that allows the DevDB API to securely interact with AWS services (in this case, EBS volumes and snapshots). This integration uses AWS IAM Roles for Service Accounts (IRSA), which provides fine-grained access control for pods running in your EKS cluster.

```bash
eksctl create iamserviceaccount \
  --region="${AWS_REGION}" \
  --name="devdb" \
  --namespace="devdb" \
  --cluster="${CLUSTER_NAME}" \
  --role-name="${CLUSTER_NAME}-devdb-role" \
  --attach-policy-arn="arn:aws:iam::${AWS_ACCOUNT_ID}:policy/${CLUSTER_NAME}-devdb-volume-policy" \
  --approve
```

The service account will be used by the DevDB API deployment to manage EBS volumes and snapshots for database instances.

## Installation using Helm

After setting up the prerequisites and adjusting the Helm values, you can install DevDB using Helm:

```bash
helm upgrade --install \
  devdb devdb/devdb \
  --namespace devdb \
  -f values.yaml
```
