'use strict';

const { loadConfig } = require('./config');
const vault = require('./vault');
const sm = require('./secrets-manager');
const ecs = require('./ecs');
const sync = require('./sync');
const logger = require('./logger');

const COMPONENT = 'main';

try {
  const config = loadConfig();

  vault.initClient(config);
  sm.initClient(config);
  ecs.initClient(config);
  sync.init(config);

  logger.info(COMPONENT, 'Application started', {
    checkInterval: config.checkInterval,
    secretName: config.aws.secretName,
    taskDefinition: config.aws.ecsTaskDefinition,
  });

  // Initial sync
  sync.syncSecrets();

  // Periodic sync
  setInterval(() => {
    sync.syncSecrets();
  }, config.checkInterval * 1000);
} catch (err) {
  logger.fatal(COMPONENT, 'Failed to start application', err);
  process.exit(1);
}
