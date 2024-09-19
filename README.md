# AWS Secret Manager <--> ECS Task Definition Sync

## Setup
```bash
docker compose build --no-cache
```
## Configure
```bash
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-aws-access-key-id
AWS_SECRET_ACCESS_KEY=your-aws-secret-access-key
AWS_SECRET_NAME=my-aws-secret  # Name of the AWS secret in Secrets Manager
ECS_TASK_DEFINITION=my-ecs-task-definition  # ECS task definition name
CHECK_INTERVAL=60  # Optional, interval in seconds for checking updates
```
## Start
```bash
docker compose up -d --build
```