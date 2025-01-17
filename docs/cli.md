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
devdb database create --project my-project --name test-db

# Get connection details
devdb database show --project my-project --name test-db

# Delete a database
devdb database delete --project my-project --name test-db
```