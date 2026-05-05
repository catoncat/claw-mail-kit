import type { CoremailConfig, FolderSummary, MessageDetail, MessageSummary } from './app-types';
import { HttpError } from './http';

const FOLDER_ALIASES: Record<string, number> = {
  INBOX: 1, Inbox: 1, inbox: 1, '收件箱': 1,
  Drafts: 2, Draft: 2, '草稿箱': 2, '草稿': 2,
  Sent: 3, 'Sent Items': 3, '已发送': 3,
  Trash: 4, Deleted: 4, '已删除': 4, '垃圾箱': 4,
  Spam: 5, Junk: 5, '垃圾邮件': 5, '广告邮件': 5,
};

type CoremailEnvelope<T> = { code?: string; message?: string; var?: T; [key: string]: unknown };
type TokenEnvelope = { success?: boolean; result?: { accessToken?: string; expiresIn?: number }; message?: string };

function buildUrl(host: string, path: string): string {
  return new URL(path, host.endsWith('/') ? host : `${host}/`).toString();
}

function folderId(value: string | number = 'INBOX'): number {
  if (typeof value === 'number') return value;
  if (FOLDER_ALIASES[value] !== undefined) return FOLDER_ALIASES[value];
  const n = Number(value);
  if (!Number.isFinite(n)) throw new HttpError(400, `invalid folder id: ${value}`);
  return n;
}

async function postJson<T>(url: string, payload: unknown, bearer: string, timeoutMs = 15000): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify(payload ?? {}),
      signal: ac.signal,
    });
    const text = await response.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!response.ok) throw new HttpError(502, `Claw HTTP ${response.status}: ${JSON.stringify(data).slice(0, 300)}`);
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}

export class ClawCoremailClient {
  cfg: CoremailConfig;
  private cachedToken: string | null = null;
  private cachedExpiresAt = 0;

  constructor(cfg: CoremailConfig) {
    this.cfg = cfg;
  }

  async accessToken(): Promise<string> {
    if (this.cachedToken && this.cachedExpiresAt - Date.now() > 60_000) return this.cachedToken;
    const url = buildUrl(this.cfg.host, '/claw-api-gateway/open/v1/mail/auth/token');
    const data = await postJson<TokenEnvelope>(url, { uid: this.cfg.user }, this.cfg.apiKey, this.cfg.timeoutMs);
    if (data.success !== true || !data.result?.accessToken) {
      throw new HttpError(502, `Token fetch failed: ${data.message || 'missing accessToken'}`);
    }
    this.cachedToken = data.result.accessToken;
    this.cachedExpiresAt = Date.now() + Number(data.result.expiresIn || 1800) * 1000;
    return this.cachedToken;
  }

  async proxy<T = unknown>(func: string, payload: unknown = {}): Promise<T> {
    const token = await this.accessToken();
    const url = new URL(buildUrl(this.cfg.host, '/claw-api-gateway/api/coremail/proxy'));
    url.searchParams.set('uid', this.cfg.user);
    url.searchParams.set('func', func);
    const data = await postJson<CoremailEnvelope<T>>(url.toString(), payload, token, this.cfg.timeoutMs);
    if (data.code !== 'S_OK') {
      throw new HttpError(502, `Coremail ${func} failed: ${data.message || data.code || 'unknown error'}`);
    }
    return data.var as T;
  }

  async folders(): Promise<FolderSummary[]> {
    const raw = await this.proxy<unknown[]>('mbox:getAllFolders', { flush: true, stats: true, threads: false });
    return flattenFolders(raw || []);
  }

  async list(input: { fid?: string | number; limit?: number; start?: number; unread?: boolean; order?: string; desc?: boolean } = {}): Promise<MessageSummary[]> {
    const rows = await this.proxy<unknown[]>('mbox:listMessages', {
      fid: folderId(input.fid),
      order: input.order || 'date',
      desc: input.desc ?? true,
      start: Number(input.start || 0),
      limit: Number(input.limit || 30),
      ...(input.unread ? { filterFlags: { read: false } } : {}),
    });
    return (rows || []).map(summarizeMessage);
  }

