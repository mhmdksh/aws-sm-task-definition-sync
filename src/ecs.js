'use strict';

const { ECSClient } = require('@aws-sdk/client-ecs');
const {
  DescribeTaskDefinitionCommand,
  RegisterTaskDefinitionCommand,
} = require('@aws-sdk/client-ecs');
const logger = require('./logger');

const COMPONENT = 'ecs';

let client = null;

function initClient(config) {
  client = new ECSClient({ region: config.aws.region });
  logger.info(COMPONENT, 'ECS client initialized', { region: config.aws.region });
  return client;
}

function getClient() {
  if (!client) {
    throw new Error('ECS client not initialized. Call initClient() first.');
  }
  return client;
}

async function describeTaskDefinition(taskDefinitionName) {
  logger.debug(COMPONENT, 'Describing task definition', { taskDefinition: taskDefinitionName });
  try {
    const response = await getClient().send(
      new DescribeTaskDefinitionCommand({ taskDefinition: taskDefinitionName })
    );
    logger.debug(COMPONENT, 'Task definition retrieved', {
      family: response.taskDefinition.family,
      revision: response.taskDefinition.revision,
      status: response.taskDefinition.status,
    });
    return response.taskDefinition;
  } catch (err) {
    logger.error(
      COMPONENT,
      `Failed to describe task definition: ${taskDefinitionName}`,
      err
    );
    throw err;
  }
}

async function registerTaskDefinition(taskDef) {
  logger.info(COMPONENT, 'Registering new task definition', {
    family: taskDef.family,
  });
  try {
    const response = await getClient().send(
      new RegisterTaskDefinitionCommand({
        family: taskDef.family,
        containerDefinitions: taskDef.containerDefinitions,
        executionRoleArn: taskDef.executionRoleArn,
        taskRoleArn: taskDef.taskRoleArn,
        networkMode: taskDef.networkMode,
        cpu: taskDef.cpu,
        memory: taskDef.memory,
        requiresCompatibilities: taskDef.requiresCompatibilities,
        volumes: taskDef.volumes || [],
      })
    );
    logger.info(COMPONENT, 'Task definition registered', {
      family: response.taskDefinition.family,
      revision: response.taskDefinition.revision,
    });
    return response.taskDefinition;
  } catch (err) {
    logger.error(COMPONENT, 'Failed to register task definition', err);
    throw err;
  }
}

module.exports = {
  initClient,
  getClient,
  describeTaskDefinition,
  registerTaskDefinition,
  COMPONENT,
};
