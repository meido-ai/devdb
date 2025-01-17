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
    project string // Project flag for database commands
)

var dbCreateCmd = &cobra.Command{
    Use:   "create [name]",
    Short: "Create a new database",
    Long: `Create a new database instance within a project.
The database will inherit its configuration from the project settings.`,
    Args: cobra.ExactArgs(1),
    RunE: func(cmd *cobra.Command, args []string) error {
        name := args[0]
        ctx := context.Background()
        
        client, err := api.NewClientWithResponses(apiURL)
        if err != nil {
            return fmt.Errorf("creating client: %v", err)
        }

        // Create database request
        req := api.CreateDatabaseRequest{
            Name: name,
        }

        resp, err := client.PostProjectsProjectIdDatabasesWithResponse(ctx, project, req)
        if err != nil {
            return fmt.Errorf("creating database: %v", err)
        }

        if resp.StatusCode() != 201 {
            return fmt.Errorf("API returned status code %d", resp.StatusCode())
        }

        db := resp.JSON201
        cmd.Printf("Database created successfully\nDetails:\n")
        cmd.Printf("  Name: %s\n", db.Name)
        cmd.Printf("  Status: %s\n", db.Status)
        if db.Host != nil {
            cmd.Printf("  Host: %s\n", *db.Host)
        }
        if db.Port != nil {
            cmd.Printf("  Port: %d\n", *db.Port)
        }
        return nil
    },
}

var dbListCmd = &cobra.Command{
    Use:   "list",
    Short: "List databases in a project",
    RunE: func(cmd *cobra.Command, args []string) error {
        ctx := context.Background()
        
        client, err := api.NewClientWithResponses(apiURL)
        if err != nil {
            return fmt.Errorf("creating client: %v", err)
        }

        resp, err := client.GetProjectsProjectIdDatabasesWithResponse(ctx, project)
        if err != nil {
            return fmt.Errorf("listing databases: %v", err)
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
            if db.Host != nil {
                cmd.Printf("  Host: %s\n", *db.Host)
            }
            if db.Port != nil {
                cmd.Printf("  Port: %d\n", *db.Port)
            }
        }
        return nil
    },
}

var dbShowCmd = &cobra.Command{
    Use:   "show [name]",
    Short: "Show database details",
    Args:  cobra.ExactArgs(1),
    RunE: func(cmd *cobra.Command, args []string) error {
        name := args[0]
        ctx := context.Background()
        
        client, err := api.NewClientWithResponses(apiURL)
        if err != nil {
            return fmt.Errorf("creating client: %v", err)
        }

        resp, err := client.GetProjectsProjectIdDatabasesNameWithResponse(ctx, project, name)
        if err != nil {
            return fmt.Errorf("getting database: %v", err)
        }

        if resp.StatusCode() != 200 {
            return fmt.Errorf("API returned status code %d", resp.StatusCode())
        }

        db := resp.JSON200
        cmd.Printf("Database Details:\n")
        cmd.Printf("  Name: %s\n", db.Name)
        cmd.Printf("  Status: %s\n", db.Status)
        if db.Host != nil {
            cmd.Printf("  Host: %s\n", *db.Host)
        }
        if db.Port != nil {
            cmd.Printf("  Port: %d\n", *db.Port)
        }
        return nil
    },
}

var dbDeleteCmd = &cobra.Command{
    Use:   "delete [name]",
    Short: "Delete a database",
    Args:  cobra.ExactArgs(1),
    RunE: func(cmd *cobra.Command, args []string) error {
        name := args[0]
        ctx := context.Background()
        
        client, err := api.NewClientWithResponses(apiURL)
        if err != nil {
            return fmt.Errorf("creating client: %v", err)
        }

        resp, err := client.DeleteProjectsProjectIdDatabasesNameWithResponse(ctx, project, name)
        if err != nil {
            return fmt.Errorf("deleting database: %v", err)
        }

        if resp.StatusCode() != 200 {
            return fmt.Errorf("API returned status code %d", resp.StatusCode())
        }

        cmd.Printf("Database %s deleted successfully\n", name)
        return nil
    },
}

func init() {
    rootCmd.AddCommand(dbCmd)
    dbCmd.AddCommand(dbCreateCmd)
    dbCmd.AddCommand(dbListCmd)
    dbCmd.AddCommand(dbShowCmd)
    dbCmd.AddCommand(dbDeleteCmd)

    // Add project flag to all database commands
    dbCmd.PersistentFlags().StringVar(&project, "project", "", "Project ID (required)")
    dbCmd.MarkPersistentFlagRequired("project")
}
