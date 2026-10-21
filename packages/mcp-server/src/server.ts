import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker';
import { ENGINE_VERSION, JetLagInputError, generatePlan, type PlanInput } from '@openjetlag/core';
import { z } from 'zod';
import { renderPlan } from './format.js';
import { planKey, toIcs } from './ics.js';
import { TOPICS, explain } from './knowledge.js';
import { buildReminders, upcoming } from './reminders.js';

export const SERVER_VERSION = '0.1.0';

export const INSTRUCTIONS = `OpenJetLag turns you into a jet lag coach. It computes a science-based, day-by-day plan (light, sleep, caffeine, naps, optional melatonin timing) from a flight and the traveller's usual sleep schedule. All tools are read-only and store nothing.

How to help the traveller:
1. Collect: departure and arrival cities, local departure and arrival date and time, usual bedtime and wake time. Ask in one short message; read flight details from email or calendar if you have access. Convert cities to IANA time zones yourself.
2. Optional preferences (sensible defaults exist): days to start adjusting before departure (default 3; use fewer if they cannot change their routine at home), whether they are open to melatonin (default yes, timing only).
3. Call plan_jetlag_trip. Summarise the strategy in a few sentences, show the safety notes, and walk through the next day or two rather than the whole plan at once.
4. Be proactive: if you can schedule messages or reminders, offer to create one per entry in structuredContent.reminders (each has an exact "at" time); high-priority ones matter most. Otherwise offer get_plan_calendar_file so the traveller can import the plan into their calendar.
5. When asked "what should I do now/today", call plan_jetlag_trip again with the same trip and starting_from set to the current time.
6. If the flight, sleep habits or preferences change, recompute rather than editing times by hand. Use explain_jetlag_topic when the traveller asks why.

Never present the plan as medical advice and never suggest a melatonin dose; refer to the product label or a clinician.`;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const tripShape = {
  origin_time_zone: z.string().min(1).describe('IANA time zone of the departure city, e.g. "America/New_York". Convert city names yourself.'),
  destination_time_zone: z.string().min(1).describe('IANA time zone of the destination city, e.g. "Asia/Tokyo".'),
  departure_date: z.string().regex(DATE).describe('Departure date, local to the origin, YYYY-MM-DD.'),
  departure_time: z.string().regex(TIME).describe('Departure time, local to the origin, 24-hour HH:mm.'),
  arrival_date: z.string().regex(DATE).describe('Arrival date, local to the destination, YYYY-MM-DD (may be earlier than departure when crossing the date line).'),
  arrival_time: z.string().regex(TIME).describe('Arrival time, local to the destination, 24-hour HH:mm.'),
  usual_bedtime: z.string().regex(TIME).describe("Traveller's usual bedtime at home, HH:mm."),
  usual_wake_time: z.string().regex(TIME).describe("Traveller's usual wake time at home, HH:mm."),
  pre_trip_days: z.number().int().min(0).max(7).optional().describe('Days before departure to start adjusting at home. Default 3; 0 if they cannot change their routine before leaving.'),
  melatonin: z.boolean().optional().describe('Include optional melatonin timing (never a dose). Default true; false if the traveller prefers no supplements.'),
  strategy: z.enum(['auto', 'advance', 'delay']).optional().describe('Leave as "auto" unless the traveller explicitly wants a direction.'),
  language: z.enum(['en', 'zh']).optional().describe('Language for plan text: "en" (default) or "zh" (Simplified Chinese).'),
};

type TripArgs = {
  [K in keyof typeof tripShape]: z.infer<(typeof tripShape)[K]>;
};

