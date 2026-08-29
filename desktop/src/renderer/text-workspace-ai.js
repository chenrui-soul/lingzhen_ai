(() => {
  "use strict";
  const api = window.lingframe;
  const core = window.lingframeTextAiCore;
  if (!api?.generation?.create || !api?.models?.bootstrap || !api?.workbench?.bootstrap || !core) return;

  window.lingframeTextAiBatchC = {version:core.VERSION, ownsTextGeneration:true};
  const state = {tenantId:"local", models:[], presets:[], envelopes:[], candidates:[], tasks:[], assets:[], conversations:[], loading:false, loaded:false, timer:null};
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  const date = value => value ? new Date(value).toLocaleString("zh-CN", {month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}) : "--";
  const toast = (message, error=false) => {
    let node=document.querySelector(".pm-toast"); if(!node){node=document.createElement("div");document.body.appendChild(node);}
    node.className=`pm-toast ${error?"error":""}`;node.textContent=message;clearTimeout(node.timer);node.timer=setTimeout(()=>node.remove(),3500);
  };
  function modal(content,className="") {
    const host=document.createElement("div");host.className=`pm-modal ${className}`;
    host.innerHTML=`<div class="pm-modal-backdrop" data-text-ai-close></div><div class="pm-dialog glass">${content}</div>`;
    document.body.appendChild(host);host.querySelectorAll("[data-text-ai-close]").forEach(node=>node.onclick=()=>host.remove());return host;
  }
  function confirmDialog(title,message,confirmLabel="确认") {
    return new Promise(resolve=>{const host=modal(`<div class="pm-dialog-head"><div><b>${esc(title)}</b><span>${esc(message)}</span></div><button data-text-ai-close>×</button></div><div class="pm-dialog-actions"><button class="ghost" data-text-ai-cancel>取消</button><button class="primary" data-text-ai-confirm>${esc(confirmLabel)}</button></div>`);let done=false;const finish=value=>{if(done)return;done=true;host.remove();resolve(value)};host.querySelectorAll("[data-text-ai-close],[data-text-ai-cancel]").forEach(node=>node.onclick=()=>finish(false));host.querySelector("[data-text-ai-confirm]").onclick=()=>finish(true);});
  }
  const workspaceProjectId = workspace => workspace.querySelector("[data-text-project-id]")?.dataset.textProjectId || "";
  const workspaceConversationId = workspace => workspace.querySelector("[data-text-conversation-id]")?.dataset.textConversationId || "";
  const currentArea = workspace => workspace.querySelector("[data-text-content]");
  const currentTitle = workspace => workspace.querySelector("[data-text-title]")?.value || "文本创作";
  const uiFor = workspace => workspace._textAiUi || (workspace._textAiUi={action:"rewrite",scope:"paragraph",instruction:"",includeAssets:false,mode:"smart",modelKey:"",presetId:"",parameters:{},modelExpanded:false});

  function loadStored() {
    try {
      const value=JSON.parse(localStorage.getItem(core.storageKey(state.tenantId))||"null");if(!value||typeof value!=="object")return;
      state.presets=(Array.isArray(value.presets)?value.presets:[]).map(core.sanitizePreset);
      state.envelopes=(Array.isArray(value.envelopes)?value.envelopes:[]).filter(item=>item&&item.taskId&&item.conversationId).slice(0,100);
      state.candidates=core.mergeCandidates([],Array.isArray(value.candidates)?value.candidates:[]);
    } catch {}
  }
  function persist() {
    try {localStorage.setItem(core.storageKey(state.tenantId),JSON.stringify({version:core.VERSION,presets:state.presets.slice(0,100),envelopes:state.envelopes.slice(0,100),candidates:state.candidates.slice(0,100)}));} catch {}
  }
  const modelByKey = key => state.models.find(model=>core.modelKey(model)===key) || null;
  const presetFor = (workspace,ui) => state.presets.find(item=>item.id===ui.presetId && (item.scope!=="project"||item.projectId===workspaceProjectId(workspace))) || null;
  function availablePresets(workspace) {const projectId=workspaceProjectId(workspace);return state.presets.filter(item=>item.scope!=="project"||item.projectId===projectId);}
  function chosenModel(workspace) {
    const ui=uiFor(workspace);let preset=null,model=null;
    if(ui.mode==="preset"){preset=presetFor(workspace,ui);model=preset?modelByKey(`${preset.providerId}::${preset.modelId}`):null;}
    else if(ui.mode==="custom")model=modelByKey(ui.modelKey)||state.models[0]||null;
    else {preset=availablePresets(workspace).find(item=>item.isDefault&&modelByKey(`${item.providerId}::${item.modelId}`))||null;model=preset?modelByKey(`${preset.providerId}::${preset.modelId}`):state.models[0]||null;}
    const parameters=core.sanitizeParameters(model,preset?.parameters || (ui.mode==="custom"?ui.parameters:{}));
    return {model,preset,parameters};
  }
  function referencedAssets(workspace) {
    const conversationId=workspaceConversationId(workspace);const conversation=state.conversations.find(item=>item.id===conversationId);
    const ids=Array.isArray(conversation?.assetIds)?conversation.assetIds:[];return ids.map(id=>state.assets.find(asset=>asset.id===id&&!asset.deletedAt)).filter(Boolean);
  }
  function rangeFor(workspace,scope) {const area=currentArea(workspace);return core.resolveRange(area?.value||"",area?.selectionStart||0,area?.selectionEnd||0,scope);}
  function candidateState(task){if(!task)return"等待任务";if(task.state==="completed")return"候选已就绪";if(task.state==="failed")return"生成失败";if(task.state==="cancelled")return"任务已取消";return task.statusText||"生成中";}

  async function routeTasks(data) {
    const incoming=[];
    for(const envelope of state.envelopes){
      const task=(data.tasks||[]).find(item=>item.id===envelope.taskId);if(!task||!core.validRoute(task,envelope))continue;
      let content=String(task.resultText||"");
      if(task.state==="completed"&&!content&&task.resultAssetId){try{content=String((await api.assets.readText(task.resultAssetId))?.content||"");}catch{}}
      incoming.push({
        taskId:task.id,resultId:task.resultAssetId||task.providerJobId||task.id,clientRequestId:envelope.clientRequestId,
        projectId:envelope.projectId,conversationId:envelope.conversationId,documentId:envelope.documentId,
        action:envelope.action,actionLabel:envelope.actionLabel,scope:envelope.scope,sourceStart:envelope.sourceStart,sourceEnd:envelope.sourceEnd,sourceText:envelope.sourceText,
        providerId:task.providerId,modelId:task.modelId,state:task.state,statusText:candidateState(task),error:task.error||"",content,
        createdAt:task.createdAt||envelope.createdAt,updatedAt:task.updatedAt||new Date().toISOString()
      });
    }
    const applied=new Map(state.candidates.map(item=>[core.candidateKey(item),item]));
    state.candidates=core.mergeCandidates(state.candidates,incoming).map(item=>{const previous=applied.get(core.candidateKey(item));return previous?{...item,appliedAction:previous.appliedAction||"",branchName:previous.branchName||"",dismissed:previous.dismissed===true}:item;});
    persist();
  }

  async function refreshFromBackend(render=true) {
    if(state.loading)return;state.loading=true;
    try {
      const [identity,providers,data]=await Promise.all([api.identity?.status?.().catch(()=>null),(api.models.executionCatalog?.()||api.models.bootstrap()),api.workbench.bootstrap()]);
      const tenantId=String(identity?.tenantId||data.tasks?.[0]?.tenantId||"local");
      if(!state.loaded||tenantId!==state.tenantId){state.tenantId=tenantId;loadStored();}
      state.models=core.flattenTextModels(providers);state.tasks=data.tasks||[];state.assets=data.assets||[];state.conversations=data.textConversations||[];state.loaded=true;
      await routeTasks(data);if(render)renderAll();
    } catch(error){toast(String(error.message||error),true);}finally{state.loading=false;}
  }

  function parameterFields(model,ui) {
    const definitions=core.parameterDefinitions(model);if(!definitions.length)return`<p class="text-ai-smart-note">该模型未声明可编辑参数，将使用模型网关默认值。</p>`;
    return `<div class="text-ai-parameter-grid">${definitions.map(item=>{const value=ui.parameters[item.key]??item.default??"";if(item.type==="boolean")return`<label><span>${esc(item.label)}</span><input type="checkbox" data-text-ai-parameter="${esc(item.key)}" ${value===true||value==="true"?"checked":""}></label>`;if(item.type==="select")return`<label><span>${esc(item.label)}</span><select data-text-ai-parameter="${esc(item.key)}">${item.options.map(option=>`<option value="${esc(option)}" ${String(option)===String(value)?"selected":""}>${esc(option)}</option>`).join("")}</select></label>`;return`<label><span>${esc(item.label)}</span><input ${item.type==="number"?'type="number"':""} data-text-ai-parameter="${esc(item.key)}" value="${esc(value)}" ${item.min!==undefined?`min="${item.min}"`:""} ${item.max!==undefined?`max="${item.max}"`:""} ${item.step!==undefined?`step="${item.step}"`:""}></label>`;}).join("")}</div>`;
  }
  function candidateCard(candidate) {
    const ready=candidate.state==="completed"&&candidate.content;const locked=Boolean(candidate.appliedAction);const original=candidate.sourceText||"";
    return `<article class="text-ai-candidate ${ready?"is-ready":""} ${candidate.error?"has-error":""}" data-text-ai-candidate="${esc(candidate.taskId)}"><div class="text-ai-candidate-head"><div><b>${esc(candidate.actionLabel||"AI 候选")}</b><small>${esc(candidate.statusText||candidate.state)} · ${date(candidate.updatedAt)} · ${esc(candidate.modelId||"文本模型")}</small></div><span class="text-ai-state">${esc(candidate.state)}</span></div>${candidate.error?`<p class="text-ai-error">${esc(candidate.error)}</p>`:""}${ready?`<details class="text-ai-diff"><summary>差异预览</summary><div><section><b>原始范围</b><pre>${esc(original)}</pre></section><section><b>AI 候选</b><pre>${esc(candidate.content)}</pre></section></div></details><div class="text-ai-candidate-actions"><button class="ghost" data-text-ai-insert="${esc(candidate.taskId)}" ${locked?"disabled":""}>插入</button><button class="ghost" data-text-ai-replace="${esc(candidate.taskId)}" ${(locked||!candidate.sourceText)?"disabled":""}>替换选区</button><button class="ghost" data-text-ai-version="${esc(candidate.taskId)}" ${locked?"disabled":""}>创建版本</button><button class="ghost" data-text-ai-dismiss="${esc(candidate.taskId)}">放弃</button></div>${candidate.appliedAction?`<div class="text-ai-applied">已处理：${esc(candidate.appliedAction==="insert"?"插入正文":candidate.appliedAction==="replace"?"替换原范围":`候选版本 ${candidate.branchName||""}`)}</div>`:""}`:`<p class="text-ai-status">${esc(candidate.statusText||"等待结果")}</p>`}</article>`;
  }

  function render(workspace) {
    const host=workspace.querySelector('[data-text-assist-body="ai"]');if(!host)return;const ui=uiFor(workspace);const {model,preset,parameters}=chosenModel(workspace);
    if(!ui.modelKey&&model)ui.modelKey=core.modelKey(model);if(ui.mode==="custom"&&model)ui.parameters={...parameters,...ui.parameters};
    const range=rangeFor(workspace,ui.scope);const assets=referencedAssets(workspace);const candidates=state.candidates.filter(item=>item.conversationId===workspaceConversationId(workspace)&&!item.dismissed);
    const presets=availablePresets(workspace);
    host.innerHTML=`<section class="text-assist-card text-ai-context-card"><div class="text-ai-card-head"><div><b>围绕明确范围协作</b><small>${range.text?`当前范围 ${range.text.length} 字`:"请先输入正文"}</small></div><span>${esc(core.ACTIONS[ui.action]?.label||"改写")}</span></div><div class="text-ai-actions">${Object.entries(core.ACTIONS).map(([key,item])=>`<button class="${ui.action===key?"on":""}" data-text-ai-action="${key}">${esc(item.label)}</button>`).join("")}</div><label class="text-ai-field"><span>作用范围</span><select data-text-ai-scope><option value="selection" ${ui.scope==="selection"?"selected":""} ${currentArea(workspace)?.selectionEnd>currentArea(workspace)?.selectionStart?"":"disabled"}>选中内容</option><option value="paragraph" ${ui.scope==="paragraph"?"selected":""}>当前段落</option><option value="document" ${ui.scope==="document"?"selected":""}>全文</option></select></label><label class="text-ai-field"><span>补充要求（可选）</span><textarea data-text-ai-instruction maxlength="1000" placeholder="例如：保留人物口吻，控制在 300 字以内">${esc(ui.instruction)}</textarea></label><label class="text-ai-check"><input type="checkbox" data-text-ai-assets ${ui.includeAssets?"checked":""}><span>附带当前文档已明确引用的 ${assets.length} 个素材</span></label></section><section class="text-assist-card text-ai-model-panel ${ui.modelExpanded?"is-expanded":""}"><div class="text-assist-card-head"><div><b>模型与参数</b><small>${model?`${esc(model.providerName)} / ${esc(model.modelName)}`:"没有可用文本模型"}</small></div><button class="text-assist-chevron" data-text-ai-model-expand aria-expanded="${ui.modelExpanded}">${ui.modelExpanded?"收起":"展开"}</button></div><div class="text-ai-model-body"><div class="text-ai-mode-tabs"><button class="${ui.mode==="smart"?"on":""}" data-text-ai-mode="smart">智能默认</button><button class="${ui.mode==="custom"?"on":""}" data-text-ai-mode="custom">自定义</button><button class="${ui.mode==="preset"?"on":""}" data-text-ai-mode="preset">已保存预设</button></div>${ui.mode==="preset"?`<label class="text-ai-field"><span>预设</span><select data-text-ai-preset><option value="">选择预设</option>${presets.map(item=>{const available=Boolean(modelByKey(`${item.providerId}::${item.modelId}`));return`<option value="${esc(item.id)}" ${ui.presetId===item.id?"selected":""} ${available?"":"disabled"}>${esc(item.name)} · ${item.scope==="project"?"当前项目":"个人通用"}${available?"":"（模型不可用）"}</option>`;}).join("")}</select></label><div class="text-ai-preset-actions"><button class="ghost" data-text-ai-preset-save ${model?"":"disabled"}>另存预设</button><button class="ghost" data-text-ai-preset-rename ${preset?"":"disabled"}>重命名</button><button class="ghost" data-text-ai-preset-default ${preset?"":"disabled"}>设为默认</button><button class="ghost" data-text-ai-preset-delete ${preset?"":"disabled"}>删除</button></div>`:`<label class="text-ai-field"><span>${ui.mode==="smart"?"实际使用模型":"选择文本模型"}</span><select data-text-ai-model ${ui.mode==="smart"?"disabled":""}>${state.models.map(item=>`<option value="${esc(core.modelKey(item))}" ${model&&core.modelKey(item)===core.modelKey(model)?"selected":""}>${esc(item.providerName)} / ${esc(item.modelName)}</option>`).join("")||'<option value="">请先在模型网关启用文本模型</option>'}</select></label>${ui.mode==="custom"?parameterFields(model,ui):`<p class="text-ai-smart-note">智能默认会显示最终选定模型，并只提交该模型声明的非敏感参数。</p>`}<div class="text-ai-preset-actions"><button class="ghost" data-text-ai-preset-save ${model?"":"disabled"}>另存预设</button></div>`}</div></section><button class="primary text-ai-generate" data-text-ai-submit ${model&&range.text?"":"disabled"}>✦ 生成候选并进入统一任务</button><section class="text-ai-candidates"><div class="text-ai-candidates-head"><div><b>候选与版本</b><small>${candidates.length?`${candidates.length} 条绑定到当前文档`:"AI 结果只会先进入这里"}</small></div><button class="ghost" data-text-ai-refresh>刷新</button></div><div class="text-ai-candidate-list">${candidates.length?candidates.map(candidateCard).join(""):'<div class="text-assist-placeholder">暂无候选。提交后结果不会自动覆盖正文。</div>'}</div></section>`;
    bind(workspace,host);
  }
  function renderAll(){document.querySelectorAll('.text-workspace[data-text-layout-ready="1"]').forEach(render);}
  function updateUi(workspace,patch){Object.assign(uiFor(workspace),patch);render(workspace);}

  function bind(workspace,host) {
    const ui=uiFor(workspace);
    host.querySelectorAll("[data-text-ai-action]").forEach(button=>button.onclick=()=>updateUi(workspace,{action:button.dataset.textAiAction}));
    host.querySelector("[data-text-ai-scope]")?.addEventListener("change",event=>updateUi(workspace,{scope:event.target.value}));
    host.querySelector("[data-text-ai-instruction]")?.addEventListener("input",event=>{ui.instruction=event.target.value;});
    host.querySelector("[data-text-ai-assets]")?.addEventListener("change",event=>{ui.includeAssets=event.target.checked;});
    host.querySelector("[data-text-ai-model-expand]")?.addEventListener("click",()=>updateUi(workspace,{modelExpanded:!ui.modelExpanded}));
    host.querySelectorAll("[data-text-ai-mode]").forEach(button=>button.onclick=()=>updateUi(workspace,{mode:button.dataset.textAiMode,modelExpanded:true}));
    host.querySelector("[data-text-ai-model]")?.addEventListener("change",event=>updateUi(workspace,{modelKey:event.target.value,parameters:{}}));
    host.querySelector("[data-text-ai-preset]")?.addEventListener("change",event=>updateUi(workspace,{presetId:event.target.value}));
    host.querySelectorAll("[data-text-ai-parameter]").forEach(input=>input.addEventListener("change",()=>{ui.parameters[input.dataset.textAiParameter]=input.type==="checkbox"?input.checked:input.type==="number"?Number(input.value):input.value;}));
    host.querySelector("[data-text-ai-preset-save]")?.addEventListener("click",()=>editPreset(workspace));
    host.querySelector("[data-text-ai-preset-rename]")?.addEventListener("click",()=>editPreset(workspace,presetFor(workspace,ui)));
    host.querySelector("[data-text-ai-preset-default]")?.addEventListener("click",()=>setDefaultPreset(workspace));
    host.querySelector("[data-text-ai-preset-delete]")?.addEventListener("click",()=>deletePreset(workspace));
    host.querySelector("[data-text-ai-submit]")?.addEventListener("click",()=>openSubmissionPreview(workspace));
    host.querySelector("[data-text-ai-refresh]")?.addEventListener("click",()=>refreshFromBackend());
    host.querySelectorAll("[data-text-ai-insert]").forEach(button=>button.onclick=()=>applyCandidate(workspace,button.dataset.textAiInsert,"insert"));
    host.querySelectorAll("[data-text-ai-replace]").forEach(button=>button.onclick=()=>applyCandidate(workspace,button.dataset.textAiReplace,"replace"));
    host.querySelectorAll("[data-text-ai-version]").forEach(button=>button.onclick=()=>applyCandidate(workspace,button.dataset.textAiVersion,"version"));
    host.querySelectorAll("[data-text-ai-dismiss]").forEach(button=>button.onclick=()=>dismissCandidate(button.dataset.textAiDismiss));
  }

  function editPreset(workspace,source=null) {
    const {model,parameters}=chosenModel(workspace);if(!model)return toast("没有可保存的文本模型",true);
    const host=modal(`<div class="pm-dialog-head"><div><b>${source?"重命名预设":"保存文本预设"}</b><span>只保存模型引用和非敏感参数，不保存密钥、Cookie、服务地址或认证头。</span></div><button data-text-ai-close>×</button></div><label>预设名称<input data-text-ai-preset-name maxlength="80" value="${esc(source?.name||`${core.ACTIONS[uiFor(workspace).action]?.label||"文本"}预设`)}"></label><label>作用范围<select data-text-ai-preset-scope><option value="personal" ${source?.scope!=="project"?"selected":""}>个人通用</option><option value="project" ${source?.scope==="project"?"selected":""}>当前项目</option></select></label><div class="pm-dialog-actions"><button class="ghost" data-text-ai-close>取消</button><button class="primary" data-text-ai-preset-confirm>保存</button></div>`,"text-ai-preset-modal");
    host.querySelector("[data-text-ai-preset-confirm]").onclick=()=>{const preset=core.sanitizePreset({...(source||{}),name:host.querySelector("[data-text-ai-preset-name]").value,scope:host.querySelector("[data-text-ai-preset-scope]").value,projectId:workspaceProjectId(workspace),providerId:model.providerId,modelId:model.modelId,parameters});if(source)state.presets=state.presets.map(item=>item.id===source.id?preset:item);else state.presets.unshift(preset);uiFor(workspace).presetId=preset.id;persist();host.remove();render(workspace);toast("文本预设已保存");};
  }
  async function setDefaultPreset(workspace){const preset=presetFor(workspace,uiFor(workspace));if(!preset)return;state.presets=state.presets.map(item=>({...item,isDefault:item.id===preset.id}));persist();render(workspace);toast("已设为智能默认预设");}
  async function deletePreset(workspace){const preset=presetFor(workspace,uiFor(workspace));if(!preset)return;if(!await confirmDialog("删除文本预设",`确认删除“${preset.name}”？`))return;state.presets=state.presets.filter(item=>item.id!==preset.id);uiFor(workspace).presetId="";persist();render(workspace);}

  async function openSubmissionPreview(workspace) {
    const ui=uiFor(workspace),choice=chosenModel(workspace),range=rangeFor(workspace,ui.scope);if(!choice.model||!range.text)return toast("请选择文本模型并确认作用范围",true);
    const assets=ui.includeAssets?referencedAssets(workspace):[];const prompt=core.buildPrompt({action:ui.action,sourceText:range.text,instruction:ui.instruction,documentTitle:currentTitle(workspace),assetNames:assets.map(item=>item.name)});
    const envelope=core.buildEnvelope({projectId:workspaceProjectId(workspace),conversationId:workspaceConversationId(workspace),documentTitle:currentTitle(workspace),action:ui.action,scope:ui.scope,range,sourceAssetIds:assets.map(item=>item.id),providerId:choice.model.providerId,modelId:choice.model.modelId,modelParameters:choice.parameters,prompt});
    const parameterText=Object.keys(choice.parameters).length?JSON.stringify(choice.parameters):"模型默认参数";
    const host=modal(`<div class="pm-dialog-head"><div><b>文本生成提交预览</b><span>确认后进入统一 generation.create()；AI 结果只回到当前候选区。</span></div><button data-text-ai-close>×</button></div><div class="text-ai-submit-preview"><dl><div><dt>项目 / 文档</dt><dd>${esc(envelope.projectId)} / ${esc(envelope.conversationId)}</dd></div><div><dt>动作 / 范围</dt><dd>${esc(envelope.actionLabel)} / ${esc(envelope.scope)} · ${envelope.sourceText.length} 字</dd></div><div><dt>实际模型</dt><dd>${esc(choice.model.providerName)} / ${esc(choice.model.modelName)}</dd></div><div><dt>非敏感参数</dt><dd>${esc(parameterText)}</dd></div><div><dt>素材</dt><dd>${assets.length?`${assets.length} 个明确引用素材`:"不附带素材"}</dd></div><div><dt>请求标识</dt><dd>${esc(envelope.clientRequestId)}</dd></div></dl><details><summary>查看最终提示词</summary><pre>${esc(prompt)}</pre></details><p>结果不会自动插入、替换或创建正文版本；需要在候选卡片中再次确认。</p></div><div class="pm-dialog-actions"><button class="ghost" data-text-ai-close>返回修改</button><button class="primary" data-text-ai-submit-confirm>确认提交</button></div>`,"text-ai-submit-modal");
    host.querySelector("[data-text-ai-submit-confirm]").onclick=async()=>{const button=host.querySelector("[data-text-ai-submit-confirm]");button.disabled=true;button.textContent="正在创建任务…";try{
      const task=await api.generation.create({title:`${currentTitle(workspace)} · ${envelope.actionLabel}`,prompt,projectId:envelope.projectId,creationType:"text",creationSource:"text-workspace-ai",executionChannel:"model-gateway",providerId:envelope.providerId,modelId:envelope.modelId,assetIds:envelope.sourceAssetIds,parameters:envelope.modelParameters,modelParameters:envelope.modelParameters,clientRequestId:envelope.clientRequestId});
      envelope.taskId=task.id;envelope.state="submitted";envelope.updatedAt=new Date().toISOString();state.envelopes.unshift(envelope);state.envelopes=state.envelopes.filter((item,index,list)=>list.findIndex(other=>other.taskId===item.taskId)===index).slice(0,100);persist();host.remove();await refreshFromBackend();toast("文本任务已进入统一任务，结果将回到当前候选区");
    }catch(error){toast(String(error.message||error),true);button.disabled=false;button.textContent="确认提交";}};
  }

  async function applyCandidate(workspace,taskId,mode) {
    const candidate=state.candidates.find(item=>item.taskId===taskId&&item.conversationId===workspaceConversationId(workspace));if(!candidate||!candidate.content||candidate.appliedAction)return;
    const labels={insert:"插入正文",replace:"替换原范围",version:"创建候选版本"};
    const host=modal(`<div class="pm-dialog-head"><div><b>${labels[mode]} · 人工确认</b><span>当前正文不会在确认前发生变化。</span></div><button data-text-ai-close>×</button></div><div class="text-ai-diff text-ai-confirm-diff"><div><section><b>原始范围</b><pre>${esc(candidate.sourceText||"无固定范围")}</pre></section><section><b>AI 候选</b><pre>${esc(candidate.content)}</pre></section></div></div>${mode==="version"?`<label>版本名称<input data-text-ai-branch-name maxlength="80" value="${esc(`${candidate.actionLabel} ${date(candidate.updatedAt)}`)}"></label>`:""}<div class="pm-dialog-actions"><button class="ghost" data-text-ai-close>取消</button><button class="primary" data-text-ai-apply-confirm>确认${labels[mode]}</button></div>`,"text-ai-apply-modal");
    host.querySelector("[data-text-ai-apply-confirm]").onclick=()=>{const area=currentArea(workspace);if(!area)return;
      if(mode==="replace"){
        const current=area.value.slice(candidate.sourceStart,candidate.sourceEnd);if(current!==candidate.sourceText){host.remove();return toast("原范围已经变化，为避免覆盖新内容，请重新选择范围生成候选",true);}area.value=`${area.value.slice(0,candidate.sourceStart)}${candidate.content}${area.value.slice(candidate.sourceEnd)}`;area.setSelectionRange(candidate.sourceStart,candidate.sourceStart+candidate.content.length);area.dispatchEvent(new Event("input",{bubbles:true}));
      } else if(mode==="insert") {const position=Number.isFinite(area.selectionStart)?area.selectionStart:area.value.length;const prefix=position>0&&!/\s$/.test(area.value.slice(0,position))?"\n":"";area.value=`${area.value.slice(0,position)}${prefix}${candidate.content}${area.value.slice(position)}`;area.setSelectionRange(position+prefix.length,position+prefix.length+candidate.content.length);area.dispatchEvent(new Event("input",{bubbles:true}));}
      candidate.appliedAction=mode;candidate.branchName=mode==="version"?host.querySelector("[data-text-ai-branch-name]").value.trim()||candidate.actionLabel:"";candidate.updatedAt=new Date().toISOString();persist();host.remove();render(workspace);toast(mode==="version"?"候选版本已保留，正文未被覆盖":`${labels[mode]}完成`);
    };
  }
  async function dismissCandidate(taskId){const candidate=state.candidates.find(item=>item.taskId===taskId);if(!candidate)return;if(!await confirmDialog("放弃 AI 候选","放弃只隐藏候选，不会删除任务或结果素材。"))return;candidate.dismissed=true;candidate.updatedAt=new Date().toISOString();persist();renderAll();}

  function importExternalCandidate(input={}) {
    const taskId=String(input.taskId||"").slice(0,100),resultId=String(input.resultId||taskId).slice(0,180),clientRequestId=String(input.clientRequestId||"").slice(0,180);
    const projectId=String(input.projectId||"").slice(0,100),conversationId=String(input.conversationId||"").slice(0,180),content=String(input.content||"").slice(0,200000);
    if(!taskId||!resultId||!clientRequestId||!projectId||!conversationId||!content)throw new Error("研究结果缺少候选绑定信息");
    const now=new Date().toISOString();
    const candidate={
      taskId,resultId,clientRequestId,projectId,conversationId,documentId:conversationId,
      action:String(input.action||"research").slice(0,80),actionLabel:String(input.actionLabel||"资料研究").slice(0,120),
      sourceStart:Math.max(0,Number(input.sourceStart)||0),sourceEnd:Math.max(0,Number(input.sourceEnd)||0),sourceText:String(input.sourceText||"").slice(0,12000),
      sourceAssetIds:[...new Set((Array.isArray(input.sourceAssetIds)?input.sourceAssetIds:[]).map(value=>String(value||"").slice(0,100)).filter(Boolean))].slice(0,10),
      providerId:String(input.providerId||"").slice(0,180),modelId:String(input.modelId||"").slice(0,180),content,
      state:"completed",statusText:String(input.statusText||"研究结果已保留为候选").slice(0,500),error:"",dismissed:false,
      appliedAction:input.appliedAction==="version"?"version":"",branchName:input.appliedAction==="version"?String(input.branchName||input.actionLabel||"研究候选版本").slice(0,80):"",
      createdAt:String(input.createdAt||now),updatedAt:now,externalSource:"text-workspace-research"
    };
    state.candidates=core.mergeCandidates(state.candidates,[candidate]);persist();renderAll();return candidate;
  }
  window.lingframeTextAiBatchC.importCandidate=importExternalCandidate;

  function enhance(workspace){if(workspace.dataset.textAiReady==="1")return;workspace.dataset.textAiReady="1";const area=currentArea(workspace);area?.addEventListener("select",()=>{if(uiFor(workspace).scope==="selection")render(workspace)});area?.addEventListener("keyup",()=>{if(uiFor(workspace).scope==="paragraph")render(workspace)});render(workspace);}
  function scan(){document.querySelectorAll('.text-workspace[data-text-layout-ready="1"]').forEach(enhance);}
  document.addEventListener("click",event=>{const button=event.target.closest("[data-text-generate]");if(!button)return;event.preventDefault();event.stopImmediatePropagation();const workspace=button.closest(".text-workspace");if(!workspace)return;workspace.querySelector('[data-text-assist-tab="ai"]')?.click();workspace.querySelector(".text-assist")?.scrollIntoView({block:"nearest"});render(workspace);toast("已打开 AI 协作，请选择动作、范围和模型参数");},true);
  new MutationObserver(scan).observe(document.body,{childList:true,subtree:true});
  window.addEventListener("lingframe:generation-status",event=>{if(event.detail?.creationSource==="text-workspace-ai"||state.envelopes.some(item=>item.taskId===event.detail?.taskId))refreshFromBackend();});
  window.addEventListener("focus",()=>refreshFromBackend());document.addEventListener("visibilitychange",()=>{if(!document.hidden)refreshFromBackend();});
  state.timer=setInterval(()=>{if(document.querySelector('.nav.active')?.dataset.page==="text"&&state.envelopes.some(item=>!state.candidates.some(candidate=>candidate.taskId===item.taskId&&["completed","failed","cancelled"].includes(candidate.state))))refreshFromBackend();},3000);
  Promise.resolve(api.identity?.status?.()).then(identity=>{state.tenantId=String(identity?.tenantId||"local");loadStored();return refreshFromBackend(false)}).then(()=>{scan();renderAll();}).catch(()=>{scan();});
})();
