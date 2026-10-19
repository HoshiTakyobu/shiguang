const HOUR = 60 * 60 * 1000;
const DAILY_TARGET = 8 * HOUR;
const DAY_LIMIT = 24 * HOUR;

function dayKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function splitInterval(start, end) {
  const totals = {};
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return totals;
  let cursor = start;
  while (cursor < end) {
    const date = new Date(cursor);
    const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
    const until = Math.min(midnight, end);
    const key = dayKey(cursor);
    totals[key] = (totals[key] || 0) + until - cursor;
    cursor = until;
  }
  return totals;
}

function validateState(value) {
  if (!value || value.version !== 1 || !value.days || typeof value.days !== 'object' || Array.isArray(value.days)) return false;
  if (value.activeSince !== null && (!Number.isFinite(value.activeSince) || value.activeSince < 0)) return false;
  if (value.mode !== undefined && (!['idle', 'working', 'paused'].includes(value.mode) || (value.mode === 'working') !== (value.activeSince !== null))) return false;
  return Object.entries(value.days).every(([key, ms]) => /^\d{4}-\d{2}-\d{2}$/.test(key) && Number.isFinite(ms) && ms >= 0);
}

class WorkClock {
  constructor(state = { version: 1, days: {}, activeSince: null }, now = Date.now) {
    if (!validateState(state)) throw new Error('Invalid work clock data');
    this.state = structuredClone(state);
    // Older versions could exceed one day after a manual correction followed
    // by live timing. Keep every date, but normalize its daily total on load.
    for (const key of Object.keys(this.state.days)) this.state.days[key] = Math.min(DAY_LIMIT, this.state.days[key]);
    this.state.mode ??= state.activeSince === null ? 'idle' : 'working';
    this.now = now;
  }

  snapshot(at = this.now()) {
    const days = { ...this.state.days };
    if (this.state.activeSince !== null) {
      for (const [key, duration] of Object.entries(splitInterval(this.state.activeSince, at))) {
        days[key] = Math.min(DAY_LIMIT, (days[key] || 0) + duration);
      }
    }
    return { active: this.state.activeSince !== null, mode: this.state.mode, days, today: dayKey(at), now: at, target: DAILY_TARGET };
  }

  checkpoint(at = this.now()) {
    const snapshot = this.snapshot(at);
    this.state.days = snapshot.days;
    // A backwards clock adjustment must never create negative or duplicate time.
    if (this.state.activeSince !== null) this.state.activeSince = Math.max(this.state.activeSince, at);
    return structuredClone(this.state);
  }

  setActive(active, at = this.now()) {
    return this.setMode(active ? 'working' : 'idle', at);
  }

  setMode(mode, at = this.now()) {
    if (!['idle', 'working', 'paused'].includes(mode)) throw new Error('无效的工作状态');
    if (mode === 'paused' && this.state.mode === 'idle') throw new Error('请先签到再暂停');
    if (mode === this.state.mode) return this.snapshot(at);
    this.checkpoint(at);
    this.state.mode = mode;
    this.state.activeSince = mode === 'working' ? at : null;
    return this.snapshot(at);
  }

  adjustDay({ date, milliseconds, mode }, at = this.now()) {
    const parsed = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00`) : null;
    if (!parsed || !Number.isFinite(parsed.getTime()) || dayKey(parsed) !== date) throw new Error('请选择有效的日期');
    if (date > dayKey(at)) throw new Error('不能补录未来日期的工时');
    if (!['add', 'replace'].includes(mode)) throw new Error('请选择补充时长或修正总时长');
    if (!Number.isInteger(milliseconds) || milliseconds < 0 || milliseconds > DAY_LIMIT) throw new Error('请输入 0 至 24 小时之间的有效时长');
    const total = mode === 'add' ? (this.snapshot(at).days[date] || 0) + milliseconds : milliseconds;
    if (total > DAY_LIMIT) throw new Error('补录后的当日总工时不能超过 24 小时');
    this.checkpoint(at);
    if (total === 0) delete this.state.days[date];
    else this.state.days[date] = total;
    return this.snapshot(at);
  }
}

module.exports = { WorkClock, dayKey, splitInterval, validateState, HOUR, DAILY_TARGET, DAY_LIMIT };
