# DevDB API Server

The DevDB API server provides a RESTful interface for managing development databases. It's built with Express and TypeScript, using OpenAPI for API specification and type generation.

## Getting Started

### Prerequisites

- Node.js >= 18
- npm >= 9
- Access to a Kubernetes cluster (for running databases)

### Installation

```bash
npm install
```

### Development

```bash
# Start the development server with hot reload
npm run dev

# Build for production
npm run build

# Start production server
npm run start
```

## API Documentation

The API is defined using OpenAPI 3.0 specification in `openapi/openapi.yaml`. This single source of truth is used to:

1. Generate TypeScript types
2. Generate API documentation
3. Validate API specification
4. Generate Go client code (used by the CLI)

### TypeScript Type Generation

The API uses [openapi-typescript](https://github.com/drwpow/openapi-typescript) to generate TypeScript types from the OpenAPI spec. Generated types are stored in `src/types/generated/api.ts`.

```bash
# Generate TypeScript types
npm run generate:types
```

The generated types include:
- Request/response schemas using Zod for runtime validation
- TypeScript interfaces for type checking
- Proper handling of optional fields

Example usage:

```typescript
import { 
  DatabaseSchema,
  CreateDatabaseRequestSchema,
  type Database,
  type CreateDatabaseRequest
} from './types/generated/api';

// Validate request body
app.post('/databases', (req, res) => {
  const result = CreateDatabaseRequestSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }
  
  const data: CreateDatabaseRequest = result.data;
  // ... handle request
});
```

### API Documentation

Generate beautiful API documentation using [ReDoc](https://github.com/Redocly/redoc):

```bash
# Generate HTML documentation
npm run generate:docs
```

The documentation will be available at `public/docs.html`.

### Validate OpenAPI Spec

Before making changes to the OpenAPI specification, validate it:

```bash
# Validate OpenAPI specification
npm run validate:spec
```

## Project Structure

```
api/
├── src/
│   ├── types/
│   │   └── generated/
│   │       └── api.ts        # Generated API types
│   ├── routes/           # API route handlers
│   ├── services/         # Business logic
│   ├── middleware/       # Express middleware
│   └── app.ts           # Express application setup
├── public/
│   └── docs.html        # Generated API documentation
└── package.json         # Project dependencies and scripts
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Port to run the API server | 5000 |
| `KUBERNETES_CONTEXT` | Kubernetes context to use | current-context |
| `LOG_LEVEL` | Logging level (debug, info, warn, error) | info |

## Contributing

1. Update the OpenAPI spec in `openapi/openapi.yaml`
2. Generate new types: `npm run generate:types`
3. Validate the spec: `npm run validate:spec`
4. Update the implementation
5. Generate docs: `npm run generate:docs`
6. Submit a PR

## License

This project is licensed under the ISC License.
