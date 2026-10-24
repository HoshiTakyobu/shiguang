const test = require('node:test');
const assert = require('node:assert/strict');
const { WorkClock, HOUR, validateState } = require('../src/clock.cjs');
const { saveForExit, restoreAfterExit } = require('../src/lifecycle.cjs');
const at = hour => new Date(2026, 9, 23, hour).getTime();

for (const mode of ['working', 'paused']) {
  test(`shutdown saves ${mode} clock as idle before publishing it`, () => {
    const clock = new WorkClock();
    clock.setMode('working', at(9));
    if (mode === 'paused') clock.setMode('paused', at(10));
    const original = structuredClone(clock.state);
    let saved;
    const ended = saveForExit(clock, { save(state) { saved = state; } }, { shutdown: true, at: at(12) });
    assert.deepEqual(clock.state, original);
    assert.deepEqual(ended.state, saved);
    assert.equal(saved.mode, 'idle');
    assert.equal(saved.activeSince, null);
    assert.equal(saved.days['2026-10-23'], (mode === 'paused' ? 1 : 3) * HOUR);
    assert.deepEqual(saved.events.at(-1), { type: 'clock-out', at: at(12), reason: 'shutdown' });
    const reopened = new WorkClock(saved);
    assert.equal(reopened.recoverInterrupted(), false);
    assert.equal(reopened.snapshot(at(18)).days['2026-10-23'], saved.days['2026-10-23']);
    assert.ok(reopened.getDayDetails('2026-10-23', at(18)).intervals.every(interval => !interval.ongoing));
  });
}

test('a failed quit save leaves live time and history unchanged for retry', () => {
  const clock = new WorkClock();
  clock.setMode('working', at(9));
  const original = structuredClone(clock.state);
  assert.throws(() => saveForExit(clock, { save() { throw new Error('disk full'); } }, { at: at(10) }), /disk full/);
  assert.deepEqual(clock.state, original);
  const ended = saveForExit(clock, { save() {} }, { at: at(11) });
  assert.equal(ended.state.days['2026-10-23'], 2 * HOUR);
  assert.deepEqual(ended.state.events.map(event => event.type), ['clock-in', 'clock-out']);
  assert.equal(ended.state.events.at(-1).reason, 'quit');
});

test('repeated shutdown saves do not add duplicate clock-outs', () => {
  const clock = new WorkClock();
  clock.setMode('working', at(9));
  const store = { save() {} };
  const once = saveForExit(clock, store, { shutdown: true, at: at(10) });
  const twice = saveForExit(once, store, { shutdown: true, at: at(11) });
  assert.deepEqual(twice.state.events, once.state.events);
  assert.deepEqual(twice.state.days, once.state.days);
});

test('normal exit preserves an intentional pause without counting any break time', () => {
  const clock = new WorkClock();
  clock.setMode('working', at(9));
  clock.setMode('paused', at(10));
  const ended = saveForExit(clock, { save() {} }, { at: at(11) });
  assert.equal(ended.state.mode, 'paused');
  assert.deepEqual(ended.state.events, clock.state.events);
  assert.equal(ended.snapshot(at(18)).days['2026-10-23'], HOUR);
});

test('explicitly continuing after exit counts the gap once, splits midnight, and preserves the session', () => {
  const clock = new WorkClock();
  clock.setMode('working', at(22));
  let saved;
  const store = { save(state) { saved = state; } };
  const exited = saveForExit(clock, store, { continueTiming: true, at: at(23) });
  assert.equal(saved.continueAfterExit, true);
  assert.equal(saved.mode, 'working');
  assert.equal(saved.days['2026-10-23'], HOUR);
  assert.equal(clock.state.continueAfterExit, undefined);
  const reopened = restoreAfterExit(exited, store, { at: at(26) });
  assert.deepEqual(saved.days, { '2026-10-23': 2 * HOUR, '2026-10-24': 2 * HOUR });
  assert.equal(saved.continueAfterExit, undefined);
  assert.equal(saved.mode, 'working');
  assert.deepEqual(saved.events.map(event => event.type), ['clock-in']);
  reopened.checkpoint(at(27));
  assert.equal(reopened.state.days['2026-10-24'], 3 * HOUR);
  assert.deepEqual(reopened.getDayDetails('2026-10-24', at(27)).intervals.map(i => [i.start, i.end, i.ongoing]), [[at(24), at(27), true]]);
  const afterCrash = restoreAfterExit(reopened, store, { at: at(30) });
  assert.equal(afterCrash.state.mode, 'idle');
  assert.equal(afterCrash.state.days['2026-10-24'], 3 * HOUR, 'A later crash does not reuse the old exit choice');
  assert.equal(afterCrash.state.events.at(-1).reason, 'interrupted');
});

