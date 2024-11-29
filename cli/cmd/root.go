package cmd

import (
    "os"
    "fmt"

    "github.com/spf13/cobra"
)

var (
    apiURL  string
    Version string // This will be set by -ldflags during build
)

var rootCmd = &cobra.Command{
    Use:     "devdb",
    Short:   "DevDB CLI - Manage your development databases",
    Long:    `A CLI tool to manage development databases through the DevDB API.`,
    Version: Version,
}

func Execute() {
    err := rootCmd.Execute()
    if err != nil {
        os.Exit(1)
    }
}

func init() {
    rootCmd.PersistentFlags().StringVar(&apiURL, "api-url", "http://localhost:5000", "DevDB API URL")
}