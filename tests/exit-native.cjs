const { _electron: electron, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { dayKey } = require('../src/clock.cjs');

if (process.platform !== 'win32') { console.log('SKIP: native Windows exit tests.'); process.exit(0); }
const root = path.resolve(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiguang-exit-test-'));
const worklog = path.join(dataDir, 'worklog.json');
const output = path.join(root, 'test-results');
fs.mkdirSync(output, { recursive: true });
const read = () => JSON.parse(fs.readFileSync(worklog, 'utf8'));
let app, orb;

async function launch(status = '下班啦') {
  const env = { ...process.env, SHIGUANG_TEST: '1', SHIGUANG_DATA_DIR: dataDir };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ ...(process.env.SHIGUANG_EXECUTABLE ? { executablePath: process.env.SHIGUANG_EXECUTABLE } : { args: [root] }), env });
  orb = await app.firstWindow();
  await expect(orb.locator('#status')).toHaveText(status);
  await app.evaluate(({ dialog, Menu }) => {
    const build = Menu.buildFromTemplate;
    Menu.buildFromTemplate = (...args) => { const menu = build(...args); global.exitMenu = menu; return menu; };
    const show = dialog.showMessageBox;
    global.exitPrompts = [];
    global.exitResponse = 'native';
    dialog.showMessageBox = options => {
      global.exitPrompts.push({ message: options.message, detail: options.detail, buttons: options.buttons, defaultId: options.defaultId, cancelId: options.cancelId });
      if (global.exitResponse === 'native') return show(options);
      if (global.exitResponse === 'pending') return new Promise(resolve => { global.resolveExit = resolve; });
      return Promise.resolve({ response: global.exitResponse });
    };
    dialog.showErrorBox = (_title, message) => { global.exitError = message; };
  });
}

async function mode(value) { assert.equal((await orb.evaluate(value => window.shiguang.setMode(value), value)).ok, true); }
async function trigger(response = 'native', tray = false) {
  await app.evaluate(({ app }, { response, tray }) => {
    global.exitResponse = response;
    setImmediate(() => tray ? global.exitMenu.getMenuItemById('quit').click() : app.quit());
  }, { response, tray });
}
async function quit(response, tray = false) {
  const closed = app.waitForEvent('close', { timeout: 15000 });
  await trigger(response, tray);
  try { await closed; }
  catch (error) {
    console.error('Exit diagnostic:', await app.evaluate(() => ({ prompts: global.exitPrompts, error: global.exitError, response: global.exitResponse })));
    throw error;
  }
  app = null;
}
async function inspect(window, args = []) {
  const { pid, handle } = await app.evaluate(({ BrowserWindow }, url) => {
    const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes(url));
    const buffer = win.getNativeWindowHandle();
    return { pid: process.pid, handle: Number(buffer.readBigUInt64LE()) };
  }, window);
  return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(__dirname, 'fixtures/inspect-window.ps1'), '-ExpectedProcessId', String(pid), '-WindowHandle', String(handle), ...args], { windowsHide: true, encoding: 'utf8', timeout: 15000 }));
}

