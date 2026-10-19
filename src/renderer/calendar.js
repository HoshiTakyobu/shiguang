import { formatTime, dateKey, monthWeeks, ringColor, targetLabel } from './shared.mjs';
import { setLanguage, t, weekdays } from './i18n.mjs';

const api = window.shiguang;
let state, shownYear, shownMonth, renderedMonth;
const dayElements = new Map();
const weekElements = [];
const englishMonths = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const $ = (selector) => document.querySelector(selector);
const circumference = 2 * Math.PI * 21;

function hours(ms) { return (ms / 3600000).toFixed(1).replace(/\.0$/, ''); }

function resetMonth() {
  if (!state) return;
  const now = new Date(state.now);
  shownYear = now.getFullYear();
  shownMonth = now.getMonth();
  render();
}

function buildCalendar() {
  const key = `${shownYear}-${shownMonth}-${state.settings.language}-${state.settings.weekStart}`;
  if (key === renderedMonth) return;
  renderedMonth = key;
  dayElements.clear();
  weekElements.length = 0;
  $('#month-title').textContent = state.settings.language === 'en' ? `${englishMonths[shownMonth]} ${shownYear}` : `${shownYear} 年 ${String(shownMonth + 1).padStart(2, '0')} 月`;
  $('#month-english').textContent = englishMonths[shownMonth];
  const grid = $('#calendar-grid');
  grid.replaceChildren();
  const heading = document.createElement('div');
  heading.className = 'week-row weekday-row';
  heading.setAttribute('role', 'row');
  const names = weekdays(true);
  heading.innerHTML = `<span class="week-heading" role="columnheader">${t('周工时')}</span>${Array.from({ length: 7 }, (_, i) => (i + state.settings.weekStart) % 7).map(day => `<span class="weekday ${[0, 6].includes(day) ? 'weekend' : ''}" role="columnheader">${names[day]}</span>`).join('')}`;
  grid.append(heading);
  const weeks = monthWeeks(shownYear, shownMonth, state.settings.weekStart);
  grid.dataset.weeks = weeks.length;
  weeks.forEach((dates) => {
    const row = document.createElement('div');
    row.className = 'week-row dates-row';
    row.setAttribute('role', 'row');
    const total = document.createElement('div');
    total.className = 'week-total';
    total.setAttribute('role', 'rowheader');
    total.innerHTML = '<strong>0</strong><span>h</span>';
    row.append(total);
    weekElements.push({ el: total, keys: dates.map(dateKey) });
    dates.forEach((date, index) => {
      const key = dateKey(date);
      const cell = document.createElement('div');
      cell.className = 'day-cell';
      cell.setAttribute('role', 'gridcell');
      const day = document.createElement('button');
      day.className = `day${date.getMonth() !== shownMonth ? ' other-month' : ''}${[0, 6].includes(date.getDay()) ? ' weekend' : ''}`;
      day.dataset.date = key;
      day.innerHTML = `<svg viewBox="0 0 52 52" aria-hidden="true"><circle class="ring-progress" cx="26" cy="26" r="21" stroke-dasharray="0 ${circumference}"/></svg><span class="date-number">${date.getDate()}</span>`;
      day.addEventListener('click', () => openEditor(key));
      dayElements.set(key, { el: day, ring: day.querySelector('.ring-progress') });
      cell.append(day);
      row.append(cell);
    });
    grid.append(row);
  });
}

function render() {
  if (!state || shownYear === undefined) return;
  if (document.documentElement.lang !== state.settings.language) { clearTimeout(toastTimer); $('#toast').hidden = true; }
  setLanguage(state.settings.language);
  document.title = t('拾光 · 工时日历');
  document.documentElement.dataset.theme = state.settings.theme;
  buildCalendar();
  const prefix = `${shownYear}-${String(shownMonth + 1).padStart(2, '0')}-`;
  const entries = Object.entries(state.days).filter(([key]) => key.startsWith(prefix));
  const monthTotal = entries.reduce((sum, [, ms]) => sum + ms, 0);
  $('#month-total').textContent = hours(monthTotal);
  $('#month-total').title = formatTime(monthTotal);
  $('#completed-days').textContent = entries.filter(([, ms]) => ms >= state.target).length;
  $('#today-time').textContent = formatTime(state.days[state.today] || 0);
  $('#work-status').textContent = t({ working: '上班中', paused: '已暂停', idle: '已下班' }[state.mode]);
  $('#live-dot').classList.toggle('active', state.active);
  $('#live-dot').classList.toggle('paused', state.mode === 'paused');
  $('#toggle-work').textContent = t(state.mode === 'idle' ? '签到' : state.mode === 'paused' ? '继续工作' : '选择操作');
  $('#target-description').textContent = t(' · 满 {target}', { target: targetLabel(state.settings.targetMinutes, state.settings.language) });
  $('.calendar-note').textContent = t('{day}开始 · 点击日期可补录', { day: weekdays(true)[state.settings.weekStart] });
  $('#work-dialog-title').textContent = t(state.mode === 'paused' ? '准备回来啦？' : '休息一下？');
  $('#work-pause-resume').textContent = t(state.mode === 'paused' ? '继续工作' : '临时离开');
  $('#legend-target').textContent = state.settings.targetMinutes % 60 === 0 ? `${state.settings.targetMinutes / 60}h` : `${state.settings.targetMinutes}min`;
  $('#storage-error').hidden = !state.storageError;
  $('#storage-error').textContent = state.storageError || '';
  const now = new Date(state.now);
  $('#go-today').hidden = shownYear === now.getFullYear() && shownMonth === now.getMonth();
  for (const [key, { el, ring }] of dayElements) {
    const ms = state.days[key] || 0;
    const progress = Math.min(1, ms / state.target);
    ring.setAttribute('stroke', ringColor(progress));
    ring.setAttribute('stroke-dasharray', `${progress * circumference} ${circumference}`);
    ring.style.opacity = progress === 0 ? '0' : '1';
    el.classList.toggle('is-today', key === state.today);
    el.classList.toggle('has-work', ms > 0);
    el.classList.toggle('is-future', key > state.today);
    el.classList.toggle('complete', progress === 1);
    el.setAttribute('aria-current', key === state.today ? 'date' : 'false');
    const title = `${key} · ${formatTime(ms)}${progress === 1 ? t(' · 已达到每日目标') : ''}${t(' · 点击补录')}`;
    el.title = title;
    el.setAttribute('aria-label', title);
  }
  for (const { el, keys } of weekElements) {
    const total = keys.reduce((sum, key) => sum + (state.days[key] || 0), 0);
    el.querySelector('strong').textContent = hours(total);
    el.classList.toggle('zero', total === 0);
    el.title = `${keys[0]} — ${keys[6]} · ${formatTime(total)}`;
    el.setAttribute('aria-label', t('本周总工时 {time}', { time: formatTime(total) }));
  }
  if ($('#edit-dialog').open) updateEditorPreview();
}

