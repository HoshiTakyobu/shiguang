const test = require('node:test');
const assert = require('node:assert/strict');
const { WorkClock, splitInterval, dayKey, validateState, HOUR } = require('../src/clock.cjs');
const local = (day, hours = 0, minutes = 0, seconds = 0) => new Date(2026, 9, day, hours, minutes, seconds).getTime();

test('pauses exclude break time across midnight and restart, then resume without losing work', () => {
  const clock = new WorkClock();
  clock.setMode('working', local(19, 22));
  clock.setMode('paused', local(19, 23));
  const saved = clock.checkpoint(local(20, 8));
  assert.equal(saved.mode, 'paused');
  assert.equal(saved.activeSince, null);
  const resumed = new WorkClock(saved);
  assert.equal(resumed.snapshot(local(20, 9)).days['2026-10-20'], undefined);
  resumed.adjustDay({ date: '2026-10-19', mode: 'add', milliseconds: HOUR }, local(20, 9));
  assert.equal(resumed.snapshot().mode, 'paused');
  resumed.setMode('working', local(20, 9));
  resumed.setMode('idle', local(20, 11));
  assert.deepEqual(resumed.snapshot(local(20, 12)).days, { '2026-10-19': 2 * HOUR, '2026-10-20': 2 * HOUR });
  assert.throws(() => resumed.setMode('paused'));
  assert.throws(() => resumed.setMode('other'));
});

test('all seven week starts cover each month day once and keep actual weekends', async () => {
  const { monthWeeks } = await import('../src/renderer/shared.mjs');
  for (let start = 0; start < 7; start++) {
    const weeks = monthWeeks(2028, 1, start);
    assert.ok(weeks.every(week => week.length === 7 && week[0].getDay() === start));
    const dates = weeks.flat().filter(date => date.getMonth() === 1).map(dayKey);
    assert.equal(dates.length, 29); assert.equal(new Set(dates).size, 29);
  }
});

test('clocking out directly from a break never counts the break or resumes the timer', () => {
  const clock = new WorkClock();
  clock.setMode('working', local(19, 9));
  clock.setMode('paused', local(19, 12));
  const saved = clock.checkpoint(local(20, 1));
  const reopened = new WorkClock(saved);
  reopened.setMode('idle', local(20, 8));
  assert.equal(reopened.snapshot(local(20, 10)).mode, 'idle');
  assert.deepEqual(reopened.snapshot(local(20, 10)).days, { '2026-10-19': 3 * HOUR });
});

test('live timing after a correction caps the date at 24 hours, then counts the next date', () => {
  const clock = new WorkClock();
  clock.setMode('working', local(19, 9));
  clock.adjustDay({ date: '2026-10-19', mode: 'replace', milliseconds: 24 * HOUR - 1000 }, local(19, 10));
  assert.equal(clock.snapshot(local(19, 10, 0, 1)).days['2026-10-19'], 24 * HOUR);
  const saved = clock.checkpoint(local(19, 18));
  assert.equal(saved.days['2026-10-19'], 24 * HOUR);
  const restarted = new WorkClock(saved);
  assert.deepEqual(restarted.snapshot(local(20, 1)).days, { '2026-10-19': 24 * HOUR, '2026-10-20': HOUR });
  assert.equal(restarted.snapshot(local(20, 1)).mode, 'working');
  restarted.setMode('paused', local(20, 1));
  restarted.setMode('working', local(20, 2));
  assert.equal(restarted.snapshot(local(20, 3)).days['2026-10-20'], 2 * HOUR);
});

test('legacy daily overflows normalize without rejecting history or capping weekly/monthly sums', async () => {
  const original = { version: 1, days: { '2026-10-18': 30 * HOUR, '2026-10-19': 24 * HOUR }, activeSince: null };
  const clock = new WorkClock(original);
  assert.equal(original.days['2026-10-18'], 30 * HOUR);
  assert.deepEqual(clock.snapshot(local(19, 12)).days, { '2026-10-18': 24 * HOUR, '2026-10-19': 24 * HOUR });
  const { formatTime } = await import('../src/renderer/shared.mjs');
  assert.equal(formatTime(Object.values(clock.snapshot(local(19, 12)).days).reduce((a, b) => a + b, 0)), '48:00:00');
  assert.throws(() => clock.adjustDay({ date: '2026-10-19', mode: 'add', milliseconds: 1 }, local(19, 12)), /24/);
});

test('signup, signout, and repeated sessions accumulate without counting breaks', () => {
  let now = local(19, 9);
  const clock = new WorkClock(undefined, () => now);
  clock.setActive(true);
  now += 3 * HOUR;
  clock.setActive(false);
  now += HOUR;
  assert.equal(clock.snapshot().days['2026-10-19'], 3 * HOUR);
  clock.setActive(true);
  now += 5 * HOUR;
  clock.setActive(false);
  assert.equal(clock.snapshot().days['2026-10-19'], 8 * HOUR);
  assert.equal(clock.snapshot().active, false);
});

