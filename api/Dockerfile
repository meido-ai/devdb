# Build stage
FROM node:18-bullseye-slim AS builder

WORKDIR /app

# Copy package files first to leverage cache
COPY package*.json ./
# Install all dependencies including dev dependencies for build
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Production stage
FROM node:18-bullseye-slim

# Install PostgreSQL client tools
RUN apt-get update && \
    apt-get install -y postgresql-client && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN groupadd -r nodejs && useradd -r -g nodejs nodejs

WORKDIR /app

# Copy only necessary files from builder
COPY --from=builder /app/package*.json ./
# Install only production dependencies in the final stage
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist

# Use non-root user
USER nodejs

# Set only essential build-time environment variables
ENV NODE_ENV=production \
    PORT=5000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=3s \
    CMD curl -f http://localhost:${PORT}/health || exit 1

EXPOSE ${PORT}
CMD ["node", "dist/app.js"]