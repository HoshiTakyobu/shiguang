const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function acquireInstanceLock(name = 'Global\\HoshiTakyobu.Shiguang') {
  if (process.platform !== 'win32') return Promise.resolve({ release() {} });
  const script = fs.readFileSync(path.join(__dirname, 'instance-lock.ps1'), 'utf8');
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      env: { ...process.env, SHIGUANG_MUTEX_NAME: name }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
    });
    let settled = false, buffer = '';
    const timer = setTimeout(() => { child.kill(); if (!settled) reject(new Error('Cannot acquire the Shiguang instance lock.')); }, 10000);
    child.stdout.on('data', data => {
      buffer += data.toString();
      if (!buffer.includes('\n') || settled) return;
      settled = true; clearTimeout(timer);
      const result = buffer.trim();
      if (result === 'acquired') resolve({ release: () => child.stdin.end(), process: child });
      else if (result === 'busy') { child.stdin.end(); resolve(null); }
      else { child.stdin.end(); reject(new Error('Cannot acquire the Shiguang instance lock.')); }
    });
    child.on('error', error => { clearTimeout(timer); if (!settled) { settled = true; reject(error); } });
    child.on('exit', () => { clearTimeout(timer); if (!settled) { settled = true; reject(new Error('Instance lock helper exited unexpectedly.')); } });
    child.stdin.on('error', () => {});
  });
}
module.exports = { acquireInstanceLock };
