// RFC 5545 calendar export, so any agent with a calendar connector (or the traveller)
// can import the whole plan and get native calendar notifications.

import type { JetLagPlan, PlanEvent } from '@openjetlag/core';
import type { Reminder } from './reminders.js';

const POINT_EVENT_MINUTES = 15;

function utcStamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Fold lines longer than 75 octets (RFC 5545 §3.1). */
function fold(line: string): string {
  const bytes = new TextEncoder();
  if (bytes.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  for (const ch of line) {
    const limit = parts.length === 0 ? 75 : 74; // continuation lines start with a space
    if (bytes.encode(current + ch).length > limit) {
      parts.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/** Stable short hash so re-importing an unchanged plan updates instead of duplicating. */
export function planKey(input: unknown): string {
  let h = 0x811c9dc5;
  for (const ch of JSON.stringify(input)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function toIcs(plan: JetLagPlan, reminders: Reminder[], key: string, now: Date): string {
  const leadByEvent = new Map<string, number>();
  for (const r of reminders) {
    const ev = plan.events.find((e) => e.id === r.event_id);
    if (ev) leadByEvent.set(r.event_id, Math.round((Date.parse(ev.start.utc) - Date.parse(r.at_utc)) / 60_000));
  }

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OpenJetLag//Jet lag plan//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(`OpenJetLag ${plan.summary.originTimeZone} → ${plan.summary.destinationTimeZone}`)}`,
  ];
  const stamp = utcStamp(now.toISOString());
  const disclaimer = plan.safetyNotes[0] ?? '';

  for (const e of plan.events as PlanEvent[]) {
    const endIso = e.end ? e.end.utc : new Date(Date.parse(e.start.utc) + POINT_EVENT_MINUTES * 60_000).toISOString();
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.id}-${key}@openjetlag`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${utcStamp(e.start.utc)}`,
      `DTEND:${utcStamp(endIso)}`,
      `SUMMARY:${escapeText(e.title)}`,
      `DESCRIPTION:${escapeText(`${e.description}\n\n${disclaimer}`)}`,
      `CATEGORIES:${e.kind.toUpperCase()}`,
      'TRANSP:TRANSPARENT',
    );
    const lead = leadByEvent.get(e.id);
    if (lead !== undefined) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(e.title)}`, `TRIGGER:-PT${lead}M`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
