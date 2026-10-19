import { formatTime } from './shared.mjs';
import { setLanguage, t } from './i18n.mjs';
import { createSplitChoices } from './split-choices.mjs';

const api = window.shiguang;
const orb = document.querySelector('#orb');
let clickTimer, state, down, moved = false;
const choicesRoot = document.querySelector('#orb-choices');
const actionError = document.querySelector('#action-error');
const choices = createSplitChoices(choicesRoot, {
  async choose(mode) {
    actionError.hidden = true;
    try {
      const result = await api.setMode(mode);
      if (!result.ok) throw new Error(result.error);
      render(result.value);
    } catch (error) { actionError.hidden = false; actionError.textContent = error.message; }
  },
  cancel: () => api.closeActions()
});

function render(next) {
  const wasChoosing = !choicesRoot.hidden;
  state = next;
  setLanguage(next.settings.language);
  document.documentElement.dataset.dock = next.docked || '';
  document.documentElement.dataset.theme = next.settings.theme;
  orb.classList.toggle('working', next.active);
  orb.classList.toggle('paused', next.mode === 'paused');
  document.querySelector('#status').textContent = t({ working: '上班中', paused: '已暂停', idle: '下班啦' }[next.mode]);
  document.querySelector('#action').textContent = t({ working: '休息一下？', paused: '回来或收工？', idle: '签到' }[next.mode]);
  document.querySelector('#time').textContent = formatTime(next.days[next.today] || 0);
  document.querySelector('#save-warning').hidden = !next.storageError;
  orb.title = next.storageError || (next.docked ? t('在这里陪你 · 点击展开 · 拖出恢复') : t('今日 {time} · 单击操作 · 双击日历 · 拖动贴边', { time: formatTime(next.days[next.today] || 0) }));
  orb.setAttribute('aria-label', `${document.querySelector('#status').textContent} · ${orb.title}`);
  const choosing = next.actionsOpen && !next.docked && next.mode !== 'idle';
  orb.hidden = choosing;
  choicesRoot.hidden = !choosing;
  choices.render(next);
  if (choosing && !wasChoosing) { clearTimeout(clickTimer); choices.focus(); }
  if (!choosing && wasChoosing) { actionError.hidden = true; orb.focus({ preventScroll: true }); }
}

orb.addEventListener('click', (event) => {
  if (moved) { moved = false; return; }
  clearTimeout(clickTimer);
  if (event.detail > 1) return;
  clickTimer = setTimeout(async () => render(await api.activateOrb()), state?.doubleClickMs || 550);
});
orb.addEventListener('dblclick', () => {
  clearTimeout(clickTimer);
  if (!moved) api.openCalendar();
});
orb.addEventListener('contextmenu', (event) => { event.preventDefault(); clearTimeout(clickTimer); api.showMenu(); });
orb.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  down = { x: event.screenX, y: event.screenY };
  moved = false;
  orb.setPointerCapture(event.pointerId);
  api.dragStart();
});
orb.addEventListener('pointermove', (event) => {
  if (!down) return;
  if (Math.hypot(event.screenX - down.x, event.screenY - down.y) > 5) moved = true;
  if (moved) {
    clearTimeout(clickTimer);
    orb.classList.add('dragging');
    api.dragMove();
  }
});
function endDrag(event) {
  if (!down) return;
  down = null;
  orb.classList.remove('dragging');
  if (orb.hasPointerCapture(event.pointerId)) orb.releasePointerCapture(event.pointerId);
  api.dragEnd();
}
orb.addEventListener('pointerup', endDrag);
orb.addEventListener('pointercancel', (event) => { clearTimeout(clickTimer); moved = true; endDrag(event); });
orb.addEventListener('lostpointercapture', endDrag);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { clearTimeout(clickTimer); api.closeActions(); }
  if (event.key.toLowerCase() === 'c') { clearTimeout(clickTimer); api.openCalendar(); }
});
choicesRoot.addEventListener('contextmenu', event => { event.preventDefault(); api.closeActions(); api.showMenu(); });
api.onState(render);
api.onOrbLayout(({ side }) => { if (state) state.docked = side; document.documentElement.dataset.dock = side || ''; });
api.onOrbLook(({ x, y }) => { document.documentElement.style.setProperty('--look-x', `${x}px`); document.documentElement.style.setProperty('--look-y', `${y}px`); });
render(await api.getState());