function toPlanInput(a: TripArgs): PlanInput {
  return {
    originTimeZone: a.origin_time_zone,
    destinationTimeZone: a.destination_time_zone,
    departure: { date: a.departure_date, time: a.departure_time },
    arrival: { date: a.arrival_date, time: a.arrival_time },
    habitualSleep: { bedtime: a.usual_bedtime, wakeTime: a.usual_wake_time },
    options: {
      preTripDays: a.pre_trip_days,
      melatonin: a.melatonin,
      strategy: a.strategy,
      locale: a.language,
    },
  };
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function inputError(err: unknown): ToolResult {
  if (err instanceof JetLagInputError) {
    return { isError: true, content: [{ type: 'text', text: `Invalid trip details: ${err.message} Ask the traveller to confirm, then call again.` }] };
  }
  throw err;
}

export interface ServerOptions {
  /** Injected clock, for tests. */
  now?: () => Date;
}

export function createServer(opts: ServerOptions = {}): McpServer {
  const now = opts.now ?? (() => new Date());
  const server = new McpServer(
    { name: 'openjetlag', title: 'OpenJetLag', version: SERVER_VERSION },
    { instructions: INSTRUCTIONS, jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
  );

  server.registerTool(
    'plan_jetlag_trip',
    {
      title: 'Plan jet lag adjustment',
      description:
        'Create a day-by-day jet lag plan for a flight: when to seek or avoid light, sleep, stop caffeine, avoid naps, and optional melatonin timing, from the days before departure until the body clock matches the destination. Returns a readable schedule plus structuredContent with the summary, days, events and ready-to-schedule reminders (exact ISO times). Pass starting_from to get only what is still ahead.',
      inputSchema: {
        ...tripShape,
        starting_from: z.string().datetime({ offset: true }).optional().describe('ISO 8601 date-time with offset (e.g. the current time). Only events that have not yet finished are returned.'),
      },
      annotations: { title: 'Plan jet lag adjustment', ...READ_ONLY },
    },
    async (args) => {
      try {
        const full = generatePlan(toPlanInput(args));
        const plan = args.starting_from ? upcoming(full, Date.parse(args.starting_from)) : full;
        const reminders = buildReminders(plan.events);
        const lang = args.language ?? 'en';
        return {
          content: [{ type: 'text', text: renderPlan(plan, reminders, lang) }],
          structuredContent: { ...plan, reminders } as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return inputError(err);
      }
    },
  );

  server.registerTool(
    'get_plan_calendar_file',
    {
      title: 'Export plan as calendar file',
      description:
        'Return the same jet lag plan as an iCalendar (.ics) file with built-in alerts, for importing into Google Calendar, Apple Calendar or Outlook, or for adding through a calendar connector. Use the same trip details as plan_jetlag_trip.',
      inputSchema: tripShape,
      annotations: { title: 'Export plan as calendar file', ...READ_ONLY },
    },
    async (args) => {
      try {
        const input = toPlanInput(args);
        const plan = generatePlan(input);
        if (plan.status !== 'ok') {
          return { content: [{ type: 'text', text: `${plan.summary.notes.join(' ')} No calendar file was created.` }] };
        }
        const reminders = buildReminders(plan.events);
        const ics = toIcs(plan, reminders, planKey(input), now());
        const filename = `openjetlag-${args.departure_date}.ics`;
        return {
          content: [
            {
              type: 'text',
              text: `Calendar file "${filename}" with ${plan.events.length} events and ${reminders.length} alerts. Save the text between the markers as ${filename}, or add the events through a calendar tool.\n\n-----BEGIN ICS-----\n${ics}-----END ICS-----`,
            },
          ],
          structuredContent: { filename, mime_type: 'text/calendar', event_count: plan.events.length, ics },
        };
      } catch (err) {
        return inputError(err);
      }
    },
  );

  server.registerTool(
    'explain_jetlag_topic',
    {
      title: 'Explain jet lag science',
      description:
        'Short, plain-language explanation of one topic behind the plan, to answer "why" questions: overview, light, melatonin, caffeine, naps, direction (why east is harder), flight, safety.',
      inputSchema: {
        topic: z.enum(TOPICS).describe('Which topic to explain.'),
        language: z.enum(['en', 'zh']).optional().describe('"en" (default) or "zh".'),
      },
      annotations: { title: 'Explain jet lag science', ...READ_ONLY },
    },
    async ({ topic, language }) => ({ content: [{ type: 'text', text: explain(topic, language ?? 'en') }] }),
  );

  return server;
}

export const VERSION_INFO = { server: SERVER_VERSION, engine: ENGINE_VERSION };
