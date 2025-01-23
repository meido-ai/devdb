package cmd

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestProjectCommands(t *testing.T) {
	// Create a test server that returns mock responses
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method + " " + r.URL.Path {
		case "POST /projects":
			// Read and validate request body
			body, err := io.ReadAll(r.Body)
			if err != nil {
				t.Logf("error reading body: %v", err)
				http.Error(w, "error reading body", http.StatusBadRequest)
				return
			}

			var req struct {
				Owner     string `json:"owner"`
				Name      string `json:"name"`
				DbType    string `json:"dbType"`
				DbVersion string `json:"dbVersion"`
			}
			if err := json.Unmarshal(body, &req); err != nil {
				t.Logf("invalid json: %v, body: %s", err, string(body))
				http.Error(w, "invalid json", http.StatusBadRequest)
				return
			}

			// Validate required fields
			if req.Owner == "" || req.Name == "" || req.DbType == "" || req.DbVersion == "" {
				t.Logf("missing required fields, request: %+v", req)
				http.Error(w, "missing required fields", http.StatusBadRequest)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			w.Write([]byte(`{
				"id": "proj-123",
				"owner": "testuser",
				"name": "testproject",
				"dbType": "postgres",
				"dbVersion": "15.3",
				"backupLocation": "",
				"defaultCredentials": {
					"username": "devdb",
					"password": "generated-password",
					"database": "testproject"
				}
			}`))
		case "GET /projects":
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`[
				{
					"id": "proj-123",
					"owner": "testuser",
					"name": "testproject",
					"dbType": "postgres",
					"dbVersion": "15.3",
					"backupLocation": "",
					"databases": []
				}
			]`))
		case "DELETE /projects/testproject":
			w.WriteHeader(http.StatusOK)
		default:
			http.Error(w, "not found", http.StatusNotFound)
		}
	}))
	defer ts.Close()

	// Store the original apiURL and restore it after tests
	originalURL := apiURL
	defer func() { apiURL = originalURL }()
	apiURL = ts.URL

	tests := []cmdTestCase{
		{
			name: "create project",
			cmd:  projectCreateCmd,
			args: []string{"testproject", "--type", "postgres", "--version", "15.3"},
			wantOutput: `Project created successfully
Details:
  ID: proj-123
  Name: testproject
  Owner: testuser
  DbType: postgres
  DbVersion: 15.3
`,
		},
		{
			name: "list projects",
			cmd:  projectListCmd,
			args: []string{},
			wantOutput: `Projects:
- testproject (ID: proj-123)
  Owner: testuser
  DbType: postgres
  DbVersion: 15.3
`,
		},
		{
			name: "delete project",
			cmd:  projectDeleteCmd,
			args: []string{"testproject"},
			wantOutput: "Project testproject deleted successfully\n",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			executeCommand(t, tc)
		})
	}
}

func TestProjectClientErrors(t *testing.T) {
	// Create a test server that returns errors
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer ts.Close()

	// Store the original apiURL and restore it after tests
	originalURL := apiURL
	defer func() { apiURL = originalURL }()
	apiURL = ts.URL

	tests := []cmdTestCase{
		{
			name: "create project server error",
			cmd:  projectCreateCmd,
			args: []string{"testproject", "--type", "postgres", "--version", "15.3"},
			wantErr: true,
			wantOutput: "Error: API returned status code 500\n",
		},
		{
			name: "list projects server error",
			cmd:  projectListCmd,
			args: []string{},
			wantErr: true,
			wantOutput: "Error: API returned status code 500\n",
		},
		{
			name: "delete project server error",
			cmd:  projectDeleteCmd,
			args: []string{"testproject"},
			wantErr: true,
			wantOutput: "Error: API returned status code 500\n",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			executeCommand(t, tc)
		})
	}
}
