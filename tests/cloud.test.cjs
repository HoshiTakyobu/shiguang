const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createServer, hashPassword } = require('../cloud/server.cjs');
const { sharedState, validateSharedState } = require('../src/share-protocol.cjs');
const { monthSummary } = require('../src/monthly.cjs');
const { CloudSync, endpoint } = require('../src/cloud-sync.cjs');
function sample(mode = 'working', now = new Date(2026, 9, 24, 12).getTime()) {
  const d = new Date(now), today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const days = { [today]: 4 * 3600000 };
  return { mode, now, today, days, monthly: monthSummary(days, now), secret: 'never-share', path: 'private/path' };
}
async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shiguang-cloud-test-'));
  const config = { storageFile: path.join(directory, 'state.json'), publicUrl: 'http://127.0.0.1', writeToken: crypto.randomBytes(32).toString('base64url'), passwordHash: await hashPassword('private-view-password'), sessionSecret: crypto.randomBytes(32).toString('hex') };
  const server = createServer(config); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); });
  const login = async () => {
    const response = await fetch(`${base}/api/login`, { method: 'POST', headers: { Origin: config.publicUrl, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'private-view-password' }) });
    assert.equal(response.status, 200); return response.headers.get('set-cookie');
  };
  return { directory, config, server, base, login };
}
test('only an authenticated viewer can read; only the independent writer key can publish', async t => {
  const f = await fixture(t), outgoing = sharedState(sample());
  assert.equal((await fetch(`${f.base}/api/state`)).status, 401);
  assert.equal((await fetch(`${f.base}/api/push`, { method: 'POST', body: JSON.stringify(outgoing) })).status, 401);
  const cookie = await f.login(); assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
  assert.equal((await fetch(`${f.base}/api/push`, { method: 'POST', headers: { Cookie: cookie }, body: JSON.stringify(outgoing) })).status, 401);
  assert.equal((await fetch(`${f.base}/api/push`, { method: 'POST', headers: { Authorization: `Bearer ${f.config.writeToken}` }, body: JSON.stringify({ ...outgoing, filePath: 'private', token: 'secret' }) })).status, 200);
  const viewed = await (await fetch(`${f.base}/api/state`, { headers: { Cookie: cookie } })).json();
  assert.equal(viewed.online, true); assert.equal(viewed.state.todayMs, 4 * 3600000); assert.equal(viewed.state.filePath, undefined); assert.equal(viewed.state.token, undefined);
  assert.equal(fs.readFileSync(f.config.storageFile, 'utf8').includes('private'), false);
  assert.equal((await fetch(`${f.base}/api/state`, { headers: { Cookie: cookie.replace('shiguang_session=', 'shiguang_session=x') } })).status, 401);
});
test('browser login rejects cross-origin requests and rate-limits password guesses', async t => {
  const f = await fixture(t);
  assert.equal((await fetch(`${f.base}/api/login`, { method: 'POST', headers: { Origin: 'https://untrusted.example' }, body: '{}' })).status, 403);
  for (let i = 0; i < 8; i++) assert.equal((await fetch(`${f.base}/api/login`, { method: 'POST', headers: { Origin: f.config.publicUrl }, body: JSON.stringify({ password: 'incorrect' }) })).status, 401);
  assert.equal((await fetch(`${f.base}/api/login`, { method: 'POST', headers: { Origin: f.config.publicUrl }, body: JSON.stringify({ password: 'incorrect' }) })).status, 429);
});
test('desktop sync encrypts its key, strips local history, and disconnects without stopping the local clock', async t => {
  const f = await fixture(t), key = crypto.randomBytes(32), iv = crypto.randomBytes(16);
  const encryption = { isEncryptionAvailable: () => true, encryptString: value => { const c = crypto.createCipheriv('aes-256-ctr', key, iv); return Buffer.concat([c.update(value), c.final()]); }, decryptString: value => { const c = crypto.createDecipheriv('aes-256-ctr', key, iv); return Buffer.concat([c.update(value), c.final()]).toString(); } };
  const original = sample(); const sync = new CloudSync(f.directory, encryption, () => original, { allowLocal: true });
  t.after(() => sync.dispose());
  const configured = await sync.configure({ enabled: true, endpoint: f.base, token: f.config.writeToken });
  assert.equal(configured.status, 'connected'); assert.equal(configured.token, undefined);
  assert.ok(!fs.readFileSync(sync.file, 'utf8').includes(f.config.writeToken));
  const loaded = new CloudSync(f.directory, encryption, () => original, { allowLocal: true }); assert.equal(loaded.snapshot().hasToken, true);
  const cookie = await f.login();
  const stream = await fetch(`${f.base}/api/events`, { headers: { Cookie: cookie } }); const reader = stream.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /"online":true/); await reader.cancel();
  await sync.configure({ enabled: false, endpoint: f.base, token: '' }); await sync.disconnect();
  const value = await (await fetch(`${f.base}/api/state`, { headers: { Cookie: cookie } })).json(); assert.equal(value.online, false);
  assert.equal(original.mode, 'working'); assert.equal(original.days[original.today], 4 * 3600000);
  assert.throws(() => endpoint('http://example.com')); assert.throws(() => endpoint('https://user:key@example.com'));
});
test('invalid snapshots and failed atomic saves preserve the previous shared state', async t => {
  const f = await fixture(t), headers = { Authorization: `Bearer ${f.config.writeToken}` };
  const outgoing = sharedState(sample());
  assert.equal((await fetch(`${f.base}/api/push`, { method: 'POST', headers, body: JSON.stringify({ ...outgoing, todayMs: -1 }) })).status, 400);
  fs.mkdirSync(f.config.storageFile);
  assert.equal((await fetch(`${f.base}/api/push`, { method: 'POST', headers, body: JSON.stringify(outgoing) })).status, 503);
  const cookie = await f.login(); assert.equal((await (await fetch(`${f.base}/api/state`, { headers: { Cookie: cookie } })).json()).state, null);
});
test('phone display freezes offline snapshots and handles midnight, month rollover, and the daily cap', async () => {
  const { projectState } = await import('../cloud/public/view-model.mjs');
  let outgoing = sharedState(sample('working', new Date(2026, 9, 31, 23, 59, 59).getTime()));
  const packet = { state: { ...outgoing, receivedAt: 1000 }, serverNow: 1000, online: true, offlineAfter: 20000 };
  const next = projectState(packet, 2000); assert.equal(next.todayMs, 1000); assert.equal(next.monthMs, 1000); assert.equal(next.month, '2026-11');
  const offline = projectState(packet, 21000); assert.equal(offline.online, false); assert.equal(offline.todayMs, outgoing.todayMs);
  const paused = projectState({ ...packet, state: { ...packet.state, mode: 'paused' } }, 1000); assert.equal(paused.todayMs, outgoing.todayMs);
  outgoing = sharedState(sample()); outgoing.todayMs = 86400000; outgoing.monthMs = 86400000;
  const capped = projectState({ ...packet, state: { ...outgoing, receivedAt: 1000 } }, 1000); assert.equal(capped.monthMs, 86400000);
});

