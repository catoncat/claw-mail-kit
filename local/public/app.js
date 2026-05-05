const DEFAULT_FID = '1';

const state = {
  fid: DEFAULT_FID,
  title: '收件箱',
  messages: [],
  selected: null,
  mode: 'inbox',
  composerReplyId: null,
  composerReplyUser: null,
  defaultUser: null,
  user: null,
  aggregate: true,
  events: null,
};

const $ = (id) => document.getElementById(id);
const els = {
  account: $('account'), folders: $('folders'), accounts: $('accounts'), createAccountBtn: $('createAccountBtn'), composeBtn: $('composeBtn'), refreshBtn: $('refreshBtn'), inboxBtn: $('inboxBtn'),
  searchForm: $('searchForm'), searchInput: $('searchInput'), unreadOnly: $('unreadOnly'), listTitle: $('listTitle'), listMeta: $('listMeta'), messageList: $('messageList'),
  emptyReader: $('emptyReader'), reader: $('reader'), readDate: $('readDate'), readSubject: $('readSubject'), readFrom: $('readFrom'), readRecipients: $('readRecipients'), mailFrame: $('mailFrame'), attachments: $('attachments'),
  mobileBackBtn: $('mobileBackBtn'), markReadBtn: $('markReadBtn'), replyBtn: $('replyBtn'), liveDot: $('liveDot'), liveText: $('liveText'), toast: $('toast'),
  composer: $('composer'), composerForm: $('composerForm'), composerTitle: $('composerTitle'), composerHint: $('composerHint'), composeTo: $('composeTo'), composeCc: $('composeCc'), composeSubject: $('composeSubject'), composeBody: $('composeBody'), composeHtml: $('composeHtml'), composeStatus: $('composeStatus'), sendBtn: $('sendBtn'), accountResultDialog: $('accountResultDialog'), accountResult: $('accountResult'), copyAccountResultBtn: $('copyAccountResultBtn'),
};

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.add('hidden'), 2600);
}

function fmtDate(s) {
  if (!s) return '';
  return String(s).replace('T', ' ').replace(/\.\d+Z$/, '');
}

function stripAddress(v) {
  return String(v || '').replace(/^"?([^"<]+)"?\s*<(.+)>$/, '$1 <$2>');
}

