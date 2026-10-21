// Runtime-agnostic HTTP handler (Web standard Request -> Response).
// Stateless: every request gets a fresh server + transport, nothing is kept between
// requests, and no request content is logged or stored.

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { VERSION_INFO, createServer, type ServerOptions } from './server.js';

export const MCP_PATH = '/mcp';
const MAX_BODY_BYTES = 64 * 1024;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Max-Age': '86400',
};

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return withCors(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...extra } }),
  );
}

function jsonRpcError(status: number, message: string, extra: Record<string, string> = {}): Response {
  return json({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }, status, extra);
}

export async function handleRequest(req: Request, opts: ServerOptions = {}): Promise<Response> {
  const url = new URL(req.url);

  if (req.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }));

  if (url.pathname === '/' && req.method === 'GET') {
    return json({
      name: 'OpenJetLag MCP server',
      mcp_endpoint: MCP_PATH,
      transport: 'streamable-http (stateless)',
      ...VERSION_INFO,
      source: 'https://github.com/willbuildtolast/openjetlag-mcp',
    });
  }
  if (url.pathname === '/health') return json({ ok: true, ...VERSION_INFO });
  if (url.pathname !== MCP_PATH) return json({ error: 'Not found' }, 404);

  // Stateless server: no server-initiated SSE stream and no sessions to delete.
  if (req.method !== 'POST') return jsonRpcError(405, 'Method not allowed. Send JSON-RPC requests with POST.', { Allow: 'POST, OPTIONS' });

  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return jsonRpcError(413, 'Request body too large.');

  const server = createServer(opts);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: MAX_BODY_BYTES,
  });
  try {
    await server.connect(transport);
    return withCors(await transport.handleRequest(req));
  } catch {
    return jsonRpcError(500, 'Internal server error.');
  }
}
