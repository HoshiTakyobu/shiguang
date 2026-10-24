const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { validateSharedState } = require('../src/share-protocol.cjs');
const scrypt = promisify(crypto.scrypt), SESSION_AGE = 7 * 24 * 3600000, OFFLINE_AFTER = 20000;
const equal = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
async function hashPassword(password) { const salt = crypto.randomBytes(16).toString('hex'); return `scrypt:${salt}:${(await scrypt(password, salt, 32)).toString('hex')}`; }
async function verifyPassword(password, hash) {
  const [algorithm, salt, encoded] = hash.split(':');
  if (algorithm !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{64}$/.test(encoded) || typeof password !== 'string' || password.length > 256) return false;
  return equal(await scrypt(password, salt, 32), Buffer.from(encoded, 'hex'));
}
function createServer(options) {
  const { storageFile, publicUrl, writeToken, passwordHash, sessionSecret, trustProxy = false } = options;
  const origin = new URL(publicUrl).origin, secure = new URL(publicUrl).protocol === 'https:';
  if (!secure && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(publicUrl).hostname)) throw new Error('PUBLIC_URL must use HTTPS');
  if (typeof writeToken !== 'string' || writeToken.length < 32 || typeof sessionSecret !== 'string' || sessionSecret.length < 32
    || !/^scrypt:[a-f0-9]{32}:[a-f0-9]{64}$/.test(passwordHash || '')) throw new Error('Configure strong credentials before starting the server');
  let latest = null, writeQueue = Promise.resolve(); const streams = new Set(), attempts = new Map();
  try { const stored = JSON.parse(fs.readFileSync(storageFile, 'utf8')); latest = { ...validateSharedState(stored), receivedAt: stored.receivedAt, connected: false }; } catch { /* A fresh relay waits for its first valid PC update. */ }
  const sign = value => crypto.createHmac('sha256', sessionSecret).update(value).digest('base64url');
  const cookie = (value, maxAge = SESSION_AGE / 1000) => `shiguang_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  function session(request) {
    const value = (request.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('shiguang_session='))?.slice(17);
    if (!value) return null;
    const [encoded, signature, extra] = value.split('.');
    if (!encoded || !signature || extra || !equal(signature, sign(encoded))) return null;
    try { const data = JSON.parse(Buffer.from(encoded, 'base64url')); return data.expiresAt > Date.now() ? data : null; } catch { return null; }
  }
  const view = () => ({ state: latest, online: Boolean(latest && latest.connected && Date.now() - latest.receivedAt < OFFLINE_AFTER), serverNow: Date.now(), offlineAfter: OFFLINE_AFTER });
  function broadcast() { const event = `data: ${JSON.stringify(view())}\n\n`; for (const response of streams) response.write(event); }
  async function save(value) {
    const task = writeQueue.then(async () => {
      await fs.promises.mkdir(path.dirname(storageFile), { recursive: true });
      await fs.promises.writeFile(`${storageFile}.tmp`, JSON.stringify(value), { mode: 0o600 });
      await fs.promises.rename(`${storageFile}.tmp`, storageFile); latest = value; broadcast();
    });
    writeQueue = task.catch(() => {}); return task;
  }
  async function body(request) {
    let bytes = 0; const chunks = [];
    for await (const chunk of request) { bytes += chunk.length; if (bytes > 16384) throw Object.assign(new Error('Body too large'), { status: 413 }); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
  }
  const server = http.createServer(async (request, response) => {
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" };
    for (const [key, value] of Object.entries(headers)) response.setHeader(key, value);
    if (secure) response.setHeader('Strict-Transport-Security', 'max-age=31536000');
    const json = (status, value) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); };
    try {
      const pathname = new URL(request.url, origin).pathname;
      if (request.method === 'GET' && ['/', '/index.html', '/app.js', '/view-model.mjs', '/style.css'].includes(pathname)) {
        const filename = pathname === '/' ? 'index.html' : pathname.slice(1);
        response.setHeader('Content-Type', /\.m?js$/.test(filename) ? 'text/javascript; charset=utf-8' : filename.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8');
        response.end(await fs.promises.readFile(path.join(__dirname, 'public', filename))); return;
      }
      if (request.method === 'GET' && pathname === '/api/health') return json(200, { ok: true });
      if (request.method === 'POST' && ['/api/push', '/api/disconnect'].includes(pathname)) {
        if (!equal(request.headers.authorization || '', `Bearer ${writeToken}`)) return json(401, { error: 'Unauthorized' });
        if (pathname === '/api/disconnect') { if (latest) await save({ ...latest, connected: false }); return json(200, { ok: true }); }
        let incoming; try { incoming = validateSharedState(await body(request)); } catch (error) { return json(error.status || 400, { error: 'Invalid shared state' }); }
        await save({ ...incoming, receivedAt: Date.now(), connected: true }); return json(200, { ok: true });
      }
      if (request.method === 'POST' && ['/api/login', '/api/logout'].includes(pathname)) {
        if (request.headers.origin !== origin) return json(403, { error: 'Origin not allowed' });
        if (pathname === '/api/logout') { response.setHeader('Set-Cookie', cookie('', 0)); return json(200, { ok: true }); }
        const ip = trustProxy ? (request.headers['x-forwarded-for'] || request.socket.remoteAddress).split(',')[0].trim() : request.socket.remoteAddress;
        const now = Date.now();
        for (const [key, entry] of attempts) if (entry.until < now) attempts.delete(key);
        if (attempts.size > 1000 && !attempts.has(ip)) return json(429, { error: '请稍后重试' });
        const attempt = attempts.get(ip) || { count: 0, until: now + 15 * 60000 }; attempt.count++; attempts.set(ip, attempt);
        if (attempt.count > 8) { response.setHeader('Retry-After', '900'); return json(429, { error: '尝试次数较多，请 15 分钟后再试' }); }
        const credentials = await body(request);
        if (!await verifyPassword(credentials?.password, passwordHash)) return json(401, { error: '查看密码不正确' });
        attempts.delete(ip);
        const encoded = Buffer.from(JSON.stringify({ expiresAt: now + SESSION_AGE, nonce: crypto.randomBytes(16).toString('hex') })).toString('base64url');
        response.setHeader('Set-Cookie', cookie(`${encoded}.${sign(encoded)}`)); return json(200, { ok: true });
      }
      const loggedIn = session(request);
      if (request.method === 'GET' && pathname === '/api/session') return json(200, { loggedIn: Boolean(loggedIn) });
      if (!loggedIn) return json(401, { error: '请先登录' });
      if (request.method === 'GET' && pathname === '/api/state') return json(200, view());
      if (request.method === 'GET' && pathname === '/api/events') {
        response.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        response.write(`data: ${JSON.stringify(view())}\n\n`); streams.add(response);
        const pulse = setInterval(() => { if (Date.now() > loggedIn.expiresAt) response.end(); else response.write(`data: ${JSON.stringify(view())}\n\n`); }, 5000);
        response.on('close', () => { clearInterval(pulse); streams.delete(response); }); return;
      }
      json(404, { error: 'Not found' });
    } catch (error) { if (!response.headersSent) json(error.status || 503, { error: error.status ? error.message : '服务暂时不可用，请稍后重试' }); else response.end(); }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  server.on('close', () => { for (const response of streams) response.end(); });
  return server;
}
if (require.main === module) {
  const server = createServer({ storageFile: process.env.STATE_FILE || path.join(__dirname, 'data/state.json'), publicUrl: process.env.PUBLIC_URL,
    writeToken: process.env.WRITE_TOKEN, passwordHash: process.env.VIEW_PASSWORD_HASH, sessionSecret: process.env.SESSION_SECRET, trustProxy: process.env.TRUST_PROXY === '1' });
  server.listen(Number(process.env.PORT || 8787), process.env.HOST || '127.0.0.1', () => console.log('Shiguang live relay is listening.'));
}
module.exports = { createServer, hashPassword, verifyPassword };
