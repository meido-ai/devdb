package cmd

import (
    "os"
    "fmt"

    "github.com/spf13/cobra"
    "github.com/spf13/viper"
)

var (
    apiURL  string
    cfgFile string
    Version string // This will be set by -ldflags during build
)

var rootCmd = &cobra.Command{
    Use:   "devdb",
    Short: "DevDB - Development Database Manager",
    Long: `DevDB is a tool for managing development databases.
It allows you to create, manage, and share databases from backups,
without needing to know Kubernetes or infrastructure details.`,
    Version: Version,
}

func Execute() {
    if err := rootCmd.Execute(); err != nil {
        fmt.Println(err)
        os.Exit(1)
    }
}

func init() {
    cobra.OnInitialize(initConfig)

    // Global flags
    rootCmd.PersistentFlags().StringVar(&cfgFile, "config", "", "config file (default is $HOME/.devdb.yaml)")
    rootCmd.PersistentFlags().StringVar(&apiURL, "api-url", "", "DevDB API URL")
    
    // Bind flags to viper
    viper.BindPFlag("api.url", rootCmd.PersistentFlags().Lookup("api-url"))
}

func initConfig() {
    if cfgFile != "" {
        viper.SetConfigFile(cfgFile)
    } else {
        home, err := os.UserHomeDir()
        if err != nil {
            fmt.Println(err)
            os.Exit(1)
        }

        // Search for config in home directory
        viper.AddConfigPath(home)
        viper.SetConfigType("yaml")
        viper.SetConfigName(".devdb")
    }

    // Read config
    if err := viper.ReadInConfig(); err == nil {
        if apiURL == "" {
            apiURL = viper.GetString("api.url")
        }
    }

    // Set defaults if not configured
    if apiURL == "" {
        apiURL = "http://localhost:5000"
    }
}