test('midnight divides work into the correct local dates, including exact midnight', () => {
  assert.deepEqual(splitInterval(local(19, 23, 30), local(20, 1, 15)), { '2026-10-19': HOUR / 2, '2026-10-20': 1.25 * HOUR });
  assert.deepEqual(splitInterval(local(19, 23), local(20)), { '2026-10-19': HOUR });
  const clock = new WorkClock({ version: 1, days: {}, activeSince: local(19, 23) });
  assert.equal(clock.snapshot(local(20)).today, '2026-10-20');
  assert.equal(clock.snapshot(local(20)).days['2026-10-20'] || 0, 0);
});

test('checkpoint and restoring an active clock neither lose nor duplicate time', () => {
  const clock = new WorkClock();
  clock.setActive(true, local(19, 9));
  const saved = clock.checkpoint(local(19, 12));
  const restarted = new WorkClock(saved);
  restarted.checkpoint(local(19, 13));
  restarted.checkpoint(local(19, 13));
  assert.equal(restarted.snapshot(local(19, 17)).days['2026-10-19'], 8 * HOUR);
});

test('work over 8 hours remains recorded and duplicate sign-in is idempotent', () => {
  const clock = new WorkClock();
  clock.setActive(true, local(19, 8));
  clock.setActive(true, local(19, 9));
  clock.setActive(false, local(19, 20));
  clock.setActive(false, local(19, 21));
  assert.equal(clock.snapshot(local(19, 22)).days['2026-10-19'], 12 * HOUR);
});

test('an extended overnight session splits each calendar day', () => {
  assert.deepEqual(splitInterval(local(19, 23), local(22, 1)), { '2026-10-19': HOUR, '2026-10-20': 24 * HOUR, '2026-10-21': 24 * HOUR, '2026-10-22': HOUR });
});

test('a clock moved backward never produces negative or duplicate work', () => {
  const clock = new WorkClock();
  clock.setActive(true, local(19, 9));
  clock.checkpoint(local(19, 10));
  clock.checkpoint(local(19, 9, 30));
  assert.equal(clock.snapshot(local(19, 11)).days['2026-10-19'], 2 * HOUR);
});

test('calendar weeks begin on Monday and include month boundaries', async () => {
  const { monthWeeks } = await import('../src/renderer/shared.mjs');
  const weeks = monthWeeks(2026, 9);
  assert.equal(weeks.length, 5);
  assert.equal(dayKey(weeks[0][0]), '2026-09-28');
  assert.equal(dayKey(weeks[4][6]), '2026-11-01');
  assert.ok(weeks.every(week => week[0].getDay() === 1 && week[6].getDay() === 0));
  assert.equal(monthWeeks(2026, 2).length, 6);
  assert.equal(monthWeeks(2027, 1).length, 4);
  assert.ok(monthWeeks(2028, 1).flat().some(date => dayKey(date) === '2028-02-29'));
});

test('formatting retains seconds and hours above 24; ring is capped at fresh green', async () => {
  const { formatTime, ringColor } = await import('../src/renderer/shared.mjs');
  assert.equal(formatTime(9 * HOUR + 5 * 60000 + 8000), '09:05:08');
  assert.equal(formatTime(50 * HOUR), '50:00:00');
  assert.equal(ringColor(0), 'rgb(44, 49, 48)');
  assert.equal(ringColor(1.5), 'rgb(117, 212, 151)');
});

test('supplementing a day adds work without losing the active interval', () => {
  const clock = new WorkClock({ version: 1, days: { '2026-10-18': HOUR }, activeSince: local(19, 9) });
  clock.adjustDay({ date: '2026-10-18', mode: 'add', milliseconds: 2 * HOUR }, local(19, 10));
  assert.equal(clock.snapshot(local(19, 11)).days['2026-10-18'], 3 * HOUR);
  assert.equal(clock.snapshot(local(19, 11)).days['2026-10-19'], 2 * HOUR);
  clock.adjustDay({ date: '2026-10-19', mode: 'add', milliseconds: HOUR }, local(19, 11));
  assert.equal(clock.snapshot(local(19, 12)).days['2026-10-19'], 4 * HOUR);
});

test('correcting today sets the exact total at save time and the timer continues from there', () => {
  const clock = new WorkClock({ version: 1, days: {}, activeSince: local(19, 9) });
  clock.adjustDay({ date: '2026-10-19', mode: 'replace', milliseconds: 5 * HOUR }, local(19, 10));
  assert.equal(clock.snapshot(local(19, 11)).days['2026-10-19'], 6 * HOUR);
  assert.equal(clock.snapshot(local(19, 11)).active, true);
  clock.adjustDay({ date: '2026-10-18', mode: 'replace', milliseconds: 0 }, local(19, 11));
  assert.equal(clock.snapshot(local(19, 11)).days['2026-10-18'], undefined);
});

