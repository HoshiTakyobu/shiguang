const fs = require('node:fs');
const path = require('node:path');
const { sharedState } = require('./share-protocol.cjs');
function endpoint(value, allowLocal = false) {
  let url; try { url = new URL(value); } catch { throw new Error('请输入有效的 HTTPS 查看网址。'); }
  if ((url.protocol !== 'https:' && !(allowLocal && url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('请输入有效的 HTTPS 查看网址。');
  return url.origin;
}
class CloudSync {
  constructor(directory, encryption, source, { allowLocal = false, fetchImpl = fetch } = {}) {
    this.file = path.join(directory, 'cloud-settings.json'); this.encryption = encryption; this.source = source;
    this.allowLocal = allowLocal; this.fetch = fetchImpl; this.config = { enabled: false, endpoint: '', token: '' };
    this.status = 'disabled'; this.lastSyncedAt = null; this.error = ''; this.nextAt = 0; this.generation = 0;
    try {
      const value = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.config = { enabled: value.enabled === true, endpoint: endpoint(value.endpoint, allowLocal),
        token: encryption.decryptString(Buffer.from(value.encryptedToken, 'base64')) };
      if (this.config.token.length < 32) throw new Error('Invalid saved token');
      this.status = this.config.enabled ? 'waiting' : 'disabled';
    } catch (error) { this.config = { enabled: false, endpoint: '', token: '' }; if (fs.existsSync(this.file)) this.error = '手机查看配置暂时无法读取，请重新保存连接信息。'; }
  }
  snapshot() { return { enabled: this.config.enabled, endpoint: this.config.endpoint, hasToken: Boolean(this.config.token), status: this.status, lastSyncedAt: this.lastSyncedAt, error: this.error }; }
  async configure(value) {
    if (!value || typeof value.enabled !== 'boolean' || typeof value.endpoint !== 'string' || (value.token !== undefined && typeof value.token !== 'string')) throw new Error('手机查看设置无效。');
    const target = endpoint(value.endpoint.trim(), this.allowLocal), token = value.token?.trim() || this.config.token;
    if (token.length < 32 || token.length > 512 || /\s/.test(token)) throw new Error('请填写服务器提供的电脑连接密钥。');
    if (!this.encryption.isEncryptionAvailable()) throw new Error('Windows 凭据加密暂不可用，连接密钥尚未保存。');
    const next = { enabled: value.enabled, endpoint: target, token };
    const saved = { enabled: next.enabled, endpoint: target, encryptedToken: this.encryption.encryptString(token).toString('base64') };
    fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(saved)); fs.renameSync(`${this.file}.tmp`, this.file);
    const previous = this.config;
    this.generation++; this.controller?.abort(); this.config = next; this.error = ''; this.nextAt = 0;
    this.status = next.enabled ? 'waiting' : 'disabled';
    if (previous.enabled && (!next.enabled || previous.endpoint !== next.endpoint)) void this.disconnect(previous);
    if (next.enabled) await this.flush(true);
    return this.snapshot();
  }
  tick() { if (this.config.enabled && Date.now() >= this.nextAt && !this.pending) void this.flush(); }
  pushSoon() { this.nextAt = 0; }
  async flush(force = false) {
    if (!this.config.enabled) return;
    if (this.pending) { if (!force) return this.pending; try { await this.pending; } catch { /* Retry the latest configuration. */ } }
    const generation = this.generation, config = { ...this.config };
    this.status = 'connecting'; this.controller = new AbortController(); const controller = this.controller;
    const timeout = setTimeout(() => controller.abort(), 5000);
    const run = async () => {
      try {
        const response = await this.fetch(`${config.endpoint}/api/push`, { method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` }, body: JSON.stringify(sharedState(this.source())) });
        if (!response.ok) throw Object.assign(new Error('Sync rejected'), { status: response.status });
        if (generation !== this.generation) return;
        this.status = 'connected'; this.lastSyncedAt = Date.now(); this.error = ''; this.nextAt = Date.now() + 5000;
      } catch (error) {
        if (generation !== this.generation) return;
        this.status = 'error'; this.error = error.status === 401 ? '电脑连接密钥不正确，请检查服务器配置。' : '暂时无法连接手机查看服务，本机计时仍在继续。'; this.nextAt = Date.now() + 15000;
      } finally { clearTimeout(timeout); }
    };
    const pending = run(); this.pending = pending;
    try { await pending; } finally { if (this.pending === pending) this.pending = null; }
    return this.snapshot();
  }
  async disconnect(config = this.config) {
    if (!config.endpoint || !config.token) return;
    try { await this.fetch(`${config.endpoint}/api/disconnect`, { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(1200) }); } catch { /* Heartbeat expiry also marks the PC offline. */ }
  }
  dispose() { this.generation++; this.controller?.abort(); void this.disconnect(); this.config.enabled = false; }
}
module.exports = { CloudSync, endpoint };
