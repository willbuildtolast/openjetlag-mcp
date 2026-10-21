import type { EventKind, JetLagPlan, PlanEvent } from '@openjetlag/core';

export interface Reminder {
  /** When to notify the traveller (ISO 8601 with offset). */
  at: string;
  /** Same instant in UTC. */
  at_utc: string;
  event_id: string;
  kind: EventKind;
  priority: 'high' | 'normal';
  /** One-line message ready to send, in the plan's language. */
  message: string;
}

/** Minutes before an event to notify; null = no reminder. */
const LEAD_MINUTES: Record<EventKind, number | null> = {
  sleep: 30, // time to wind down
  in_flight_sleep: 0,
  seek_light: 10,
  avoid_light: 10,
  caffeine_cutoff: 0,
  no_nap: 0,
  melatonin: 0,
  meal: 0,
  flight: null, // the traveller already knows
};

const HIGH: EventKind[] = ['seek_light', 'avoid_light', 'sleep', 'in_flight_sleep'];

const MINUTE = 60_000;

function isoWithOffset(ms: number, sample: PlanEvent['start']): string {
  // Reuse the event's own UTC offset so the reminder reads in the same local time.
  const offset = sample.iso.slice(-6);
  const sign = offset[0] === '-' ? -1 : 1;
  const [h, m] = offset.slice(1).split(':').map(Number);
  const local = new Date(ms + sign * (h * 60 + m) * MINUTE);
  return `${local.toISOString().slice(0, 16)}:00${offset}`;
}

export function eventLine(e: PlanEvent): string {
  return e.end ? `${e.title} ${e.start.time}–${e.end.time}` : `${e.title} ${e.start.time}`;
}

export function buildReminders(events: PlanEvent[]): Reminder[] {
  const out: Reminder[] = [];
  for (const e of events) {
    const lead = LEAD_MINUTES[e.kind];
    if (lead === null) continue;
    const ms = Date.parse(e.start.utc) - lead * MINUTE;
    out.push({
      at: lead === 0 ? e.start.iso : isoWithOffset(ms, e.start),
      at_utc: new Date(ms).toISOString(),
      event_id: e.id,
      kind: e.kind,
      priority: HIGH.includes(e.kind) ? 'high' : 'normal',
      message: eventLine(e),
    });
  }
  return out.sort((a, b) => a.at_utc.localeCompare(b.at_utc));
}

/** Keep only what is still relevant at `fromMs`: events not yet finished. */
export function upcoming(plan: JetLagPlan, fromMs: number): JetLagPlan {
  const live = (e: PlanEvent) => Date.parse((e.end ?? e.start).utc) >= fromMs;
  const days = plan.days
    .map((d) => ({ ...d, events: d.events.filter(live) }))
    .filter((d) => d.events.length > 0);
  return { ...plan, days, events: plan.events.filter(live) };
}
