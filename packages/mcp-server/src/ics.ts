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

/** UTF-8 byte length of one code point. */
function utf8Bytes(cp: number): number {
  return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
}

/** Fold lines longer than 75 octets (RFC 5545 §3.1), never splitting a character. */
function fold(line: string): string {
  // Fast path: even if every UTF-16 unit were 3 bytes, the line fits.
  if (line.length * 3 <= 75) return line;
  const parts: string[] = [];
  let start = 0;
  let bytes = 0;
  let i = 0;
  while (i < line.length) {
    const cp = line.codePointAt(i)!;
    const units = cp > 0xffff ? 2 : 1;
    const b = utf8Bytes(cp);
    const limit = parts.length === 0 ? 75 : 74; // continuation lines start with a space
    if (bytes + b > limit) {
      parts.push(line.slice(start, i));
      start = i;
      bytes = 0;
    }
    bytes += b;
    i += units;
  }
  parts.push(line.slice(start));
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
  const startById = new Map(plan.events.map((e) => [e.id, Date.parse(e.start.utc)]));
  const leadByEvent = new Map<string, number>();
  for (const r of reminders) {
    const start = startById.get(r.event_id);
    if (start !== undefined) leadByEvent.set(r.event_id, Math.round((start - Date.parse(r.at_utc)) / 60_000));
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
