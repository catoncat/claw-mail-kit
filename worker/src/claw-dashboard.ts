import type { ClawApiKey, ClawAuthSettings, ClawMailbox, ClawWorkspace } from './app-types';
import { normalizeMailbox } from './db';
import { HttpError } from './http';

type DashboardEnvelope<T> = {
  code?: number;
  message?: string;
  success?: boolean;
  result?: T;
};

type DashboardInput = {
  host: string;
  cookie?: string;
  workspaceId?: string;
  parentMailboxId?: string;
};

function origin(host: string): string {
  return host.replace(/\/+$/, '');
}

function baseUrl(host: string): string {
  return `${origin(host)}/mailserv-claw-dashboard/api/v1`;
}

function publicBaseUrl(host: string): string {
  return `${origin(host)}/mailserv-claw-dashboard/p/v1`;
}

async function parseDashboardResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text.trim()) {
    if (!response.ok) throw new HttpError(502, `Claw dashboard error: HTTP ${response.status}`);
    return undefined as T;
  }
  let body: DashboardEnvelope<T>;
  try {
    body = JSON.parse(text) as DashboardEnvelope<T>;
  } catch {
    throw new HttpError(502, `Claw dashboard returned non-JSON response: HTTP ${response.status}`);
  }
  if (!response.ok || body.success !== true || body.code !== 200) {
    throw new HttpError(502, `Claw dashboard error: ${body.message || response.statusText || response.status}`);
  }
  return body.result as T;
}

function cookieHeaderFromSetCookie(headers: string[]): string {
  return headers
    .map((header) => header.split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ');
}

function readSetCookie(response: Response): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const list = headers.getSetCookie?.() || [];
  const fromList = cookieHeaderFromSetCookie(list);
  if (fromList) return fromList;
  const single = response.headers.get('set-cookie');
  return single ? cookieHeaderFromSetCookie([single]) : '';
}

function jsonHeaders(cookie?: string): HeadersInit {
  return {
    accept: 'application/json, text/plain, */*',
    'content-type': 'application/json',
    ...(cookie ? { cookie } : {}),
  };
}

function getHeaders(cookie: string): HeadersInit {
  return {
    accept: 'application/json, text/plain, */*',
    cookie,
  };
}

export class ClawDashboardClient {
  host: string;
  cookie?: string;
  workspaceId?: string;
  parentMailboxId?: string;

  constructor(input: DashboardInput) {
    this.host = input.host;
    this.cookie = input.cookie;
    this.workspaceId = input.workspaceId;
    this.parentMailboxId = input.parentMailboxId;
  }

