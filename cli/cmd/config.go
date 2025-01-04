package cmd

import (
    "fmt"
    "github.com/spf13/cobra"
    "github.com/spf13/viper"
)

var configCmd = &cobra.Command{
    Use:   "config",
    Short: "Configure CLI settings",
    Long:  `Configure CLI settings like API URL and view current configuration.`,
}

var configSetAPICmd = &cobra.Command{
    Use:   "set-api [url]",
    Short: "Set the DevDB API URL",
    Long:  `Set the URL for the DevDB API that the CLI will connect to.`,
    Args:  cobra.ExactArgs(1),
    Run: func(cmd *cobra.Command, args []string) {
        apiURL := args[0]
        viper.Set("api.url", apiURL)
        err := viper.WriteConfig()
        if err != nil {
            // If config file doesn't exist, create it
            err = viper.SafeWriteConfig()
            if err != nil {
                fmt.Printf("Error writing config: %v\n", err)
                return
            }
        }
        fmt.Printf("API URL set to: %s\n", apiURL)
    },
}

var configViewCmd = &cobra.Command{
    Use:   "view",
    Short: "View current configuration",
    Long:  `Display all current configuration settings.`,
    Run: func(cmd *cobra.Command, args []string) {
        fmt.Println("Current Configuration:")
        fmt.Printf("API URL: %s\n", viper.GetString("api.url"))
    },
}

func init() {
    rootCmd.AddCommand(configCmd)
    configCmd.AddCommand(configSetAPICmd)
    configCmd.AddCommand(configViewCmd)
}