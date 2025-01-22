#!/bin/bash

# Get current timestamp for version
timestamp=$(date +%Y%m%d-%H%M%S)
version="dev-$timestamp"

# Build the image
echo "Building image with version: $version"
docker build -t ghcr.io/meido-ai/devdb-api:$version .

# Push the image
echo "Pushing image to GitHub Packages"
docker push ghcr.io/meido-ai/devdb-api:$version

# Also tag as latest-dev
echo "Tagging as latest-dev"
docker tag ghcr.io/meido-ai/devdb-api:$version ghcr.io/meido-ai/devdb-api:latest-dev
docker push ghcr.io/meido-ai/devdb-api:latest-dev

echo "Done! Image tagged as:"
echo "  ghcr.io/meido-ai/devdb-api:$version"
echo "  ghcr.io/meido-ai/devdb-api:latest-dev"
