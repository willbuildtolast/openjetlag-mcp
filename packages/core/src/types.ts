export type Locale = 'en' | 'zh';

export interface PlanInput {
  /** IANA time zone of the departure city, e.g. "America/New_York". */
  originTimeZone: string;
  /** IANA time zone of the destination city, e.g. "Asia/Tokyo". */
  destinationTimeZone: string;
  /** Departure, as local wall-clock time in the origin time zone. */
  departure: { date: string; time: string }; // YYYY-MM-DD, HH:mm
  /** Arrival, as local wall-clock time in the destination time zone. */
  arrival: { date: string; time: string };
  /** The traveller's usual sleep schedule at home. */
  habitualSleep: { bedtime: string; wakeTime: string }; // HH:mm
  options?: PlanOptions;
}

export interface PlanOptions {
  /** Days before departure to start shifting at home (0-7). Default 3. */
  preTripDays?: number;
  /** "auto" picks whichever direction is estimated to finish sooner. Default "auto". */
  strategy?: 'auto' | 'advance' | 'delay';
  /** Estimated body-clock advance achievable per day, in hours. Default 1. */
  advanceHoursPerDay?: number;
  /** Estimated body-clock delay achievable per day, in hours. Default 1.5. */
  delayHoursPerDay?: number;
  /** Core body temperature minimum is estimated this many hours before habitual wake. Default 2. */
  cbtMinBeforeWakeHours?: number;
  /** Stop caffeine this many hours before the planned bedtime. Default 10. */
  caffeineCutoffHours?: number;
  /**
   * After departure, planned sleep may run ahead of the body clock toward the local
   * schedule by up to this many hours. Staying up late is easy, falling asleep early is
   * hard, hence the asymmetric defaults: advance 3, delay 12 (i.e. local schedule at once).
   */
  advanceSleepLeadHours?: number;
  delaySleepLeadHours?: number;
  /** Include optional melatonin timing suggestions when advancing. Default true. */
  melatonin?: boolean;
  /** Language for titles, descriptions and notes. Default "en". */
  locale?: Locale;
}

export interface LocalTime {
  /** ISO 8601 with UTC offset, e.g. "2026-03-11T07:30:00+00:00". */
  iso: string;
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  /** Local wall-clock time, HH:mm. */
  time: string;
  timeZone: string;
  /** Same instant in UTC, e.g. "2026-03-11T07:30:00.000Z". */
  utc: string;
}

export type EventKind =
  | 'sleep'
  | 'in_flight_sleep'
  | 'seek_light'
  | 'avoid_light'
  | 'caffeine_cutoff'
  | 'no_nap'
  | 'melatonin'
  | 'meal'
  | 'flight';

export type EventStage = 'before_flight' | 'in_flight' | 'after_arrival';

export interface PlanEvent {
  /** Stable within one plan, e.g. "seek_light-4". */
  id: string;
  kind: EventKind;
  stage: EventStage;
  start: LocalTime;
  /** null for point-in-time events (meal, caffeine cutoff, melatonin). */
  end: LocalTime | null;
  durationMinutes: number;
  title: string;
  description: string;
}

export type DayPhase = 'pre_trip' | 'travel' | 'post_arrival';

export interface PlanDay {
  /** 1-based position in the plan. */
  index: number;
  date: string;
  timeZone: string;
  phase: DayPhase;
  /** Estimated body-clock state for this day, when a body-clock cycle starts on it. */
  bodyClock: {
    cbtMin: LocalTime;
    /** Hours of shift still remaining at the start of this day. */
    remainingShiftHours: number;
  } | null;
  events: PlanEvent[];
}

export interface PlanSummary {
  originTimeZone: string;
  destinationTimeZone: string;
  /** Destination minus origin UTC offset at arrival, normalised to (-12, 12]. */
  timeDifferenceHours: number;
  travelDirection: 'east' | 'west' | 'none';
  strategy: 'advance' | 'delay' | 'none';
  /** Total body-clock shift the plan works through, in hours. */
  totalShiftHours: number;
  /** Shift completed before departure (from pre-trip days). */
  preTripShiftHours: number;
  /** Shift still remaining when the first post-arrival night begins. */
  remainingShiftAtArrivalHours: number;
  /** Estimated days after arrival until the body clock matches the destination. */
  estimatedDaysToAdapt: number;
  flight: { departure: LocalTime; arrival: LocalTime; durationMinutes: number };
  notes: string[];
}

export interface JetLagPlan {
  engineVersion: string;
  status: 'ok' | 'no_adjustment_needed';
  summary: PlanSummary;
  days: PlanDay[];
  /** All events across all days, sorted by start time. */
  events: PlanEvent[];
  /** Must be shown to the traveller alongside the plan. */
  safetyNotes: string[];
}
