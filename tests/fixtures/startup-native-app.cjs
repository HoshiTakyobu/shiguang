const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { StartupController, STARTUP_ARGS } = require('../../src/startup.cjs');

const directory = process.env.SHIGUANG_STARTUP_TEST_DIR;
if (!directory) app.exit(1);
const appId = `com.shiguang.startup-test.${process.pid}`;
const legacy = `${appId}.legacy`;
const executable = path.join(directory, 'Program Files', '拾光 Work Orb.exe');
app.setName('Shiguang startup test');
app.setPath('userData', directory);
app.setAppUserModelId(appId);

app.whenReady().then(() => {
  const controller = new StartupController(app, executable, { appId, legacyNames: [legacy] });
  let report;
  try {
    app.setLoginItemSettings({ name: legacy, openAtLogin: true, enabled: true, path: executable, args: STARTUP_ARGS });
    const before = app.getLoginItemSettings({ path: `"${executable}"`, args: STARTUP_ARGS });
    assert.equal(before.openAtLogin, false, 'The old code reads a different registry value.');
    assert.equal(before.executableWillLaunchAtLogin, true);
    assert.deepEqual(controller.configure(true), { registered: true, enabled: true });
    const after = app.getLoginItemSettings({ path: `"${executable}"`, args: STARTUP_ARGS });
    assert.equal(after.openAtLogin, true);
    assert.equal(after.launchItems.some(item => item.name === legacy), false);

    // Simulate Task Manager disabling only our uniquely named test entry.
    execFileSync('reg.exe', ['add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run', '/v', appId, '/t', 'REG_BINARY', '/d', '030000000000000000000000', '/f'], { windowsHide: true });
    assert.deepEqual(controller.status(), { registered: true, enabled: false });
    assert.deepEqual(controller.configure(true, { preserveDisabled: true }), { registered: true, enabled: false });
    assert.deepEqual(controller.configure(true), { registered: true, enabled: true });
    assert.deepEqual(controller.configure(false), { registered: false, enabled: false });
    report = { ok: true };
  } catch (error) {
    report = { ok: false, error: `${error.stack}\n${JSON.stringify({ appId, executable, actual: app.getLoginItemSettings({ path: `"${executable}"`, args: STARTUP_ARGS }) })}` };
  } finally {
    app.setLoginItemSettings({ openAtLogin: false });
    app.setLoginItemSettings({ openAtLogin: false, name: legacy });
    fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(report));
    app.quit();
  }
});
