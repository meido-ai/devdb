# Features: Postgres SSL

Assume the users that need access to the databases are traditional software engineers working on applications locally but would like the benefit of running databases in the cloud. ideally the could run their Java, Python, Node, etc., application locally and use a database connection string that points to a postgres database running in a pod in the cloud. in that scenario, the user doesn't have kubectl installed on their machine and likely doesn't even know what kubernetes is.

```sh
postgres://user:pass@loadbalancer-dns:5432/dbname?sslmode=verify-full
```

Reduces latency (no proxy hop)
Simplifies the architecture
Uses PostgreSQL's built-in security feature

When properly configured, both SSL and SSH tunneling provide similar levels of security. SSL with PostgreSQL:

Encrypts all traffic between client and server
Authenticates the server to the client (with proper cert verification)
Protects against man-in-the-middle attacks
Secures credentials during transmission

The main advantage of SSL is simplicity - users can connect directly using standard connection strings without setting up tunnels. SSH adds an extra layer but isn't necessarily more secure when PostgreSQL SSL is properly configured with strong certs and required verification.
The key is proper configuration: using strong certificates, requiring SSL (not just allowing it), and setting sslmode=verify-full in connection strings.