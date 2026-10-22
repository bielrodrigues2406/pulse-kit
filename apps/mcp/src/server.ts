import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { Dependencies } from './ports.js';
import { registerTools } from './tools.js';

export const SERVER_NAME = 'pulse-kit';
export const SERVER_VERSION = '0.1.0';

export function createServer(deps: Dependencies): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerTools(server, deps);
  return server;
}