(async () => {
  try {
    await launch();
    for (const show of ['show', 'showInactive']) {
      await app.evaluate(({ BrowserWindow }, show) => { const win = BrowserWindow.getAllWindows()[0]; win.hide(); win[show](); }, show);
      const info = await inspect('orb.html');
      assert.ok(info.exStyle & 0x80, 'Orb uses WS_EX_TOOLWINDOW, which excludes taskbar and Alt+Tab entries');
      assert.equal(info.exStyle & 0x40000, 0, 'Orb does not force a taskbar button with WS_EX_APPWINDOW');
    }
    await orb.evaluate(() => window.shiguang.openCalendar());
    await expect.poll(() => app.windows().length).toBe(2);
    assert.equal((await inspect('calendar.html')).exStyle & 0x80, 0, 'Calendar remains a normal app window');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('calendar.html')).close());
    await mode('working');
    const beforeCancel = read();
    // Invoke the callback installed on the tray menu while the orb is hidden.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
    const pid = await app.evaluate(() => process.pid);
    await trigger('native', true);
    const native = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(__dirname, 'fixtures/inspect-window.ps1'), '-ExpectedProcessId', String(pid), '-ButtonText', '取消',
      '-Screenshot', path.join(output, 'exit-dialog.png')], { windowsHide: true, encoding: 'utf8', timeout: 15000 }));
    assert.ok(native.children.includes('继续计时并退出'));
    assert.ok(native.children.includes('停止计时并退出'));
    assert.equal(native.defaultText.replaceAll('&', ''), '取消');
    await expect.poll(() => app.evaluate(() => global.exitPrompts.length)).toBe(1);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
    await expect(orb.locator('#status')).toHaveText('上班中');
    assert.deepEqual(read().events, beforeCancel.events);
    assert.equal(read().continueAfterExit, undefined);
    await trigger('pending');
    await expect.poll(() => app.evaluate(() => global.exitPrompts.length)).toBe(2);
    await trigger('pending');
    assert.equal(await app.evaluate(() => global.exitPrompts.length), 2, 'Repeated exit clicks share one prompt');
    await app.evaluate(() => global.resolveExit({ response: 2 }));
    await quit(0, true);
    const continued = read();
    assert.equal(continued.continueAfterExit, true);
    assert.equal(continued.mode, 'working');
    await new Promise(resolve => setTimeout(resolve, 1100));
    await launch('上班中');
    const resumed = await orb.evaluate(() => window.shiguang.getState());
    const today = dayKey(resumed.now);
    assert.ok(resumed.days[today] > (continued.days[today] || 0) + 1000);
    assert.equal(read().continueAfterExit, undefined);
    assert.deepEqual(read().events, continued.events);
    // A subsequent crash must no longer have permission to count the gap.
    const beforeCrash = read();
    const crashed = app.waitForEvent('close');
    process.kill(await app.evaluate(() => process.pid), 'SIGKILL');
    await crashed; app = null;
    await launch();
    assert.deepEqual(read().days, beforeCrash.days);
    assert.equal(read().events.at(-1).reason, 'interrupted');
    await mode('working');
    await quit(1, true);
    const stopped = read();
    assert.equal(stopped.mode, 'idle');
    assert.equal(stopped.continueAfterExit, undefined);
    await launch();
    assert.deepEqual(read().days, stopped.days);
    await mode('working'); await mode('paused');
    const paused = read();
    const settingsOpened = app.waitForEvent('window');
    await orb.evaluate(() => window.shiguang.openSettings());
    const settingsPage = await settingsOpened;
    await settingsPage.waitForLoadState('domcontentloaded');
    assert.equal((await settingsPage.evaluate(() => window.shiguang.saveSettings({ language: 'en' }))).ok, true);
    const pausedPid = await app.evaluate(() => process.pid);
    await trigger('native', true);
    const english = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(__dirname, 'fixtures/inspect-window.ps1'), '-ExpectedProcessId', String(pausedPid), '-ButtonText', 'Cancel',
      '-Screenshot', path.join(output, 'exit-dialog-english.png')], { windowsHide: true, encoding: 'utf8', timeout: 15000 }));
    assert.ok(english.children.includes('Keep timing and exit'));
    assert.ok(english.children.includes('Stay paused and exit'));
    assert.equal(english.defaultText.replaceAll('&', ''), 'Cancel');
    assert.ok(!/[\u3400-\u9fff]/u.test(english.children.join(' ')), 'The English exit dialog is fully translated');
    assert.equal((await settingsPage.evaluate(() => window.shiguang.saveSettings({ language: 'zh-CN' }))).ok, true);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('settings.html')).close());
    await quit(1, true);
    await launch('已暂停');
    assert.deepEqual(read().days, paused.days);
    await quit(0);
    assert.equal(read().events.at(-1).reason, 'quit-continue');
    await launch('上班中');
    // Fail just the atomic commit of our isolated worklog, then retry.
    await app.evaluate((_electron, file) => {
      const fs = process.getBuiltinModule('fs');
      global.originalRename = fs.renameSync;
      fs.renameSync = (from, to) => { if (to === file) throw new Error('Test disk full'); return global.originalRename(from, to); };
    }, worklog);
    const beforeFailure = read();
    await trigger(0);
    await expect.poll(() => app.evaluate(() => global.exitError || '')).toContain('工时暂未保存');
    assert.equal((await orb.evaluate(() => window.shiguang.getState())).mode, 'working');
    assert.deepEqual(read(), beforeFailure);
    await app.evaluate(() => { process.getBuiltinModule('fs').renameSync = global.originalRename; });
    await quit(1);
    await launch();
    await quit(2); // Idle exits directly, without a timer decision.
    await launch();
    await mode('working');
    const shutdownWindow = await app.evaluate(({ BrowserWindow }) => ({
      pid: process.pid, handle: Number(BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readBigUInt64LE())
    }));
    await trigger('native');
    // A real session-end message must close a pending native quit prompt and
    // save a clock-out, without granting offline continuation.
    const shutdownClosed = app.waitForEvent('close', { timeout: 15000 });
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(__dirname, 'fixtures/send-session-end.ps1'), '-WindowHandle', String(shutdownWindow.handle),
      '-ExpectedProcessId', String(shutdownWindow.pid), '-Notification', 'query'], { windowsHide: true, timeout: 15000, stdio: 'pipe' });
    await shutdownClosed; app = null;
    assert.equal(read().mode, 'idle');
    assert.equal(read().continueAfterExit, undefined);
    assert.equal(read().events.at(-1).reason, 'shutdown');
    await launch();
    // Reproduce the reported shutdown/display race with a real destroyed
    // BrowserWindow. Catch errors here so regressions fail instead of leaving
    // Electron's uncaught-exception message box blocking the whole test run.
    const displayCleanup = await app.evaluate(({ BrowserWindow, screen }) => {
      const events = ['display-removed', 'display-metrics-changed'];
      const before = events.map(name => screen.listeners(name));
      const win = BrowserWindow.getAllWindows()[0];
      win.destroy();
      const after = events.map(name => screen.listeners(name));
      const errors = [];
      for (const name of events) {
        try { screen.emit(name); } catch (error) { errors.push(error.message); }
      }
      // A callback that was queued before removal must also be harmless.
      for (const callbacks of before) for (const callback of callbacks) {
        try { callback(); } catch (error) { errors.push(error.message); }
      }
      return { destroyed: win.isDestroyed(), removed: before.map((list, i) => list.length - after[i].length), errors };
    });
    assert.equal(displayCleanup.destroyed, true);
    assert.deepEqual(displayCleanup.removed, [1, 1]);
    assert.deepEqual(displayCleanup.errors, []);
    await quit(2);
    console.log('PASS: bilingual native tray quit dialog/default cancel, hidden orb, one prompt, continue/stop/pause/restart/crash, failed save/retry, native taskbar styles, shutdown during a quit prompt, and display events after native window destruction.');
  } finally {
    if (app) { await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); }); await app.close(); }
    const resolved = path.resolve(dataDir);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('shiguang-exit-test-')) throw new Error('Unexpected test directory.');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
