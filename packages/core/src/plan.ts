import { JetLagInputError } from './errors.js';
import { formatHours, strings } from './i18n.js';
import {
  HOUR_MS,
  MINUTE_MS,
  addDays,
  assertTimeZone,
  isValidDate,
  isValidTime,
  localDate,
  minutesToHHMM,
  mod,
  offsetMinutes,
  parseTimeMinutes,
  toLocalTime,
  zonedToUtc,
} from './time.js';
import type {
  DayPhase,
  EventKind,
  EventStage,
  JetLagPlan,
  Locale,
  PlanDay,
  PlanEvent,
  PlanInput,
  PlanOptions,
  PlanSummary,
} from './types.js';

export const ENGINE_VERSION = '0.2.0';

/** Time differences below this many hours get no dedicated plan. */
const MIN_SHIFT_HOURS = 2;
const MAX_FLIGHT_HOURS = 36;
const MAX_CYCLES = 40;
/** Avoid-light window length on the "wrong" side of CBTmin. */
const LIGHT_WINDOW_HOURS = 4;
/** Seek-light: search this far from CBTmin, recommend at most SEEK_HOURS of it. */
const SEEK_REGION_HOURS = 9;
const SEEK_HOURS = 3;
const NO_NAP_HOURS = 3;
const MELATONIN_BEFORE_BED_HOURS = 1;
const MIN_SEGMENT_MINUTES = 30;
const MIN_IN_FLIGHT_SLEEP_MINUTES = 60;
/** Time allowed after landing before an overlapping sleep window can resume. */
const ARRIVAL_TRANSIT_HOURS = 1;
/** Sleep at home must end this long before departure (getting to the airport). */
const DEPARTURE_BUFFER_HOURS = 3;
const MIN_POST_ARRIVAL_SLEEP_HOURS = 2;

type ResolvedOptions = Required<PlanOptions>;

const DEFAULTS: ResolvedOptions = {
  preTripDays: 3,
  strategy: 'auto',
  advanceHoursPerDay: 1,
  delayHoursPerDay: 1.5,
  cbtMinBeforeWakeHours: 2,
  caffeineCutoffHours: 10,
  melatonin: true,
  advanceSleepLeadHours: 3,
  delaySleepLeadHours: 12,
  locale: 'en',
};

function resolveOptions(o: PlanOptions = {}): ResolvedOptions {
  const r: ResolvedOptions = { ...DEFAULTS };
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined) (r as unknown as Record<string, unknown>)[k] = v;
  }
  const num = (v: number, lo: number, hi: number, name: string) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) {
      throw new JetLagInputError(`options.${name} must be a number between ${lo} and ${hi}.`);
    }
  };
  num(r.preTripDays, 0, 7, 'preTripDays');
  if (!Number.isInteger(r.preTripDays)) throw new JetLagInputError('options.preTripDays must be a whole number.');
  num(r.advanceHoursPerDay, 0.25, 3, 'advanceHoursPerDay');
  num(r.delayHoursPerDay, 0.25, 3, 'delayHoursPerDay');
  num(r.cbtMinBeforeWakeHours, 0, 6, 'cbtMinBeforeWakeHours');
  num(r.caffeineCutoffHours, 0, 16, 'caffeineCutoffHours');
  num(r.advanceSleepLeadHours, 0, 3, 'advanceSleepLeadHours');
  num(r.delaySleepLeadHours, 0, 14, 'delaySleepLeadHours');
  if (!['auto', 'advance', 'delay'].includes(r.strategy)) {
    throw new JetLagInputError('options.strategy must be "auto", "advance" or "delay".');
  }
  if (!['en', 'zh'].includes(r.locale)) throw new JetLagInputError('options.locale must be "en" or "zh".');
  if (typeof r.melatonin !== 'boolean') throw new JetLagInputError('options.melatonin must be true or false.');
  return r;
}

function validateInput(input: PlanInput): void {
  if (!input || typeof input !== 'object') throw new JetLagInputError('Plan input is required.');
  assertTimeZone(input.originTimeZone, 'originTimeZone');
  assertTimeZone(input.destinationTimeZone, 'destinationTimeZone');
  for (const key of ['departure', 'arrival'] as const) {
    const v = input[key];
    if (!v || !isValidDate(v.date)) throw new JetLagInputError(`${key}.date must be a real date in YYYY-MM-DD format.`);
    if (!isValidTime(v.time)) throw new JetLagInputError(`${key}.time must be HH:mm (24-hour).`);
  }
  const s = input.habitualSleep;
  if (!s || !isValidTime(s.bedtime)) throw new JetLagInputError('habitualSleep.bedtime must be HH:mm (24-hour).');
  if (!isValidTime(s.wakeTime)) throw new JetLagInputError('habitualSleep.wakeTime must be HH:mm (24-hour).');
}

