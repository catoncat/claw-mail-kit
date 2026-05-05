/// <reference path="./worker-configuration.d.ts" />

import { authenticate } from './auth';
import type { AppContext, ClawMailbox, FolderSummary, MailboxRow } from './app-types';
import { ClawCoremailClient, parseEmailAddresses } from './claw-coremail';
import { ClawDashboardClient } from './claw-dashboard';
import {
  cacheMessageBody,
  getCachedMessage,
  getClawSettings,
  getMailboxByIdOrEmail,
  listMailboxes,
  listMessages,
  mailboxPublic,
  requireClawSettings,
  searchMessages,
  setMailboxAggregate,
  updateMailboxCommSettings,
  upsertMailbox,
} from './db';
import { errorResponse, HttpError, json, notFound, readJson, asArray, optionalString, parseBooleanFlag, parsePositiveInt, requireString } from './http';
import { coremailConfig, refreshActiveMailboxes, refreshMailboxFolder, resyncDashboard, syncDashboardFromCookie } from './refresh';

type RouteHandler = (app: AppContext, url: URL) => Promise<Response>;
type Body = Record<string, unknown>;

function host(env: Env): string {
  return env.CLAW_HOST || 'https://claw.163.com';
}

function timeoutMs(env: Env): number {
  const n = Number(env.CLAW_TIMEOUT_MS || 15000);
  return Number.isFinite(n) && n > 0 ? n : 15000;
}

async function routeApi(app: AppContext, url: URL): Promise<Response> {
  const { request } = app;
  if (request.method === 'GET' && url.pathname === '/api/me') return handleMe(app);
  if (request.method === 'POST' && url.pathname === '/api/claw/send-code') return handleSendCode(app);
  if (request.method === 'POST' && url.pathname === '/api/claw/verify-code') return handleVerifyCode(app);
  if (request.method === 'POST' && url.pathname === '/api/claw/refresh') return handleClawRefresh(app, url);

  if (request.method === 'GET' && url.pathname === '/api/mailboxes') return handleListMailboxes(app, url);
  if (request.method === 'POST' && url.pathname === '/api/mailboxes') return handleCreateMailbox(app);
  const mailboxAggregate = url.pathname.match(/^\/api\/mailboxes\/([^/]+)\/aggregate$/);
  if (request.method === 'POST' && mailboxAggregate) return handleMailboxAggregate(app, decodeURIComponent(mailboxAggregate[1] || ''));
  const mailboxComm = url.pathname.match(/^\/api\/mailboxes\/([^/]+)\/comm-settings$/);
  if (request.method === 'POST' && mailboxComm) return handleMailboxCommSettings(app, decodeURIComponent(mailboxComm[1] || ''));
  const mailboxDelete = url.pathname.match(/^\/api\/mailboxes\/([^/]+)$/);
  if (request.method === 'DELETE' && mailboxDelete) return handleDeleteMailbox(app, decodeURIComponent(mailboxDelete[1] || ''));

  if (request.method === 'GET' && url.pathname === '/api/folders') return handleFolders(app, url);
  if (request.method === 'GET' && url.pathname === '/api/messages') return handleMessages(app, url);
  if (request.method === 'GET' && url.pathname === '/api/search') return handleSearch(app, url);
  if (request.method === 'GET' && url.pathname === '/api/message') return handleMessage(app, url);
  if (request.method === 'POST' && url.pathname === '/api/mark') return handleMark(app, url);
  if (request.method === 'POST' && url.pathname === '/api/send') return handleSend(app, url);
  if (request.method === 'POST' && url.pathname === '/api/reply') return handleReply(app, url);

  return notFound();
}

async function handleMe({ env, identity }: AppContext): Promise<Response> {
  const settings = await getClawSettings(env.DB, env.APP_ENCRYPTION_KEY || '').catch(() => null);
  const mailboxes = await listMailboxes(env.DB).catch(() => []);
  const primary = mailboxes.find((item) => item.type === 'primary') || mailboxes[0];
  return json({
    ok: true,
    accessUser: { email: identity.email, name: identity.name },
    clawConnected: Boolean(settings),
    defaultUser: primary?.email || null,
    user: primary?.email || null,
    host: host(env),
    mailboxes: mailboxes.length,
  });
}

async function handleSendCode({ env, request }: AppContext): Promise<Response> {
  const body = await readJson<Body>(request);
  const email = requireString(body.email, 'email');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'invalid email');
  await new ClawDashboardClient({ host: host(env) }).sendLoginCode(email);
  return json({ ok: true });
}

