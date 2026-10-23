import { targetLabel } from './shared.mjs';
import { setLanguage, t } from './i18n.mjs';

const api = window.shiguang;
const $ = selector => document.querySelector(selector);
let settings;
const shortcutIds = ['clockIn', 'pause', 'resume', 'clockOut', 'toggleOrb'];
const shortcutNames = { clockIn: '上班', pause: '休息', resume: '恢复工作', clockOut: '下班', toggleOrb: '隐藏或显示悬浮球' };
let shortcutDraft, shortcutStatus = {}, shortcutChecking = false, shortcutSaving = false, shortcutsSaved = false;
let shortcutCheckGeneration = 0, recordingGeneration = 0, recording = null, captureMessage = '';
let captureQueue = Promise.resolve(), captureRequests = 0, currentTab = 'general';
let shortcutLanguage, shortcutLanguageGeneration = 0;

function shortcutBindings(source = {}) {
  return Object.fromEntries(shortcutIds.map(id => [id, source[id] || '']));
}

function shortcutsDirty() {
  return shortcutIds.some(id => shortcutDraft[id] !== (settings.shortcuts?.[id] || ''));
}

function shortcutErrors() {
  return shortcutIds.some(id => shortcutDraft[id] && (!shortcutStatus[id]?.registered || shortcutStatus[id]?.error));
}

function shortcutsNeedActivation() {
  return shortcutIds.some(id => shortcutDraft[id] && !settings.shortcutStatus?.[id]?.registered);
}

function renderShortcuts() {
  if (!settings) return;
  if (!shortcutDraft) {
    shortcutDraft = shortcutBindings(settings.shortcuts);
    shortcutStatus = settings.shortcutStatus || {};
  }
  const dirty = shortcutsDirty();
  for (const id of shortcutIds) {
    const button = $(`[data-shortcut="${id}"]`), clear = $(`[data-clear-shortcut="${id}"]`);
    const status = $(`#shortcut-status-${id}`), capturing = recording?.id === id;
    const error = shortcutStatus[id]?.error;
    button.textContent = capturing ? (recording.pendingAccelerator || t(recording.ready ? '请按组合键…' : '正在准备…')) : (shortcutDraft[id] || t('未设置'));
    button.classList.toggle('recording', capturing);
    button.setAttribute('aria-pressed', String(capturing));
    button.setAttribute('aria-label', t('录入「{action}」快捷键', { action: t(shortcutNames[id]) }));
    button.setAttribute('aria-invalid', String(Boolean(!capturing && !shortcutChecking && error)));
    button.disabled = shortcutSaving;
    clear.disabled = !shortcutDraft[id] || Boolean(recording) || captureRequests > 0 || shortcutSaving;
    clear.setAttribute('aria-label', t('清除「{action}」快捷键', { action: t(shortcutNames[id]) }));
    let text, kind;
    if (capturing) { text = t(recording.pendingAccelerator ? '松开按键后完成录入' : captureMessage || '按 Esc 取消'); kind = captureMessage && !recording.pendingAccelerator ? 'error' : 'capturing'; }
    else if (!shortcutDraft[id]) { text = t('未设置'); kind = 'unset'; }
    else if (shortcutChecking) { text = t('正在检查…'); kind = 'checking'; }
    else if (error) { text = error; kind = 'error'; }
    else if (shortcutStatus[id]?.registered) {
      const active = shortcutDraft[id] === settings.shortcuts?.[id] && settings.shortcutStatus?.[id]?.registered;
      text = t(active ? '已启用' : '可用'); kind = active ? 'active' : 'available';
    } else { text = t('正在检查…'); kind = 'checking'; }
    status.textContent = text;
    status.dataset.status = kind;
  }
  const busy = Boolean(recording) || captureRequests > 0 || shortcutChecking || shortcutSaving;
  $('#save-shortcuts').disabled = busy || (!dirty && !shortcutsNeedActivation()) || shortcutErrors();
  $('#check-shortcuts').disabled = busy;
  $('#shortcuts-form').setAttribute('aria-busy', String(busy));
  $('#shortcut-feedback').textContent = t(captureRequests && !recording ? '正在恢复快捷键…' : dirty ? '有未保存的更改' : shortcutsSaved ? '快捷键已保存' : '');
}

