const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FileStore } = require('../src/store.cjs');

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
  store.save(state);
  assert.deepEqual(JSON.parse(fs.readFileSync(`${store.file}.bak`, 'utf8')), state);
});

test('unreadable records are never silently replaced with an empty history', t => {
  const store = fixture(t);
  fs.writeFileSync(store.file, 'bad-data');
  assert.throws(() => store.load(), /工时记录无法读取/);
  assert.equal(fs.readFileSync(store.file, 'utf8'), 'bad-data');
  assert.throws(() => store.save({ version: 1, days: { bad: -10 }, activeSince: null }));
});
