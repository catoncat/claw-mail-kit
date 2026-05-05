import type { ClawAuthSettings, ClawMailbox, MailboxRow, MessageDetail, MessageSummary } from './app-types';
import { decryptString, encryptString } from './crypto';
import { HttpError } from './http';

function nowIso(): string {
  return new Date().toISOString();
}

function jsonText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export async function setSetting(db: D1Database, key: string, value: string, encrypted = false, secret?: string): Promise<void> {
  const stored = encrypted ? await encryptString(value, secret || '') : value;
  await db.prepare(`
    INSERT INTO settings(key, value, encrypted, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      encrypted = excluded.encrypted,
      updated_at = excluded.updated_at
  `).bind(key, stored, encrypted ? 1 : 0, nowIso()).run();
}

export async function getSetting(db: D1Database, key: string, secret?: string): Promise<string | null> {
  const row = await db.prepare('SELECT value, encrypted FROM settings WHERE key = ?').bind(key).first<{ value: string; encrypted: number }>();
  if (!row) return null;
  if (row.encrypted) return decryptString(row.value, secret || '');
  return row.value;
}

export async function saveClawSettings(db: D1Database, settings: ClawAuthSettings, secret: string): Promise<void> {
  await db.batch([
    db.prepare('INSERT OR REPLACE INTO settings(key, value, encrypted, updated_at) VALUES (?, ?, 1, ?)')
      .bind('claw.apiKey', await encryptString(settings.apiKey, secret), nowIso()),
    db.prepare('INSERT OR REPLACE INTO settings(key, value, encrypted, updated_at) VALUES (?, ?, 1, ?)')
      .bind('claw.dashboardCookie', await encryptString(settings.dashboardCookie, secret), nowIso()),
    db.prepare('INSERT OR REPLACE INTO settings(key, value, encrypted, updated_at) VALUES (?, ?, 0, ?)')
      .bind('claw.userEmail', settings.userEmail || '', nowIso()),
    db.prepare('INSERT OR REPLACE INTO settings(key, value, encrypted, updated_at) VALUES (?, ?, 0, ?)')
      .bind('claw.workspaceId', settings.workspaceId, nowIso()),
    db.prepare('INSERT OR REPLACE INTO settings(key, value, encrypted, updated_at) VALUES (?, ?, 0, ?)')
      .bind('claw.workspaceName', settings.workspaceName || '', nowIso()),
    db.prepare('INSERT OR REPLACE INTO settings(key, value, encrypted, updated_at) VALUES (?, ?, 0, ?)')
      .bind('claw.parentMailboxId', settings.parentMailboxId, nowIso()),
    db.prepare('INSERT OR REPLACE INTO settings(key, value, encrypted, updated_at) VALUES (?, ?, 0, ?)')
      .bind('claw.rootPrefix', settings.rootPrefix, nowIso()),
    db.prepare('INSERT OR REPLACE INTO settings(key, value, encrypted, updated_at) VALUES (?, ?, 0, ?)')
      .bind('claw.domain', settings.domain, nowIso()),
  ]);
}

export async function getClawSettings(db: D1Database, secret: string): Promise<ClawAuthSettings | null> {
  const [apiKey, dashboardCookie, workspaceId, parentMailboxId, rootPrefix, domain, userEmail, workspaceName] = await Promise.all([
    getSetting(db, 'claw.apiKey', secret),
    getSetting(db, 'claw.dashboardCookie', secret),
    getSetting(db, 'claw.workspaceId'),
    getSetting(db, 'claw.parentMailboxId'),
    getSetting(db, 'claw.rootPrefix'),
    getSetting(db, 'claw.domain'),
    getSetting(db, 'claw.userEmail'),
    getSetting(db, 'claw.workspaceName'),
  ]);
  if (!apiKey || !dashboardCookie || !workspaceId || !parentMailboxId || !rootPrefix || !domain) return null;
  return { apiKey, dashboardCookie, workspaceId, parentMailboxId, rootPrefix, domain, userEmail, workspaceName };
}

export async function requireClawSettings(env: Env): Promise<ClawAuthSettings> {
  const settings = await getClawSettings(env.DB, env.APP_ENCRYPTION_KEY || '');
  if (!settings) throw new HttpError(409, 'Claw account is not connected');
  return settings;
}