function openEditor(date) {
  $('#edit-form').reset();
  $('#edit-date').value = date;
  $('#edit-date').max = state.today;
  $('#edit-error').hidden = true;
  updateEditorPreview();
  $('#edit-dialog').showModal();
}

function editorMilliseconds() {
  return (Number($('#edit-hours').value) * 3600 + Number($('#edit-minutes').value) * 60 + Number($('#edit-seconds').value)) * 1000;
}

function updateEditorPreview() {
  const date = $('#edit-date').value;
  const current = state.days[date] || 0;
  const mode = $('input[name="mode"]:checked').value;
  $('#editor-current').textContent = formatTime(current);
  $('#edit-preview').textContent = t('保存后累计　{time}', { time: formatTime((mode === 'add' ? current : 0) + editorMilliseconds()) });
  $('#edit-live-hint').hidden = !(date === state.today && state.active);
}

let toastTimer;
function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message; $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 2600);
}

$('#edit-form').addEventListener('input', updateEditorPreview);
document.querySelectorAll('input[name="mode"]').forEach(input => input.addEventListener('change', () => {
  const seconds = input.value === 'replace' ? Math.floor((state.days[$('#edit-date').value] || 0) / 1000) : 0;
  $('#edit-hours').value = Math.floor(seconds / 3600);
  $('#edit-minutes').value = Math.floor(seconds / 60) % 60;
  $('#edit-seconds').value = seconds % 60;
  updateEditorPreview();
}));
$('#edit-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('#save-edit').disabled = true;
  $('#edit-error').hidden = true;
  try {
    const result = await api.adjustDay({ date: $('#edit-date').value, milliseconds: editorMilliseconds(), mode: $('input[name="mode"]:checked').value });
    if (!result.ok) throw new Error(result.error);
    state = result.value;
    $('#edit-dialog').close(); render(); toast(t('工时已保存'));
  } catch (error) {
    $('#edit-error').textContent = error.message; $('#edit-error').hidden = false;
  } finally { $('#save-edit').disabled = false; }
});
for (const id of ['cancel-edit', 'dismiss-edit']) $(`#${id}`).addEventListener('click', () => $('#edit-dialog').close());
$('#add-time').addEventListener('click', () => openEditor(state.today));
$('#open-settings').addEventListener('click', () => api.openSettings('general'));

function changeMonth(delta) {
  const date = new Date(shownYear, shownMonth + delta, 1);
  shownYear = date.getFullYear();
  shownMonth = date.getMonth();
  render();
}

$('#previous-month').addEventListener('click', () => changeMonth(-1));
$('#next-month').addEventListener('click', () => changeMonth(1));
$('#go-today').addEventListener('click', resetMonth);
$('#toggle-work').addEventListener('click', async () => {
  if (state.mode === 'idle') { const result = await api.setMode('working'); if (result.ok) { state = result.value; render(); } }
  else { $('#work-error').hidden = true; $('#work-dialog').showModal(); }
});
async function workAction(mode) {
  const result = await api.setMode(mode);
  if (result.ok) { state = result.value; $('#work-dialog').close(); render(); }
  else { $('#work-error').textContent = result.error; $('#work-error').hidden = false; }
}
$('#work-pause-resume').addEventListener('click', () => workAction(state.mode === 'paused' ? 'working' : 'paused'));
$('#work-finish').addEventListener('click', () => workAction('idle'));
$('#close-work-dialog').addEventListener('click', () => $('#work-dialog').close());
$('#close').addEventListener('click', () => api.closeCalendar());
$('#minimize').addEventListener('click', () => api.minimizeCalendar());
document.addEventListener('keydown', (event) => {
  if ($('#edit-dialog').open || $('#work-dialog').open) return;
  if (event.key === 'Escape') api.closeCalendar();
  if (event.key === 'ArrowLeft') { event.preventDefault(); changeMonth(-1); }
  if (event.key === 'ArrowRight') { event.preventDefault(); changeMonth(1); }
});
api.onCalendarOpened(resetMonth);
api.onState((next) => { state = next; if (shownYear === undefined) resetMonth(); else render(); });
state = await api.getState();
resetMonth();
