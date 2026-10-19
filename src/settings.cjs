const fs = require('node:fs');
const path = require('node:path');

const THEMES = ['spring', 'slate', 'sand'];
function validateSettings(value) {
  return !!value && value.version === 1 && typeof value.launchAtLogin === 'boolean'
    && THEMES.includes(value.theme) && Number.isInteger(value.targetMinutes)
    && value.targetMinutes >= 1 && value.targetMinutes <= 1440
    && (value.language === undefined || ['zh-CN', 'en'].includes(value.language))
    && (value.weekStart === undefined || (Number.isInteger(value.weekStart) && value.weekStart >= 0 && value.weekStart <= 6))
    && typeof value.dataDirectory === 'string' && path.isAbsolute(value.dataDirectory);
}

class SettingsStore {
  constructor(directory) {
    this.file = path.join(directory, 'settings.json');
    this.defaults = { version: 1, launchAtLogin: true, theme: 'spring', targetMinutes: 480, dataDirectory: directory, language: 'zh-CN', weekStart: 1 };
  }

  read(file) {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!validateSettings(value)) throw new Error('设置文件格式无效');
    return { ...this.defaults, ...value };
  }

  load() {
    if (!fs.existsSync(this.file) && !fs.existsSync(`${this.file}.bak`)) return { ...this.defaults };
    try { return this.read(this.file); } catch {
      try { return this.read(`${this.file}.bak`); } catch {
        throw new Error(`设置文件无法读取。为保留数据存储位置，请先恢复此文件：\n${this.file}`);
      }
    }
  }

  save(value) {
    if (!validateSettings(value)) throw new Error('设置值无效');
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(value, null, 2));
    let valid = false;
    try { this.read(this.file); valid = true; } catch { /* Preserve a valid backup on recovery. */ }
    if (valid) fs.copyFileSync(this.file, `${this.file}.bak`);
    fs.renameSync(temp, this.file);
  }
}

function patchSettings(current, patch) {
  if (!patch || typeof patch !== 'object' || Object.keys(patch).some(key => !['launchAtLogin', 'theme', 'targetMinutes', 'language', 'weekStart'].includes(key))) throw new Error('不支持的设置项');
  const next = { ...current, ...patch };
  if (!validateSettings(next)) throw new Error('请检查设置：圆环目标须为 1 分钟至 24 小时。');
  return next;
}

function moveDataDirectory(clock, sourceStore, settingsStore, settings, destination) {
  const { FileStore } = require('./store.cjs');
  if (typeof destination !== 'string' || !path.isAbsolute(destination)) throw new Error('请选择有效的文件夹');
  const target = path.resolve(destination);
  const samePath = process.platform === 'win32' ? target.toLowerCase() === path.resolve(settings.dataDirectory).toLowerCase() : target === path.resolve(settings.dataDirectory);
  if (samePath) return { store: sourceStore, settings };
  const file = path.join(target, 'worklog.json');
  if (fs.existsSync(file) || fs.existsSync(`${file}.bak`)) throw new Error('该文件夹已有工时记录，请选择一个新的文件夹，避免覆盖已有数据。');
  const state = clock.checkpoint();
  sourceStore.save(state);
  const targetStore = new FileStore(file);
  targetStore.save(state);
  const next = { ...settings, dataDirectory: target };
  settingsStore.save(next);
  return { store: targetStore, settings: next };
}

module.exports = { SettingsStore, validateSettings, patchSettings, moveDataDirectory };