test('corrections reject invalid dates, future dates, negative time and more than one day', () => {
  const clock = new WorkClock({ version: 1, days: { '2026-10-19': 20 * HOUR }, activeSince: null });
  const before = structuredClone(clock.state);
  for (const value of [
    { date: '2026-02-30', mode: 'add', milliseconds: HOUR },
    { date: '2026-10-20', mode: 'add', milliseconds: HOUR },
    { date: '2026-10-19', mode: 'add', milliseconds: -1 },
    { date: '2026-10-19', mode: 'replace', milliseconds: 25 * HOUR },
    { date: '2026-10-19', mode: 'add', milliseconds: 5 * HOUR }
  ]) assert.throws(() => clock.adjustDay(value, local(19, 12)));
  assert.deepEqual(clock.state, before);
});

test('checkpoints and reloads preserve the exact sign-in, break, resume and sign-out timestamps', () => {
  const times = [local(19, 9, 3, 7) + 123, local(19, 12, 1, 8) + 234, local(19, 13, 2, 9) + 345, local(19, 17, 4, 10) + 456];
  const clock = new WorkClock();
  clock.setMode('working', times[0]);
  clock.checkpoint(local(19, 10));
  clock.setMode('working', local(19, 11));
  clock.setMode('paused', times[1]);
  const reopened = new WorkClock(clock.checkpoint(local(19, 12, 30)));
  reopened.setMode('working', times[2]);
  reopened.checkpoint(local(19, 16));
  reopened.setMode('idle', times[3]);
  const detail = reopened.getDayDetails('2026-10-19', local(19, 18));
  assert.deepEqual(detail.events.map(({ type, at }) => [type, at]), ['clock-in', 'pause', 'resume', 'clock-out'].map((type, i) => [type, times[i]]));
  assert.deepEqual(detail.intervals.map(({ kind, start, end }) => [kind, start, end]), [
    ['working', times[0], times[1]], ['paused', times[1], times[2]], ['working', times[2], times[3]]
  ]);
  assert.equal(detail.total, times[1] - times[0] + times[3] - times[2]);
  assert.equal(detail.legacyMilliseconds, 0);
  detail.events[0].at = 0;
  assert.equal(reopened.state.events[0].at, times[0]);
});

test('daily details clip work and breaks at midnight while preserving the actual event dates', () => {
  const clock = new WorkClock();
  clock.setMode('working', local(19, 22));
  clock.setMode('paused', local(19, 23));
  clock.setMode('working', local(20, 1));
  const before = clock.getDayDetails('2026-10-19', local(20, 2));
  const today = clock.getDayDetails('2026-10-20', local(20, 2));
  assert.deepEqual(before.events.map(event => event.type), ['clock-in', 'pause']);
  assert.deepEqual(before.intervals.map(({ kind, start, end, carried, ongoing }) => [kind, start, end, carried, ongoing]), [
    ['working', local(19, 22), local(19, 23), false, false],
    ['paused', local(19, 23), local(20), false, false]
  ]);
  assert.deepEqual(today.events.map(event => event.type), ['resume']);
  assert.deepEqual(today.intervals.map(({ kind, start, end, carried, ongoing }) => [kind, start, end, carried, ongoing]), [
    ['paused', local(20), local(20, 1), true, false],
    ['working', local(20, 1), local(20, 2), false, true]
  ]);
  assert.equal(before.total, HOUR);
  assert.equal(today.total, HOUR);
  clock.setMode('idle', local(20, 2));
  assert.equal(clock.getDayDetails('2026-10-20', local(20, 3)).intervals.at(-1).ongoing, false);
});

test('an interrupted session ends at its last saved checkpoint and never adds offline time', () => {
  const clock = new WorkClock();
  clock.setMode('working', local(19, 23));
  const savedAt = local(20, 0, 15, 2) + 789;
  const saved = clock.checkpoint(savedAt);
  const reopened = new WorkClock(saved, () => local(22, 12));
  assert.equal(reopened.recoverInterrupted(), true);
  assert.equal(reopened.snapshot().mode, 'idle');
  assert.deepEqual(reopened.snapshot().days, saved.days);
  assert.deepEqual(reopened.state.events.at(-1), { type: 'clock-out', at: savedAt, reason: 'interrupted' });
  assert.equal(reopened.getDayDetails('2026-10-20').intervals[0].end, savedAt);
  assert.equal(reopened.getDayDetails('2026-10-20').intervals[0].ongoing, false);
  assert.equal(reopened.recoverInterrupted(), false);
  assert.equal(reopened.state.events.length, 2);
  const restoredAgain = new WorkClock(reopened.checkpoint());
  assert.equal(restoredAgain.recoverInterrupted(), false);
  assert.deepEqual(restoredAgain.snapshot(local(23)).days, saved.days);
});