  async sendLoginCode(email: string): Promise<void> {
    const response = await fetch(`${publicBaseUrl(this.host)}/auth/email/send-code`, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/plain, */*',
        'content-type': 'application/json',
        referer: `${origin(this.host)}/projects/dashboard/`,
      },
      body: JSON.stringify({ email }),
    });
    await parseDashboardResponse<unknown>(response);
  }

  async verifyLoginCode(email: string, code: string): Promise<string> {
    const response = await fetch(`${publicBaseUrl(this.host)}/auth/email/verify-code`, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/plain, */*',
        'content-type': 'application/json',
        referer: `${origin(this.host)}/projects/dashboard/`,
      },
      body: JSON.stringify({ email, code }),
    });
    await parseDashboardResponse<unknown>(response);
    const cookie = readSetCookie(response);
    if (!cookie) throw new HttpError(502, 'Claw login did not return a session cookie');
    return cookie;
  }

  async getAuthMe(cookie = this.requireCookie()): Promise<Record<string, unknown> | null> {
    const response = await fetch(`${baseUrl(this.host)}/auth/me`, { headers: getHeaders(cookie) });
    return parseDashboardResponse<Record<string, unknown> | null>(response);
  }

  async listWorkspaces(cookie = this.requireCookie()): Promise<ClawWorkspace[]> {
    const response = await fetch(`${baseUrl(this.host)}/workspaces`, { headers: getHeaders(cookie) });
    const result = await parseDashboardResponse<Record<string, unknown>>(response);
    return Array.isArray(result?.workspaces) ? result.workspaces as ClawWorkspace[] : [];
  }

  async listApiKeys(cookie = this.requireCookie()): Promise<ClawApiKey[]> {
    const response = await fetch(`${baseUrl(this.host)}/api-keys`, { headers: getHeaders(cookie) });
    const result = await parseDashboardResponse<unknown>(response);
    const maybe = result as { apiKeys?: unknown[]; items?: unknown[] };
    const candidates = Array.isArray(maybe?.apiKeys) ? maybe.apiKeys : Array.isArray(maybe?.items) ? maybe.items : Array.isArray(result) ? result : [];
    return candidates.filter((item): item is ClawApiKey => typeof (item as ClawApiKey)?.apiKey === 'string');
  }

  async listMailboxes(input: { cookie?: string; workspaceId?: string } = {}): Promise<ClawMailbox[]> {
    const cookie = input.cookie || this.requireCookie();
    const workspaceId = input.workspaceId || this.workspaceId;
    if (!workspaceId) throw new HttpError(409, 'workspaceId is not known');
    const response = await fetch(`${baseUrl(this.host)}/mailboxes?workspaceId=${encodeURIComponent(workspaceId)}`, {
      headers: getHeaders(cookie),
    });
    const result = await parseDashboardResponse<unknown>(response);
    const obj = result as { mailbox?: Record<string, unknown> & { subMailboxes?: Record<string, unknown>[] }; items?: unknown[]; list?: unknown[]; mailboxes?: unknown[] };
    if (obj?.mailbox) {
      const primary = normalizeMailbox(obj.mailbox);
      const children = Array.isArray(obj.mailbox.subMailboxes) ? obj.mailbox.subMailboxes.map((item) => normalizeMailbox(item)) : [];
      return [primary, ...children];
    }
    const candidates = Array.isArray(result)
      ? result
      : Array.isArray(obj?.items)
        ? obj.items
        : Array.isArray(obj?.list)
          ? obj.list
          : Array.isArray(obj?.mailboxes)
            ? obj.mailboxes
            : [];
    return candidates.map((item) => normalizeMailbox(item as Record<string, unknown>));
  }

  async createMailbox(input: { suffix: string; displayName?: string }): Promise<ClawMailbox> {
    const suffix = input.suffix.trim().toLowerCase();
    if (!/^[a-z0-9]{1,32}$/.test(suffix)) throw new HttpError(400, 'suffix must contain 1-32 lowercase letters or digits');
    if (!this.workspaceId || !this.parentMailboxId) throw new HttpError(409, 'Claw workspace is not synced');
    const response = await fetch(`${baseUrl(this.host)}/mailboxes`, {
      method: 'POST',
      headers: jsonHeaders(this.requireCookie()),
      body: JSON.stringify({
        prefix: suffix,
        displayName: input.displayName || suffix,
        mailboxType: 'sub',
        workspaceId: this.workspaceId,
        parentMailboxId: this.parentMailboxId,
      }),
    });
    return normalizeMailbox(await parseDashboardResponse<Record<string, unknown>>(response));
  }

  async updateCommunicationSettings(id: string, input: { commLevel: number; extReceiveType?: number; extSendType?: number }): Promise<void> {
    const response = await fetch(`${baseUrl(this.host)}/mailboxes/comm-settings?id=${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: jsonHeaders(this.requireCookie()),
      body: JSON.stringify(input),
    });
    await parseDashboardResponse<unknown>(response);
  }

  async deleteMailbox(id: string): Promise<void> {
    const response = await fetch(`${baseUrl(this.host)}/mailboxes/delete?id=${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: getHeaders(this.requireCookie()),
    });
    await parseDashboardResponse<unknown>(response);
  }

  requireCookie(): string {
    if (!this.cookie) throw new HttpError(409, 'Claw dashboard cookie is not saved');
    return this.cookie;
  }
}

function emailDomain(email: string): string {
  return email.split('@')[1] || 'claw.163.com';
}

function mailboxRootPrefix(mailbox: ClawMailbox): string {
  if (mailbox.prefix) return mailbox.prefix.split('@')[0]?.split('.')[0] || mailbox.prefix;
  return mailbox.email.split('@')[0]?.split('.')[0] || mailbox.email;
}

export async function buildAuthSettingsFromCookie(host: string, cookie: string): Promise<{ settings: ClawAuthSettings; mailboxes: ClawMailbox[] }> {
  const client = new ClawDashboardClient({ host, cookie });
  const [user, workspaces, apiKeys] = await Promise.all([
    client.getAuthMe(cookie),
    client.listWorkspaces(cookie),
    client.listApiKeys(cookie),
  ]);
  const workspace = workspaces.find((item) => item.status === 'active') || workspaces[0];
  if (!workspace) throw new HttpError(409, 'Claw account has no active workspace');
  const apiKey = apiKeys.find((item) => item.status === 'active' && item.defaultFlag === 1)
    || apiKeys.find((item) => item.status === 'active')
    || apiKeys[0];
  if (!apiKey?.apiKey) throw new HttpError(409, 'Claw account has no API key to use');
  const mailboxes = await client.listMailboxes({ cookie, workspaceId: workspace.id });
  const primary = mailboxes.find((item) => item.mailboxType === 'primary')
    || mailboxes.find((item) => !item.email.split('@')[0]?.includes('.'))
    || mailboxes[0];
  if (!primary) throw new HttpError(409, 'Claw account has no mailbox');
  const userEmail = typeof user?.email === 'string'
    ? user.email
    : typeof user?.emailAddress === 'string'
      ? user.emailAddress
      : null;
  return {
    settings: {
      apiKey: apiKey.apiKey,
      dashboardCookie: cookie,
      userEmail,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      parentMailboxId: primary.id,
      rootPrefix: mailboxRootPrefix(primary),
      domain: emailDomain(primary.email),
    },
    mailboxes,
  };
}
