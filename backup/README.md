# DevDB RDS Backup Function

This Lambda function creates pg_restore compatible backups from RDS instances and stores them in S3. The backups can be used by the DevDB system to initialize new database containers.

## VPC Configuration & Security

The Lambda function must be deployed in the same VPC as your RDS instances to access them. This is because:
1. RDS instances typically run in private subnets without public access
2. The Lambda function needs direct network access to the RDS instances to perform pg_dump
3. AWS requires VPC configuration to enable this network connectivity

Security requirements:
- VPC ID where your RDS instances are running
- At least two subnet IDs in that VPC (for high availability)
- The subnets must have NAT Gateway access to reach the internet (for S3 access)
- Security group rules that allow the Lambda function to connect to RDS on port 5432
- Database credentials are stored securely as Lambda environment variables
- Cross-region S3 access is handled automatically by the AWS SDK

## Deployment Steps

1. Install dependencies:
```bash
npm install
```

2. Build and package the Lambda function:
```bash
# Build TypeScript code
npm run build

# Create deployment package
npm run package
```

3. Find your RDS instance details:
```bash
# List RDS instances and their security groups
aws rds describe-db-instances \
  --query 'DBInstances[*].[DBInstanceIdentifier,join(`\n`, VpcSecurityGroups[*].VpcSecurityGroupId)]' \
  --output table
```

4. Deploy the CloudFormation stack:
```bash
# First, create an S3 bucket to store the Lambda function code
# This bucket must be in the same region where you'll deploy the Lambda
aws s3 mb s3://your-deployment-bucket --region your-region

# Upload the Lambda function code to S3
# The CloudFormation template will use this file to create the Lambda function
aws s3 cp function.zip s3://your-deployment-bucket/function.zip --region your-region

# Now deploy the CloudFormation stack
# This will create the Lambda function using the code from S3
aws cloudformation deploy \
  --template-file template.yaml \
  --stack-name devdb-prodau-backup \
  --region your-region \        # Region where Lambda will be deployed
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    VpcId=vpc-xxxxx \           # VPC where your RDS instances run
    SubnetIds=subnet-xxxxx,subnet-yyyyy \  # Private subnets with NAT Gateway access
    DbUser=your-rds-user \
    DbPassword=your-rds-password

# Note: Make sure the subnets you specify:
# - Are in the same VPC as your RDS instances
# - Have NAT Gateway access to reach S3
# - Are in at least two different Availability Zones
```

> [!NOTE]
> The deployment bucket above is only used to store the Lambda function code during deployment. It can be deleted after the Lambda is deployed if you won't be updating it.

5. Create backup storage bucket:
```bash
# Create an S3 bucket to store the database backups
# This can be in a different region than your Lambda/RDS
aws s3 mb s3://your-backup-bucket --region target-region

# Optional: Enable versioning for additional backup safety
aws s3api put-bucket-versioning \
  --bucket your-backup-bucket \
  --versioning-configuration Status=Enabled \
  --region target-region

# Optional: Configure lifecycle rules to move older backups to cheaper storage
aws s3api put-bucket-lifecycle-configuration \
  --bucket your-backup-bucket \
  --lifecycle-configuration file://lifecycle.json \
  --region target-region
```

Example lifecycle.json to move backups to cheaper storage after 30 days:
```json
{
  "Rules": [
    {
      "ID": "Move old backups to IA",
      "Status": "Enabled",
      "Filter": {
        "Prefix": "backups/"
      },
      "Transitions": [
        {
          "Days": 30,
          "StorageClass": "STANDARD_IA"
        }
      ]
    }
  ]
}
```

6. Configure RDS security group access:
```bash
# Get the Lambda function's security group ID
aws cloudformation describe-stacks \
  --stack-name devdb-prodau-backup \
  --query 'Stacks[0].Outputs[?OutputKey==`BackupLambdaSecurityGroupId`].OutputValue' \
  --output text

# Check existing RDS security group rules
aws ec2 describe-security-group-rules \
  --filters Name="group-id",Values="sg-YOUR_RDS_SG_ID" \
  --query 'SecurityGroupRules[?IsEgress==`false`]'

# Add inbound rule to allow Lambda access
aws ec2 authorize-security-group-ingress \
  --group-id sg-YOUR_RDS_SG_ID \
  --protocol tcp \
  --port 5432 \
  --source-group sg-LAMBDA_SG_ID  # Use the ID from the CloudFormation output
```

## Usage

Invoke the Lambda function with the following event structure:

```json
{
  "rdsInstance": "your-rds-instance-id",
  "sourceRegion": "us-west-2",
  "targetBucket": "your-backup-bucket",    # The bucket created in step 5
  "targetRegion": "us-east-1",             # The region where your backup bucket exists
  "targetKey": "optional/custom/path/backup.dump",
  "databaseName": "optional-database-name"  // If not provided, uses RDS instance's default database
}
```

The function will:
1. Connect to the RDS instance
2. Create a backup using pg_dump in custom format
3. Upload the backup to the specified S3 bucket and region

If no `databaseName` is provided, the function will use the RDS instance's default database name. If no `targetKey` is provided, the backup will be stored at `backups/<rds-instance>/<database-name>/<timestamp>.dump`.

The backup will be compatible with the DevDB restore process that uses pg_restore.

## Development

- `npm run watch` - Watch for changes during development
- `npm run lint` - Check code quality
- `npm test` - Run tests
- `npm run clean` - Clean build artifacts
