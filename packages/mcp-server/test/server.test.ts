// End-to-end tests over the real MCP protocol: the official SDK client talks to the
// HTTP handler exactly as a remote host (Muse, ChatGPT, Claude...) would.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it } from 'vitest';
import { handleRequest } from '../src/http.js';

const BASE = 'https://openjetlag.test';
const FIXED_NOW = new Date('2026-10-21T12:00:00Z');
const directFetch = (input: string | URL | Request, init?: RequestInit) =>
  handleRequest(new Request(input, init), { now: () => FIXED_NOW });

const clients: Client[] = [];
async function connect(): Promise<Client> {
  const client = new Client({ name: 'test-host', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { fetch: directFetch }));
  clients.push(client);
  return client;
}
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

const TRIP = {
  origin_time_zone: 'America/New_York',
  destination_time_zone: 'Europe/London',
  departure_date: '2026-11-10',
  departure_time: '19:00',
  arrival_date: '2026-11-11',
  arrival_time: '07:00',
  usual_bedtime: '23:00',
  usual_wake_time: '07:00',
};

type TextResult = { content: Array<{ type: string; text: string }>; structuredContent?: any; isError?: boolean };
const call = async (c: Client, name: string, args: Record<string, unknown>) =>
  (await c.callTool({ name, arguments: args })) as TextResult;

describe('protocol', () => {
  it('initializes with server info and agent instructions', async () => {
    const c = await connect();
    expect(c.getServerVersion()).toMatchObject({ name: 'openjetlag', version: '0.2.0' });
    expect(c.getInstructions()).toMatch(/plan_jetlag_trip/);
    expect(c.getInstructions()).toMatch(/never suggest a melatonin dose/);
    expect(c.getInstructions()).toMatch(/Don't ask permission first and don't hand over a calendar file/);
  });

  it('lists three read-only tools with input schemas', async () => {
    const { tools } = await (await connect()).listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['explain_jetlag_topic', 'get_plan_calendar_file', 'plan_jetlag_trip']);
    for (const t of tools) {
      expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
      expect(t.inputSchema.type).toBe('object');
      expect(t.description!.length).toBeGreaterThan(40);
    }
    const plan = tools.find((t) => t.name === 'plan_jetlag_trip')!;
    expect(plan.inputSchema.required).toEqual(expect.arrayContaining(['origin_time_zone', 'arrival_time', 'usual_wake_time']));
  });
});

