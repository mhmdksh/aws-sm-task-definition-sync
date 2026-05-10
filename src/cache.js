'use strict';

const fs = require('fs');
const logger = require('./logger');

const COMPONENT = 'cache';

function exists(filePath) {
  return fs.existsSync(filePath);
}

function remove(filePath) {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    logger.info(COMPONENT, 'Cache file removed', { path: filePath });
  }
}

function isExpired(filePath, maxAgeMs) {
  if (!fs.existsSync(filePath)) {
    logger.debug(COMPONENT, 'Cache file does not exist, considered expired');
    return true;
  }
  const stats = fs.statSync(filePath);
  const age = Date.now() - stats.mtime.getTime();
  const expired = age > maxAgeMs;
  if (expired) {
    logger.debug(COMPONENT, 'Cache expired', {
      ageMinutes: Math.round(age / 60000),
      maxAgeMinutes: Math.round(maxAgeMs / 60000),
    });
  }
  return expired;
}

function write(filePath, secrets) {
  const cacheData = {
    timestamp: Date.now(),
    secrets,
  };
  fs.writeFileSync(filePath, JSON.stringify(cacheData, null, 2));
  logger.info(COMPONENT, 'Cache updated', { timestamp: new Date().toISOString() });
}

function read(filePath, quietMode) {
  if (!fs.existsSync(filePath)) {
    logger.debug(COMPONENT, 'No cache file found');
    return null;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);

    if (data.timestamp && data.secrets) {
      if (!quietMode) {
        logger.info(COMPONENT, 'Using cached secrets', {
          timestamp: new Date(data.timestamp).toISOString(),
        });
      }
      return data.secrets;
    }

    // Legacy format: direct secrets object without metadata
    if (!quietMode) {
      logger.info(COMPONENT, 'Using legacy cache format');
    }
    return data;
  } catch (err) {
    logger.error(COMPONENT, 'Failed to read cache file', err);
    return null;
  }
}

module.exports = { exists, remove, isExpired, write, read };
