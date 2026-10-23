// Turns a plan into a short series of proactive check-ins: a morning briefing, a
// nudge at the moments that matter and a wind-down before bed (about 3-4 a day).
//
// Deliberately no pre-written text: each message carries the facts and intent
// (when, where the traveller is in the trip, what to do, why, practical options),
// and the agent composes the actual words in its own voice, ideally at send time
// when it can also factor in weather, the traveller's calendar and how they feel.

import { toLocalTime, type EventKind, type JetLagPlan, type PlanDay, type PlanEvent } from '@openjetlag/core';
import { cityName } from './places.js';

export type Lang = 'en' | 'zh';

export interface MessageOptions {
  lang: Lang;
  originCity?: string;
  destinationCity?: string;
}

export type MessageType = 'morning_briefing' | 'flight' | 'wind_down' | 'nudge';

export interface FocusItem {
  kind: EventKind;
  /** Short name of the action, in the plan's language. */
  action: string;
  /** "07:00–10:00" or "22:00", local to the traveller at send time (labelled if another zone). */
  when: string;
  /** Why it matters, as a terse note (not a sentence to copy). */
  why: string;
  /** Practical options the traveller can choose from. */
  options: string[];
}

export interface ScheduledMessage {
  /** When to send, ISO 8601 with the UTC offset of where the traveller will be. */
  send_at: string;
  send_at_utc: string;
  time_zone: string;
  type: MessageType;
  priority: 'high' | 'normal';
  trip: {
    /** e.g. "3 days before departure", "day 2 in London". */
    moment: string;
    destination: string;
    days_to_departure: number | null;
    day_in_destination: number | null;
    /** Body-clock shift done so far (hours) out of the total the plan works through. */
    body_clock_adjusted_hours: number;
    body_clock_total_hours: number;
    first_day_of_plan: boolean;
  };
  /** What this message is about. */
  focus: FocusItem[];
  /** Morning briefings only: the rest of the day at a glance. */
  later_today: Array<{ kind: EventKind; action: string; when: string }>;
  event_ids: string[];
}

const MIN = 60_000;
const GROUP_WINDOW_MIN = 45;

/** Minutes before an event to send its message; kinds not listed only appear in briefings. */
const LEAD: Partial<Record<EventKind, number>> = {
  seek_light: 10,
  avoid_light: 10,
  melatonin: 0,
  in_flight_sleep: 0,
  sleep: 30,
  flight: 60,
};

const FOCUS_ORDER: EventKind[] = ['meal', 'flight', 'sleep', 'in_flight_sleep', 'seek_light', 'avoid_light', 'melatonin'];

// --- Facts per action (terse notes for the agent to build on, not copy) ---------------

interface Fact {
  action: string;
  why: (strategy: 'advance' | 'delay') => string;
  options: (inFlight: boolean) => string[];
}

