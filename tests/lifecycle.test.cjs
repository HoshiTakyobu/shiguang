const test = require('node:test');
const assert = require('node:assert/strict');
const { WorkClock, HOUR } = require('../src/clock.cjs');
const { saveForExit } = require('../src/lifecycle.cjs');
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
