import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker';
import { ENGINE_VERSION, JetLagInputError, generatePlan, toLocalTime, type PlanInput } from '@openjetlag/core';
import { z } from 'zod';
import { renderPlan, type PlanSettings } from './format.js';
import { planKey, toIcs } from './ics.js';
import { TOPICS, explain } from './knowledge.js';
import { buildMessages } from './messages.js';
import { buildReminders, upcoming } from './reminders.js';

export const SERVER_VERSION = '0.2.0';

const DEFAULT_PRE_TRIP_DAYS = 3;

export const INSTRUCTIONS = `OpenJetLag makes you the traveller's personal jet lag concierge. It computes a science-based plan (light, sleep, caffeine, naps, optional melatonin timing) from a flight and their usual sleep schedule, plus a ready-made series of proactive messages. All tools are read-only and store nothing.

How to help:
1. Collect in one short message, skipping anything you already know from email or calendar: departure and arrival cities, local departure and arrival date and time, usual bedtime and wake time. Optional: how many days before departure they can start adjusting, and whether they're open to melatonin. Convert cities to IANA time zones yourself, and also pass the city names.
2. Call plan_jetlag_trip.
3. Straight away, schedule every entry of scheduled_messages as a message to the traveller in this conversation at its send_at time, using your scheduling, background-task or reminder ability, and keep each entry's facts with the job. Don't ask permission first and don't hand over a calendar file instead: timely, proactive check-ins are the service the traveller asked for. Use get_plan_calendar_file only if they ask for a calendar, or if you genuinely cannot schedule messages.
4. Then reply briefly: the strategy in a sentence or two, the safety notes, and what you've set up (for example "about three short messages a day; the first one tomorrow at 07:00"). Tell them they can say "fewer messages", "pause" or "stop" at any time; for "fewer", keep only the morning briefings and wind-downs.
5. The check-ins carry facts, not scripts: write each message yourself, in your own voice, when it's due. Say what to do and when, why it matters for this trip (the countdown or progress), and offer an easy option, using whatever you know at that moment (weather, their calendar, how they slept). Keep every time exactly as given, and never make them feel guilty about a missed step.
6. For "what should I do now?" or changed plans, call plan_jetlag_trip again with the same details and the same pre_trip_days (shown in the result), adding starting_from for "now". If they missed a step, reassure them and continue with the plan; never invent times.

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
  pre_trip_days: z
    .number()
    .int()
    .min(0)
    .max(7)
    .optional()
    .describe('Days before departure to start adjusting at home. If omitted: 3, or fewer if departure is sooner. 0 if they cannot change their routine before leaving. When recalculating, pass the value shown in the previous result.'),
  melatonin: z.boolean().optional().describe('Include optional melatonin timing (never a dose). Default true; false if the traveller prefers no supplements.'),
  strategy: z.enum(['auto', 'advance', 'delay']).optional().describe('Leave as "auto" unless the traveller explicitly wants a direction.'),
  language: z.enum(['en', 'zh']).optional().describe('Language for plan text and check-in notes: "en" (default) or "zh" (Simplified Chinese). Match the traveller.'),
  origin_city: z.string().max(60).optional().describe('Departure city as the traveller says it, e.g. "New York" or "纽约". Used in check-in notes.'),
  destination_city: z.string().max(60).optional().describe('Destination city as the traveller says it, e.g. "London" or "伦敦".'),
};

type TripArgs = {
  [K in keyof typeof tripShape]: z.infer<(typeof tripShape)[K]>;
};

function dayDiff(a: string, b: string): number {
  const toUtc = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  return Math.round((toUtc(a) - toUtc(b)) / 86_400_000);
}

/**
 * Pre-trip days actually available: a plan that assumes three days of shifting at home
 * is wrong if the flight is tomorrow. An explicit value is always respected so that
 * recalculations during the trip reproduce the same plan.
 */
function effectivePreTripDays(a: TripArgs, now: Date): number {
  if (a.pre_trip_days !== undefined) return a.pre_trip_days;
  try {
    const today = toLocalTime(now.getTime(), a.origin_time_zone).date;
    return Math.max(0, Math.min(DEFAULT_PRE_TRIP_DAYS, dayDiff(a.departure_date, today)));
  } catch {
    return DEFAULT_PRE_TRIP_DAYS; // invalid zone: generatePlan reports it properly
  }
}

function toPlanInput(a: TripArgs, preTripDays: number): PlanInput {
  return {
    originTimeZone: a.origin_time_zone,
    destinationTimeZone: a.destination_time_zone,
    departure: { date: a.departure_date, time: a.departure_time },
    arrival: { date: a.arrival_date, time: a.arrival_time },
    habitualSleep: { bedtime: a.usual_bedtime, wakeTime: a.usual_wake_time },
    options: {
      preTripDays,
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
        "Create a jet lag plan for a flight, plus a ready-to-schedule series of proactive check-ins (morning briefing, timely light nudges, wind-down before bed; about 3-4 a day). Each check-in has an exact send time and the facts behind it (trip moment, body-clock progress, what to do, why, options); you write the actual messages. Covers the days before departure until the body clock matches the destination. Pass starting_from to get only what is still ahead.",
      inputSchema: {
        ...tripShape,
        starting_from: z.string().datetime({ offset: true }).optional().describe('ISO 8601 date-time with offset, usually the current time. Only events not yet finished and messages not yet due are returned.'),
      },
      annotations: { title: 'Plan jet lag adjustment', ...READ_ONLY },
    },
    async (args) => {
      try {
        const nowDate = now();
        const preTripDays = effectivePreTripDays(args, nowDate);
        const full = generatePlan(toPlanInput(args, preTripDays));
        const fromMs = Math.max(nowDate.getTime(), args.starting_from ? Date.parse(args.starting_from) : -Infinity);
        const view = args.starting_from ? upcoming(full, Date.parse(args.starting_from)) : full;
        const lang = args.language ?? 'en';
        const messages = buildMessages(
          full,
          { lang, originCity: args.origin_city, destinationCity: args.destination_city },
          fromMs,
        );
        const settings: PlanSettings = {
          pre_trip_days: preTripDays,
          pre_trip_days_reduced: args.pre_trip_days === undefined && preTripDays < DEFAULT_PRE_TRIP_DAYS,
          melatonin: args.melatonin ?? true,
          language: lang,
        };
        return {
          content: [{ type: 'text', text: renderPlan(view, messages, lang, settings) }],
          structuredContent: {
            ...view,
            scheduled_messages: messages,
            settings,
            generated_at: nowDate.toISOString(),
          } as unknown as Record<string, unknown>,
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
        'Only when the traveller asks for a calendar file, or when you cannot schedule messages yourself: return the jet lag plan as an iCalendar (.ics) file with alerts, for Google, Apple or Outlook calendars or a calendar connector. Use the same trip details as plan_jetlag_trip.',
      inputSchema: tripShape,
      annotations: { title: 'Export plan as calendar file', ...READ_ONLY },
    },
    async (args) => {
      try {
        const input = toPlanInput(args, effectivePreTripDays(args, now()));
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
