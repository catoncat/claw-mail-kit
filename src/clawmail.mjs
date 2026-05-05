#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { MailClient, MailSdkError } from '@clawemail/node-sdk';

const DEFAULT_HOST = 'https://claw.163.com';
const FOLDER_ALIASES = {
  INBOX: 1, Inbox: 1, inbox: 1, '收件箱': 1,
  Drafts: 2, Draft: 2, '草稿箱': 2, '草稿': 2,
  Sent: 3, 'Sent Items': 3, '已发送': 3,
  Trash: 4, Deleted: 4, '已删除': 4, '垃圾箱': 4,
  Spam: 5, Junk: 5, '垃圾邮件': 5, '广告邮件': 5,
};

function usage() {
  console.log(`local-claw-mail — use Claw 163 agent mail without OpenClaw

Usage:
  npm run clawmail -- <command> [options]
  node src/clawmail.mjs <command> [options]

Setup:
  auth-from-url <url|t1/code> [--env .env]     Fetch auth-url and write CLAW_USER/CLAW_API_KEY
  check                                        Validate API key and show mailbox summary

Mailbox:
  folders [--json]                             List folders
  list [--fid INBOX] [--limit 20] [--unread] [--json]
  search --keyword TEXT [--fid INBOX] [--limit 20] [--json]
  read --id ID [--mark-read] [--json] [--raw-html]

Send:
  send --to A[,B] --subject TEXT (--body TEXT|--body-file FILE) [--html] [--cc A,B] [--bcc A,B] [--attach FILE]
  reply --id ID (--body TEXT|--body-file FILE) [--all] [--to A,B] [--cc A,B] [--attach FILE]

Realtime:
  watch [--mark-read] [--json]                 Print new mail pushes via WebSocket

Agent mailbox accounts:
  accounts list [--json]                       List primary/sub mailboxes
  accounts master-user [--json]                Show workspace master user
  accounts info [--uid UID] [--json]           Show one mailbox
  accounts create --prefix NAME [--display-name NAME] [--type sub] [--json]
  accounts profile [--uid UID] [--display-name NAME] [--json]
  accounts enable --uid UID [--json]
  accounts disable --uid UID [--json]
  accounts delete --uid UID [--json]           Delete a sub mailbox

Config:
  Reads .env by default, then process env overrides it.
  Required: CLAW_USER=<name@claw.163.com>, CLAW_API_KEY=ck_live_xxx
  Optional: CLAW_HOST=${DEFAULT_HOST}, CLAW_TIMEOUT_MS=15000
`);
}

function parseEnvFile(path = '.env') {
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function loadConfig() {
  const fileEnv = parseEnvFile('.env');
  const cfg = {
    user: process.env.CLAW_USER || fileEnv.CLAW_USER,
    apiKey: process.env.CLAW_API_KEY || fileEnv.CLAW_API_KEY,
    host: process.env.CLAW_HOST || fileEnv.CLAW_HOST || DEFAULT_HOST,
    timeoutMs: Number(process.env.CLAW_TIMEOUT_MS || fileEnv.CLAW_TIMEOUT_MS || 15000),
  };
  if (!cfg.user || !cfg.apiKey) {
    throw new Error('Missing CLAW_USER or CLAW_API_KEY. Run: node src/clawmail.mjs auth-from-url <auth-url>');
  }
  return cfg;
}

function maskSecret(s) {
  if (!s) return '<empty>';
  if (s.length <= 12) return `${s.slice(0, 2)}…${s.slice(-2)}`;
  return `${s.slice(0, 8)}…${s.slice(-4)}`;
}

function parseFlags(argv) {
  const flags = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      flags._.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    let key;
    let value;
    if (eq !== -1) {
      key = arg.slice(2, eq);
      value = arg.slice(eq + 1);
    } else {
      key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        value = next;
        i++;
      } else {
        value = true;
      }
    }
    if (flags[key] === undefined) flags[key] = value;
    else if (Array.isArray(flags[key])) flags[key].push(value);
    else flags[key] = [flags[key], value];
  }
  return flags;
}

function asArray(value) {
  if (value === undefined || value === true || value === '') return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr.flatMap(v => String(v).split(',')).map(s => s.trim()).filter(Boolean);
}