  async search(input: { fid?: string | number; keyword?: string; from?: string; to?: string; subject?: string; unread?: boolean; limit?: number }): Promise<MessageSummary[]> {
    const conditions: unknown[] = [];
    if (input.keyword) {
      conditions.push({ operator: 'or', conditions: [
        { field: 'subject', operator: 'contains', operand: input.keyword, ignoreCase: true },
        { field: 'from', operator: 'contains', operand: input.keyword, ignoreCase: true },
        { field: 'to', operator: 'contains', operand: input.keyword, ignoreCase: true },
      ] });
    }
    if (input.from) conditions.push({ field: 'from', operator: 'contains', operand: input.from, ignoreCase: true });
    if (input.to) conditions.push({ field: 'to', operator: 'contains', operand: input.to, ignoreCase: true });
    if (input.subject) conditions.push({ field: 'subject', operator: 'contains', operand: input.subject, ignoreCase: true });
    if (input.unread) conditions.push({ field: 'flags', operator: '=', operand: { read: false } });
    if (!conditions.length) throw new HttpError(400, 'search needs keyword/from/to/subject/unread');
    const rows = await this.proxy<unknown[]>('mbox:searchMessages', {
      fid: folderId(input.fid),
      recursive: true,
      operator: 'and',
      conditions,
      limit: Number(input.limit || 30),
      windowSize: Number(input.limit || 30),
      order: 'date',
      desc: true,
    });
    return (rows || []).map(summarizeMessage);
  }

  async read(input: { id: string; markRead?: boolean }): Promise<MessageDetail> {
    const raw = await this.proxy<Record<string, unknown>>('mbox:readMessage', {
      id: input.id,
      mode: 'html',
      markRead: input.markRead ?? false,
      header: true,
      securityLevel: 1,
      filterLinks: false,
      filterImages: false,
    });
    return normalizeDetail(input.id, raw || {});
  }

  async mark(input: { ids: string[]; read: boolean }): Promise<void> {
    await this.proxy('mbox:updateMessageInfos', { ids: input.ids, attrs: { flags: { read: input.read } } });
  }

  async send(input: { to: string[]; subject?: string; body?: string; html?: boolean; cc?: string[]; bcc?: string[] }): Promise<{ status: 'sent' }> {
    if (!input.to.length) throw new HttpError(400, 'missing to');
    const attrs: Record<string, unknown> = {
      to: input.to,
      subject: input.subject || '',
      content: input.body || '',
      isHtml: Boolean(input.html),
      priority: 3,
      saveSentCopy: true,
    };
    if (input.cc?.length) attrs.cc = input.cc;
    if (input.bcc?.length) attrs.bcc = input.bcc;
    const compose = await this.proxy<unknown>('mbox:compose', { action: 'continue', attrs });
    const composeId = typeof compose === 'string' ? compose : (compose as { id?: string } | null)?.id;
    if (!composeId) throw new HttpError(502, 'compose did not return an id');
    await this.proxy('mbox:compose', { id: composeId, action: 'deliver', attrs });
    return { status: 'sent' };
  }

  async reply(input: { id: string; body?: string; html?: boolean; toAll?: boolean; overrideTo?: string[]; cc?: string[] }): Promise<{ status: 'sent' }> {
    const attrs: Record<string, unknown> = {
      content: input.body || '',
      isHtml: Boolean(input.html),
      saveSentCopy: true,
    };
    if (input.cc?.length) attrs.cc = input.cc;
    if (input.overrideTo?.length || input.cc?.length) {
      const compose = await this.proxy<unknown>('mbox:replyMessage', {
        id: input.id,
        toAll: Boolean(input.toAll),
        withAttachments: false,
        action: 'continue',
        attrs,
      });
      const composeId = typeof compose === 'string' ? compose : (compose as { id?: string } | null)?.id;
      if (!composeId) throw new HttpError(502, 'reply did not return an id');
      if (input.overrideTo?.length) attrs.to = input.overrideTo;
      await this.proxy('mbox:compose', { id: composeId, action: 'deliver', attrs });
    } else {
      await this.proxy('mbox:replyMessage', {
        id: input.id,
        toAll: Boolean(input.toAll),
        withAttachments: false,
        action: 'deliver',
        attrs,
      });
    }
    return { status: 'sent' };
  }
}

