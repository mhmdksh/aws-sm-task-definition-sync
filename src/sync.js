'use strict';

const logger = require('./logger');
const cache = require('./cache');
const vault = require('./vault');
const sm = require('./secrets-manager');
const ecs = require('./ecs');

const COMPONENT = 'sync';

let config;
let lastForceRefresh = 0;

function init(cfg) {
  config = cfg;
}

function haveSecretsChanged(currentSecrets, lastKnownSecrets) {
  if (!lastKnownSecrets) return true;

  const currentKeys = Object.keys(currentSecrets).sort();
  const lastKnownKeys = Object.keys(lastKnownSecrets).sort();

  if (currentKeys.length !== lastKnownKeys.length) {
    logger.info(COMPONENT, 'Secret key count changed', {
      current: currentKeys.length,
      previous: lastKnownKeys.length,
    });
    return true;
  }

  const changed = currentKeys.some((key) => currentSecrets[key] !== lastKnownSecrets[key]);
  if (changed) {
    logger.info(COMPONENT, 'Secret values changed');
  }
  return changed;
}

function isForceRefreshNeeded() {
  const elapsed = Date.now() - lastForceRefresh;
  return elapsed > config.cache.forceRefreshIntervalMs;
}

async function readSecretsWithFallback() {
  try {
    const secrets = await vault.readAllSecrets(config);
    return { secrets, fromCache: false };
  } catch (err) {
    if (vault.isAuthError(err)) {
      logger.error(COMPONENT, 'Vault authentication failed', err);

      if (config.cache.disableFallback) {
        throw new Error('Vault authentication failed and cache fallback is disabled');
      }

      logger.warn(COMPONENT, 'Attempting to use cached secrets as fallback');
      const cachedSecrets = cache.read(config.cacheFilePath, config.quietMode);

      if (cachedSecrets) {
        logger.info(COMPONENT, 'Using cached secrets due to Vault authentication failure');
        return { secrets: cachedSecrets, fromCache: true };
      }

      throw new Error('No cached secrets available and Vault authentication failed');
    }
    throw err;
  }
}

async function updateEcsTaskDefinition(secretArn, secretData, secretPaths) {
  const taskDefinitionName = config.aws.ecsTaskDefinition;
  logger.info(COMPONENT, 'Checking ECS task definition for updates', {
    taskDefinition: taskDefinitionName,
  });

  const taskDefinition = await ecs.describeTaskDefinition(taskDefinitionName);

  const containerSecretMap = new Map();
  for (const { path: secretPath, container } of secretPaths) {
    if (!container) continue;

    const vaultPathSecrets = await vault.readSecret(config.vault.kvStore, secretPath);
    containerSecretMap.set(container, Object.keys(vaultPathSecrets));
  }

  let hasStructuralChanges = false;
  taskDefinition.containerDefinitions.forEach((container) => {
    const containerName = container.name;
    const currentSecrets = new Set((container.secrets || []).map((s) => s.name));
    const newSecrets = new Set(containerSecretMap.get(containerName) || []);

    if (
      currentSecrets.size !== newSecrets.size ||
      ![...currentSecrets].every((secret) => newSecrets.has(secret))
    ) {
      hasStructuralChanges = true;
      logger.info(COMPONENT, `Structural changes detected for container: ${containerName}`, {
        currentSecrets: [...currentSecrets],
        newSecrets: [...newSecrets],
      });
    }
  });

  if (!hasStructuralChanges) {
    if (!config.quietMode) {
      logger.info(COMPONENT, 'No structural changes in any container, skipping task definition update');
    }
    return;
  }

  const updatedContainerDefinitions = taskDefinition.containerDefinitions.map((container) => {
    const updatedContainer = { ...container };
    const containerName = container.name;

    if (containerSecretMap.has(containerName)) {
      const containerSecretNames = containerSecretMap.get(containerName);
      updatedContainer.secrets = containerSecretNames.map((secretName) => ({
        name: secretName,
        valueFrom: `${secretArn}:${secretName}::`,
      }));
    }

    if (container.logConfiguration && container.logConfiguration.secretOptions) {
      updatedContainer.logConfiguration = {
        ...container.logConfiguration,
        secretOptions: container.logConfiguration.secretOptions,
      };
    }

    return updatedContainer;
  });

  await ecs.registerTaskDefinition({
    ...taskDefinition,
    containerDefinitions: updatedContainerDefinitions,
  });

  logger.info(COMPONENT, 'Task definition updated with container-specific secret changes');
}

function handleSyncFailure(err) {
  logger.error(COMPONENT, 'Sync failure - entering failure handling', err);
  logger.warn(COMPONENT, 'Will retry on next interval');
}

async function syncSecrets() {
  const cycleStart = Date.now();
  logger.info(COMPONENT, 'Starting sync cycle');

  try {
    if (config.cache.startupClear && cache.exists(config.cacheFilePath)) {
      cache.remove(config.cacheFilePath);
    }

    const forceRefresh = isForceRefreshNeeded() || cache.isExpired(config.cacheFilePath, config.cache.maxAgeMs);

    const { secrets, fromCache } = await readSecretsWithFallback();

    if (fromCache) {
      logger.info(COMPONENT, 'Proceeding with cached secrets');
    }

    const lastKnownSecrets = cache.read(config.cacheFilePath, config.quietMode);
    const needsSync = forceRefresh || haveSecretsChanged(secrets, lastKnownSecrets);

    if (needsSync) {
      if (forceRefresh) {
        logger.info(COMPONENT, 'Force refresh triggered, proceeding with AWS sync');
        lastForceRefresh = Date.now();
      } else {
        logger.info(COMPONENT, 'Changes detected, proceeding with AWS sync');
      }

      const secretArn = await sm.syncSecret(
        config.aws.secretName,
        secrets,
        config.quietMode
      );

      await updateEcsTaskDefinition(secretArn, secrets, config.secretPaths);

      cache.write(config.cacheFilePath, secrets);
      logger.info(COMPONENT, 'Sync cycle completed successfully', {
        durationMs: Date.now() - cycleStart,
      });
    } else {
      if (!config.quietMode) {
        logger.info(COMPONENT, 'No changes detected, skipping sync');
      }
    }
  } catch (err) {
    logger.error(COMPONENT, 'Sync cycle failed', err);
    handleSyncFailure(err);
  }
}

module.exports = { init, syncSecrets };
