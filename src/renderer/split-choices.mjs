import { t } from './i18n.mjs';

const face = `<svg class="duel-face" viewBox="0 0 60 35" aria-hidden="true">
  <ellipse class="blush" cx="9" cy="25" rx="6" ry="3"/><ellipse class="blush" cx="51" cy="25" rx="6" ry="3"/>
  <path class="eyebrow" d="M13 6q5-2 10 1M37 7q5-3 10-1"/>
  <ellipse class="eye-white" cx="19" cy="16" rx="5.5" ry="7"/><ellipse class="eye-white" cx="41" cy="16" rx="5.5" ry="7"/>
  <g class="pupils"><ellipse cx="19" cy="16" rx="2.8" ry="4.3"/><ellipse cx="41" cy="16" rx="2.8" ry="4.3"/><circle class="eye-spark" cx="19.8" cy="14.7" r=".9"/><circle class="eye-spark" cx="41.8" cy="14.7" r=".9"/></g>
  <path class="smile" d="M24 25q6 8 12 0"/>
</svg>`;

// Both the desktop orb and calendar use the same semantic action pair.
export function createSplitChoices(root, { choose, cancel }) {
  root.classList.add('split-choices');
  root.setAttribute('role', 'group');
  root.innerHTML = `<button type="button" class="split-choice primary-choice" data-choice="primary"><span class="choice-content">${face}<strong></strong></span></button>
    <button type="button" class="split-choice finish-choice" data-choice="finish"><span class="choice-content">${face}<strong></strong></span></button>
    <button type="button" class="split-cancel" data-choice="cancel"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8m0-8-8 8"/></svg></button>`;
  const primary = root.querySelector('[data-choice="primary"]');
  const finish = root.querySelector('[data-choice="finish"]');
  const dismiss = root.querySelector('[data-choice="cancel"]');
  let mode = 'working', busy = false;
  const select = async next => {
    if (busy) return;
    busy = true;
    primary.disabled = finish.disabled = true;
    try { await choose(next); }
    finally { busy = false; primary.disabled = finish.disabled = false; }
  };
  primary.addEventListener('click', () => select(mode === 'paused' ? 'working' : 'paused'));
  finish.addEventListener('click', () => select('idle'));
  dismiss.addEventListener('click', cancel);
  return {
    render(next) {
      mode = next.mode;
      root.dataset.mode = mode;
      root.setAttribute('aria-label', t('选择操作'));
      const label = t(mode === 'paused' ? '我回来了' : '我先溜会');
      primary.querySelector('strong').textContent = label;
      primary.setAttribute('aria-label', `${label} · ${t(mode === 'paused' ? '继续累计工时' : '暂停计时')}`);
      finish.querySelector('strong').textContent = t('我要下班');
      finish.setAttribute('aria-label', `${t('我要下班')} · ${t('结束本次工作')}`);
      dismiss.setAttribute('aria-label', t('取消'));
      dismiss.title = `${t('取消')} · Esc`;
    },
    focus() { primary.focus({ preventScroll: true }); }
  };
}
