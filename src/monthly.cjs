const fs = require('node:fs');
const path = require('node:path');
const HOUR = 3600000;
const DEFAULT_MONTHLY_GOALS = Object.freeze({ baseHours: 160, baseAmount: 800, bonusEnabled: true,
  bonuses: Object.freeze([Object.freeze({ id: 'bonus-1', hours: 200, amount: 1600 })]), currency: 'CNY', celebrations: true });
const ERROR = '请检查月度目标：工时须为 1–744 小时，各 Bonus 门槛须依次提高，月收入不能低于前一档，金额须为非负数，最多保留两位小数。';
const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
const decimal = (n, min, max) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max && Math.abs(n * 100 - Math.round(n * 100)) < 1e-7;
function normalizeMonthlyGoals(value) {
  if (value === undefined) value = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !Object.hasOwn(DEFAULT_MONTHLY_GOALS, key) && !['bonusHours', 'bonusAmount'].includes(key))) throw new Error(ERROR);
  const legacy = Object.hasOwn(value, 'bonusHours') || Object.hasOwn(value, 'bonusAmount');
  if (legacy && Object.hasOwn(value, 'bonuses')) throw new Error(ERROR);
  const next = { ...DEFAULT_MONTHLY_GOALS, ...value };
  if (legacy) next.bonuses = [{ id: 'bonus-1', hours: Object.hasOwn(value, 'bonusHours') ? value.bonusHours : 200,
    amount: Object.hasOwn(value, 'bonusAmount') ? value.bonusAmount : 1600 }];
  delete next.bonusHours; delete next.bonusAmount;
  if (!decimal(next.baseHours, 1, 744) || !decimal(next.baseAmount, 0, 99999999)
    || typeof next.bonusEnabled !== 'boolean' || typeof next.celebrations !== 'boolean' || next.currency !== 'CNY'
    || !Array.isArray(next.bonuses)) throw new Error(ERROR);
  let previousHours = next.baseHours, previousAmount = next.baseAmount;
  const ids = new Set(['base']);
  next.bonuses = Array.from(next.bonuses, bonus => {
    if (!bonus || typeof bonus !== 'object' || Array.isArray(bonus)
      || Object.keys(bonus).some(key => !['id', 'hours', 'amount'].includes(key))
      || !validId(bonus.id) || ids.has(bonus.id) || !decimal(bonus.hours, 1, 744) || !decimal(bonus.amount, 0, 99999999)
      || (next.bonusEnabled && (bonus.hours <= previousHours || bonus.amount < previousAmount))) throw new Error(ERROR);
    ids.add(bonus.id); previousHours = bonus.hours; previousAmount = bonus.amount;
    return { id: bonus.id, hours: bonus.hours, amount: bonus.amount };
  });
  return next;
}
function monthSummary(days, at = Date.now(), config) {
  const goals = normalizeMonthlyGoals(config), date = new Date(at);
  if (!Number.isFinite(date.getTime())) throw new Error('无效的记录时间');
  const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  const count = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  let totalMilliseconds = 0;
  for (let day = 1; day <= count; day++) {
    const value = days[`${month}-${String(day).padStart(2, '0')}`];
    if (Number.isFinite(value) && value > 0) totalMilliseconds += Math.min(24 * HOUR, value);
  }
  const totalHours = totalMilliseconds / HOUR;
  const milestones = [{ id: 'base', hours: goals.baseHours, amount: goals.baseAmount }, ...(goals.bonusEnabled ? goals.bonuses : [])]
    .map((milestone, bonusIndex) => ({ ...milestone, bonusIndex, reached: totalMilliseconds >= Math.round(milestone.hours * HOUR) }));
  const reached = milestones.filter(milestone => milestone.reached);
  const achievedMilestone = reached.at(-1) || null;
  const targetMilestone = milestones.find(milestone => !milestone.reached) || milestones.at(-1);
  const targetHours = targetMilestone.hours;
  return { ...goals, month, totalMilliseconds, totalHours, milestones, reachedMilestones: reached.map(milestone => milestone.id),
    baseReached: milestones[0].reached, bonusReached: reached.some(milestone => milestone.bonusIndex > 0),
    allReached: reached.length === milestones.length, tier: achievedMilestone?.id || null,
    achievedMilestone, targetMilestone, targetHours, targetAmount: targetMilestone.amount,
    remainingHours: Math.max(0, targetHours - totalHours), progress: Math.min(1, totalHours / targetHours),
    estimatedAmount: achievedMilestone?.amount ?? null };
}
class MonthlyNoticeStore {
  constructor(directory) {
    this.file = path.join(directory, 'monthly-notices.json'); this.seen = {};
    for (const file of [this.file, `${this.file}.bak`]) {
      try {
        const value = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!value || Array.isArray(value) || typeof value !== 'object') continue;
        const next = {};
        for (const [month, tiers] of Object.entries(value)) {
          const ids = tiers === 'base' ? ['base'] : tiers === 'bonus' ? ['base', 'bonus-1'] : tiers;
          if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !Array.isArray(ids)
            || ids.some(id => !validId(id)) || new Set(ids).size !== ids.length) throw new Error('Invalid monthly notice history');
          next[month] = [...ids];
        }
        this.seen = next; break;
      } catch { /* Notice history never replaces work records. */ }
    }
  }
  pending(summary) {
    if (!summary.celebrations || !summary.tier) return null;
    const previous = new Set(this.seen[summary.month] || []);
    const milestone = summary.milestones.filter(milestone => milestone.reached && !previous.has(milestone.id)).at(-1);
    return milestone ? { ...summary, tier: milestone.id, achievedMilestone: milestone, estimatedAmount: milestone.amount } : null;
  }
  mark(summary) {
    if (!summary.tier) return;
    const next = { ...this.seen, [summary.month]: [...new Set([...(this.seen[summary.month] || []), ...summary.reachedMilestones])] };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(next));
    // Write the last valid in-memory state so a damaged primary cannot replace its backup.
    fs.writeFileSync(`${this.file}.bak`, JSON.stringify(this.seen));
    fs.renameSync(`${this.file}.tmp`, this.file);
    this.seen = next;
  }
}
module.exports = { DEFAULT_MONTHLY_GOALS, normalizeMonthlyGoals, monthSummary, MonthlyNoticeStore };
