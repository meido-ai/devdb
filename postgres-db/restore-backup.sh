#!/bin/bash

# Start Postgres in the background to ensure it's ready to accept connections
docker-entrypoint.sh postgres &

# The process ID of the PostgreSQL process, so we can wait for it later
POSTGRES_PID=$!

# Wait for Postgres to be ready
until pg_isready -h localhost -U $POSTGRES_USER; do
  sleep 1
done

if [ "$RESTORE_FROM_BACKUP" == "True" ]; then
  # Download the dump from the public GCS bucket using curl
  echo "Download backup"
  curl -o /tmp/dump.backup $DB_BACKUP_URL

  # Restore the dump using pg_restore (or psql depending on the dump format)
  echo "Restore backup"
  pg_restore -U $POSTGRES_USER -d $POSTGRES_DB /tmp/dump.backup
fi

# Wait for the PostgreSQL process to complete
wait $POSTGRES_PID