function showShortcutError(message = '') {
  $('#shortcut-error').textContent = message;
  $('#shortcut-error').hidden = !message;
}

// Serialize suspension changes so a delayed "start" can never follow its cancel.
function requestCapture(enabled) {
  captureRequests++;
  renderShortcuts();
  const request = captureQueue.then(() => api.captureShortcuts(enabled));
  captureQueue = request.catch(() => {});
  return request.finally(() => { captureRequests--; renderShortcuts(); });
}

async function cancelRecording(restoreFocus = false) {
  const previous = recording;
  recording = null;
  recordingGeneration++;
  captureMessage = '';
  renderShortcuts();
  if (!previous && !captureRequests) return true;
  try {
    const result = await requestCapture(false);
    if (!result.ok) throw new Error(result.error);
    settings.shortcutStatus = result.value;
    if (!shortcutsDirty()) shortcutStatus = result.value;
    renderShortcuts();
    if (restoreFocus && previous && !recording && currentTab === 'shortcuts') $(`[data-shortcut="${previous.id}"]`).focus();
    return true;
  } catch (error) { showShortcutError(error.message); return false; }
}

async function beginRecording(id) {
  if (shortcutSaving) return;
  if (recording?.id === id) { await cancelRecording(true); return; }
  const generation = ++recordingGeneration;
  shortcutCheckGeneration++;
  shortcutChecking = false;
  recording = { id, ready: false, heldKeys: new Set() };
  captureMessage = '';
  showShortcutError();
  renderShortcuts();
  try {
    const result = await requestCapture(true);
    if (generation !== recordingGeneration) return;
    if (!result.ok) throw new Error(result.error);
    recording.ready = true;
    renderShortcuts();
    $(`[data-shortcut="${id}"]`).focus();
  } catch (error) {
    if (generation !== recordingGeneration) return;
    showShortcutError(error.message);
    await cancelRecording();
  }
}

async function checkShortcutDraft() {
  if (recording || captureRequests) return null;
  const generation = ++shortcutCheckGeneration, bindings = { ...shortcutDraft };
  shortcutChecking = true;
  renderShortcuts();
  try {
    const result = await api.checkShortcuts(bindings);
    if (generation !== shortcutCheckGeneration) return null;
    if (!result.ok) throw new Error(result.error);
    shortcutStatus = result.value;
    return { bindings, status: result.value };
  } catch (error) {
    if (generation === shortcutCheckGeneration) showShortcutError(error.message || t('快捷键检查失败，请重试。'));
    return null;
  } finally {
    if (generation === shortcutCheckGeneration) { shortcutChecking = false; renderShortcuts(); }
  }
}

