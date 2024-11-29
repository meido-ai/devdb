FROM postgres:latest

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Add the loading script to the container
COPY ./restore-backup.sh /restore-backup.sh

# Make the script executable
RUN chmod +x /restore-backup.sh

# Use the script as the entrypoint
ENTRYPOINT ["/restore-backup.sh"]
