'use strict';

const path = require('path');
const dotenv = require('dotenv');

// Load .env file before reading process.env
dotenv.config();

const logger = require('./logger');

const COMPONENT = 'config';

/**
 * Get all secret paths from environment variables.
 * Supports both single VAULT_SECRET_PATH and numbered VAULT_SECRET_PATH_1..N
 */
function getSecretPaths() {
  const paths = [];
  let i = 1;
  while (process.env[`VAULT_SECRET_PATH_${i}`]) {
    paths.push({
      path: process.env[`VAULT_SECRET_PATH_${i}`],
      container: process.env[`CONTAINER_NAME_${i}`] || null,
    });
    i++;
  }

  // Fallback to singular form for backwards compatibility
  if (paths.length === 0 && process.env.VAULT_SECRET_PATH) {
    paths.push({
      path: process.env.VAULT_SECRET_PATH,
      container: process.env.CONTAINER_NAME || null,
    });
  }

  return paths;
}

/**
 * Validate that all required environment variables are present.
 * Returns an array of missing variable names.
 */
function validateConfig() {
  const required = [
    'VAULT_ENDPOINT',
    'VAULT_TOKEN',
    'VAULT_KV_STORE',
    'AWS_REGION',
    'AWS_SECRET_NAME',
    'ECS_TASK_DEFINITION',
  ];

  const missing = required.filter((key) => !process.env[key]);

  // Also check that at least one secret path is configured
  const secretPaths = getSecretPaths();
  if (secretPaths.length === 0) {
    missing.push('VAULT_SECRET_PATH_1 (or VAULT_SECRET_PATH)');
  }

  return missing;
}

/**
 * Load and return the full application configuration.
 */
function loadConfig() {
  const missing = validateConfig();
  if (missing.length > 0) {
    logger.error(COMPONENT, 'Missing required environment variables', { missing });
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const config = {
    // Vault
    vault: {
      endpoint: process.env.VAULT_ENDPOINT,
      token: process.env.VAULT_TOKEN,
      kvStore: process.env.VAULT_KV_STORE,
      kvVersion: parseInt(process.env.VAULT_KV_VERSION || '2', 10),
    },

    // AWS
    aws: {
      region: process.env.AWS_REGION,
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      secretName: process.env.AWS_SECRET_NAME,
      ecsTaskDefinition: process.env.ECS_TASK_DEFINITION,
    },

    // Secret paths from Vault
    secretPaths: getSecretPaths(),

    // Sync interval (seconds)
    checkInterval: parseInt(process.env.CHECK_INTERVAL || '60', 10),

    // Cache settings
    cache: {
      maxAgeMs: parseInt(process.env.CACHE_MAX_AGE_MINUTES || '10', 10) * 60 * 1000,
      forceRefreshIntervalMs:
        parseInt(process.env.FORCE_REFRESH_INTERVAL_MINUTES || '60', 10) * 60 * 1000,
      startupClear: process.env.STARTUP_CACHE_CLEAR === 'true',
      disableFallback: process.env.DISABLE_CACHE_FALLBACK === 'true',
    },

    // Logging
    quietMode: process.env.QUIET_MODE !== 'false', // Default to true (quiet)

    // File paths
    cacheFilePath: path.resolve(__dirname, '..', '.last.cache.json'),
  };

  logger.info(COMPONENT, 'Configuration loaded', {
    vaultEndpoint: config.vault.endpoint ? '(set)' : '(not set)',
    kvVersion: config.vault.kvVersion,
    awsRegion: config.aws.region,
    secretName: config.aws.secretName,
    ecsTaskDefinition: config.aws.ecsTaskDefinition,
    secretPathsCount: config.secretPaths.length,
    checkInterval: config.checkInterval,
    quietMode: config.quietMode,
  });

  return config;
}

module.exports = { loadConfig, getSecretPaths, validateConfig };
