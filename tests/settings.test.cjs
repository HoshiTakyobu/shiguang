const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SettingsStore, patchSettings, moveDataDirectory } = require('../src/settings.cjs');
const { DEFAULT_SHORTCUTS } = require('../src/shortcuts.cjs');
const { DEFAULT_MONTHLY_GOALS } = require('../src/monthly.cjs');
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
  assert.deepEqual(defaults.shortcuts, DEFAULT_SHORTCUTS);
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
  assert.deepEqual(migrated, { ...old, language: 'zh-CN', weekStart: 1, shortcuts: DEFAULT_SHORTCUTS, monthlyGoals: DEFAULT_MONTHLY_GOALS });
  const updated = patchSettings(migrated, { language: 'en', weekStart: 0 });
  store.save(updated);
  assert.deepEqual(store.load(), updated);
  assert.throws(() => patchSettings(updated, { language: 'bad' }));
  assert.throws(() => patchSettings(updated, { weekStart: 7 }));
  assert.throws(() => patchSettings(updated, { weekStart: 1.5 }));
});

test('shortcut preferences persist canonical complete maps and partial replacements disable omitted actions', t => {
  const root = fixture(t), store = new SettingsStore(root), defaults = store.load();
  const configured = patchSettings(defaults, { shortcuts: { clockIn: 'alt+Control+i', pause: 'ctrl+P' } });
  assert.deepEqual(configured.shortcuts, { ...DEFAULT_SHORTCUTS, clockIn: 'Ctrl+Alt+I', pause: 'Ctrl+P' });
  assert.deepEqual(defaults.shortcuts, DEFAULT_SHORTCUTS);
  store.save(configured);
  assert.deepEqual(new SettingsStore(root).load(), configured);
  const replaced = patchSettings(configured, { shortcuts: { toggleOrb: 'F10' } });
  assert.deepEqual(replaced.shortcuts, { ...DEFAULT_SHORTCUTS, toggleOrb: 'F10' });
  const themeOnly = patchSettings(configured, { theme: 'slate' });
  assert.deepEqual(themeOnly.shortcuts, configured.shortcuts);
  themeOnly.shortcuts.clockIn = '';
  assert.equal(configured.shortcuts.clockIn, 'Ctrl+Alt+I');
});

test('invalid shortcut patches and saves preserve stored preferences and backups', t => {
  const root = fixture(t), store = new SettingsStore(root);
  const settings = patchSettings(store.load(), { shortcuts: { clockIn: 'Ctrl+I' } });
  store.save(settings); store.save(settings);
  const before = fs.readFileSync(store.file, 'utf8'), backup = fs.readFileSync(`${store.file}.bak`, 'utf8');
  for (const shortcuts of [{ clockIn: 'Ctrl+I', pause: 'control+i' }, { pause: 'Shift+A' }, { pause: 'Win+P' }, { pause: 'Alt+Tab' }, { unexpected: 'Ctrl+I' }, null]) {
    assert.throws(() => patchSettings(settings, { shortcuts }));
    assert.throws(() => store.save({ ...settings, shortcuts }));
  }
  assert.equal(fs.readFileSync(store.file, 'utf8'), before);
  assert.equal(fs.readFileSync(`${store.file}.bak`, 'utf8'), backup);
  assert.deepEqual(store.load(), settings);
});

test('older backups migrate disabled shortcuts and loaded maps do not mutate defaults', t => {
  const root = fixture(t), store = new SettingsStore(root);
  const old = { version: 1, launchAtLogin: true, theme: 'sand', targetMinutes: 420, dataDirectory: root, language: 'en', weekStart: 0 };
  fs.writeFileSync(store.file, 'broken');
  fs.writeFileSync(`${store.file}.bak`, JSON.stringify(old));
  const recovered = store.load();
  assert.deepEqual(recovered, { ...old, shortcuts: DEFAULT_SHORTCUTS, monthlyGoals: DEFAULT_MONTHLY_GOALS });
  recovered.shortcuts.clockIn = 'Ctrl+I';
  assert.equal(store.defaults.shortcuts.clockIn, '');
  assert.equal(store.load().shortcuts.clockIn, '');
  store.save(recovered);
  assert.deepEqual(store.load(), recovered);
  const fresh = new SettingsStore(path.join(root, 'fresh'));
  fresh.load().shortcuts.clockIn = 'Ctrl+I';
  assert.equal(fresh.load().shortcuts.clockIn, '');
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