const FACTS: Record<Lang, Record<EventKind, Fact>> = {
  en: {
    seek_light: {
      action: 'get bright light',
      why: (s) => (s === 'advance' ? 'light now shifts the body clock earlier: sleepy sooner tonight, easier to wake' : 'light now shifts the body clock later: stays alert into the evening'),
      options: (f) => (f ? ['open the window shade', 'reading light on'] : ['20-30 min outdoors (overcast daylight still beats indoor light)', 'if stuck inside: sit by a window or use the brightest lamps']),
    },
    avoid_light: {
      action: 'avoid bright light',
      why: () => 'light now would push the body clock the wrong way',
      options: (f) => (f ? ['window shade down', 'eye mask'] : ['sunglasses outdoors', 'dim indoor lights', 'night mode on screens']),
    },
    melatonin: {
      action: 'optional melatonin',
      why: () => 'can help shift the body clock earlier; only if they chose to use it',
      options: () => ['follow the product label (never suggest a dose)', 'skip if pregnant, breastfeeding or on medication'],
    },
    sleep: {
      action: 'sleep window',
      why: () => 'planned sleep on the new schedule',
      options: () => ['start winding down now: dim lights, screens away', 'cool, dark, quiet room'],
    },
    in_flight_sleep: {
      action: 'sleep on the plane',
      why: () => 'this part of the flight is their planned night',
      options: () => ['eye mask and earplugs', 'no alcohol or caffeine'],
    },
    flight: {
      action: 'flight',
      why: () => 'travel day',
      options: () => ['switch watch and phone to destination time on boarding', 'water; go easy on alcohol'],
    },
    meal: {
      action: 'breakfast',
      why: () => 'a protein-rich breakfast anchors the new morning',
      options: () => [],
    },
    caffeine_cutoff: {
      action: 'last caffeine',
      why: () => "protects tonight's sleep",
      options: () => ['switch to water or decaf afterwards'],
    },
    no_nap: {
      action: 'no naps',
      why: () => 'builds sleep pressure for tonight',
      options: () => [],
    },
  },
  zh: {
    seek_light: {
      action: '晒光',
      why: (s) => (s === 'advance' ? '此时的光把生物钟往前拨：晚上更早犯困、早上更容易醒' : '此时的光把生物钟往后推：晚上能撑得更晚'),
      options: (f) => (f ? ['打开遮光板', '打开阅读灯'] : ['户外 20-30 分钟（阴天也比室内亮得多）', '出不去就坐窗边或开最亮的灯']),
    },
    avoid_light: {
      action: '避光',
      why: () => '此时的光会把生物钟往反方向推',
      options: (f) => (f ? ['拉下遮光板', '戴眼罩'] : ['户外戴墨镜', '室内调暗灯光', '屏幕开夜间模式']),
    },
    melatonin: {
      action: '褪黑素（可选）',
      why: () => '有助于把生物钟往前调；仅在用户选择使用时提及',
      options: () => ['按产品说明服用（不要建议剂量）', '孕期、哺乳期或在服药者不要自行使用'],
    },
    sleep: {
      action: '睡眠窗口',
      why: () => '按新作息的计划睡眠',
      options: () => ['现在开始收尾：调暗灯光、放下屏幕', '房间保持凉爽、黑暗、安静'],
    },
    in_flight_sleep: {
      action: '机上睡眠',
      why: () => '这段航程对应计划中的夜晚',
      options: () => ['眼罩和耳塞', '不喝酒和咖啡'],
    },
    flight: {
      action: '航班',
      why: () => '出行日',
      options: () => ['登机后把手表和手机调成目的地时间', '多喝水，少喝酒'],
    },
    meal: {
      action: '早餐',
      why: () => '富含蛋白质的早餐帮身体确认新的"早上"',
      options: () => [],
    },
    caffeine_cutoff: {
      action: '最后一杯咖啡因',
      why: () => '保护今晚的睡眠',
      options: () => ['之后换成水或无咖啡因饮品'],
    },
    no_nap: {
      action: '不要打盹',
      why: () => '积累今晚的睡眠压力',
      options: () => [],
    },
  },
};

const MOMENT: Record<Lang, { pre: (n: number) => string; departure: string; arrival: (n: number, dest: string) => string; tz: (city: string) => string }> = {
  en: {
    pre: (n) => `${n} day${n === 1 ? '' : 's'} before departure`,
    departure: 'departure day',
    arrival: (n, d) => `day ${n} in ${d}`,
    tz: (c) => ` (${c} time)`,
  },
  zh: {
    pre: (n) => `出发前 ${n} 天`,
    departure: '出发当天',
    arrival: (n, d) => `抵达${d}第 ${n} 天`,
    tz: (c) => `（${c}时间）`,
  },
};

// --- Builder ---------------------------------------------------------------------------

interface Item {
  sendMs: number;
  ev: PlanEvent;
  day: PlanDay;
  anchor: boolean;
}

const ms = (iso: string) => Date.parse(iso);

function dayDiff(a: string, b: string): number {
  const toUtc = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  return Math.round((toUtc(a) - toUtc(b)) / 86_400_000);
}

