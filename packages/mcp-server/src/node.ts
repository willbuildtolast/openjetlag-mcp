// Node.js entry point, for local development and self-hosting.
import { serve } from '@hono/node-server';
import { MCP_PATH, handleRequest } from './http.js';

const port = Number(process.env.PORT ?? 8787);
const hostname = process.env.HOST ?? '127.0.0.1';

serve({ fetch: (req) => handleRequest(req), port, hostname }, (info) => {
  console.log(`OpenJetLag MCP server listening on http://${info.address}:${info.port}${MCP_PATH}`);
});
