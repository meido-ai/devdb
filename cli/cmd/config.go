package cmd

import (
    "fmt"
    "github.com/spf13/cobra"
    "github.com/john-craft/devdb-cli/pkg/api"
)

var (
    postgresImage     string
    postgresDB        string
    postgresUser      string
    postgresPassword  string
    backupLocationURL string
)

var configCmd = &cobra.Command{
    Use:   "config",
    Short: "Update configuration",
    Run: func(cmd *cobra.Command, args []string) {
        client := api.NewClient(apiURL)
        err := client.UpdateConfig(postgresImage, postgresDB, postgresUser, postgresPassword, backupLocationURL)
        if err != nil {
            fmt.Printf("Error: %v\n", err)
            return
        }

        fmt.Println("Configuration updated successfully")
    },
}

func init() {
    configCmd.Flags().StringVar(&postgresImage, "postgres-image", "", "Postgres image to use")
    configCmd.Flags().StringVar(&postgresDB, "postgres-db", "", "Database name")
    configCmd.Flags().StringVar(&postgresUser, "postgres-user", "", "Database user")
    configCmd.Flags().StringVar(&postgresPassword, "postgres-password", "", "Database password")
    configCmd.Flags().StringVar(&backupLocationURL, "backup-location-url", "", "Backup location URL")

    configCmd.MarkFlagRequired("postgres-image")
    configCmd.MarkFlagRequired("postgres-db")
    configCmd.MarkFlagRequired("postgres-user")
    configCmd.MarkFlagRequired("postgres-password")
    configCmd.MarkFlagRequired("backup-location-url")

    rootCmd.AddCommand(configCmd)
}