test('continuing from a pause starts at exit and excludes the preceding break', () => {
  const clock = new WorkClock();
  clock.setMode('working', at(9));
  clock.setMode('paused', at(10));
  const store = { save() {} };
  const exited = saveForExit(clock, store, { continueTiming: true, at: at(12) });
  assert.deepEqual(exited.state.events.at(-1), { type: 'resume', at: at(12), reason: 'quit-continue' });
  const reopened = restoreAfterExit(exited, store, { at: at(14) });
  assert.equal(reopened.state.days['2026-10-23'], 3 * HOUR);
});

test('continuation over several closed days preserves each date and the complete session history', () => {
  const clock = new WorkClock();
  clock.setMode('working', at(22));
  const store = { save() {} };
  const exited = saveForExit(clock, store, { continueTiming: true, at: at(23) });
  const reopened = restoreAfterExit(exited, store, { at: at(74) });
  assert.deepEqual(reopened.state.days, {
    '2026-10-23': 2 * HOUR,
    '2026-10-24': 24 * HOUR,
    '2026-10-25': 24 * HOUR,
    '2026-10-26': 2 * HOUR
  });
  assert.deepEqual(reopened.state.events, clock.state.events);
  const middleDay = reopened.getDayDetails('2026-10-24', at(74));
  assert.equal(middleDay.total, 24 * HOUR);
  assert.deepEqual(middleDay.intervals.map(({ start, end, carried, ongoing }) => [start, end, carried, ongoing]), [
    [at(24), at(48), true, false]
  ]);
  assert.equal(reopened.snapshot(at(75)).days['2026-10-26'], 3 * HOUR);
});

test('a backward clock at restart consumes continuation without duplicating the saved hours', () => {
  const clock = new WorkClock();
  clock.setMode('working', at(9));
  const store = { save() {} };
  const exited = saveForExit(clock, store, { continueTiming: true, at: at(12) });
  const reopened = restoreAfterExit(exited, store, { at: at(10) });
  assert.equal(reopened.state.continueAfterExit, undefined);
  assert.equal(reopened.state.activeSince, at(12));
  assert.equal(reopened.snapshot(at(11)).days['2026-10-23'], 3 * HOUR);
  reopened.checkpoint(at(11));
  assert.equal(reopened.snapshot(at(13)).days['2026-10-23'], 4 * HOUR);
  const stopped = saveForExit(reopened, store, { at: at(13) });
  const restored = restoreAfterExit(stopped, store, { at: at(18) });
  assert.equal(restored.state.days['2026-10-23'], 4 * HOUR);
  assert.equal(restored.state.mode, 'idle');
  assert.deepEqual(restored.state.events.map(event => event.at), [at(9), at(13)]);
  assert.equal(validateState(restored.state), true);
});

test('failed continuation saves and failed startup consumption leave the original intact', () => {
  const clock = new WorkClock();
  clock.setMode('working', at(9));
  const original = structuredClone(clock.state);
  const fail = { save() { throw new Error('disk full'); } };
  assert.throws(() => saveForExit(clock, fail, { continueTiming: true, at: at(10) }), /disk full/);
  assert.deepEqual(clock.state, original);
  const exited = saveForExit(clock, { save() {} }, { continueTiming: true, at: at(10) });
  const before = structuredClone(exited.state);
  assert.throws(() => restoreAfterExit(exited, fail, { at: at(12) }), /disk full/);
  assert.deepEqual(exited.state, before);
  const retried = restoreAfterExit(exited, { save() {} }, { at: at(13) });
  assert.equal(retried.state.days['2026-10-23'], 4 * HOUR);
});

test('shutdown and a later stop choice clear an outstanding continuation', () => {
  for (const options of [{ shutdown: true, continueTiming: true }, {}]) {
    const clock = new WorkClock();
    clock.setMode('working', at(9));
    const store = { save() {} };
    const exited = saveForExit(clock, store, { continueTiming: true, at: at(10) });
    const stopped = saveForExit(exited, store, { ...options, at: at(11) });
    assert.equal(stopped.state.continueAfterExit, undefined);
    assert.equal(restoreAfterExit(stopped, store, { at: at(16) }).state.days['2026-10-23'], 2 * HOUR);
  }
});

test('backup recovery does not replay a potentially consumed exit choice', () => {
  const clock = new WorkClock();
  clock.setMode('working', at(9));
  const exited = saveForExit(clock, { save() {} }, { continueTiming: true, at: at(10) });
  const recovered = restoreAfterExit(exited, { recovered: true, save() {} }, { at: at(14) });
  assert.equal(recovered.state.mode, 'idle');
  assert.equal(recovered.state.days['2026-10-23'], HOUR);
  assert.equal(recovered.state.continueAfterExit, undefined);
});

test('exit consent validates strictly and never signs in an idle user', () => {
  const idle = new WorkClock();
  assert.equal(validateState({ ...idle.state, continueAfterExit: true }), false);
  assert.equal(validateState({ ...idle.state, continueAfterExit: 'true' }), false);
  assert.equal(saveForExit(idle, { save() {} }, { continueTiming: true, at: at(10) }).state.mode, 'idle');
});
