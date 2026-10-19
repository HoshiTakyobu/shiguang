const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

if (process.platform !== 'win32') { console.log('SKIP: Windows startup integration test.'); process.exit(0); }
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shiguang-startup-test-'));
try {
  const env = { ...process.env, SHIGUANG_STARTUP_TEST_DIR: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  execFileSync(require('electron'), [path.join(__dirname, 'fixtures/startup-native-app.cjs')], { env, windowsHide: true, timeout: 25000, stdio: 'pipe' });
  const report = JSON.parse(fs.readFileSync(path.join(directory, 'result.json'), 'utf8'));
  assert.equal(report.ok, true, report.error);
  console.log('PASS: reproduced custom-name mismatch; Windows startup enable, disable, task-manager pause, path with spaces, and legacy cleanup all passed. Only isolated test keys were used and removed.');
} finally {
  if (path.resolve(directory).startsWith(path.join(os.tmpdir(), 'shiguang-startup-test-'))) fs.rmSync(directory, { recursive: true, force: true });
}
