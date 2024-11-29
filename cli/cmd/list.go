package cmd

import (
    "encoding/json"
    "fmt"
    "github.com/spf13/cobra"
    "github.com/john-craft/devdb-cli/pkg/api"
)

var listCmd = &cobra.Command{
    Use:   "list",
    Short: "List all databases",
    Run: func(cmd *cobra.Command, args []string) {
        client := api.NewClient(apiURL)
        databases, err := client.ListDatabases()
        if err != nil {
            fmt.Printf("Error: %v\n", err)
            return
        }

        prettyJSON, err := json.MarshalIndent(databases, "", "  ")
        if err != nil {
            fmt.Printf("Error formatting JSON: %v\n", err)
            return
        }

        fmt.Println(string(prettyJSON))
    },
}

func init() {
    rootCmd.AddCommand(listCmd)
}