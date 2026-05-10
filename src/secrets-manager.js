'use strict';

const { SecretsManagerClient } = require('@aws-sdk/client-secrets-manager');
const {
  DescribeSecretCommand,
  PutSecretValueCommand,
  CreateSecretCommand,
  GetSecretValueCommand,
} = require('@aws-sdk/client-secrets-manager');
const logger = require('./logger');

const COMPONENT = 'secrets-manager';

let client = null;

function initClient(config) {
  client = new SecretsManagerClient({ region: config.aws.region });
  logger.info(COMPONENT, 'Secrets Manager client initialized', { region: config.aws.region });
  return client;
}

function getClient() {
  if (!client) {
    throw new Error('Secrets Manager client not initialized. Call initClient() first.');
  }
  return client;
}

async function getSecretValue(secretName) {
  logger.debug(COMPONENT, 'Getting secret value', { secretName });
  try {
    const response = await getClient().send(
      new GetSecretValueCommand({ SecretId: secretName })
    );
    logger.debug(COMPONENT, 'Secret value retrieved', { secretName });
    return response.SecretString;
  } catch (err) {
    if (err.name === 'ResourceNotFoundException') {
      logger.info(COMPONENT, 'Secret not found', { secretName });
      throw err;
    }
    logger.error(COMPONENT, `Failed to get secret value for: ${secretName}`, err);
    throw err;
  }
}

async function describeSecret(secretName) {
  logger.debug(COMPONENT, 'Describing secret', { secretName });
  try {
    const response = await getClient().send(
      new DescribeSecretCommand({ SecretId: secretName })
    );
    logger.debug(COMPONENT, 'Secret described', { secretName, arn: response.ARN });
    return response;
  } catch (err) {
    if (err.name === 'ResourceNotFoundException') {
      logger.info(COMPONENT, 'Secret does not exist, will create', { secretName });
      throw err;
    }
    logger.error(COMPONENT, `Failed to describe secret: ${secretName}`, err);
    throw err;
  }
}

async function createSecret(secretName, secretValue) {
  logger.info(COMPONENT, 'Creating secret', { secretName });
  try {
    const response = await getClient().send(
      new CreateSecretCommand({
        Name: secretName,
        SecretString: secretValue,
      })
    );
    logger.info(COMPONENT, 'Secret created', { secretName, arn: response.ARN });
    return response;
  } catch (err) {
    logger.error(COMPONENT, `Failed to create secret: ${secretName}`, err);
    throw err;
  }
}

async function updateSecretValue(secretName, secretValue) {
  logger.info(COMPONENT, 'Updating secret value', { secretName });
  try {
    await getClient().send(
      new PutSecretValueCommand({
        SecretId: secretName,
        SecretString: secretValue,
      })
    );
    logger.info(COMPONENT, 'Secret value updated', { secretName });
  } catch (err) {
    logger.error(COMPONENT, `Failed to update secret value: ${secretName}`, err);
    throw err;
  }
}

async function syncSecret(secretName, secretData, quietMode) {
  const secretString = JSON.stringify(secretData);
  logger.info(COMPONENT, 'Syncing secret to AWS', {
    secretName,
    keyCount: Object.keys(secretData).length,
  });

  let currentSecretValue = null;
  try {
    currentSecretValue = await getSecretValue(secretName);
  } catch (err) {
    if (err.name !== 'ResourceNotFoundException') {
      throw err;
    }
  }

  try {
    const secretDetails = await describeSecret(secretName);

    if (currentSecretValue !== secretString) {
      await updateSecretValue(secretName, secretString);
    } else {
      if (!quietMode) {
        logger.info(COMPONENT, 'No changes in secret values, skipping update', { secretName });
      }
    }

    return secretDetails.ARN;
  } catch (err) {
    if (err.name === 'ResourceNotFoundException') {
      const response = await createSecret(secretName, secretString);
      return response.ARN;
    }
    throw err;
  }
}

module.exports = { initClient, getClient, syncSecret, COMPONENT };
