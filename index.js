const vault = require('node-vault');
const { SecretsManagerClient } = require('@aws-sdk/client-secrets-manager');
const { ECSClient } = require('@aws-sdk/client-ecs');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { DescribeSecretCommand, PutSecretValueCommand, CreateSecretCommand } = require('@aws-sdk/client-secrets-manager');
const { DescribeTaskDefinitionCommand, RegisterTaskDefinitionCommand } = require('@aws-sdk/client-ecs');

// Initialize clients
const vaultClient = vault({
  apiVersion: 'v1',
  endpoint: process.env.VAULT_ENDPOINT,
  token: process.env.VAULT_TOKEN,
});

const secretsManager = new SecretsManagerClient({ region: process.env.AWS_REGION });
const ecs = new ECSClient({ region: process.env.AWS_REGION });

// File path to store the last known secret values
const cacheFilePath = path.resolve(__dirname, '.last.cache.json');

// Main function to handle the complete sync process
async function syncSecrets() {
  try {
    // Step 1: Read secrets from Vault
    const { secrets, secretPaths } = await readVaultSecrets();
    
    // Step 2: Push secrets to AWS Secrets Manager
    const secretArn = await pushSecretsToAWS(secrets);
    
    // Step 3: Update ECS Task Definition
    await updateEcsTaskDefinition(secretArn, secrets, secretPaths);
    
    console.log('Sync completed successfully');
  } catch (err) {
    console.error('Sync failed:', err.message);
    handleSyncFailure();
  }
}

// Helper function to get all secret paths from environment
function getSecretPaths() {
  const paths = [];
  let i = 1;
  while (process.env[`VAULT_SECRET_PATH_${i}`]) {
    paths.push({
      path: process.env[`VAULT_SECRET_PATH_${i}`],
      container: process.env[`CONTAINER_NAME_${i}`] || null
    });
    i++;
  }
  return paths.length ? paths : [{ path: process.env.VAULT_SECRET_PATH, container: process.env.CONTAINER_NAME || null }];
}

// Modified readVaultSecrets to handle multiple secret paths without prefixing
async function readVaultSecrets() {
  const kvStore = process.env.VAULT_KV_STORE;
  const secretPaths = getSecretPaths();
  const allSecrets = {};

  try {
    for (const { path } of secretPaths) {
      const secret = await vaultClient.read(`${kvStore}/data/${path}`);
      // Merge secrets directly without prefixing
      Object.assign(allSecrets, secret.data.data);
    }
    
    fs.writeFileSync(cacheFilePath, JSON.stringify(allSecrets, null, 2));
    return { secrets: allSecrets, secretPaths };
  } catch (err) {
    if (err.message.includes('permission denied') || err.message.includes('invalid token')) {
      console.error('Vault authentication failed, using cached secrets');
      if (fs.existsSync(cacheFilePath)) {
        return { secrets: JSON.parse(fs.readFileSync(cacheFilePath, 'utf-8')), secretPaths };
      }
      throw new Error('No cached secrets available');
    }
    throw err;
  }
}

// Function to push secrets to AWS Secrets Manager
async function pushSecretsToAWS(secretData) {
  const secretName = process.env.AWS_SECRET_NAME;
  const secretString = JSON.stringify(secretData);

  try {
    // Check if secret exists
    let secretExists = true;
    try {
      const secretDetails = await secretsManager.send(new DescribeSecretCommand({ SecretId: secretName }));
      await secretsManager.send(new PutSecretValueCommand({
        SecretId: secretName,
        SecretString: secretString
      }));
      console.log(`Updated secret ${secretName}`);
      return secretDetails.ARN;
    } catch (err) {
      if (err.name === 'ResourceNotFoundException') {
        const response = await secretsManager.send(new CreateSecretCommand({
          Name: secretName,
          SecretString: secretString
        }));
        console.log(`Created new secret ${secretName}`);
        return response.ARN;
      }
      throw err;
    }
  } catch (err) {
    throw new Error(`Failed to update AWS Secrets Manager: ${err.message}`);
  }
}

// Add this function near the top
function handleSyncFailure() {
  console.log('Handling sync failure...');
  // Add any failure handling logic here, like retries or notifications
}

// Modified updateEcsTaskDefinition to handle container-specific updates without prefixing
async function updateEcsTaskDefinition(secretArn, secretData, secretPaths) {
  const taskDefinitionName = process.env.ECS_TASK_DEFINITION;

  try {
    const { taskDefinition } = await ecs.send(new DescribeTaskDefinitionCommand({ 
      taskDefinition: taskDefinitionName 
    }));

    const updatedContainerDefinitions = taskDefinition.containerDefinitions.map(container => {
      // Find if this container has specific secrets to update
      const containerConfig = secretPaths.find(sp => sp.container === container.name) || 
        (!container.name && secretPaths[0]); // Fallback to first container if no name specified

      if (containerConfig) {
        const containerSecrets = Object.keys(secretData)
          .map(key => ({
            name: key,
            valueFrom: `${secretArn}:${key}::`
          }));

        return {
          ...container,
          secrets: containerSecrets.length ? containerSecrets : container.secrets
        };
      }
      return container;
    });

    await ecs.send(new RegisterTaskDefinitionCommand({
      family: taskDefinition.family,
      containerDefinitions: updatedContainerDefinitions,
      ...taskDefinition
    }));
    console.log('Task definition updated successfully');
  } catch (err) {
    throw new Error(`Failed to update ECS task definition: ${err.message}`);
  }
}

// Start periodic checking
const intervalInSeconds = process.env.CHECK_INTERVAL || 60;
setInterval(syncSecrets, intervalInSeconds * 1000);

// Initial sync
syncSecrets();