test('shared goals preserve all Bonus tiers, migrate old packets, and strip tier metadata', () => {
  const outgoing = sharedState(sample());
  const bonuses = [
    { id: 'bonus-1', hours: 200, amount: 1600, privatePath: 'never-share' },
    { id: 'bonus-2', hours: 240, amount: 2200 },
    { id: 'bonus-3', hours: 280, amount: 3000 }
  ];
  const canonical = validateSharedState({ ...outgoing, goals: { ...outgoing.goals, bonuses, celebrations: true } });
  assert.deepEqual(canonical.goals.bonuses, bonuses.map(({ id, hours, amount }) => ({ id, hours, amount })));
  assert.equal(canonical.goals.celebrations, undefined);
  assert.equal(JSON.stringify(canonical).includes('never-share'), false);
  const legacy = { baseHours: 160, baseAmount: 800, bonusEnabled: true, bonusHours: 210, bonusAmount: 1700, currency: 'CNY' };
  assert.deepEqual(validateSharedState({ ...outgoing, goals: legacy }).goals.bonuses, [{ id: 'bonus-1', hours: 210, amount: 1700 }]);
  assert.deepEqual(validateSharedState({ ...outgoing, goals: { ...outgoing.goals, bonuses: [] } }).goals.bonuses, []);
  for (const invalid of [null, {}, [{ id: 'base', hours: 200, amount: 1600 }], [{ id: 'unsafe<script>', hours: 200, amount: 1600 }],
    [{ id: 'b', hours: 200.001, amount: 1600 }], [{ id: 'b', hours: 200, amount: -1 }],
    [{ id: 'b', hours: 160, amount: 1600 }], [{ id: 'b', hours: 200, amount: 700 }],
    [{ id: 'b', hours: 200, amount: 1600 }, { id: 'b', hours: 240, amount: 2000 }],
    [{ id: 'b', hours: 240, amount: 2000 }, { id: 'c', hours: 220, amount: 2200 }],
    [{ id: 'b', hours: 200, amount: 1600 }, { id: 'c', hours: 240, amount: 1500 }]]) {
    assert.throws(() => validateSharedState({ ...outgoing, goals: { ...outgoing.goals, bonuses: invalid } }), /Invalid shared state/);
  }
});

test('phone targets each next Bonus and its monthly total at exact thresholds', async () => {
  const { projectState } = await import('../cloud/public/view-model.mjs');
  const outgoing = sharedState(sample('paused'));
  outgoing.goals.bonuses = [{ id: 'bonus-1', hours: 200, amount: 1600 }, { id: 'bonus-2', hours: 240, amount: 2200 }, { id: 'bonus-3', hours: 280, amount: 3000 }];
  const project = (hours, goals = outgoing.goals) => projectState({ state: { ...outgoing, goals, monthMs: hours * 3600000, receivedAt: 1000 }, serverNow: 1000, online: true, offlineAfter: 20000 });
  const cases = [[159.99, 'base', 800, 0], [160, 'bonus-1', 1600, 1], [200, 'bonus-2', 2200, 2], [240, 'bonus-3', 3000, 3], [280, 'bonus-3', 3000, 4]];
  for (const [hours, id, income, reached] of cases) {
    const actual = project(hours); assert.equal(actual.targetMilestone.id, id); assert.equal(actual.amount, income);
    assert.equal(actual.milestones.filter(tier => tier.reached).length, reached); assert.equal(actual.allReached, hours >= 280);
  }
  assert.equal(project(200).remaining, 40 * 3600000);
  assert.equal(project(300).remaining, 0);
  assert.equal(project(200).achievedMilestone.id, 'bonus-1');
  assert.equal(project(200, { ...outgoing.goals, bonusEnabled: false }).milestones.length, 1);
  assert.equal(project(200, { ...outgoing.goals, bonuses: [] }).amount, 800);
  const decimalThreshold = projectState({ state: { ...outgoing, goals: { ...outgoing.goals, baseHours: 1, bonuses: [{ id: 'bonus-1', hours: 1.08, amount: 1600 }] },
    monthMs: 3888000, receivedAt: 1000 }, serverNow: 1000, online: true, offlineAfter: 20000 });
  assert.equal(decimalThreshold.allReached, true); assert.equal(decimalThreshold.remaining, 0);
});
