#!/usr/bin/env node
import http from 'node:http';
import { readFileSync, existsSync, createReadStream, writeFileSync, mkdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { MailClient, MailSdkError } from '@clawemail/node-sdk';

const __dirname = resolve(fileURLToPath(new URL('.', import.meta.url)));
const ROOT = resolve(__dirname, '..');
const WEB_ROOT = join(ROOT, 'web');
const DEFAULT_HOST = 'https://claw.163.com';
const DEFAULT_PORT = Number(process.env.PORT || 8765);
const FOLDER_ALIASES = {
  INBOX: 1, Inbox: 1, inbox: 1, '收件箱': 1,
  Drafts: 2, Draft: 2, '草稿箱': 2, '草稿': 2,
  Sent: 3, 'Sent Items': 3, '已发送': 3,
  Trash: 4, Deleted: 4, '已删除': 4, '垃圾箱': 4,
  Spam: 5, Junk: 5, '垃圾邮件': 5, '广告邮件': 5,
};
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
};


const MAIL_CLI_CONFIG = join(ROOT, '.secrets', 'mail-cli-config.json');

function ensureMailCliReady() {
  const bin = join(ROOT, 'node_modules', '.bin', 'mail-cli');
  if (!existsSync(bin)) throw new Error('mail-cli binary missing. Run npm install in /Users/envvar/hack/mails');
  mkdirSync(join(ROOT, '.secrets'), { recursive: true });
  if (!existsSync(MAIL_CLI_CONFIG)) {
    writeFileSync(MAIL_CLI_CONFIG, JSON.stringify({ profiles: {}, apikeyRef: 'mail-cli:apikey' }, null, 2) + '\n', { mode: 0o600 });
  }
  return bin;
}

function redactSecrets(text) {
  return String(text)
    .replace(/ck_live_[A-Za-z0-9]+/g, '[REDACTED_API_KEY]')
    .replace(/("?(?:authCode|apiKey|apikey|accessToken|token)"?\s*[:=]\s*")([^"\n]+)(")/gi, '$1[REDACTED]$3');
}

function runMailCliJson(args, { allowSensitiveOutput = false, saveSensitiveName = '' } = {}) {
  const bin = ensureMailCliReady();
  const result = spawnSync(bin, ['--config', MAIL_CLI_CONFIG, '--json', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    const out = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`mail-cli failed (${result.status}): ${redactSecrets(out)}`);
  }
  const raw = result.stdout || '{}';
  if (allowSensitiveOutput && saveSensitiveName) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    writeFileSync(join(ROOT, '.secrets', `${saveSensitiveName}-${stamp}.json`), raw, { mode: 0o600 });
  }
  const text = allowSensitiveOutput ? raw : redactSecrets(raw);
  return JSON.parse(text || '{}');
}


function flattenMailboxAccounts(mailbox) {
  if (!mailbox) return [];
  return [mailbox, ...(mailbox.subMailboxes || [])].filter(Boolean);
}

function listMailboxAccounts() {
  const result = runMailCliJson(['clawemail', 'list']);
  return flattenMailboxAccounts(result?.data?.mailbox)
    .map(acc => ({
      uid: acc.uid || acc.email,
      email: acc.email || acc.uid,
      displayName: acc.displayName || acc.prefix || acc.email || acc.uid,
      mailboxType: acc.mailboxType,
      status: acc.status,
    }))
    .filter(acc => acc.email && acc.status !== 'disabled');
}

async function addPreviewsForUser(user, messages) {
  const { cm } = getClients(user);
  return addPreviews(cm, messages);
}

async function aggregateFolders() {
  const accounts = listMailboxAccounts();
  const perAccount = await Promise.all(accounts.map(async (acc) => {
    try {
      const { cm } = getClients(acc.email);
      return flattenFolders(await cm.folders());
    } catch (err) {
      return [];
    }
  }));
  const byId = new Map();
  for (const folders of perAccount) {
    for (const folder of folders) {
      const id = String(folder.id);
      const prev = byId.get(id) || { ...folder, unreadCount: 0, messageCount: 0 };
      prev.name = prev.name || folder.name;
      prev.unreadCount += Number(folder.unreadCount || 0);
      prev.messageCount += Number(folder.messageCount || 0);
      byId.set(id, prev);
    }
  }
  return [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id));
}

