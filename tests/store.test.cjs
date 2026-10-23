const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FileStore } = require('../src/store.cjs');
const { WorkClock, HOUR } = require('../src/clock.cjs');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shiguang-store-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return new FileStore(path.join(directory, 'worklog.json'));
}
const state = { version: 1, days: { '2026-10-19': 123456 }, activeSince: null };

test('new install is empty; saved records survive a new store instance', t => {
  const store = fixture(t);
  assert.equal(store.load(), undefined);
  store.save(state);
  assert.deepEqual(new FileStore(store.file).load(), state);
});

test('an unavailable custom data folder cannot silently become an empty clock', t => {
  const store = fixture(t);
  assert.throws(() => store.load(true), /未找到已迁移的工时记录/);
  assert.equal(fs.existsSync(store.file), false);
});

test('corrupted main data falls back to the last good backup', t => {
  const store = fixture(t);
  store.save(state);
  store.save({ ...state, activeSince: 1790000000000 });
  fs.writeFileSync(store.file, '{broken');
  assert.deepEqual(store.load(), state);
  assert.equal(store.recovered, true);
  store.save(state);
  assert.deepEqual(JSON.parse(fs.readFileSync(`${store.file}.bak`, 'utf8')), state);
  assert.deepEqual(store.load(), state);
  assert.equal(store.recovered, false);
});

test('unreadable records are never silently replaced with an empty history', t => {
  const store = fixture(t);
  fs.writeFileSync(store.file, 'bad-data');
  assert.throws(() => store.load(), /工时记录无法读取/);
  assert.equal(fs.readFileSync(store.file, 'utf8'), 'bad-data');
  assert.throws(() => store.save({ version: 1, days: { bad: -10 }, activeSince: null }));
});

test('saved event history survives a real file round trip and recovers only through the persisted checkpoint', t => {
  const store = fixture(t);
  const at = new Date(2026, 9, 19, 9).getTime();
  const clock = new WorkClock();
  clock.setMode('working', at + 123);
  clock.setMode('paused', at + HOUR + 234);
  clock.setMode('working', at + 2 * HOUR + 345);
  const saved = clock.checkpoint(at + 3 * HOUR + 456);
  store.save(saved);
  const reopened = new WorkClock(new FileStore(store.file).load(), () => at + 48 * HOUR);
  assert.deepEqual(reopened.state.events, saved.events);
  assert.equal(reopened.recoverInterrupted(), true);
  store.save(reopened.checkpoint());
  const recovered = new FileStore(store.file).load();
  assert.deepEqual(recovered.days, saved.days);
  assert.equal(recovered.activeSince, null);
  assert.equal(recovered.mode, 'idle');
  assert.deepEqual(recovered.events.at(-1), { type: 'clock-out', at: at + 3 * HOUR + 456, reason: 'interrupted' });
  assert.deepEqual(JSON.parse(fs.readFileSync(`${store.file}.bak`, 'utf8')), saved);
});

test('structurally corrupt event history falls back to the valid backup without overwriting it', t => {
  const store = fixture(t);
  const clock = new WorkClock(state);
  clock.setMode('working', new Date(2026, 9, 19, 9).getTime());
  const valid = clock.checkpoint(new Date(2026, 9, 19, 10).getTime());
  store.save(valid);
  store.save(valid);
  const invalid = structuredClone(valid);
  invalid.events.push({ type: 'pause', at: invalid.events[0].at - HOUR, reason: 'manual' });
  fs.writeFileSync(store.file, JSON.stringify(invalid));
  assert.deepEqual(store.load(), valid);
  assert.equal(store.recovered, true);
  store.save(valid);
  assert.deepEqual(JSON.parse(fs.readFileSync(`${store.file}.bak`, 'utf8')), valid);
});

test('a failed disk flush leaves the committed main file and backup readable', t => {
  const store = fixture(t);
  store.save(state);
  const current = { ...state, days: { '2026-10-19': HOUR } };
  store.save(current);
  const flush = t.mock.method(fs, 'fsyncSync', () => { throw new Error('simulated disk full'); });
  assert.throws(() => store.save({ ...state, days: { '2026-10-19': 2 * HOUR } }), /simulated disk full/);
  assert.deepEqual(store.load(), current);
  assert.deepEqual(JSON.parse(fs.readFileSync(`${store.file}.bak`, 'utf8')), state);
  flush.mock.restore();
  store.save(current);
  assert.equal(fs.existsSync(`${store.file}.tmp`), false);
});

test('a failed final rename leaves the previous commit intact and allows a later save', t => {
  const store = fixture(t);
  store.save(state);
  const replacement = { ...state, days: { '2026-10-19': HOUR } };
  const rename = t.mock.method(fs, 'renameSync', () => { throw new Error('simulated locked destination'); });
  assert.throws(() => store.save(replacement), /simulated locked destination/);
  assert.deepEqual(store.load(), state);
  assert.deepEqual(JSON.parse(fs.readFileSync(`${store.file}.bak`, 'utf8')), state);
  rename.mock.restore();
  store.save(replacement);
  assert.deepEqual(store.load(), replacement);
  assert.equal(fs.existsSync(`${store.file}.tmp`), false);
});