async function readStdinIfPiped() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function bodyFromFlags(flags) {
  if (typeof flags.body === 'string') return flags.body;
  if (typeof flags['body-file'] === 'string') return readFileSync(flags['body-file'], 'utf8');
  const stdin = await readStdinIfPiped();
  if (stdin) return stdin;
  throw new Error('Missing body. Use --body, --body-file, or pipe stdin.');
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
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${JSON.stringify(data).slice(0, 500)}`);
    }
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
    if (data?.success !== true || !data?.result?.accessToken) {
      throw new Error(`Token fetch failed: ${JSON.stringify(data).slice(0, 500)}`);
    }
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
    if (data?.code !== 'S_OK') {
      throw new Error(`Coremail ${func} failed: ${JSON.stringify(data).slice(0, 800)}`);
    }
    return data.var ?? null;
  }
  async folders() {
    return this.proxy('mbox:getAllFolders', { flush: true, stats: true, threads: false });
  }
  async list({ fid = 'INBOX', limit = 20, start = 0, unread = false, order = 'date', desc = true }) {
    return this.proxy('mbox:listMessages', {
      fid: folderId(fid), order, desc, start: Number(start), limit: Number(limit),
      ...(unread ? { filterFlags: { read: false } } : {}),
    });
  }
  async search({ fid = 'INBOX', keyword, from, to, subject, limit = 20, unread = false, fts = false }) {
    if (!keyword && !from && !to && !subject && !unread) throw new Error('search needs --keyword, --from, --to, --subject, or --unread');
    let payload;
    if (fts && keyword) {
      payload = { fid: folderId(fid), recursive: true, pattern: keyword, fts: { ext: true, fields: 'from,to,subj,cont,aname' }, limit: Number(limit), windowSize: Number(limit), order: 'date', desc: true };
    } else {
      const conditions = [];
      if (keyword) {
        conditions.push({ operator: 'or', conditions: [
          { field: 'subject', operator: 'contains', operand: keyword, ignoreCase: true },
          { field: 'from', operator: 'contains', operand: keyword, ignoreCase: true },
          { field: 'to', operator: 'contains', operand: keyword, ignoreCase: true },
        ]});
      }
      if (from) conditions.push({ field: 'from', operator: 'contains', operand: from, ignoreCase: true });
      if (to) conditions.push({ field: 'to', operator: 'contains', operand: to, ignoreCase: true });
      if (subject) conditions.push({ field: 'subject', operator: 'contains', operand: subject, ignoreCase: true });
      if (unread) conditions.push({ field: 'flags', operator: '=', operand: { read: false } });
      payload = { fid: folderId(fid), recursive: true, operator: 'and', conditions, limit: Number(limit), windowSize: Number(limit), order: 'date', desc: true };
    }
    return this.proxy('mbox:searchMessages', payload);
  }
  async read({ id, markRead = false, mode = 'html' }) {
    return this.proxy('mbox:readMessage', {
      id, mode, markRead, header: true, securityLevel: 1, filterLinks: false, filterImages: false,
    });
  }
}

function flattenFolders(folders, prefix = '') {
  const out = [];
  for (const f of folders || []) {
    const name = prefix ? `${prefix}/${f.name}` : f.name;
    out.push({ id: String(f.id), name, unreadCount: f.stats?.unreadMessageCount ?? 0, messageCount: f.stats?.messageCount });
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
  };
}

function printTable(rows, columns) {
  const widths = columns.map(c => Math.min(48, Math.max(c.length, ...rows.map(r => String(r[c] ?? '').length))));
  console.log(columns.map((c, i) => c.padEnd(widths[i])).join('  '));
  console.log(columns.map((_, i) => '-'.repeat(widths[i])).join('  '));
  for (const row of rows) {
    console.log(columns.map((c, i) => String(row[c] ?? '').replace(/\s+/g, ' ').slice(0, widths[i]).padEnd(widths[i])).join('  '));
  }
}

function createSdkClient(cfg, { verbose = false } = {}) {
  return new MailClient({
    apiKey: cfg.apiKey,
    user: cfg.user,
    timeout: cfg.timeoutMs,
    logger: verbose ? undefined : null,
  });
}


const MAIL_CLI_CONFIG = '.secrets/mail-cli-config.json';

function ensureMailCliReady() {
  if (!existsSync('./node_modules/.bin/mail-cli')) {
    throw new Error('mail-cli binary missing. Run: npm install');
  }
  mkdirSync('.secrets', { recursive: true });
  if (!existsSync(MAIL_CLI_CONFIG)) {
    // The key value itself lives in the OS keychain via mail-cli; this config
    // only points mail-cli at that keychain item. If the keychain item is
    // missing, the subcommand will fail with a clear auth error.
    writeFileSync(MAIL_CLI_CONFIG, JSON.stringify({ profiles: {}, apikeyRef: 'mail-cli:apikey' }, null, 2) + '\n', { mode: 0o600 });
  }
}

function redactSecrets(text) {
  return String(text)
    .replace(/ck_live_[A-Za-z0-9]+/g, '[REDACTED_API_KEY]')
    .replace(/("?(?:authCode|apiKey|apikey|accessToken|token)"?\s*[:=]\s*")([^"\n]+)(")/gi, '$1[REDACTED]$3');
}

function runMailCli(args, { allowSensitiveOutput = false, saveSensitiveName = '' } = {}) {
  ensureMailCliReady();
  const result = spawnSync('./node_modules/.bin/mail-cli', ['--config', MAIL_CLI_CONFIG, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    const out = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`mail-cli failed (${result.status}): ${redactSecrets(out)}`);
  }
  const out = result.stdout || '';
  if (allowSensitiveOutput && saveSensitiveName) {
    mkdirSync('.secrets', { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    writeFileSync(join('.secrets', `${saveSensitiveName}-${stamp}.json`), out, { mode: 0o600 });
  }
  return allowSensitiveOutput ? out : redactSecrets(out);
}

function commandAccounts(flags) {
  const sub = flags._[0] || 'list';
  const jsonFlag = !!flags.json;
  const global = jsonFlag ? ['--json'] : [];
  let args;
  let allowSensitiveOutput = false;
  switch (sub) {
    case 'list':
      args = [...global, 'clawemail', 'list'];
      break;
    case 'master-user':
    case 'master':
      args = [...global, 'clawemail', 'master-user'];
      break;
    case 'info':
      args = [...global, 'clawemail', 'info'];
      if (flags.uid) args.push('--uid', String(flags.uid));
      break;
    case 'create':
      if (!flags.prefix) throw new Error('accounts create needs --prefix');
      args = [...global, 'clawemail', 'create', '--prefix', String(flags.prefix), '--type', String(flags.type || 'sub')];
      if (flags['display-name']) args.push('--display-name', String(flags['display-name']));
      // Creation returns a one-time auth code. The CLI caller needs it, but it
      // should not be pasted into chat summaries unless explicitly requested.
      allowSensitiveOutput = true;
      break;
    case 'profile':
      args = [...global, 'clawemail', 'profile'];
      if (flags.uid) args.push('--uid', String(flags.uid));
      if (flags['display-name']) args.push('--display-name', String(flags['display-name']));
      break;
    case 'enable':
    case 'disable':
    case 'delete':
      if (!flags.uid) throw new Error(`accounts ${sub} needs --uid`);
      args = [...global, 'clawemail', sub, '--uid', String(flags.uid)];
      break;
    default:
      throw new Error(`Unknown accounts command: ${sub}`);
  }
  const out = runMailCli(args, { allowSensitiveOutput, saveSensitiveName: sub === 'create' ? 'submailbox-create' : '' });
  process.stdout.write(out);
  if (out && !out.endsWith('\n')) process.stdout.write('\n');
}

async function commandAuthFromUrl(flags) {
  const input = flags._[0];
  if (!input) throw new Error('Usage: auth-from-url <url|t1/code> [--env .env]');
  const url = /^https?:\/\//i.test(input) ? input : `https://u.163.com/${input}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`auth-url fetch failed: HTTP ${res.status}`);
  const body = (await res.text()).trim();
  if (!body || /<html|<!doctype/i.test(body)) throw new Error('auth-url returned empty/HTML; it may be expired or invalid');

  const accounts = [];
  let apiKey = '';
  for (const line of body.split(/\r?\n/).filter(Boolean)) {
    const first = line.indexOf(':');
    const second = line.indexOf(':', first + 1);
    if (first === -1 || second === -1) continue;
    const name = line.slice(0, first);
    const accountId = line.slice(first + 1, second);
    const secret = line.slice(second + 1);
    if (name === '__apikey__') apiKey = secret;
    else accounts.push({ name, accountId, email: `${name}@claw.163.com`, transport: secret.trim() ? 'imap' : 'ws' });
  }
  if (!apiKey) throw new Error('auth-url did not contain __apikey__ line');
  if (!accounts.length) throw new Error('auth-url did not contain any account line');
  const selected = accounts.find(a => a.accountId === (flags.account || 'default')) || accounts[0];
  const envPath = flags.env || '.env';
  writeFileSync(envPath, `CLAW_USER=${selected.email}\nCLAW_API_KEY=${apiKey}\nCLAW_HOST=${DEFAULT_HOST}\n`, { mode: 0o600 });
  console.log(`wrote ${envPath}`);
  console.log(`account: ${selected.email} (${selected.accountId}, ${selected.transport})`);
  console.log(`apiKey: ${maskSecret(apiKey)}`);
  console.log(`accounts in auth-url: ${accounts.map(a => `${a.email}/${a.accountId}/${a.transport}`).join(', ')}`);
}

