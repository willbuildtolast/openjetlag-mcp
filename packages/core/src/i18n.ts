import type { EventKind, Locale } from './types.js';

interface Strings {
  events: Record<EventKind, { title: string; description: string }>;
  strategyNote: (p: { diff: string; direction: 'east' | 'west'; strategy: 'advance' | 'delay'; total: string; alt: string }) => string;
  rateNote: (p: { advance: string; delay: string }) => string;
  minimal: (diff: string) => string;
  safety: string[];
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
export const formatHours = fmt;

const en: Strings = {
  events: {
    sleep: {
      title: 'Sleep window',
      description: 'Planned sleep for tonight. Keep the room dark, cool and quiet, and dim screens for the hour before.',
    },
    in_flight_sleep: {
      title: 'Sleep on the plane',
      description: 'This part of the flight overlaps your planned sleep. Use an eye mask and earplugs, and skip alcohol and caffeine.',
    },
    seek_light: {
      title: 'Seek bright light',
      description: 'Light is the strongest signal to your body clock. Get outdoor daylight or bright indoor light during this window.',
    },
    avoid_light: {
      title: 'Avoid bright light',
      description: 'Light now would push your body clock the wrong way. Wear sunglasses outdoors, keep lights dim, close the window shade if flying.',
    },
    caffeine_cutoff: {
      title: 'Last caffeine',
      description: "Caffeine can affect sleep for many hours. Avoid coffee, tea and energy drinks from now until tonight's sleep.",
    },
    no_nap: {
      title: 'No naps',
      description: 'Stay awake even if you feel drowsy. Building sleep pressure now helps you sleep through the night.',
    },
    melatonin: {
      title: 'Optional: melatonin',
      description: 'Melatonin taken around this time can help shift your clock earlier. Follow the product label or ask a clinician; skip it if pregnant, breastfeeding or on medication.',
    },
    meal: {
      title: 'Breakfast anchor',
      description: 'Eat a protein-rich breakfast soon after waking. Regular meal times reinforce your new schedule.',
    },
    flight: {
      title: 'Flight',
      description: 'Switch your watch and phone to destination time. Follow the sleep and light windows for the flight shown in the plan.',
    },
  },
  strategyNote: ({ diff, direction, strategy, total, alt }) => {
    const dir = direction === 'east' ? 'Eastward' : 'Westward';
    const verb = strategy === 'advance' ? 'advancing (shifting earlier)' : 'delaying (shifting later)';
    const altVerb = strategy === 'advance' ? 'delaying' : 'advancing';
    return `${dir} trip, ${diff} h time difference. This plan adapts by ${verb} your body clock by ${total} h, estimated to be faster than ${altVerb} it by ${alt} h.`;
  },
  rateNote: ({ advance, delay }) =>
    `Estimates assume your body clock can advance about ${advance} h or delay about ${delay} h per day when you follow the light windows.`,
  minimal: (diff) => `The time difference is only ${diff} h. Most people adapt within a day or two without a dedicated plan.`,
  safety: [
    'Educational guidance based on circadian science, not medical advice.',
    'Melatonin and other supplements: follow the product label or ask a clinician, especially if pregnant, breastfeeding or taking other medication.',
    'If you have a sleep disorder, bipolar disorder, an eye condition, or take light-sensitising medication, check with a clinician before using bright-light timing.',
    'Do not drive or operate machinery while drowsy.',
  ],
};

const zh: Strings = {
  events: {
    sleep: {
      title: '睡眠窗口',
      description: '今晚的计划睡眠时间。保持卧室黑暗、凉爽、安静，睡前一小时调暗屏幕。',
    },
    in_flight_sleep: {
      title: '机上睡眠',
      description: '这段飞行与计划睡眠时间重合。戴上眼罩和耳塞，避免酒精和咖啡因。',
    },
    seek_light: {
      title: '拥抱阳光',
      description: '光照是调节生物钟最强的信号。请在此时段到户外晒太阳，或待在明亮的室内环境。',
    },
    avoid_light: {
      title: '避开强光',
      description: '此时的光线会把生物钟往错误的方向推。户外请戴墨镜，室内保持灯光柔和，飞行中请拉下遮光板。',
    },
    caffeine_cutoff: {
      title: '最后一杯咖啡因',
      description: '咖啡因对睡眠的影响可持续数小时。从现在到今晚入睡前，请避免咖啡、茶和功能饮料。',
    },
    no_nap: {
      title: '不要午睡',
      description: '即使感到困倦也请保持清醒。积蓄睡眠压力有助于今晚一觉睡到天亮。',
    },
    melatonin: {
      title: '可选：褪黑素',
      description: '在此时间前后服用褪黑素有助于把生物钟往前调。请遵循产品说明或咨询医生；孕期、哺乳期或正在服药者请勿自行使用。',
    },
    meal: {
      title: '早餐锚定',
      description: '醒来后尽快吃一顿富含蛋白质的早餐。规律的进餐时间能巩固新的作息。',
    },
    flight: {
      title: '航班',
      description: '把手表和手机切换到目的地时间。飞行途中请按照计划中的睡眠和光照时段执行。',
    },
  },
  strategyNote: ({ diff, direction, strategy, total, alt }) => {
    const dir = direction === 'east' ? '向东飞行' : '向西飞行';
    const verb = strategy === 'advance' ? '提前（往早调）' : '推迟（往晚调）';
    const altVerb = strategy === 'advance' ? '推迟' : '提前';
    return `${dir}，时差 ${diff} 小时。本计划将生物钟${verb} ${total} 小时，预计比${altVerb} ${alt} 小时更快适应。`;
  },
  rateNote: ({ advance, delay }) =>
    `估算假设在遵循光照时段的情况下，生物钟每天约可提前 ${advance} 小时或推迟 ${delay} 小时。`,
  minimal: (diff) => `时差仅 ${diff} 小时，大多数人无需专门调整，一两天内即可自然适应。`,
  safety: [
    '本计划为基于生物节律科学的教育性建议，不构成医疗建议。',
    '褪黑素等补充剂：请遵循产品说明或咨询医生，孕期、哺乳期或正在服用其他药物者尤其需要注意。',
    '如有睡眠障碍、双相情感障碍、眼部疾病，或正在服用光敏性药物，使用强光调节前请先咨询医生。',
    '困倦时请勿驾驶或操作机械。',
  ],
};

export const strings: Record<Locale, Strings> = { en, zh };
