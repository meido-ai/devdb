package cmd

import (
    "context"
    "fmt"
    "os/user"
    "github.com/spf13/cobra"
    "github.com/meido-ai/devdb/cli/pkg/api"
)

var projectCmd = &cobra.Command{
    Use:   "project",
    Short: "Manage projects",
    Long:  `Create and manage projects for organizing your databases.`,
}

var (
    projectOwner string
    projectType string
    projectVersion string
)

var projectCreateCmd = &cobra.Command{
    Use:   "create [name]",
    Short: "Create a new project",
    Long:  `Create a new project with the specified name.`,
    Args:  cobra.ExactArgs(1),
    RunE: func(cmd *cobra.Command, args []string) error {
        // We're past flag validation, silence usage for runtime errors
        defer func() { cmd.SilenceUsage = true }()

        name := args[0]
        ctx := context.Background()

        // Use current user if owner not specified
        owner := projectOwner
        if owner == "" {
            currentUser, err := user.Current()
            if err != nil {
                return fmt.Errorf("error getting current user: %v", err)
            }
            owner = currentUser.Username
        }

        client, err := api.NewClientWithResponses(apiURL)
        if err != nil {
            return fmt.Errorf("error creating client: %v", err)
        }

        resp, err := client.PostProjectsWithResponse(ctx, api.CreateProjectRequest{
            Owner:     owner,
            Name:      name,
            DbType:    api.DatabaseType(projectType),
            DbVersion: projectVersion,
        })

        if err != nil {
            return fmt.Errorf("error creating project: %v", err)
        }

        if resp.StatusCode() != 201 {
            return fmt.Errorf("API returned status code %d", resp.StatusCode())
        }

        result := resp.JSON201
        cmd.Printf("Project created successfully\n")
        cmd.Printf("Details:\n")
        cmd.Printf("  ID: %s\n", result.Id)
        cmd.Printf("  Name: %s\n", result.Name)
        cmd.Printf("  Owner: %s\n", result.Owner)
        cmd.Printf("  Type: %s\n", result.DbType)
        cmd.Printf("  Version: %s\n", result.DbVersion)
        return nil
    },
}

var projectListCmd = &cobra.Command{
    Use:   "list",
    Short: "List projects",
    Long:  `List all projects or filter by owner.`,
    RunE: func(cmd *cobra.Command, args []string) error {
        // Silence usage for runtime errors
        defer func() { cmd.SilenceUsage = true }()

        ctx := context.Background()

        client, err := api.NewClientWithResponses(apiURL)
        if err != nil {
            return fmt.Errorf("error creating client: %v", err)
        }

        currentUser, err := user.Current()
        if err != nil {
            return fmt.Errorf("error getting current user: %v", err)
        }

        resp, err := client.GetProjectsWithResponse(ctx, &api.GetProjectsParams{
            Owner: &currentUser.Username,
        })

        if err != nil {
            return fmt.Errorf("error listing projects: %v", err)
        }

        if resp.StatusCode() != 200 {
            return fmt.Errorf("API returned status code %d", resp.StatusCode())
        }

        projects := resp.JSON200
        if projects == nil || len(*projects) == 0 {
            cmd.Println("No projects found")
            return nil
        }

        cmd.Println("Projects:")
        for _, project := range *projects {
            cmd.Printf("- %s (Owner: %s)\n", project.Name, project.Owner)
            cmd.Printf("  Type: %s\n", project.DbType)
            cmd.Printf("  Version: %s\n", project.DbVersion)
        }
        return nil
    },
}

var projectDeleteCmd = &cobra.Command{
    Use:          "delete [name]",
    Short:        "Delete a project",
    Long:         `Delete a project and optionally all its databases.`,
    Args:         cobra.ExactArgs(1),
    SilenceUsage: true,
    RunE: func(cmd *cobra.Command, args []string) error {
        name := args[0]
        ctx := context.Background()

        client, err := api.NewClientWithResponses(apiURL)
        if err != nil {
            return fmt.Errorf("error creating client: %v", err)
        }

        resp, err := client.DeleteProjectsNameWithResponse(ctx, name)
        if err != nil {
            return fmt.Errorf("error deleting project: %v", err)
        }

        if resp.StatusCode() != 200 {
            return fmt.Errorf("API returned status code %d", resp.StatusCode())
        }

        cmd.Printf("Project %s deleted successfully\n", name)
        return nil
    },
}

func init() {
    rootCmd.AddCommand(projectCmd)
    projectCmd.AddCommand(projectCreateCmd, projectListCmd, projectDeleteCmd)

    // Add flags for project create command
    projectCreateCmd.Flags().StringVar(&projectOwner, "owner", "", "Owner of the project (defaults to current user)")
    projectCreateCmd.Flags().StringVar(&projectType, "type", "", "Type of database (postgres or mysql)")
    projectCreateCmd.Flags().StringVar(&projectVersion, "version", "", "Version of the database")

    // Mark required flags
    projectCreateCmd.MarkFlagRequired("type")
    projectCreateCmd.MarkFlagRequired("version")
}
