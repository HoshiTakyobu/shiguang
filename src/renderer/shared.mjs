export const DAY_LIMIT = 24 * 60 * 60 * 1000;
export function formatAmount(value) { return Number(value).toFixed(2).replace(/(\.\d)0$/, '$1'); }
export function monthlyMilestones(goals, totalMilliseconds) {
  return [{ id: 'base', hours: goals.baseHours, amount: goals.baseAmount, bonusIndex: 0 },
    ...(goals.bonusEnabled ? goals.bonuses.map((bonus, index) => ({ ...bonus, bonusIndex: index + 1 })) : [])]
    .map(milestone => ({ ...milestone, reached: totalMilliseconds >= Math.round(milestone.hours * 3600000) }));
}

export function formatTime(ms) {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(value => String(value).padStart(2, '0')).join(':');
}

export function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function monthWeeks(year, month, weekStart = 1) {
  const first = new Date(year, month, 1, 12);
  const offset = (first.getDay() - weekStart + 7) % 7;
  const count = new Date(year, month + 1, 0).getDate();
  const rows = Math.ceil((offset + count) / 7);
  return Array.from({ length: rows }, (_, row) => Array.from({ length: 7 }, (_, col) => new Date(year, month, 1 - offset + row * 7 + col, 12)));
}

export function ringColor(progress) {
  const p = Math.max(0, Math.min(1, progress));
  const start = [44, 49, 48];
  const end = [117, 212, 151];
  return `rgb(${start.map((value, i) => Math.round(value + (end[i] - value) * p)).join(', ')})`;
}

export function targetLabel(minutes, language = 'zh-CN') {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return language === 'en' ? `${h ? `${h}h` : ''}${h && m ? ' ' : ''}${m ? `${m}min` : ''}` : `${h ? `${h} 小时` : ''}${h && m ? ' ' : ''}${m ? `${m} 分钟` : ''}`;
}