async function handleVerifyCode({ env, request }: AppContext): Promise<Response> {
  const body = await readJson<Body>(request);
  const email = requireString(body.email, 'email');
  const code = requireString(body.code, 'code');
  if (!/^\d{4,8}$/.test(code)) throw new HttpError(400, 'invalid code');
  const client = new ClawDashboardClient({ host: host(env) });
  const cookie = await client.verifyLoginCode(email, code);
  const sync = await syncDashboardFromCookie(env, cookie);
  const refresh = await refreshActiveMailboxes(env);
  return json({ ok: true, connected: true, sync, refresh });
}

async function handleClawRefresh(app: AppContext, url: URL): Promise<Response> {
  const dashboard = await resyncDashboard(app.env);
  const foldersParam = url.searchParams.get('folders');
  const folders = foldersParam ? foldersParam.split(',').map((item) => item.trim()).filter(Boolean) : undefined;
  const refresh = await refreshActiveMailboxes(app.env, { folders });
  return json({ ok: true, dashboard, refresh });
}

async function handleListMailboxes({ env }: AppContext, url: URL): Promise<Response> {
  if (parseBooleanFlag(url.searchParams.get('sync'))) await resyncDashboard(env);
  const items = await listMailboxes(env.DB, { includeDeleted: parseBooleanFlag(url.searchParams.get('includeDeleted')) });
  return json({ ok: true, items: items.map(mailboxPublic) });
}

async function handleCreateMailbox({ env, request, ctx }: AppContext): Promise<Response> {
  const body = await readJson<Body>(request);
  const suffix = requireString(body.suffix ?? body.prefix, 'suffix');
  const displayName = optionalString(body.displayName);
  const settings = await requireClawSettings(env);
  const client = new ClawDashboardClient({
    host: host(env),
    cookie: settings.dashboardCookie,
    workspaceId: settings.workspaceId,
    parentMailboxId: settings.parentMailboxId,
  });
  const mailbox = await client.createMailbox({ suffix, displayName });
  const defaultComm = { commLevel: 2, extReceiveType: 1, extSendType: 1 };
  await client.updateCommunicationSettings(mailbox.id, defaultComm);
  const normalized: ClawMailbox = { ...mailbox, commLevel: 2, extReceiveType: 1, extSendType: 1 };
  await upsertMailbox(env.DB, normalized, true);
  const row = await getMailboxByIdOrEmail(env.DB, mailbox.id);
  if (row) ctx.waitUntil(refreshMailboxFolder(env, settings, row, '1').catch(() => undefined));
  return json({ ok: true, item: row ? mailboxPublic(row) : normalized }, 201);
}

async function handleMailboxAggregate({ env, request }: AppContext, id: string): Promise<Response> {
  const body = await readJson<Body>(request);
  const enabled = Boolean(body.enabled);
  const row = await setMailboxAggregate(env.DB, id, enabled);
  if (!row) throw new HttpError(404, 'mailbox not found');
  return json({ ok: true, item: mailboxPublic(row) });
}

async function handleMailboxCommSettings({ env, request }: AppContext, id: string): Promise<Response> {
  const body = await readJson<Body>(request);
  const commLevel = Number(body.commLevel);
  if (!Number.isInteger(commLevel) || commLevel < 0 || commLevel > 2) throw new HttpError(400, 'commLevel must be 0, 1, or 2');
  const extReceiveType = body.extReceiveType === undefined || body.extReceiveType === null ? undefined : Number(body.extReceiveType);
  const extSendType = body.extSendType === undefined || body.extSendType === null ? undefined : Number(body.extSendType);
  if (commLevel === 2 && (!Number.isInteger(extReceiveType) || !Number.isInteger(extSendType))) {
    throw new HttpError(400, 'extReceiveType and extSendType are required when commLevel is 2');
  }
  const settings = await requireClawSettings(env);
  const mailbox = await getMailboxByIdOrEmail(env.DB, id);
  if (!mailbox) throw new HttpError(404, 'mailbox not found');
  const payload = commLevel === 2
    ? { commLevel, extReceiveType: extReceiveType!, extSendType: extSendType! }
    : { commLevel };
  await new ClawDashboardClient({ host: host(env), cookie: settings.dashboardCookie }).updateCommunicationSettings(mailbox.id, payload);
  const row = await updateMailboxCommSettings(env.DB, mailbox.id, {
    commLevel,
    extReceiveType: commLevel === 2 ? extReceiveType : null,
    extSendType: commLevel === 2 ? extSendType : null,
  });
  return json({ ok: true, item: row ? mailboxPublic(row) : null });
}

