# Build stage
FROM node:18-bullseye-slim AS builder

WORKDIR /app

# Copy package files first to leverage cache
COPY package*.json ./
RUN npm ci --only=production

# Copy source and build
COPY . .
RUN npm run build

# Production stage
FROM node:18-bullseye-slim

# Install PostgreSQL and MySQL client tools
RUN apt-get update && \
    apt-get install -y postgresql-client default-mysql-client && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN groupadd -r nodejs && useradd -r -g nodejs nodejs

WORKDIR /app

# Copy only necessary files from builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY .env ./

# Verify .env exists
RUN test -f ./.env || (echo ".env file not found!" && exit 1)

# Use non-root user
USER nodejs

# Set Node to production mode
ENV NODE_ENV=production

# Healthcheck
HEALTHCHECK --interval=30s --timeout=3s \
    CMD curl -f http://localhost:${PORT}/health || exit 1

EXPOSE ${PORT}
CMD ["node", "dist/app.js"]