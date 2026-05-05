export type JsonObject = Record<string, unknown>;

export type AccessIdentity = {
  email: string;
  name?: string;
  sub?: string;
  aud?: string | string[];
};

export type AppContext = {
  env: Env;
  ctx: ExecutionContext;
  request: Request;
  identity: AccessIdentity;
};

export type ClawMailbox = {
  id: string;
  email: string;
  prefix: string;
  displayName?: string | null;
  mailboxType?: string | null;
  status?: string | null;
  openclawStatus?: string | null;
  installCommand?: string | null;
  authUrl?: string | null;
  commLevel?: number | null;
  extReceiveType?: number | null;
  extSendType?: number | null;
  createdAt?: string | null;
  raw?: unknown;
};

export type ClawWorkspace = {
  id: string;
  name: string;
  type?: string;
  status?: string;
};

export type ClawApiKey = {
  keyId?: string;
  name?: string;
  status?: string;
  defaultFlag?: number;
  apiKey: string;
  keyPrefix?: string;
  keySuffix?: string;
};

export type ClawAuthSettings = {
  apiKey: string;
  dashboardCookie: string;
  userEmail?: string | null;
  workspaceId: string;
  workspaceName?: string | null;
  parentMailboxId: string;
  rootPrefix: string;
  domain: string;
};

export type MailboxRow = {
  id: string;
  email: string;
  prefix: string | null;
  type: string;
  status: string;
  display_name: string | null;
  comm_level: number | null;
  ext_receive_type: number | null;
  ext_send_type: number | null;
  comm_settings_json: string | null;
  aggregate_enabled: number;
  openclaw_status: string | null;
  auth_url: string | null;
  raw_json: string | null;
  created_at: string | null;
  updated_at: string;
};

export type FolderSummary = {
  id: string;
  name: string;
  unreadCount: number;
  messageCount: number;
};

export type MessageSummary = {
  id: string;
  from?: unknown;
  to?: unknown;
  cc?: unknown;
  subject?: string | null;
  date?: string | null;
  size?: number;
  read?: boolean;
  hasAttachment?: boolean;
  preview?: string;
  user?: string;
  accountName?: string | null;
  accountType?: string;
};

export type MessageDetail = {
  id: string;
  from?: unknown;
  to?: unknown;
  cc?: unknown;
  bcc?: unknown;
  subject?: string | null;
  date?: string | null;
  sentDate?: string | null;
  receivedDate?: string | null;
  priority?: unknown;
  headerRaw?: string;
  text?: { id?: string; contentType?: string; content?: string };
  html?: { id?: string; contentType?: string; content?: string };
  attachments?: Array<{
    id: string;
    contentType?: string;
    contentLength?: number;
    filename?: string;
    inlined?: boolean;
    inline?: boolean;
    contentId?: string;
  }>;
  [key: string]: unknown;
};

export type CoremailConfig = {
  user: string;
  apiKey: string;
  host: string;
  timeoutMs: number;
};