export function buildMessages(plan: JetLagPlan, opts: MessageOptions, fromMs = -Infinity): ScheduledMessage[] {
  if (plan.status !== 'ok' || plan.summary.strategy === 'none') return [];
  const facts = FACTS[opts.lang];
  const M = MOMENT[opts.lang];
  const s = plan.summary;
  const strategy = s.strategy as 'advance' | 'delay';
  const dest = opts.destinationCity?.trim() || cityName(s.destinationTimeZone, opts.lang);
  const origin = opts.originCity?.trim() || cityName(s.originTimeZone, opts.lang);
  const depMs = ms(s.flight.departure.utc);
  const arrMs = ms(s.flight.arrival.utc);
  const depDate = s.flight.departure.date;
  const arrDate = s.flight.arrival.date;
  const firstPreDate = plan.days.find((d) => d.phase === 'pre_trip')?.date ?? plan.days[0]?.date;

  // 1. Candidate items: a briefing at each wake-up, plus the moments worth a nudge.
  const items: Item[] = [];
  for (const day of plan.days) {
    const anchor = day.events.find((e) => e.kind === 'meal' && e.stage !== 'in_flight');
    if (anchor) items.push({ sendMs: ms(anchor.start.utc), ev: anchor, day, anchor: true });
    for (const ev of day.events) {
      const lead = LEAD[ev.kind];
      if (lead !== undefined) items.push({ sendMs: ms(ev.start.utc) - lead * MIN, ev, day, anchor: false });
    }
  }
  items.sort((a, b) => a.sendMs - b.sendMs || Number(b.anchor) - Number(a.anchor));

  // 2. Merge items that fall close together into one message.
  const groups: Item[][] = [];
  for (const it of items) {
    const g = groups.at(-1);
    if (g && it.sendMs - g[0].sendMs <= GROUP_WINDOW_MIN * MIN) g.push(it);
    else groups.push([it]);
  }

  // 3. Helpers.
  const sleeps = plan.events
    .filter((e) => (e.kind === 'sleep' || e.kind === 'in_flight_sleep') && e.end)
    .map((e) => [ms(e.start.utc), ms(e.end!.utc)] as const);
  const awakeAt = (t: number) => {
    for (const [a, b] of sleeps) if (t > a && t < b) return b;
    return t;
  };

  const remainingFor = (day: PlanDay): number => {
    for (let i = plan.days.indexOf(day); i >= 0; i--) {
      const bc = plan.days[i].bodyClock;
      if (bc) return bc.remainingShiftHours;
    }
    return s.totalShiftHours;
  };

  const whenOf = (ev: PlanEvent, msgTz: string): string => {
    const label = ev.start.timeZone !== msgTz && ev.kind !== 'flight' ? M.tz(ev.start.timeZone === s.destinationTimeZone ? dest : origin) : '';
    return ev.end ? `${ev.start.time}–${ev.end.time}${label}` : `${ev.start.time}${label}`;
  };

  // 4. Build each message.
  const out: ScheduledMessage[] = [];
  for (const g of groups) {
    const anchorItem = g.find((i) => i.anchor);
    const kinds = new Set(g.map((i) => i.ev.kind));
    const type: MessageType = anchorItem ? 'morning_briefing' : kinds.has('flight') ? 'flight' : kinds.has('sleep') || kinds.has('in_flight_sleep') ? 'wind_down' : 'nudge';
    // Briefings go out at wake-up; nudges never inside a planned sleep.
    const sendMs = anchorItem ? anchorItem.sendMs : type === 'wind_down' ? g[0].sendMs : awakeAt(g[0].sendMs);
    if (sendMs < fromMs) continue;

    const tz = (anchorItem ?? g[0]).ev.start.timeZone;
    const local = toLocalTime(sendMs, tz);
    const refDay = (anchorItem ?? g[0]).day;
    const remaining = remainingFor(refDay);

    const isPre = sendMs < depMs && local.date < depDate && tz === s.originTimeZone;
    const daysToDeparture = isPre ? dayDiff(depDate, local.date) : null;
    const dayInDest = !isPre && sendMs >= arrMs ? Math.max(1, dayDiff(local.date, arrDate) + 1) : null;
    const moment = daysToDeparture !== null ? M.pre(daysToDeparture) : dayInDest !== null ? M.arrival(dayInDest, dest) : M.departure;

    const events = [...new Map(g.map((i) => [i.ev.id, i.ev])).values()].sort(
      (a, b) => FOCUS_ORDER.indexOf(a.kind) - FOCUS_ORDER.indexOf(b.kind) || ms(a.start.utc) - ms(b.start.utc),
    );
    const focus: FocusItem[] = events.map((ev) => {
      const f = facts[ev.kind];
      return { kind: ev.kind, action: f.action, when: whenOf(ev, tz), why: f.why(strategy), options: f.options(ev.stage === 'in_flight') };
    });

    let laterToday: ScheduledMessage['later_today'] = [];
    if (anchorItem) {
      const covered = new Set(events.map((e) => e.id));
      const startMs = ms(anchorItem.ev.start.utc);
      const nextSleep = plan.events.find((e) => (e.kind === 'sleep' || e.kind === 'in_flight_sleep') && ms(e.start.utc) > startMs);
      const untilMs = nextSleep ? ms(nextSleep.start.utc) : startMs + 20 * 60 * MIN;
      laterToday = plan.events
        .filter((e) => !covered.has(e.id) && ms(e.start.utc) > startMs && ms(e.start.utc) <= untilMs)
        .map((e) => ({ kind: e.kind, action: facts[e.kind].action, when: whenOf(e, tz) }));
    }

    const highKinds: EventKind[] = ['seek_light', 'avoid_light', 'sleep', 'in_flight_sleep', 'flight'];
    out.push({
      send_at: local.iso,
      send_at_utc: local.utc,
      time_zone: tz,
      type,
      priority: type === 'morning_briefing' || events.some((e) => highKinds.includes(e.kind)) ? 'high' : 'normal',
      trip: {
        moment,
        destination: dest,
        days_to_departure: daysToDeparture,
        day_in_destination: dayInDest,
        body_clock_adjusted_hours: Math.max(0, s.totalShiftHours - remaining),
        body_clock_total_hours: s.totalShiftHours,
        first_day_of_plan: type === 'morning_briefing' && local.date === firstPreDate && tz === s.originTimeZone,
      },
      focus,
      later_today: laterToday,
      event_ids: events.map((e) => e.id),
    });
  }
  return out;
}