function flattenFolders(folders: unknown[], prefix = ''): FolderSummary[] {
  const out: FolderSummary[] = [];
  for (const item of folders) {
    const folder = item as { id?: string | number; name?: string; stats?: { unreadMessageCount?: number; messageCount?: number }; children?: unknown[] };
    const name = prefix ? `${prefix}/${folder.name || folder.id}` : String(folder.name || folder.id || '');
    out.push({
      id: String(folder.id),
      name,
      unreadCount: Number(folder.stats?.unreadMessageCount || 0),
      messageCount: Number(folder.stats?.messageCount || 0),
    });
    if (folder.children?.length) out.push(...flattenFolders(folder.children, name));
  }
  return out;
}

function summarizeMessage(value: unknown): MessageSummary {
  const msg = value as Record<string, unknown> & { flags?: { read?: boolean }; attachments?: unknown[] };
  const date = typeof msg.receivedDate === 'string'
    ? msg.receivedDate
    : typeof msg.sentDate === 'string'
      ? msg.sentDate
      : typeof msg.date === 'string'
        ? msg.date
        : null;
  const preview = typeof msg.snippet === 'string' ? msg.snippet : typeof msg.preview === 'string' ? msg.preview : '';
  return {
    id: String(msg.id || ''),
    from: msg.from,
    to: msg.to,
    cc: msg.cc,
    subject: typeof msg.subject === 'string' ? msg.subject : '',
    date,
    size: typeof msg.size === 'number' ? msg.size : undefined,
    read: Boolean(msg.flags?.read),
    hasAttachment: Boolean(msg.attachments?.length || msg.attachmentCount),
    preview,
  };
}

function normalizeDetail(id: string, raw: Record<string, unknown>): MessageDetail {
  return {
    id,
    from: raw.from,
    to: raw.to,
    cc: raw.cc,
    bcc: raw.bcc,
    subject: typeof raw.subject === 'string' ? raw.subject : null,
    date: typeof raw.sentDate === 'string' ? raw.sentDate : typeof raw.receivedDate === 'string' ? raw.receivedDate : null,
    sentDate: typeof raw.sentDate === 'string' ? raw.sentDate : null,
    receivedDate: typeof raw.receivedDate === 'string' ? raw.receivedDate : null,
    priority: raw.priority,
    headerRaw: typeof raw.headerRaw === 'string' ? raw.headerRaw : undefined,
    text: normalizePart(raw.text, 'text/plain'),
    html: normalizePart(raw.html, 'text/html'),
    attachments: Array.isArray(raw.attachments)
      ? raw.attachments.map((item) => {
          const a = item as Record<string, unknown>;
          return {
            id: String(a.id || ''),
            contentType: typeof a.contentType === 'string' ? a.contentType : 'application/octet-stream',
            contentLength: typeof a.contentLength === 'number' ? a.contentLength : undefined,
            filename: typeof a.filename === 'string' ? a.filename : undefined,
            inlined: Boolean(a.inlined),
            contentId: typeof a.contentId === 'string' ? a.contentId : undefined,
          };
        })
      : [],
    raw,
  };
}

function normalizePart(value: unknown, contentType: string): { id?: string; contentType?: string; content?: string } | undefined {
  const part = value as Record<string, unknown> | undefined;
  if (!part || typeof part.content !== 'string') return undefined;
  return {
    id: part.id === undefined ? undefined : String(part.id),
    contentType: typeof part.contentType === 'string' ? part.contentType : contentType,
    content: part.content,
  };
}

export function parseEmailAddresses(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const item of values) {
    if (!item) continue;
    const matches = String(item).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
    for (const match of matches) if (!out.includes(match)) out.push(match);
  }
  return out;
}
