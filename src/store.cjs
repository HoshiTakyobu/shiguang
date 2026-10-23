const fs = require('node:fs');
const path = require('node:path');
const { validateState } = require('./clock.cjs');

class FileStore {
  constructor(file) { this.file = file; this.recovered = false; }

  read(file) {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!validateState(value)) throw new Error('Invalid work clock data');
    return value;
  }

  load(required = false) {
    this.recovered = false;
    if (!fs.existsSync(this.file) && !fs.existsSync(`${this.file}.bak`)) {
      if (required) throw new Error(`未找到已迁移的工时记录，请连接数据磁盘或恢复文件：\n${this.file}`);
      return undefined;
    }
    try { return this.read(this.file); } catch {
      try {
        const value = this.read(`${this.file}.bak`);
        this.recovered = true;
        return value;
      } catch {
        throw new Error(`工时记录无法读取，请保留此文件以便恢复：\n${this.file}`);
      }
    }
  }

  save(state) {
    if (!validateState(state)) throw new Error('Refusing to save invalid data');
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    const descriptor = fs.openSync(temp, 'w');
    try {
      fs.writeFileSync(descriptor, JSON.stringify(state, null, 2), 'utf8');
      fs.fsyncSync(descriptor);
    } finally { fs.closeSync(descriptor); }
    if (fs.existsSync(this.file)) {
      let valid = false;
      try { this.read(this.file); valid = true; } catch { /* Preserve the last good backup. */ }
      if (valid) fs.copyFileSync(this.file, `${this.file}.bak`);
    }
    fs.renameSync(temp, this.file);
  }
}

module.exports = { FileStore };