async function aggregateMessages({ fid = 'INBOX', limit = 40, unread = false, preview = false } = {}) {
  const accounts = listMailboxAccounts();
  const perAccount = await Promise.all(accounts.map(async (acc) => {
    try {
      const { cm } = getClients(acc.email);
      let messages = await cm.list({ fid, limit, unread }).then(rows => rows.map(summarizeMessage));
      messages = messages.map(msg => ({ ...msg, user: acc.email, accountName: acc.displayName, accountType: acc.mailboxType }));
      if (preview) messages = await addPreviewsForUser(acc.email, messages);
      return messages;
    } catch (err) {
      return [];
    }
  }));
  return perAccount.flat()
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    .slice(0, Number(limit));
}

async function aggregateSearchMessages({ fid = 'INBOX', keyword, limit = 40, unread = false, preview = false } = {}) {
  const accounts = listMailboxAccounts();
  const perAccount = await Promise.all(accounts.map(async (acc) => {
    try {
      const { cm } = getClients(acc.email);
      let messages = await cm.search({ fid, keyword, unread, limit }).then(rows => rows.map(summarizeMessage));
      messages = messages.map(msg => ({ ...msg, user: acc.email, accountName: acc.displayName, accountType: acc.mailboxType }));
      if (preview) messages = await addPreviewsForUser(acc.email, messages);
      return messages;
    } catch (err) {
      return [];
    }
  }));
  return perAccount.flat()
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    .slice(0, Number(limit));
}

function parseEnvFile(path = join(ROOT, '.env')) {
  const env = {};
  if (!existsSync(path)) return env;
  const text = readFileSync(path, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    env[key] = value;
  }
  return env;
}

function loadConfig() {
  const fileEnv = parseEnvFile();
  const cfg = {
    user: process.env.CLAW_USER || fileEnv.CLAW_USER,
    apiKey: process.env.CLAW_API_KEY || fileEnv.CLAW_API_KEY,
    host: process.env.CLAW_HOST || fileEnv.CLAW_HOST || DEFAULT_HOST,
    timeoutMs: Number(process.env.CLAW_TIMEOUT_MS || fileEnv.CLAW_TIMEOUT_MS || 15000),
  };
  if (!cfg.user || !cfg.apiKey) throw new Error('Missing CLAW_USER or CLAW_API_KEY in .env');
  return cfg;
}

function maskSecret(s) {
  if (!s) return '<empty>';
  return s.length > 12 ? `${s.slice(0, 8)}…${s.slice(-4)}` : `${s.slice(0, 2)}…${s.slice(-2)}`;
}

function folderId(value = 'INBOX') {
  if (FOLDER_ALIASES[value] !== undefined) return FOLDER_ALIASES[value];
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`Invalid folder id: ${value}`);
  return n;
}

function buildUrl(host, path) {
  return new URL(path, host.endsWith('/') ? host : `${host}/`).toString();
}

async function postJson(url, payload, bearer, timeoutMs = 15000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify(payload ?? {}),
      signal: ac.signal,
    });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : null; }
    catch { data = { raw: text }; }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(data).slice(0, 500)}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

class CoremailClient {
  constructor(cfg) {
    this.cfg = cfg;
    this.cachedToken = null;
    this.cachedExpiresAt = 0;
  }
  async accessToken() {
    if (this.cachedToken && this.cachedExpiresAt - Date.now() > 60_000) return this.cachedToken;
    const url = buildUrl(this.cfg.host, '/claw-api-gateway/open/v1/mail/auth/token');
    const data = await postJson(url, { uid: this.cfg.user }, this.cfg.apiKey, this.cfg.timeoutMs);
    if (data?.success !== true || !data?.result?.accessToken) throw new Error(`Token fetch failed: ${JSON.stringify(data).slice(0, 500)}`);
    this.cachedToken = data.result.accessToken;
    this.cachedExpiresAt = Date.now() + Number(data.result.expiresIn || 1800) * 1000;
    return this.cachedToken;
  }
  async proxy(func, payload = {}) {
    const token = await this.accessToken();
    const url = new URL(buildUrl(this.cfg.host, '/claw-api-gateway/api/coremail/proxy'));
    url.searchParams.set('uid', this.cfg.user);
    url.searchParams.set('func', func);
    const data = await postJson(url.toString(), payload, token, this.cfg.timeoutMs);
    if (data?.code !== 'S_OK') throw new Error(`Coremail ${func} failed: ${JSON.stringify(data).slice(0, 800)}`);
    return data.var ?? null;
  }
  folders() {
    return this.proxy('mbox:getAllFolders', { flush: true, stats: true, threads: false });
  }
  list({ fid = 'INBOX', limit = 30, start = 0, unread = false, order = 'date', desc = true }) {
    return this.proxy('mbox:listMessages', {
      fid: folderId(fid), order, desc, start: Number(start), limit: Number(limit),
      ...(unread ? { filterFlags: { read: false } } : {}),
    });
  }
  search({ fid = 'INBOX', keyword, from, to, subject, limit = 30, unread = false }) {
    const conditions = [];
    if (keyword) conditions.push({ operator: 'or', conditions: [
      { field: 'subject', operator: 'contains', operand: keyword, ignoreCase: true },
      { field: 'from', operator: 'contains', operand: keyword, ignoreCase: true },
      { field: 'to', operator: 'contains', operand: keyword, ignoreCase: true },
    ]});
    if (from) conditions.push({ field: 'from', operator: 'contains', operand: from, ignoreCase: true });
    if (to) conditions.push({ field: 'to', operator: 'contains', operand: to, ignoreCase: true });
    if (subject) conditions.push({ field: 'subject', operator: 'contains', operand: subject, ignoreCase: true });
    if (unread) conditions.push({ field: 'flags', operator: '=', operand: { read: false } });
    if (!conditions.length) throw new Error('search needs keyword/from/to/subject/unread');
    return this.proxy('mbox:searchMessages', { fid: folderId(fid), recursive: true, operator: 'and', conditions, limit: Number(limit), windowSize: Number(limit), order: 'date', desc: true });
  }
  read({ id, markRead = false }) {
    return this.proxy('mbox:readMessage', { id, mode: 'html', markRead, header: true, securityLevel: 1, filterLinks: false, filterImages: false });
  }
  mark({ ids, read }) {
    return this.proxy('mbox:updateMessageInfos', { ids, attrs: { flags: { read } } });
  }
}