async function commandCheck() {
  const cfg = loadConfig();
  const cm = new CoremailClient(cfg);
  await cm.accessToken();
  const folders = flattenFolders(await cm.folders());
  const inbox = folders.find(f => f.id === '1');
  console.log(`auth: ok user=${cfg.user} apiKey=${maskSecret(cfg.apiKey)}`);
  console.log(`inbox: unread=${inbox?.unreadCount ?? '?'} total=${inbox?.messageCount ?? '?'}`);
  console.log(`folders: ${folders.length}`);
}

async function commandFolders(flags) {
  const cm = new CoremailClient(loadConfig());
  const rows = flattenFolders(await cm.folders());
  if (flags.json) console.log(JSON.stringify(rows, null, 2));
  else printTable(rows, ['id', 'name', 'unreadCount', 'messageCount']);
}

async function commandList(flags) {
  const cm = new CoremailClient(loadConfig());
  const rows = (await cm.list({ fid: flags.fid || 'INBOX', limit: flags.limit || 20, start: flags.start || 0, unread: !!flags.unread })).map(summarizeMessage);
  if (flags.json) console.log(JSON.stringify(rows, null, 2));
  else if (rows.length) printTable(rows, ['id', 'date', 'from', 'subject', 'read']);
  else console.log('(no messages)');
}

