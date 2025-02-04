const { ECS } = require('@aws-sdk/client-ecs');
const { SecretsManager } = require('@aws-sdk/client-secrets-manager');
require('dotenv').config();

// Initialize AWS SDK for ECS and Secrets Manager
const ecs = new ECS({ region: process.env.AWS_REGION });
const secretsManager = new SecretsManager({ region: process.env.AWS_REGION });

// Function to fetch secret ARN and values from AWS Secrets Manager
async function fetchSecret(secretName) {
  try {
    const secretDetails = await secretsManager.describeSecret({ SecretId: secretName });
    const secretArn = secretDetails.ARN;

    const secretValue = await secretsManager.getSecretValue({ SecretId: secretName });
    
    if (secretValue.SecretString) {
      return { secretData: JSON.parse(secretValue.SecretString), secretArn };
    }
    return {};
  } catch (err) {
    console.error(`Error fetching secret: ${err.message}`);
    throw err;
  }
}

// Function to get the current secrets from the ECS task definition
function getCurrentSecretKeys(taskDefinition) {
  const containerDefinitions = taskDefinition.containerDefinitions || [];
  const currentSecrets = containerDefinitions.flatMap(container => {
    const containerSecrets = container.secrets || [];
    const logSecrets = container.logConfiguration?.secretOptions || [];
    return [...containerSecrets, ...logSecrets];
  });
  const currentSecretKeys = currentSecrets.map(secret => secret.name);
  return new Set(currentSecretKeys);
}

// Function to compare new secrets with existing ones
function haveSecretsChanged(currentSecretKeys, newSecretKeys) {
  const newKeysSet = new Set(Object.keys(newSecretKeys));
  
  if (currentSecretKeys.size !== newKeysSet.size) return true; // Different number of secrets
  
  for (let key of newKeysSet) {
    if (!currentSecretKeys.has(key)) {
      return true; // Found a secret that's new
    }
  }
  return false; // No changes in the secret keys
}

// Function to update ECS task definition with dynamic secrets
async function updateEcsTaskDefinitionWithSecrets(secretName, taskDefinitionName) {
  try {
    // Fetch secret data and ARN from Secrets Manager
    const { secretData, secretArn } = await fetchSecret(secretName);

    // Fetch the current ECS task definition
    const currentTaskDefinition = await ecs.describeTaskDefinition({ taskDefinition: taskDefinitionName });
    const currentSecretKeys = getCurrentSecretKeys(currentTaskDefinition.taskDefinition);

    // Only update if the secret keys have changed
    if (haveSecretsChanged(currentSecretKeys, secretData)) {
      console.log('Secret names have changed, updating ECS task definition...');

      const updatedContainerDefinitions = currentTaskDefinition.taskDefinition.containerDefinitions.map(container => {
        // Create a copy of the container to modify
        const updatedContainer = { ...container };
        
        // Handle regular secrets (excluding log secrets)
        if (container.secrets) {
          const regularSecrets = Object.entries(secretData)
            .filter(([key]) => !container.logConfiguration?.secretOptions?.some(s => s.name === key))
            .map(([key]) => ({
              name: key,
              valueFrom: `${secretArn}:${key}::`
            }));
          updatedContainer.secrets = regularSecrets;
        }

        // Handle log configuration secrets separately
        if (container.logConfiguration?.secretOptions) {
          const logSecrets = container.logConfiguration.secretOptions.map(secret => ({
            name: secret.name,
            valueFrom: `${secretArn}:${secret.name}::`
          }));
          updatedContainer.logConfiguration = {
            ...container.logConfiguration,
            secretOptions: logSecrets
          };
        }

        return updatedContainer;
      });

      // Register new task definition with updated secrets
      const newTaskDefinition = {
        family: currentTaskDefinition.taskDefinition.family,
        containerDefinitions: updatedContainerDefinitions,
        executionRoleArn: currentTaskDefinition.taskDefinition.executionRoleArn,
        taskRoleArn: currentTaskDefinition.taskDefinition.taskRoleArn,
        networkMode: currentTaskDefinition.taskDefinition.networkMode,
        cpu: currentTaskDefinition.taskDefinition.cpu,
        memory: currentTaskDefinition.taskDefinition.memory,
        requiresCompatibilities: currentTaskDefinition.taskDefinition.requiresCompatibilities,
        volumes: currentTaskDefinition.taskDefinition.volumes,
      };

      const response = await ecs.registerTaskDefinition(newTaskDefinition);
      console.log(`Task definition updated successfully: ${response.taskDefinition.taskDefinitionArn}`);
    } else {
      console.log('No changes in secret names, skipping task definition update.');
    }

  } catch (err) {
    console.error(`Error updating ECS task definition: ${err.message}`);
  }
}

// Function to check for secret updates periodically
function startPeriodicCheck(intervalInSeconds) {
  setInterval(async () => {
    const secretName = process.env.AWS_SECRET_NAME; // The secret name is passed via environment variable
    const taskDefinitionName = process.env.ECS_TASK_DEFINITION; // Task definition name is passed via environment variable

    console.log(`Checking for updates to secret: ${secretName}`);
    await updateEcsTaskDefinitionWithSecrets(secretName, taskDefinitionName);
  }, intervalInSeconds * 1000);
}

// Start periodic checking
const intervalInSeconds = process.env.CHECK_INTERVAL || 60; // Set default to 60 seconds if not defined
startPeriodicCheck(intervalInSeconds);