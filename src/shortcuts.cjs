const ACTIONS = Object.freeze(['clockIn', 'pause', 'resume', 'clockOut', 'toggleOrb']);
const DEFAULT_SHORTCUTS = Object.freeze(Object.fromEntries(ACTIONS.map(action => [action, ''])));

const KEY_NAMES = new Map([
  ['up', 'Up'], ['arrowup', 'Up'], ['down', 'Down'], ['arrowdown', 'Down'],
  ['left', 'Left'], ['arrowleft', 'Left'], ['right', 'Right'], ['arrowright', 'Right'],
  ['home', 'Home'], ['end', 'End'], ['pageup', 'PageUp'], ['pagedown', 'PageDown'],
  ['insert', 'Insert'], ['delete', 'Delete'], ['space', 'Space'], ['tab', 'Tab'],
  ['escape', 'Escape'], ['esc', 'Escape'], ['enter', 'Enter'], ['return', 'Enter'],
  ['backspace', 'Backspace']
]);
const MESSAGES = {
  invalid: '快捷键格式无效，请使用 Ctrl / Alt 与按键的组合，或 F1–F24。',
  duplicate: '同一个快捷键不能分配给多个操作。',
  reserved: '此快捷键由 Windows 系统保留，请选择其他组合。',
  unavailable: '快捷键无法注册，可能已被系统或其他应用占用。'
};

function parseAccelerator(value) {
  if (typeof value !== 'string') return { accelerator: '', error: 'invalid' };
  const original = value.trim();
  if (!original) return { accelerator: '', error: null };
  const parts = original.split('+').map(part => part.trim());
  if (parts.some(part => !part)) return { accelerator: original, error: 'invalid' };
  const modifiers = new Set();
  let key = '';
  for (const part of parts) {
    const lower = part.toLowerCase();
    const modifier = lower === 'ctrl' || lower === 'control' ? 'Ctrl' : lower === 'alt' ? 'Alt' : lower === 'shift' ? 'Shift' : '';
    if (modifier) {
      if (modifiers.has(modifier)) return { accelerator: original, error: 'invalid' };
      modifiers.add(modifier);
      continue;
    }
    if (key) return { accelerator: original, error: 'invalid' };
    if (/^[a-z0-9]$/i.test(part) || /^f(?:[1-9]|1[0-9]|2[0-4])$/i.test(part)) key = part.toUpperCase();
    else key = KEY_NAMES.get(lower) || '';
    if (!key) return { accelerator: original, error: 'invalid' };
  }
  if (!key || (!/^F\d+$/.test(key) && !modifiers.has('Ctrl') && !modifiers.has('Alt'))) return { accelerator: original, error: 'invalid' };
  const accelerator = [...['Ctrl', 'Alt', 'Shift'].filter(modifier => modifiers.has(modifier)), key].join('+');
  const reserved = (modifiers.has('Alt') && ['Tab', 'Escape', 'Space', 'F4'].includes(key))
    || (modifiers.has('Ctrl') && key === 'Escape')
    || (modifiers.has('Ctrl') && modifiers.has('Alt') && key === 'Delete');
  return { accelerator, error: reserved ? 'reserved' : null };
}

function analyzeShortcuts(value) {
  const source = value === undefined ? DEFAULT_SHORTCUTS : value;
  const invalidMap = !source || typeof source !== 'object' || Array.isArray(source)
    || Object.keys(source).some(action => !ACTIONS.includes(action));
  const bindings = {}, status = {}, owners = new Map();
  for (const action of ACTIONS) {
    const parsed = invalidMap ? { accelerator: '', error: 'invalid' }
      : parseAccelerator(Object.hasOwn(source, action) ? source[action] : '');
    bindings[action] = parsed.accelerator;
    status[action] = { ...parsed, registered: false };
    if (!parsed.error && parsed.accelerator) {
      const owner = owners.get(parsed.accelerator);
      if (owner) status[owner].error = status[action].error = 'duplicate';
      else owners.set(parsed.accelerator, action);
    }
  }
  return { bindings, status };
}

function copyStatus(status) {
  return Object.fromEntries(ACTIONS.map(action => [action, { ...status[action] }]));
}

function statusError(status) {
  const code = ACTIONS.map(action => status[action].error).find(Boolean);
  const error = new Error(MESSAGES[code] || '快捷键设置无效。');
  error.code = code;
  error.status = copyStatus(status);
  return error;
}

function normalizeShortcuts(value) {
  const { bindings, status } = analyzeShortcuts(value);
  if (ACTIONS.some(action => status[action].error)) throw statusError(status);
  return bindings;
}

