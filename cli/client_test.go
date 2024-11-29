package api

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

type SwaggerSpec struct {
	Paths map[string]map[string]struct {
		Parameters []struct {
			Name     string `json:"name"`
			In       string `json:"in"`
			Schema   map[string]interface{} `json:"schema,omitempty"`
			Required bool   `json:"required,omitempty"`
		} `json:"parameters"`
	} `json:"paths"`
}

func TestAPISignatureConsistency(t *testing.T) {
	// Read and parse swagger spec
	data, err := os.ReadFile("../../api/swagger-output.json")
	if err != nil {
		t.Fatalf("Failed to read swagger file: %v", err)
	}

	var spec struct {
		Paths map[string]map[string]interface{} `json:"paths"`
	}
	if err := json.Unmarshal(data, &spec); err != nil {
		t.Fatalf("Failed to parse swagger file: %v", err)
	}

	// Test CreateDatabase parameters
	postParams := spec.Paths["/databases"]["post"].(map[string]interface{})
	parameters := postParams["parameters"].([]interface{})
	bodyParam := parameters[0].(map[string]interface{})
	schema := bodyParam["schema"].(map[string]interface{})
	properties := schema["properties"].(map[string]interface{})

	expectedFields := []string{"owner", "name", "project_id", "db_type"}
	for _, field := range expectedFields {
		if _, exists := properties[field]; !exists {
			t.Errorf("Required field %s not found in swagger spec", field)
		}
	}

	// Test Client method signatures
	clientType := reflect.TypeOf(&Client{})

	// Test CreateDatabase
	method, exists := clientType.MethodByName("CreateDatabase")
	if !exists {
		t.Fatal("CreateDatabase method not found")
	}
	if method.Type.NumIn() != 5 { // receiver + 4 parameters
		t.Errorf("CreateDatabase: expected 4 parameters, got %d", method.Type.NumIn()-1)
	}

	// Test DeleteDatabase
	method, exists = clientType.MethodByName("DeleteDatabase")
	if !exists {
		t.Fatal("DeleteDatabase method not found")
	}
	if method.Type.NumIn() != 2 { // receiver + namespace parameter
		t.Errorf("DeleteDatabase: expected 1 parameter, got %d", method.Type.NumIn()-1)
	}
}