/** Normalise an hour difference into (-12, 12]. */
function normalizeDiff(h: number): number {
  let d = mod(h, 24);
  if (d > 12) d -= 24;
  return d;
}

const roundToMinute = (h: number) => Math.round(h * 60) / 60;

interface Cycle {
  index: number;
  /** Estimated core body temperature minimum for this cycle (UTC ms). */
  cbt: number;
  /** CBTmin of the next cycle, after tonight's shift. */
  cbtNext: number;
  remainingStart: number;
  step: number;
}

type Interval = [number, number];

interface RawEvent {
  kind: EventKind;
  start: number;
  end: number | null;
  key: string;
}

/** Remove `cuts` from `[s, e]`, returning the remaining pieces. */
function subtract([s, e]: Interval, cuts: Interval[]): Interval[] {
  let pieces: Interval[] = [[s, e]];
  for (const [cs, ce] of cuts) {
    const next: Interval[] = [];
    for (const [ps, pe] of pieces) {
      if (ce <= ps || cs >= pe) {
        next.push([ps, pe]);
        continue;
      }
      if (cs > ps) next.push([ps, cs]);
      if (ce < pe) next.push([ce, pe]);
    }
    pieces = next;
  }
  return pieces;
}

/**
 * Generate a jet lag plan. Pure function: same input -> same output, no I/O.
 * Throws JetLagInputError for invalid input.
 */
