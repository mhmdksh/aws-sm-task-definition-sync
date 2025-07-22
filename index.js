const vault = require('node-vault');
const { SecretsManagerClient } = require('@aws-sdk/client-secrets-manager');
const { ECSClient } = require('@aws-sdk/client-ecs');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { DescribeSecretCommand, PutSecretValueCommand, CreateSecretCommand, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
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

// Cache configuration
const CACHE_MAX_AGE = parseInt(process.env.CACHE_MAX_AGE_MINUTES || '10') * 60 * 1000; // Default 10 minutes
const FORCE_REFRESH_INTERVAL = parseInt(process.env.FORCE_REFRESH_INTERVAL_MINUTES || '60') * 60 * 1000; // Default 1 hour
const STARTUP_CACHE_CLEAR = process.env.STARTUP_CACHE_CLEAR === 'true';
const DISABLE_CACHE_FALLBACK = process.env.DISABLE_CACHE_FALLBACK === 'true';
const QUIET_MODE = process.env.QUIET_MODE !== 'false'; // Default to true (quiet)

let lastForceRefresh = 0;

// Function to check if cache is expired
function isCacheExpired(cacheFilePath) {
  if (!fs.existsSync(cacheFilePath)) return true;
  const stats = fs.statSync(cacheFilePath);
  return (Date.now() - stats.mtime.getTime()) > CACHE_MAX_AGE;
}

// Function to check if force refresh is needed
function isForceRefreshNeeded() {
  return (Date.now() - lastForceRefresh) > FORCE_REFRESH_INTERVAL;
}

// Function to save cache with metadata
function saveCacheWithMetadata(secrets) {
  const cacheData = {
    timestamp: Date.now(),
    secrets: secrets
  };
  fs.writeFileSync(cacheFilePath, JSON.stringify(cacheData, null, 2));
  console.log(`Cache updated at ${new Date().toISOString()}`);
}

// Function to read cache with validation
function readCacheData() {
  if (!fs.existsSync(cacheFilePath)) return null;
  
  try {
    const data = JSON.parse(fs.readFileSync(cacheFilePath, 'utf-8'));
    // Support both old format (direct secrets) and new format (with metadata)
    if (data.timestamp && data.secrets) {
      if (!QUIET_MODE) console.log(`Using cache from ${new Date(data.timestamp).toISOString()}`);
      return data.secrets;
    } else {
      if (!QUIET_MODE) console.log('Using legacy cache format');
      return data;
    }
  } catch (error) {
    console.error('Error reading cache file:', error.message);
    return null;
  }
}

// Function to compare current secrets with last known state
function haveSecretsChanged(currentSecrets, lastKnownSecrets) {
  if (!lastKnownSecrets) return true;
  
  const currentKeys = Object.keys(currentSecrets).sort();
  const lastKnownKeys = Object.keys(lastKnownSecrets).sort();
  
  if (currentKeys.length !== lastKnownKeys.length) return true;
  
  return currentKeys.some(key => currentSecrets[key] !== lastKnownSecrets[key]);
}

// Main function to handle the complete sync process
async function syncSecrets() {
  try {
    // Check if cache should be cleared on startup
    if (STARTUP_CACHE_CLEAR && fs.existsSync(cacheFilePath)) {
      fs.unlinkSync(cacheFilePath);
      console.log('Startup cache cleared');
    }

    // Check if force refresh is needed
    const forceRefresh = isForceRefreshNeeded() || isCacheExpired(cacheFilePath);
    
    // Step 1: Read secrets from Vault
    const { secrets, secretPaths } = await readVaultSecrets();
    
    // Read last known state with validation
    let lastKnownSecrets = readCacheData();
    
    // Determine if sync is needed
    const needsSync = forceRefresh || haveSecretsChanged(secrets, lastKnownSecrets);
    
    if (needsSync) {
      if (forceRefresh) {
        console.log('Force refresh triggered, proceeding with AWS sync...');
        lastForceRefresh = Date.now();
      } else {
        console.log('Changes detected in Vault secrets, proceeding with AWS sync...');
      }
      
      // Step 2: Push secrets to AWS Secrets Manager
      const secretArn = await pushSecretsToAWS(secrets);
      
      // Step 3: Update ECS Task Definition
      await updateEcsTaskDefinition(secretArn, secrets, secretPaths);
      
      // Update the cache with new secrets and metadata
      saveCacheWithMetadata(secrets);
      console.log('Sync completed successfully');
    } else {
      if (!QUIET_MODE) console.log('No changes detected, skipping sync');
    }
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

// Modified readVaultSecrets to not write to cache file (we'll do this in syncSecrets)
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
    
    return { secrets: allSecrets, secretPaths };
  } catch (err) {
    if (err.message.includes('permission denied') || err.message.includes('invalid token')) {
      console.error('Vault authentication failed');
      
      if (DISABLE_CACHE_FALLBACK) {
        throw new Error('Vault authentication failed and cache fallback is disabled');
      }
      
      console.log('Attempting to use cached secrets...');
      const cachedSecrets = readCacheData();
      
      if (cachedSecrets) {
        console.log('Using cached secrets due to vault authentication failure');
        return { secrets: cachedSecrets, secretPaths };
      }
      
      throw new Error('No cached secrets available and vault authentication failed');
    }
    throw err;
  }
}

// Function to push secrets to AWS Secrets Manager
async function pushSecretsToAWS(secretData) {
  const secretName = process.env.AWS_SECRET_NAME;
  const secretString = JSON.stringify(secretData);

  try {
    // First, get the current secret value
    let currentSecretValue;
    try {
      const response = await secretsManager.send(new GetSecretValueCommand({
        SecretId: secretName
      }));
      currentSecretValue = response.SecretString;
    } catch (err) {
      if (err.name !== 'ResourceNotFoundException') {
        throw err;
      }
    }

    // Check if secret exists
    try {
      const secretDetails = await secretsManager.send(new DescribeSecretCommand({ 
        SecretId: secretName 
      }));

      // Only update if the values have changed
      if (currentSecretValue !== secretString) {
        await secretsManager.send(new PutSecretValueCommand({
          SecretId: secretName,
          SecretString: secretString
        }));
        console.log(`Updated secret ${secretName} with new values`);
      } else {
        if (!QUIET_MODE) console.log(`No changes in secret values for ${secretName}, skipping update`);
      }
      
      return secretDetails.ARN;
    } catch (err) {
      if (err.name === 'ResourceNotFoundException') {
        // Create new secret if it doesn't exist
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

    // Create a map of which secrets belong to which container based on vault paths
    const containerSecretMap = new Map();
    for (const { path, container } of secretPaths) {
      // Skip if no container specified
      if (!container) continue;

      // Get the secrets for this specific vault path
      const vaultPathSecrets = await vaultClient.read(`${process.env.VAULT_KV_STORE}/data/${path}`);
      
      // Store the secrets for this container
      containerSecretMap.set(container, Object.keys(vaultPathSecrets.data.data));
    }

    // Check for structural changes in each container's secrets
    let hasStructuralChanges = false;
    taskDefinition.containerDefinitions.forEach(container => {
      const containerName = container.name;
      const currentSecrets = new Set((container.secrets || []).map(s => s.name));
      const newSecrets = new Set(containerSecretMap.get(containerName) || []);

      if (currentSecrets.size !== newSecrets.size || 
          ![...currentSecrets].every(secret => newSecrets.has(secret))) {
        hasStructuralChanges = true;
        console.log(`Structural changes detected for container ${containerName}:`);
        console.log('Current secrets:', [...currentSecrets]);
        console.log('New secrets:', [...newSecrets]);
      }
    });

    if (!hasStructuralChanges) {
      if (!QUIET_MODE) console.log('No changes in secret structure for any container, skipping task definition update');
      return;
    }

    // Update task definition with container-specific secrets
    const updatedContainerDefinitions = taskDefinition.containerDefinitions.map(container => {
      const updatedContainer = { ...container };
      const containerName = container.name;
      
      // Only update containers that have specified secrets
      if (containerSecretMap.has(containerName)) {
        const containerSecretNames = containerSecretMap.get(containerName);
        
        // Update container secrets
        updatedContainer.secrets = containerSecretNames.map(secretName => ({
          name: secretName,
          valueFrom: `${secretArn}:${secretName}::`
        }));
      }

      // Preserve log configuration secrets
      if (container.logConfiguration?.secretOptions) {
        updatedContainer.logConfiguration = {
          ...container.logConfiguration,
          secretOptions: container.logConfiguration.secretOptions
        };
      }

      return updatedContainer;
    });

    await ecs.send(new RegisterTaskDefinitionCommand({
      family: taskDefinition.family,
      containerDefinitions: updatedContainerDefinitions,
      executionRoleArn: taskDefinition.executionRoleArn,
      taskRoleArn: taskDefinition.taskRoleArn,
      networkMode: taskDefinition.networkMode,
      cpu: taskDefinition.cpu,
      memory: taskDefinition.memory,
      requiresCompatibilities: taskDefinition.requiresCompatibilities,
      volumes: taskDefinition.volumes || []
    }));
    
    console.log('Task definition updated with container-specific secret changes');
  } catch (err) {
    throw new Error(`Failed to update ECS task definition: ${err.message}`);
  }
}

// Start periodic checking
const intervalInSeconds = process.env.CHECK_INTERVAL || 60;
setInterval(syncSecrets, intervalInSeconds * 1000);

// Initial sync
syncSecrets();