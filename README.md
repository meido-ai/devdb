<div align="center">

<h2>DevDB - On-demand, isolated databases for development and testing</h2>

[![License](https://img.shields.io/badge/License-Apache%202.0-0530AD.svg)](https://opensource.org/licenses/Apache-2.0)
![Platform Support](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-E5DDD4)
[![API Tests](https://github.com/meido-ai/devdb/actions/workflows/api.yml/badge.svg)](https://github.com/meido-ai/devdb/actions/workflows/api.yml)
[![CLI Tests](https://github.com/meido-ai/devdb/actions/workflows/cli.yml/badge.svg)](https://github.com/meido-ai/devdb/actions/workflows/cli.yml)
[![CLI Version](https://img.shields.io/github/v/release/meido-ai/devdb?color=4D148C&label=cli&logo=github)](https://github.com/meido-ai/devdb/releases/latest)

[Installation](#-getting-started) |
[Documentation](#-documentation) |
[CLI Reference](docs/cli.md)

</div>

DevDB is a Kubernetes-native database management tool for developers and testers. It allows you to spin up isolated databases in seconds, making it perfect for development and testing environments.

- 🚀 **Quick Setup** - Spin up databases in seconds
- 🛠️ **Team-Friendly** - Perfect for development and testing environments
- ⚡ **Fast & Efficient** - Optimized for development workflows
- 🎯 **Kubernetes Native** - Runs on your existing K8s cluster

## 🚀 Getting Started

1. **Install DevDB**
```bash
# Add the DevDB Helm repository
helm repo add devdb https://meido-ai.github.io/devdb
helm repo update

# Install DevDB
helm install devdb devdb/devdb \
  --create-namespace \
  --namespace devdb
```

> [!NOTE]
> For detailed AWS deployment requirements and setup instructions, see our [Deployment Guide](docs/deployment.md).

2. **Install the CLI**
```bash
# Download the latest release for your platform
# For macOS (64-bit Intel):
curl -LO https://github.com/meido-ai/devdb/releases/latest/download/devdb_Darwin_x86_64.tar.gz
tar xzf devdb_Darwin_x86_64.tar.gz
sudo mv devdb /usr/local/bin/

# For macOS (Apple Silicon):
curl -LO https://github.com/meido-ai/devdb/releases/latest/download/devdb_Darwin_arm64.tar.gz
tar xzf devdb_Darwin_arm64.tar.gz
sudo mv devdb /usr/local/bin/

# For Windows (64-bit):
curl -LO https://github.com/meido-ai/devdb/releases/latest/download/devdb_Windows_x86_64.zip
unzip devdb_Windows_x86_64.zip
move devdb.exe %USERPROFILE%\bin\devdb.exe
```

3. **Configure and Use**
```bash
# Configure the CLI
export DEVDB_API=$(kubectl get svc -n devdb devdb-api -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
devdb config set-server http://$DEVDB_API

# Create a project
devdb project create --name my-project

# Create a database
devdb database create --project my-project --name dev-db

# Get connection details
devdb database show --project my-project --name dev-db
```


## 📚 Documentation

- [Deployment Guide](docs/deployment.md) - Detailed deployment instructions
- [CLI Reference](docs/cli.md) - CLI command reference

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## 📄 License

DevDB is licensed under the [Apache License 2.0](LICENSE).