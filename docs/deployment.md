# DevDB Deployment into AWS EKS

This guide provides detailed instructions for deploying DevDB in AWS EKS.

## Requirements

- Kubernetes cluster (1.29+)
- Helm 3.0+
- `kubectl`
- `aws`
- `eksctl`
- An existing AWS Identity and Access Management (IAM) OpenID Connect (OIDC) provider for your cluster.

## Installation

From a high level perspective, there are only a handful of components needed to run DevDB in AWS:

1. A load balancer to expose the application and database pods to the public internet.
2. A storage backend for database data
3. A wildcard DNS name and corresponding certificate

The tools described below are not the only options for satisfying these requirements, but are the most straightforward and recommended.

### Load Balancer: AWS Load Balancer Controller

A load balancer is needed to provide external access to the DevDB API, database pods, and manage certificates. You may already have a load balancer in place, in which case you can skip this step. If not, we recommend following these steps to install the AWS Load Balancer Controller.

#### Download the IAM policy for the Load Balancer Controller:

```bash
curl -O https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/v2.11.0/docs/install/iam_policy.json
```

#### Create an IAM policy using the policy downloaded in the previous step.

```bash
aws iam create-policy \
  --policy-name="${CLUSTER_NAME}-load-balancer-controller-policy" \
  --policy-document file://iam-policy.json
```

> [!NOTE]
> You only need to create an IAM Role for the AWS Load Balancer Controller once per AWS account. Check if `AmazonEKSLoadBalancerControllerRole` exists.

#### Checking Existing Load Balancer Controller Installation

Before proceeding with the installation, you can check if the AWS Load Balancer Controller is already installed:

```bash
# Check if the controller deployment exists
kubectl get deployment -n kube-system aws-load-balancer-controller

# Check the controller pods
kubectl get pods -n kube-system -l app.kubernetes.io/name=aws-load-balancer-controller
```

To identify the IAM role being used by the controller:

```bash
# Get the service account details
kubectl get serviceaccount aws-load-balancer-controller -n kube-system -o yaml

# This will show the annotations including the IAM role ARN:
# annotations:
#   eks.amazonaws.com/role-arn: arn:aws:iam::<AWS_ACCOUNT_ID>:role/<ROLE_NAME>
```

If the controller is already installed and working, you can skip the installation steps below.

#### Create the service account and IAM role.

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

#### Install the Load Balancer Controller

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

### Database Storage: EBS CSI Driver

