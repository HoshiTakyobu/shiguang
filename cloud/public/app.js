import { projectState, formatTime, amount } from './view-model.mjs';
const $ = selector => document.querySelector(selector);
let events, packet, receivedAt, connected = false;
async function api(url, options) { const response = await fetch(url, { credentials: 'same-origin', ...options }); const value = await response.json(); if (!response.ok) throw new Error(value.error || '暂时无法连接'); return value; }
function showLogin() { events?.close(); events = null; packet = null; $('#login').hidden = false; $('#dashboard').hidden = true; $('#logout').hidden = true; $('#initial-status').hidden = true; }
function render() {
  const data = projectState(connected ? packet : packet && { ...packet, online: false }, receivedAt ? performance.now() - receivedAt : 0);
  if (!data) { $('#connection-status').textContent = connected ? '等待电脑连接' : '正在连接'; return; }
  const live = connected && data.online;
  $('#connection-status').textContent = live ? '电脑在线' : connected ? '电脑离线' : '正在重连云端';
  $('#connection-dot').dataset.online = String(live);
  const age = Math.floor(data.age / 1000);
  $('#last-sync').textContent = age < 5 ? '刚刚同步' : age < 60 ? `${age} 秒前同步` : age < 3600 ? `${Math.floor(age / 60)} 分钟前同步` : `${Math.floor(age / 3600)} 小时前同步`;
  $('#today-label').textContent = `${data.todayKey.replaceAll('-', ' / ')} · TODAY`;
  $('#work-mode').textContent = { working: '上班中', paused: '已暂停', idle: '已下班' }[data.mode];
  $('#today-clock').textContent = formatTime(data.todayMs);
  $('#today-note').textContent = !live ? '显示最后同步的工时，等待电脑重新连接。' : data.mode === 'working' ? '时间正在积攒，今天也在好好努力。' : data.mode === 'paused' ? '休息一下吧，暂停期间不累计工时。' : '这一段努力已经记下，辛苦啦。';
  $('#month-label').textContent = `${data.month.replace('-', ' 年 ')} 月累计`;
  $('#month-hours').textContent = (data.monthMs / 3600000).toFixed(1);
  const progress = Math.min(100, data.monthMs / (data.target * 3600000) * 100);
  $('#progress-fill').style.width = `${progress}%`; $('#progress').setAttribute('aria-valuenow', progress.toFixed(2));
  const bonusLabel = tier => data.milestones.length > 2 ? `Bonus ${tier.bonusIndex}` : 'Bonus';
  $('#goal-note').textContent = data.remaining > 0 ? `再积攒 ${(Math.ceil(data.remaining / 36000) / 100).toFixed(2)} 小时，${data.targetMilestone.bonusIndex ? `解锁 ${bonusLabel(data.targetMilestone)}` : '达成基础目标'}。` : '本月目标已达成，你的努力值得庆祝。';
  $('#milestones').replaceChildren(...data.milestones.map(tier => {
    const card = document.createElement('div'); card.dataset.tier = tier.id; card.dataset.reached = String(tier.reached); card.dataset.bonus = String(tier.bonusIndex > 0);
    const badge = document.createElement('span'); badge.textContent = `${tier.reached ? '✓' : tier.bonusIndex ? '✧' : '○'} ${tier.bonusIndex ? `${bonusLabel(tier)} 奖励档` : '基础达标'}`;
    const hours = document.createElement('strong'); hours.textContent = `${tier.hours} h`;
    const income = document.createElement('small'); income.textContent = `CNY ${amount(tier.amount)}/月`;
    card.append(badge, hours, income); return card;
  }));
  $('#income-label').textContent = data.remaining > 0 ? '下一档达标后有望获得' : '本月有望获得';
  $('#income').replaceChildren(document.createTextNode(`CNY ${amount(data.amount)}`)); const unit = document.createElement('small'); unit.textContent = '/月'; $('#income').append(unit);
  $('#offline-note').hidden = live;
}
function showDashboard() {
  $('#login').hidden = true; $('#dashboard').hidden = false; $('#logout').hidden = false; $('#initial-status').hidden = true;
  events?.close(); events = new EventSource('/api/events');
  events.onopen = () => { connected = true; render(); };
  events.onmessage = event => { packet = JSON.parse(event.data); receivedAt = performance.now(); connected = true; render(); };
  events.onerror = async () => { connected = false; render(); try { if (!(await api('/api/session')).loggedIn) showLogin(); } catch { /* EventSource retries when the connection returns. */ } };
}
$('#login-form').addEventListener('submit', async event => {
  event.preventDefault(); $('#login-button').disabled = true; $('#login-error').hidden = true;
  try { await api('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('#password').value }) }); $('#password').value = ''; showDashboard(); }
  catch (error) { $('#login-error').textContent = error.message; $('#login-error').hidden = false; }
  finally { $('#login-button').disabled = false; }
});
$('#logout').addEventListener('click', async () => { try { await api('/api/logout', { method: 'POST' }); showLogin(); } catch { $('#connection-status').textContent = '退出失败，请检查网络后重试'; } });
setInterval(render, 1000);
try { if ((await api('/api/session')).loggedIn) showDashboard(); else showLogin(); } catch { showLogin(); $('#login-error').textContent = '暂时连接不到服务器，请稍后刷新。'; $('#login-error').hidden = false; }
