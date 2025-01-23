# DevDB CLI

Command-line interface for managing development databases.

## Installation

```bash
go install github.com/meido-ai/devdb/cli@latest
```

## Usage

### Managing Projects

```bash
# Create a new project
devdb project create myproject --type postgres --version 15

# List all projects
devdb project list

# View project details
devdb project show myproject

# Delete a project
devdb project delete myproject
```

### Managing Databases

```bash
# Create a database in a project
devdb db create mydb --project myproject

# List databases in a project
devdb db list --project myproject

# View database details
devdb db show mydb --project myproject

# Delete a database
devdb db delete mydb --project myproject
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

The CLI uses `oapi-codegen` to generate type-safe client code from the OpenAPI specification in `../api/openapi/openapi.yaml`. This ensures:

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

## Project Structure

```
.
├── cmd/              # CLI commands
├── pkg/              # Shared packages
│   ├── api/         # Generated API client
│   └── config/      # Configuration
└── Makefile         # Build commands
