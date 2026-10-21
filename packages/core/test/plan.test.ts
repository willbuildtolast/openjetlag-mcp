import { describe, expect, it } from 'vitest';
import { generatePlan, JetLagInputError, type PlanInput, type PlanEvent } from '../src/index.js';

const SLEEP = { bedtime: '23:00', wakeTime: '07:00' };

function trip(over: Partial<PlanInput> & Pick<PlanInput, 'originTimeZone' | 'destinationTimeZone' | 'departure' | 'arrival'>): PlanInput {
  return { habitualSleep: SLEEP, ...over };
}

const NY_LONDON = trip({
  originTimeZone: 'America/New_York',
  destinationTimeZone: 'Europe/London',
  departure: { date: '2026-11-10', time: '19:00' },
  arrival: { date: '2026-11-11', time: '07:00' },
});

const ms = (e: PlanEvent, which: 'start' | 'end') => Date.parse((which === 'start' ? e.start : e.end!).utc);
const overlaps = (a: PlanEvent, b: PlanEvent) => ms(a, 'start') < ms(b, 'end') && ms(b, 'start') < ms(a, 'end');
const sleeps = (evs: PlanEvent[]) => evs.filter((e) => e.kind === 'sleep' || e.kind === 'in_flight_sleep');

describe('time zones and daylight saving', () => {
  it('uses the offset on the trip date, not today (US and UK switch DST on different dates)', () => {
    // 12 Mar 2026: New York already on EDT (-4), London still on GMT (0) -> 4 h, not 5.
    const march = generatePlan({ ...NY_LONDON, departure: { date: '2026-03-12', time: '19:00' }, arrival: { date: '2026-03-13', time: '07:00' } });
    expect(march.summary.timeDifferenceHours).toBe(4);
    const nov = generatePlan(NY_LONDON);
    expect(nov.summary.timeDifferenceHours).toBe(5);
    // 30 Oct 2026: London back on GMT, New York still on EDT -> -4.
    const back = generatePlan(trip({
      originTimeZone: 'Europe/London', destinationTimeZone: 'America/New_York',
      departure: { date: '2026-10-30', time: '11:00' }, arrival: { date: '2026-10-30', time: '14:00' },
    }));
    expect(back.summary.timeDifferenceHours).toBe(-4);
  });

  it('handles half-hour zones', () => {
    const p = generatePlan(trip({
      originTimeZone: 'America/New_York', destinationTimeZone: 'Asia/Kolkata',
      departure: { date: '2026-11-10', time: '20:30' }, arrival: { date: '2026-11-11', time: '21:00' },
    }));
    expect(p.summary.timeDifferenceHours).toBe(10.5);
  });

  it('crosses the date line: arrival wall-clock date earlier than departure', () => {
    // Tokyo 21:00 -> Honolulu 09:00 the same calendar day (7 h flight).
    const p = generatePlan(trip({
      originTimeZone: 'Asia/Tokyo', destinationTimeZone: 'Pacific/Honolulu',
      departure: { date: '2026-11-10', time: '21:00' }, arrival: { date: '2026-11-10', time: '09:00' },
    }));
    expect(p.summary.timeDifferenceHours).toBe(5);
    expect(p.summary.flight.durationMinutes).toBe(7 * 60);
    expect(p.summary.travelDirection).toBe('east');
  });

  it('treats a 23 h clock difference as 1 h (Auckland -> Honolulu)', () => {
    const p = generatePlan(trip({
      originTimeZone: 'Pacific/Auckland', destinationTimeZone: 'Pacific/Honolulu',
      departure: { date: '2026-11-10', time: '22:00' }, arrival: { date: '2026-11-10', time: '07:30' },
    }));
    expect(p.status).toBe('no_adjustment_needed');
    expect(Math.abs(p.summary.timeDifferenceHours)).toBe(1);
  });
});

