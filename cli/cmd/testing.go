package cmd

import (
	"bytes"
	"testing"

	"github.com/spf13/cobra"
)

type cmdTestCase struct {
	name        string
	cmd         *cobra.Command
	args        []string
	wantErr     bool
	wantOutput  string
	setupMock   func()
	teardownMock func()
}

func executeCommand(t *testing.T, tc cmdTestCase) string {
	t.Helper()

	if tc.setupMock != nil {
		tc.setupMock()
	}

	if tc.teardownMock != nil {
		defer tc.teardownMock()
	}

	// Create a new root command for testing
	testRoot := &cobra.Command{Use: "devdb"}
	testRoot.SilenceUsage = true  // Don't show usage on errors

	// Create fresh command instances for testing
	if tc.cmd == dbCreateCmd || tc.cmd == dbListCmd || tc.cmd == dbDeleteCmd || tc.cmd == dbShowCmd {
		// Create fresh db command tree
		testDbCmd := &cobra.Command{
			Use:   "db",
			Short: "Manage databases",
			Long:  dbCmd.Long,
		}
		testRoot.AddCommand(testDbCmd)

		// Create a fresh command instance
		var testCmd *cobra.Command
		switch tc.cmd {
		case dbCreateCmd:
			testCmd = &cobra.Command{
				Use:   "create [name]",
				Short: dbCreateCmd.Short,
				Long:  dbCreateCmd.Long,
				Args:  cobra.ExactArgs(1),
				RunE:  dbCreateCmd.RunE,
			}
		case dbListCmd:
			testCmd = &cobra.Command{
				Use:   "list",
				Short: dbListCmd.Short,
				Long:  dbListCmd.Long,
				RunE:  dbListCmd.RunE,
			}
		case dbShowCmd:
			testCmd = &cobra.Command{
				Use:   "show [name]",
				Short: dbShowCmd.Short,
				Long:  dbShowCmd.Long,
				Args:  cobra.ExactArgs(1),
				RunE:  dbShowCmd.RunE,
			}
		case dbDeleteCmd:
			testCmd = &cobra.Command{
				Use:   "delete [name]",
				Short: dbDeleteCmd.Short,
				Long:  dbDeleteCmd.Long,
				Args:  cobra.ExactArgs(1),
				RunE:  dbDeleteCmd.RunE,
			}
		}

		// Add the command
		testDbCmd.AddCommand(testCmd)

		// Add project flag
		testDbCmd.PersistentFlags().StringVar(&project, "project", "", "Project ID (required)")
		testDbCmd.MarkPersistentFlagRequired("project")
	} else if tc.cmd == projectCreateCmd || tc.cmd == projectListCmd || tc.cmd == projectDeleteCmd {
		// Create fresh project command tree
		testProjectCmd := &cobra.Command{
			Use:   "project",
			Short: "Manage projects",
			Long:  projectCmd.Long,
		}
		testRoot.AddCommand(testProjectCmd)

		// Create a fresh command instance
		var testCmd *cobra.Command
		switch tc.cmd {
		case projectCreateCmd:
			testCmd = &cobra.Command{
				Use:   "create",
				Short: projectCreateCmd.Short,
				Long:  projectCreateCmd.Long,
				RunE:  projectCreateCmd.RunE,
			}
			// Add flags to the test command instance
			testCmd.Flags().StringVar(&projectOwner, "owner", "", "Owner of the project (defaults to current user)")
			testCmd.Flags().StringVar(&projectType, "type", "", "Type of database (postgres or mysql)")
			testCmd.Flags().StringVar(&projectVersion, "version", "", "Version of the database")
			testCmd.MarkFlagRequired("type")
			testCmd.MarkFlagRequired("version")
		case projectListCmd:
			testCmd = &cobra.Command{
				Use:   "list",
				Short: projectListCmd.Short,
				Long:  projectListCmd.Long,
				RunE:  projectListCmd.RunE,
			}
		case projectDeleteCmd:
			testCmd = &cobra.Command{
				Use:   "delete [id]",
				Short: projectDeleteCmd.Short,
				Long:  projectDeleteCmd.Long,
				Args:  cobra.ExactArgs(1),
				RunE:  projectDeleteCmd.RunE,
			}
		}

		// Add the command
		testProjectCmd.AddCommand(testCmd)
	} else {
		testRoot.AddCommand(tc.cmd)
	}

	// Set up output capture
	buf := new(bytes.Buffer)
	testRoot.SetOut(buf)
	testRoot.SetErr(buf)

	// Set args based on the command type
	var args []string
	if tc.cmd == dbCreateCmd || tc.cmd == dbListCmd || tc.cmd == dbDeleteCmd || tc.cmd == dbShowCmd {
		args = append([]string{"db"}, tc.cmd.Name())
		args = append(args, tc.args...)
	} else if tc.cmd == projectCreateCmd || tc.cmd == projectListCmd || tc.cmd == projectDeleteCmd {
		args = append([]string{"project"}, tc.cmd.Name())
		args = append(args, tc.args...)
	} else {
		args = tc.args
	}
	testRoot.SetArgs(args)

	err := testRoot.Execute()
	output := buf.String()

	t.Logf("Command: %s", tc.name)
	t.Logf("Args: %v", args)
	t.Logf("Error: %v", err)
	t.Logf("Output: %q", output)

	if (err != nil) != tc.wantErr {
		t.Errorf("command execution error = %v, wantErr %v", err, tc.wantErr)
	}

	if tc.wantOutput != "" && output != tc.wantOutput {
		t.Errorf("output = %q, want %q", output, tc.wantOutput)
	}

	return output
}
