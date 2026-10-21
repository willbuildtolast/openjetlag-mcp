import { describe, expect, it } from 'vitest';
import { offsetMinutes, toLocalTime, zonedToUtc } from '../src/index.js';

describe('time helpers', () => {
  it('computes offsets for a given instant', () => {
    expect(offsetMinutes(Date.parse('2026-07-01T12:00:00Z'), 'America/New_York')).toBe(-240);
    expect(offsetMinutes(Date.parse('2026-12-01T12:00:00Z'), 'America/New_York')).toBe(-300);
    expect(offsetMinutes(Date.parse('2026-12-01T12:00:00Z'), 'Asia/Kolkata')).toBe(330);
  });

  it('converts local wall time to UTC around DST changes', () => {
    // 8 Mar 2026 03:30 in New York is just after the spring-forward jump (EDT).
    expect(new Date(zonedToUtc('2026-03-08', '03:30', 'America/New_York')).toISOString()).toBe('2026-03-08T07:30:00.000Z');
    expect(new Date(zonedToUtc('2026-03-07', '03:30', 'America/New_York')).toISOString()).toBe('2026-03-07T08:30:00.000Z');
  });

  it('formats midnight as 00:00, never 24:00', () => {
    const t = toLocalTime(Date.parse('2026-11-11T00:00:00Z'), 'Europe/London');
    expect(t.time).toBe('00:00');
    expect(t.iso).toBe('2026-11-11T00:00:00+00:00');
  });
});