class ShortcutManager {
  constructor(globalShortcut, onAction) {
    this.globalShortcut = globalShortcut;
    this.onAction = onAction;
    this.owned = new Set();
    this.activeActions = new Map();
    this.analysis = analyzeShortcuts();
    this.status = copyStatus(this.analysis.status);
    this.suspended = false;
    this.disposed = false;
  }

  assertOpen() {
    if (this.disposed) throw new Error('快捷键管理器已关闭。');
  }

  callback(accelerator) {
    return () => {
      if (this.disposed || this.suspended || !this.owned.has(accelerator)) return;
      const action = this.activeActions.get(accelerator);
      if (action) this.onAction(action);
    };
  }

  register(accelerator, callback) {
    try { return this.globalShortcut.register(accelerator, callback) === true; }
    catch { return false; }
  }

  release(accelerator) {
    this.globalShortcut.unregister(accelerator);
    this.owned.delete(accelerator);
  }

  activate() {
    this.status = copyStatus(this.analysis.status);
    this.activeActions.clear();
    for (const action of ACTIONS) {
      const row = this.status[action];
      if (row.error || !row.accelerator) continue;
      if (this.suspended) { row.error = 'suspended'; continue; }
      if (this.register(row.accelerator, this.callback(row.accelerator))) {
        this.owned.add(row.accelerator);
        this.activeActions.set(row.accelerator, action);
        row.registered = true;
      } else row.error = 'unavailable';
    }
    return this.getStatus();
  }

  start(bindings) {
    this.assertOpen();
    for (const accelerator of this.owned) this.release(accelerator);
    this.analysis = analyzeShortcuts(bindings);
    return this.activate();
  }

  check(bindings) {
    this.assertOpen();
    const { status } = analyzeShortcuts(bindings);
    for (const action of ACTIONS) {
      const row = status[action];
      if (row.error || !row.accelerator) continue;
      if (this.owned.has(row.accelerator)) { row.registered = true; continue; }
      if (this.register(row.accelerator, () => {})) {
        row.registered = true;
        this.globalShortcut.unregister(row.accelerator);
      } else row.error = 'unavailable';
    }
    return copyStatus(status);
  }

  replace(bindings, persist = () => {}) {
    this.assertOpen();
    const analysis = analyzeShortcuts(bindings);
    const status = copyStatus(analysis.status);
    if (ACTIONS.some(action => status[action].error)) throw statusError(status);
    if (typeof persist !== 'function') throw new TypeError('保存快捷键的回调必须是同步函数。');
    const acquired = [];
    for (const action of ACTIONS) {
      const row = status[action];
      if (!row.accelerator) continue;
      if (this.owned.has(row.accelerator)) row.registered = true;
      else if (this.register(row.accelerator, this.callback(row.accelerator))) {
        this.owned.add(row.accelerator);
        acquired.push(row.accelerator);
        row.registered = true;
      } else row.error = 'unavailable';
    }
    const rollback = () => { for (const accelerator of acquired) this.release(accelerator); };
    if (ACTIONS.some(action => status[action].error)) {
      rollback();
      throw statusError(status);
    }
    try {
      const result = persist({ ...analysis.bindings });
      if (result && typeof result.then === 'function') throw new TypeError('保存快捷键的回调必须是同步函数。');
    } catch (error) {
      rollback();
      throw error;
    }
    // Reuse held keys until persistence succeeds. This also makes key swaps atomic.
    const desired = new Set(Object.values(analysis.bindings).filter(Boolean));
    for (const accelerator of this.owned) if (this.suspended || !desired.has(accelerator)) this.release(accelerator);
    this.analysis = analysis;
    this.activeActions.clear();
    this.status = status;
    for (const action of ACTIONS) {
      const row = this.status[action];
      if (!row.accelerator) continue;
      if (this.suspended) { row.registered = false; row.error = 'suspended'; }
      else this.activeActions.set(row.accelerator, action);
    }
    return this.getStatus();
  }

  getStatus() { return copyStatus(this.status); }

  suspend() {
    if (this.disposed || this.suspended) return this.getStatus();
    this.suspended = true;
    this.activeActions.clear();
    for (const accelerator of this.owned) this.release(accelerator);
    for (const row of Object.values(this.status)) {
      if (row.registered) { row.registered = false; row.error = 'suspended'; }
    }
    return this.getStatus();
  }

  resume() {
    if (this.disposed || !this.suspended) return this.getStatus();
    this.suspended = false;
    return this.activate();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.activeActions.clear();
    for (const accelerator of this.owned) this.release(accelerator);
    for (const row of Object.values(this.status)) row.registered = false;
  }
}

module.exports = { ACTIONS, DEFAULT_SHORTCUTS, normalizeShortcuts, ShortcutManager };
