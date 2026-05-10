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

function buildPath(kvStore, secretPath) {
  return `${kvStore}/data/${secretPath}`;
}

async function readSecret(kvStore, secretPath) {
  const fullPath = buildPath(kvStore, secretPath);
  logger.debug(COMPONENT, 'Reading Vault secret', { path: fullPath });

  try {
    const secret = await getClient().read(fullPath);
    logger.info(COMPONENT, 'Secret read successfully', {
      path: fullPath,
      keys: Object.keys(secret.data.data),
    });
    return secret.data.data;
  } catch (err) {
    logger.error(COMPONENT, `Failed to read Vault secret at path: ${fullPath}`, err);
    throw err;
  }
}

async function readAllSecrets(config) {
  const { kvStore } = config.vault;
  const { secretPaths } = config;
  const allSecrets = {};

  logger.info(COMPONENT, 'Reading all configured Vault secrets', {
    kvStore,
    pathCount: secretPaths.length,
  });

  for (const { path: secretPath } of secretPaths) {
    const secrets = await readSecret(kvStore, secretPath);
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
