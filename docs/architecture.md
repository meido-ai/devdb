# Architecture

DevDB makes it possible for engineers to develop locally but use databases in cloud. All the benefits of developing locally with databases that contain up-to-date data. it's like using a cloud-based development environment, but without all the overhead and complexity of setting up CDEs. DevDB runs the application database in the cloud while everything else runs locally.

DevDB starts up database containers for each developers to use. The databases are isolated from one another and can be used concurrently. Each engineer has their own database instance and they can be easily created and destroyed which is great if you need to start over from scratch with your data. By running databases in containers, DevDB is more efficient and cost effective than running multple managed databases in the cloud (e.g. AWS RDS).

This is an application that runs in a namepsace in a kubernetes cluster and creates database containers for engineers to use. when developing a new feature or fixing a bug, a new container is created and deployed to the cluster. only postgres is supported for now. the api creates pods for the database containers dynamically and deploys them to the cluster. when the first database container for an associated project is created, the api pulls a database backup from object storage and uses it to restore the database so it has data. once the restore script completes, the database container stores its data in a persistent volume. the persisten volume is capabale of creating volume snapshots that can be used by other database instances to restore their data, improving performance.

## Getting started

The simplest and easiest way to use the software is to

1. install the helm chart from devdb/devdb. This will create a namespace called devdb and install the api into it.
2. determine the address of the api service and set the server address in the cli
3. use the cli to create a new project giving it a name and the address of the pg_dump file
4. use the cli to create a new database for the project that was created in the previous step. when the database is created, the cli will display the connection details for the database 

## How it works

There is a single API responsible for managing the database containers. The API code resides in the api directory which provides API endpoints to create new databases from projects. Projects define the database type and version and the source data to use. Theh database containers store their data in persistent volumes so the data can survive pod restarts. The persisten volumes are also used to create volume snapshots which can be used by other database containers to restore their data.

A load balancer is shared between the API and all of the database containers.

DNS records are created for all of the database containers using a whildcard. For example, if the hostname devdb.example.com is created, databases will be available at davd-pg.devdb.example.com, kate-pg.devdb.example.com, etc.