function flattenFolders(folders, prefix = '') {
  const out = [];
  for (const f of folders || []) {
    const name = prefix ? `${prefix}/${f.name}` : f.name;
    out.push({ id: String(f.id), name, unreadCount: f.stats?.unreadMessageCount ?? 0, messageCount: f.stats?.messageCount ?? 0 });
    if (f.children?.length) out.push(...flattenFolders(f.children, name));
  }
  return out;
}

function summarizeMessage(m) {
  return {
    id: m.id,
    from: m.from,
    to: m.to,
    subject: m.subject,
    date: m.receivedDate ?? m.sentDate,
    size: m.size,
    read: m.flags?.read ?? false,
    hasAttachment: Boolean(m.attachments?.length || m.attachmentCount),
  };
}

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function plainPreviewFromMail(mail, maxLen = 180) {
  const text = mail.text?.content;
  let body = text;
  if (!body) {
    body = String(mail.html?.content || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<head[\s\S]*?<\/head>/gi, ' ')
      .replace(/<br\s*\/?\s*>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ' ');
  }
  return decodeHtmlEntities(body).replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

async function addPreviews(cm, messages) {
  for (const msg of messages) {
    try {
      const mail = await cm.read({ id: msg.id, markRead: false });
      msg.preview = plainPreviewFromMail(mail);
    } catch (err) {
      msg.preview = '';
    }
  }
  return messages;
}

function parseEmailAddresses(value) {
  const values = Array.isArray(value) ? value : [value];
  const out = [];
  for (const item of values) {
    if (!item) continue;
    const matches = String(item).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
    for (const m of matches) if (!out.includes(m)) out.push(m);
  }
  return out;
}

function asArray(value) {
  if (value === undefined || value === null || value === '') return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr.flatMap(v => String(v).split(',')).map(s => s.trim()).filter(Boolean);
}

function createSdkClient(cfg) {
  return new MailClient({ apiKey: cfg.apiKey, user: cfg.user, timeout: cfg.timeoutMs, logger: null });
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function errorJson(res, err, status = 500) {
  const message = err instanceof MailSdkError ? `[${err.code}] ${err.message}` : err instanceof Error ? err.message : String(err);
  json(res, status, { ok: false, error: message });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

let baseCfg;
const cmCache = new Map();
function getClients(user) {
  if (!baseCfg) baseCfg = loadConfig();
  const selectedUser = user || baseCfg.user;
  const cfg = { ...baseCfg, user: selectedUser };
  let cm = cmCache.get(selectedUser);
  if (!cm) {
    cm = new CoremailClient(cfg);
    cmCache.set(selectedUser, cm);
  }
  return { cfg, cm };
}

function userFromQuery(url) {
  return url.searchParams.get('user') || undefined;
}

const sseClientsByUser = new Map();
const watchersByUser = new Map();
const watcherConnectingUsers = new Set();

function sendEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function clientsForUser(user) {
  let clients = sseClientsByUser.get(user);
  if (!clients) {
    clients = new Set();
    sseClientsByUser.set(user, clients);
  }
  return clients;
}

function broadcast(user, event, data) {
  for (const res of clientsForUser(user)) sendEvent(res, event, data);
}

async function ensureWatcher(user) {
  if (watchersByUser.has(user) || watcherConnectingUsers.has(user)) return;
  watcherConnectingUsers.add(user);
  const { cfg } = getClients(user);
  const client = createSdkClient(cfg);
  client.ws.onMessage(({ mailId }) => {
    broadcast(user, 'mail', { mailId, user, at: new Date().toISOString() });
  });
  client.ws.onDisconnect((reason) => {
    broadcast(user, 'watcher', { status: 'disconnected', user, reason });
    watchersByUser.delete(user);
    setTimeout(() => ensureWatcher(user).catch(() => {}), 3000);
  });
  try {
    await client.ws.connect();
    watchersByUser.set(user, client);
    broadcast(user, 'watcher', { status: 'connected', user });
  } catch (err) {
    broadcast(user, 'watcher', { status: 'error', user, error: err instanceof Error ? err.message : String(err) });
    setTimeout(() => ensureWatcher(user).catch(() => {}), 5000);
  } finally {
    watcherConnectingUsers.delete(user);
  }
}

async function handleApi(req, res, url) {
  const requestedUser = userFromQuery(url);
  const { cfg, cm } = getClients(requestedUser);
  if (req.method === 'GET' && url.pathname === '/api/me') {
    return json(res, 200, { ok: true, user: cfg.user, defaultUser: getClients().cfg.user, host: cfg.host });
  }
  if (req.method === 'GET' && url.pathname === '/api/folders') {
    if (url.searchParams.get('aggregate') === '1') {
      return json(res, 200, { ok: true, aggregate: true, folders: await aggregateFolders() });
    }
    return json(res, 200, { ok: true, user: cfg.user, folders: flattenFolders(await cm.folders()) });
  }
  if (req.method === 'GET' && url.pathname === '/api/accounts') {
    return json(res, 200, { ok: true, result: runMailCliJson(['clawemail', 'list']) });
  }
  if (req.method === 'POST' && url.pathname === '/api/accounts/create') {
    const body = await readBody(req);
    if (!body.prefix) return json(res, 400, { ok: false, error: 'missing prefix' });
    const args = ['clawemail', 'create', '--prefix', String(body.prefix), '--type', String(body.type || 'sub')];
    if (body.displayName) args.push('--display-name', String(body.displayName));
    return json(res, 200, { ok: true, result: runMailCliJson(args, { allowSensitiveOutput: true, saveSensitiveName: 'submailbox-create' }) });
  }
  if (req.method === 'POST' && url.pathname === '/api/accounts/profile') {
    const body = await readBody(req);
    const args = ['clawemail', 'profile'];
    if (body.uid) args.push('--uid', String(body.uid));
    if (body.displayName) args.push('--display-name', String(body.displayName));
    return json(res, 200, { ok: true, result: runMailCliJson(args) });
  }
  if (req.method === 'POST' && /^\/api\/accounts\/(enable|disable|delete)$/.test(url.pathname)) {
    const body = await readBody(req);
    if (!body.uid) return json(res, 400, { ok: false, error: 'missing uid' });
    const action = url.pathname.split('/').pop();
    return json(res, 200, { ok: true, result: runMailCliJson(['clawemail', action, '--uid', String(body.uid)]) });
  }
  if (req.method === 'GET' && url.pathname === '/api/messages') {
    if (url.searchParams.get('aggregate') === '1') {
      const messages = await aggregateMessages({ fid: url.searchParams.get('fid') || 'INBOX', limit: url.searchParams.get('limit') || 40, unread: url.searchParams.get('unread') === '1', preview: url.searchParams.get('preview') === '1' });
      return json(res, 200, { ok: true, aggregate: true, messages });
    }
    let messages = await cm.list({ fid: url.searchParams.get('fid') || 'INBOX', limit: url.searchParams.get('limit') || 30, start: url.searchParams.get('start') || 0, unread: url.searchParams.get('unread') === '1' }).then(rows => rows.map(summarizeMessage));
    if (url.searchParams.get('preview') === '1') messages = await addPreviews(cm, messages);
    return json(res, 200, { ok: true, user: cfg.user, messages });
  }
  if (req.method === 'GET' && url.pathname === '/api/search') {
    if (url.searchParams.get('aggregate') === '1') {
      const messages = await aggregateSearchMessages({ fid: url.searchParams.get('fid') || 'INBOX', keyword: url.searchParams.get('keyword'), limit: url.searchParams.get('limit') || 40, unread: url.searchParams.get('unread') === '1', preview: url.searchParams.get('preview') === '1' });
      return json(res, 200, { ok: true, aggregate: true, messages });
    }
    let messages = await cm.search({ fid: url.searchParams.get('fid') || 'INBOX', keyword: url.searchParams.get('keyword'), from: url.searchParams.get('from'), to: url.searchParams.get('to'), subject: url.searchParams.get('subject'), unread: url.searchParams.get('unread') === '1', limit: url.searchParams.get('limit') || 30 }).then(rows => rows.map(summarizeMessage));
    if (url.searchParams.get('preview') === '1') messages = await addPreviews(cm, messages);
    return json(res, 200, { ok: true, user: cfg.user, messages });
  }
  if (req.method === 'GET' && url.pathname === '/api/message') {
    const id = url.searchParams.get('id');
    if (!id) return json(res, 400, { ok: false, error: 'missing id' });
    const mail = await cm.read({ id, markRead: url.searchParams.get('markRead') === '1' });
    return json(res, 200, { ok: true, mail });
  }
  if (req.method === 'POST' && url.pathname === '/api/mark') {
    const body = await readBody(req);
    const { cm: selectedCm } = getClients(body.user || requestedUser);
    const ids = asArray(body.ids || body.id);
    if (!ids.length) return json(res, 400, { ok: false, error: 'missing ids' });
    await selectedCm.mark({ ids, read: Boolean(body.read) });
    return json(res, 200, { ok: true });
  }
  if (req.method === 'POST' && url.pathname === '/api/send') {
    const body = await readBody(req);
    const { cfg: selectedCfg } = getClients(body.user || requestedUser);
    const to = asArray(body.to);
    if (!to.length) return json(res, 400, { ok: false, error: 'missing to' });
    await createSdkClient(selectedCfg).mail.send({ to, subject: body.subject || '', body: body.body || '', html: Boolean(body.html), cc: asArray(body.cc), bcc: asArray(body.bcc) });
    return json(res, 200, { ok: true, from: selectedCfg.user });
  }
  if (req.method === 'POST' && url.pathname === '/api/reply') {
    const body = await readBody(req);
    const { cfg: selectedCfg, cm: selectedCm } = getClients(body.user || requestedUser);
    if (!body.id) return json(res, 400, { ok: false, error: 'missing id' });
    let overrideTo = asArray(body.to);
    if (!overrideTo.length) {
      const original = await selectedCm.read({ id: body.id, markRead: false });
      if (body.all) {
        const all = [...parseEmailAddresses(original.from), ...parseEmailAddresses(original.to), ...parseEmailAddresses(original.cc)].filter(addr => addr.toLowerCase() !== selectedCfg.user.toLowerCase());
        overrideTo = all.length ? all : parseEmailAddresses(original.from || original.to);
      } else {
        overrideTo = parseEmailAddresses(original.from);
      }
    }
    await createSdkClient(selectedCfg).mail.reply({ id: body.id, body: body.body || '', html: Boolean(body.html), toAll: false, overrideTo, cc: asArray(body.cc) });
    return json(res, 200, { ok: true, from: selectedCfg.user, to: overrideTo });
  }
  if (req.method === 'GET' && url.pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const user = cfg.user;
    const clients = clientsForUser(user);
    clients.add(res);
    sendEvent(res, 'hello', { user, watcher: watchersByUser.has(user) ? 'connected' : 'connecting' });
    ensureWatcher(user).catch(err => sendEvent(res, 'watcher', { status: 'error', user, error: err.message }));
    const interval = setInterval(() => sendEvent(res, 'ping', { user, at: Date.now() }), 25000);
    req.on('close', () => {
      clearInterval(interval);
      clients.delete(res);
    });
    return;
  }
  return json(res, 404, { ok: false, error: 'not found' });
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  if (rel.includes('..')) {
    res.writeHead(400); res.end('bad path'); return;
  }
  const file = join(WEB_ROOT, rel);
  if (!file.startsWith(WEB_ROOT) || !existsSync(file)) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else serveStatic(req, res, url);
  } catch (err) {
    errorJson(res, err);
  }
});

server.listen(DEFAULT_PORT, '127.0.0.1', () => {
  const { cfg } = getClients();
  console.log(`Claw Mail Web running: http://127.0.0.1:${DEFAULT_PORT}`);
  console.log(`user=${cfg.user} auth=ok`);
});
