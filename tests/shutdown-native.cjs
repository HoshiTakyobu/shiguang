const { _electron: electron, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

if (process.platform !== 'win32') { console.log('SKIP: native Windows shutdown test.'); process.exit(0); }
const root = path.resolve(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiguang-shutdown-test-'));
const worklog = path.join(dataDir, 'worklog.json');
let app;

async function launch() {
  const env = { ...process.env, SHIGUANG_TEST: '1', SHIGUANG_DATA_DIR: dataDir };
  delete env.ELECTRON_RUN_AS_NODE;
  const options = process.env.SHIGUANG_EXECUTABLE ? { executablePath: process.env.SHIGUANG_EXECUTABLE } : { args: [root] };
  app = await electron.launch({ ...options, env });
  const orb = await app.firstWindow();
  await expect(orb.locator('#status')).toHaveText('下班啦');
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), dataDir);
  return orb;
}

(async () => {
  try {
    for (const [mode, notification] of [['working', 'query'], ['paused', 'query'], ['working', 'end'], ['paused', 'end']]) {
      const orb = await launch();
      assert.equal((await orb.evaluate(() => window.shiguang.setMode('working'))).ok, true);
      if (mode === 'paused') assert.equal((await orb.evaluate(() => window.shiguang.setMode('paused'))).ok, true);
      const before = JSON.parse(fs.readFileSync(worklog, 'utf8'));
      const handle = await app.evaluate(({ BrowserWindow }) => {
        const buffer = BrowserWindow.getAllWindows()[0].getNativeWindowHandle();
        return buffer.length === 8 ? Number(buffer.readBigUInt64LE()) : buffer.readUInt32LE();
      });
      const mainPid = await app.evaluate(() => process.pid);
      const closed = app.waitForEvent('close', { timeout: 15000 });
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
        path.join(__dirname, 'fixtures/send-session-end.ps1'), '-WindowHandle', String(handle),
        '-ExpectedProcessId', String(mainPid), '-Notification', notification], { windowsHide: true, timeout: 15000, stdio: 'pipe' });
      await closed;
      app = null;
      const saved = JSON.parse(fs.readFileSync(worklog, 'utf8'));
      assert.equal(saved.mode, 'idle');
      assert.equal(saved.activeSince, null);
      assert.equal(saved.events.length, before.events.length + 1);
      assert.equal(saved.events.at(-1).type, 'clock-out');
      assert.equal(saved.events.at(-1).reason, 'shutdown');
      if (mode === 'paused') assert.deepEqual(saved.days, before.days);
      console.log(`PASS: native ${notification} notification saved ${mode} session before exit.`);
    }

    // Kill only our owned isolated process, then verify startup discards the offline gap.
    const orb = await launch();
    assert.equal((await orb.evaluate(() => window.shiguang.setMode('working'))).ok, true);
    const beforeCrash = JSON.parse(fs.readFileSync(worklog, 'utf8'));
    const mainPid = await app.evaluate(() => process.pid);
    const closed = app.waitForEvent('close', { timeout: 15000 });
    process.kill(mainPid, 'SIGKILL');
    await closed;
    app = null;
    await launch();
    const recovered = JSON.parse(fs.readFileSync(worklog, 'utf8'));
    assert.equal(recovered.mode, 'idle');
    assert.equal(recovered.activeSince, null);
    assert.deepEqual(recovered.days, beforeCrash.days);
    assert.deepEqual(recovered.events.at(-1), { type: 'clock-out', at: beforeCrash.activeSince, reason: 'interrupted' });
    console.log('PASS: force-terminated isolated process restarts idle at its last saved checkpoint.');
  } finally {
    if (app) await app.close();
    const resolved = path.resolve(dataDir);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('shiguang-shutdown-test-')) throw new Error('Unexpected test directory.');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