export function generatePlan(input: PlanInput): JetLagPlan {
  validateInput(input);
  const o = resolveOptions(input.options);
  const t = strings[o.locale as Locale];
  const originTz = input.originTimeZone;
  const destTz = input.destinationTimeZone;

  const depMs = zonedToUtc(input.departure.date, input.departure.time, originTz);
  const arrMs = zonedToUtc(input.arrival.date, input.arrival.time, destTz);
  if (arrMs <= depMs) {
    throw new JetLagInputError('Arrival must be after departure (check dates and the destination time zone).');
  }
  if (arrMs - depMs > MAX_FLIGHT_HOURS * HOUR_MS) {
    throw new JetLagInputError(`Total travel time is longer than ${MAX_FLIGHT_HOURS} hours; check the dates.`);
  }

  // Offsets are taken at the arrival instant, so DST is applied for the real trip date.
  const timeDiff = normalizeDiff((offsetMinutes(arrMs, destTz) - offsetMinutes(arrMs, originTz)) / 60);

  const bedMin = parseTimeMinutes(input.habitualSleep.bedtime);
  const wakeMin = parseTimeMinutes(input.habitualSleep.wakeTime);
  let sleepHours = mod(wakeMin - bedMin, 1440) / 60;
  if (sleepHours === 0) sleepHours = 8;
  if (sleepHours < 3) throw new JetLagInputError('Habitual sleep must be at least 3 hours long.');

  const flight = {
    departure: toLocalTime(depMs, originTz),
    arrival: toLocalTime(arrMs, destTz),
    durationMinutes: Math.round((arrMs - depMs) / MINUTE_MS),
  };

  const baseSummary = {
    originTimeZone: originTz,
    destinationTimeZone: destTz,
    timeDifferenceHours: timeDiff,
    travelDirection: (timeDiff > 0 ? 'east' : timeDiff < 0 ? 'west' : 'none') as PlanSummary['travelDirection'],
    flight,
  };

  if (Math.abs(timeDiff) < MIN_SHIFT_HOURS) {
    return {
      engineVersion: ENGINE_VERSION,
      status: 'no_adjustment_needed',
      summary: {
        ...baseSummary,
        strategy: 'none',
        totalShiftHours: 0,
        preTripShiftHours: 0,
        remainingShiftAtArrivalHours: 0,
        estimatedDaysToAdapt: 0,
        notes: [t.minimal(formatHours(Math.abs(timeDiff)))],
      },
      days: [],
      events: [],
      safetyNotes: [...t.safety],
    };
  }

  // --- Strategy: advance (earlier) or delay (later)? -----------------------
  const advanceNeeded = mod(timeDiff, 24);
  const delayNeeded = 24 - advanceNeeded;
  const strategy: 'advance' | 'delay' =
    o.strategy !== 'auto'
      ? o.strategy
      : advanceNeeded / o.advanceHoursPerDay <= delayNeeded / o.delayHoursPerDay
        ? 'advance'
        : 'delay';
  const total = strategy === 'advance' ? advanceNeeded : delayNeeded;
  const altTotal = strategy === 'advance' ? delayNeeded : advanceNeeded;
  const rate = strategy === 'advance' ? o.advanceHoursPerDay : o.delayHoursPerDay;
  const sign = strategy === 'advance' ? -1 : 1;
  const cbtOffMs = o.cbtMinBeforeWakeHours * HOUR_MS;
  const sleepMs = sleepHours * HOUR_MS;

  // --- Body-clock cycles, one per day, in absolute time ---------------------
  const firstDate = addDays(input.departure.date, -o.preTripDays);
  let cbt = zonedToUtc(firstDate, minutesToHHMM(wakeMin - o.cbtMinBeforeWakeHours * 60), originTz);
  const cycles: Cycle[] = [];
  let shifted = 0;
  for (let k = 0; k < MAX_CYCLES; k++) {
    const remainingStart = roundToMinute(total - shifted);
    const step = Math.min(rate, remainingStart);
    const cbtNext = cbt + 24 * HOUR_MS + sign * step * HOUR_MS;
    shifted = roundToMinute(shifted + step);
    cycles.push({ index: k, cbt, cbtNext, remainingStart, step });
    cbt = cbtNext;
    // Stop once fully shifted and the first post-arrival night is covered.
    if (total - shifted <= 0 && cbtNext + cbtOffMs >= arrMs) break;
  }

  // --- Planned sleep -------------------------------------------------------
  // Before departure, sleep follows the (already shifting) body clock at home.
  // After departure, sleep moves toward the local schedule: it may run ahead of the
  // body clock by up to the lead (larger for delaying, since staying up late is easier
  // than falling asleep early), never past the destination target.
  const sleepLead = strategy === 'advance' ? o.advanceSleepLeadHours : o.delaySleepLeadHours;
  const plannedSleepEnd = cycles.map((c) => {
    const bodySleepEnd = c.cbtNext + cbtOffMs;
    // Nights that begin before take-off stay on the body clock (the last night at home
    // must not be pulled toward destination time).
    if (bodySleepEnd - sleepMs < depMs) return bodySleepEnd;
    const remainingAfter = roundToMinute(c.remainingStart - c.step);
    return bodySleepEnd + sign * Math.min(sleepLead, remainingAfter) * HOUR_MS;
  });

  // --- Reconcile planned sleep with the flight ------------------------------
  const finalSleeps: RawEvent[] = [];
  plannedSleepEnd.forEach((e, i) => {
    const s = e - sleepMs;
    const key = String(i);
    if (s < depMs) {
      // A full night at home is kept; a sleep cut short by the trip to the airport
      // is only kept if a worthwhile stretch remains.
      const pe = e <= depMs - DEPARTURE_BUFFER_HOURS * HOUR_MS ? e : Math.min(e, depMs - DEPARTURE_BUFFER_HOURS * HOUR_MS);
      if (pe - s >= MIN_POST_ARRIVAL_SLEEP_HOURS * HOUR_MS) finalSleeps.push({ kind: 'sleep', start: s, end: pe, key });
    }
    const fs = Math.max(s, depMs);
    const fe = Math.min(e, arrMs);
    if (fe - fs >= MIN_IN_FLIGHT_SLEEP_MINUTES * MINUTE_MS) {
      finalSleeps.push({ kind: 'in_flight_sleep', start: fs, end: fe, key });
    }
    if (e > arrMs) {
      const ps = Math.max(s, arrMs + ARRIVAL_TRANSIT_HOURS * HOUR_MS);
      if (e - ps >= MIN_POST_ARRIVAL_SLEEP_HOURS * HOUR_MS) finalSleeps.push({ kind: 'sleep', start: ps, end: e, key: `${key}b` });
    }
  });

  // The night before the plan starts (habitual sleep) is only used for clipping.
  const firstWake = cycles[0].cbt + cbtOffMs;
  const asleep: Interval[] = [
    [firstWake - sleepMs, firstWake],
    ...finalSleeps.map((x) => [x.start, x.end as number] as Interval),
  ];
  const awakeParts = (iv: Interval) =>
    subtract(iv, asleep).filter(([a, b]) => b - a >= MIN_SEGMENT_MINUTES * MINUTE_MS);

  // --- Light: always timed to the body clock (CBTmin), only while awake ------
  // Light after CBTmin advances the clock; light in the hours before CBTmin delays it.
  // The strongest effect is closest to CBTmin, so seek windows hug it.
  const lightEvents: RawEvent[] = [];
  const pushLight = (kind: 'seek_light' | 'avoid_light', parts: Interval[], key: string) =>
    parts.forEach(([a, b], j) => lightEvents.push({ kind, start: a, end: b, key: j ? `${key}.${j}` : key }));

  for (const c of cycles) {
    const key = String(c.index);
    const seekRegion: Interval = strategy === 'advance'
      ? [c.cbt, c.cbt + SEEK_REGION_HOURS * HOUR_MS]
      : [c.cbt - SEEK_REGION_HOURS * HOUR_MS, c.cbt];
    const avoidRegion: Interval = strategy === 'advance'
      ? [c.cbt - LIGHT_WINDOW_HOURS * HOUR_MS, c.cbt]
      : [c.cbt, c.cbt + LIGHT_WINDOW_HOURS * HOUR_MS];

    const seekParts = awakeParts(seekRegion);
    if (seekParts.length) {
      const maxMs = SEEK_HOURS * HOUR_MS;
      // Take the awake stretch nearest CBTmin, capped at SEEK_HOURS.
      const [a, b] = strategy === 'advance' ? seekParts[0] : seekParts[seekParts.length - 1];
      pushLight('seek_light', [strategy === 'advance' ? [a, Math.min(b, a + maxMs)] : [Math.max(a, b - maxMs), b]], key);
    }
    pushLight('avoid_light', awakeParts(avoidRegion), key);
  }
  const seekIntervals = lightEvents.filter((l) => l.kind === 'seek_light').map((l) => [l.start, l.end as number] as Interval);

  // --- Daily anchors relative to planned sleep -------------------------------
  const points: RawEvent[] = [];
  const spans: RawEvent[] = [];
  cycles.forEach((c, i) => {
    const key = String(c.index);
    const wake = i === 0 ? firstWake : plannedSleepEnd[i - 1];
    const bed = plannedSleepEnd[i] - sleepMs;
    points.push({ kind: 'meal', start: wake, end: null, key });
    points.push({ kind: 'caffeine_cutoff', start: bed - o.caffeineCutoffHours * HOUR_MS, end: null, key });
    if (strategy === 'advance' && o.melatonin) {
      points.push({ kind: 'melatonin', start: bed - MELATONIN_BEFORE_BED_HOURS * HOUR_MS, end: null, key });
    }
    // No naps before bed; time already covered by a seek-light window is left out.
    subtract([bed - NO_NAP_HOURS * HOUR_MS, bed], [...asleep, ...seekIntervals])
      .filter(([a, b]) => b - a >= MIN_SEGMENT_MINUTES * MINUTE_MS)
      .forEach(([a, b], j) => spans.push({ kind: 'no_nap', start: a, end: b, key: j ? `${key}.${j}` : key }));
  });

  const isAsleepAt = (ms: number) => asleep.some(([s, e]) => ms > s && ms < e);
  const keptPoints = points.filter((p) => !isAsleepAt(p.start));

  // Nothing is scheduled before the plan's first day begins.
  const planStart = zonedToUtc(firstDate, '00:00', originTz);
  const fromPlanStart = (r: RawEvent): RawEvent[] => {
    if (r.end === null) return r.start >= planStart ? [r] : [];
    if (r.end <= planStart) return [];
    const start = Math.max(r.start, planStart);
    return r.end - start >= MIN_SEGMENT_MINUTES * MINUTE_MS ? [{ ...r, start }] : [];
  };

  const raw: RawEvent[] = [
    { kind: 'flight', start: depMs, end: arrMs, key: '0' },
    ...[...finalSleeps, ...lightEvents, ...keptPoints, ...spans].flatMap(fromPlanStart),
  ];

  const lastSleepEnd = Math.max(...finalSleeps.map((s) => s.end as number), arrMs);
  const kindOrder: EventKind[] = ['flight', 'in_flight_sleep', 'sleep', 'meal', 'seek_light', 'avoid_light', 'caffeine_cutoff', 'no_nap', 'melatonin'];
  raw.sort((a, b) => a.start - b.start || kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind));

  // --- Build output events ----------------------------------------------------
  const tzFor = (ms: number) => (ms < depMs ? originTz : destTz);
  const stageFor = (ms: number): EventStage => (ms < depMs ? 'before_flight' : ms < arrMs ? 'in_flight' : 'after_arrival');

  const events: PlanEvent[] = raw
    .filter((r) => r.start <= lastSleepEnd)
    .map((r) => {
      const tz = r.kind === 'flight' ? originTz : tzFor(r.start);
      const endTz = r.kind === 'flight' ? destTz : tz;
      return {
        id: `${r.kind}-${r.key}`,
        kind: r.kind,
        stage: r.kind === 'flight' ? 'in_flight' : stageFor(r.start),
        start: toLocalTime(r.start, tz),
        end: r.end === null ? null : toLocalTime(r.end, endTz),
        durationMinutes: r.end === null ? 0 : Math.round((r.end - r.start) / MINUTE_MS),
        title: t.events[r.kind].title,
        description: t.events[r.kind].description,
      };
    });

  // --- Group into days ------------------------------------------------------------
  const depDate = input.departure.date;
  const arrDate = input.arrival.date;
  const phaseFor = (date: string, tz: string, firstStage: EventStage): DayPhase => {
    if (firstStage === 'before_flight' && tz === originTz && date < depDate) return 'pre_trip';
    if (firstStage === 'after_arrival' && date > arrDate) return 'post_arrival';
    return 'travel';
  };

  const dayMap = new Map<string, PlanDay>();
  for (const ev of events) {
    const key = `${ev.start.timeZone}|${ev.start.date}`;
    let day = dayMap.get(key);
    if (!day) {
      day = {
        index: 0,
        date: ev.start.date,
        timeZone: ev.start.timeZone,
        phase: phaseFor(ev.start.date, ev.start.timeZone, ev.stage),
        bodyClock: null,
        events: [],
      };
      dayMap.set(key, day);
    }
    day.events.push(ev);
  }
  const days = [...dayMap.values()];
  // A cycle belongs to the day on which you wake up from it.
  const wakeOf = (i: number) => (i === 0 ? firstWake : plannedSleepEnd[i - 1]);
  days.forEach((d, i) => {
    d.index = i + 1;
    const c = cycles.find((cy) => localDate(wakeOf(cy.index), d.timeZone) === d.date && tzFor(wakeOf(cy.index)) === d.timeZone);
    if (c) d.bodyClock = { cbtMin: toLocalTime(c.cbt, d.timeZone), remainingShiftHours: c.remainingStart };
  });

  // --- Summary --------------------------------------------------------------------
  const preTripShift = roundToMinute(
    cycles.filter((c) => c.cbtNext + cbtOffMs <= depMs).reduce((sum, c) => sum + c.step, 0),
  );
  // Body-clock state on the first morning after landing.
  const firstPostArrival = cycles.find((c) => c.cbt + cbtOffMs >= arrMs);
  const remainingAtArrival = firstPostArrival ? firstPostArrival.remainingStart : 0;

  return {
    engineVersion: ENGINE_VERSION,
    status: 'ok',
    summary: {
      ...baseSummary,
      strategy,
      totalShiftHours: roundToMinute(total),
      preTripShiftHours: preTripShift,
      remainingShiftAtArrivalHours: remainingAtArrival,
      estimatedDaysToAdapt: Math.ceil(remainingAtArrival / rate - 1e-9),
      notes: [
        t.strategyNote({
          diff: formatHours(Math.abs(timeDiff)),
          direction: timeDiff > 0 ? 'east' : 'west',
          strategy,
          total: formatHours(roundToMinute(total)),
          alt: formatHours(roundToMinute(altTotal)),
        }),
        t.rateNote({ advance: formatHours(o.advanceHoursPerDay), delay: formatHours(o.delayHoursPerDay) }),
      ],
    },
    days,
    events,
    safetyNotes: [...t.safety],
  };
}
