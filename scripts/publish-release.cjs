const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { root, pkg, artifacts } = require('./release-files.cjs');

const tag = `v${pkg.version}`;
const repository = process.env.GITHUB_REPOSITORY;
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REF_TYPE !== 'tag' || process.env.GITHUB_REF_NAME !== tag || !repository || !process.env.GH_TOKEN) {
  throw new Error('Run this publisher in the GitHub tag release workflow with a matching version.');
}
const output = path.join(root, 'release');
const checksumText = fs.readFileSync(path.join(output, 'SHA256SUMS.txt'), 'utf8');
for (const file of artifacts) {
  const checksum = createHash('sha256').update(fs.readFileSync(path.join(output, file))).digest('hex');
  if (!checksumText.split(/\r?\n/).includes(`${checksum}  ${file}`)) throw new Error(`Checksum mismatch: ${file}`);
}
const gh = args => execFileSync('gh', [...args, '--repo', repository], { cwd: root, stdio: 'inherit', windowsHide: true });
const existing = spawnSync('gh', ['release', 'view', tag, '--repo', repository, '--json', 'isDraft'], { encoding: 'utf8', windowsHide: true });
if (existing.status === 0) {
  if (!JSON.parse(existing.stdout).isDraft) throw new Error(`${tag} is already public. Publish a new version instead of replacing existing downloads.`);
} else {
  gh(['release', 'create', tag, '--draft', '--verify-tag', '--title', `拾光 ${pkg.version}`, '--notes-file', path.join(output, 'RELEASE_NOTES.md')]);
}
gh(['release', 'upload', tag, ...[...artifacts, 'SHA256SUMS.txt'].map(file => path.join(output, file)), '--clobber']);
gh(['release', 'edit', tag, '--draft=false', '--latest', '--title', `拾光 ${pkg.version}`, '--notes-file', path.join(output, 'RELEASE_NOTES.md')]);
