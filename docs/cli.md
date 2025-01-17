## 📖 Common Operations

### Context
```bash
# Configure the CLI
export DEVDB_API=$(kubectl get svc -n devdb devdb-api -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
devdb context use http://$DEVDB_API

# Set the DevDB server URL
devdb context use http://localhost:3000

# Display the current DevDB server
devdb context show
```

### Project Management
```bash
# List projects
devdb project list

# Create a new project
devdb project create --name my-project

# Set the project's database type and version
devdb project set --project my-project --type postgres --version 15.3

# Get the current project configuration
devdb project show --project my-project

# Delete a project
devdb project delete my-project
```

### Database Management
```bash
# List databases in a project
devdb database list --project my-project

# Create a new database
devdb database create --project my-project --name test-db

# Get connection details
devdb database show --project my-project --name test-db

# Delete a database
devdb database delete --project my-project --name test-db
```