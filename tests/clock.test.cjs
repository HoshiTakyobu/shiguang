const test = require('node:test');
const assert = require('node:assert/strict');
const { WorkClock, splitInterval, dayKey, HOUR } = require('../src/clock.cjs');
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
