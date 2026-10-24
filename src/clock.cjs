const HOUR = 60 * 60 * 1000;
const DAILY_TARGET = 8 * HOUR;
const DAY_LIMIT = 24 * HOUR;
const EVENT_TYPES = ['clock-in', 'pause', 'resume', 'clock-out', 'adjust', 'recording-started'];

function validTimestamp(value) {
  return Number.isFinite(value) && value >= 0 && Number.isFinite(new Date(value).getTime());
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isFinite(parsed.getTime()) && dayKey(parsed) === value;
}

function requireTimestamp(at) {
  if (!validTimestamp(at)) throw new Error('无效的记录时间');
}

function dayKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function splitInterval(start, end) {
  const totals = {};
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(new Date(start).getTime()) || !Number.isFinite(new Date(end).getTime()) || end <= start) return totals;
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
  if (value.activeSince !== null && !validTimestamp(value.activeSince)) return false;
  if (value.mode !== undefined && (!['idle', 'working', 'paused'].includes(value.mode) || (value.mode === 'working') !== (value.activeSince !== null))) return false;
  if (value.lastCheckpointAt !== undefined && !validTimestamp(value.lastCheckpointAt)) return false;
  if (value.continueAfterExit !== undefined && (typeof value.continueAfterExit !== 'boolean'
    || (value.continueAfterExit && (value.mode !== 'working' || value.activeSince === null)))) return false;
  if (value.events !== undefined && (!Array.isArray(value.events) || !value.events.every((event, index) =>
    event && EVENT_TYPES.includes(event.type) && validTimestamp(event.at) && typeof event.reason === 'string'
    && (index === 0 || event.at >= value.events[index - 1].at)
    && (event.type !== 'recording-started' || ['working', 'paused'].includes(event.mode))
    && (event.type !== 'adjust' || (validDate(event.date) && ['add', 'replace'].includes(event.mode)
      && Number.isFinite(event.before) && event.before >= 0 && Number.isFinite(event.after) && event.after >= 0 && event.after <= DAY_LIMIT))))) return false;
  return Object.entries(value.days).every(([key, ms]) => validDate(key) && Number.isFinite(ms) && ms >= 0);
}

class WorkClock {
  constructor(state = { version: 1, days: {}, activeSince: null }, now = Date.now) {
    if (!validateState(state)) throw new Error('Invalid work clock data');
    this.state = structuredClone(state);
    // Older versions could exceed one day after a manual correction followed
    // by live timing. Keep every date, but normalize its daily total on load.
    for (const key of Object.keys(this.state.days)) this.state.days[key] = Math.min(DAY_LIMIT, this.state.days[key]);
    this.state.mode ??= state.activeSince === null ? 'idle' : 'working';
    if (!this.state.events) {
      this.state.events = [];
      // A checkpoint is all that older files know: never invent the original click.
      if (this.state.activeSince !== null) this.state.events.push({ type: 'recording-started', at: this.state.activeSince, reason: 'legacy', mode: 'working' });
    }
    this.now = now;
  }

  snapshot(at = this.now()) {
    requireTimestamp(at);
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
    this.state.lastCheckpointAt = Math.max(this.state.lastCheckpointAt || 0, at);
    return structuredClone(this.state);
  }

  setActive(active, at = this.now()) {
    return this.setMode(active ? 'working' : 'idle', at);
  }

  setMode(mode, at = this.now(), reason = 'manual') {
    if (!['idle', 'working', 'paused'].includes(mode)) throw new Error('无效的工作状态');
    if (mode === 'paused' && this.state.mode === 'idle') throw new Error('请先签到再暂停');
    requireTimestamp(at);
    if (typeof reason !== 'string') throw new Error('无效的记录原因');
    if (mode === this.state.mode) return this.snapshot(at);
    const previousMode = this.state.mode;
    // Keep the event sequence monotonic after a backwards system clock change.
    at = Math.max(at, this.state.activeSince || 0, this.state.events.at(-1)?.at || 0);
    this.checkpoint(at);
    delete this.state.continueAfterExit;
    this.state.mode = mode;
    this.state.activeSince = mode === 'working' ? at : null;
    this.state.events.push({ type: mode === 'idle' ? 'clock-out' : mode === 'paused' ? 'pause' : previousMode === 'paused' ? 'resume' : 'clock-in', at, reason });
    return this.snapshot(at);
  }