async function handleDeleteMailbox({ env }: AppContext, id: string): Promise<Response> {
  const settings = await requireClawSettings(env);
  const mailbox = await getMailboxByIdOrEmail(env.DB, id);
  if (!mailbox) return json({ ok: true });
  if (mailbox.id === settings.parentMailboxId || mailbox.type === 'primary') throw new HttpError(400, 'primary mailbox cannot be deleted here');
  await new ClawDashboardClient({ host: host(env), cookie: settings.dashboardCookie }).deleteMailbox(mailbox.id);
  await env.DB.prepare('UPDATE mailboxes SET status = ?, updated_at = ? WHERE id = ?').bind('deleted', new Date().toISOString(), mailbox.id).run();
  return json({ ok: true });
}

async function resolveMailbox(env: Env, url: URL): Promise<MailboxRow> {
  const user = url.searchParams.get('user');
  if (user) {
    const row = await getMailboxByIdOrEmail(env.DB, user);
    if (!row || row.status === 'deleted') throw new HttpError(404, 'mailbox not found');
    return row;
  }
  const mailboxes = await listMailboxes(env.DB);
  const row = mailboxes.find((item) => item.type === 'primary') || mailboxes[0];
  if (!row) throw new HttpError(409, 'no mailbox is synced');
  return row;
}

async function handleFolders({ env }: AppContext, url: URL): Promise<Response> {
  const settings = await requireClawSettings(env);
  if (parseBooleanFlag(url.searchParams.get('aggregate'))) {
    const mailboxes = await listMailboxes(env.DB, { aggregateOnly: true });
    const perMailbox = await Promise.all(mailboxes.filter((item) => item.status === 'active').map(async (mailbox) => {
      try {
        const client = new ClawCoremailClient(coremailConfig(env, settings, mailbox.email));
        return await client.folders();
      } catch {
        return [] as FolderSummary[];
      }
    }));
    const byId = new Map<string, FolderSummary>();
    for (const folders of perMailbox) {
      for (const folder of folders) {
        const prev = byId.get(folder.id) || { ...folder, unreadCount: 0, messageCount: 0 };
        prev.name = prev.name || folder.name;
        prev.unreadCount += folder.unreadCount;
        prev.messageCount += folder.messageCount;
        byId.set(folder.id, prev);
      }
    }
    return json({ ok: true, aggregate: true, folders: [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id)) });
  }
  const mailbox = await resolveMailbox(env, url);
  const client = new ClawCoremailClient(coremailConfig(env, settings, mailbox.email));
  return json({ ok: true, user: mailbox.email, folders: await client.folders() });
}

async function handleMessages({ env }: AppContext, url: URL): Promise<Response> {
  const aggregate = parseBooleanFlag(url.searchParams.get('aggregate'));
  const fid = url.searchParams.get('fid') || '1';
  const limit = parsePositiveInt(url.searchParams.get('limit'), 40, 100);
  const unread = parseBooleanFlag(url.searchParams.get('unread'));
  const mailbox = aggregate ? null : await resolveMailbox(env, url);
  const messages = await listMessages(env.DB, { aggregate, mailboxEmail: mailbox?.email, folderId: fid, limit, unread });
  return json({ ok: true, aggregate, user: mailbox?.email, messages });
}

async function handleSearch({ env }: AppContext, url: URL): Promise<Response> {
  const aggregate = parseBooleanFlag(url.searchParams.get('aggregate'));
  const keyword = url.searchParams.get('keyword')?.trim();
  if (!keyword) throw new HttpError(400, 'missing keyword');
  const fid = url.searchParams.get('fid') || '1';
  const limit = parsePositiveInt(url.searchParams.get('limit'), 40, 100);
  const unread = parseBooleanFlag(url.searchParams.get('unread'));
  const mailbox = aggregate ? null : await resolveMailbox(env, url);
  const messages = await searchMessages(env.DB, { aggregate, mailboxEmail: mailbox?.email, folderId: fid, keyword, limit, unread });
  return json({ ok: true, aggregate, user: mailbox?.email, messages });
}

