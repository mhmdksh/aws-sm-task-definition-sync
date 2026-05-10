# AWS Secrets Manager ↔ ECS Task Definition Sync

Polls HashiCorp Vault for secret changes and syncs them to AWS Secrets Manager + ECS task definitions.

## Flow

1. **Read** secrets from Vault KV v2 paths
2. **Compare** against local cache — skip if unchanged
3. **Push** to AWS Secrets Manager (create or update)
4. **Update** ECS task definition container secrets when secret structure changes
5. **Cache** current state for next comparison
6. **Repeat** on configurable interval

## Quick Start

```bash
cp .env.template .env   # fill in your values
docker compose up -d --build
```

## Configuration

Copy `.env.template` to `.env` and fill in:

| Variable | Required | Description |
|---|---|---|
| `VAULT_ENDPOINT` | Yes | Vault server URL |
| `VAULT_TOKEN` | Yes | Vault auth token |
| `VAULT_KV_STORE` | Yes | KV v2 store name (e.g. `secret`) |
| `VAULT_SECRET_PATH_1` | Yes | First Vault secret path |
| `AWS_REGION` | Yes | AWS region |
| `AWS_SECRET_NAME` | Yes | AWS Secrets Manager secret name |
| `ECS_TASK_DEFINITION` | Yes | ECS task definition family name |
| `VAULT_SECRET_PATH_2..3` | No | Additional secret paths |
| `CONTAINER_NAME_1..3` | No | Map secrets to specific ECS containers |
| `CHECK_INTERVAL` | No | Sync interval in seconds (default: 60) |
| `CACHE_MAX_AGE_MINUTES` | No | Cache expiry (default: 10) |
| `FORCE_REFRESH_INTERVAL_MINUTES` | No | Force sync interval (default: 60) |
| `LOG_LEVEL` | No | `debug`, `info`, `warn`, `error` (default: `info`) |

## Logging

Set `LOG_LEVEL=debug` for verbose output with request IDs and timestamps. Every API error logs the service, resource, HTTP status, and AWS request ID — no more `Status 404` without context.

```env
LOG_LEVEL=debug
```

## Run Locally

```bash
cp .env.template .env
npm install
npm start
```

## Project Structure

```
src/
├── index.js           # Entry point, bootstraps all modules
├── config.js          # Env loading and validation
├── logger.js          # Structured logging with error formatting
├── cache.js           # File-based secret cache
├── vault.js           # Vault KV v2 client
├── secrets-manager.js # AWS Secrets Manager operations
├── ecs.js             # ECS task definition operations
└── sync.js            # Sync orchestration logic
```
