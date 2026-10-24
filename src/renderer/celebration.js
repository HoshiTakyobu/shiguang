import { setLanguage, t } from './i18n.mjs';
import { formatAmount } from './shared.mjs';
const api = window.shiguang, data = await api.getCelebration();
const $ = selector => document.querySelector(selector);
if (!data) throw new Error('No milestone to display');
setLanguage(data.language);
document.title = t('拾光 · 月度里程碑');
document.documentElement.dataset.theme = data.theme;
const milestone = data.achievedMilestone, bonus = milestone.bonusIndex > 0, threshold = milestone.hours;
$('#celebration-month').textContent = `${data.month.replace('-', ' / ')} · ${t('月度里程碑')}`;
$('#preview-label').hidden = !data.preview;
$('#award-ribbon').textContent = bonus ? 'BONUS UNLOCKED' : 'MONTHLY GOAL';
$('#celebration-title').textContent = t('{hours} 小时，真的做到了！', { hours: threshold });
$('#celebration-subtitle').textContent = t(bonus ? 'Bonus 门槛已达成，为坚持到这里的自己鼓个掌。' : '基础目标已达成，这个月的努力有了新的刻度。');
$('#reward-tier').textContent = bonus && data.bonuses.length > 1 ? t('Bonus {number} 奖励档', { number: milestone.bonusIndex }) : t(bonus ? 'Bonus 奖励档' : '基础达标');
$('#reward-amount').textContent = formatAmount(data.estimatedAmount);
$('#achieved-hours').textContent = `${data.totalHours.toFixed(1)} h`;
$('#achieved-base').textContent = `${data.baseHours} h`;
$('#achieved-bonus').textContent = `${threshold} h`;
$('#achieved-bonus-block').hidden = !bonus;
for (const id of ['#dismiss-celebration', '#close-celebration']) $(id).addEventListener('click', () => api.closeCelebration());
document.addEventListener('keydown', event => { if (event.key === 'Escape') api.closeCelebration(); });
const canvas = $('#confetti'), context = canvas.getContext('2d');
let frame = 0;
function celebrate() {
  cancelAnimationFrame(frame);
  const width = canvas.clientWidth, height = canvas.clientHeight, scale = devicePixelRatio;
  canvas.width = width * scale; canvas.height = height * scale; context.setTransform(scale, 0, 0, scale, 0, 0);
  context.clearRect(0, 0, width, height);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#9bbd8b', '#c5b1dc', '#edc780', '#92bac3', '#e6a397', '#c1cd84'];
  const particles = Array.from({ length: 145 }, (_, i) => ({ x: Math.random() * width, y: -20 - Math.random() * height,
    speed: 0.08 + Math.random() * 0.09, phase: Math.random() * Math.PI * 2, angle: Math.random() * 6, size: 4 + Math.random() * 5,
    color: colors[i % colors.length], ribbon: i % 4 === 0 }));
  const started = performance.now(); let previous = started;
  function draw(now) {
    const delta = Math.min(40, now - previous); previous = now;
    context.clearRect(0, 0, width, height);
    for (const p of particles) {
      p.y += delta * p.speed; p.angle += delta * .002;
      context.save(); context.translate(p.x + Math.sin(now / 800 + p.phase) * 25, p.y); context.rotate(p.angle);
      context.globalAlpha = Math.min(1, Math.max(0, (7200 - (now - started)) / 1200)); context.fillStyle = p.color;
      context.fillRect(-p.size / 2, -p.size / 2, p.ribbon ? p.size / 2 : p.size, p.ribbon ? p.size * 2 : p.size * .6); context.restore();
    }
    if (now - started < 7200) frame = requestAnimationFrame(draw); else context.clearRect(0, 0, width, height);
  }
  frame = requestAnimationFrame(draw);
}
$('#replay-confetti').addEventListener('click', celebrate);
window.addEventListener('beforeunload', () => cancelAnimationFrame(frame));
await document.fonts.ready;
celebrate();