export function normalizeMailbox(raw: Record<string, unknown>): ClawMailbox {
  const email = String(raw.email || raw.uid || '');
  const installCommand = typeof raw.installCommand === 'string' ? raw.installCommand : null;
  const authUrl = installCommand?.match(/--auth-url\s+"([^"]+)"/)?.[1] ?? null;
  return {
    id: String(raw.id || raw.uid || email),
    email,
    prefix: String(raw.prefix || email.split('@')[0] || ''),
    displayName: typeof raw.displayName === 'string' ? raw.displayName : null,
    mailboxType: typeof raw.mailboxType === 'string' ? raw.mailboxType : null,
    status: typeof raw.status === 'string' ? raw.status : 'active',
    openclawStatus: typeof raw.openclawStatus === 'string' ? raw.openclawStatus : null,
    installCommand,
    authUrl,
    commLevel: optionalNumber(raw.commLevel),
    extReceiveType: optionalNumber(raw.extReceiveType),
    extSendType: optionalNumber(raw.extSendType),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : null,
    raw,
  };
}

function optionalNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export async function upsertMailbox(db: D1Database, item: ClawMailbox, aggregateEnabled = true): Promise<void> {
  if (!item.email) throw new HttpError(500, 'mailbox missing email');
  const commSettings = {
    commLevel: item.commLevel,
    extReceiveType: item.extReceiveType,
    extSendType: item.extSendType,
  };
  await db.prepare(`
    INSERT INTO mailboxes(
      id, email, prefix, type, status, display_name,
      comm_level, ext_receive_type, ext_send_type, comm_settings_json,
      aggregate_enabled, openclaw_status, auth_url, raw_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      email = excluded.email,
      prefix = excluded.prefix,
      type = excluded.type,
      status = excluded.status,
      display_name = excluded.display_name,
      comm_level = excluded.comm_level,
      ext_receive_type = excluded.ext_receive_type,
      ext_send_type = excluded.ext_send_type,
      comm_settings_json = excluded.comm_settings_json,
      openclaw_status = excluded.openclaw_status,
      auth_url = excluded.auth_url,
      raw_json = excluded.raw_json,
      created_at = COALESCE(mailboxes.created_at, excluded.created_at),
      updated_at = excluded.updated_at
  `).bind(
    item.id,
    item.email.toLowerCase(),
    item.prefix,
    item.mailboxType || 'sub',
    item.status || 'active',
    item.displayName || null,
    item.commLevel,
    item.extReceiveType,
    item.extSendType,
    JSON.stringify(commSettings),
    aggregateEnabled ? 1 : 0,
    item.openclawStatus || null,
    item.authUrl || null,
    JSON.stringify(item.raw ?? item),
    item.createdAt || null,
    nowIso(),
  ).run();
}

export async function markMissingMailboxesDeleted(db: D1Database, remoteEmails: string[]): Promise<void> {
  const remoteSet = new Set(remoteEmails.map((email) => email.toLowerCase()));
  const rows = await listMailboxes(db, { includeDeleted: true });
  const stale = rows.filter((row) => !remoteSet.has(row.email.toLowerCase()) && row.status !== 'deleted');
  if (!stale.length) return;
  await db.batch(stale.map((row) => db.prepare('UPDATE mailboxes SET status = ?, updated_at = ? WHERE id = ?').bind('deleted', nowIso(), row.id)));
}

export async function listMailboxes(db: D1Database, opts: { includeDeleted?: boolean; aggregateOnly?: boolean } = {}): Promise<MailboxRow[]> {
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  if (!opts.includeDeleted) conditions.push("status != 'deleted'");
  if (opts.aggregateOnly) conditions.push('aggregate_enabled = 1');
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { results } = await db.prepare(`SELECT * FROM mailboxes ${where} ORDER BY type = 'primary' DESC, email ASC`).bind(...params).all<MailboxRow>();
  return results || [];
}

export async function getMailboxByIdOrEmail(db: D1Database, idOrEmail: string): Promise<MailboxRow | null> {
  return db.prepare('SELECT * FROM mailboxes WHERE id = ? OR email = ?').bind(idOrEmail, idOrEmail.toLowerCase()).first<MailboxRow>();
}

export async function setMailboxAggregate(db: D1Database, id: string, enabled: boolean): Promise<MailboxRow | null> {
  await db.prepare('UPDATE mailboxes SET aggregate_enabled = ?, updated_at = ? WHERE id = ?').bind(enabled ? 1 : 0, nowIso(), id).run();
  return getMailboxByIdOrEmail(db, id);
}

