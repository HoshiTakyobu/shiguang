const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { root, pkg, sourceFiles } = require('./release-files.cjs');
const lock = require('../package-lock.json');
assert.equal(lock.version, pkg.version);
assert.equal(lock.packages[''].version, pkg.version);
assert.equal(pkg.author.name, 'Hoshi Takyobu');
assert.equal(pkg.license, 'MIT');
assert.ok(fs.existsSync(path.join(root, 'docs/releases', `v${pkg.version}.md`)), 'Current version needs release notes');
if (process.env.GITHUB_REF_TYPE === 'tag') assert.equal(process.env.GITHUB_REF_NAME, `v${pkg.version}`, 'Release tag must match package.json');
const files = sourceFiles();
let links = 0;
for (const relative of files.filter(file => file.endsWith('.md'))) {
  const file = path.join(root, relative);
  const content = fs.readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
  const urls = [...content.matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g), ...content.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]);
  for (const url of urls) {
    if (/^(https?:|mailto:|#)/.test(url)) continue;
    const target = path.resolve(path.dirname(file), decodeURIComponent(url.split('#')[0]));
    assert.ok(fs.existsSync(target), `${relative}: missing local link ${url}`);
    links++;
  }
}
console.log(`PASS: ${files.length} source files, ${links} local documentation links, author, license and version metadata.`);