Each database container mounts a volume to store its data. For AWS installations, EBS is used as the default storage backend and the [EBS CSI driver](https://docs.aws.amazon.com/eks/latest/userguide/ebs-csi.html) is required for EBS volumes to work with Kubernetes.

> [!IMPORTANT]
> The EBS CSI Driver is typically managed by EKS as an addon. DevDB assumes the driver and its associated IAM roles are already set up by the cluster administrator. The chart will NOT attempt to create or manage these resources.

#### Checking Existing EBS CSI Driver Installation

Before proceeding with the installation, check if the EBS CSI Driver is already installed:

```bash
# Check if the EBS CSI Driver addon exists
eksctl get addon --cluster="${CLUSTER_NAME}" --region="${AWS_REGION}" | grep aws-ebs-csi-driver

# Check if the controller deployment exists
kubectl get deployment ebs-csi-controller -n kube-system

# Check the controller pods
kubectl get pods -n kube-system -l app.kubernetes.io/name=aws-ebs-csi-driver
```

To identify the IAM role being used by the driver:

```bash
# Get the service account details
kubectl get serviceaccount ebs-csi-controller-sa -n kube-system -o yaml

# This will show the annotations including the IAM role ARN:
# annotations:
#   eks.amazonaws.com/role-arn: arn:aws:iam::<AWS_ACCOUNT_ID>:role/<CLUSTER_NAME>-ebs-csi-driver-role
```

You can also verify if the EBS storage class is already configured:

```bash
kubectl get storageclass ebs-sc
```

#### Volume Snapshots (Optional)

DevDB supports volume snapshots for database backups. This feature is disabled by default and requires additional setup:

1. Install the Snapshot Controller and CRDs:
```bash
# Install CRDs
kubectl apply -f https://raw.githubusercontent.com/kubernetes-csi/external-snapshotter/master/client/config/crd/snapshot.storage.k8s.io_volumesnapshotclasses.yaml
kubectl apply -f https://raw.githubusercontent.com/kubernetes-csi/external-snapshotter/master/client/config/crd/snapshot.storage.k8s.io_volumesnapshotcontents.yaml
kubectl apply -f https://raw.githubusercontent.com/kubernetes-csi/external-snapshotter/master/client/config/crd/snapshot.storage.k8s.io_volumesnapshots.yaml

# Install snapshot controller
kubectl apply -f https://raw.githubusercontent.com/kubernetes-csi/external-snapshotter/master/deploy/kubernetes/snapshot-controller/rbac-snapshot-controller.yaml
kubectl apply -f https://raw.githubusercontent.com/kubernetes-csi/external-snapshotter/master/deploy/kubernetes/snapshot-controller/setup-snapshot-controller.yaml
```

2. Install the AWS IAM Controller (if not already installed):
```bash
helm repo add eks https://aws.github.io/eks-charts
helm install aws-iam-controller eks/aws-iam-controller \
  --namespace kube-system
```

3. Enable snapshots in DevDB's values.yaml:
```yaml
aws:
  ebs:
    snapshots:
      enabled: true
```

When snapshots are enabled, DevDB will create an IAM policy with the necessary permissions for the EBS CSI Driver to manage snapshots.

> [!NOTE]
> If you're installing DevDB without snapshots, you can skip these steps. You can always enable snapshots later by following these steps and upgrading your DevDB installation.

#### If EBS CSI Driver is Not Installed

If the EBS CSI Driver is not installed in your cluster, follow these steps:
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

```bash
eksctl create addon \
  --region="${AWS_REGION}" \
  --name="aws-ebs-csi-driver" \
  --cluster="${CLUSTER_NAME}" \
  --service-account-role-arn="arn:aws:iam::${AWS_ACCOUNT_ID}:role/${CLUSTER_NAME}-ebs-csi-driver-role" \
  --force
```

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

### SSL/TLS Certificates: AWS Certificate Manager (ACM)

DevDB will automatically create SSL endpoints for every development database created. Each endpoint is given a unique name based on a combination of the name of the user, the database type, and the delegated zone (aka subdomain). For example, a Postgres 13 development database created by Tim within the `devdb.example.com` subdomain will have an endpoint named `tim-pg-13.devdb.example.com`.

SSL/TLS certificates for these endpoints can be managed by AWS and AWS Certificate Manager (ACM) provides an easy way to provision and manage certificates.

#### Prerequisites

- AWS CLI configured with appropriate permissions
- A domain name registered in Route 53 (or another DNS provider)
- AWS Load Balancer Controller installed (see section above)

#### Set up Environment Variables

```bash
# Your DevDB domain
export DEVDB_DOMAIN="devdb.yourdomain.com"

# AWS Region where you're deploying
export AWS_REGION="$(aws configure get region)"

# Disable AWS CLI pagination (optional)
export AWS_PAGER=""
```

#### Request a Certificate

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

#### Configure DNS Validation

1. Get the DNS validation records:

```bash
aws acm describe-certificate \
  --certificate-arn="${CERTIFICATE_ARN}" \
  --region="${AWS_REGION}"
```

The command will return output similar to this:

```yaml
{
    "Certificate": {
        "CertificateArn": "arn:aws:acm:region:account:certificate/12345678-1234-1234-1234-123456789012",
        "DomainName": "*.devdb.yourdomain.com",
        "DomainValidationOptions": [
            {
                "DomainName": "*.devdb.yourdomain.com",
                "ValidationDomain": "devdb.yourdomain.com",
                "ValidationStatus": "PENDING_VALIDATION",
                "ResourceRecord": {
                    "Name": "_a79865eb4cd1a6ab43_acm-validations.devdb.yourdomain.com",
                    "Type": "CNAME",
                    "Value": "_a79865eb4cd1a6ab43.acm-validations.aws"
                }
            }
        ]
    }
}
```

Look for these specific values in the output:
- `Certificate.DomainValidationOptions[0].ResourceRecord.Name` - Use this as the `Name` in validation-records.json
- `Certificate.DomainValidationOptions[0].ResourceRecord.Value` - Use this as the `Value` in validation-records.json

2. Create a file named `validation-records.json` with the following content, replacing the example values with those from your certificate:

```bash
cat <<EOF > validation-records.json
{
  "Changes": [
    {
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "_a79865eb4cd1a6ab43_acm-validations.devdb.yourdomain.com",
        "Type": "CNAME",
        "TTL": 300,
        "ResourceRecords": [
          {
            "Value": "_a79865eb4cd1a6ab43.acm-validations.aws"
          }
        ]
      }
    }
  ]
}
EOF
```

3. Create the validation record:

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

Once the validation record is created, check the validation status using:

```bash
aws acm describe-certificate \
  --certificate-arn="${CERTIFICATE_ARN}" \
  --region="${AWS_REGION}" \
  --query 'Certificate.DomainValidationOptions[0].ValidationStatus'
```

The validation may complete within a few seconds. However, if the status shows as `PENDING_VALIDATION`:
1. Verify the CNAME record was created correctly in Route 53:
   ```bash
   aws route53 list-resource-record-sets \
     --hosted-zone-id="${HOSTED_ZONE_ID}" \
     --query "ResourceRecordSets[?Type=='CNAME']"
   ```
2. Confirm the `Name` and `Value` in your Route 53 record exactly match the values from ACM
3. Wait a few more minutes - DNS propagation and ACM validation can sometimes take up to 30 minutes

#### Update DevDB Helm Values

Once your certificate is validated, update your Helm values to use the ACM certificate:

```yaml
ingress:
  annotations:
    alb.ingress.kubernetes.io/certificate-arn: ${CERTIFICATE_ARN}
    alb.ingress.kubernetes.io/ssl-policy: ELBSecurityPolicy-TLS-1-2-2017-01
    alb.ingress.kubernetes.io/listen-ports: '[{"HTTP": 80}, {"HTTPS": 443}]'
    alb.ingress.kubernetes.io/ssl-redirect: "443"
```

### Enabling Volume Snapshots

When available, DevDB uses [Volume Snapshots](https://kubernetes.io/docs/concepts/storage/volume-snapshots/) to create pre-configured database volumes, significantly reducing the time needed to spin up new database instances. This requires specific IAM permissions to allow DevDB to manage database volumes efficiently.

#### Create the Volume Management Policy

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

#### Create the Service Account

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

### Installation using Helm

After setting up the prerequisites and adjusting the Helm values, you can install DevDB using Helm:

```bash
helm repo add devdb https://meido-ai.github.io/devdb
helm repo update

helm upgrade --install \
  devdb devdb/devdb \
  --namespace devdb \
  -f values.yaml
```