describe('output format', () => {
  const plan = generatePlan(NY_LONDON);

  it('gives every event an absolute ISO timestamp with offset', () => {
    for (const e of plan.events) {
      expect(e.start.iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00[+-]\d{2}:\d{2}$/);
      expect(e.start.time).not.toMatch(/^24:/);
      expect(new Date(e.start.iso).getTime()).toBe(Date.parse(e.start.utc));
      if (e.end) expect(ms(e, 'end')).toBeGreaterThan(ms(e, 'start'));
    }
  });

  it('sorts events chronologically, including across midnight', () => {
    const starts = plan.events.map((e) => ms(e, 'start'));
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it('shows events in origin time before departure and destination time after', () => {
    const dep = Date.parse(plan.summary.flight.departure.utc);
    for (const e of plan.events.filter((x) => x.kind !== 'flight')) {
      expect(e.start.timeZone).toBe(ms(e, 'start') < dep ? 'America/New_York' : 'Europe/London');
    }
  });

  it('groups days by local date and lists each event exactly once', () => {
    expect(plan.days.flatMap((d) => d.events)).toHaveLength(plan.events.length);
    for (const d of plan.days) for (const e of d.events) expect(e.start.date).toBe(d.date);
  });

  it('is deterministic', () => {
    expect(generatePlan(NY_LONDON)).toEqual(plan);
  });

  it('always includes safety notes and never a melatonin dose', () => {
    for (const locale of ['en', 'zh'] as const) {
      const p = generatePlan({ ...NY_LONDON, options: { locale } });
      expect(p.safetyNotes.length).toBeGreaterThan(0);
      expect(JSON.stringify(p)).not.toMatch(/\d\s*mg/i);
    }
  });

  it('localises text without changing the schedule', () => {
    const zh = generatePlan({ ...NY_LONDON, options: { locale: 'zh' } });
    expect(zh.events.find((e) => e.kind === 'seek_light')!.title).toBe('拥抱阳光');
    expect(zh.events.map((e) => e.start.iso)).toEqual(plan.events.map((e) => e.start.iso));
  });
});

describe('schedule logic', () => {
  const cases: Array<[string, PlanInput]> = [
    ['NY->London', NY_LONDON],
    ['LA->London', trip({ originTimeZone: 'America/Los_Angeles', destinationTimeZone: 'Europe/London', departure: { date: '2026-11-10', time: '16:00' }, arrival: { date: '2026-11-11', time: '10:00' } })],
    ['Shanghai->London', trip({ originTimeZone: 'Asia/Shanghai', destinationTimeZone: 'Europe/London', departure: { date: '2026-11-10', time: '10:00' }, arrival: { date: '2026-11-10', time: '15:00' } })],
    ['NY->Tokyo', trip({ originTimeZone: 'America/New_York', destinationTimeZone: 'Asia/Tokyo', departure: { date: '2026-11-10', time: '12:00' }, arrival: { date: '2026-11-11', time: '15:30' } })],
    ['Sydney->LA', trip({ originTimeZone: 'Australia/Sydney', destinationTimeZone: 'America/Los_Angeles', departure: { date: '2026-11-10', time: '21:30' }, arrival: { date: '2026-11-10', time: '16:00' } })],
  ];

  it.each(cases)('%s: light windows never fall inside sleep', (_, input) => {
    const p = generatePlan(input);
    const light = p.events.filter((e) => e.kind === 'seek_light' || e.kind === 'avoid_light');
    expect(light.length).toBeGreaterThan(0);
    for (const l of light) for (const s of sleeps(p.events)) expect(overlaps(l, s)).toBe(false);
  });

  it.each(cases)('%s: ground sleep never overlaps the flight', (_, input) => {
    const p = generatePlan(input);
    const flight = p.events.find((e) => e.kind === 'flight')!;
    for (const s of p.events.filter((e) => e.kind === 'sleep')) expect(overlaps(s, flight)).toBe(false);
    for (const s of p.events.filter((e) => e.kind === 'in_flight_sleep')) {
      expect(ms(s, 'start')).toBeGreaterThanOrEqual(ms(flight, 'start'));
      expect(ms(s, 'end')).toBeLessThanOrEqual(ms(flight, 'end'));
    }
  });

  it.each(cases)('%s: ends on the habitual schedule in destination time', (_, input) => {
    const p = generatePlan(input);
    const last = p.events.filter((e) => e.kind === 'sleep').at(-1)!;
    expect(last.start.timeZone).toBe(input.destinationTimeZone);
    expect([last.start.time, last.end!.time]).toEqual([SLEEP.bedtime, SLEEP.wakeTime]);
  });

  it.each(cases)('%s: body clock never shifts faster than the configured rate', (_, input) => {
    const p = generatePlan(input);
    const rate = p.summary.strategy === 'advance' ? 1 : 1.5;
    const rem = p.days.filter((d) => d.bodyClock).map((d) => d.bodyClock!.remainingShiftHours);
    for (let i = 1; i < rem.length; i++) {
      expect(rem[i - 1] - rem[i]).toBeGreaterThanOrEqual(0);
      expect(rem[i - 1] - rem[i]).toBeLessThanOrEqual(rate * 2 + 1e-9); // at most two nights between listed days
    }
    expect(p.summary.totalShiftHours).toBeGreaterThan(0);
  });

  it('picks the faster direction automatically', () => {
    const s = (input: PlanInput) => generatePlan(input).summary.strategy;
    expect(s(NY_LONDON)).toBe('advance'); // 5 h advance beats 19 h delay
    expect(s(cases[1][1])).toBe('advance'); // 8 h advance (8 d) beats 16 h delay (10.7 d)
    expect(s(cases[2][1])).toBe('delay'); // westward 8 h
    // LA -> Dubai: eastward 12 h; delaying 12 h at 1.5 h/day beats advancing 12 h at 1 h/day.
    const dubai = generatePlan(trip({ originTimeZone: 'America/Los_Angeles', destinationTimeZone: 'Asia/Dubai', departure: { date: '2026-11-10', time: '16:00' }, arrival: { date: '2026-11-11', time: '19:00' } }));
    expect(dubai.summary.travelDirection).toBe('east');
    expect(dubai.summary.strategy).toBe('delay');
  });

  it('respects a forced strategy', () => {
    const p = generatePlan({ ...cases[1][1], options: { strategy: 'delay' } });
    expect(p.summary.strategy).toBe('delay');
    expect(p.summary.totalShiftHours).toBe(16);
  });

  it('only suggests melatonin when advancing and allowed', () => {
    expect(generatePlan(NY_LONDON).events.some((e) => e.kind === 'melatonin')).toBe(true);
    expect(generatePlan({ ...NY_LONDON, options: { melatonin: false } }).events.some((e) => e.kind === 'melatonin')).toBe(false);
    expect(generatePlan(cases[2][1]).events.some((e) => e.kind === 'melatonin')).toBe(false);
  });

  it('adds pre-trip days at home before departure', () => {
    const p3 = generatePlan(NY_LONDON);
    expect(p3.days.filter((d) => d.phase === 'pre_trip')).toHaveLength(3);
    expect(p3.summary.preTripShiftHours).toBe(3);
    const p0 = generatePlan({ ...NY_LONDON, options: { preTripDays: 0 } });
    expect(p0.days.some((d) => d.phase === 'pre_trip')).toBe(false);
    expect(p0.summary.preTripShiftHours).toBe(0);
    expect(p0.summary.estimatedDaysToAdapt).toBeGreaterThan(p3.summary.estimatedDaysToAdapt);
  });

  it('on a morning arrival after an eastward flight, avoids light until the body-clock minimum', () => {
    const p = generatePlan({ ...cases[1][1], options: { preTripDays: 0 } }); // LA->London, lands 10:00
    const firstAfter = p.events.filter((e) => e.stage === 'after_arrival' && e.kind !== 'meal');
    expect(firstAfter[0].kind).toBe('avoid_light');
    expect(firstAfter[0].start.time).toBe('10:00');
    expect(firstAfter[1].kind).toBe('seek_light');
  });

  it('after a westward arrival, sleep is on local night from the first evening', () => {
    const p = generatePlan(cases[2][1]); // Shanghai->London, lands 15:00
    const firstSleep = p.events.find((e) => e.kind === 'sleep' && e.stage === 'after_arrival')!;
    expect(firstSleep.start.time).toBe('23:00');
    expect(firstSleep.start.date).toBe('2026-11-10');
  });

  it('returns no plan for small differences', () => {
    const p = generatePlan(trip({ originTimeZone: 'America/New_York', destinationTimeZone: 'America/Chicago', departure: { date: '2026-11-10', time: '09:00' }, arrival: { date: '2026-11-10', time: '10:30' } }));
    expect(p.status).toBe('no_adjustment_needed');
    expect(p.events).toEqual([]);
    expect(p.summary.notes[0]).toMatch(/1 h/);
  });
});

describe('validation', () => {
  const bad = (patch: Partial<PlanInput>) => () => generatePlan({ ...NY_LONDON, ...patch });

  it('rejects unknown time zones', () => {
    expect(bad({ destinationTimeZone: 'Mars/Olympus' })).toThrow(JetLagInputError);
    expect(bad({ originTimeZone: '' })).toThrow(/IANA/);
  });
  it('rejects malformed or impossible dates and times', () => {
    expect(bad({ departure: { date: '2026-02-30', time: '10:00' } })).toThrow(/date/);
    expect(bad({ arrival: { date: '2026-11-11', time: '7:00' } })).toThrow(/HH:mm/);
    expect(bad({ habitualSleep: { bedtime: '25:00', wakeTime: '07:00' } })).toThrow(/bedtime/);
  });
  it('rejects arrival before departure and implausibly long trips', () => {
    expect(bad({ arrival: { date: '2026-11-10', time: '23:00' } })).toThrow(/after departure/);
    expect(bad({ arrival: { date: '2026-11-13', time: '07:00' } })).toThrow(/36 hours/);
  });
  it('rejects out-of-range options', () => {
    expect(bad({ options: { preTripDays: 10 } })).toThrow(/preTripDays/);
    expect(bad({ options: { advanceHoursPerDay: 0 } })).toThrow(/advanceHoursPerDay/);
    expect(bad({ options: { locale: 'fr' as never } })).toThrow(/locale/);
  });
});

describe('regressions', () => {
  it('does not pull the last night at home toward destination time before a morning flight', () => {
    // SFO 11:30 -> Tokyo; delaying 1.5 h/night at home. The night before departure must
    // start where the body clock is, not at 06:30 because of destination-time lead.
    const p = generatePlan(trip({
      originTimeZone: 'America/Los_Angeles', destinationTimeZone: 'Asia/Tokyo',
      departure: { date: '2026-11-12', time: '11:30' }, arrival: { date: '2026-11-13', time: '15:05' },
      habitualSleep: { bedtime: '23:30', wakeTime: '07:30' },
    }));
    const lastHomeSleep = p.events.filter((e) => e.kind === 'sleep' && e.stage === 'before_flight').at(-1)!;
    expect(lastHomeSleep.start.date).toBe('2026-11-12');
    expect(lastHomeSleep.start.time).toBe('04:00');
    expect(lastHomeSleep.durationMinutes).toBeGreaterThanOrEqual(4 * 60);
  });
});