export async function updateMailboxCommSettings(
  db: D1Database,
  id: string,
  settings: { commLevel: number; extReceiveType?: number | null; extSendType?: number | null },
): Promise<MailboxRow | null> {
  await db.prepare(`
    UPDATE mailboxes SET
      comm_level = ?, ext_receive_type = ?, ext_send_type = ?, comm_settings_json = ?, updated_at = ?
    WHERE id = ?
  `).bind(
    settings.commLevel,
    settings.extReceiveType ?? null,
    settings.extSendType ?? null,
    JSON.stringify(settings),
    nowIso(),
    id,
  ).run();
  return getMailboxByIdOrEmail(db, id);
}

export function mailboxPublic(row: MailboxRow): Record<string, unknown> {
  return {
    id: row.id,
    email: row.email,
    prefix: row.prefix,
    type: row.type,
    status: row.status,
    displayName: row.display_name,
    commLevel: row.comm_level,
    extReceiveType: row.ext_receive_type,
    extSendType: row.ext_send_type,
    aggregateEnabled: Boolean(row.aggregate_enabled),
    openclawStatus: row.openclaw_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function upsertMessage(db: D1Database, mailboxEmail: string, folderId: string, message: MessageSummary): Promise<void> {
  const providerId = String(message.id || '');
  if (!providerId) return;
  const id = `${mailboxEmail.toLowerCase()}:${providerId}`;
  await db.prepare(`
    INSERT INTO messages(
      id, mailbox_email, provider_id, folder_id, subject, from_json, to_json, cc_json,
      preview, read, has_attachments, date, raw_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(mailbox_email, provider_id) DO UPDATE SET
      folder_id = excluded.folder_id,
      subject = excluded.subject,
      from_json = excluded.from_json,
      to_json = excluded.to_json,
      cc_json = excluded.cc_json,
      preview = COALESCE(excluded.preview, messages.preview),
      read = excluded.read,
      has_attachments = excluded.has_attachments,
      date = excluded.date,
      raw_json = excluded.raw_json,
      updated_at = excluded.updated_at
  `).bind(
    id,
    mailboxEmail.toLowerCase(),
    providerId,
    folderId,
    message.subject || null,
    jsonText(message.from),
    jsonText(message.to),
    jsonText(message.cc),
    message.preview || null,
    message.read ? 1 : 0,
    message.hasAttachment ? 1 : 0,
    message.date || null,
    JSON.stringify(message),
    nowIso(),
  ).run();
}

export async function cacheMessageBody(db: D1Database, mailboxEmail: string, providerId: string, mail: MessageDetail): Promise<void> {
  await db.prepare(`
    UPDATE messages SET
      subject = COALESCE(?, subject),
      from_json = COALESCE(?, from_json),
      to_json = COALESCE(?, to_json),
      cc_json = COALESCE(?, cc_json),
      cached_text = ?,
      cached_html = ?,
      has_attachments = ?,
      preview = COALESCE(?, preview),
      raw_json = ?,
      updated_at = ?
    WHERE mailbox_email = ? AND provider_id = ?
  `).bind(
    mail.subject || null,
    jsonText(mail.from),
    jsonText(mail.to),
    jsonText(mail.cc),
    mail.text?.content || null,
    mail.html?.content || null,
    mail.attachments?.length ? 1 : 0,
    plainPreview(mail),
    JSON.stringify(mail),
    nowIso(),
    mailboxEmail.toLowerCase(),
    providerId,
  ).run();
}

export async function setRefreshState(db: D1Database, mailboxEmail: string, folderId: string, input: { ok: boolean; error?: string; newestMessageDate?: string | null }): Promise<void> {
  await db.prepare(`
    INSERT INTO refresh_state(mailbox_email, folder_id, last_success_at, last_error_at, last_error, newest_message_date, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(mailbox_email, folder_id) DO UPDATE SET
      last_success_at = COALESCE(excluded.last_success_at, refresh_state.last_success_at),
      last_error_at = COALESCE(excluded.last_error_at, refresh_state.last_error_at),
      last_error = excluded.last_error,
      newest_message_date = COALESCE(excluded.newest_message_date, refresh_state.newest_message_date),
      updated_at = excluded.updated_at
  `).bind(
    mailboxEmail.toLowerCase(),
    folderId,
    input.ok ? nowIso() : null,
    input.ok ? null : nowIso(),
    input.ok ? null : (input.error || 'refresh failed').slice(0, 500),
    input.newestMessageDate || null,
    nowIso(),
  ).run();
}

type MessageRow = {
  mailbox_email: string;
  provider_id: string;
  folder_id: string;
  subject: string | null;
  from_json: string | null;
  to_json: string | null;
  cc_json: string | null;
  preview: string | null;
  read: number;
  has_attachments: number;
  date: string | null;
  cached_text: string | null;
  cached_html: string | null;
  raw_json: string | null;
  display_name: string | null;
  type: string | null;
};

function rowToMessage(row: MessageRow): MessageSummary {
  return {
    id: row.provider_id,
    from: parseJson(row.from_json, undefined),
    to: parseJson(row.to_json, undefined),
    cc: parseJson(row.cc_json, undefined),
    subject: row.subject,
    date: row.date,
    read: Boolean(row.read),
    hasAttachment: Boolean(row.has_attachments),
    preview: row.preview || plainFromCached(row.cached_text, row.cached_html),
    user: row.mailbox_email,
    accountName: row.display_name,
    accountType: row.type || undefined,
  };
}

export async function listMessages(
  db: D1Database,
  input: { aggregate: boolean; mailboxEmail?: string; folderId: string; limit: number; unread?: boolean },
): Promise<MessageSummary[]> {
  const params: Array<string | number> = [input.folderId];
  const conditions = ['m.folder_id = ?'];
  let join = 'LEFT JOIN mailboxes b ON b.email = m.mailbox_email';
  if (input.aggregate) {
    conditions.push("b.status = 'active'");
    conditions.push('b.aggregate_enabled = 1');
  } else {
    conditions.push('m.mailbox_email = ?');
    params.push((input.mailboxEmail || '').toLowerCase());
  }
  if (input.unread) conditions.push('m.read = 0');
  params.push(input.limit);
  const { results } = await db.prepare(`
    SELECT m.*, b.display_name, b.type
    FROM messages m ${join}
    WHERE ${conditions.join(' AND ')}
    ORDER BY datetime(m.date) DESC, m.updated_at DESC
    LIMIT ?
  `).bind(...params).all<MessageRow>();
  return (results || []).map(rowToMessage);
}

export async function searchMessages(
  db: D1Database,
  input: { aggregate: boolean; mailboxEmail?: string; folderId: string; keyword: string; limit: number; unread?: boolean },
): Promise<MessageSummary[]> {
  const like = `%${input.keyword}%`;
  const params: Array<string | number> = [input.folderId, like, like, like, like];
  const conditions = ['m.folder_id = ?', '(m.subject LIKE ? OR m.from_json LIKE ? OR m.to_json LIKE ? OR m.preview LIKE ?)'];
  if (input.aggregate) {
    conditions.push("b.status = 'active'");
    conditions.push('b.aggregate_enabled = 1');
  } else {
    conditions.push('m.mailbox_email = ?');
    params.push((input.mailboxEmail || '').toLowerCase());
  }
  if (input.unread) conditions.push('m.read = 0');
  params.push(input.limit);
  const { results } = await db.prepare(`
    SELECT m.*, b.display_name, b.type
    FROM messages m LEFT JOIN mailboxes b ON b.email = m.mailbox_email
    WHERE ${conditions.join(' AND ')}
    ORDER BY datetime(m.date) DESC, m.updated_at DESC
    LIMIT ?
  `).bind(...params).all<MessageRow>();
  return (results || []).map(rowToMessage);
}

export async function getCachedMessage(db: D1Database, mailboxEmail: string, providerId: string): Promise<MessageDetail | null> {
  const row = await db.prepare('SELECT raw_json, cached_text, cached_html, subject, from_json, to_json, cc_json, date FROM messages WHERE mailbox_email = ? AND provider_id = ?')
    .bind(mailboxEmail.toLowerCase(), providerId)
    .first<MessageRow>();
  if (!row) return null;
  const raw = parseJson<MessageDetail | null>(row.raw_json, null);
  if (raw && (row.cached_html || row.cached_text)) return raw;
  return null;
}

function plainFromCached(text?: string | null, html?: string | null): string {
  if (text) return text.replace(/\s+/g, ' ').trim().slice(0, 180);
  if (!html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function plainPreview(mail: MessageDetail): string {
  return plainFromCached(mail.text?.content, mail.html?.content);
}
