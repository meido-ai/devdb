#!/bin/bash

# Exit on any error
set -e

# Get the current version from git tag, default to 'dev' if no tag exists
VERSION=$(git describe --tags 2>/dev/null || echo "dev")

# Platforms to build for
PLATFORMS=("windows/amd64" "darwin/amd64" "darwin/arm64" "linux/amd64" "linux/arm64")

# Create build directory if it doesn't exist
mkdir -p build

# Build for each platform
for PLATFORM in "${PLATFORMS[@]}"; do
    # Split platform into OS and ARCH
    IFS="/" read -r -a array <<< "$PLATFORM"
    GOOS=${array[0]}
    GOARCH=${array[1]}
    
    # Set output binary name based on OS
    if [ "$GOOS" = "windows" ]; then
        OUTPUT_NAME="build/devdb-${VERSION}-${GOOS}-${GOARCH}.exe"
    else
        OUTPUT_NAME="build/devdb-${VERSION}-${GOOS}-${GOARCH}"
    fi
    
    echo "Building for $GOOS/$GOARCH..."
    GOOS=$GOOS GOARCH=$GOARCH go build -o "$OUTPUT_NAME" -ldflags="-X 'github.com/yourusername/devdb-cli/cmd.Version=$VERSION'" main.go
done

# Create checksums
cd build
sha256sum * > checksums.txt
cd ..

echo "Build complete! Binaries are in the build directory"