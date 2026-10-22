#!/usr/bin/env node
// stdout carries JSON-RPC frames only; every diagnostic goes to stderr.

import { setTimeout as sleep } from 'node:timers/promises';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createGithubWorkflowRunner } from './adapters/github-actions.js';
import { createGoogleDriveReader } from './adapters/google-drive.js';
import { createLocalFiles } from './adapters/local-files.js';
import { readConfig } from './config.js';
import { createServer } from './server.js';

const config = readConfig(process.env);
const server = createServer({
  drive: config.google === null ? null : createGoogleDriveReader(config.google),
  driveRootFolderId: config.driveRootFolderId,
  workflow: config.github === null ? null : createGithubWorkflowRunner(config.github),
  files: createLocalFiles(config.recordingsDir),
  now: () => new Date(),
  timeZone: config.timeZone,
  sleep: async (ms) => {
    await sleep(ms);
  },
});

await server.connect(new StdioServerTransport());
process.stderr.write(
  `pulse-kit MCP pronto (Drive: ${config.google === null ? 'nao configurado' : 'ok'}, GitHub: ${config.github === null ? 'nao configurado' : 'ok'})\n`,
);