async function handleMessage({ env }: AppContext, url: URL): Promise<Response> {
  const id = url.searchParams.get('id');
  if (!id) throw new HttpError(400, 'missing id');
  const mailbox = await resolveMailbox(env, url);
  const markRead = parseBooleanFlag(url.searchParams.get('markRead'));
  if (!markRead) {
    const cached = await getCachedMessage(env.DB, mailbox.email, id);
    if (cached) return json({ ok: true, user: mailbox.email, mail: cached });
  }
  const settings = await requireClawSettings(env);
  const client = new ClawCoremailClient(coremailConfig(env, settings, mailbox.email));
  const mail = await client.read({ id, markRead });
  await cacheMessageBody(env.DB, mailbox.email, id, mail);
  if (markRead) await env.DB.prepare('UPDATE messages SET read = 1, updated_at = ? WHERE mailbox_email = ? AND provider_id = ?').bind(new Date().toISOString(), mailbox.email, id).run();
  return json({ ok: true, user: mailbox.email, mail });
}

async function handleMark({ env, request }: AppContext, url: URL): Promise<Response> {
  const body = await readJson<Body>(request);
  const mailbox = body.user ? await getMailboxByIdOrEmail(env.DB, String(body.user)) : await resolveMailbox(env, url);
  if (!mailbox) throw new HttpError(404, 'mailbox not found');
  const ids = asArray(body.ids || body.id);
  if (!ids.length) throw new HttpError(400, 'missing ids');
  const read = Boolean(body.read);
  const settings = await requireClawSettings(env);
  await new ClawCoremailClient(coremailConfig(env, settings, mailbox.email)).mark({ ids, read });
  await env.DB.batch(ids.map((id) => env.DB.prepare('UPDATE messages SET read = ?, updated_at = ? WHERE mailbox_email = ? AND provider_id = ?').bind(read ? 1 : 0, new Date().toISOString(), mailbox.email, id)));
  return json({ ok: true });
}

async function handleSend({ env, request, ctx }: AppContext, url: URL): Promise<Response> {
  const body = await readJson<Body>(request);
  const mailbox = body.user ? await getMailboxByIdOrEmail(env.DB, String(body.user)) : await resolveMailbox(env, url);
  if (!mailbox) throw new HttpError(404, 'mailbox not found');
  const to = asArray(body.to);
  if (!to.length) throw new HttpError(400, 'missing to');
  const settings = await requireClawSettings(env);
  const client = new ClawCoremailClient(coremailConfig(env, settings, mailbox.email));
  const result = await client.send({
    to,
    cc: asArray(body.cc),
    bcc: asArray(body.bcc),
    subject: optionalString(body.subject) || '',
    body: optionalString(body.body) || '',
    html: Boolean(body.html),
  });
  ctx.waitUntil(refreshSentFolder(env, settings, mailbox));
  return json({ ok: true, from: mailbox.email, result });
}

async function handleReply({ env, request, ctx }: AppContext, url: URL): Promise<Response> {
  const body = await readJson<Body>(request);
  const mailbox = body.user ? await getMailboxByIdOrEmail(env.DB, String(body.user)) : await resolveMailbox(env, url);
  if (!mailbox) throw new HttpError(404, 'mailbox not found');
  const id = requireString(body.id, 'id');
  const settings = await requireClawSettings(env);
  const client = new ClawCoremailClient(coremailConfig(env, settings, mailbox.email));
  let overrideTo = asArray(body.to);
  if (!overrideTo.length) {
    const original = await client.read({ id, markRead: false });
    if (body.all) {
      const all = [
        ...parseEmailAddresses(original.from),
        ...parseEmailAddresses(original.to),
        ...parseEmailAddresses(original.cc),
      ].filter((address) => address.toLowerCase() !== mailbox.email.toLowerCase());
      overrideTo = all.length ? all : parseEmailAddresses(original.from || original.to);
    } else {
      overrideTo = parseEmailAddresses(original.from);
    }
  }
  const result = await client.reply({
    id,
    body: optionalString(body.body) || '',
    html: Boolean(body.html),
    overrideTo,
    cc: asArray(body.cc),
  });
  ctx.waitUntil(refreshSentFolder(env, settings, mailbox));
  return json({ ok: true, from: mailbox.email, to: overrideTo, result });
}

async function refreshSentFolder(env: Env, settings: Awaited<ReturnType<typeof requireClawSettings>>, mailbox: MailboxRow): Promise<void> {
  await refreshMailboxFolder(env, settings, mailbox, '3').catch(() => undefined);
}

async function handleFetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  }
  if (url.pathname.startsWith('/api/')) {
    const identity = await authenticate(request, env);
    return routeApi({ env, ctx, request, identity }, url);
  }
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await handleFetch(request, env, ctx);
    } catch (error) {
      return errorResponse(error);
    }
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(refreshActiveMailboxes(env));
  },
} satisfies ExportedHandler<Env>;
