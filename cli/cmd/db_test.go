package cmd

import (
    "net/http"
    "net/http/httptest"
    "testing"
)

func TestDatabaseCommands(t *testing.T) {
    // Create a test server that returns mock responses
    ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        switch r.Method + " " + r.URL.Path {
        case "POST /databases":
            w.Header().Set("Content-Type", "application/json")
            w.WriteHeader(http.StatusCreated)
            w.Write([]byte(`{
                "name": "testdb",
                "status": "running",
                "host": "localhost",
                "port": 5432,
                "service": "postgres-service"
            }`))
        case "GET /databases":
            w.Header().Set("Content-Type", "application/json")
            w.WriteHeader(http.StatusOK)
            w.Write([]byte(`[
                {
                    "name": "testdb1",
                    "status": "running",
                    "project": "testproject",
                    "host": "localhost",
                    "port": 5432,
                    "username": "postgres",
                    "database": "testdb1"
                },
                {
                    "name": "testdb2",
                    "status": "stopped",
                    "project": "testproject"
                }
            ]`))
        case "DELETE /databases/testdb":
            w.WriteHeader(http.StatusOK)
            w.Write([]byte(`{"message": "Database deleted successfully"}`))
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
            name: "create database",
            cmd:  dbCreateCmd,
            args: []string{"testdb", "--project", "testproject"},
            wantOutput: `Database created successfully
Details:
  Name: testdb
  Status: running
  Host: localhost
  Port: 5432
`,
        },
        {
            name:    "create database without project",
            cmd:    dbCreateCmd,
            args:   []string{"testdb"},
            wantErr: true,
            wantOutput: "Error: required flag(s) \"project\" not set\n",
        },
        {
            name: "list databases",
            cmd:  dbListCmd,
            args: []string{},
            wantOutput: `Databases:
- testdb1 (Status: running)
  Project: testproject
  Host: localhost
  Port: 5432
  Username: postgres
  Database: testdb1
- testdb2 (Status: stopped)
  Project: testproject
`,
        },
        {
            name: "delete database",
            cmd:  dbDeleteCmd,
            args: []string{"testdb"},
            wantOutput: "Database testdb deleted successfully\n",
        },
    }

    for _, tc := range tests {
        t.Run(tc.name, func(t *testing.T) {
            executeCommand(t, tc)
        })
    }
}

func TestDatabaseClientErrors(t *testing.T) {
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
            name: "create database server error",
            cmd:  dbCreateCmd,
            args: []string{"testdb", "--project", "testproject"},
            wantErr: true,
            wantOutput: "Error: API returned status code 500\n",
        },
        {
            name: "list databases server error",
            cmd:  dbListCmd,
            args: []string{},
            wantErr: true,
            wantOutput: "Error: API returned status code 500\n",
        },
        {
            name: "delete database server error",
            cmd:  dbDeleteCmd,
            args: []string{"testdb"},
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
