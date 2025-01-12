# DevDB CLI

A command-line interface for managing development databases. The CLI provides a user-friendly way to create and manage databases without requiring Kubernetes knowledge.

## Installation

```bash
# Build from source
make build
```

## Usage

### Configuration

```bash
# Set the API URL
devdb config set-api http://localhost:5000

# View current configuration
devdb config view
```

### Managing Projects

```bash
# Create a new project
devdb project create myproject --backup-location s3://my-bucket/backups

# List all projects
devdb project list

# Delete a project
devdb project delete myproject
```

### Managing Databases

```bash
# Create a database from backup
devdb db create mydb --from-backup s3://my-bucket/backup.dump

# Create a database in a project
devdb db create mydb --project myproject

# List all databases
devdb db list

# List databases in a project
devdb db list --project myproject

# Delete a database
devdb db delete mydb
```

## Development

The CLI is built using Go and follows an OpenAPI-first approach. The API client code is automatically generated from the OpenAPI specification.

### Prerequisites

- Go >= 1.21
- make
- [oapi-codegen](https://github.com/deepmap/oapi-codegen)

### Building

```bash
# Install the OpenAPI code generator
go install github.com/deepmap/oapi-codegen/cmd/oapi-codegen@latest

# Generate API client code, build the CLI, and run tests
make build
```

### OpenAPI Integration

The CLI uses `oapi-codegen` to generate type-safe client code from the OpenAPI specification in `api/openapi.yaml`. This ensures:

1. Type safety for API requests/responses
2. Automatic client code generation
3. Consistency with the API server

To update the generated client code:

```bash
# Generate client code only
make generate
```

### Testing

The CLI includes comprehensive tests for all commands. Tests use a mock HTTP server to simulate API responses.

```bash
# Run all tests
make test

# Run tests with verbose output
go test ./cmd/... -v

# Run specific test
go test ./cmd/... -run TestDatabaseCommands
```

The test suite includes:

1. **Command Tests**:
   - Tests for all CLI commands (create, list, delete)
   - Validation of command output formatting
   - Error handling and validation
   - Flag validation

2. **Mock HTTP Server**:
   - Simulates API responses
   - Tests both success and error cases
   - Verifies correct HTTP method and path handling

3. **Test Helpers**:
   - `cmdTestCase` struct for consistent test case definition
   - `executeCommand` helper for running commands
   - Proper cleanup of test resources

Example test output:
```
=== RUN   TestDatabaseCommands
=== RUN   TestDatabaseCommands/create_database_from_backup
=== RUN   TestDatabaseCommands/create_database_without_source
=== RUN   TestDatabaseCommands/list_databases
=== RUN   TestDatabaseCommands/delete_database
--- PASS: TestDatabaseCommands (0.15s)
    --- PASS: TestDatabaseCommands/create_database_from_backup (0.03s)
    --- PASS: TestDatabaseCommands/create_database_without_source (0.02s)
    --- PASS: TestDatabaseCommands/list_databases (0.05s)
    --- PASS: TestDatabaseCommands/delete_database (0.05s)
PASS
```

## Project Structure

```
cli/
├── api/
│   └── openapi.yaml    # OpenAPI specification
├── cmd/
│   ├── root.go         # Root command setup
│   ├── db.go          # Database commands
│   ├── project.go     # Project commands
│   └── config.go      # Configuration commands
├── pkg/
│   └── api/
│       ├── client.go   # Manual API client code
│       └── client_gen.go # Generated API client code
└── Makefile           # Build and development commands
```

## Contributing

1. Update the OpenAPI spec in `api/openapi.yaml`
2. Generate new client code: `make generate`
3. Update command implementations if needed
4. Add tests for new functionality
5. Run tests: `make test`
6. Submit a PR

## License

This project is licensed under the ISC License.
