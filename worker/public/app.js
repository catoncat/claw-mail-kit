const DEFAULT_FID = '1';
const VISIBLE_FOLDERS = [
  { id: '1', name: '收件箱' },
  { id: '3', name: '已发送' },
  { id: '4', name: '已删除' },
];
const VISIBLE_FOLDER_IDS = new Set(VISIBLE_FOLDERS.map((f) => f.id));
const state = { connected:false, aggregate:true, user:null, defaultUser:null, fid:DEFAULT_FID, title:'收件箱', mode:'folder', messages:[], selected:null, replyId:null, replyUser:null, navCollapsed:false, mailboxes:[], commTarget:null };
const $ = (id) => document.getElementById(id);
const els = {
  setup:$('setup'), app:$('app'), navToggleBtn:$('navToggleBtn'), accessUser:$('accessUser'), loginEmail:$('loginEmail'), loginCode:$('loginCode'), sendCodeBtn:$('sendCodeBtn'), verifyCodeBtn:$('verifyCodeBtn'), connectForm:$('connectForm'), setupStatus:$('setupStatus'),
  account:$('account'), folders:$('folders'), mailboxes:$('mailboxes'), createMailboxBtn:$('createMailboxBtn'), composeBtn:$('composeBtn'), refreshBtn:$('refreshBtn'), searchForm:$('searchForm'), searchInput:$('searchInput'), unreadOnly:$('unreadOnly'), listTitle:$('listTitle'), listMeta:$('listMeta'), messageList:$('messageList'),
  emptyReader:$('emptyReader'), reader:$('reader'), readDate:$('readDate'), readSubject:$('readSubject'), readFrom:$('readFrom'), readRecipients:$('readRecipients'), mailFrame:$('mailFrame'), attachments:$('attachments'), deleteBtn:$('deleteBtn'), replyBtn:$('replyBtn'),
  composerDialog:$('composerDialog'), composerForm:$('composerForm'), composerTitle:$('composerTitle'), composerHint:$('composerHint'), composeTo:$('composeTo'), composeCc:$('composeCc'), composeSubject:$('composeSubject'), composeBody:$('composeBody'), composeHtml:$('composeHtml'), composeStatus:$('composeStatus'), sendBtn:$('sendBtn'),
  commDialog:$('commDialog'), commForm:$('commForm'), commTitle:$('commTitle'), commHint:$('commHint'), commMailbox:$('commMailbox'), commMailboxMeta:$('commMailboxMeta'), commReceiveAllow:$('commReceiveAllow'), commSendAllow:$('commSendAllow'), commStatus:$('commStatus'), commSaveBtn:$('commSaveBtn'),
  toast:$('toast'), allowAllMailboxesBtn:$('allowAllMailboxesBtn')
};

