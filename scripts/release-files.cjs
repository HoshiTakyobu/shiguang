const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
const sourceEntries = [
  '.github', '.gitignore', '.dockerignore', 'assets', 'build', 'cloud', 'docs', 'scripts', 'src', 'tests',
  'package.json', 'package-lock.json', 'README.md', 'README.en.md',
  'LICENSE', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md', 'CONTRIBUTING.md'
];
const artifacts = [
  `Shiguang-${pkg.version}-Setup-x64.exe`,
  `Shiguang-${pkg.version}-Portable-x64.exe`,
  `Shiguang-${pkg.version}-Source.zip`
];

function sourceFiles() {
  const result = [];
  function walk(relative) {
    const absolute = path.join(root, relative);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Source package cannot include a symlink: ${relative}`);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(absolute).sort()) walk(path.join(relative, entry));
    } else {
      if (/(^|[\\/])(node_modules|release|test-results|\.git)([\\/]|$)|(^|[\\/])cloud[\\/]data[\\/]|(^|[\\/])(\.env(?:\..*)?|private\.env(?:\..*)?|worklog\.json.*|settings\.json.*|preferences\.json|cloud-settings\.json|monthly-notices\.json.*)$|\.(pem|pfx|p12|log)$/i.test(relative)) {
        throw new Error(`Unexpected private or generated file in source package: ${relative}`);
      }
      result.push(relative);
    }
  }
  sourceEntries.forEach(walk);
  return result;
}

module.exports = { root, pkg, artifacts, sourceFiles };
