package cmd

import (
    "fmt"
    "github.com/spf13/cobra"
    "github.com/john-craft/devdb-cli/pkg/api"
    "os/user"
    "strings"
)

var (
    owner  string
    name   string
    dbType string
)

var createCmd = &cobra.Command{
    Use:   "create",
    Short: "Create a new database",
    Run: func(cmd *cobra.Command, args []string) {
        if owner == "" {
            currentUser, err := user.Current()
            if err != nil {
                fmt.Printf("Error getting current user: %v\n", err)
                return
            }
            owner = strings.ToLower(currentUser.Username)
        } else {
            owner = strings.ToLower(owner)
        }

        client := api.NewClient(apiURL)
        result, err := client.CreateDatabase(owner, dbType, name)
        if err != nil {
            fmt.Printf("Error: %v\n", err)
            return
        }

        fmt.Printf("Database created successfully: %v\n", result)
    },
}

func init() {
    createCmd.Flags().StringVar(&owner, "owner", "", "Owner of the database (defaults to current user)")
    createCmd.Flags().StringVar(&name, "name", "", "Name for the database")
    createCmd.Flags().StringVar(&dbType, "db-type", "postgres", "Database type")

    createCmd.MarkFlagRequired("name")
    createCmd.MarkFlagRequired("db-type")

    rootCmd.AddCommand(createCmd)
}