// Fallback display names for time zones, used only when the agent does not pass
// the traveller's own city names.

const ZH: Record<string, string> = {
  'Asia/Shanghai': '上海', 'Asia/Hong_Kong': '香港', 'Asia/Taipei': '台北', 'Asia/Tokyo': '东京',
  'Asia/Seoul': '首尔', 'Asia/Singapore': '新加坡', 'Asia/Bangkok': '曼谷', 'Asia/Dubai': '迪拜',
  'Asia/Kolkata': '印度', 'Asia/Jakarta': '雅加达', 'Asia/Kuala_Lumpur': '吉隆坡', 'Asia/Ho_Chi_Minh': '胡志明市',
  'Asia/Manila': '马尼拉', 'Asia/Jerusalem': '耶路撒冷', 'Asia/Qatar': '多哈',
  'Europe/London': '伦敦', 'Europe/Paris': '巴黎', 'Europe/Berlin': '柏林', 'Europe/Rome': '罗马',
  'Europe/Madrid': '马德里', 'Europe/Amsterdam': '阿姆斯特丹', 'Europe/Moscow': '莫斯科', 'Europe/Zurich': '苏黎世',
  'Europe/Stockholm': '斯德哥尔摩', 'Europe/Vienna': '维也纳', 'Europe/Warsaw': '华沙', 'Europe/Istanbul': '伊斯坦布尔',
  'Europe/Athens': '雅典', 'Europe/Brussels': '布鲁塞尔', 'Europe/Dublin': '都柏林', 'Europe/Lisbon': '里斯本',
  'Europe/Kyiv': '基辅',
  'America/New_York': '纽约', 'America/Los_Angeles': '洛杉矶', 'America/Chicago': '芝加哥', 'America/Denver': '丹佛',
  'America/Phoenix': '凤凰城', 'Pacific/Honolulu': '夏威夷', 'America/Anchorage': '安克雷奇', 'America/Toronto': '多伦多',
  'America/Vancouver': '温哥华', 'America/Montreal': '蒙特利尔', 'America/Mexico_City': '墨西哥城',
  'America/Sao_Paulo': '圣保罗', 'America/Argentina/Buenos_Aires': '布宜诺斯艾利斯', 'America/Santiago': '圣地亚哥',
  'America/Bogota': '波哥大', 'America/Lima': '利马',
  'Australia/Sydney': '悉尼', 'Australia/Melbourne': '墨尔本', 'Australia/Brisbane': '布里斯班', 'Australia/Perth': '珀斯',
  'Australia/Adelaide': '阿德莱德', 'Pacific/Auckland': '奥克兰', 'Pacific/Fiji': '斐济',
  'Africa/Cairo': '开罗', 'Africa/Johannesburg': '约翰内斯堡', 'Africa/Lagos': '拉各斯', 'Africa/Nairobi': '内罗毕',
  'Africa/Casablanca': '卡萨布兰卡',
};

const EN_OVERRIDES: Record<string, string> = {
  'Asia/Kolkata': 'India',
  'Pacific/Honolulu': 'Hawaii',
};

export function cityName(timeZone: string, lang: 'en' | 'zh'): string {
  if (lang === 'zh' && ZH[timeZone]) return ZH[timeZone];
  if (EN_OVERRIDES[timeZone]) return EN_OVERRIDES[timeZone];
  const last = timeZone.split('/').pop() ?? timeZone;
  return last.replace(/_/g, ' ');
}
