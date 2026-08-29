(() => {
  "use strict";
  const api = window.lingframe;
  const core = window.lingframeTextResearchCore;
  const aiCore = window.lingframeTextAiCore;
  if (!api?.generation?.create || !api?.models?.bootstrap || !api?.workbench?.bootstrap || !api?.assets?.readText || !core || !aiCore) return;

  window.lingframeTextResearchBatchD = {version:core.VERSION, ownsResearch:true, maximumContextChars:core.MAX_CONTEXT_CHARS};
  const state = {tenantId:"local", models:[], envelopes:[], results:[], drafts:{}, tasks:[], assets:[], conversations:[], loading:false, loaded:false, timer:null};
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  const date = value => value ? new Date(value).toLocaleString("zh-CN", {month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}) : "--";
  const workspaceProjectId = workspace => workspace.querySelector("[data-text-project-id]")?.dataset.textProjectId || "";
  const workspaceConversationId = workspace => workspace.querySelector("[data-text-conversation-id]")?.dataset.textConversationId || "";
  const currentTitle = workspace => workspace.querySelector("[data-text-title]")?.value || "文本创作";
  const modelByKey = key => state.models.find(model => aiCore.modelKey(model) === key) || null;
  const sourceLocation = asset => asset?.sourceLocation || asset?.notes || asset?.originalName || "素材中心";
  const sourceLabel = asset => {
    const source=String(asset?.source||"").toLowerCase();
    if(source.includes("literature")||source.includes("reference")||source.includes("文献"))return"文献参考";
    if(source.includes("research"))return"研究结果";
    if(source.includes("generated")||source.includes("ai"))return"AI 生成";
    if(source.includes("project"))return"项目资料";
    return"文本素材";
  };
  const toast = (message,error=false) => {
    let node=document.querySelector(".pm-toast");if(!node){node=document.createElement("div");document.body.appendChild(node);}
    node.className=`pm-toast ${error?"error":""}`;node.textContent=message;clearTimeout(node.timer);node.timer=setTimeout(()=>node.remove(),3600);
  };
  function modal(content,className="") {
    const host=document.createElement("div");host.className=`pm-modal ${className}`;
    host.innerHTML=`<div class="pm-modal-backdrop" data-text-research-close></div><div class="pm-dialog glass">${content}</div>`;
    document.body.appendChild(host);host.querySelectorAll("[data-text-research-close]").forEach(node=>node.onclick=()=>host.remove());return host;
  }
  function confirmDialog(title,message,label="确认") {
    return new Promise(resolve=>{const host=modal(`<div class="pm-dialog-head"><div><b>${esc(title)}</b><span>${esc(message)}</span></div><button data-text-research-close>×</button></div><div class="pm-dialog-actions"><button class="ghost" data-text-research-cancel>取消</button><button class="primary" data-text-research-confirm>${esc(label)}</button></div>`);let done=false;const finish=value=>{if(done)return;done=true;host.remove();resolve(value)};host.querySelectorAll("[data-text-research-close],[data-text-research-cancel]").forEach(node=>node.onclick=()=>finish(false));host.querySelector("[data-text-research-confirm]").onclick=()=>finish(true);});
  }

  function loadStored() {
    try {
      const value=JSON.parse(localStorage.getItem(core.storageKey(state.tenantId))||"null");if(!value||typeof value!=="object")return;
      state.envelopes=(Array.isArray(value.envelopes)?value.envelopes:[]).filter(item=>item&&item.taskId&&item.conversationId).slice(0,100);
      state.results=core.mergeResults([],Array.isArray(value.results)?value.results:[]);
      const drafts=value.drafts&&typeof value.drafts==="object"?value.drafts:{};
      state.drafts=Object.fromEntries(Object.entries(drafts).slice(0,100).map(([key,draft])=>[String(key).slice(0,180),core.sanitizeDraft(draft)]));
    } catch {}
  }
  function persist() {
    try {localStorage.setItem(core.storageKey(state.tenantId),JSON.stringify({version:core.VERSION,envelopes:state.envelopes.slice(0,100),results:state.results.slice(0,100),drafts:state.drafts}));} catch {}
  }
  function draftFor(workspace) {
    const id=workspaceConversationId(workspace);const draft=state.drafts[id]||(state.drafts[id]=core.sanitizeDraft({}));
    draft.sources=core.normalizeSources(draft.sources).filter(source=>source.projectId===workspaceProjectId(workspace));
    if(draft.modelKey&&!modelByKey(draft.modelKey))draft.modelKey="";
    return draft;
  }
  function selectedModel(workspace) {const draft=draftFor(workspace);return modelByKey(draft.modelKey)||state.models[0]||null;}
  function saveDraft(workspace) {state.drafts[workspaceConversationId(workspace)]=core.sanitizeDraft(draftFor(workspace));persist();}
  function projectTextAssets(workspace) {const projectId=workspaceProjectId(workspace);return state.assets.filter(asset=>asset.projectId===projectId&&asset.type==="text"&&!asset.deletedAt&&!asset.archivedAt);}

  async function recoverResults(data) {
    const incoming=[];
    for(const envelope of state.envelopes){
      const task=(data.tasks||[]).find(item=>item.id===envelope.taskId);if(!task||!core.validRoute(task,envelope))continue;
      let content=String(task.resultText||"");
      if(task.state==="completed"&&!content&&task.resultAssetId){try{content=String((await api.assets.readText(task.resultAssetId))?.content||"");}catch{}}
      incoming.push({
        taskId:task.id,resultId:task.id,providerResultId:task.resultAssetId||task.providerJobId||"",clientRequestId:envelope.clientRequestId,
        projectId:envelope.projectId,conversationId:envelope.conversationId,documentId:envelope.documentId,
        action:envelope.action,actionLabel:envelope.actionLabel,query:envelope.query,sources:envelope.sources||[],sourceAssetIds:envelope.sourceAssetIds||[],contextChars:envelope.contextChars||0,
        providerId:task.providerId||envelope.providerId,modelId:task.modelId||envelope.modelId,content,state:task.state,
        statusText:task.state==="completed"?"研究结果已就绪":task.state==="failed"?"研究任务失败":task.state==="cancelled"?"研究任务已取消":task.statusText||"研究任务执行中",
        error:task.error||task.providerMessage||"",createdAt:task.createdAt||envelope.createdAt,updatedAt:task.updatedAt||envelope.updatedAt
      });
    }
    state.results=core.mergeResults(state.results,incoming);persist();
  }
  async function refreshFromBackend(renderAfter=true) {
    if(state.loading)return;state.loading=true;
    try {
      const [identity,providers,data]=await Promise.all([api.identity?.status?.().catch(()=>null),(api.models.executionCatalog?.()||api.models.bootstrap()),api.workbench.bootstrap()]);
      const tenantId=String(identity?.tenantId||"local");if(tenantId!==state.tenantId){state.tenantId=tenantId;state.envelopes=[];state.results=[];state.drafts={};loadStored();}
      state.models=aiCore.flattenTextModels(providers);state.tasks=data.tasks||[];state.assets=data.assets||[];state.conversations=data.textConversations||[];state.loaded=true;
      await recoverResults(data);if(renderAfter)renderAll();
    } catch(error){toast(String(error.message||error),true);} finally {state.loading=false;}
  }

  function validationFor(workspace) {const draft=draftFor(workspace);return core.validateResearch({action:draft.action,query:draft.query,sources:draft.sources});}
  function sourceCard(source,index) {
    return `<article class="text-research-source" data-text-research-source="${esc(source.sourceId)}"><div><b>[S${index+1}] ${esc(source.name)}</b><small>${esc(source.sourceLocation||source.originalName||"素材中心")} · 范围 ${source.excerptStart}-${source.excerptEnd}</small></div><span>${source.excerpt.length} 字</span><button class="ghost" data-text-research-source-remove="${esc(source.sourceId)}">移除</button><p>${esc(source.excerpt.slice(0,180))}${source.excerpt.length>180?"…":""}</p></article>`;
  }
  function resultCard(result) {
    const ready=result.state==="completed"&&Boolean(result.content);const locked=result.dismissed;
    return `<article class="text-research-result ${ready?"is-ready":""} ${result.error?"has-error":""}" data-text-research-result="${esc(result.taskId)}"><div class="text-research-result-head"><div><b>${esc(result.actionLabel||"资料研究")}</b><small>${esc(result.statusText||result.state)} · ${date(result.updatedAt)} · ${esc(result.modelId||"文本模型")}</small></div><span>${esc(result.state)}</span></div><p class="text-research-question">${esc(result.query||"")}</p>${result.error?`<p class="text-ai-error">${esc(result.error)}</p>`:""}<div class="text-research-result-sources">${(result.sources||[]).map((source,index)=>`<span>[S${index+1}] ${esc(source.name)} · ${source.excerpt.length} 字</span>`).join("")||"<span>未附带来源：这是检索计划，不是联网结果</span>"}</div>${ready?`<details><summary>查看研究结果</summary><pre>${esc(result.content)}</pre></details><div class="text-research-result-actions"><button class="ghost" data-text-research-candidate="${esc(result.taskId)}" ${locked||result.savedCandidate?"disabled":""}>${result.savedCandidate?"已保留候选":"保留为候选"}</button><button class="ghost" data-text-research-version="${esc(result.taskId)}" ${locked||result.savedVersion?"disabled":""}>${result.savedVersion?"已创建版本":"创建候选版本"}</button><button class="ghost" data-text-research-asset="${esc(result.taskId)}" ${locked||result.savedAssetId?"disabled":""}>${result.savedAssetId?"已保存素材":"保存到素材中心"}</button><button class="ghost" data-text-research-dismiss="${esc(result.taskId)}">${locked?"已放弃":"放弃"}</button></div>`:`<p class="text-research-status">${esc(result.statusText||"等待结果")}</p>`}</article>`;
  }
  function render(workspace) {
    const host=workspace.querySelector('[data-text-assist-body="research"]');if(!host)return;
    const draft=draftFor(workspace),model=selectedModel(workspace),validation=validationFor(workspace);
    const results=state.results.filter(item=>item.conversationId===workspaceConversationId(workspace)&&!item.dismissed);
    host.innerHTML=`<section class="text-assist-card text-research-compose"><div class="text-research-title"><div><b>资料研究与上下文</b><small>只有明确选中的摘录会进入本次任务</small></div><span>${validation.contextChars}/${core.MAX_CONTEXT_CHARS} 字</span></div><div class="text-research-actions">${Object.entries(core.ACTIONS).map(([key,item])=>`<button class="${draft.action===key?"on":""}" data-text-research-action="${key}">${esc(item.label)}</button>`).join("")}</div><label class="text-ai-field"><span>研究问题或整理目标</span><textarea data-text-research-query maxlength="1200" placeholder="例如：比较两份资料对目标用户和核心卖点的不同判断">${esc(draft.query)}</textarea></label><div class="text-research-context-head"><div><b>本次来源摘录</b><small>${draft.sources.length} 个来源 · ${validation.contextChars} 字</small></div><div><button class="ghost" data-text-research-pick>选择项目资料</button><button class="ghost" data-text-research-manual>新增文献摘录</button></div></div><div class="text-research-source-list">${draft.sources.length?draft.sources.map(sourceCard).join(""):'<div class="text-assist-placeholder">尚未选择来源。长文不会自动整篇加入上下文。</div>'}</div><label class="text-ai-field"><span>实际使用模型</span><select data-text-research-model>${state.models.map(item=>`<option value="${esc(aiCore.modelKey(item))}" ${model&&aiCore.modelKey(item)===aiCore.modelKey(model)?"selected":""}>${esc(item.providerName)} / ${esc(item.modelName)}</option>`).join("")||'<option value="">请先在模型网关启用文本模型</option>'}</select></label>${validation.errors.length?`<div class="text-research-validation">${validation.errors.map(error=>`<span>${esc(error)}</span>`).join("")}</div>`:""}<button class="primary text-research-submit" data-text-research-submit ${model&&validation.ok?"":"disabled"}>✦ 创建资料研究任务</button><p class="text-research-disclaimer">“资料查找”生成检索词和核验计划；当前不会伪装成已经联网取得结果。</p></section><section class="text-research-results"><div class="text-ai-candidates-head"><div><b>研究结果</b><small>${results.length?`${results.length} 条绑定到当前文档`:"结果只回到当前研究区"}</small></div><button class="ghost" data-text-research-refresh>刷新</button></div><div class="text-research-result-list">${results.length?results.map(resultCard).join(""):'<div class="text-assist-placeholder">暂无研究结果。结果不会自动写入正文。</div>'}</div></section>`;
    bind(workspace,host);
  }
  function renderAll(){document.querySelectorAll('.text-workspace[data-text-research-ready="1"]').forEach(render);}
  function updateSubmitState(workspace) {const button=workspace.querySelector("[data-text-research-submit]");if(button)button.disabled=!selectedModel(workspace)||!validationFor(workspace).ok;}
  function bind(workspace,host) {
    host.querySelectorAll("[data-text-research-action]").forEach(button=>button.onclick=()=>{draftFor(workspace).action=button.dataset.textResearchAction;saveDraft(workspace);render(workspace);});
    host.querySelector("[data-text-research-query]")?.addEventListener("input",event=>{draftFor(workspace).query=event.target.value;saveDraft(workspace);updateSubmitState(workspace);});
    host.querySelector("[data-text-research-model]")?.addEventListener("change",event=>{draftFor(workspace).modelKey=event.target.value;saveDraft(workspace);updateSubmitState(workspace);});
    host.querySelector("[data-text-research-pick]")?.addEventListener("click",()=>openSourcePicker(workspace));
    host.querySelector("[data-text-research-manual]")?.addEventListener("click",()=>openManualSource(workspace));
    host.querySelectorAll("[data-text-research-source-remove]").forEach(button=>button.onclick=()=>{const draft=draftFor(workspace);draft.sources=draft.sources.filter(source=>source.sourceId!==button.dataset.textResearchSourceRemove);saveDraft(workspace);render(workspace);});
    host.querySelector("[data-text-research-submit]")?.addEventListener("click",()=>openSubmissionPreview(workspace));
    host.querySelector("[data-text-research-refresh]")?.addEventListener("click",()=>refreshFromBackend());
    host.querySelectorAll("[data-text-research-candidate]").forEach(button=>button.onclick=()=>saveAsCandidate(workspace,button.dataset.textResearchCandidate));
    host.querySelectorAll("[data-text-research-version]").forEach(button=>button.onclick=()=>saveAsVersion(workspace,button.dataset.textResearchVersion));
    host.querySelectorAll("[data-text-research-asset]").forEach(button=>button.onclick=()=>saveAsAsset(workspace,button.dataset.textResearchAsset));
    host.querySelectorAll("[data-text-research-dismiss]").forEach(button=>button.onclick=()=>dismissResult(button.dataset.textResearchDismiss));
  }

  function openSourcePicker(workspace) {
    const assets=projectTextAssets(workspace);const host=modal(`<div class="pm-dialog-head"><div><b>选择项目资料</b><span>打开素材后必须明确选择摘录；系统不会默认注入整篇文档。</span></div><button data-text-research-close>×</button></div><input class="text-research-source-search" data-text-research-source-search placeholder="搜索素材名称、来源或备注"><div class="text-research-picker-list" data-text-research-picker-list></div>`,"text-research-picker-modal");
    const draw=()=>{const query=host.querySelector("[data-text-research-source-search]").value.trim().toLowerCase();const visible=assets.filter(asset=>!query||`${asset.name} ${asset.originalName||""} ${asset.source||""} ${asset.notes||""}`.toLowerCase().includes(query));const list=host.querySelector("[data-text-research-picker-list]");list.innerHTML=visible.map(asset=>`<article><div><b>${esc(asset.name)}</b><small>${esc(sourceLabel(asset))} · ${esc(sourceLocation(asset))}</small></div><button class="ghost" data-text-research-open-asset="${esc(asset.id)}">选择摘录</button></article>`).join("")||'<div class="text-assist-placeholder">当前项目没有可用文本素材。</div>';list.querySelectorAll("[data-text-research-open-asset]").forEach(button=>button.onclick=()=>{const asset=assets.find(item=>item.id===button.dataset.textResearchOpenAsset);host.remove();if(asset)openExcerptSelector(workspace,asset);});};
    host.querySelector("[data-text-research-source-search]").oninput=draw;draw();
  }
  async function openExcerptSelector(workspace,asset) {
    try {
      if(asset.projectId!==workspaceProjectId(workspace))throw new Error("只能选择当前项目资料");
      const content=String((await api.assets.readText(asset.id))?.content||"");if(!content)throw new Error("素材没有可读取的文本内容");
      const host=modal(`<div class="pm-dialog-head"><div><b>选择摘录 · ${esc(asset.name)}</b><span>${esc(sourceLocation(asset))} · 必须选择具体片段</span></div><button data-text-research-close>×</button></div><textarea class="text-research-excerpt-editor" data-text-research-excerpt>${esc(content)}</textarea><div class="text-research-selection-status" data-text-research-selection-status>尚未选择摘录</div><div class="pm-dialog-actions"><button class="ghost" data-text-research-select-all>明确选择全部可读内容</button><button class="ghost" data-text-research-close>取消</button><button class="primary" data-text-research-add-excerpt>加入选中片段</button></div>`,"text-research-excerpt-modal");
      const editor=host.querySelector("[data-text-research-excerpt]"),status=host.querySelector("[data-text-research-selection-status]");const update=()=>{const length=Math.max(0,editor.selectionEnd-editor.selectionStart);status.textContent=length?`已选择 ${length} 字 · 范围 ${editor.selectionStart}-${editor.selectionEnd}`:"尚未选择摘录";status.classList.toggle("is-over",length>core.MAX_EXCERPT_CHARS);};editor.onselect=update;editor.onkeyup=update;host.querySelector("[data-text-research-select-all]").onclick=()=>{editor.focus();editor.setSelectionRange(0,editor.value.length);update();};
      host.querySelector("[data-text-research-add-excerpt]").onclick=()=>{let start=editor.selectionStart,end=editor.selectionEnd;if(end<=start)return toast("请先在原文中选择需要加入上下文的片段",true);const raw=editor.value.slice(start,end),leading=raw.search(/\S/),trailing=raw.match(/\s*$/)?.[0]?.length||0;if(leading<0)return toast("选择内容不能为空",true);start+=leading;end-=trailing;const excerpt=editor.value.slice(start,end);if(excerpt.length>core.MAX_EXCERPT_CHARS)return toast(`单个摘录不能超过 ${core.MAX_EXCERPT_CHARS} 字`,true);const source=core.sanitizeSource({assetId:asset.id,projectId:asset.projectId,name:asset.name,originalName:asset.originalName,source:asset.source,sourceLocation:sourceLocation(asset),excerpt,excerptStart:start,excerptEnd:end});const draft=draftFor(workspace);if(draft.sources.some(item=>core.sourceKey(item)===core.sourceKey(source)))return toast("这段摘录已经加入上下文",true);const next=core.normalizeSources([...draft.sources,source]);if(next.length===draft.sources.length)return toast(`最多选择 ${core.MAX_SOURCES} 个来源`,true);if(core.contextSize(next)>core.MAX_CONTEXT_CHARS)return toast(`上下文超过 ${core.MAX_CONTEXT_CHARS} 字，请缩小摘录范围`,true);draft.sources=next;saveDraft(workspace);host.remove();render(workspace);toast(`已加入来源：${asset.name}`);};editor.focus();
    } catch(error){toast(String(error.message||error),true);}
  }
  function openManualSource(workspace) {
    if(!api.assets.createText)return toast("当前版本未加载共享文本素材契约",true);
    const host=modal(`<div class="pm-dialog-head"><div><b>新增文献摘录</b><span>摘录会先保存为素材中心正式文本素材，再加入本次上下文。</span></div><button data-text-research-close>×</button></div><label>来源名称<input data-text-research-manual-name maxlength="120" placeholder="例如：品牌调研报告 2026"></label><label>来源链接或位置<input data-text-research-manual-location maxlength="1000" placeholder="https://… 或 文献章节、页码"></label><label>明确摘录<textarea data-text-research-manual-content maxlength="4000" placeholder="只粘贴本次需要引用的片段"></textarea></label><div class="pm-dialog-actions"><button class="ghost" data-text-research-close>取消</button><button class="primary" data-text-research-manual-save>保存并加入上下文</button></div>`,"text-research-manual-modal");
    host.querySelector("[data-text-research-manual-save]").onclick=async()=>{const button=host.querySelector("[data-text-research-manual-save]"),name=host.querySelector("[data-text-research-manual-name]").value.trim(),location=host.querySelector("[data-text-research-manual-location]").value.trim(),excerpt=host.querySelector("[data-text-research-manual-content]").value.trim();if(!name||!excerpt)return toast("请输入来源名称和明确摘录",true);const draft=draftFor(workspace);if(draft.sources.length>=core.MAX_SOURCES)return toast(`最多选择 ${core.MAX_SOURCES} 个来源`,true);if(core.contextSize(draft.sources)+excerpt.length>core.MAX_CONTEXT_CHARS)return toast(`上下文超过 ${core.MAX_CONTEXT_CHARS} 字，请减少已有摘录`,true);button.disabled=true;try{const asset=await api.assets.createText({projectId:workspaceProjectId(workspace),name,content:excerpt,source:"literature-reference",sourceLocation:location||`conversation:${workspaceConversationId(workspace)}`,tags:["文献参考","研究摘录"],notes:location?`来源：${location}`:"用户手动录入的研究摘录"});state.assets.unshift(asset);const source=core.sanitizeSource({assetId:asset.id,projectId:asset.projectId,name:asset.name,originalName:asset.originalName,source:asset.source,sourceLocation:location||asset.sourceLocation,excerpt,excerptStart:0,excerptEnd:excerpt.length});draft.sources=core.normalizeSources([...draft.sources,source]);saveDraft(workspace);host.remove();render(workspace);toast("文献摘录已保存到素材中心并加入上下文");}catch(error){toast(String(error.message||error),true);button.disabled=false;}};
  }

  async function openSubmissionPreview(workspace) {
    const draft=draftFor(workspace),validation=validationFor(workspace),model=selectedModel(workspace);if(!validation.ok)return toast(validation.errors[0],true);if(!model)return toast("请先在模型网关启用文本模型",true);
    const parameters=aiCore.sanitizeParameters(model,{}),prompt=core.buildPrompt(validation),envelope=core.buildEnvelope({projectId:workspaceProjectId(workspace),conversationId:workspaceConversationId(workspace),documentTitle:currentTitle(workspace),action:validation.action,query:validation.query,sources:validation.sources,providerId:model.providerId,modelId:model.modelId,modelParameters:parameters,prompt});
    const host=modal(`<div class="pm-dialog-head"><div><b>资料研究提交预览</b><span>确认后进入统一 generation.create()；只提交明确选择的摘录文本。</span></div><button data-text-research-close>×</button></div><div class="text-research-submit-preview"><dl><div><dt>项目 / 文档</dt><dd>${esc(envelope.projectId)} / ${esc(envelope.conversationId)}</dd></div><div><dt>任务</dt><dd>${esc(envelope.actionLabel)} · ${esc(envelope.query)}</dd></div><div><dt>来源上下文</dt><dd>${envelope.sources.length} 个来源 · ${envelope.contextChars} 字</dd></div><div><dt>实际模型</dt><dd>${esc(model.providerName)} / ${esc(model.modelName)}</dd></div><div><dt>非敏感参数</dt><dd>${esc(Object.keys(parameters).length?JSON.stringify(parameters):"模型默认参数")}</dd></div><div><dt>请求标识</dt><dd>${esc(envelope.clientRequestId)}</dd></div></dl><div class="text-research-preview-sources">${envelope.sources.map((source,index)=>`<span>[S${index+1}] ${esc(source.name)} · 范围 ${source.excerptStart}-${source.excerptEnd} · ${source.excerpt.length} 字</span>`).join("")||'<span>无来源摘录：只生成检索与核验计划</span>'}</div><details><summary>查看最终提示词</summary><pre>${esc(prompt)}</pre></details><p>任务不会自动注入整篇素材，也不会自动写入正文。</p></div><div class="pm-dialog-actions"><button class="ghost" data-text-research-close>返回修改</button><button class="primary" data-text-research-submit-confirm>确认提交</button></div>`,"text-research-submit-modal");
    host.querySelector("[data-text-research-submit-confirm]").onclick=async()=>{const button=host.querySelector("[data-text-research-submit-confirm]");button.disabled=true;button.textContent="正在创建研究任务…";try{const task=await api.generation.create({title:`${currentTitle(workspace)} · ${envelope.actionLabel}`,prompt,projectId:envelope.projectId,creationType:"text",creationSource:"text-workspace-research",executionChannel:"model-gateway",providerId:envelope.providerId,modelId:envelope.modelId,parameters:envelope.modelParameters,modelParameters:envelope.modelParameters,clientRequestId:envelope.clientRequestId});envelope.taskId=task.id;envelope.state="submitted";envelope.updatedAt=new Date().toISOString();state.envelopes.unshift(envelope);state.envelopes=state.envelopes.filter((item,index,list)=>list.findIndex(other=>other.taskId===item.taskId)===index).slice(0,100);persist();host.remove();await refreshFromBackend();toast("资料研究已进入统一任务，结果将回到当前研究区");}catch(error){toast(String(error.message||error),true);button.disabled=false;button.textContent="确认提交";}};
  }
  const resultByTask = taskId => state.results.find(result=>result.taskId===taskId) || null;
  function candidateInput(result,extra={}) {return {taskId:result.taskId,resultId:result.resultId,clientRequestId:result.clientRequestId,projectId:result.projectId,conversationId:result.conversationId,action:`research-${result.action}`,actionLabel:`资料研究 · ${result.actionLabel}`,sourceAssetIds:result.sourceAssetIds,providerId:result.providerId,modelId:result.modelId,content:result.content,statusText:"研究结果已保留为候选",createdAt:result.createdAt,...extra};}
  function saveAsCandidate(workspace,taskId) {const result=resultByTask(taskId);if(!result?.content||result.savedCandidate)return;try{if(!window.lingframeTextAiBatchC?.importCandidate)throw new Error("批次 C 候选接口尚未加载");window.lingframeTextAiBatchC.importCandidate(candidateInput(result));result.savedCandidate=true;result.updatedAt=new Date().toISOString();persist();render(workspace);toast("研究结果已保留到 AI 候选区");}catch(error){toast(String(error.message||error),true);}}
  function saveAsVersion(workspace,taskId) {const result=resultByTask(taskId);if(!result?.content||result.savedVersion)return;const host=modal(`<div class="pm-dialog-head"><div><b>创建研究候选版本</b><span>保存为候选分支，不会覆盖当前正文。</span></div><button data-text-research-close>×</button></div><label>版本名称<input data-text-research-version-name maxlength="80" value="${esc(`${result.actionLabel} ${date(result.updatedAt)}`)}"></label><div class="pm-dialog-actions"><button class="ghost" data-text-research-close>取消</button><button class="primary" data-text-research-version-confirm>创建版本</button></div>`);host.querySelector("[data-text-research-version-confirm]").onclick=()=>{try{const name=host.querySelector("[data-text-research-version-name]").value.trim()||result.actionLabel;if(!window.lingframeTextAiBatchC?.importCandidate)throw new Error("批次 C 候选接口尚未加载");window.lingframeTextAiBatchC.importCandidate(candidateInput(result,{appliedAction:"version",branchName:name,statusText:"研究结果已创建候选版本"}));result.savedVersion=true;result.versionName=name;result.updatedAt=new Date().toISOString();persist();host.remove();render(workspace);toast("研究候选版本已创建，正文未被覆盖");}catch(error){toast(String(error.message||error),true);}};}
  async function saveAsAsset(workspace,taskId) {const result=resultByTask(taskId);if(!result?.content||result.savedAssetId)return;if(!api.assets.createText)return toast("当前版本未加载共享文本素材契约",true);try{const notes=(result.sources||[]).map((source,index)=>`[S${index+1}] ${source.name}｜${source.sourceLocation||source.originalName||"素材中心"}｜范围 ${source.excerptStart}-${source.excerptEnd}`).join("\n").slice(0,1800);const asset=await api.assets.createText({projectId:result.projectId,name:`${result.actionLabel} · ${currentTitle(workspace)}`,content:result.content,source:"text-research-analysis",sourceAssetId:result.sourceAssetIds.length===1?result.sourceAssetIds[0]:"",sourceLocation:`conversation:${result.conversationId};task:${result.taskId}`,tags:["资料研究",result.actionLabel],notes});result.savedAssetId=asset.id;result.updatedAt=new Date().toISOString();state.assets.unshift(asset);persist();render(workspace);toast(`研究结果已保存到素材中心：${asset.name}`);}catch(error){toast(String(error.message||error),true);}}
  async function dismissResult(taskId) {const result=resultByTask(taskId);if(!result||result.dismissed)return;if(!await confirmDialog("放弃研究结果","放弃只隐藏当前研究卡片，不会删除统一任务或结果素材。"))return;result.dismissed=true;result.updatedAt=new Date().toISOString();persist();renderAll();}

  async function enhance(workspace) {if(workspace.dataset.textResearchReady==="1")return;const host=workspace.querySelector('[data-text-assist-body="research"]');if(!host)return;workspace.dataset.textResearchReady="1";render(workspace);}
  function scan(){document.querySelectorAll('.text-workspace[data-text-layout-ready="1"]').forEach(enhance);}
  new MutationObserver(scan).observe(document.body,{childList:true,subtree:true});
  window.addEventListener("lingframe:generation-status",event=>{if(event.detail?.creationSource==="text-workspace-research"||state.envelopes.some(item=>item.taskId===event.detail?.taskId))refreshFromBackend();});
  window.addEventListener("focus",()=>refreshFromBackend());document.addEventListener("visibilitychange",()=>{if(!document.hidden)refreshFromBackend();});
  state.timer=setInterval(()=>{if(document.querySelector('.nav.active')?.dataset.page==="text"&&state.envelopes.some(item=>!state.results.some(result=>result.taskId===item.taskId&&["completed","failed","cancelled"].includes(result.state))))refreshFromBackend();},3000);
  Promise.resolve(api.identity?.status?.()).then(identity=>{state.tenantId=String(identity?.tenantId||"local");loadStored();return refreshFromBackend(false);}).then(()=>{scan();renderAll();}).catch(()=>scan());
})();
