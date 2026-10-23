const { _electron: electron, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');

if (process.platform !== 'win32') { console.log('SKIP: native Windows shortcut test.'); process.exit(0); }
const root = path.resolve(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiguang-shortcut-test-'));
const helper = path.join(__dirname, 'fixtures/shortcut-native.ps1');
const bindings = { clockIn: 'Ctrl+Alt+Shift+F7', pause: 'Ctrl+Alt+Shift+F8', resume: 'Ctrl+Alt+Shift+F9', clockOut: 'Ctrl+Alt+Shift+F10', toggleOrb: 'Ctrl+Alt+Shift+F11' };
let app, blocker;

async function launch() {
  const env = { ...process.env, SHIGUANG_TEST: '1', SHIGUANG_DATA_DIR: dataDir };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ ...(process.env.SHIGUANG_EXECUTABLE ? { executablePath: process.env.SHIGUANG_EXECUTABLE } : { args: [root] }), env });
  const orb = await app.firstWindow();
  await expect(orb.locator('#status')).toHaveText('下班啦');
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), dataDir);
  const opened = app.waitForEvent('window');
  await orb.evaluate(() => window.shiguang.openSettings('shortcuts'));
  const settings = await opened;
  await settings.waitForLoadState('domcontentloaded');
  return { orb, settings };
}

async function press(action) {
  const key = Number(bindings[action].match(/F(\d+)$/)[1]) + 111;
  const status = await app.evaluate(({ globalShortcut }, accelerator) => globalShortcut.isRegistered(accelerator), bindings[action]);
  assert.equal(status, true, 'Never send an unregistered test key');
  const mainPid = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('settings.html'));
    win.show(); win.focus();
    return process.pid;
  });
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.webContents.getURL().includes('settings.html') || false)).toBe(true);
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper,
    '-Action', 'press', '-VirtualKey', String(key), '-ExpectedProcessId', String(mainPid)], { windowsHide: true, timeout: 10000, stdio: 'pipe' });
}

(async () => {
  try {
    let { orb, settings } = await launch();
    const saved = await settings.evaluate(shortcuts => window.shiguang.saveSettings({ shortcuts }), bindings);
    assert.equal(saved.ok, true, JSON.stringify(saved));
    assert.ok(Object.values(saved.value.shortcutStatus).every(status => status.registered && !status.error));
    await press('clockIn'); await expect(orb.locator('#status')).toHaveText('上班中');
    await press('pause'); await expect(orb.locator('#status')).toHaveText('已暂停');
    const paused = await orb.evaluate(() => window.shiguang.getState());
    await press('clockIn'); // Each action is explicit: clock-in cannot resume a break.
    assert.equal((await orb.evaluate(() => window.shiguang.getState())).mode, 'paused');
    assert.equal((await orb.evaluate(() => window.shiguang.getState())).days[paused.today], paused.days[paused.today]);
    await press('resume'); await expect(orb.locator('#status')).toHaveText('上班中');
    await press('clockOut'); await expect(orb.locator('#status')).toHaveText('下班啦');
    const visible = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/orb.html')).isVisible());
    await press('toggleOrb'); await expect.poll(visible).toBe(false);
    await press('toggleOrb'); await expect.poll(visible).toBe(true);
    const worklog = JSON.parse(fs.readFileSync(path.join(dataDir, 'worklog.json'), 'utf8'));
    assert.deepEqual(worklog.events.map(event => event.type), ['clock-in', 'pause', 'resume', 'clock-out']);
    assert.ok(worklog.events.every(event => event.reason === 'shortcut'));

    const capture = await settings.evaluate(() => window.shiguang.captureShortcuts(true));
    assert.equal(capture.ok, true);
    assert.equal(await app.evaluate(({ globalShortcut }, key) => globalShortcut.isRegistered(key), bindings.clockIn), false);
    await settings.evaluate(() => window.shiguang.captureShortcuts(false));
    assert.equal(await app.evaluate(({ globalShortcut }, key) => globalShortcut.isRegistered(key), bindings.clockIn), true);

    // A separate process owns F12, exercising a real OS registration conflict.
    const ready = path.join(dataDir, 'blocker-ready');
    blocker = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper,
      '-Action', 'hold', '-VirtualKey', '123', '-ReadyFile', ready], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    await expect.poll(() => fs.existsSync(ready)).toBe(true);
    const blockedBindings = { ...bindings, clockIn: 'Ctrl+Alt+Shift+F12' };
    const checked = await settings.evaluate(keys => window.shiguang.checkShortcuts(keys), blockedBindings);
    assert.equal(checked.ok, true);
    assert.equal(checked.value.clockIn.registered, false);
    assert.ok(checked.value.clockIn.error);
    const rejected = await settings.evaluate(shortcuts => window.shiguang.saveSettings({ shortcuts }), blockedBindings);
    assert.equal(rejected.ok, false);
    assert.deepEqual((await settings.evaluate(() => window.shiguang.getSettings())).shortcuts, bindings);
    assert.equal(await app.evaluate(({ globalShortcut }, key) => globalShortcut.isRegistered(key), bindings.clockIn), true);
    const stopped = once(blocker, 'exit'); blocker.stdin.end('\n'); await stopped; blocker = null;
    assert.equal((await settings.evaluate(keys => window.shiguang.checkShortcuts(keys), blockedBindings)).value.clockIn.registered, true);

    await app.close(); app = null;
    const startupReady = path.join(dataDir, 'startup-blocker-ready');
    blocker = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper,
      '-Action', 'hold', '-VirtualKey', '118', '-ReadyFile', startupReady], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    await expect.poll(() => fs.existsSync(startupReady)).toBe(true);
    ({ orb, settings } = await launch());
    const restored = await settings.evaluate(() => window.shiguang.getSettings());
    assert.deepEqual(restored.shortcuts, bindings);
    assert.equal(restored.shortcutStatus.clockIn.registered, false);
    assert.ok(restored.shortcutStatus.clockIn.error);
    assert.equal(restored.shortcutStatus.pause.registered, true);
    const startupStopped = once(blocker, 'exit'); blocker.stdin.end('\n'); await startupStopped; blocker = null;
    const retried = await settings.evaluate(shortcuts => window.shiguang.saveSettings({ shortcuts }), bindings);
    assert.equal(retried.ok, true);
    assert.ok(Object.values(retried.value.shortcutStatus).every(status => status.registered));
    const disabled = Object.fromEntries(Object.keys(bindings).map(action => [action, '']));
    assert.equal((await settings.evaluate(shortcuts => window.shiguang.saveSettings({ shortcuts }), disabled)).ok, true);
    assert.equal(await app.evaluate(({ globalShortcut }, key) => globalShortcut.isRegistered(key), bindings.clockIn), false);
    console.log('PASS: real Windows hotkeys perform all five actions, capture suspends bindings, OS conflicts are rejected without losing old keys, persistence/restart and clearing work.');
  } finally {
    if (blocker && blocker.exitCode === null) { const stopped = once(blocker, 'exit'); blocker.stdin.end('\n'); await stopped; }
    if (app) await app.close();
    const resolved = path.resolve(dataDir);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('shiguang-shortcut-test-')) throw new Error('Unexpected test directory.');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
