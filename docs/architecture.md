# Architecture

This is an application that runs in a namepsace in a kubernetes cluster and creates database containers for engineers to use. when developing a new feature or fixing a bug, a new container is created and deployed to the cluster. only postgres is supported for now. the api creates pods for the database containers dynamically and deploys them to the cluster. when the first database container for an associated project is created, the api pulls a database backup from object storage and uses it to restore the database so it has data. once the restore script completes, the database container stores its data in a persistent volume. the persisten volume is capabale of creating volume snapshots that can be used by other database instances to restore their data, improving performance.

The API code resides in the api directory and within the app.ts pod definitions are created.

The simplest and easiest way to use the software is to

1. install the helm chart from devdb/devdb. This will create a namespace called devdb and install the api into it.
2. determine the address of the api service and set the server address in the cli
3. use the cli to create a new project giving it a name and the address of the pg_dump file
4. use the cli to create a new database for the project that was created in the previous step. when the database is created, the cli will display the connection details for the database 