'use strict';

const vault = require('node-vault');
const logger = require('./logger');

const COMPONENT = 'vault';

let client = null;

function initClient(config) {
  client = vault({
    apiVersion: 'v1',
    endpoint: config.vault.endpoint,
    token: config.vault.token,
  });
  logger.info(COMPONENT, 'Vault client initialized', { endpoint: config.vault.endpoint });
  return client;
}

function getClient() {
  if (!client) {
    throw new Error('Vault client not initialized. Call initClient() first.');
  }
  return client;
}

function buildPath(kvStore, secretPath, kvVersion) {
  if (kvVersion === 1) {
    return `${kvStore}/${secretPath}`;
  }
  return `${kvStore}/data/${secretPath}`;
}

function extractSecretData(response, kvVersion) {
  if (kvVersion === 1) {
    return response.data;
  }
  return response.data.data;
}

async function readSecret(kvStore, secretPath, kvVersion) {
  const fullPath = buildPath(kvStore, secretPath, kvVersion);
  logger.debug(COMPONENT, 'Reading Vault secret', { path: fullPath, kvVersion });

  try {
    const response = await getClient().read(fullPath);
    const secretData = extractSecretData(response, kvVersion);
    logger.info(COMPONENT, 'Secret read successfully', {
      path: fullPath,
      keys: Object.keys(secretData),
    });
    return secretData;
  } catch (err) {
    logger.error(COMPONENT, `Failed to read Vault secret at path: ${fullPath}`, err);
    throw err;
  }
}

async function readAllSecrets(config) {
  const { kvStore, kvVersion } = config.vault;
  const { secretPaths } = config;
  const allSecrets = {};

  logger.info(COMPONENT, 'Reading all configured Vault secrets', {
    kvStore,
    kvVersion,
    pathCount: secretPaths.length,
  });

  for (const { path: secretPath } of secretPaths) {
    const secrets = await readSecret(kvStore, secretPath, kvVersion);
    Object.assign(allSecrets, secrets);
  }

  logger.info(COMPONENT, 'All secrets collected', {
    totalKeys: Object.keys(allSecrets).length,
  });

  return allSecrets;
}

function isAuthError(err) {
  const msg = (err.message || '').toLowerCase();
  return msg.includes('permission denied') || msg.includes('invalid token');
}

module.exports = {
  initClient,
  getClient,
  buildPath,
  readSecret,
  readAllSecrets,
  isAuthError,
  COMPONENT,
};
