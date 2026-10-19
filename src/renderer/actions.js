import { setLanguage, t } from './i18n.mjs';
const api = window.shiguang, $ = value => document.querySelector(value);
let state;
function render(next) {
  state = next; setLanguage(next.settings.language);
  document.documentElement.dataset.theme = next.settings.theme;
  const paused = next.mode === 'paused';
  $('#bubble-title').textContent = t(paused ? '准备回来啦？' : '休息一下？');
  $('#bubble-caption').textContent = t(paused ? '工时已暂停，慢慢来。' : '休息也很重要，选一个吧。');
  $('#pause-label').textContent = t(paused ? '继续工作' : '临时离开');
  $('#pause-hint').textContent = t(paused ? '继续累计工时' : '暂停计时');
  $('#pause-resume').classList.toggle('resume', paused);
  $('#action-icon').setAttribute('d', paused ? 'm8 5 10 7-10 7Z' : 'M8 5v14M16 5v14');
  if (next.mode === 'idle') api.closeActions();
}
async function choose(mode) {
  const result = await api.setMode(mode);
  if (result.ok) api.closeActions();
  else { $('#action-error').hidden = false; $('#action-error').textContent = result.error; }
}
$('#pause-resume').addEventListener('click', () => choose(state.mode === 'paused' ? 'working' : 'paused'));
$('#clock-out').addEventListener('click', () => choose('idle'));
$('#dismiss').addEventListener('click', () => api.closeActions());
document.addEventListener('keydown', event => { if (event.key === 'Escape') api.closeActions(); });
api.onState(render); render(await api.getState());
