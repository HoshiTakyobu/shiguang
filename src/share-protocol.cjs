const HOUR = 3600000;
function number(value, min, max) { return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max; }
function decimal(value, min, max) { return number(value, min, max) && Math.abs(value * 100 - Math.round(value * 100)) < 1e-7; }
function validateSharedState(value) {
  const bad = () => { throw new Error('Invalid shared state'); };
  if (!value || value.version !== 1 || !['idle', 'working', 'paused'].includes(value.mode)
    || !number(value.now, 0, 8640000000000000) || !/^\d{4}-\d{2}-\d{2}$/.test(value.todayKey)
    || value.month !== value.todayKey.slice(0, 7) || !number(value.todayMs, 0, 24 * HOUR)
    || !number(value.monthMs, value.todayMs, 744 * HOUR)
    || !number(value.dayEndsAt, value.now, value.now + 26 * HOUR)
    || !number(value.monthEndsAt, value.dayEndsAt, value.now + 32 * 26 * HOUR)) return bad();
  const g = value.goals;
  if (!g || !decimal(g.baseHours, 1, 744) || !decimal(g.baseAmount, 0, 99999999)
    || typeof g.bonusEnabled !== 'boolean' || g.currency !== 'CNY') return bad();
  // Older desktop clients and persisted cloud snapshots still send one Bonus.
  const source = g.bonuses === undefined ? [{ id: 'bonus-1', hours: g.bonusHours, amount: g.bonusAmount }] : g.bonuses;
  if (!Array.isArray(source)) return bad();
  const ids = new Set(), bonuses = [];
  let previousHours = g.baseHours, previousAmount = g.baseAmount;
  for (const tier of source) {
    if (!tier || typeof tier.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(tier.id) || tier.id === 'base' || ids.has(tier.id)
      || !decimal(tier.hours, 1, 744) || !decimal(tier.amount, 0, 99999999)
      || (g.bonusEnabled && (tier.hours <= previousHours || tier.amount < previousAmount))) return bad();
    ids.add(tier.id); bonuses.push({ id: tier.id, hours: tier.hours, amount: tier.amount });
    previousHours = tier.hours; previousAmount = tier.amount;
  }
  // Explicitly select fields: local paths, history, credentials and IPC metadata never leave the PC.
  return { version: 1, mode: value.mode, now: value.now, todayKey: value.todayKey, todayMs: value.todayMs,
    month: value.month, monthMs: value.monthMs, dayEndsAt: value.dayEndsAt, monthEndsAt: value.monthEndsAt,
    goals: { baseHours: g.baseHours, baseAmount: g.baseAmount, bonusEnabled: g.bonusEnabled, bonuses, currency: 'CNY' } };
}
function sharedState(snapshot) {
  const d = new Date(snapshot.now);
  return validateSharedState({ version: 1, mode: snapshot.mode, now: snapshot.now, todayKey: snapshot.today,
    todayMs: snapshot.days[snapshot.today] || 0, month: snapshot.monthly.month, monthMs: snapshot.monthly.totalMilliseconds,
    dayEndsAt: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(),
    monthEndsAt: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(), goals: snapshot.monthly });
}
module.exports = { sharedState, validateSharedState };
