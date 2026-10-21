# @openjetlag/core

Zero-dependency jet lag planning engine, part of [OpenJetLag MCP](../../README.md). Give it a flight and a usual sleep schedule; it returns a day-by-day plan of light, sleep, caffeine, nap and (optional) melatonin timing, with every event as an absolute, time-zone-aware timestamp that an app or AI agent can schedule reminders from.

Pure function, no network, no storage, no LLM. Runs anywhere modern `Intl` is available (Node 18+, browsers, edge runtimes).

## Usage

```ts
import { generatePlan } from '@openjetlag/core';

const plan = generatePlan({
  originTimeZone: 'America/New_York',
  destinationTimeZone: 'Europe/London',
  departure: { date: '2026-11-10', time: '19:00' }, // local to origin
  arrival: { date: '2026-11-11', time: '07:00' },   // local to destination
  habitualSleep: { bedtime: '23:00', wakeTime: '07:00' },
  options: { preTripDays: 3, locale: 'en' },
});

plan.summary;      // direction, strategy, total shift, estimated days to adapt, notes
plan.events;       // flat, chronological; each has start/end { iso, date, time, timeZone, utc }
plan.days;         // events grouped by local date, with phase and body-clock estimate
plan.safetyNotes;  // show these with the plan
```

Invalid input throws `JetLagInputError` with a message safe to show to users.

### Options

| Option | Default | Meaning |
|---|---|---|
| `preTripDays` | `3` | Days before departure to start shifting at home (0–7) |
| `strategy` | `"auto"` | `"advance"`, `"delay"`, or pick whichever finishes sooner |
| `advanceHoursPerDay` | `1` | Estimated achievable body-clock advance per day |
| `delayHoursPerDay` | `1.5` | Estimated achievable body-clock delay per day |
| `advanceSleepLeadHours` | `3` | After departure, how far planned sleep may run ahead of the body clock when advancing |
| `delaySleepLeadHours` | `12` | Same when delaying (12 ≈ adopt local sleep immediately) |
| `cbtMinBeforeWakeHours` | `2` | Body temperature minimum estimated this long before habitual wake |
| `caffeineCutoffHours` | `10` | Last caffeine this long before planned bedtime |
| `melatonin` | `true` | Include optional melatonin timing (never a dose) when advancing |
| `locale` | `"en"` | `"en"` or `"zh"` for titles, descriptions and notes |

## Model

1. **Time difference** is taken from the IANA zones at the arrival instant, so daylight saving is applied for the real trip dates.
2. **Strategy**: advancing (eastward) is slower than delaying, so for large eastward trips the engine compares `advanceHours / advanceRate` with `delayHours / delayRate` and picks the shorter.
3. **Body clock**: the core body temperature minimum (CBTmin) starts at habitual wake − 2 h and moves by at most the daily rate each night, from the first pre-trip day until it matches the destination.
4. **Light** is always timed to the body clock: after CBTmin advances it, the hours before CBTmin delay it. Seek windows hug CBTmin on the useful side; avoid windows cover the harmful side. Both are clipped to waking hours.
5. **Sleep** follows the body clock at home, then moves toward the local schedule after departure, ahead of the body clock by at most the sleep lead. Sleep that overlaps the flight becomes in-flight sleep.
6. **Anchors** (breakfast at wake, caffeine cutoff, no-nap window, melatonin) are placed relative to planned sleep.

These are population-level estimates for education, not medical advice.

## Development

```sh
npm test          # vitest
npm run build     # emits dist/ (ESM + .d.ts)
```
