'use strict';

/**
 * Structured logger with timestamps, log levels, and component tags.
 * Provides detailed error formatting for AWS SDK and Vault errors.
 */

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = process.env.LOG_LEVEL
  ? (LOG_LEVELS[process.env.LOG_LEVEL.toLowerCase()] ?? LOG_LEVELS.info)
  : LOG_LEVELS.info;

function formatTimestamp() {
  return new Date().toISOString();
}

function formatLogEntry(level, component, message, data) {
  const timestamp = formatTimestamp();
  const prefix = `[${timestamp}] [${level.toUpperCase()}] [${component}]`;
  return { timestamp, level, component, message, data, prefix };
}

/**
 * Format an error object for detailed logging.
 * Extracts relevant fields from AWS SDK errors, Vault errors, and standard errors.
 */
function formatError(err) {
  if (!err) return '(no error details)';

  const details = {
    message: err.message || String(err),
    name: err.name,
  };

  // AWS SDK v3 errors
  if (err.$metadata) {
    details.statusCode = err.$metadata.httpStatusCode;
    details.requestId = err.$metadata.requestId;
    details.service = err.$metadata.serviceId || err.$metadata.service;
    details.region = err.$metadata.region || process.env.AWS_REGION;
    details.extendedRequestId = err.$metadata.extendedRequestId;
    details.attempts = err.$metadata.attempts;
  }

  // AWS SDK v3 error type
  if (err.$fault) {
    details.fault = err.$fault;
  }

  // Vault / node-vault errors
  if (err.response) {
    details.statusCode = details.statusCode || err.response.statusCode;
    details.body = err.response.body;
    // Vault API errors are often in body.errors[]
    if (err.response.body && err.response.body.errors) {
      details.vaultErrors = err.response.body.errors;
    }
  }

  // HTTP-style errors
  if (err.statusCode) {
    details.statusCode = details.statusCode || err.statusCode;
  }
  if (err.statusMessage) {
    details.statusMessage = err.statusMessage;
  }

  return details;
}

function shouldLog(level) {
  return LOG_LEVELS[level] >= currentLevel;
}

const logger = {
  debug(component, message, data) {
    if (!shouldLog('debug')) return;
    const entry = formatLogEntry('debug', component, message, data);
    console.log(`${entry.prefix} ${message}`, data !== undefined ? data : '');
  },

  info(component, message, data) {
    if (!shouldLog('info')) return;
    const entry = formatLogEntry('info', component, message, data);
    console.log(`${entry.prefix} ${message}`, data !== undefined ? data : '');
  },

  warn(component, message, data) {
    if (!shouldLog('warn')) return;
    const entry = formatLogEntry('warn', component, message, data);
    console.warn(`${entry.prefix} ${message}`, data !== undefined ? data : '');
  },

  error(component, message, err) {
    if (!shouldLog('error')) return;
    const entry = formatLogEntry('error', component, message, err ? formatError(err) : undefined);
    console.error(`${entry.prefix} ${message}`);

    if (err) {
      const details = formatError(err);
      console.error(`  Message: ${details.message}`);
      if (details.name && details.name !== 'Error') {
        console.error(`  Error Type: ${details.name}`);
      }
      if (details.statusCode) {
        console.error(`  HTTP Status: ${details.statusCode}`);
      }
      if (details.requestId) {
        console.error(`  Request ID: ${details.requestId}`);
      }
      if (details.service) {
        console.error(`  Service: ${details.service}`);
      }
      if (details.region) {
        console.error(`  Region: ${details.region}`);
      }
      if (details.body) {
        console.error(`  Response Body: ${JSON.stringify(details.body)}`);
      }
      if (details.vaultErrors && details.vaultErrors.length > 0) {
        details.vaultErrors.forEach((ve) => console.error(`  Vault Error: ${ve}`));
      }

      // Print stack trace in debug mode
      if (currentLevel <= LOG_LEVELS.debug && err.stack) {
        console.error(`  Stack:\n${err.stack}`);
      }
    }
  },

  /**
   * Log a fatal error before process exit.
   */
  fatal(component, message, err) {
    logger.error(component, message, err);
    console.error(`[FATAL] ${component}: ${message}`);
  },
};

module.exports = logger;
