# vault-secret-injector

## Setup
```bash
docker compose build --no-cache
```
## Configure
```bash
## VAULT ENDPOINT
VAULT_ENDPOINT=http://127.0.0.1:8200
## Authentication Token
VAULT_TOKEN=your-vault-token
## Key Value Store Name
VAULT_KV_STORE=secret
## Absolute Path of the Secret
VAULT_SECRET_PATH=my-secret
## Target ENV file on the host machine
TARGET_HOST_FILE="./secrets.env"
```
## Start
```bash
docker compose up -d --build
```