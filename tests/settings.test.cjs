const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SettingsStore, patchSettings, moveDataDirectory } = require('../src/settings.cjs');
const { WorkClock, HOUR } = require('../src/clock.cjs');
const { FileStore } = require('../src/store.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shiguang-settings-test-'));
  t.after(() => { if (path.resolve(root).startsWith(path.join(os.tmpdir(), 'shiguang-settings-test-'))) fs.rmSync(root, { recursive: true, force: true }); });
  return root;
}

test('first launch enables startup; preferences, target and theme survive restart', t => {
  const root = fixture(t), store = new SettingsStore(root);
  const defaults = store.load();
  assert.equal(defaults.launchAtLogin, true);
  assert.equal(defaults.targetMinutes, 480);
  const next = patchSettings(defaults, { launchAtLogin: false, targetMinutes: 450, theme: 'slate' });
  store.save(next);
  assert.deepEqual(new SettingsStore(root).load(), next);
  assert.throws(() => patchSettings(next, { targetMinutes: 0 }));
  assert.throws(() => patchSettings(next, { targetMinutes: 1441 }));
  assert.throws(() => patchSettings(next, { theme: 'missing' }));
  assert.throws(() => patchSettings(next, { dataDirectory: root }));
});

test('settings corruption recovers the stored data location from backup', t => {
  const root = fixture(t), store = new SettingsStore(root);
  const settings = { ...store.load(), dataDirectory: path.join(root, 'records') };
  store.save(settings); store.save(settings);
  fs.writeFileSync(store.file, 'broken');
  assert.deepEqual(store.load(), settings);
});

test('older settings migrate language/week start without changing stored preferences', t => {
  const root = fixture(t), store = new SettingsStore(root);
  const old = { version: 1, launchAtLogin: false, theme: 'sand', targetMinutes: 420, dataDirectory: root };
  fs.writeFileSync(store.file, JSON.stringify(old));
  const migrated = store.load();
  assert.deepEqual(migrated, { ...old, language: 'zh-CN', weekStart: 1 });
  const updated = patchSettings(migrated, { language: 'en', weekStart: 0 });
  store.save(updated);
  assert.deepEqual(store.load(), updated);
  assert.throws(() => patchSettings(updated, { language: 'bad' }));
  assert.throws(() => patchSettings(updated, { weekStart: 7 }));
  assert.throws(() => patchSettings(updated, { weekStart: 1.5 }));
});

test('moving active work preserves history, ongoing timing, original files, and new location on restart', t => {
  const root = fixture(t), preferences = new SettingsStore(root);
  const settings = preferences.load();
  const source = new FileStore(path.join(root, 'worklog.json'));
  let now = new Date(2026, 9, 19, 9).getTime();
  const clock = new WorkClock(undefined, () => now);
  clock.setActive(true); now += 2 * HOUR;
  const moved = moveDataDirectory(clock, source, preferences, settings, path.join(root, 'moved'));
  assert.equal(source.load().days['2026-10-19'], 2 * HOUR);
  assert.deepEqual(moved.store.load(), source.load());
  now += HOUR;
  assert.equal(new WorkClock(moved.store.load(), () => now).snapshot().days['2026-10-19'], 3 * HOUR);
  assert.equal(new SettingsStore(root).load().dataDirectory, moved.settings.dataDirectory);
  const before = fs.readFileSync(moved.store.file, 'utf8');
  assert.throws(() => moveDataDirectory(clock, source, preferences, settings, moved.settings.dataDirectory), /已有工时/);
  assert.equal(fs.readFileSync(moved.store.file, 'utf8'), before);
});

test('a failed migration does not change the configured location', t => {
  const root = fixture(t), preferences = new SettingsStore(root);
  const settings = preferences.load(); preferences.save(settings);
  const source = new FileStore(path.join(root, 'worklog.json'));
  const destination = path.join(root, 'not-a-folder'); fs.writeFileSync(destination, 'keep');
  assert.throws(() => moveDataDirectory(new WorkClock(), source, preferences, settings, destination));
  assert.equal(preferences.load().dataDirectory, root);
  assert.equal(fs.readFileSync(destination, 'utf8'), 'keep');
});