describe('plan_jetlag_trip', () => {
  it('returns the plan, assistant next steps and proactive check-ins (facts, not scripts)', async () => {
    const r = await call(await connect(), 'plan_jetlag_trip', TRIP);
    expect(r.isError).toBeFalsy();
    const text = r.content[0].text;
    expect(text).toMatch(/America\/New_York → Europe\/London \(\+5 h\)/);
    expect(text).toMatch(/Safety notes/);
    expect(text).toMatch(/\[2026-11-11T07:00:00\+00:00\]/);
    expect(text).toMatch(/FOR THE ASSISTANT/);
    expect(text).toMatch(/without asking first/);
    expect(text).toMatch(/These are not scripts/);
    expect(text).toMatch(/pre_trip_days: 3/);

    const s = r.structuredContent;
    expect(s.status).toBe('ok');
    expect(s.summary.strategy).toBe('advance');
    expect(s.settings).toMatchObject({ pre_trip_days: 3, pre_trip_days_reduced: false, melatonin: true, language: 'en' });

    const msgs = s.scheduled_messages;
    expect(msgs.length).toBeGreaterThan(8);
    const sends = msgs.map((m: any) => Date.parse(m.send_at_utc));
    expect(sends).toEqual([...sends].sort((a: number, b: number) => a - b));
    for (const m of msgs) {
      expect(Date.parse(m.send_at)).toBe(Date.parse(m.send_at_utc));
      expect(['morning_briefing', 'flight', 'wind_down', 'nudge']).toContain(m.type);
      expect(m).not.toHaveProperty('draft');
      expect(m.focus.length).toBeGreaterThan(0);
      for (const f of m.focus) {
        expect(f.when).toMatch(/^\d{2}:\d{2}/);
        expect(f.why.length).toBeGreaterThan(5);
        expect(text).toContain(`${f.when} ${f.action}`);
      }
      expect(JSON.stringify(m)).not.toMatch(/\d\s*mg/i);
    }
    // About 3-4 messages a day, not one per event.
    const perDay = new Map<string, number>();
    for (const m of msgs) perDay.set(m.send_at.slice(0, 10), (perDay.get(m.send_at.slice(0, 10)) ?? 0) + 1);
    for (const n of perDay.values()) expect(n).toBeLessThanOrEqual(5);
    expect(msgs.length).toBeLessThan(s.events.length / 2);

    // Never sent during planned sleep (wind-downs come before it).
    const sleeps = s.events.filter((e: any) => e.kind === 'sleep' || e.kind === 'in_flight_sleep');
    for (const m of msgs.filter((x: any) => x.type !== 'wind_down')) {
      const t = Date.parse(m.send_at_utc);
      for (const e of sleeps) expect(t > Date.parse(e.start.utc) && t < Date.parse(e.end.utc)).toBe(false);
    }

    // Briefings go out at wake-up and carry the trip context.
    const first = msgs[0];
    expect(first).toMatchObject({ type: 'morning_briefing', send_at: '2026-11-07T07:00:00-05:00' });
    expect(first.trip).toMatchObject({ moment: '3 days before departure', destination: 'London', days_to_departure: 3, day_in_destination: null, first_day_of_plan: true, body_clock_adjusted_hours: 0, body_clock_total_hours: 5 });
    expect(first.focus.map((f: any) => f.kind)).toEqual(['meal', 'seek_light']);
    expect(first.later_today.map((x: any) => x.kind)).toEqual(expect.arrayContaining(['caffeine_cutoff', 'sleep']));
    const arrival = msgs.find((m: any) => m.trip.day_in_destination === 1 && m.type === 'morning_briefing');
    expect(arrival.send_at).toBe('2026-11-11T07:00:00+00:00');
    expect(arrival.trip.body_clock_adjusted_hours).toBe(4); // 3 h before leaving + 1 h over the flight night
  });

  it('uses the traveller\'s city names and language in the notes', async () => {
    const r = await call(await connect(), 'plan_jetlag_trip', { ...TRIP, language: 'zh', origin_city: '纽约', destination_city: '伦敦' });
    const msgs = r.structuredContent.scheduled_messages;
    expect(msgs[0].trip.moment).toBe('出发前 3 天');
    expect(msgs.some((m: any) => m.trip.moment === '抵达伦敦第 1 天')).toBe(true);
    expect(msgs[0].focus.find((f: any) => f.kind === 'seek_light').action).toBe('晒光');
    expect(r.content[0].text).toMatch(/以下只是事实和意图，措辞由你决定/);
  });

  it('plans fewer pre-trip days when departure is soon, and respects an explicit value', async () => {
    const c = await connect();
    // FIXED_NOW is 2026-10-21; depart on the 22nd -> only 1 day available.
    const soon = { ...TRIP, departure_date: '2026-10-22', arrival_date: '2026-10-23' };
    const auto = (await call(c, 'plan_jetlag_trip', soon)).structuredContent;
    expect(auto.settings).toMatchObject({ pre_trip_days: 1, pre_trip_days_reduced: true });
    expect(auto.days.filter((d: any) => d.phase === 'pre_trip')).toHaveLength(1);
    const explicit = (await call(c, 'plan_jetlag_trip', { ...soon, pre_trip_days: 3 })).structuredContent;
    expect(explicit.settings).toMatchObject({ pre_trip_days: 3, pre_trip_days_reduced: false });
  });

  it('only returns messages that are still ahead', async () => {
    const r = await call(await connect(), 'plan_jetlag_trip', { ...TRIP, starting_from: '2026-11-11T08:00:00+00:00' });
    const msgs = r.structuredContent.scheduled_messages;
    expect(msgs.length).toBeGreaterThan(0);
    for (const m of msgs) expect(Date.parse(m.send_at_utc)).toBeGreaterThanOrEqual(Date.parse('2026-11-11T08:00:00Z'));
  });

  it('renders in Chinese', async () => {
    const r = await call(await connect(), 'plan_jetlag_trip', { ...TRIP, language: 'zh' });
    expect(r.content[0].text).toMatch(/倒时差计划/);
    expect(r.content[0].text).toMatch(/拥抱阳光/);
  });

  it('starting_from returns only what is still ahead', async () => {
    const c = await connect();
    const full = (await call(c, 'plan_jetlag_trip', TRIP)).structuredContent;
    const from = '2026-11-11T08:00:00+00:00';
    const ahead = (await call(c, 'plan_jetlag_trip', { ...TRIP, starting_from: from })).structuredContent;
    expect(ahead.events.length).toBeLessThan(full.events.length);
    for (const e of ahead.events) expect(Date.parse((e.end ?? e.start).utc)).toBeGreaterThanOrEqual(Date.parse(from));
    for (const d of ahead.days) expect(d.events.length).toBeGreaterThan(0);
  });

  it('reports invalid trip details as a tool error the agent can fix', async () => {
    const r = await call(await connect(), 'plan_jetlag_trip', { ...TRIP, destination_time_zone: 'London' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/not a valid IANA time zone/);
  });

  it('rejects malformed arguments via the input schema', async () => {
    const r = await call(await connect(), 'plan_jetlag_trip', { ...TRIP, departure_time: '7pm' });
    expect(r.isError).toBe(true);
  });

  it('explains when no plan is needed', async () => {
    const r = await call(await connect(), 'plan_jetlag_trip', { ...TRIP, destination_time_zone: 'America/Chicago', arrival_date: '2026-11-10', arrival_time: '21:30' });
    expect(r.structuredContent.status).toBe('no_adjustment_needed');
    expect(r.content[0].text).toMatch(/No dedicated plan needed/);
  });
});

describe('get_plan_calendar_file', () => {
  it('returns a valid iCalendar file with alarms and stable UIDs', async () => {
    const c = await connect();
    const r = await call(c, 'get_plan_calendar_file', TRIP);
    const { ics, filename, event_count } = r.structuredContent;
    expect(filename).toBe('openjetlag-2026-11-10.ics');
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(event_count);
    expect(ics).toMatch(/TRIGGER:-PT30M/);
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    const again = (await call(c, 'get_plan_calendar_file', TRIP)).structuredContent.ics;
    expect(again).toBe(ics);
    expect(r.content[0].text).toContain('-----BEGIN ICS-----');
  });
});

describe('explain_jetlag_topic', () => {
  it('explains a topic without giving doses', async () => {
    const c = await connect();
    const r = await call(c, 'explain_jetlag_topic', { topic: 'melatonin' });
    expect(r.content[0].text).toMatch(/Timing matters more than amount/);
    expect(r.content[0].text).not.toMatch(/\d\s*mg/i);
    const zh = await call(c, 'explain_jetlag_topic', { topic: 'light', language: 'zh' });
    expect(zh.content[0].text).toMatch(/光照/);
  });
});

describe('HTTP surface', () => {
  it('answers CORS preflight', async () => {
    const res = await handleRequest(new Request(`${BASE}/mcp`, { method: 'OPTIONS' }));
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
  it('serves info and health endpoints', async () => {
    expect((await (await handleRequest(new Request(`${BASE}/`))).json()).mcp_endpoint).toBe(`${BASE}/mcp`);
    expect((await (await handleRequest(new Request(`${BASE}/health`))).json()).ok).toBe(true);
    expect((await handleRequest(new Request(`${BASE}/nope`))).status).toBe(404);
  });
  it('rejects SSE GET streams and DELETE on the MCP endpoint (stateless server)', async () => {
    const sse = await handleRequest(new Request(`${BASE}/mcp`, { headers: { accept: 'text/event-stream' } }));
    expect(sse.status).toBe(405);
    expect((await handleRequest(new Request(`${BASE}/mcp`, { method: 'DELETE' }))).status).toBe(405);
  });
  it('describes itself to a browser or an agent that fetches the link', async () => {
    const res = await handleRequest(new Request(`${BASE}/mcp`, { headers: { accept: 'text/html,*/*' } }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/markdown/);
    const text = await res.text();
    expect(text).toContain('custom MCP connector');
    expect(text).toContain(`URL: ${BASE}/mcp`);
    expect(text).toMatch(/Ask them to confirm/);
    const root = await (await handleRequest(new Request(`${BASE}/`))).json();
    expect(root.mcp_endpoint).toBe(`${BASE}/mcp`);
  });
  it('rejects oversized bodies before parsing', async () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: { pad: 'x'.repeat(70_000) } });
    const res = await handleRequest(new Request(`${BASE}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'content-length': String(body.length) },
      body,
    }));
    expect(res.status).toBe(413);
  });
  it('handles a raw JSON-RPC tools/call without an initialize handshake', async () => {
    const res = await handleRequest(new Request(`${BASE}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'explain_jetlag_topic', arguments: { topic: 'naps' } } }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(7);
    expect(body.result.content[0].text).toMatch(/Naps/);
  });
});

describe('calendar folding', () => {
  it('folds long multi-byte lines without splitting characters and unfolds back to the original', async () => {
    const r = await call(await connect(), 'get_plan_calendar_file', { ...TRIP, language: 'zh' });
    const ics: string = r.structuredContent.ics;
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(ics).not.toContain('�');
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain('DESCRIPTION:光照是调节生物钟最强的信号。请在此时段到户外晒太阳');
  });
});