async function commandSearch(flags) {
  const cm = new CoremailClient(loadConfig());
  const rows = (await cm.search({ fid: flags.fid || 'INBOX', keyword: flags.keyword, from: flags.from, to: flags.to, subject: flags.subject, limit: flags.limit || 20, unread: !!flags.unread, fts: !!flags.fts })).map(summarizeMessage);
  if (flags.json) console.log(JSON.stringify(rows, null, 2));
  else if (rows.length) printTable(rows, ['id', 'date', 'from', 'subject', 'read']);
  else console.log('(no messages)');
}

async function commandRead(flags) {
  const id = flags.id || flags._[0];
  if (!id) throw new Error('Usage: read --id <message-id> [--mark-read]');
  const cm = new CoremailClient(loadConfig());
  const mail = await cm.read({ id, markRead: !!flags['mark-read'], mode: flags['raw-html'] ? 'html' : 'html' });
  if (flags.json) {
    console.log(JSON.stringify(mail, null, 2));
    return;
  }
  console.log(`Subject: ${mail.subject ?? ''}`);
  console.log(`From: ${mail.from ?? ''}`);
  console.log(`To: ${mail.to ?? ''}`);
  if (mail.cc) console.log(`Cc: ${mail.cc}`);
  console.log(`Date: ${mail.sentDate ?? mail.receivedDate ?? ''}`);
  console.log('');
  if (flags['raw-html']) console.log(mail.html?.content ?? '');
  else console.log(mail.text?.content ?? mail.html?.content ?? '');
  if (mail.attachments?.length) {
    console.log('\nAttachments:');
    for (const a of mail.attachments) console.log(`- part=${a.id} ${a.filename ?? ''} ${a.contentType ?? ''} ${a.contentLength ?? ''}`);
  }
}


function parseEmailAddresses(value) {
  const values = Array.isArray(value) ? value : [value];
  const out = [];
  for (const item of values) {
    if (!item) continue;
    const text = String(item);
    const re = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
    const matches = text.match(re) || [];
    for (const m of matches) if (!out.includes(m)) out.push(m);
  }
  return out;
}

