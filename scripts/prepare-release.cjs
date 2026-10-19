const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { root, pkg, artifacts, sourceFiles } = require('./release-files.cjs');

if (process.platform !== 'win32') throw new Error('Prepare Windows release files on Windows, or use GitHub Actions.');
const output = path.join(root, 'release');
for (const file of artifacts.slice(0, 2)) {
  if (!fs.existsSync(path.join(output, file))) throw new Error(`Missing ${file}; run npm run dist first.`);
}
const notes = path.join(root, 'docs', 'releases', `v${pkg.version}.md`);
if (!fs.existsSync(notes)) throw new Error(`Missing release notes: ${notes}`);
const files = sourceFiles();
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'shiguang-source-'));
try {
  const stage = path.join(temporary, 'contents');
  fs.mkdirSync(stage);
  for (const relative of files) {
    const destination = path.join(stage, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(root, relative), destination);
  }
  const archive = path.join(temporary, artifacts[2]);
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'archive-source.ps1'), '-SourceDirectory', stage, '-DestinationPath', archive], { stdio: 'inherit', windowsHide: true });
  fs.copyFileSync(archive, path.join(output, artifacts[2]));
  const checksums = artifacts.map(file => `${createHash('sha256').update(fs.readFileSync(path.join(output, file))).digest('hex')}  ${file}`);
  fs.writeFileSync(path.join(output, 'SHA256SUMS.txt'), checksums.join('\n') + '\n');
  fs.copyFileSync(notes, path.join(output, 'RELEASE_NOTES.md'));
  console.log(`Prepared ${files.length} source files, release notes, and SHA-256 checksums in ${output}`);
  artifacts.forEach(file => console.log(file));
} finally {
  const resolved = path.resolve(temporary);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('shiguang-source-')) throw new Error('Refusing to clean an unexpected temporary path.');
  fs.rmSync(resolved, { recursive: true, force: true });
}
