.PHONY: generate build test

generate:
	oapi-codegen -package api -generate types,client ../api/openapi/openapi.yaml > pkg/api/client_gen.go

build: generate
	go build -o bin/devdb main.go

test: generate
	go test ./...