function attachmentOptions(flags) {
  return asArray(flags.attach).map(p => ({ path: p, filename: basename(p) }));
}

async function commandSend(flags) {
  const to = asArray(flags.to);
  if (!to.length) throw new Error('send needs --to');
  const body = await bodyFromFlags(flags);
  const client = createSdkClient(loadConfig(), { verbose: !!flags.verbose });
  await client.mail.send({
    to,
    subject: String(flags.subject ?? ''),
    body,
    html: !!flags.html,
    cc: asArray(flags.cc),
    bcc: asArray(flags.bcc),
    attachments: attachmentOptions(flags),
    priority: flags.priority ? Number(flags.priority) : undefined,
  });
  console.log(`sent: to=${to.join(',')} subject=${flags.subject ?? ''}`);
}

async function commandReply(flags) {
  const id = flags.id || flags._[0];
  if (!id) throw new Error('reply needs --id');
  const cfg = loadConfig();
  const body = await bodyFromFlags(flags);
  let overrideTo = asArray(flags.to);

  // The public SDK keeps threading via Coremail replyMessage, but some Claw
  // messages do not let Coremail infer recipients. In that case provide an
  // explicit recipient list derived from the original message, while still
  // using replyMessage -> compose(deliver) under the hood.
  if (!overrideTo.length) {
    const cm = new CoremailClient(cfg);
    const original = await cm.read({ id, markRead: false });
    if (flags.all) {
      const all = [
        ...parseEmailAddresses(original.from),
        ...parseEmailAddresses(original.to),
        ...parseEmailAddresses(original.cc),
      ].filter(addr => addr.toLowerCase() !== cfg.user.toLowerCase());
      overrideTo = all.length ? all : parseEmailAddresses(original.from || original.to);
    } else {
      overrideTo = parseEmailAddresses(original.from);
    }
  }

  const client = createSdkClient(cfg, { verbose: !!flags.verbose });
  await client.mail.reply({
    id,
    body,
    html: !!flags.html,
    toAll: false,
    overrideTo,
    cc: asArray(flags.cc),
    attachments: attachmentOptions(flags),
  });
  console.log(`replied: id=${id} to=${overrideTo.join(',')}`);
}

async function commandWatch(flags) {
  const cfg = loadConfig();
  const client = createSdkClient(cfg, { verbose: !!flags.verbose });
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    client.ws.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  client.ws.onMessage(async ({ mailId }) => {
    try {
      const mail = await client.mail.read({ id: mailId, markRead: !!flags['mark-read'] });
      const summary = { id: mailId, from: mail.from?.[0], to: mail.to, subject: mail.subject, date: mail.date, text: mail.text?.content?.slice(0, 500) };
      if (flags.json) console.log(JSON.stringify(summary));
      else console.log(`[new] ${summary.date ?? ''} ${summary.from ?? ''} | ${summary.subject ?? ''} | id=${mailId}`);
    } catch (e) {
      console.error('watch read failed:', formatError(e));
    }
  });
  client.ws.onDisconnect((reason) => {
    if (!stopped) console.error(`watch disconnected: ${reason}`);
  });
  await client.ws.connect();
  console.log(`watching ${cfg.user}; Ctrl-C to stop`);
  await new Promise(() => {});
}

function formatError(e) {
  if (e instanceof MailSdkError) return `[${e.code}] ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

async function main() {
  const [cmdRaw, ...rest] = process.argv.slice(2);
  const cmd = cmdRaw || 'help';
  const flags = parseFlags(rest);
  switch (cmd) {
    case 'help': case '--help': case '-h': usage(); break;
    case 'auth-from-url': await commandAuthFromUrl(flags); break;
    case 'check': await commandCheck(flags); break;
    case 'folders': await commandFolders(flags); break;
    case 'list': await commandList(flags); break;
    case 'search': await commandSearch(flags); break;
    case 'read': await commandRead(flags); break;
    case 'send': await commandSend(flags); break;
    case 'reply': await commandReply(flags); break;
    case 'watch': await commandWatch(flags); break;
    case 'accounts':
    case 'clawemail': commandAccounts(flags); break;
    default:
      usage();
      throw new Error(`Unknown command: ${cmd}`);
  }
}

main().catch((e) => {
  console.error(`error: ${formatError(e)}`);
  process.exit(1);
});