test('legacy active and paused records keep their totals without inventing old clock-in events', () => {
  const active = new WorkClock({ version: 1, days: { '2026-10-19': 3 * HOUR }, activeSince: local(19, 12) });
  const detail = active.getDayDetails('2026-10-19', local(19, 13));
  assert.deepEqual(detail.events, [{ type: 'recording-started', at: local(19, 12), reason: 'legacy', mode: 'working' }]);
  assert.equal(detail.total, 4 * HOUR);
  assert.equal(detail.legacyMilliseconds, 3 * HOUR);
  assert.equal(detail.intervals[0].start, local(19, 12));
  const paused = new WorkClock({ version: 1, days: { '2026-10-19': 3 * HOUR }, activeSince: null, mode: 'paused' });
  assert.equal(paused.recoverInterrupted(), false);
  assert.deepEqual(paused.getDayDetails('2026-10-19', local(19, 13)).events, []);
  paused.setMode('working', local(19, 13));
  assert.deepEqual(paused.state.events, [{ type: 'resume', at: local(19, 13), reason: 'manual' }]);
  assert.equal(paused.getDayDetails('2026-10-19', local(19, 14)).legacyMilliseconds, 3 * HOUR);
});

test('manual changes retain their before and after totals on the corrected date without splitting work intervals', () => {
  const clock = new WorkClock();
  clock.setMode('working', local(19, 9));
  clock.adjustDay({ date: '2026-10-19', mode: 'add', milliseconds: HOUR }, local(19, 10));
  clock.setMode('idle', local(19, 11));
  clock.adjustDay({ date: '2026-10-19', mode: 'replace', milliseconds: HOUR / 2 }, local(20, 8));
  const detail = clock.getDayDetails('2026-10-19', local(20, 9));
  assert.deepEqual(detail.events.filter(event => event.type === 'adjust'), [
    { type: 'adjust', at: local(19, 10), reason: 'manual', date: '2026-10-19', mode: 'add', before: HOUR, after: 2 * HOUR },
    { type: 'adjust', at: local(20, 8), reason: 'manual', date: '2026-10-19', mode: 'replace', before: 3 * HOUR, after: HOUR / 2 }
  ]);
  assert.equal(detail.intervals.length, 1);
  assert.equal(detail.intervals[0].end - detail.intervals[0].start, 2 * HOUR);
  assert.equal(detail.total, HOUR / 2);
  assert.deepEqual(clock.getDayDetails('2026-10-20', local(20, 9)).events, []);
});

test('clock changes keep event history ordered and count each working interval once', () => {
  const clock = new WorkClock();
  clock.setMode('working', local(19, 9));
  clock.checkpoint(local(19, 10));
  clock.setMode('paused', local(19, 9, 30));
  clock.setMode('working', local(19, 9, 45));
  clock.setMode('idle', local(19, 11));
  const detail = clock.getDayDetails('2026-10-19', local(19, 12));
  assert.deepEqual(detail.events.map(event => event.at), [local(19, 9), local(19, 10), local(19, 10), local(19, 11)]);
  assert.equal(detail.total, 2 * HOUR);
  assert.equal(detail.intervals.reduce((sum, interval) => sum + interval.end - interval.start, 0), 2 * HOUR);
  assert.equal(validateState(clock.state), true);
});

test('invalid timestamps and malformed histories cannot corrupt the current clock', () => {
  const clock = new WorkClock();
  clock.setMode('working', local(19, 9));
  const before = structuredClone(clock.state);
  for (const at of [NaN, Infinity, -1, 1e20]) {
    assert.throws(() => clock.checkpoint(at), /记录时间/);
    assert.throws(() => clock.setMode('idle', at), /记录时间/);
    assert.throws(() => clock.adjustDay({ date: '2026-10-19', mode: 'replace', milliseconds: HOUR }, at), /记录时间/);
  }
  assert.throws(() => clock.setMode('idle', local(19, 10), null), /记录原因/);
  assert.deepEqual(clock.state, before);
  const invalidStates = [
    { ...before, activeSince: 1e20 },
    { ...before, days: { '2026-02-30': HOUR } },
    { ...before, events: [{ type: 'unknown', at: local(19, 9), reason: 'manual' }] },
    { ...before, events: [{ type: 'clock-in', at: local(19, 9), reason: 'manual' }, { type: 'pause', at: local(19, 8), reason: 'manual' }] },
    { ...before, events: [{ type: 'adjust', at: local(19, 9), reason: 'manual', date: '2026-02-30', mode: 'add', before: 0, after: HOUR }] }
  ];
  for (const value of invalidStates) assert.equal(validateState(value), false);
});
