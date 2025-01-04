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

var project string // Used by db create command

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

	// Add all necessary commands to the root command
	if tc.cmd == dbCreateCmd || tc.cmd == dbListCmd || tc.cmd == dbDeleteCmd {
		testRoot.AddCommand(dbCmd)
		dbCmd.AddCommand(dbCreateCmd, dbListCmd, dbDeleteCmd)
	} else if tc.cmd == projectCreateCmd || tc.cmd == projectListCmd || tc.cmd == projectDeleteCmd {
		testRoot.AddCommand(projectCmd)
		projectCmd.AddCommand(projectCreateCmd, projectListCmd, projectDeleteCmd)
	} else {
		testRoot.AddCommand(tc.cmd)
	}

	// Initialize flags based on command type
	tc.cmd.ResetFlags()
	if tc.cmd == dbCreateCmd {
		dbCreateCmd.Flags().StringVar(&project, "project", "", "Project ID")
		dbCreateCmd.MarkFlagRequired("project")
	} else if tc.cmd == projectCreateCmd {
		projectCreateCmd.Flags().StringVar(&projectOwner, "owner", "", "Owner of the project (defaults to current user)")
		projectCreateCmd.Flags().StringVar(&projectType, "type", "", "Type of database (postgres or mysql)")
		projectCreateCmd.Flags().StringVar(&projectVersion, "version", "", "Version of the database")
		projectCreateCmd.MarkFlagRequired("type")
		projectCreateCmd.MarkFlagRequired("version")
	}

	// Set up output capture
	buf := new(bytes.Buffer)
	testRoot.SetOut(buf)
	testRoot.SetErr(buf)

	// Set args based on the command type
	var args []string
	if tc.cmd == dbCreateCmd || tc.cmd == dbListCmd || tc.cmd == dbDeleteCmd {
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

	if (err != nil) != tc.wantErr {
		t.Errorf("command execution error = %v, wantErr %v", err, tc.wantErr)
	}

	if tc.wantOutput != "" && output != tc.wantOutput {
		t.Errorf("output = %q, want %q", output, tc.wantOutput)
	}

	return output
}
