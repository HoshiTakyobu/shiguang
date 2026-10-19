const { execFileSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
if (process.platform !== 'win32') throw new Error('Windows packages must be built on Windows. Use the GitHub release workflow from other systems.');
execFileSync(process.execPath, [require.resolve('electron/install.js')], { cwd: root, stdio: 'inherit', windowsHide: true });
const builder = path.join(root, 'node_modules/electron-builder/cli.js');
const args = process.argv.includes('--dir') ? ['--win', '--dir'] : ['--win', 'nsis', 'portable'];
execFileSync(process.execPath, [builder, ...args, '--publish', 'never', '--config.electronDist=node_modules/electron/dist'], { cwd: root, stdio: 'inherit', windowsHide: true });
