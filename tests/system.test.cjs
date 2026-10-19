const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { acquireInstanceLock } = require('../src/instance-lock.cjs');

test('global instance lease excludes a second copy and recovers after process termination', { skip: process.platform !== 'win32' }, async t => {
  const name = `Global\\Shiguang-tests-${process.pid}`;
  const first = await acquireInstanceLock(name);
  t.after(() => first.process.kill());
  assert.ok(first);
  assert.equal(await acquireInstanceLock(name), null);
  const ended = once(first.process, 'exit'); first.process.kill(); await ended;
  const recovered = await acquireInstanceLock(name);
  assert.ok(recovered);
  const released = once(recovered.process, 'exit'); recovered.release(); await released;
});

test('uninstall data cleanup keeps unrelated custom-folder files and exports and rejects unexpected roots', { skip: process.platform !== 'win32' }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shiguang-cleanup-test-'));
  t.after(() => { const resolved = path.resolve(root); if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('shiguang-cleanup-test-')) fs.rmSync(resolved, { recursive: true, force: true }); });
  const appData = path.join(root, 'AppData'), appRoot = path.join(appData, '拾光'), custom = path.join(root, 'Work notes');
  fs.mkdirSync(path.join(appRoot, 'Cache'), { recursive: true }); fs.mkdirSync(custom);
  fs.writeFileSync(path.join(appRoot, 'settings.json'), JSON.stringify({ version: 1, dataDirectory: custom }));
  fs.writeFileSync(path.join(appRoot, 'worklog.json'), '{}');
  fs.writeFileSync(path.join(appRoot, 'Cache', 'cache'), 'cache');
  for (const file of ['worklog.json', 'worklog.json.bak', 'worklog.json.tmp', 'meeting.md', 'export.json']) fs.writeFileSync(path.join(custom, file), 'keep or remove as specified');
  const script = path.resolve(__dirname, '../build/cleanup-data.ps1');
  const cleanup = target => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-AppDataDirectory', target], { env: { ...process.env, APPDATA: appData }, windowsHide: true, encoding: 'utf8' });
  assert.notEqual(cleanup(custom).status, 0);
  assert.ok(fs.existsSync(path.join(custom, 'meeting.md')));
  const result = cleanup(appRoot); assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(appRoot), false);
  for (const file of ['worklog.json', 'worklog.json.bak', 'worklog.json.tmp']) assert.equal(fs.existsSync(path.join(custom, file)), false);
  for (const file of ['meeting.md', 'export.json']) assert.equal(fs.readFileSync(path.join(custom, file), 'utf8'), 'keep or remove as specified');
});