function shortcutFromEvent(event) {
  if (event.metaKey || ['Meta', 'OS'].includes(event.key)) return { error: '不支持 Windows 键，请使用 Ctrl 或 Alt 组合。' };
  if (['Control', 'Alt', 'Shift', 'AltGraph'].includes(event.key)) return {};
  const navigation = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', Delete: 'Delete', ' ': 'Space', Tab: 'Tab', Escape: 'Escape', Enter: 'Enter', Backspace: 'Backspace' };
  let key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : /^Digit[0-9]$/.test(event.code) ? event.code.slice(5) : navigation[event.key];
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.key)) key = event.key;
  if (!key && /^[a-z0-9]$/i.test(event.key)) key = event.key.toUpperCase();
  if (!key) return { error: '不支持此按键，请尝试字母、数字、方向键或 F1–F24。' };
  if (!event.ctrlKey && !event.altKey && !/^F\d+$/.test(key)) return { error: '请使用 Ctrl 或 Alt 加其他按键，或单独使用 F1–F24。' };
  return { accelerator: [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', key].filter(Boolean).join('+') };
}

document.addEventListener('keydown', event => {
  if (!recording) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  recording.heldKeys.add(event.code || event.key);
  if (event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.metaKey) { void cancelRecording(true); return; }
  if (!recording.ready || event.repeat || recording.pendingAccelerator) return;
  const input = shortcutFromEvent(event);
  if (input.error) { captureMessage = input.error; renderShortcuts(); return; }
  if (!input.accelerator) return;
  recording.pendingAccelerator = input.accelerator;
  recording.pendingKey = event.code || event.key;
  renderShortcuts();
}, true);

document.addEventListener('keyup', event => {
  if (!recording) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  recording.heldKeys.delete(event.code || event.key);
  // A held registered key can repeat as soon as global shortcuts resume.
  if (!recording.pendingAccelerator || recording.heldKeys.has(recording.pendingKey)
      || event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return;
  shortcutDraft[recording.id] = recording.pendingAccelerator;
  shortcutsSaved = false;
  void cancelRecording(true).then(restored => { if (restored) void checkShortcutDraft(); });
}, true);

document.querySelectorAll('[data-shortcut]').forEach(button => button.addEventListener('click', () => void beginRecording(button.dataset.shortcut)));
document.querySelectorAll('[data-clear-shortcut]').forEach(button => button.addEventListener('click', () => {
  shortcutDraft[button.dataset.clearShortcut] = '';
  shortcutsSaved = false;
  showShortcutError();
  void checkShortcutDraft();
}));
$('#check-shortcuts').addEventListener('click', () => { showShortcutError(); void checkShortcutDraft(); });
$('#shortcuts-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (recording || captureRequests || shortcutChecking || shortcutSaving || (!shortcutsDirty() && !shortcutsNeedActivation())) return;
  shortcutSaving = true;
  showShortcutError();
  renderShortcuts();
  try {
    const checked = await checkShortcutDraft();
    if (!checked || shortcutErrors()) throw new Error(t('快捷键尚未保存，请先解决冲突。'));
    const result = await api.saveSettings({ shortcuts: checked.bindings });
    if (!result.ok) {
      if (result.shortcutStatus) shortcutStatus = result.shortcutStatus;
      throw new Error(`${result.error || ''} ${t('快捷键未保存，原设置仍然生效。')}`.trim());
    }
    settings = result.value;
    shortcutDraft = shortcutBindings(settings.shortcuts);
    shortcutStatus = settings.shortcutStatus || {};
    shortcutsSaved = true;
    renderSettings();
  } catch (error) { showShortcutError(error.message); }
  finally { shortcutSaving = false; renderShortcuts(); }
});
window.addEventListener('blur', () => { void cancelRecording(); });
window.addEventListener('beforeunload', () => { void cancelRecording(); });

function selectTab(tab) {
  const name = ['general', 'work', 'shortcuts', 'advanced'].includes(tab) ? tab : 'general';
  if (currentTab !== name) void cancelRecording();
  currentTab = name;
  document.querySelectorAll('[data-tab]').forEach(button => {
    button.classList.toggle('selected', button.dataset.tab === name);
    button.setAttribute('aria-current', button.dataset.tab === name ? 'page' : 'false');
  });
  document.querySelectorAll('.settings-panel').forEach(panel => { panel.hidden = panel.id !== `panel-${name}`; });
  $('.settings-content').scrollTop = 0;
  $('#settings-error').hidden = true;
  $('#settings-feedback').hidden = name === 'shortcuts';
}

function renderSettings() {
  const languageChanged = shortcutLanguage && shortcutLanguage !== settings.language;
  shortcutLanguage = settings.language;
  setLanguage(settings.language);
  document.title = t('拾光 · 设置');
  document.documentElement.dataset.theme = settings.theme;
  $('#launch-at-login').checked = settings.launchAtLogin;
  $('#target-hours').value = Math.floor(settings.targetMinutes / 60);
  $('#target-minutes').value = settings.targetMinutes % 60;
  $('#data-directory').textContent = settings.dataDirectory;
  $('#version').textContent = `${t('拾光')} ${settings.appVersion}`;
  $('#language').value = settings.language;
  $('#week-start').value = settings.weekStart;
  $('#author').textContent = settings.author;
  $('#application-path').textContent = settings.applicationPath;
  document.querySelectorAll('[data-theme-choice]').forEach(button => {
    const selected = button.dataset.themeChoice === settings.theme;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  const warning = settings.startupError || (settings.launchAtLogin && !settings.startupEnabled ? t('Windows 已暂停此启动项。可以关闭后重新开启，或在 Windows 启动应用中启用拾光。') : '');
  $('#startup-warning').textContent = warning;
  $('#startup-warning').hidden = !warning;
  updateTargetPreview();
  renderShortcuts();
  if (languageChanged) void refreshShortcutLanguage();
}

async function refreshShortcutLanguage() {
  const generation = ++shortcutLanguageGeneration;
  showShortcutError();
  try {
    const latest = await api.getSettings();
    if (generation !== shortcutLanguageGeneration || latest.language !== settings.language) return;
    settings.shortcutStatus = latest.shortcutStatus;
    if (!shortcutsDirty()) shortcutStatus = latest.shortcutStatus;
    renderShortcuts();
    await captureQueue;
    if (generation === shortcutLanguageGeneration && !recording) await checkShortcutDraft();
  } catch (error) {
    if (generation === shortcutLanguageGeneration) showShortcutError(error.message);
  }
}

function updateTargetPreview() {
  const minutes = Number($('#target-hours').value) * 60 + Number($('#target-minutes').value);
  $('#target-preview').textContent = minutes >= 1 && minutes <= 1440 ? t('{target}，点亮完整一圈。', { target: targetLabel(minutes, settings.language) }) : t('目标可设为 1 分钟至 24 小时。');
}

async function action(operation, successMessage, button) {
  $('#settings-error').hidden = true;
  $('#settings-feedback').textContent = '';
  if (button) button.disabled = true;
  try {
    const result = await operation();
    if (!result.ok) throw new Error(result.error);
    if (result.value === null) return;
    if (result.value?.targetMinutes) { settings = result.value; renderSettings(); }
    const hasStartupWarning = result.value?.startupError || (result.value?.launchAtLogin && !result.value?.startupEnabled);
    $('#settings-feedback').textContent = t(hasStartupWarning ? '设置已保存，开机启动状态见上方提示' : successMessage);
  } catch (error) {
    $('#settings-error').textContent = error.message; $('#settings-error').hidden = false;
    $('#launch-at-login').checked = settings.launchAtLogin;
  } finally { if (button) button.disabled = false; }
}

document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => selectTab(button.dataset.tab)));
document.querySelectorAll('[data-theme-choice]').forEach(button => button.addEventListener('click', () => action(() => api.saveSettings({ theme: button.dataset.themeChoice }), '主题已应用到所有窗口', button)));
$('#launch-at-login').addEventListener('change', event => action(() => api.saveSettings({ launchAtLogin: event.target.checked }), '开机启动设置已保存', event.target));
$('#language').addEventListener('change', event => action(() => api.saveSettings({ language: event.target.value }), '界面语言已保存', event.target));
$('#week-start').addEventListener('change', event => action(() => api.saveSettings({ weekStart: Number(event.target.value) }), '每周起始日已保存', event.target));
$('#target-form').addEventListener('input', updateTargetPreview);
$('#target-form').addEventListener('submit', event => {
  event.preventDefault();
  const targetMinutes = Number($('#target-hours').value) * 60 + Number($('#target-minutes').value);
  action(() => api.saveSettings({ targetMinutes }), '圆环目标已保存，日历已更新', $('#save-target'));
});
$('#change-directory').addEventListener('click', () => action(() => api.chooseDataDirectory(), '数据已复制到新位置，原文件已保留', $('#change-directory')));
$('#open-directory').addEventListener('click', () => action(() => api.openDataDirectory(), '已打开数据文件夹', $('#open-directory')));
$('#show-application').addEventListener('click', () => action(() => api.showApplication(), '已打开程序所在文件夹', $('#show-application')));
$('#export-data').addEventListener('click', () => action(() => api.exportData(), '工时备份已导出', $('#export-data')));
$('#close-settings').addEventListener('click', async () => { await cancelRecording(); api.closeSettings(); });
document.addEventListener('keydown', async event => { if (event.key === 'Escape') { await cancelRecording(); api.closeSettings(); } });
api.onState(state => {
  document.documentElement.dataset.theme = state.settings.theme;
  if (settings && (state.settings.language !== settings.language || state.settings.weekStart !== settings.weekStart)) {
    settings = { ...settings, ...state.settings }; renderSettings();
  }
});
api.onSettingsOpened(selectTab);
settings = await api.getSettings();
renderSettings();
selectTab(new URLSearchParams(location.search).get('tab'));
