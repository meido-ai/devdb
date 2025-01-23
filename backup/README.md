# DevDB RDS Backup Function

This Lambda function creates pg_restore compatible backups from RDS instances and stores them in S3. The backups can be used by the DevDB system to initialize new database containers.

## Setup

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

3. Deploy using AWS CLI:
```bash
# Create deployment bucket if needed
aws s3 mb s3://your-deployment-bucket

# Upload the Lambda package
aws s3 cp function.zip s3://your-deployment-bucket/

# Deploy the stack
aws cloudformation deploy \
  --template-file template.yaml \
  --stack-name devdb-backup \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    VpcId=vpc-xxxxx \
    SubnetIds=subnet-xxxxx,subnet-yyyyy \
    DB_USER=your-rds-user \
    DB_PASSWORD=your-rds-password
```

## Usage

Invoke the Lambda function with the following event structure:

```json
{
  "rdsInstance": "your-rds-instance-id",
  "sourceRegion": "us-west-2",
  "targetBucket": "your-backup-bucket",
  "targetRegion": "us-east-1",
  "targetKey": "optional/custom/path/backup.dump"
}
```

The function will:
1. Connect to the RDS instance
2. Create a backup using pg_dump in custom format
3. Upload the backup to the specified S3 bucket and region

The backup will be compatible with the DevDB restore process that uses pg_restore.

## Security Notes

- The Lambda function requires VPC access to reach the RDS instance
- Database credentials are stored as Lambda environment variables
- Cross-region S3 access is handled automatically
- Make sure the RDS security group allows access from the Lambda security group