async function api(path, options={}) {
  const res = await fetch(path, { headers:{'content-type':'application/json', ...(options.headers||{})}, ...options });
  const data = await res.json().catch(()=>({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
function toast(msg){ els.toast.textContent=msg; els.toast.classList.remove('hidden'); clearTimeout(toast.t); toast.t=setTimeout(()=>els.toast.classList.add('hidden'),2800); }
function escapeHtml(s){ return String(s ?? '').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function fmtDate(s){ return s ? String(s).replace('T',' ').replace(/\.\d+Z$/,'') : ''; }
function asText(value){ if(Array.isArray(value)) return value.join(', '); if(value && typeof value==='object') return JSON.stringify(value); return String(value ?? ''); }
function scoped(path, params={}){ const q=new URLSearchParams(params); if(state.aggregate) q.set('aggregate','1'); else if(state.user) q.set('user',state.user); return `${path}?${q}`; }
function currentScope(){ return state.aggregate ? '全部邮箱' : (state.user || '当前邮箱'); }
function currentTitle(){ return `${currentScope()} · ${state.title}`; }
function attachmentHref(mailId, partId, user){ return `/api/attachment?id=${encodeURIComponent(mailId)}&part=${encodeURIComponent(partId)}&user=${encodeURIComponent(user)}`; }
function fmtSize(n){ if(!Number.isFinite(Number(n))) return ''; const size=Number(n); if(size<1024) return `${size}B`; if(size<1024*1024) return `${Math.round(size/1024)}KB`; return `${(size/1024/1024).toFixed(1)}MB`; }
function visibleFolderName(id){ return VISIBLE_FOLDERS.find((f) => f.id === String(id))?.name || '收件箱'; }
function visibleFolders(remoteFolders){
  const byId = new Map((remoteFolders || []).map((folder) => [String(folder.id), folder]));
  return VISIBLE_FOLDERS.map((folder) => ({
    ...folder,
    unreadCount: byId.get(folder.id)?.unreadCount || 0,
    messageCount: byId.get(folder.id)?.messageCount || 0,
  }));
}
function commLevelLabel(item){
  const level = Number(item?.commLevel ?? 2);
  if (level === 2) return '全允许';
  if (level === 1) return '仅内部';
  if (level === 0) return '关闭';
  return '未设置';
}
function commMetaLabel(item){
  const level = Number(item?.commLevel ?? 2);
  const receive = Number(item?.extReceiveType ?? 1);
  const send = Number(item?.extSendType ?? 1);
  if (level === 2) return `收件${receive ? '开' : '关'} · 发件${send ? '开' : '关'}`;
  if (level === 1) return '仅内部通讯';
  return '未启用';
}
function setSetupStatus(value){ els.setupStatus.textContent = typeof value === 'string' ? value : JSON.stringify(value,null,2); }
function setNavCollapsed(collapsed){ state.navCollapsed=collapsed; els.app.classList.toggle('nav-collapsed', collapsed); if(els.navToggleBtn){ els.navToggleBtn.setAttribute('aria-pressed', String(collapsed)); els.navToggleBtn.setAttribute('aria-label', collapsed?'展开邮箱导航':'收起邮箱导航'); els.navToggleBtn.title=collapsed?'展开邮箱导航':'收起邮箱导航'; } try{ localStorage.setItem('claw.navCollapsed', collapsed?'1':'0'); }catch{} }
function restoreNavState(){ let collapsed=false; try{ collapsed=localStorage.getItem('claw.navCollapsed')==='1'; }catch{} setNavCollapsed(collapsed); }

async function bootstrap(){
  try{
    const me = await api('/api/me');
    els.accessUser.textContent = `Access: ${me.accessUser?.email || 'ok'}`;
    state.connected = !!me.clawConnected;
    state.defaultUser = me.defaultUser || me.user;
    if(!state.connected){ els.setup.classList.remove('hidden'); els.app.classList.add('hidden'); setSetupStatus('尚未连接 Claw。'); return; }
    els.setup.classList.add('hidden'); els.app.classList.remove('hidden');
    restoreNavState();
    setActiveScope(null, true);
    await Promise.all([loadFolders(), loadMailboxes()]);
    await loadMessages();
  }catch(err){ els.setup.classList.remove('hidden'); els.app.classList.add('hidden'); setSetupStatus(err.message); }
}

function setActiveScope(user, aggregate=false){ state.aggregate = aggregate; state.user = aggregate ? null : (user || state.defaultUser); els.account.textContent = currentScope(); }
async function switchScope(user, aggregate=false){ setActiveScope(user, aggregate); state.selected=null; showEmpty(); await Promise.all([loadMailboxes(), state.mode==='search' && els.searchInput.value.trim() ? searchMessages(els.searchInput.value.trim()) : loadMessages()]); }

async function sendCode(){ const email=els.loginEmail.value.trim(); if(!email) return toast('先填邮箱'); els.sendCodeBtn.disabled=true; try{ await api('/api/claw/send-code',{method:'POST',body:JSON.stringify({email})}); setSetupStatus('验证码已发送。'); }catch(e){ setSetupStatus(e.message); }finally{ els.sendCodeBtn.disabled=false; }}
async function verifyCode(e){ e.preventDefault(); const email=els.loginEmail.value.trim(); const code=els.loginCode.value.trim(); if(!email||!code) return toast('邮箱和验证码都要填'); els.verifyCodeBtn.disabled=true; setSetupStatus('验证中，并同步邮箱与首轮索引…'); try{ const data=await api('/api/claw/verify-code',{method:'POST',body:JSON.stringify({email,code})}); setSetupStatus(data); await bootstrap(); }catch(err){ setSetupStatus(err.message); }finally{ els.verifyCodeBtn.disabled=false; }}

async function loadMailboxes(){
  const data = await api('/api/mailboxes');
  state.mailboxes = data.items || [];
  els.mailboxes.innerHTML='';
  const all=document.createElement('button');
  all.className=`mailbox-row ${state.aggregate?'active':''}`;
  all.type='button';
  all.innerHTML='<div><strong>全部邮箱</strong><span>聚合启用邮箱</span></div><em>ALL</em>';
  all.onclick=()=>switchScope(null,true);
  els.mailboxes.append(all);
  for(const item of state.mailboxes){
    const active=!state.aggregate && state.user===item.email;
    const entry=document.createElement('div');
    entry.className=`mailbox-entry ${active?'active':''}`;
    const row=document.createElement('button');
    row.type='button';
    row.className=`mailbox-row ${active?'active':''}`;
    row.innerHTML=`<div><strong>${escapeHtml(item.displayName||item.prefix||item.email)}</strong><span>${escapeHtml(item.email)}</span></div><em>${item.type==='primary'?'主':'子'}</em>`;
    row.onclick=()=>switchScope(item.email,false);
    entry.append(row);
    const actions=document.createElement('div');
    actions.className='mailbox-actions';
    const badge=document.createElement('span');
    badge.className='mailbox-comm-badge';
    badge.textContent=`${commLevelLabel(item)} · ${commMetaLabel(item)}`;
    actions.append(badge);
    const allAllow=document.createElement('button');
    allAllow.type='button';
    allAllow.textContent='全允';
    allAllow.title='将该邮箱设为全允许';
    allAllow.onclick=(ev)=>{ev.stopPropagation(); setFullAllow(item);};
    actions.append(allAllow);
    const comm=document.createElement('button');
    comm.type='button';
    comm.textContent='设置';
    comm.title='打开通讯规则面板';
    comm.onclick=(ev)=>{ev.stopPropagation(); openCommDialog(item);};
    actions.append(comm);
    const agg=document.createElement('button'); agg.type='button'; agg.textContent=item.aggregateEnabled?'移出':'聚合'; agg.title=item.aggregateEnabled?'退出聚合':'加入聚合'; agg.onclick=(ev)=>{ev.stopPropagation(); toggleAggregate(item)}; actions.append(agg);
    if(item.type!=='primary'){ const del=document.createElement('button'); del.type='button'; del.textContent='删'; del.title='删除子邮箱'; del.className='danger'; del.onclick=(ev)=>{ev.stopPropagation(); deleteMailbox(item)}; actions.append(del); }
    entry.append(actions);
    els.mailboxes.append(entry);
  }
}
async function toggleAggregate(item){ await api(`/api/mailboxes/${encodeURIComponent(item.id)}/aggregate`,{method:'POST',body:JSON.stringify({enabled:!item.aggregateEnabled})}); await loadMailboxes(); toast('聚合已更新'); }
async function setFullAllow(item){ await api(`/api/mailboxes/${encodeURIComponent(item.id)}/comm-settings`,{method:'POST',body:JSON.stringify({commLevel:2,extReceiveType:1,extSendType:1})}); await loadMailboxes(); toast(`已全允许：${item.email}`); }
function openCommDialog(item){
  state.commTarget = item;
  els.commMailbox.textContent = item.displayName || item.email;
  els.commMailboxMeta.textContent = item.email;
  const level = Number(item.commLevel ?? 2);
  const radios = [...els.commForm.querySelectorAll('input[name="commLevel"]')];
  radios.forEach((input) => { input.checked = Number(input.value) === level; });
  els.commReceiveAllow.checked = Number(item.extReceiveType ?? 1) !== 0;
  els.commSendAllow.checked = Number(item.extSendType ?? 1) !== 0;
  updateCommDialogControls();
  els.commStatus.textContent = '';
  els.commDialog.showModal();
}
function updateCommDialogControls(){
  const level = Number(els.commForm.querySelector('input[name="commLevel"]:checked')?.value || 2);
  const enabled = level === 2;
  els.commReceiveAllow.disabled = !enabled;
  els.commSendAllow.disabled = !enabled;
  els.commHint.textContent = enabled ? '全允许时可单独控制收件和发件开关。' : '仅内部模式会关闭外部收发。';
}
async function saveCommSettings(){
  const item = state.commTarget;
  if(!item) return;
  els.commSaveBtn.disabled = true;
  els.commStatus.textContent = '保存中…';
  try{
    const level = Number(els.commForm.querySelector('input[name="commLevel"]:checked')?.value || 2);
    const body = level === 2
      ? { commLevel: 2, extReceiveType: els.commReceiveAllow.checked ? 1 : 0, extSendType: els.commSendAllow.checked ? 1 : 0 }
      : { commLevel: 1 };
    await api(`/api/mailboxes/${encodeURIComponent(item.id)}/comm-settings`,{method:'POST',body:JSON.stringify(body)});
    await loadMailboxes();
    els.commStatus.textContent = '已保存';
    toast(`通讯规则已更新：${item.email}`);
    setTimeout(()=>els.commDialog.close(),400);
  }catch(e){
    els.commStatus.textContent = e.message;
  }finally{
    els.commSaveBtn.disabled = false;
  }
}
async function deleteMailbox(item){ if(!confirm(`删除子邮箱 ${item.email}？`)) return; await api(`/api/mailboxes/${encodeURIComponent(item.id)}`,{method:'DELETE'}); await loadMailboxes(); toast('已删除'); }
async function createMailbox(){ const suffix=prompt('子邮箱后缀 suffix（小写字母/数字）'); if(!suffix) return; const displayName=prompt('显示名（可选）', suffix) || suffix; const data=await api('/api/mailboxes',{method:'POST',body:JSON.stringify({suffix,displayName})}); await loadMailboxes(); toast(`已创建 ${data.item?.email || suffix}`); }
async function setAllSubMailboxesFullAllow(){
  const targets = state.mailboxes.filter((item) => item.type !== 'primary' && item.status !== 'deleted');
  if(!targets.length) return toast('没有可设置的子邮箱');
  els.allowAllMailboxesBtn.disabled = true;
  try{
    for(const item of targets) await api(`/api/mailboxes/${encodeURIComponent(item.id)}/comm-settings`,{method:'POST',body:JSON.stringify({commLevel:2,extReceiveType:1,extSendType:1})});
    await loadMailboxes();
    toast(`已统一设置 ${targets.length} 个子邮箱为全允许`);
  }finally{
    els.allowAllMailboxesBtn.disabled = false;
  }
}

async function loadFolders(){
  els.folders.innerHTML='';
  const data=await api(state.aggregate?'/api/folders?aggregate=1':`/api/folders?user=${encodeURIComponent(state.user||state.defaultUser)}`);
  if(!VISIBLE_FOLDER_IDS.has(String(state.fid))){ state.fid = DEFAULT_FID; state.title = visibleFolderName(DEFAULT_FID); }
  for(const f of visibleFolders(data.folders)){
    const btn=document.createElement('button');
    btn.className=`folder ${String(f.id)===String(state.fid)?'active':''}`;
    btn.innerHTML=`<span>${escapeHtml(f.name)}</span>${f.unreadCount?`<strong>${f.unreadCount}</strong>`:''}`;
    btn.onclick=async()=>{state.fid=String(f.id); state.title=f.name; state.mode='folder'; els.searchInput.value=''; showEmpty(); await Promise.all([loadFolders(),loadMessages()]);};
    els.folders.append(btn);
  }
}
async function loadMessages(){
  state.mode='folder'; els.listTitle.textContent=currentTitle(); els.listMeta.textContent='从 D1 索引读取…'; els.messageList.innerHTML='';
  const params={fid:state.fid,limit:'60'}; if(els.unreadOnly.checked) params.unread='1';
  const data=await api(scoped('/api/messages',params)); state.messages=data.messages||[]; renderMessages();
}
async function searchMessages(q){
  state.mode='search'; state.title=`搜索：${q}`; els.listTitle.textContent=currentTitle(); els.listMeta.textContent='搜索 D1 索引…'; els.messageList.innerHTML='';
  const params={fid:state.fid,limit:'60',keyword:q}; if(els.unreadOnly.checked) params.unread='1';
  const data=await api(scoped('/api/search',params)); state.messages=data.messages||[]; renderMessages();
}
function renderMessages(){ els.listMeta.textContent=`${state.messages.length} 封 · ${state.aggregate?'聚合':'单邮箱'} · ${visibleFolderName(state.fid)}`; els.messageList.innerHTML=''; if(!state.messages.length){els.messageList.innerHTML='<div class="empty-state compact"><div class="empty-icon" aria-hidden="true">0</div><p>暂无索引邮件，点刷新拉取。</p></div>'; return;} for(const msg of state.messages){ const active=state.selected?.id===msg.id && state.selected?.user===msg.user; const btn=document.createElement('button'); btn.type='button'; btn.className=`message-item ${active?'active':''} ${msg.read?'read':'unread'}`; btn.title=`${msg.subject||'(无主题)'}\n${asText(msg.from)}`; btn.innerHTML=`<div class="message-head"><span class="subject">${escapeHtml(msg.subject||'(无主题)')}</span><span class="date">${fmtDate(msg.date)}</span></div><div class="from">${escapeHtml(asText(msg.from))}</div><div class="preview">${escapeHtml(msg.preview||'')}</div>${msg.user?`<span class="chip">${escapeHtml(msg.accountName||msg.user)}</span>`:''}`; btn.onclick=()=>openMessage(msg); els.messageList.append(btn); }}
function showEmpty(){ state.selected=null; els.emptyReader.classList.remove('hidden'); els.reader.classList.add('hidden'); }
async function openMessage(msg){
  state.selected=msg;
  const user=msg.user||state.user;
  renderLoadingMessage(msg,user);
  renderMessages();
  try{
    const data=await api(`/api/message?id=${encodeURIComponent(msg.id)}&user=${encodeURIComponent(user)}&markRead=1`);
    msg.read=true;
    state.selected=msg;
    renderMessage(data.mail,user);
    renderMessages();
  }catch(e){
    renderMessageError(msg,user,e);
    toast(e.message);
  }
}
function partContent(part){
  if(typeof part === 'string') return part.trim();
  if(part && typeof part === 'object' && typeof part.content === 'string') return part.content.trim();
  return '';
}
function mailShell(body){
  return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>
    :root{color-scheme:light;--mail-bg:#fffdf8;--mail-text:#1f1b16;--mail-muted:#746b5f;--mail-line:rgba(31,27,22,.14)}
    html{height:100%;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
    body{box-sizing:border-box;min-height:100%;margin:0;padding:20px 22px;background:var(--mail-bg);color:var(--mail-text);font:14px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-wrap:pretty}
    img{max-width:100%;height:auto;outline:1px solid rgba(0,0,0,.1);border-radius:8px}
    a{color:#664f00;text-decoration-thickness:1px;text-underline-offset:3px}
    pre{white-space:pre-wrap;margin:0;font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace}
    blockquote{margin:12px 0;padding:8px 12px;border-left:3px solid var(--mail-line);color:var(--mail-muted);background:rgba(31,27,22,.035)}
    .empty-mail{display:grid;place-items:center;min-height:220px;color:var(--mail-muted);border:1px dashed var(--mail-line);border-radius:12px;text-align:center;padding:16px}
  </style></head><body>${body}</body></html>`;
}
function mailDocument(mail){
  const html = partContent(mail.html);
  const text = partContent(mail.text);
  const body = html || (text ? `<pre>${escapeHtml(text)}</pre>` : '<div class="empty-mail">这封邮件没有返回正文。可以点“刷新”后再打开一次。</div>');
  return mailShell(body);
}
function renderLoadingMessage(mail,user){ els.emptyReader.classList.add('hidden'); els.reader.classList.remove('hidden'); els.readDate.textContent=fmtDate(mail.date||mail.sentDate||mail.receivedDate); els.readSubject.textContent=mail.subject||'(无主题)'; els.readFrom.textContent=`From: ${asText(mail.from)} · ${user}`; els.readRecipients.textContent=''; els.attachments.innerHTML=''; els.mailFrame.srcdoc=mailShell('<div class="empty-mail">正在加载正文…</div>'); }
function renderMessageError(mail,user,error){ renderLoadingMessage(mail,user); els.mailFrame.srcdoc=mailShell(`<div class="empty-mail">正文加载失败：${escapeHtml(error.message)}</div>`); }
function renderMessage(mail,user){ els.emptyReader.classList.add('hidden'); els.reader.classList.remove('hidden'); els.readDate.textContent=fmtDate(mail.date||mail.sentDate||mail.receivedDate); els.readSubject.textContent=mail.subject||'(无主题)'; els.readFrom.textContent=`From: ${asText(mail.from)} · ${user}`; els.readRecipients.textContent=`To: ${asText(mail.to)}${mail.cc?' · Cc: '+asText(mail.cc):''}`; els.mailFrame.srcdoc=mailDocument(mail); const mailId=mail.id||state.selected?.id; els.attachments.innerHTML=(mail.attachments||[]).filter(a=>a&&a.id&&mailId).map(a=>`<a class="chip attachment-chip" href="${attachmentHref(mailId,a.id,user)}" target="_blank" rel="noopener"><span class="file-glyph">FILE</span><span>${escapeHtml(a.filename||a.id)}</span>${a.contentLength?`<small>${fmtSize(a.contentLength)}</small>`:''}</a>`).join(''); }
async function deleteSelected(){ if(!state.selected) return; const user=state.selected.user||state.user||state.defaultUser; if(!user) return toast('没有可删除的邮箱身份'); if(!confirm(`移到已删除？\n${state.selected.subject||'(无主题)'}`)) return; els.deleteBtn.disabled=true; try{ await api(`/api/message?id=${encodeURIComponent(state.selected.id)}&user=${encodeURIComponent(user)}`,{method:'DELETE'}); toast('已移到已删除'); showEmpty(); await Promise.all([loadFolders(),loadMessages()]); }catch(e){ toast(e.message); }finally{ els.deleteBtn.disabled=false; }}
async function refreshCurrent(){ els.refreshBtn.disabled=true; els.listMeta.textContent='刷新远端并更新 D1…'; try{ const folders=state.fid; const data=await api(`/api/claw/refresh?folders=${encodeURIComponent(folders)}`,{method:'POST'}); await Promise.all([loadFolders(), state.mode==='search'&&els.searchInput.value.trim()?searchMessages(els.searchInput.value.trim()):loadMessages()]); toast(`刷新完成：${data.refresh.messages} 条，错误 ${data.refresh.errors.length}`); }catch(e){ toast(e.message); }finally{ els.refreshBtn.disabled=false; }}
function openComposer(reply=false){ state.replyId=reply?state.selected?.id:null; state.replyUser=reply?(state.selected?.user||state.user):null; els.composerTitle.textContent=reply?'回复邮件':'写邮件'; els.composerHint.textContent=reply?`回复 ${state.replyUser}`:`从 ${state.user||state.defaultUser||'当前邮箱'} 发送`; els.composeTo.value=''; els.composeCc.value=''; els.composeSubject.value=reply?`Re: ${state.selected?.subject||''}`:''; els.composeBody.value=''; els.composeStatus.textContent=''; els.composerDialog.showModal(); }
async function sendCurrent(){ els.sendBtn.disabled=true; els.composeStatus.textContent='发送中…'; try{ const body={user:state.replyUser||state.user||state.defaultUser,to:els.composeTo.value,cc:els.composeCc.value,subject:els.composeSubject.value,body:els.composeBody.value,html:els.composeHtml.checked}; const path=state.replyId?'/api/reply':'/api/send'; if(state.replyId) body.id=state.replyId; const data=await api(path,{method:'POST',body:JSON.stringify(body)}); els.composeStatus.textContent='已发送'; toast(`已发送：${data.from}`); setTimeout(()=>els.composerDialog.close(),600); }catch(e){ els.composeStatus.textContent=e.message; }finally{ els.sendBtn.disabled=false; }}
els.sendCodeBtn.onclick=sendCode; els.connectForm.onsubmit=verifyCode; els.createMailboxBtn.onclick=createMailbox; els.allowAllMailboxesBtn.onclick=setAllSubMailboxesFullAllow; els.refreshBtn.onclick=refreshCurrent; els.composeBtn.onclick=()=>openComposer(false); if(els.navToggleBtn) els.navToggleBtn.onclick=()=>setNavCollapsed(!state.navCollapsed); els.deleteBtn.onclick=deleteSelected; els.replyBtn.onclick=()=>openComposer(true); els.sendBtn.onclick=sendCurrent; els.commSaveBtn.onclick=saveCommSettings; els.commForm.addEventListener('change', updateCommDialogControls); els.searchForm.onsubmit=(e)=>{e.preventDefault(); const q=els.searchInput.value.trim(); if(q) searchMessages(q); else loadMessages();}; els.unreadOnly.onchange=()=>state.mode==='search'&&els.searchInput.value.trim()?searchMessages(els.searchInput.value.trim()):loadMessages();
bootstrap();
