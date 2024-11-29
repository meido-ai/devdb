package cmd

import (
    "fmt"
    "github.com/spf13/cobra"
    "github.com/john-craft/devdb-cli/pkg/api"
)

var deleteCmd = &cobra.Command{
    Use:   "delete [namespace]",
    Short: "Delete a database by namespace",
    Args:  cobra.ExactArgs(1),
    Run: func(cmd *cobra.Command, args []string) {
        client := api.NewClient(apiURL)
        err := client.DeleteDatabase(args[0])
        if err != nil {
            fmt.Printf("Error: %v\n", err)
            return
        }

        fmt.Printf("Database %s deleted successfully\n", args[0])
    },
}

func init() {
    rootCmd.AddCommand(deleteCmd)
}