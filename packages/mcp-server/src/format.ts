// Text content of plan_jetlag_trip. Many MCP hosts pass only this text to the model,
// so it must carry everything the agent needs: what to do next, every message with
// its exact send time, and the full schedule.

import type { JetLagPlan } from '@openjetlag/core';
import type { ScheduledMessage } from './messages.js';
import { eventLine } from './reminders.js';

type Language = 'en' | 'zh';

export interface PlanSettings {
  pre_trip_days: number;
  /** True when fewer pre-trip days were used because departure is soon. */
  pre_trip_days_reduced: boolean;
  melatonin: boolean;
  language: Language;
}

const WEEKDAYS: Record<Language, string[]> = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  zh: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
};

const L = {
  en: {
    header: 'OpenJetLag plan',
    noPlan: 'No dedicated plan needed.',
    strategy: (s: JetLagPlan['summary']) =>
      `Strategy: ${s.strategy} body clock by ${s.totalShiftHours} h · pre-trip shift ${s.preTripShiftHours} h · about ${s.estimatedDaysToAdapt} day(s) to adapt after arrival.`,
    phase: { pre_trip: 'before the trip', travel: 'travel day', post_arrival: 'after arrival' },
    safety: 'Safety notes (always show these to the traveller):',
    messages: (n: number) => `Check-ins to schedule (${n}). Facts and intent only; you write the words:`,
    noMessages: 'Scheduled messages: none still ahead (all send times have passed).',
    schedule: 'Full schedule (local times; exact ISO timestamp in brackets):',
    empty: 'No remaining events after the requested start time.',
  },
  zh: {
    header: 'OpenJetLag 倒时差计划',
    noPlan: '无需专门的调整计划。',
    strategy: (s: JetLagPlan['summary']) =>
      `策略：生物钟${s.strategy === 'advance' ? '提前' : '推迟'} ${s.totalShiftHours} 小时 · 出发前调整 ${s.preTripShiftHours} 小时 · 落地后约 ${s.estimatedDaysToAdapt} 天适应。`,
    phase: { pre_trip: '出发前', travel: '旅行日', post_arrival: '落地后' },
    safety: '安全提示（务必展示给用户）：',
    messages: (n: number) => `需要安排的主动消息（${n} 条）。以下只是事实和意图，措辞由你决定：`,
    noMessages: '主动消息：没有尚未到时间的消息（发送时间都已过去）。',
    schedule: '完整日程（当地时间；方括号内为精确 ISO 时间）：',
    empty: '指定时间之后没有剩余事件。',
  },
};

function weekday(date: string, lang: Language): string {
  const [y, m, d] = date.split('-').map(Number);
  return WEEKDAYS[lang][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function assistantSteps(messages: ScheduledMessage[], settings: PlanSettings): string[] {
  const first = messages[0];
  const lines = [
    'FOR THE ASSISTANT, next steps:',
    "1. Schedule the check-ins below now, without asking first: one message to the traveller in this conversation at each send_at time, using your scheduling, background-task or reminder ability. Keep each entry's facts with the scheduled job. Don't substitute a calendar file; use get_plan_calendar_file only if they ask for one or you genuinely cannot schedule messages.",
    '2. These are not scripts. When each one is due, write it yourself, in your own voice and the traveller\'s language: what to do and when, why it matters for this trip (countdown, body-clock progress), and an easy option or two. Factor in whatever you know at that moment (weather, their calendar, how they slept). Keep every time exactly as given.',
    `3. Reply now in a few lines: the strategy, the safety notes, and what you've set up${first ? ` (${messages.length} check-ins, about 3-4 a day, the first at ${first.send_at})` : ''}. They can say "fewer messages", "pause" or "stop" at any time; for "fewer", keep only morning_briefing and wind_down.`,
    `4. To recalculate later ("what now?", changed flight), call plan_jetlag_trip with the same details and pre_trip_days: ${settings.pre_trip_days}.`,
  ];
  if (settings.pre_trip_days_reduced) {
    lines.push(`Note: departure is soon, so only ${settings.pre_trip_days} pre-trip day(s) were planned.`);
  }
  return lines;
}

function renderMessage(m: ScheduledMessage, lang: Language): string[] {
  const progress =
    lang === 'zh'
      ? `生物钟已调 ${m.trip.body_clock_adjusted_hours}/${m.trip.body_clock_total_hours} 小时`
      : `body clock ${m.trip.body_clock_adjusted_hours}/${m.trip.body_clock_total_hours} h adjusted`;
  const lines = [`[${m.send_at}] ${m.type} · ${m.priority} · ${m.trip.moment} · ${progress}${m.trip.first_day_of_plan ? (lang === 'zh' ? ' · 计划第一天' : ' · first day of the plan') : ''}`];
  for (const f of m.focus) {
    const opts = f.options.length ? ` | ${f.options.join('; ')}` : '';
    lines.push(`  • ${f.when} ${f.action}: ${f.why}${opts}`);
  }
  if (m.later_today.length) {
    lines.push(`  ${lang === 'zh' ? '今天接下来' : 'later today'}: ${m.later_today.map((x) => `${x.when} ${x.action}`).join('; ')}`);
  }
  return lines;
}

export function renderPlan(plan: JetLagPlan, messages: ScheduledMessage[], lang: Language, settings: PlanSettings): string {
  const t = L[lang];
  const s = plan.summary;
  const sign = s.timeDifferenceHours > 0 ? '+' : '';
  const lines: string[] = [`${t.header}: ${s.originTimeZone} → ${s.destinationTimeZone} (${sign}${s.timeDifferenceHours} h)`];

  if (plan.status !== 'ok') {
    lines.push(t.noPlan, ...s.notes, '', t.safety, ...plan.safetyNotes.map((n) => `- ${n}`));
    return lines.join('\n');
  }

  lines.push(t.strategy(s), ...s.notes, '', t.safety, ...plan.safetyNotes.map((n) => `- ${n}`));
  lines.push('', ...assistantSteps(messages, settings));

  lines.push('', messages.length ? t.messages(messages.length) : t.noMessages);
  for (const m of messages) lines.push('', ...renderMessage(m, lang));

  lines.push('', t.schedule);
  if (plan.days.length === 0) lines.push(t.empty);
  for (const d of plan.days) {
    lines.push('', `${weekday(d.date, lang)} ${d.date} · ${d.timeZone} · ${t.phase[d.phase]}`);
    for (const e of d.events) lines.push(`- ${eventLine(e)} [${e.start.iso}]`);
  }
  return lines.join('\n');
}
