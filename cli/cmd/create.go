package cmd

import (
    "fmt"
    "github.com/spf13/cobra"
    "github.com/john-craft/devdb-cli/pkg/api"
)

var (
    owner     string
    name      string
    projectID int
    dbType    string
)

var createCmd = &cobra.Command{
    Use:   "create",
    Short: "Create a new database",
    Run: func(cmd *cobra.Command, args []string) {
        client := api.NewClient(apiURL)
        result, err := client.CreateDatabase(owner, name, projectID, dbType)
        if err != nil {
            fmt.Printf("Error: %v\n", err)
            return
        }

        fmt.Printf("Database created successfully: %v\n", result)
    },
}

func init() {
    createCmd.Flags().StringVar(&owner, "owner", "", "Owner of the database")
    createCmd.Flags().StringVar(&name, "name", "", "Name for the database")
    createCmd.Flags().IntVar(&projectID, "project-id", 0, "Project ID")
    createCmd.Flags().StringVar(&dbType, "db-type", "postgres", "Database type")

    createCmd.MarkFlagRequired("owner")
    createCmd.MarkFlagRequired("name")
    createCmd.MarkFlagRequired("project-id")

    rootCmd.AddCommand(createCmd)
}