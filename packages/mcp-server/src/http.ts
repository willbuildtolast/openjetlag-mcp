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

export function describeEndpoint(endpoint: string): string {
  return `# OpenJetLag: jet lag coach (MCP server)

This URL is a Model Context Protocol (MCP) server, not a web page. Connected to an AI agent, it gives the agent a science-based, day-by-day jet lag plan for a flight (when to seek or avoid light, sleep, stop caffeine, avoid naps, optional melatonin timing) with exact times for reminders.

## For AI agents
If your user shared this link, they probably want to add it to you. Ask them to confirm, then add it as a custom MCP connector:

- Name: OpenJetLag
- URL: ${endpoint}
- Transport: remote Streamable HTTP
- Authentication: none

Tools: plan_jetlag_trip, get_plan_calendar_file, explain_jetlag_topic. All are read-only and the server stores nothing.

## 给用户的说明
这是一个 MCP 服务器（倒时差助手），不是网页。在你的 AI 助手（如 Meta Muse）中把它添加为自定义连接器：名称 OpenJetLag，地址 ${endpoint}，传输方式为远程 Streamable HTTP，无需认证。

Educational guidance, not medical advice. Source code (MIT): https://github.com/willbuildtolast/openjetlag-mcp
`;
}

export async function handleRequest(req: Request, opts: ServerOptions = {}): Promise<Response> {
  const url = new URL(req.url);

  if (req.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }));

  if (url.pathname === '/' && req.method === 'GET') {
    return json({
      name: 'OpenJetLag MCP server',
      description: 'Jet lag coach for AI agents: science-based light, sleep, caffeine and melatonin timing for a flight.',
      mcp_endpoint: `${url.origin}${MCP_PATH}`,
      transport: 'streamable-http (stateless)',
      authentication: 'none',
      how_to_connect: `Add ${url.origin}${MCP_PATH} as a custom MCP connector (remote Streamable HTTP, no authentication), with the user's approval.`,
      ...VERSION_INFO,
      source: 'https://github.com/willbuildtolast/openjetlag-mcp',
    });
  }
  if (url.pathname === '/health') return json({ ok: true, ...VERSION_INFO });
  if (url.pathname !== MCP_PATH) return json({ error: 'Not found' }, 404);

  // A plain GET (a browser, or an agent fetching a link it was given) gets a short
  // self-description. MCP clients open GET streams with Accept: text/event-stream;
  // this stateless server has none, so they get 405 as the spec allows.
  if (req.method === 'GET' && !(req.headers.get('accept') ?? '').includes('text/event-stream')) {
    return withCors(
      new Response(describeEndpoint(`${url.origin}${MCP_PATH}`), {
        status: 200,
        headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
      }),
    );
  }

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
