import { targetLabel } from './shared.mjs';
import { setLanguage, t } from './i18n.mjs';

const api = window.shiguang;
const $ = selector => document.querySelector(selector);
let settings;

function selectTab(tab) {
  const name = ['general', 'work', 'advanced'].includes(tab) ? tab : 'general';
  document.querySelectorAll('[data-tab]').forEach(button => {
    button.classList.toggle('selected', button.dataset.tab === name);
    button.setAttribute('aria-current', button.dataset.tab === name ? 'page' : 'false');
  });
  document.querySelectorAll('.settings-panel').forEach(panel => { panel.hidden = panel.id !== `panel-${name}`; });
  $('.settings-content').scrollTop = 0;
  $('#settings-error').hidden = true;
}

function renderSettings() {
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
$('#close-settings').addEventListener('click', () => api.closeSettings());
document.addEventListener('keydown', event => { if (event.key === 'Escape') api.closeSettings(); });
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
