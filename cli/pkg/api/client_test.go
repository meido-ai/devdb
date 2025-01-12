package api

import (
	"os"
	"reflect"
	"strings"
	"testing"
	"gopkg.in/yaml.v3"
)

type SwaggerSpec struct {
	Paths map[string]map[string]struct {
		Parameters []struct {
			Name     string `yaml:"name"`
			In       string `yaml:"in"`
			Schema   map[string]interface{} `yaml:"schema,omitempty"`
			Required bool   `yaml:"required,omitempty"`
		} `yaml:"parameters"`
	} `yaml:"paths"`
}

// convertPathToMethodName converts an OpenAPI path to a method name
// e.g., /projects/{name}/databases -> ProjectsNameDatabases
func convertPathToMethodName(path string) string {
	// Remove leading slash and parameters
	path = strings.TrimPrefix(path, "/")
	parts := strings.Split(path, "/")
	
	// Convert each part to title case and remove parameters
	for i, part := range parts {
		if strings.HasPrefix(part, "{") && strings.HasSuffix(part, "}") {
			// Keep the parameter name without braces
			part = strings.TrimPrefix(part, "{")
			part = strings.TrimSuffix(part, "}")
		}
		parts[i] = strings.Title(part)
	}
	
	return strings.Join(parts, "")
}

func TestAPISignatureConsistency(t *testing.T) {
	// Load the OpenAPI spec
	data, err := os.ReadFile("../../../api/openapi/openapi.yaml")
	if err != nil {
		t.Fatalf("Failed to read OpenAPI spec: %v", err)
	}

	var spec SwaggerSpec
	if err := yaml.Unmarshal(data, &spec); err != nil {
		t.Fatalf("Failed to parse OpenAPI spec: %v", err)
	}

	// Get the ClientWithResponsesInterface type
	clientType := reflect.TypeOf((*ClientWithResponsesInterface)(nil)).Elem()

	// Check each path and method in the spec
	for path, methods := range spec.Paths {
		for method, details := range methods {
			// Convert method and path to expected function name
			methodPrefix := strings.Title(strings.ToLower(method))
			pathPart := convertPathToMethodName(path)
			methodName := methodPrefix + pathPart + "WithResponse"

			// Find the corresponding method on the client
			_, ok := clientType.MethodByName(methodName)
			if !ok {
				t.Errorf("Method %s not found on client for %s %s", methodName, method, path)
				continue
			}

			// TODO: Add parameter validation
			_ = details
		}
	}
}
