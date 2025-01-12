package cmd

import (
    "context"
    "fmt"
    "github.com/spf13/cobra"
    "github.com/meido-ai/devdb/cli/pkg/api"
)

var dbCmd = &cobra.Command{
    Use:   "db",
    Short: "Manage databases",
    Long: `Create and manage development databases.
No Kubernetes knowledge required - DevDB handles all the infrastructure for you.`,
}

var (
    dbType    string
    dbVersion string
    username  string
    password  string
    database  string
)

var dbCreateCmd = &cobra.Command{
    Use:   "create [name]",
    Short: "Create a new database",
    Long: `Create a new database instance.
Specify the database type, version, and credentials.`,
    Args: cobra.ExactArgs(1),
    RunE: func(cmd *cobra.Command, args []string) error {
        // We're past flag validation, silence usage for runtime errors
        defer func() { cmd.SilenceUsage = true }()
        
        name := args[0]
        ctx := context.Background()
        
        client, err := api.NewClientWithResponses(apiURL)
        if err != nil {
            return fmt.Errorf("error creating client: %v", err)
        }

        // Create database request
        req := api.CreateDatabaseRequest{
            Name:      name,
            DbType:    api.DatabaseType(dbType),
            DbVersion: dbVersion,
            Credentials: api.DatabaseCredentials{
                Username: username,
                Password: &password,
                Database: database,
            },
        }

        resp, err := client.PostDatabasesWithResponse(ctx, req)
        if err != nil {
            return fmt.Errorf("error creating database: %v", err)
        }

        if resp.StatusCode() != 201 {
            return fmt.Errorf("API returned status code %d", resp.StatusCode())
        }

        result := resp.JSON201
        cmd.Printf("Database created successfully\n")
        cmd.Printf("Details:\n")
        cmd.Printf("  Name: %s\n", result.Name)
        cmd.Printf("  Status: %s\n", result.Status)
        if result.Host != nil && *result.Host != "" {
            cmd.Printf("  Host: %s\n", *result.Host)
        }
        if result.Port != nil && *result.Port != 0 {
            cmd.Printf("  Port: %d\n", *result.Port)
        }
        return nil
    },
}

var dbListCmd = &cobra.Command{
    Use:   "list",
    Short: "List databases",
    Long:  `Display a list of all databases and their current status.`,
    RunE: func(cmd *cobra.Command, args []string) error {
        // Silence usage for runtime errors
        defer func() { cmd.SilenceUsage = true }()

        ctx := context.Background()
        
        client, err := api.NewClientWithResponses(apiURL)
        if err != nil {
            return fmt.Errorf("error creating client: %v", err)
        }

        resp, err := client.GetDatabasesWithResponse(ctx)
        if err != nil {
            return fmt.Errorf("error listing databases: %v", err)
        }

        if resp.StatusCode() != 200 {
            return fmt.Errorf("API returned status code %d", resp.StatusCode())
        }

        databases := resp.JSON200
        if databases == nil || len(*databases) == 0 {
            cmd.Println("No databases found")
            return nil
        }

        cmd.Println("Databases:")
        for _, db := range *databases {
            cmd.Printf("- %s (Status: %s)\n", db.Name, db.Status)
            if db.Project != nil {
                cmd.Printf("  Project: %s\n", *db.Project)
            }
            if db.Host != nil && *db.Host != "" {
                cmd.Printf("  Host: %s\n", *db.Host)
            }
            if db.Port != nil && *db.Port != 0 {
                cmd.Printf("  Port: %d\n", *db.Port)
            }
            if db.Username != nil && *db.Username != "" {
                cmd.Printf("  Username: %s\n", *db.Username)
            }
            if db.Database != nil && *db.Database != "" {
                cmd.Printf("  Database: %s\n", *db.Database)
            }
        }
        return nil
    },
}

var dbDeleteCmd = &cobra.Command{
    Use:   "delete [name]",
    Short: "Delete a database",
    Long:  `Delete a database and all its resources.`,
    Args:  cobra.ExactArgs(1),
    RunE: func(cmd *cobra.Command, args []string) error {
        // Silence usage for runtime errors
        defer func() { cmd.SilenceUsage = true }()

        name := args[0]
        ctx := context.Background()
        
        client, err := api.NewClientWithResponses(apiURL)
        if err != nil {
            return fmt.Errorf("error creating client: %v", err)
        }

        resp, err := client.DeleteDatabasesNameWithResponse(ctx, name)
        if err != nil {
            return fmt.Errorf("error deleting database: %v", err)
        }

        if resp.StatusCode() != 200 {
            return fmt.Errorf("API returned status code %d", resp.StatusCode())
        }

        cmd.Printf("Database %s deleted successfully\n", name)
        return nil
    },
}

func init() {
    // Add database create flags
    dbCreateCmd.Flags().StringVarP(&dbType, "type", "t", "", "Database type (postgres or mysql)")
    dbCreateCmd.Flags().StringVarP(&dbVersion, "version", "v", "", "Database version")
    dbCreateCmd.Flags().StringVarP(&username, "username", "u", "", "Database username")
    dbCreateCmd.Flags().StringVarP(&password, "password", "p", "", "Database password")
    dbCreateCmd.Flags().StringVarP(&database, "database", "d", "", "Database name")

    // Mark required flags
    dbCreateCmd.MarkFlagRequired("type")
    dbCreateCmd.MarkFlagRequired("version")
    dbCreateCmd.MarkFlagRequired("username")
    dbCreateCmd.MarkFlagRequired("database")

    // Add commands to db command
    dbCmd.AddCommand(dbCreateCmd)
    dbCmd.AddCommand(dbListCmd)
    dbCmd.AddCommand(dbDeleteCmd)
}
