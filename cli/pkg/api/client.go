package api

import (
    "bytes"
    "encoding/json"
    "fmt"
    "net/http"
)

type Client struct {
    baseURL    string
    httpClient *http.Client
}

type Database struct {
    Namespace         string            `json:"namespace"`
    Labels           map[string]string `json:"labels"`
    CreationTimestamp string           `json:"creationTimestamp"`
    Status           string           `json:"status"`
    Hostname         string           `json:"hostname"`
}

type DatabaseList struct {
    Databases []Database `json:"databases"`
}

func NewClient(baseURL string) *Client {
    return &Client{
        baseURL:    baseURL,
        httpClient: &http.Client{},
    }
}

func (c *Client) ListDatabases() (*DatabaseList, error) {
    resp, err := c.httpClient.Get(fmt.Sprintf("%s/databases", c.baseURL))
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()

    if resp.StatusCode != http.StatusOK {
        return nil, fmt.Errorf("API returned status code %d", resp.StatusCode)
    }

    var result DatabaseList
    if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
        return nil, err
    }

    return &result, nil
}

func (c *Client) CreateDatabase(owner, name string, projectID int, dbType string) (map[string]interface{}, error) {
    data := map[string]interface{}{
        "owner":      owner,
        "name":       name,
        "project_id": projectID,
        "db_type":    dbType,
    }

    jsonData, err := json.Marshal(data)
    if err != nil {
        return nil, err
    }

    resp, err := c.httpClient.Post(fmt.Sprintf("%s/databases", c.baseURL), "application/json", bytes.NewBuffer(jsonData))
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()

    if resp.StatusCode != http.StatusOK {
        return nil, fmt.Errorf("API returned status code %d", resp.StatusCode)
    }

    var result map[string]interface{}
    if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
        return nil, err
    }

    return result, nil
}

func (c *Client) DeleteDatabase(namespace string) error {
    req, err := http.NewRequest(http.MethodDelete, fmt.Sprintf("%s/databases/%s", c.baseURL, namespace), nil)
    if err != nil {
        return err
    }

    resp, err := c.httpClient.Do(req)
    if err != nil {
        return err
    }
    defer resp.Body.Close()

    if resp.StatusCode != http.StatusOK {
        return fmt.Errorf("API returned status code %d", resp.StatusCode)
    }

    return nil
}

func (c *Client) UpdateConfig(postgresImage, postgresDB, postgresUser, postgresPassword, backupLocationURL string) error {
    data := map[string]string{
        "POSTGRES_IMAGE":      postgresImage,
        "POSTGRES_DB":         postgresDB,
        "POSTGRES_USER":       postgresUser,
        "POSTGRES_PASSWORD":   postgresPassword,
        "BACKUP_LOCATION_URL": backupLocationURL,
    }

    jsonData, err := json.Marshal(data)
    if err != nil {
        return err
    }

    req, err := http.NewRequest(http.MethodPut, fmt.Sprintf("%s/config", c.baseURL), bytes.NewBuffer(jsonData))
    if err != nil {
        return err
    }
    req.Header.Set("Content-Type", "application/json")

    resp, err := c.httpClient.Do(req)
    if err != nil {
        return err
    }
    defer resp.Body.Close()

    if resp.StatusCode != http.StatusOK {
        return fmt.Errorf("API returned status code %d", resp.StatusCode)
    }

    return nil
}