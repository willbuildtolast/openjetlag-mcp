// Human/agent-readable rendering of a plan. Many MCP hosts pass only the text content
// to the model, so this must carry everything needed to act, including exact times.

import type { JetLagPlan } from '@openjetlag/core';
import { eventLine, type Reminder } from './reminders.js';

type Language = 'en' | 'zh';

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
    schedule: 'Schedule (local times; exact ISO timestamp in brackets):',
    reminders: (n: number) => `${n} reminder times are in structuredContent.reminders (each has an ISO "at"). Schedule them with your own reminder tool.`,
    empty: 'No remaining events after the requested start time.',
  },
  zh: {
    header: 'OpenJetLag 倒时差计划',
    noPlan: '无需专门的调整计划。',
    strategy: (s: JetLagPlan['summary']) =>
      `策略：生物钟${s.strategy === 'advance' ? '提前' : '推迟'} ${s.totalShiftHours} 小时 · 出发前调整 ${s.preTripShiftHours} 小时 · 落地后约 ${s.estimatedDaysToAdapt} 天适应。`,
    phase: { pre_trip: '出发前', travel: '旅行日', post_arrival: '落地后' },
    safety: '安全提示（务必展示给用户）：',
    schedule: '日程（当地时间；方括号内为精确 ISO 时间）：',
    reminders: (n: number) => `structuredContent.reminders 中有 ${n} 个提醒时间（每个都有 ISO 格式的 "at"），请用你自己的提醒工具设置。`,
    empty: '指定时间之后没有剩余事件。',
  },
};

function weekday(date: string, lang: Language): string {
  const [y, m, d] = date.split('-').map(Number);
  return WEEKDAYS[lang][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export function renderPlan(plan: JetLagPlan, reminders: Reminder[], lang: Language): string {
  const t = L[lang];
  const s = plan.summary;
  const sign = s.timeDifferenceHours > 0 ? '+' : '';
  const lines: string[] = [
    `${t.header}: ${s.originTimeZone} → ${s.destinationTimeZone} (${sign}${s.timeDifferenceHours} h)`,
  ];

  if (plan.status !== 'ok') {
    lines.push(t.noPlan, ...s.notes, '', t.safety, ...plan.safetyNotes.map((n) => `- ${n}`));
    return lines.join('\n');
  }

  lines.push(t.strategy(s), ...s.notes, '', t.safety, ...plan.safetyNotes.map((n) => `- ${n}`), '', t.schedule);
  if (plan.days.length === 0) lines.push(t.empty);
  for (const d of plan.days) {
    lines.push('', `${weekday(d.date, lang)} ${d.date} · ${d.timeZone} · ${t.phase[d.phase]}`);
    for (const e of d.events) lines.push(`- ${eventLine(e)} [${e.start.iso}]`);
  }
  lines.push('', t.reminders(reminders.length));
  return lines.join('\n');
}
