import type { ClawAuthSettings, CoremailConfig, MailboxRow, MessageSummary } from './app-types';
import { ClawCoremailClient } from './claw-coremail';
import { ClawDashboardClient, buildAuthSettingsFromCookie } from './claw-dashboard';
import {
  getClawSettings,
  listMailboxes,
  markMissingMailboxesDeleted,
  pruneMessagesMissingFromFolderWindow,
  requireClawSettings,
  saveClawSettings,
  setRefreshState,
  upsertMailbox,
  upsertMessage,
} from './db';

function host(env: Env): string {
  return env.CLAW_HOST || 'https://claw.163.com';
}

function timeoutMs(env: Env): number {
  const n = Number(env.CLAW_TIMEOUT_MS || 15000);
  return Number.isFinite(n) && n > 0 ? n : 15000;
}

function refreshLimit(env: Env): number {
  const n = Number(env.REFRESH_LIMIT || 50);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 100) : 50;
}

export function refreshFolders(env: Env): string[] {
  const raw = env.REFRESH_FOLDERS || '1,3';
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

export function coremailConfig(env: Env, settings: ClawAuthSettings, user: string): CoremailConfig {
  return {
    user,
    apiKey: settings.apiKey,
    host: host(env),
    timeoutMs: timeoutMs(env),
  };
}

export async function syncDashboardFromCookie(env: Env, cookie: string): Promise<{ syncedMailboxes: number; parentMailbox?: string }> {
  const { settings, mailboxes } = await buildAuthSettingsFromCookie(host(env), cookie);
  await saveClawSettings(env.DB, settings, env.APP_ENCRYPTION_KEY || '');
  await Promise.all(mailboxes.map((mailbox) => upsertMailbox(env.DB, mailbox, mailbox.status !== 'disabled')));
  await markMissingMailboxesDeleted(env.DB, mailboxes.map((mailbox) => mailbox.email));
  return { syncedMailboxes: mailboxes.length, parentMailbox: mailboxes.find((item) => item.id === settings.parentMailboxId)?.email };
}

export async function resyncDashboard(env: Env): Promise<{ syncedMailboxes: number; parentMailbox?: string }> {
  const settings = await requireClawSettings(env);
  const client = new ClawDashboardClient({
    host: host(env),
    cookie: settings.dashboardCookie,
    workspaceId: settings.workspaceId,
    parentMailboxId: settings.parentMailboxId,
  });
  const mailboxes = await client.listMailboxes();
  await Promise.all(mailboxes.map((mailbox) => upsertMailbox(env.DB, mailbox, mailbox.status !== 'disabled')));
  await markMissingMailboxesDeleted(env.DB, mailboxes.map((mailbox) => mailbox.email));
  return { syncedMailboxes: mailboxes.length, parentMailbox: mailboxes.find((item) => item.id === settings.parentMailboxId)?.email };
}

export async function refreshMailboxFolder(env: Env, settings: ClawAuthSettings, mailbox: MailboxRow, folderId: string): Promise<number> {
  const client = new ClawCoremailClient(coremailConfig(env, settings, mailbox.email));
  try {
    const limit = refreshLimit(env);
    const messages = await client.list({ fid: folderId, limit });
    await Promise.all(messages.map((message: MessageSummary) => upsertMessage(env.DB, mailbox.email, folderId, message)));
    const newest = messages[0]?.date || null;
    const oldestInWindow = messages.length >= limit ? messages.at(-1)?.date || null : null;
    await pruneMessagesMissingFromFolderWindow(
      env.DB,
      mailbox.email,
      folderId,
      messages.map((message) => message.id).filter(Boolean),
      oldestInWindow,
    );
    await setRefreshState(env.DB, mailbox.email, folderId, { ok: true, newestMessageDate: newest });
    return messages.length;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setRefreshState(env.DB, mailbox.email, folderId, { ok: false, error: message });
    throw error;
  }
}

export async function refreshActiveMailboxes(env: Env, input: { folders?: string[]; includeDisabledAggregate?: boolean } = {}): Promise<{ mailboxes: number; folders: number; messages: number; errors: Array<{ mailbox: string; folder: string; error: string }> }> {
  const settings = await getClawSettings(env.DB, env.APP_ENCRYPTION_KEY || '');
  if (!settings) return { mailboxes: 0, folders: 0, messages: 0, errors: [] };
  const folders = input.folders?.length ? input.folders : refreshFolders(env);
  const mailboxes = await listMailboxes(env.DB, { aggregateOnly: !input.includeDisabledAggregate });
  let messages = 0;
  const errors: Array<{ mailbox: string; folder: string; error: string }> = [];
  for (const mailbox of mailboxes.filter((item) => item.status === 'active')) {
    for (const folder of folders) {
      try {
        messages += await refreshMailboxFolder(env, settings, mailbox, folder);
      } catch (error) {
        errors.push({ mailbox: mailbox.email, folder, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  return { mailboxes: mailboxes.length, folders: folders.length, messages, errors };
}
