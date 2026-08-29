(() => {
  const api = window.lingframe;
  const store = window.lingframeAccountStore;
  if (!api?.generation || !store) return;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const groups = () => store.groups();
  const accounts = groupId => store.accountsForGroup(groupId || 'all');
  const notify = (message,type='info',timeout) => window.lingframeToast?.(message,type,timeout);
  const setOptions = (select, markup) => { if (select && select.innerHTML !== markup) select.innerHTML = markup; };
  const groupMarkup = prefix => `<label data-${prefix}-group-wrap>账号分组<select data-${prefix}-group><option value="all">全部账号</option>${groups().map(group=>`<option value="${esc(group.id)}">${esc(group.name)}</option>`).join('')}</select></label>`;
  function fillAccountSelect(host, prefix) {
    const group = host.querySelector(`[data-${prefix}-group]`)?.value || 'all';
    const select = host.querySelector(`[data-${prefix}-account-select]`);
    if (!select) return;
    const previous = select.value;
    const list = accounts(group);
    setOptions(select, list.length ? `<option value="__auto__">自动调度（额度不足自动换号）</option>${list.map(item=>`<option value="${esc(item.id)}">指定：${esc(item.name)}</option>`).join('')}` : '<option value="">该分组暂无账号</option>');
    if(!select.dataset.autoInitialized&&list.length){select.dataset.autoInitialized='1';select.value='__auto__';}
    else if (previous==='__auto__'||list.some(item=>item.id===previous)) select.value = previous;
  }
  function enhanceTaskModal(modal) {
    const account = modal.querySelector('[data-generation-account]');
    if (!account) return;
    if (!modal.querySelector('[data-generation-group]')) account.insertAdjacentHTML('beforebegin', groupMarkup('generation'));
    const select=modal.querySelector('[data-generation-group]');const current=select.value||'all';setOptions(select,`<option value="all">全部账号</option>${groups().map(group=>`<option value="${esc(group.id)}">${esc(group.name)}</option>`).join('')}`);if([...select.options].some(option=>option.value===current))select.value=current;
    if(!select.dataset.bound){select.dataset.bound='1';select.addEventListener('change',()=>fillAccountSelect(modal,'generation'));}
    const channel=modal.querySelector('[data-generation-channel]');if(channel&&!channel.dataset.groupBound){channel.dataset.groupBound='1';channel.addEventListener('change',()=>{modal.querySelector('[data-generation-group-wrap]').style.display=channel.value==='model-gateway'?'none':'';});}
    fillAccountSelect(modal,'generation');
  }
  function enhanceTextModal(modal) {
    const account = modal.querySelector('[data-text-account]');
    if (!account) return;
    if (!modal.querySelector('[data-text-group]')) account.insertAdjacentHTML('beforebegin', groupMarkup('text'));
    const select=modal.querySelector('[data-text-group]');const current=select.value||'all';setOptions(select,`<option value="all">全部账号</option>${groups().map(group=>`<option value="${esc(group.id)}">${esc(group.name)}</option>`).join('')}`);if([...select.options].some(option=>option.value===current))select.value=current;
    if(!select.dataset.bound){select.dataset.bound='1';select.addEventListener('change',()=>fillAccountSelect(modal,'text'));}
    const channel=modal.querySelector('[data-text-channel]');if(channel&&!channel.dataset.groupBound){channel.dataset.groupBound='1';channel.addEventListener('change',()=>{modal.querySelector('[data-text-group-wrap]').style.display=channel.value==='model-gateway'?'none':'';});}
    fillAccountSelect(modal,'text');
  }
  async function submitTask(modal, button) {
    const title = modal.querySelector('[data-task-title]')?.value.trim();
    const prompt = modal.querySelector('[data-task-prompt]')?.value.trim();
    if (!title || !prompt) return notify('请填写任务名称和提示词');
    const channel = modal.querySelector('[data-generation-channel]')?.value || 'doubao';
    const input = {title,prompt,projectId:modal.querySelector('[data-task-project]')?.value,creationType:'video',executionChannel:channel};
    if (channel === 'doubao') {
      const groupId = modal.querySelector('[data-generation-group]')?.value || 'all';
      const pool=accounts(groupId);const selectedId=modal.querySelector('[data-generation-account-select]')?.value;const account = selectedId==='__auto__'?pool[0]:pool.find(item=>item.id===selectedId);
      if (!account) return notify('当前分组暂无可用豆包账号','error');
      input.accountGroupId=groupId;input.accountId=account.id;input.accountName=account.name;input.accountSelectionMode=selectedId==='__auto__'?'auto':'manual';input.accountCandidates=(selectedId==='__auto__'?pool:[account]).map(item=>({id:item.id,name:item.name,platform:'豆包'}));input.doubaoModel=modal.querySelector('[data-generation-doubao-model-select]')?.value||'Seedance 2.0 Mini';input.ratio=modal.querySelector('[data-generation-ratio-select]')?.value||'自动';input.duration=modal.querySelector('[data-generation-duration-select]')?.value||'10s';
    } else {
      const selected=modal.querySelector('[data-generation-model-select]')?.value||'';const [providerId,...parts]=selected.split('::');
      input.providerId=providerId;input.modelId=parts.join('::');
    }
    button.disabled=true;
    try { const task=await api.generation.create(input);modal.remove();notify(`任务“${task.title}”已进入任务中心；你可以继续操作其他模块。`,'success');document.querySelector('[data-task-refresh]')?.click(); }
    catch(error){notify(String(error.message||error),'error',7000);button.disabled=false;}
  }
  async function submitText(modal, button) {
    const content=document.querySelector('[data-text-content]')?.value.trim();
    if(!content)return notify('请先输入文本创作内容');
    const channel=modal.querySelector('[data-text-channel]')?.value||'model-gateway';
    const editor=document.querySelector('.text-editor');
    const input={title:document.querySelector('[data-text-title]')?.value||'文本创作',prompt:content,projectId:editor?.dataset.textProjectId,conversationId:editor?.dataset.textConversationId,creationType:'text',executionChannel:channel};
    if(channel==='doubao'){
      const groupId=modal.querySelector('[data-text-group]')?.value||'all';const pool=accounts(groupId),selectedId=modal.querySelector('[data-text-account-select]')?.value,account=selectedId==='__auto__'?pool[0]:pool.find(item=>item.id===selectedId);
      if(!account)return notify('当前分组暂无可用豆包账号','error');input.accountGroupId=groupId;input.accountId=account.id;input.accountName=account.name;input.accountSelectionMode=selectedId==='__auto__'?'auto':'manual';input.accountCandidates=(selectedId==='__auto__'?pool:[account]).map(item=>({id:item.id,name:item.name,platform:'豆包'}));
    }else{const selected=modal.querySelector('[data-text-model-select]')?.value||'';const [providerId,...parts]=selected.split('::');input.providerId=providerId;input.modelId=parts.join('::');}
    button.disabled=true;try{await api.generation.create(input);modal.remove();notify('文本任务已提交到任务中心；你可以继续操作其他模块。','success');}catch(error){notify(String(error.message||error),'error',7000);button.disabled=false;}
  }
  document.addEventListener('click', event => {
    const taskButton=event.target.closest('[data-task-create-save]');
    if(taskButton){const modal=taskButton.closest('.pm-modal');if(modal?.querySelector('[data-generation-account-select]')){event.preventDefault();event.stopImmediatePropagation();submitTask(modal,taskButton);return;}}
    const textButton=event.target.closest('[data-text-generation-submit]');
    if(textButton){const modal=textButton.closest('.pm-modal');if(modal?.querySelector('[data-text-account-select]')){event.preventDefault();event.stopImmediatePropagation();submitText(modal,textButton);}}
  }, true);
  const observer=new MutationObserver(()=>{document.querySelectorAll('.pm-modal').forEach(modal=>{enhanceTaskModal(modal);enhanceTextModal(modal);});});
  observer.observe(document.body,{childList:true,subtree:true});
  window.addEventListener('lingframe:account-groups-changed',()=>document.querySelectorAll('.pm-modal').forEach(modal=>{enhanceTaskModal(modal);enhanceTextModal(modal);}));
})();