  recoverInterrupted(at = this.now()) {
    if (this.state.mode !== 'working') return false;
    if (this.state.continueAfterExit === true) {
      // Explicit consent applies to this one exit only. Persist the consumed
      // marker at startup before accepting new work, so a later crash is safe.
      this.checkpoint(at);
      delete this.state.continueAfterExit;
      return true;
    }
    // days already contains everything through activeSince. No offline time is added.
    at = this.state.activeSince;
    this.state.mode = 'idle';
    this.state.activeSince = null;
    this.state.events.push({ type: 'clock-out', at: Math.max(at, this.state.events.at(-1)?.at || 0), reason: 'interrupted' });
    return true;
  }

  getDayDetails(date, at = this.now()) {
    if (!validDate(date)) throw new Error('请选择有效的日期');
    requireTimestamp(at);
    const start = new Date(`${date}T00:00:00`).getTime();
    const d = new Date(start);
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    const events = this.state.events.filter(event => event.type === 'adjust' ? event.date === date : event.at >= start && event.at < end);
    const intervals = [];
    let open = null;
    const append = (until, ongoing = false) => {
      if (open && until > open.start && until > start && open.start < end) intervals.push({
        kind: open.kind, start: Math.max(start, open.start), end: Math.min(end, until),
        ongoing: ongoing && at < end, carried: open.start < start, reason: open.reason
      });
    };
    for (const event of this.state.events) {
      if (event.type === 'adjust') continue;
      if (event.at > at) break;
      append(event.at);
      open = ['clock-in', 'resume', 'recording-started'].includes(event.type)
        ? { kind: event.type === 'recording-started' && event.mode === 'paused' ? 'paused' : 'working', start: event.at, reason: event.reason }
        : event.type === 'pause' ? { kind: 'paused', start: event.at, reason: event.reason } : null;
    }
    append(at, true);
    const snapshot = this.snapshot(at);
    const tracked = intervals.filter(interval => interval.kind === 'working').reduce((sum, interval) => sum + interval.end - interval.start, 0);
    return { date, total: snapshot.days[date] || 0, events: structuredClone(events), intervals,
      legacyMilliseconds: Math.max(0, (snapshot.days[date] || 0) - tracked), mode: snapshot.mode };
  }

  adjustDay({ date, milliseconds, mode }, at = this.now()) {
    if (!validDate(date)) throw new Error('请选择有效的日期');
    requireTimestamp(at);
    if (date > dayKey(at)) throw new Error('不能补录未来日期的工时');
    if (!['add', 'replace'].includes(mode)) throw new Error('请选择补充时长或修正总时长');
    if (!Number.isInteger(milliseconds) || milliseconds < 0 || milliseconds > DAY_LIMIT) throw new Error('请输入 0 至 24 小时之间的有效时长');
    const total = mode === 'add' ? (this.snapshot(at).days[date] || 0) + milliseconds : milliseconds;
    if (total > DAY_LIMIT) throw new Error('补录后的当日总工时不能超过 24 小时');
    const before = this.snapshot(at).days[date] || 0;
    this.checkpoint(at);
    if (total === 0) delete this.state.days[date];
    else this.state.days[date] = total;
    this.state.events.push({ type: 'adjust', at: Math.max(at, this.state.events.at(-1)?.at || 0), reason: 'manual', date, mode, before, after: total });
    return this.snapshot(at);
  }
}

module.exports = { WorkClock, dayKey, splitInterval, validateState, HOUR, DAILY_TARGET, DAY_LIMIT };
