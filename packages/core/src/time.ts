// Time-zone helpers built only on the platform Intl API (no dependencies).
// Every offset is computed for a specific instant, so daylight-saving changes
// are handled correctly for the actual trip dates.

import { JetLagInputError } from './errors.js';
import type { LocalTime } from './types.js';

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23', // avoids the "24:00" midnight quirk of hour12:false
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

export function assertTimeZone(timeZone: string, field: string): void {
  if (typeof timeZone !== 'string' || timeZone.length === 0) {
    throw new JetLagInputError(`${field} must be an IANA time zone such as "Europe/London".`);
  }
  try {
    formatter(timeZone);
  } catch {
    throw new JetLagInputError(`${field} "${timeZone}" is not a valid IANA time zone.`);
  }
}

interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallParts(ms: number, timeZone: string): WallParts {
  const out: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour % 24,
    minute: out.minute,
    second: out.second,
  };
}

/** UTC offset of `timeZone` at instant `ms`, in minutes (e.g. -240 for New York in summer). */
export function offsetMinutes(ms: number, timeZone: string): number {
  const p = wallParts(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const flooredMs = Math.floor(ms / 1000) * 1000;
  return Math.round((asUtc - flooredMs) / MINUTE_MS);
}

/** Convert a wall-clock date + time in `timeZone` to a UTC epoch in ms. */
export function zonedToUtc(date: string, time: string, timeZone: string): number {
  const [y, m, d] = parseDate(date);
  const minutes = parseTimeMinutes(time);
  const asUtc = Date.UTC(y, m - 1, d, 0, minutes);
  // Two passes resolve the offset correctly around DST transitions.
  let ms = asUtc - offsetMinutes(asUtc, timeZone) * MINUTE_MS;
  ms = asUtc - offsetMinutes(ms, timeZone) * MINUTE_MS;
  return ms;
}

const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, '0');

export function toLocalTime(ms: number, timeZone: string): LocalTime {
  const rounded = Math.round(ms / MINUTE_MS) * MINUTE_MS;
  const p = wallParts(rounded, timeZone);
  // Offset from the same wall-clock parts (one Intl call instead of two).
  const off = Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - rounded) / MINUTE_MS);
  const date = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  const time = `${pad(p.hour)}:${pad(p.minute)}`;
  const sign = off < 0 ? '-' : '+';
  const offStr = `${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
  return {
    iso: `${date}T${time}:00${offStr}`,
    date,
    time,
    timeZone,
    utc: new Date(rounded).toISOString(),
  };
}

export function localDate(ms: number, timeZone: string): string {
  return toLocalTime(ms, timeZone).date;
}

// --- String parsing -------------------------------------------------------

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidDate(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function isValidTime(s: unknown): s is string {
  return typeof s === 'string' && TIME_RE.test(s);
}

function parseDate(s: string): [number, number, number] {
  const m = DATE_RE.exec(s);
  if (!m) throw new JetLagInputError(`Invalid date "${s}", expected YYYY-MM-DD.`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function parseTimeMinutes(s: string): number {
  const m = TIME_RE.exec(s);
  if (!m) throw new JetLagInputError(`Invalid time "${s}", expected HH:mm (24-hour).`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = parseDate(date);
  const dt = new Date(Date.UTC(y, m - 1, d) + days * DAY_MS);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** Minutes after midnight -> "HH:mm" (wraps around the day). */
export function minutesToHHMM(minutes: number): string {
  const m = Math.round(mod(minutes, 1440));
  return `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
}
