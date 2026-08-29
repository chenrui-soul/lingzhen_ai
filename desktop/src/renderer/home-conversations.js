(() => {
  const api = window.lingframe;
  if (!api?.workbench) return;

  const STORAGE_PREFIX = 'lingframe.homeConversations.v1';
  const runtime = { key: '', data: null, bootstrap: null, query: '', decorating: false, saveTimer: null, lastRecord: '', pendingRecords: [] };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const uid = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const now = () => new Date().toISOString();

  function makeConversation() {
    const timestamp = now();
    return { id: uid('conversation'), title: '新对话', draft: '', messages: [], createdAt: timestamp, updatedAt: timestamp };
  }

  async function resolveStorageKey() {
    const [identity, boot] = await Promise.all([
      Promise.resolve(api.identity?.status?.()).catch(() => ({})),
      api.workbench.bootstrap().catch(() => ({}))
    ]);
    const tenantId = identity?.tenantId || 'local';
    const projectId = boot?.currentProjectId || document.querySelector('.project')?.dataset.projectId || 'default';
    runtime.bootstrap = boot || {};
    return `${STORAGE_PREFIX}.${tenantId}.${projectId}`;
  }

  function normalizeData(value) {
    const conversations = Array.isArray(value?.conversations) ? value.conversations.filter(item => item?.id).map(item => ({
      id: String(item.id),
      title: String(item.title || '新对话').slice(0, 80),
      draft: String(item.draft || ''),
      messages: Array.isArray(item.messages) ? item.messages.slice(-200) : [],
      createdAt: item.createdAt || now(),
      updatedAt: item.updatedAt || item.createdAt || now()
    })) : [];
    if (!conversations.length) conversations.push(makeConversation());
    const activeId = conversations.some(item => item.id === value?.activeId) ? value.activeId : conversations[0].id;
    return { version: 1, activeId, conversations: conversations.slice(0, 100) };
  }

  function loadData(key) {
    try { return normalizeData(JSON.parse(localStorage.getItem(key) || 'null')); }
    catch { return normalizeData(null); }
  }

  function persist() {
    if (!runtime.key || !runtime.data) return;
    localStorage.setItem(runtime.key, JSON.stringify(runtime.data));
  }

  function hydrateTaskResults(boot = runtime.bootstrap || {}) {
    if (!runtime.data) return;
    const taskMap = new Map((Array.isArray(boot.tasks) ? boot.tasks : []).map(task => [String(task.id || ''), task]));
    const assetMap = new Map((Array.isArray(boot.assets) ? boot.assets : []).map(asset => [String(asset.id || ''), asset]));
    let changed = false;
    for (const conversation of runtime.data.conversations || []) {
      for (const message of conversation.messages || []) {
        const task = taskMap.get(String(message.taskId || ''));
        if (!task) continue;
        const before = JSON.stringify([message.state,message.resultAssetId,message.resultVid,message.fallbackResultVid,message.resultUrlSource,message.watermarkFree,message.resultUrls]);
        message.state = task.state || message.state;
        message.resultType = task.resultType || task.creationType || message.resultType;
        message.resultAssetId = task.resultAssetId || message.resultAssetId;
        message.resultVid = task.resultVid || message.resultVid;
        message.fallbackResultVid = task.fallbackResultVid || '';
        message.resultUrlSource = task.resultUrlSource || '';
        message.watermarkFree = typeof task.watermarkFree === 'boolean' ? task.watermarkFree : null;
        message.resultUrls = Array.isArray(task.resultUrls) ? task.resultUrls.slice() : message.resultUrls || [];
        const asset = assetMap.get(String(task.resultAssetId || ''));
        if (asset) { message.resultAssetUrl = asset.contentUrl || message.resultAssetUrl || ''; message.resultMime = asset.mime || message.resultMime || ''; message.resultAssetName = asset.name || message.resultAssetName || ''; }
        const after = JSON.stringify([message.state,message.resultAssetId,message.resultVid,message.fallbackResultVid,message.resultUrlSource,message.watermarkFree,message.resultUrls]);
        if (before !== after) changed = true;
      }
    }
    if (changed) persist();
  }

  function activeConversation() {
    return runtime.data?.conversations.find(item => item.id === runtime.data.activeId) || runtime.data?.conversations[0] || null;
  }

  function saveCurrentDraft() {
    const conversation = activeConversation();
    const input = document.querySelector('.home-chat-shell [data-home-prompt]');
    if (!conversation || !input) return;
    conversation.draft = input.value;
    conversation.updatedAt = now();
    persist();
  }

  function timeLabel(value) {
    const date = new Date(value || Date.now());
    const today = new Date();
    const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
    const same = (a, b) => a.toDateString() === b.toDateString();
    if (same(date, today)) return '今天';
    if (same(date, yesterday)) return '昨天';
    if (Date.now() - date.getTime() < 7 * 86400000) return '最近 7 天';
    return '更早';
  }

  function shortTime(value) {
    const date = new Date(value || Date.now());
    return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function resultMarkup(message) {
    const urls = [...new Set([...(Array.isArray(message.resultUrls) ? message.resultUrls : []), message.resultVid].filter(Boolean))];
    const fallbackUrl = String(message.fallbackResultVid || '').trim();
    const local = message.resultAssetUrl && /^file:/i.test(message.resultAssetUrl) ? message.resultAssetUrl : '';
    if (!local && !urls.length) return '';
    const isVideo = message.resultType === 'video' || /video/i.test(message.resultMime || '') || /\.mp4(?:\?|$)/i.test(local);
    const linkLabel = message.state === 'downloading' ? '原始结果地址' : message.resultUrlSource === 'doubao-aispace-watermark-free' ? '无水印视频地址' : message.resultUrlSource === 'doubao-page-fallback' ? '有水印视频地址' : '视频链接';
    const links = `${urls.map((url, index) => `<a class="home-chat-result-link" href="${esc(url)}" target="_blank" rel="noreferrer">${linkLabel}${urls.length > 1 ? ` ${index + 1}` : ''}</a>`).join('')}${fallbackUrl && !urls.includes(fallbackUrl) ? `<a class="home-chat-result-link" href="${esc(fallbackUrl)}" target="_blank" rel="noreferrer">有水印视频地址</a>` : ''}`;
    return `<section class="home-chat-result-card"><div class="home-chat-result-title"><b>${isVideo ? '视频结果' : '生成结果'}</b><span>${local ? '已保存到素材中心' : '已捕获结果地址，等待本地恢复'}</span></div>${local && isVideo ? `<video controls preload="metadata" src="${esc(local)}"></video>` : ''}<div class="home-chat-result-actions">${local ? `<a class="home-chat-result-link" href="${esc(local)}" target="_blank" rel="noreferrer">打开本地素材</a>` : ''}${links}<button data-home-chat-copy-urls="${esc(message.id)}">复制视频链接</button></div></section>`;
  }

  function groupedConversations() {
    const filtered = runtime.data.conversations
      .filter(item => !runtime.query || `${item.title} ${item.draft} ${(item.messages || []).map(message => message.content).join(' ')}`.toLowerCase().includes(runtime.query.toLowerCase()))
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return filtered.reduce((groups, item) => {
      const label = timeLabel(item.updatedAt);
      (groups[label] ||= []).push(item);
      return groups;
    }, {});
  }

  function renderSidebar() {
    const sidebar = document.querySelector('.home-chat-sidebar');
    if (!sidebar || !runtime.data) return;
    const groups = groupedConversations();
    sidebar.innerHTML = `<div class="home-chat-sidebar-head"><div><span>CREATION CHATS</span><b>创作对话</b></div><button data-home-chat-new title="新建对话">＋</button></div><div class="home-chat-search"><span>⌕</span><input data-home-chat-search value="${esc(runtime.query)}" placeholder="搜索历史对话"></div><div class="home-chat-history">${Object.entries(groups).map(([label, items]) => `<section><header>${esc(label)}</header>${items.map(item => {const last=[...(item.messages||[])].reverse().find(message=>message.role==='user');return `<div class="home-chat-item ${item.id===runtime.data.activeId?'active':''}" data-home-chat-id="${esc(item.id)}"><button class="home-chat-select" data-home-chat-select="${esc(item.id)}"><i>✦</i><span><b>${esc(item.title)}</b><small>${esc((last?.content||item.draft||'等待输入创意').slice(0,42))}</small></span><em>${esc(shortTime(item.updatedAt))}</em></button><button class="home-chat-more" data-home-chat-more="${esc(item.id)}" title="对话操作">•••</button><div class="home-chat-menu"><button data-home-chat-rename="${esc(item.id)}">重命名</button><button class="danger" data-home-chat-delete="${esc(item.id)}">删除对话</button></div></div>`}).join('')}</section>`).join('') || '<div class="home-chat-no-results">没有找到相关对话</div>'}</div><div class="home-chat-local-note"><i>●</i><span>记录保存在当前客户电脑<br>按密钥与项目独立隔离</span></div>`;
    bindSidebar(sidebar);
  }

  function renderStream() {
    const stream = document.querySelector('.home-chat-stream');
    const welcome = document.querySelector('.home-chat-welcome');
    const conversation = activeConversation();
    if (!stream || !welcome || !conversation) return;
    stream.querySelector('.home-chat-messages')?.remove();
    const messages = conversation.messages || [];
    welcome.hidden = messages.length > 0;
    if (!messages.length) return;
    const host = document.createElement('div');
    host.className = 'home-chat-messages';
    host.innerHTML = `<div class="home-chat-date">${esc(conversation.title)}</div>${messages.map(message => {const content=String(message.content||'');const collapsible=[...content].length>320||content.split(/\r?\n/).length>7;return `<article class="home-chat-message ${message.role==='user'?'user':'assistant'} ${message.state||''}"><div class="home-chat-avatar">${message.role==='user'?'我':'✦'}</div><div class="home-chat-bubble"><header><b>${message.role==='user'?'我的输入':'灵帧AI'}</b><time>${esc(shortTime(message.createdAt))}</time></header><div class="home-chat-content ${collapsible?'is-collapsed':''}" data-home-chat-content="${esc(message.id)}"><p>${esc(content)}</p></div>${collapsible?`<button class="home-chat-content-toggle" data-home-chat-toggle="${esc(message.id)}" aria-expanded="false">展开全文</button>`:''}${message.meta?.length?`<div class="home-chat-meta">${message.meta.map(item=>`<span>${esc(item)}</span>`).join('')}</div>`:''}${resultMarkup(message)}<footer><button data-home-chat-copy="${esc(message.id)}">复制</button><button data-home-chat-reuse="${esc(message.id)}">引用到输入框</button>${message.role==='assistant'&&message.state==='completed'&&message.resultType==='text'?`<button data-home-chat-edit="${esc(message.id)}">编辑结果</button>`:''}</footer></div></article>`}).join('')}`;
    stream.appendChild(host);
    host.querySelectorAll('[data-home-chat-toggle]').forEach(button => button.onclick = () => {
      const content=button.previousElementSibling;
      if(!content?.classList.contains('home-chat-content'))return;
      const collapsed=content.classList.toggle('is-collapsed');
      button.textContent=collapsed?'展开全文':'收起内容';
      button.setAttribute('aria-expanded',String(!collapsed));
    });
    host.querySelectorAll('[data-home-chat-copy]').forEach(button => button.onclick = () => {
      const message = messages.find(item => item.id === button.dataset.homeChatCopy);
      if (message) navigator.clipboard?.writeText(message.content || '');
    });
    host.querySelectorAll('[data-home-chat-reuse]').forEach(button => button.onclick = () => {
      const message = messages.find(item => item.id === button.dataset.homeChatReuse);
      const input = document.querySelector('.home-chat-shell [data-home-prompt]');
      if (!message || !input) return;
      input.value = message.content || '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
    });
    host.querySelectorAll('[data-home-chat-copy-urls]').forEach(button => button.onclick = async () => {
      const message = messages.find(item => item.id === button.dataset.homeChatCopyUrls);
      const urls = [...new Set([...(message?.resultUrls || []), message?.resultVid, message?.fallbackResultVid].filter(Boolean))];
      if (urls.length) await navigator.clipboard?.writeText(urls.join('\n'));
    });
    host.querySelectorAll('[data-home-chat-edit]').forEach(button => button.onclick = () => editMessage(button.dataset.homeChatEdit));
    requestAnimationFrame(() => { stream.scrollTop = stream.scrollHeight; });
  }

  function editMessage(messageId) {
    const conversation=activeConversation();const message=conversation?.messages.find(item=>item.id===messageId);if(!message)return;
    document.querySelector('.home-chat-modal')?.remove();const host=document.createElement('div');host.className='home-chat-modal';
    host.innerHTML=`<div class="home-chat-modal-backdrop" data-home-chat-modal-close></div><section class="home-chat-modal-dialog home-chat-result-editor"><header><div><b>编辑生成结果</b><span>修改只影响当前对话记录，素材中心保留模型原始结果。</span></div><button data-home-chat-modal-close>×</button></header><textarea data-home-chat-result-input>${esc(message.content||'')}</textarea><footer><button class="ghost" data-home-chat-modal-close>取消</button><button class="primary" data-home-chat-result-save>保存修改</button></footer></section>`;
    host.querySelectorAll('[data-home-chat-modal-close]').forEach(button=>button.onclick=()=>host.remove());host.querySelector('[data-home-chat-result-save]').onclick=()=>{const value=host.querySelector('[data-home-chat-result-input]').value;if(!value.trim())return;message.content=value;message.editedAt=now();conversation.updatedAt=message.editedAt;persist();host.remove();renderStream();};document.body.appendChild(host);host.querySelector('textarea')?.focus();
  }

  function restoreDraft() {
    const input = document.querySelector('.home-chat-shell [data-home-prompt]');
    const conversation = activeConversation();
    if (!input || !conversation) return;
    input.value = conversation.draft || '';
    input.dispatchEvent(new CustomEvent('lingframe:prompt-value-changed', { bubbles: true }));
  }

  function renderAll() {
    renderSidebar();
    renderStream();
    restoreDraft();
  }

  function selectConversation(id) {
    if (!runtime.data?.conversations.some(item => item.id === id)) return;
    saveCurrentDraft();
    runtime.data.activeId = id;
    persist();
    renderAll();
  }

  function createConversation() {
    saveCurrentDraft();
    const conversation = makeConversation();
    runtime.data.conversations.unshift(conversation);
    runtime.data.activeId = conversation.id;
    persist();
    renderAll();
    document.querySelector('.home-chat-shell [data-home-prompt]')?.focus();
  }

  function showDialog({ title, description, value = '', confirmText = '确定', danger = false, onConfirm }) {
    document.querySelector('.home-chat-modal')?.remove();
    const host = document.createElement('div');
    host.className = 'home-chat-modal';
    host.innerHTML = `<div class="home-chat-modal-backdrop" data-home-chat-modal-close></div><section class="home-chat-modal-dialog"><header><div><b>${esc(title)}</b><span>${esc(description)}</span></div><button data-home-chat-modal-close>×</button></header>${value!==null?`<input data-home-chat-modal-input value="${esc(value)}" maxlength="80">`:''}<footer><button class="ghost" data-home-chat-modal-close>取消</button><button class="primary ${danger?'danger-confirm':''}" data-home-chat-modal-confirm>${esc(confirmText)}</button></footer></section>`;
    host.querySelectorAll('[data-home-chat-modal-close]').forEach(button => button.onclick = () => host.remove());
    host.querySelector('[data-home-chat-modal-confirm]').onclick = () => {
      const input = host.querySelector('[data-home-chat-modal-input]');
      if (input && !input.value.trim()) return input.focus();
      onConfirm(input?.value.trim());
      host.remove();
    };
    document.body.appendChild(host);
    const input = host.querySelector('[data-home-chat-modal-input]');
    input?.focus(); input?.select();
  }

  function renameConversation(id) {
    const conversation = runtime.data.conversations.find(item => item.id === id);
    if (!conversation) return;
    showDialog({ title: '重命名对话', description: '名称只保存在当前客户电脑。', value: conversation.title, onConfirm: value => { conversation.title = value.slice(0, 80); conversation.updatedAt = now(); persist(); renderSidebar(); renderStream(); } });
  }

  function deleteConversation(id) {
    const conversation = runtime.data.conversations.find(item => item.id === id);
    if (!conversation) return;
    showDialog({ title: '删除对话', description: `确定删除“${conversation.title}”及其本地输入记录吗？`, value: null, confirmText: '删除', danger: true, onConfirm: () => {
      runtime.data.conversations = runtime.data.conversations.filter(item => item.id !== id);
      if (!runtime.data.conversations.length) runtime.data.conversations.push(makeConversation());
      if (!runtime.data.conversations.some(item => item.id === runtime.data.activeId)) runtime.data.activeId = runtime.data.conversations[0].id;
      persist(); renderAll();
    }});
  }

  function bindSidebar(sidebar) {
    sidebar.querySelector('[data-home-chat-new]')?.addEventListener('click', createConversation);
    sidebar.querySelector('[data-home-chat-search]')?.addEventListener('input', event => { runtime.query = event.target.value; renderSidebar(); requestAnimationFrame(() => { const input=document.querySelector('[data-home-chat-search]'); if(input){input.focus();input.setSelectionRange(runtime.query.length,runtime.query.length);} }); });
    sidebar.querySelectorAll('[data-home-chat-select]').forEach(button => button.onclick = () => selectConversation(button.dataset.homeChatSelect));
    sidebar.querySelectorAll('[data-home-chat-more]').forEach(button => button.onclick = event => { event.stopPropagation(); const item=button.closest('.home-chat-item'); const open=item.classList.contains('menu-open'); sidebar.querySelectorAll('.home-chat-item.menu-open').forEach(node=>node.classList.remove('menu-open')); if(!open)item.classList.add('menu-open'); });
    sidebar.querySelectorAll('[data-home-chat-rename]').forEach(button => button.onclick = () => renameConversation(button.dataset.homeChatRename));
    sidebar.querySelectorAll('[data-home-chat-delete]').forEach(button => button.onclick = () => deleteConversation(button.dataset.homeChatDelete));
  }

  function bindComposer(composer) {
    const input = composer.querySelector('[data-home-prompt]');
    if (input && !input.dataset.homeChatDraftBound) {
      input.dataset.homeChatDraftBound = '1';
      input.addEventListener('input', () => {
        const conversation = activeConversation();
        if (!conversation) return;
        conversation.draft = input.value;
        conversation.updatedAt = now();
        clearTimeout(runtime.saveTimer);
        runtime.saveTimer = setTimeout(() => { persist(); renderSidebar(); }, 280);
      });
    }
    const submit = composer.querySelector('[data-home-submit]');
    if (submit && !submit.dataset.homeChatRecordBound) {
      submit.dataset.homeChatRecordBound = '1';
      const record = () => recordInput(composer);
      submit.addEventListener('pointerdown', record);
      submit.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') record(); });
    }
  }

  function parameterSnapshot(composer) {
    const meta = [];
    composer.querySelectorAll('.home-compose-fields label').forEach(label => {
      if (label.style.display === 'none') return;
      const select = label.querySelector('select');
      const range = label.querySelector('input[type="range"]');
      const name = (label.querySelector('span')?.textContent || label.childNodes[0]?.textContent || '').trim();
      const value = select?.selectedOptions?.[0]?.textContent?.trim() || (range ? `${range.value}s` : '');
      if (name && value) meta.push(`${name}：${value}`);
    });
    const assets = [...composer.querySelectorAll('.home-asset-card .home-asset-copy b')].map(node => node.textContent.trim()).filter(Boolean);
    if (assets.length) meta.push(`素材：${assets.join('、')}`);
    return meta.slice(0, 8);
  }

  function recordInput(composer) {
    const input = composer.querySelector('[data-home-prompt]');
    const content = input?.value.trim();
    const conversation = activeConversation();
    if (!content || !conversation) return;
    const signature = `${conversation.id}:${content}`;
    if (runtime.lastRecord === signature) return;
    runtime.lastRecord = signature;
    setTimeout(() => { if (runtime.lastRecord === signature) runtime.lastRecord = ''; }, 1200);
    const createdAt = now();
    const userMessage={ id: uid('message'), role: 'user', content, meta: parameterSnapshot(composer), createdAt };
    const assistantMessage={ id: uid('message'), role: 'assistant', content: '正在创建真实生成任务…', state:'creating', createdAt };
    conversation.messages.push(userMessage,assistantMessage);
    runtime.pendingRecords.push({conversationId:conversation.id,prompt:content,assistantMessageId:assistantMessage.id,createdAt});
    if (conversation.title === '新对话') conversation.title = content.replace(/\s+/g, ' ').slice(0, 24) || '新对话';
    conversation.draft = input.value;
    conversation.updatedAt = createdAt;
    persist();
    renderSidebar(); renderStream();
    const watch = setInterval(() => {
      if (!document.contains(input)) return clearInterval(watch);
      if (input.value === '') { conversation.draft = ''; persist(); clearInterval(watch); }
      else if (input.value !== content) { conversation.draft = input.value; persist(); clearInterval(watch); }
    }, 400);
    setTimeout(() => clearInterval(watch), 15000);
  }

  function findMessageByTask(taskId){for(const conversation of runtime.data?.conversations||[]){const message=conversation.messages?.find(item=>item.taskId===taskId);if(message)return{conversation,message};}return null;}

  window.addEventListener('lingframe:home-task-created',event=>{
    const task=event.detail?.task;if(!task)return;const pending=[...runtime.pendingRecords].reverse().find(item=>item.prompt===event.detail.prompt);if(!pending)return;
    const conversation=runtime.data?.conversations.find(item=>item.id===pending.conversationId);const message=conversation?.messages.find(item=>item.id===pending.assistantMessageId);if(!message)return;
    message.taskId=task.id;message.state=task.state||'queued';message.content=`任务已提交：${task.statusText||'等待执行'}`;message.meta=[task.executionChannel==='doubao'?`豆包：${task.accountName||task.accountId||'自动调度'}`:`模型：${task.modelId||'模型网关'}`,`任务 ID：${task.id}`];conversation.updatedAt=now();runtime.pendingRecords=runtime.pendingRecords.filter(item=>item!==pending);persist();renderStream();
  });

  window.addEventListener('lingframe:generation-status',event=>{
    const detail=event.detail||{};const found=findMessageByTask(detail.taskId);if(!found)return;const {conversation,message}=found;
    message.state=detail.state||message.state;message.resultType=detail.resultType||message.resultType;message.resultAssetId=detail.resultAssetId||message.resultAssetId;message.resultVid=detail.resultVid||message.resultVid;message.resultUrlSource=detail.resultUrlSource||message.resultUrlSource;message.watermarkFree=typeof detail.watermarkFree==='boolean'?detail.watermarkFree:message.watermarkFree;message.fallbackResultVid=detail.fallbackResultVid||message.fallbackResultVid;message.resultUrls=Array.isArray(detail.resultUrls)?detail.resultUrls.slice():message.resultUrls||[];message.conversationId=detail.conversationId||message.conversationId;message.recoveryState=detail.recoveryState||message.recoveryState;message.resultMime=detail.resultMime||message.resultMime;
    const indeterminate=detail.progressMode==='indeterminate'||['generating','submission_unknown'].includes(detail.state);
    message.content=detail.state==='completed'&&detail.resultType==='text'&&detail.resultText?detail.resultText:detail.state==='completed'?`${detail.statusText||'生成完成'}${detail.resultAssetId?'，结果已保存到素材中心。':''}`:detail.state==='failed'?`生成失败：${detail.providerMessage||detail.statusText||'请到任务中心查看详情'}`:detail.state==='downloading'&&detail.recoveryState==='result_download_failed'?`视频已生成，正在恢复下载；不会重新生成。${detail.error?`（${detail.error}）`:''}`:indeterminate?`${detail.statusText||detail.state||'执行中'}`:`${detail.statusText||detail.state||'执行中'} · ${Math.round(Number(detail.progress)||0)}%`;
    conversation.updatedAt=now();persist();if(conversation.id===runtime.data.activeId)renderStream();else renderSidebar();
    if(detail.resultAssetId && (detail.state === 'completed' || detail.state === 'downloading')) Promise.resolve(api.assets?.list?.({projectId:detail.projectId || ''})).then(assets => { const asset=(assets || []).find(item=>item.id===detail.resultAssetId); if(!asset)return; message.resultAssetUrl=asset.contentUrl||''; message.resultMime=asset.mime||''; message.resultAssetName=asset.name||''; persist(); if(conversation.id===runtime.data.activeId)renderStream(); }).catch(()=>{});
  });

  async function decorateHome() {
    if (!document.querySelector('[data-page="home"].active')) return;
    const workspace = document.querySelector('.workspace');
    if (!workspace || runtime.decorating) return;
    const existingShell = workspace.querySelector('.home-chat-shell');
    if (existingShell) {
      const existingComposer = existingShell.querySelector('.composer');
      const input = existingComposer?.querySelector('[data-home-prompt]');
      if (existingComposer && input && !input.dataset.homeChatDraftBound) {
        bindComposer(existingComposer);
        restoreDraft();
      }
      return;
    }
    const composer = document.querySelector('.workspace > .composer');
    if (!composer) return;
    runtime.decorating = true;
    try {
      const key = await resolveStorageKey();
      runtime.key = key;
      runtime.data = loadData(key);
      hydrateTaskResults();
      persist();
      const pageHead = workspace.querySelector('.page-head');
      const remaining = [...workspace.children].filter(node => node !== pageHead && node !== composer);
      const shell = document.createElement('section');
      shell.className = 'home-chat-shell';
      shell.dataset.homeChatStorageKey = key;
      shell.innerHTML = '<aside class="home-chat-sidebar glass"></aside><main class="home-chat-main glass"><div class="home-chat-stream"><div class="home-chat-welcome"></div></div></main>';
      composer.insertAdjacentElement('beforebegin', shell);
      const main = shell.querySelector('.home-chat-main');
      const welcome = shell.querySelector('.home-chat-welcome');
      const hero = composer.querySelector('.home-hero-copy');
      if (hero) welcome.appendChild(hero);
      remaining.forEach(node => welcome.appendChild(node));
      composer.classList.add('home-chat-composer');
      main.appendChild(composer);
      bindComposer(composer);
      renderAll();
    } catch (error) { console.error('home conversation initialization failed', error); }
    finally { runtime.decorating = false; }
  }

  document.addEventListener('click', event => {
    if (!event.target.closest('.home-chat-item')) document.querySelectorAll('.home-chat-item.menu-open').forEach(node => node.classList.remove('menu-open'));
  });
  new MutationObserver(() => queueMicrotask(decorateHome)).observe(document.querySelector('#root') || document.body, { childList: true, subtree: true });
  decorateHome();
})();