function htmlDoc(mail) {
  const html = mail.html?.content;
  const text = mail.text?.content;
  const body = html || `<pre>${escapeHtml(text || '')}</pre>`;
  return `<!doctype html><html><head><base target="_blank"><meta charset="utf-8"><style>
    :root{--claw-ink:#111111;--claw-muted:#6e6558;--claw-paper:#fffaf0;--claw-yellow:#ffd93d;--claw-line:#111111}
    html{-webkit-font-smoothing:antialiased}
    body{margin:0;padding:24px;font:15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--claw-ink);background:var(--claw-paper);text-wrap:pretty}
    img{max-width:100%;height:auto;outline:2px solid rgba(17,17,17,.16)}
    a{color:var(--claw-ink);text-decoration-thickness:3px;text-decoration-color:var(--claw-yellow);text-underline-offset:3px}
    pre{white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
    blockquote{border-left:3px solid var(--claw-line);margin-left:0;padding-left:14px;color:var(--claw-muted);background:rgba(255,217,61,.18)}
    @media (max-width:480px){body{padding:16px;font-size:16px;line-height:1.62}pre{font-size:13px;overflow:auto}}</style></head><body>${body}</body></html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function userParam(prefix = '?') {
  return state.user ? `${prefix}user=${encodeURIComponent(state.user)}` : '';
}

function scopedPath(path, params = {}) {
  const search = new URLSearchParams(params);
  if (state.aggregate) search.set('aggregate', '1');
  else if (state.user) search.set('user', state.user);
  return `${path}?${search.toString()}`;
}

function setActiveUser(user, { aggregate = false } = {}) {
  state.aggregate = aggregate;
  state.user = aggregate ? null : (user || state.defaultUser);
  els.account.textContent = aggregate ? '全部邮箱' : (state.user || '当前邮箱');
}

function currentScopeLabel() {
  return state.aggregate ? '全部邮箱' : (state.user || '当前邮箱');
}

function currentTitle() {
  return `${currentScopeLabel()} · ${state.title || '收件箱'}`;
}

function showMobileList() {
  document.body.classList.remove('reader-open');
}

function showMobileReader() {
  document.body.classList.add('reader-open');
}

async function loadMe() {
  const data = await api('/api/me');
  state.defaultUser = data.defaultUser || data.user;
  setActiveUser(null, { aggregate: true });
}


function flattenAccounts(mailbox) {
  if (!mailbox) return [];
  return [mailbox, ...(mailbox.subMailboxes || [])];
}

async function loadAccounts() {
  if (!els.accounts) return;
  try {
    const data = await api('/api/accounts');
    const mailbox = data.result?.data?.mailbox;
    const accounts = flattenAccounts(mailbox);
    els.accounts.innerHTML = '';
    const allRow = document.createElement('button');
    allRow.type = 'button';
    allRow.className = `account-row aggregate-account ${state.aggregate ? 'active-account' : ''}`;
    allRow.setAttribute('aria-pressed', state.aggregate ? 'true' : 'false');
    allRow.title = '查看所有邮箱在当前文件夹里的聚合邮件';
    allRow.innerHTML = '<div><strong>全部邮箱</strong><span>聚合所有启用邮箱，文件夹仍在上方选择</span></div><em>当前范围</em>';
    allRow.addEventListener('click', () => switchAccount(null, { aggregate: true }));
    els.accounts.append(allRow);
    for (const acc of accounts) {
      const row = document.createElement('button');
      row.type = 'button';
      const email = acc.email || acc.uid;
      row.className = `account-row ${acc.mailboxType === 'primary' ? 'primary-account' : ''} ${!state.aggregate && email === state.user ? 'active-account' : ''}`;
      row.setAttribute('aria-pressed', (!state.aggregate && email === state.user) ? 'true' : 'false');
      row.title = `点击查看 ${email}`;
      row.innerHTML = `<div><strong>${escapeHtml(acc.displayName || acc.prefix || acc.email)}</strong><span>${escapeHtml(acc.email || acc.uid)}</span></div><em>${acc.mailboxType === 'primary' ? '主邮箱' : '子邮箱'}</em>`;
      row.addEventListener('click', () => switchAccount(email));
      els.accounts.append(row);
    }
  } catch (err) {
    els.accounts.innerHTML = `<div class="account-error">${escapeHtml(err.message)}</div>`;
  }
}

async function switchAccount(user, { aggregate = false } = {}) {
  if (!aggregate && user === state.user && !state.aggregate) return;
  if (aggregate && state.aggregate) return;
  setActiveUser(user, { aggregate });
  state.selected = null;
  showMobileList();
  els.emptyReader.classList.remove('hidden');
  els.reader.classList.add('hidden');
  connectEvents();
  const q = state.mode === 'search' ? els.searchInput.value.trim() : '';
  await Promise.all([loadFolders(), loadAccounts(), q ? searchMessages(q) : loadMessages()]);
}

async function createSubAccount() {
  const prefix = prompt('子邮箱后缀 prefix，例如 bot1：');
  if (!prefix) return;
  const displayName = prompt('显示名 display name：', prefix) || prefix;
  const data = await api('/api/accounts/create', {
    method: 'POST',
    body: JSON.stringify({ prefix, displayName, type: 'sub' }),
  });
  const pretty = JSON.stringify(data.result, null, 2);
  els.accountResult.textContent = pretty;
  els.accountResultDialog.showModal();
  await loadAccounts();
  toast('子邮箱已创建，auth code 已保存到 .secrets/');
}

async function loadFolders() {
  els.folders.innerHTML = '';
  const data = await api(state.aggregate ? '/api/folders?aggregate=1' : `/api/folders${userParam()}`);
  for (const f of data.folders) {
    const btn = document.createElement('button');
    btn.className = `folder ${String(f.id) === String(state.fid) ? 'active' : ''}`;
    btn.title = `${currentScopeLabel()} · ${f.name}`;
    const showUnreadBadge = String(f.id) === '1' && Number(f.unreadCount) > 0;
    btn.innerHTML = `<span class="folder-name">${escapeHtml(f.name)}</span>${showUnreadBadge ? `<span class="badge" title="收件箱未读">${f.unreadCount}</span>` : ''}`;
    btn.addEventListener('click', async () => {
      state.fid = f.id;
      state.title = f.name;
      state.mode = 'folder';
      state.selected = null;
      els.searchInput.value = '';
      showMobileList();
      els.emptyReader.classList.remove('hidden');
      els.reader.classList.add('hidden');
      await Promise.all([loadMessages(), loadFolders()]);
    });
    els.folders.append(btn);
  }
}

async function loadMessages() {
  els.listTitle.textContent = currentTitle();
  els.listMeta.textContent = '加载中…';
  els.messageList.innerHTML = '';
  const params = { fid: state.fid, limit: '40', preview: '1' };
  if (els.unreadOnly.checked) params.unread = '1';
  const data = await api(scopedPath('/api/messages', params));
  state.messages = data.messages;
  renderMessages();
}

async function searchMessages(q) {
  state.mode = 'search';
  state.title = `搜索：${q}`;
  state.selected = null;
  showMobileList();
  els.listTitle.textContent = currentTitle();
  els.listMeta.textContent = '搜索中…';
  els.messageList.innerHTML = '';
  const params = { fid: state.fid, limit: '40', preview: '1', keyword: q };
  if (els.unreadOnly.checked) params.unread = '1';
  const data = await api(scopedPath('/api/search', params));
  state.messages = data.messages;
  renderMessages();
}

function messageKey(m) {
  const id = String(m?.id ?? '');
  return state.aggregate ? `${m?.user || ''}::${id}` : id;
}

function selectedMessage() {
  return state.messages.find(m => messageKey(m) === state.selected) || null;
}

function renderMessages() {
  els.messageList.innerHTML = '';
  els.listMeta.textContent = `${state.messages.length} 封邮件`;
  if (!state.messages.length) {
    els.messageList.innerHTML = '<div class="empty-state"><p>没有邮件</p></div>';
    return;
  }
  for (const m of state.messages) {
    const btn = document.createElement('button');
    const key = messageKey(m);
    btn.className = `message-item ${m.read ? '' : 'unread'} ${state.selected === key ? 'active' : ''}`;
    btn.innerHTML = `<div class="message-top"><span class="message-from">${escapeHtml(stripAddress(m.from))}</span><span>${escapeHtml(fmtDate(m.date).slice(0,16))}</span></div>${state.aggregate ? `<div class="message-account">${escapeHtml(m.user || '')}</div>` : ''}<div class="message-subject">${escapeHtml(m.subject || '(无主题)')}</div>${m.preview ? `<div class="message-preview">${escapeHtml(m.preview)}</div>` : ''}`;
    btn.addEventListener('click', () => openMessage(m));
    els.messageList.append(btn);
  }
}

async function openMessage(messageOrId, markRead = true) {
  const msg = typeof messageOrId === 'object'
    ? messageOrId
    : state.messages.find(m => String(m.id) === String(messageOrId));
  if (!msg) return;
  state.selected = messageKey(msg);
  renderMessages();
  const readUser = state.aggregate ? msg?.user : state.user;
  const params = new URLSearchParams({ id: msg.id, markRead: markRead ? '1' : '0' });
  if (readUser) params.set('user', readUser);
  const data = await api(`/api/message?${params.toString()}`);
  const mail = data.mail;
  showMobileReader();
  els.emptyReader.classList.add('hidden');
  els.reader.classList.remove('hidden');
  els.readDate.textContent = fmtDate(mail.sentDate || mail.receivedDate || mail.date);
  els.readSubject.textContent = mail.subject || '(无主题)';
  els.readFrom.textContent = `From: ${stripAddress(mail.from || '')}`;
  els.readRecipients.textContent = `To: ${mail.to || ''}${mail.cc ? ` · Cc: ${mail.cc}` : ''}`;
  els.mailFrame.srcdoc = htmlDoc(mail);
  els.attachments.innerHTML = '';
  for (const a of mail.attachments || []) {
    const chip = document.createElement('span');
    chip.className = 'attachment';
    chip.textContent = `${a.filename || `part-${a.id}`} ${a.contentLength ? `· ${Math.round(a.contentLength / 1024)}KB` : ''}`;
    els.attachments.append(chip);
  }
  const found = selectedMessage();
  if (found) found.read = true;
  renderMessages();
}

function openComposer({ replyMessage = null, replyId = null, to = '', subject = '', body = '' } = {}) {
  state.composerReplyId = replyMessage?.id || replyId;
  state.composerReplyUser = replyMessage?.user || (!state.aggregate ? state.user : null);
  els.composerTitle.textContent = state.composerReplyId ? '回复邮件' : '写邮件';
  const fromUser = state.composerReplyUser || (state.aggregate ? state.defaultUser : state.user);
  els.composerHint.textContent = state.composerReplyId
    ? `将以 ${fromUser} 回复线程：${state.composerReplyId}`
    : `从 ${fromUser || '默认邮箱'} 发送`;
  els.composeTo.value = to;
  els.composeCc.value = '';
  els.composeSubject.value = subject;
  els.composeBody.value = body;
  els.composeHtml.checked = false;
  els.composeStatus.textContent = '';
  if (state.composerReplyId) els.composeTo.placeholder = '留空 = 自动回复发件人';
  else els.composeTo.placeholder = 'a@example.com, b@example.com';
  els.composer.showModal();
  setTimeout(() => (state.composerReplyId ? els.composeBody : els.composeTo).focus(), 50);
}

async function sendComposer() {
  els.sendBtn.disabled = true;
  els.composeStatus.textContent = '发送中…';
  try {
    const payload = {
      to: els.composeTo.value,
      cc: els.composeCc.value,
      subject: els.composeSubject.value,
      body: els.composeBody.value,
      html: els.composeHtml.checked,
      user: state.composerReplyId ? state.composerReplyUser : (state.aggregate ? state.defaultUser : state.user),
    };
    if (state.composerReplyId) {
      payload.id = state.composerReplyId;
      await api('/api/reply', { method: 'POST', body: JSON.stringify(payload) });
      toast('回复已发送');
    } else {
      await api('/api/send', { method: 'POST', body: JSON.stringify(payload) });
      toast('邮件已发送');
    }
    els.composer.close();
    await Promise.all([loadFolders(), loadAccounts(), loadMessages()]);
  } catch (err) {
    els.composeStatus.textContent = err.message;
  } finally {
    els.sendBtn.disabled = false;
  }
}

function connectEvents() {
  if (state.events) state.events.close();
  if (state.aggregate) { setLive('connecting', '聚合视图：手动刷新或切单邮箱实时监听'); return; }
  const es = new EventSource(`/api/events${userParam()}`);
  state.events = es;
  es.addEventListener('hello', () => setLive('connecting', '实时推送连接中'));
  es.addEventListener('watcher', (ev) => {
    const data = JSON.parse(ev.data || '{}');
    if (data.status === 'connected') setLive('live', '实时推送已连接');
    else if (data.status === 'error') setLive('error', '实时推送异常，仍可手动刷新');
    else setLive('connecting', '实时推送重连中');
  });
  es.addEventListener('mail', async () => {
    toast('收到新邮件，列表已刷新');
    await Promise.all([loadFolders(), loadAccounts(), loadMessages()]);
  });
  es.onerror = () => setLive('error', '浏览器事件流断开');
}

function setLive(kind, text) {
  els.liveDot.className = `dot ${kind === 'live' ? 'live' : kind === 'error' ? 'error' : ''}`;
  els.liveText.textContent = text;
}

els.composeBtn.addEventListener('click', () => openComposer());
els.createAccountBtn?.addEventListener('click', () => createSubAccount().catch(err => toast(err.message)));
els.copyAccountResultBtn?.addEventListener('click', async () => { await navigator.clipboard.writeText(els.accountResult.textContent || ''); toast('已复制'); });
els.mobileBackBtn?.addEventListener('click', showMobileList);
els.replyBtn.addEventListener('click', () => { const msg = selectedMessage(); if (msg) openComposer({ replyMessage: msg }); });
els.sendBtn.addEventListener('click', sendComposer);
els.refreshBtn.addEventListener('click', async () => { await Promise.all([loadFolders(), loadAccounts(), loadMessages()]); toast('已刷新'); });
els.inboxBtn?.addEventListener('click', async () => { state.fid = DEFAULT_FID; state.title = '收件箱'; state.mode = 'inbox'; els.searchInput.value = ''; state.selected = null; showMobileList(); setActiveUser(null, { aggregate: true }); connectEvents(); await Promise.all([loadFolders(), loadAccounts(), loadMessages()]); });
els.unreadOnly.addEventListener('change', () => state.mode === 'search' && els.searchInput.value ? searchMessages(els.searchInput.value) : loadMessages());
els.searchForm.addEventListener('submit', (ev) => { ev.preventDefault(); const q = els.searchInput.value.trim(); q ? searchMessages(q) : loadMessages(); });
els.markReadBtn.addEventListener('click', async () => {
  const msg = selectedMessage();
  if (!msg) return;
  await api('/api/mark', { method: 'POST', body: JSON.stringify({ id: msg.id, read: true, user: state.aggregate ? msg.user : state.user }) });
  toast('已标记为已读');
  await Promise.all([loadFolders(), loadAccounts(), loadMessages()]);
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'r' && (ev.metaKey || ev.ctrlKey)) return;
  if (ev.key === 'c' && !ev.metaKey && !ev.ctrlKey && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') openComposer();
});

async function boot() {
  try {
    await loadMe();
    await Promise.all([loadFolders(), loadAccounts(), loadMessages()]);
    connectEvents();
  } catch (err) {
    toast(err.message);
    els.listMeta.textContent = err.message;
  }
}

boot();
