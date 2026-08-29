(() => {
  "use strict";
  const api = window.lingframe;
  const core = window.LingframeCanvasCore;
  const portability = window.LingframeCanvasWorkflowPortability;
  if (!api || !core) return;

  const runtime = {
    mounted:false, mountToken:0, tenantId:"local", projectId:"", boot:null, providers:[], accounts:[],
    canvases:[], activeId:"", selectedIds:[], selectedEdgeIds:[], selectedGroupIds:[], toolMode:"select", inspectorTab:"properties", leftCollapsed:false,
    inspectorCollapsed:false, runsExpanded:false, saveState:"saved", saveTimer:null,
    history:[], future:[], canvasSessions:new Map(), clipboard:[], nodeDrag:null, groupDrag:null, panDrag:null, connecting:null,
    quickMenu:null, nodeMenu:null, modal:null, marquee:null, composerNodeId:"", composerFocused:false, composerLayout:null, assetPickerNodeId:"", assetPickerSelection:[], previewAssetId:"", previewZoom:1, previewText:"", taskNodeMap:new Map(), syncingTasks:new Set(),
    runningSequence:false, needsInitialFit:false, defaultRoute:{channel:"model-gateway",providerId:"",modelId:"",accountGroupId:"all",accountSelectionMode:"auto",accountCandidates:[],accountId:"",accountName:"",doubaoModel:"Seedance 2.0 Mini",ratio:"自动",duration:"10s"},
    search:"", lastToastTimer:null
  };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  const clone = core.clone;
  const now = () => new Date().toISOString();
  const terminalStates = new Set(["completed","failed","cancelled","submission_unknown"]);
  const activeStates = new Set(["queued","preparing","assigned","launching","checking_login","uploading","configuring","submitting","awaiting_confirmation","generating","downloading","verifying","running"]);
  const statusText = {idle:"等待执行",queued:"排队中",preparing:"准备中",assigned:"已分配",launching:"启动浏览器",checking_login:"检查登录",uploading:"上传素材",configuring:"配置参数",submitting:"提交中",awaiting_confirmation:"等待提交确认",generating:"生成中",downloading:"下载中",verifying:"校验中",running:"运行中",completed:"已完成",failed:"失败",cancelled:"已取消",awaiting_approval:"等待确认",awaiting_login:"等待登录",awaiting_verification:"需要验证",awaiting_quota:"等待额度刷新",submission_unknown:"提交状态未知",stale:"结果已过期"};
  const indeterminateTask = task => task?.progressMode === "indeterminate" || ["generating","submission_unknown"].includes(task?.state);
  const taskProgressLabel = task => indeterminateTask(task) ? (task.state === "submission_unknown" ? "待核对" : "处理中") : `${Math.round(Number(task?.progress)||0)}%`;
  const taskProgressWidth = task => indeterminateTask(task) ? 38 : Math.max(0,Math.min(100,Math.round(Number(task?.progress)||0)));

  function canvasById(id) { return runtime.canvases.find(item => item.id === id) || null; }
  function currentCanvas() { return canvasById(runtime.activeId) || runtime.canvases[0] || null; }
  function canvasMode() { return currentCanvas()?.templateId === "short-drama" ? "short-drama" : "blank"; }
  function canvasNodeMeta(type) { return core.nodePresentation(type, canvasMode()); }
  function canvasNodeTitle(node) {
    const base = core.nodeMeta(node?.data?.kind);
    const meta = canvasNodeMeta(node?.data?.kind);
    const saved = String(node?.data?.title || "").trim();
    return !saved || saved === base.title ? meta.title : saved;
  }
  function documentForCanvas(canvasId) { return canvasById(canvasId)?.document || {nodes:[],edges:[],groups:[],viewport:{x:0,y:0,zoom:1}}; }
  function documentValue() { return documentForCanvas(runtime.activeId); }
  function nodeInCanvas(canvasId,id) { return documentForCanvas(canvasId).nodes.find(node => node.id === id) || null; }
  function nodeById(id) { return nodeInCanvas(runtime.activeId,id); }
  function selectedNode() { return nodeById(runtime.selectedIds[0]); }
  function selectedEdge() { return documentValue().edges.find(edge => runtime.selectedEdgeIds.includes(edge.id)) || null; }
  function groupsValue() { const doc=documentValue();if(!Array.isArray(doc.groups))doc.groups=[];return doc.groups; }
  function groupById(id) { return groupsValue().find(group=>group.id===id)||null; }
  function groupForNode(nodeId) { return groupsValue().find(group=>(group.nodeIds||[]).includes(nodeId))||null; }
  function storageKey() { return `lingframe.infiniteCanvas.v2.${runtime.tenantId}.${runtime.projectId || "default"}`; }
  function safeParse(value, fallback) { try { const parsed = JSON.parse(value || ""); return parsed ?? fallback; } catch { return fallback; } }
  function toast(message, kind = "info") {
    let host = $(".lfc-toast-host");
    if (!host) { host = document.createElement("div"); host.className = "lfc-toast-host"; document.body.appendChild(host); }
    const item = document.createElement("div"); item.className = `lfc-toast ${kind}`; item.textContent = message; host.appendChild(item);
    requestAnimationFrame(() => item.classList.add("show"));
    window.setTimeout(() => { item.classList.remove("show"); window.setTimeout(() => item.remove(), 180); }, 2800);
  }
  function fingerprint(value) {
    let hash = 2166136261; const text = String(value || "");
    for (let i=0;i<text.length;i+=1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(16);
  }
  function inputFingerprint(nodeId, canvasId = runtime.activeId) {
    const document=documentForCanvas(canvasId);
    try { return fingerprint(core.resolveNodeExecutionInput(nodeId, document.nodes, document.edges).prompt); }
    catch { return ""; }
  }
  function isStale(node, canvasId = runtime.activeId) { return Boolean(node?.data?.output && node.data.lastInputFingerprint && node.data.lastInputFingerprint !== inputFingerprint(node.id,canvasId)); }
  function emptyCanvasSession(value = {}) {
    return {
      selectedIds:Array.isArray(value.selectedIds)?[...value.selectedIds]:[],
      selectedEdgeIds:Array.isArray(value.selectedEdgeIds)?[...value.selectedEdgeIds]:[],
      selectedGroupIds:Array.isArray(value.selectedGroupIds)?[...value.selectedGroupIds]:[],
      composerNodeId:String(value.composerNodeId||""), composerFocused:value.composerFocused===true,
      history:Array.isArray(value.history)?value.history:[], future:Array.isArray(value.future)?value.future:[]
    };
  }
  function canvasSession(canvasId = runtime.activeId) {
    if(!runtime.canvasSessions.has(canvasId))runtime.canvasSessions.set(canvasId,emptyCanvasSession());
    return runtime.canvasSessions.get(canvasId);
  }
  function saveCanvasSession(canvasId = runtime.activeId) {
    if(!canvasId||!canvasById(canvasId))return;
    const session=canvasSession(canvasId);
    session.selectedIds=[...runtime.selectedIds];session.selectedEdgeIds=[...runtime.selectedEdgeIds];session.selectedGroupIds=[...runtime.selectedGroupIds];
    session.composerNodeId=runtime.composerNodeId;session.composerFocused=runtime.composerFocused;session.history=runtime.history;session.future=runtime.future;
  }
  function restoreCanvasSession(canvasId = runtime.activeId) {
    const session=canvasSession(canvasId),document=documentForCanvas(canvasId),nodeIds=new Set(document.nodes.map(node=>node.id)),edgeIds=new Set(document.edges.map(edge=>edge.id)),groupIds=new Set((document.groups||[]).map(group=>group.id));
    runtime.selectedIds=session.selectedIds.filter(id=>nodeIds.has(id));runtime.selectedEdgeIds=session.selectedEdgeIds.filter(id=>edgeIds.has(id));runtime.selectedGroupIds=session.selectedGroupIds.filter(id=>groupIds.has(id));
    runtime.composerNodeId=nodeIds.has(session.composerNodeId)?session.composerNodeId:"";runtime.composerFocused=Boolean(runtime.composerNodeId&&session.composerFocused);runtime.composerLayout=null;
    runtime.history=session.history;runtime.future=session.future;
  }
  function activateCanvas(canvasId) {
    const target=canvasById(canvasId);if(!target)return false;
    saveCanvasSession(runtime.activeId);runtime.activeId=target.id;restoreCanvasSession(target.id);
    runtime.quickMenu=null;runtime.nodeMenu=null;runtime.assetPickerNodeId="";runtime.assetPickerSelection=[];runtime.previewAssetId="";runtime.previewText="";
    return true;
  }
  function serializableCanvasUi() {
    saveCanvasSession(runtime.activeId);const value={};
    for(const canvas of runtime.canvases){const session=canvasSession(canvas.id);value[canvas.id]={selectedIds:[...session.selectedIds],selectedEdgeIds:[...session.selectedEdgeIds],selectedGroupIds:[...session.selectedGroupIds],composerNodeId:session.composerNodeId,composerFocused:session.composerFocused};}
    return value;
  }
  function snapshot() {
    const canvas = currentCanvas(); if (!canvas) return;
    runtime.history.push(clone(canvas.document));
    if (runtime.history.length > 50) runtime.history.shift();
    runtime.future = [];
    saveCanvasSession();
  }
  function restoreHistory(direction) {
    const canvas = currentCanvas(); if (!canvas) return;
    const source = direction === "undo" ? runtime.history : runtime.future;
    const target = direction === "undo" ? runtime.future : runtime.history;
    if (!source.length) return;
    target.push(clone(canvas.document)); canvas.document = source.pop(); runtime.selectedIds = []; runtime.selectedEdgeIds=[]; runtime.selectedGroupIds=[];
    markDirty(); renderCanvasModule();
  }
  function serializableStore() {
    return {version:2, activeId:runtime.activeId, defaultRoute:runtime.defaultRoute, toolMode:runtime.toolMode, leftCollapsed:runtime.leftCollapsed, inspectorCollapsed:runtime.inspectorCollapsed, canvasUi:serializableCanvasUi(), canvases:runtime.canvases};
  }
  function saveNow() {
    window.clearTimeout(runtime.saveTimer); runtime.saveTimer = null;
    const canvas = currentCanvas(); if (!canvas) return;
    try { localStorage.setItem(storageKey(), JSON.stringify(serializableStore())); runtime.saveState = "saved"; }
    catch (error) { runtime.saveState = "error"; toast(`画布保存失败：${error.message}`, "error"); }
    updateSaveIndicator();
  }
  function markDirty(canvasId = runtime.activeId) {
    const canvas=canvasById(canvasId);if(canvas)canvas.updatedAt=now();
    runtime.saveState = "dirty"; updateSaveIndicator();
    window.clearTimeout(runtime.saveTimer);
    runtime.saveTimer = window.setTimeout(() => { runtime.saveState = "saving"; updateSaveIndicator(); window.setTimeout(saveNow, 120); }, 520);
  }
  function updateSaveIndicator() {
    const node = $("[data-lfc-save-state]"); if (!node) return;
    node.className = `lfc-save-state ${runtime.saveState}`;
    node.textContent = runtime.saveState === "saving" ? "正在保存…" : runtime.saveState === "dirty" ? "等待自动保存" : runtime.saveState === "error" ? "保存失败" : "已自动保存";
  }
  function makeCanvas(title, templateId = "blank") {
    const document = core.createTemplateDocument(templateId);
    return {id:core.makeId("canvas"), title:String(title || "未命名画布").slice(0,80), projectId:runtime.projectId, templateId, status:"draft", createdAt:now(), updatedAt:now(), versions:[], document};
  }
  function normalizeStore(value) {
    const canvases = Array.isArray(value?.canvases) ? value.canvases.filter(item => item?.id && item?.document) : [];
    if (!canvases.length) canvases.push(makeCanvas("短剧生产流程 V1", "short-drama"));
    for(const canvas of canvases)canvas.document=core.migrateDocument(canvas.document);
    runtime.canvases = canvases;
    runtime.canvasSessions=new Map(canvases.map(canvas=>[canvas.id,emptyCanvasSession(value?.canvasUi?.[canvas.id]||{})]));
    runtime.activeId = canvases.some(item => item.id === value?.activeId) ? value.activeId : canvases[0].id;
    restoreCanvasSession(runtime.activeId);
    runtime.defaultRoute = {...runtime.defaultRoute, ...(value?.defaultRoute || {})};
    runtime.defaultRoute.accountSelectionMode = runtime.defaultRoute.accountSelectionMode || (runtime.defaultRoute.accountId ? "manual" : "auto");
    runtime.defaultRoute.accountGroupId = runtime.defaultRoute.accountGroupId || "all";
    runtime.defaultRoute.doubaoModel = runtime.defaultRoute.doubaoModel || "Seedance 2.0 Mini";
    runtime.defaultRoute.ratio = runtime.defaultRoute.ratio || "自动";
    runtime.defaultRoute.duration = runtime.defaultRoute.duration || "10s";
    runtime.leftCollapsed = value?.leftCollapsed === true;
    runtime.inspectorCollapsed = value?.inspectorCollapsed === true;
    runtime.toolMode = value?.toolMode === "pan" ? "pan" : "select";
  }
  function accountGroups() { return window.lingframeAccountStore?.groups?.() || []; }
  function accountsForGroup(groupId = "all") { const list=window.lingframeAccountStore?.accountsForGroup?.(groupId)||runtime.accounts;return Array.isArray(list)?list.filter(item=>item?.id):[]; }
  function groupOptions(selected = "all") { return [`<option value="all" ${selected==="all"?"selected":""}>全部账号</option>`,...accountGroups().map(group=>`<option value="${esc(group.id)}" ${group.id===selected?"selected":""}>${esc(group.name)}</option>`)].join(""); }
  function accountOptions(route = {}) { const groupId=route.accountGroupId||"all",list=accountsForGroup(groupId);if(!list.length)return `<option value="">该分组暂无豆包账号</option>`;const selected=route.accountSelectionMode==="auto"?"__auto__":route.accountId;return `<option value="__auto__" ${selected==="__auto__"?"selected":""}>自动调度（额度不足自动换号）</option>${list.map(item=>`<option value="${esc(item.id)}" ${item.id===selected?"selected":""}>指定：${esc(item.name||item.id)}</option>`).join("")}`; }
  function modelOptions(providerId = "", modelId = "", targetType = "") {
    const models = core.compatibleModels(runtime.providers,targetType).map(model=>({providerId:model.providerId,modelId:model.id,label:`${model.providerName} / ${model.displayName || model.id}`,type:model.capabilities?.type||"text"}));
    if (!models.length) return `<option value="">请先在模型网关添加模型</option>`;
    return models.map(item => `<option value="${esc(`${item.providerId}::${item.modelId}`)}" ${item.providerId===providerId&&item.modelId===modelId?"selected":""}>${esc(item.label)} · ${esc(item.type)}</option>`).join("");
  }
  function modelByRoute(route,targetType="") {return core.compatibleModels(runtime.providers,targetType).find(model=>model.providerId===route?.providerId&&model.id===route?.modelId)||core.compatibleModels(runtime.providers,targetType)[0]||null;}
  function composerSupported(node){const meta=core.nodeMeta(node?.data?.kind);return Boolean(node&&(meta.inputNode||meta.executable||["prompt","character","scene","video-prompt"].includes(meta.type)));}
  function acceptedAssetTypes(node){const meta=core.nodeMeta(node?.data?.kind);if(meta.assetTypes?.length)return meta.assetTypes;if(meta.creationType==="image")return["image"];if(meta.creationType==="video")return["image","video"];if(meta.creationType==="audio")return["audio"];if((meta.inputTypes||[]).includes("image")||(meta.inputTypes||[]).includes("asset"))return["image"];return[];}
  function projectAssets(types=[]){return(runtime.boot?.assets||[]).filter(asset=>!asset.deletedAt&&asset.projectId===runtime.projectId&&(!types.length||types.includes(asset.type)));}
  function assetById(id){return(runtime.boot?.assets||[]).find(asset=>asset.id===id&&!asset.deletedAt)||null;}
  function cleanPrompt(value){return String(value??"").slice(0,12000).trim();}
  function appendPrompt(base,value){const text=cleanPrompt(value),current=cleanPrompt(base);return text?(current?`${current}\n\n${text}`:text):current;}
  function appendPromptOnce(base,value){const text=cleanPrompt(value),current=cleanPrompt(base);return text&&current.includes(text)?current:appendPrompt(current,text);}
  function removePromptFragment(base,value){const text=cleanPrompt(value);let current=String(base??"");if(!text)return cleanPrompt(current);const index=current.indexOf(text);if(index<0)return cleanPrompt(current);current=`${current.slice(0,index)}${current.slice(index+text.length)}`;return current.replace(/\n{3,}/g,"\n\n").trim();}
  function ensureNodeInputDraft(node,input){if(!node)return false;const data=node.data||(node.data={}),business=input?.upstream?.businessItems||[],existing=data.inputDraft&&typeof data.inputDraft==="object"?data.inputDraft:null;let changed=false;if(!existing||existing.active!==true){const acceptedBindings={};for(const item of business){acceptedBindings[item.binding?.bindingId||item.sourceId]={fingerprint:item.snapshot?.sourceOutputFingerprint||"",text:item.content||""};}data.inputDraft={version:1,active:true,prompt:cleanPrompt(input?.prompt||data.instruction||data.content||""),acceptedBindings,createdAt:now(),updatedAt:now()};return true;}existing.acceptedBindings=existing.acceptedBindings&&typeof existing.acceptedBindings==="object"?existing.acceptedBindings:{};for(const item of business){const bindingId=item.binding?.bindingId||item.sourceId;if(!bindingId||existing.acceptedBindings[bindingId])continue;existing.prompt=appendPromptOnce(existing.prompt,item.content);existing.acceptedBindings[bindingId]={fingerprint:item.snapshot?.sourceOutputFingerprint||"",text:item.content||""};existing.updatedAt=now();changed=true;}return changed;}
  function detachDraftForEdges(edges){for(const edge of edges||[]){const target=nodeById(edge.target),draft=target?.data?.inputDraft,bindingId=edge.data?.bindingId||edge.id;if(!draft?.active||!bindingId)continue;const accepted=draft.acceptedBindings?.[bindingId],fallback=(edge.data?.inputSnapshot?.textBlocks||[]).map(item=>item?.text).filter(Boolean).join("\n\n"),text=accepted?.text||fallback;draft.prompt=removePromptFragment(draft.prompt,text);if(draft.acceptedBindings)delete draft.acceptedBindings[bindingId];draft.updatedAt=now();}}
  function setSnapshotItemEnabled(bindingId,kind,itemId,enabled){const edge=inputEdgeByBinding(bindingId);if(!edge)return;const snapshotValue=edge.data?.inputSnapshot;if(!snapshotValue)return;const list=kind==="text"?snapshotValue.textBlocks:snapshotValue.assetBindings,item=(list||[]).find(value=>String(value.id||value.assetId)===String(itemId));if(!item)return;snapshot();item.enabled=enabled!==false;const target=nodeById(edge.target);if(kind==="text"&&target?.data?.inputDraft?.active){if(item.enabled)target.data.inputDraft.prompt=appendPromptOnce(target.data.inputDraft.prompt,item.text);else target.data.inputDraft.prompt=removePromptFragment(target.data.inputDraft.prompt,item.text);target.data.inputDraft.updatedAt=now();}if(target)target.data.updatedAt=now();markDirty();renderCanvasModule();}
  function addUpstreamText(node,bindingId,itemId){const edge=inputEdgeByBinding(bindingId),item=(edge?.data?.inputSnapshot?.textBlocks||[]).find(value=>String(value.id)===String(itemId));if(!edge||!item?.text)return;let input;try{input=core.resolveNodeExecutionInput(node.id,documentValue().nodes,documentValue().edges);}catch{input=null;}ensureNodeInputDraft(node,input);if(cleanPrompt(node.data.inputDraft.prompt).includes(cleanPrompt(item.text))){toast("这段上游文本已在输入框中");return;}snapshot();item.enabled=true;node.data.inputDraft.prompt=appendPromptOnce(node.data.inputDraft.prompt,item.text);node.data.inputDraft.acceptedBindings=node.data.inputDraft.acceptedBindings||{};node.data.inputDraft.acceptedBindings[bindingId]={fingerprint:edge.data.inputSnapshot?.sourceOutputFingerprint||"",text:item.text};node.data.inputDraft.updatedAt=now();node.data.updatedAt=now();markDirty();renderCanvasModule();toast("已把选中的上游文本添加到输入框","success");}
  function recalculateGroup(group){const ids=(group?.nodeIds||[]).filter(id=>nodeById(id));if(ids.length<2)return false;group.nodeIds=ids;const bounds=core.calculateGroupBounds(documentValue().nodes,ids);group.position=bounds.position;group.size=bounds.size;group.updatedAt=now();return true;}
  function refreshGroups(){const doc=documentValue();doc.groups=groupsValue().filter(recalculateGroup);runtime.selectedGroupIds=runtime.selectedGroupIds.filter(id=>doc.groups.some(group=>group.id===id));}
  function createGroupFromSelection(){const ids=[...new Set(runtime.selectedIds)].filter(id=>nodeById(id));if(ids.length<2){toast("请先框选至少两个节点再打组","error");return;}const occupied=ids.filter(id=>groupForNode(id));if(occupied.length){toast("选中节点中已有分组成员，请先解组","error");return;}snapshot();const group=core.makeGroup(ids,documentValue().nodes,{title:`节点组 ${groupsValue().length+1}`});groupsValue().push(group);runtime.selectedGroupIds=[group.id];markDirty();renderCanvasModule();toast(`已将 ${ids.length} 个节点打组`,"success");}
  function ungroupGroups(ids){const set=new Set(ids||[]);if(!set.size)return;snapshot();const count=groupsValue().filter(group=>set.has(group.id)).length;documentValue().groups=groupsValue().filter(group=>!set.has(group.id));runtime.selectedGroupIds=[];markDirty();renderCanvasModule();toast(`已解散 ${count} 个节点组`);}
  function groupMarkup(group){const selected=runtime.selectedGroupIds.includes(group.id);return`<section class="lfc-node-group ${selected?"selected":""}" data-lfc-group-id="${esc(group.id)}" style="left:${Number(group.position?.x)||0}px;top:${Number(group.position?.y)||0}px;width:${Number(group.size?.width)||0}px;height:${Number(group.size?.height)||0}px;--group-color:${esc(group.color||"#7c6cff")}"><header data-lfc-group-drag="${esc(group.id)}"><span>▦</span><strong>${esc(group.title||"节点组")}</strong><em>${(group.nodeIds||[]).length} 个节点</em><button data-lfc-ungroup="${esc(group.id)}" title="解散分组，不删除节点">×</button></header></section>`;}
  function openProjectResources(){const target=document.querySelector('[data-page="resources"]')||document.querySelector('[data-page="materials"]');if(target)target.click();else toast("项目资源库入口尚未加载","error");}
  async function loadRuntimeData() {
    try { if (window.lingframeAccountStore?.ready) await window.lingframeAccountStore.ready; } catch {}
    const [identity, boot, providers] = await Promise.all([
      api.identity?.status?.().catch(() => null), api.workbench?.bootstrap?.().catch(() => null), api.models?.bootstrap?.().catch(() => [])
    ]);
    runtime.tenantId = String(identity?.tenantId || window.lingframeAccountStore?.tenantId?.() || "local");
    runtime.boot = boot || {projects:[],assets:[],tasks:[],textConversations:[],currentProjectId:""};
    runtime.projectId = String(runtime.boot.currentProjectId || runtime.boot.projects?.find(item => !item.deletedAt)?.id || "default");
    runtime.providers = Array.isArray(providers) ? providers : [];
    runtime.accounts = window.lingframeAccountStore?.accounts?.() || [];
    const stored = localStorage.getItem(storageKey());
    runtime.needsInitialFit = !stored;
    normalizeStore(safeParse(stored, null));
    if (runtime.defaultRoute.channel === "model-gateway" && !runtime.defaultRoute.modelId) {
      const firstProvider = runtime.providers.find(provider => provider.models?.some(model => model.enabled !== false));
      const firstModel = firstProvider?.models?.find(model => model.enabled !== false);
      if (firstProvider && firstModel) Object.assign(runtime.defaultRoute,{providerId:firstProvider.id,modelId:firstModel.id});
    }
    if (runtime.defaultRoute.channel === "doubao" && !runtime.defaultRoute.accountId && runtime.accounts[0]) {
      Object.assign(runtime.defaultRoute,{accountId:runtime.accounts[0].id,accountName:runtime.accounts[0].name,accountSelectionMode:"auto",accountCandidates:runtime.accounts.map(item=>({id:item.id,name:item.name||item.id,platform:"豆包"}))});
    }
    runtime.taskNodeMap.clear();
    for (const canvas of runtime.canvases) for (const node of canvas.document.nodes || []) for (const taskId of node.data?.refs?.jobIds || []) runtime.taskNodeMap.set(taskId,{canvasId:canvas.id,nodeId:node.id});
  }

  function activePage() { return Boolean($(".nav.active[data-page='canvas']") || $("[data-page='canvas'].active")); }
  function cleanupPageClasses() {
    const shell = $(".shell"); shell?.classList.remove("lfc-page-active","lfc-inspector-collapsed");
    $(".lfc-node-composer-host")?.remove();$(".lfc-asset-picker-host")?.remove();$(".lfc-asset-preview-host")?.remove();runtime.composerViewportObserver?.disconnect?.();runtime.composerViewportObserver=null;runtime.composerLayout=null;
  }
  function scheduleMount() { window.clearTimeout(scheduleMount.timer); scheduleMount.timer = window.setTimeout(mountIfNeeded, 20); }
  async function mountIfNeeded() {
    if (!activePage()) { runtime.mounted = false; cleanupPageClasses(); return; }
    if ($("[data-lfc-mounted='1']")) return;
    const legacy = $(".workspace .canvas"); if (!legacy) return;
    const token = ++runtime.mountToken;
    const stage = document.createElement("section"); stage.dataset.lfcMounted = "1"; stage.className = "lfc-stage lfc-loading";
    stage.innerHTML = `<div class="lfc-loading-card"><i></i><strong>正在装载无限画布</strong><span>准备节点库、项目数据与执行通道…</span></div>`;
    legacy.replaceWith(stage);
    const shell = $(".shell"); shell?.classList.add("lfc-page-active");
    const head = $(".page-head");
    if (head) { $("h1",head).textContent = "无限画布"; $("p",head).textContent = "AI工作流编排 · 节点数据可追溯 · 运行现场实时可见"; $(".ghost",head)?.remove(); }
    try { await loadRuntimeData(); if (token !== runtime.mountToken || !activePage()) return; runtime.mounted = true; renderCanvasModule(); if(runtime.needsInitialFit){runtime.needsInitialFit=false;window.setTimeout(()=>fitView(true),120);} }
    catch (error) { stage.innerHTML = `<div class="lfc-empty-error"><strong>画布装载失败</strong><span>${esc(error.message || error)}</span><button data-lfc-retry>重新加载</button></div>`; $("[data-lfc-retry]",stage).onclick = () => { stage.remove(); scheduleMount(); }; }
  }

  function canvasStats() {
    const nodes = documentValue().nodes;
    return {total:nodes.length, active:nodes.filter(node => activeStates.has(node.data?.status)).length, completed:nodes.filter(node => node.data?.status === "completed").length, failed:nodes.filter(node => ["failed","submission_unknown"].includes(node.data?.status)).length, stale:nodes.filter(isStale).length};
  }
  function routeControls(route = runtime.defaultRoute, scope = "default", targetType = "") {
    const gateway = route.channel !== "doubao";
    return `<label class="lfc-route-field"><span>执行通道</span><select data-lfc-route-channel="${scope}"><option value="model-gateway" ${gateway?"selected":""}>模型网关</option><option value="doubao" ${!gateway?"selected":""}>豆包账号</option></select></label>
      <label class="lfc-route-field ${gateway?"":"hidden"}" data-lfc-model-wrap="${scope}"><span>${targetType?`${targetType} 模型`:"模型"}</span><select data-lfc-route-model="${scope}">${modelOptions(route.providerId,route.modelId,targetType)}</select></label>
      <label class="lfc-route-field ${gateway?"hidden":""}" data-lfc-group-wrap="${scope}"><span>账号分组</span><select data-lfc-route-group="${scope}">${groupOptions(route.accountGroupId||"all")}</select></label>
      <label class="lfc-route-field ${gateway?"hidden":""}" data-lfc-account-wrap="${scope}"><span>豆包账号</span><select data-lfc-route-account="${scope}">${accountOptions(route)}</select></label>
      ${targetType==="video"?`<div class="lfc-doubao-video-fields ${gateway?"hidden":""}" data-lfc-doubao-video-wrap="${scope}"><label class="lfc-route-field"><span>豆包模型</span><select data-lfc-route-doubao-model="${scope}"><option value="Seedance 2.0 Fast" ${route.doubaoModel==="Seedance 2.0 Fast"?"selected":""}>Seedance 2.0 Fast</option><option value="Seedance 2.0 Mini" ${route.doubaoModel!=="Seedance 2.0 Fast"?"selected":""}>Seedance 2.0 Mini</option></select></label><label class="lfc-route-field"><span>画面比例</span><select data-lfc-route-ratio="${scope}">${["自动","3:4","4:3","9:16","16:9","1:1","21:9"].map(value=>`<option value="${value}" ${value===(route.ratio||"自动")?"selected":""}>${value}</option>`).join("")}</select></label><label class="lfc-route-field"><span>视频时长</span><select data-lfc-route-duration="${scope}">${Array.from({length:12},(_,index)=>`${index+4}s`).map(value=>`<option value="${value}" ${value===(route.duration||"10s")?"selected":""}>${value.slice(0,-1)} 秒</option>`).join("")}</select></label></div>`:""}`;
  }
  function nodeResults(node) {
    const values=[...(Array.isArray(node?.data?.results)?node.data.results:[])];
    if(node?.data?.output?.assetId)values.push(node.data.output);
    const seen=new Set();return values.filter(item=>{const key=String(item?.assetId||item?.taskId||item?.completedAt||"");if(!key||seen.has(key))return false;seen.add(key);return true;}).slice(-20).reverse();
  }
  function assetMedia(asset) {return asset.type==="image"?`<img src="${esc(asset.contentUrl)}" alt="${esc(asset.name)}">`:asset.type==="video"?`<video src="${esc(asset.contentUrl)}" muted preload="metadata"></video><i>▶</i>`:asset.type==="audio"?`<div class="lfc-asset-symbol audio">♫</div>`:`<div class="lfc-asset-symbol text">Ｔ</div>`;}
  function nodeResultPreview(node,asset){return`<div class="lfc-node-result"><button class="lfc-node-result-media" data-lfc-preview-asset="${esc(asset.id)}" title="点击预览，双击放大">${assetMedia(asset)}</button><div><strong>${esc(asset.name)}</strong><small>生成结果 · 点击预览</small></div><button data-lfc-expand-result="${esc(node.id)}" data-result-asset="${esc(asset.id)}" title="展开为素材节点">↗</button></div>`;}
  function nodeCard(node) {
    const meta = canvasNodeMeta(node.data?.kind); const selected = runtime.selectedIds.includes(node.id); const stale = isStale(node);
    const status = stale ? "stale" : (node.data?.status || "idle");
    const preview = node.data?.output ? (typeof node.data.output === "string" ? node.data.output : node.data.output.content || node.data.output.name || JSON.stringify(node.data.output)) : node.data?.instruction || node.data?.content || meta.description;
    const resultAsset=node.data?.output?.assetId?assetById(node.data.output.assetId):null,attached=(node.data?.refs?.assetIds||[]).map(assetById).filter(Boolean).slice(0,3);
    return `<article class="lfc-node ${selected?"selected":""} status-${esc(status)}" data-node-id="${esc(node.id)}" style="left:${Number(node.position?.x)||0}px;top:${Number(node.position?.y)||0}px;--node-color:${meta.color}">
      <button class="lfc-port input" data-node-input="${esc(node.id)}" title="输入：${esc((meta.inputTypes||[]).join(" / ") || "无")}"></button>
      <header class="lfc-node-head"><i>${esc(meta.icon)}</i><div><strong>${esc(canvasNodeTitle(node))}</strong><small>${esc(node.data?.phase ? `${node.data.phase}阶段 · ${meta.title}` : meta.title)}</small></div><em class="${esc(status)}">${esc(statusText[status] || status)}</em></header>
      ${resultAsset?nodeResultPreview(node,resultAsset):attached.length?`<div class="lfc-node-assets">${attached.map(asset=>asset.type==="image"?`<img src="${esc(asset.contentUrl)}" alt="">`:`<i class="${esc(asset.type)}">${asset.type==="video"?"▶":asset.type==="audio"?"♫":"Ｔ"}</i>`).join("")}</div>`:`<div class="lfc-node-preview">${esc(String(preview || "暂无内容").slice(0,150))}</div>`}
      <footer><span>${node.data?.route?.channel === "doubao" ? "◈ 豆包" : meta.executable ? "✦ 模型" : "◇ 数据"}</span><span>${(node.data?.refs?.assetIds || []).length ? `▧ ${(node.data.refs.assetIds||[]).length}` : ""}</span>${composerSupported(node)?`<button data-node-edit="${esc(node.id)}" title="编辑输入与参数">✎</button>`:""}<button data-node-run="${esc(node.id)}" title="运行当前节点">▶</button></footer>
      <button class="lfc-port output" data-node-output="${esc(node.id)}" title="输出：${esc((meta.outputTypes||[]).join(" / ") || "无")}"></button>
    </article>`;
  }
  function assetPreview(asset, removal=null) {
    const removeButton=removal?(removal.scope==="upstream"?`<button data-lfc-toggle-upstream-asset="${esc(removal.bindingId)}" data-lfc-snapshot-item="${esc(removal.itemId)}" data-lfc-snapshot-enabled="0" title="从本节点输入中移除，不删除项目素材">×</button>`:`<button data-lfc-remove-asset="${esc(asset.id)}" title="从本节点移除，不删除项目素材">×</button>`):"";
    return `<div class="lfc-composer-asset ${esc(asset.type)}" data-composer-asset="${esc(asset.id)}" data-lfc-preview-asset="${esc(asset.id)}" role="button" tabindex="0" title="点击放大预览">${assetMedia(asset)}<span title="${esc(asset.name)}">${esc(asset.name)}</span>${removeButton}</div>`;
  }
  function selectField(name,label,values,current,scope="composer"){if(!values?.length)return"";const attribute=scope==="inspector"?"data-lfc-inspector-param":"data-lfc-param";return`<label><span>${esc(label)}</span><select ${attribute}="${esc(name)}">${values.map(value=>`<option value="${esc(value)}" ${String(value)===String(current)?"selected":""}>${esc(value)}</option>`).join("")}</select></label>`;}
  function renderParameterEditor(node,model,scope="composer"){if(!model)return`<div class="lfc-parameter-empty">当前类别没有可用模型，请先到系统设置添加模型。</div>`;const caps=model.capabilities||{},params=core.mergeModelParameters(model,node.data?.modelParameters||{}),attribute=scope==="inspector"?"data-lfc-inspector-param":"data-lfc-param",advanced=scope==="inspector"?"data-lfc-inspector-advanced-params":"data-lfc-advanced-params",save=scope==="inspector"?"data-lfc-inspector-save-advanced":"data-lfc-save-advanced";return`<div class="lfc-composer-parameters"><div class="lfc-parameter-grid">${selectField("mode","生成模式",caps.modes,params.mode,scope)}${selectField("ratio","画面比例",caps.ratios,params.ratio,scope)}${selectField("resolution","分辨率",caps.resolutions,params.resolution,scope)}${selectField("duration","时长",caps.durations,params.duration,scope)}<label><span>生成数量</span><input type="number" min="1" max="12" ${attribute}="count" value="${esc(params.count||1)}"></label><label><span>Seed</span><input type="number" ${attribute}="seed" value="${esc(params.seed??"")}" placeholder="随机"></label></div><details><summary>高级参数 JSON</summary><textarea ${advanced}>${esc(JSON.stringify(params,null,2))}</textarea><button ${save}>应用高级参数</button></details><small class="lfc-capability-note">${caps.confirmed?"厂商已确认能力":"参数由适配器推断，可在模型网关中修改"} · 最多参考图 ${Number(caps.maxReferenceImages||0)} 张</small></div>`;}
  function composerResults(node){const results=nodeResults(node).map(result=>({result,asset:assetById(result.assetId)})).filter(item=>item.asset);if(!results.length)return"";return`<section class="lfc-composer-results"><header><div><span>GENERATED RESULTS</span><strong>生成结果</strong></div><em>${results.length} 个</em></header><div>${results.map(({result,asset})=>`<article class="${node.data?.output?.assetId===asset.id?"active":""}"><button class="lfc-result-thumb" data-lfc-preview-asset="${esc(asset.id)}">${assetMedia(asset)}</button><div><strong>${esc(asset.name)}</strong><small>${node.data?.output?.assetId===asset.id?"当前输出":"历史结果"} · 点击预览</small></div><button data-lfc-set-result="${esc(asset.id)}" title="设为当前输出">✓</button><button data-lfc-expand-result="${esc(node.id)}" data-result-asset="${esc(asset.id)}" title="展开为素材节点">↗</button></article>`).join("")}</div></section>`;}
  function renderUpstreamPicker(input){const items=input?.upstream?.items||[];if(!items.length)return"";return`<details class="lfc-upstream-picker"><summary><span>＋ 从直接上游添加</span><em>${items.length} 个来源</em></summary><div>${items.map(item=>{const bindingId=item.binding?.bindingId||item.sourceId,texts=item.availableTextBlocks||item.textBlocks||[],assets=item.availableAssets||item.assets||[];return`<article><header><div><strong>${esc(item.sourceTitle)}</strong><small>${esc(core.nodeMeta(item.sourceKind).title)} · 只读取直接连接</small></div>${item.snapshot?.updateAvailable?`<em>有新结果，未自动替换</em>`:""}</header>${texts.map(block=>`<button data-lfc-add-upstream-text="${esc(bindingId)}" data-lfc-snapshot-item="${esc(block.id)}"><span>Ｔ</span><b>添加文本</b><small>${esc(String(block.text||"").slice(0,90))}</small></button>`).join("")}${assets.map(asset=>`<button class="${asset.enabled===false?"":"active"}" data-lfc-toggle-upstream-asset="${esc(bindingId)}" data-lfc-snapshot-item="${esc(asset.id)}" data-lfc-snapshot-enabled="${asset.enabled===false?"1":"0"}"><span>${asset.mediaType==="video"?"▶":asset.mediaType==="audio"?"♫":"▧"}</span><b>${asset.enabled===false?"添加素材":"移除素材"}</b><small>${esc(asset.assetId)}</small></button>`).join("")}</article>`;}).join("")}</div></details>`;}
  function applyComposerLayout(composer,layout){if(!composer||!layout)return false;composer.style.transition=layout.focused?"":"none";composer.style.setProperty("left",`${layout.left}px`,layout.focused?"important":"");composer.style.setProperty("top",`${layout.top}px`,layout.focused?"important":"");composer.style.setProperty("width",`${layout.width}px`,layout.focused?"important":"");composer.style.minWidth=layout.focused?"0":`${layout.minWidth}px`;composer.style.maxHeight=`${layout.maxHeight||layout.height}px`;composer.style.setProperty("transform","none",layout.focused?"important":"");if(layout.focused)composer.style.setProperty("height",`${layout.height}px`,"important");else composer.style.removeProperty("height");composer.dataset.placement=layout.placement;return true;}
  function positionComposer(force=false){const host=$(".lfc-node-composer-host");if(!host)return;const composer=$(".lfc-node-composer",host),card=document.querySelector(`.lfc-node[data-node-id='${runtime.composerNodeId}']`),viewport=$("[data-lfc-viewport]");if(!composer)return;host.classList.toggle("focused",runtime.composerFocused);composer.classList.toggle("focused",runtime.composerFocused);const cached=runtime.composerLayout;if(!force&&cached?.nodeId===runtime.composerNodeId&&cached.focused===runtime.composerFocused){applyComposerLayout(composer,cached);return;}if(runtime.composerFocused){const width=Math.max(320,Math.min(1160,innerWidth-90)),height=Math.max(420,Math.min(760,innerHeight-70));runtime.composerLayout={nodeId:runtime.composerNodeId,focused:true,left:Math.round((innerWidth-width)/2),top:Math.round((innerHeight-height)/2),width,height,maxHeight:height,minWidth:0,placement:"focus"};applyComposerLayout(composer,runtime.composerLayout);return;}if(!card||!viewport){runtime.composerLayout=null;composer.style.left="50%";composer.style.top="50%";composer.style.width="";composer.style.maxHeight="";composer.style.transform="translate(-50%,-50%)";return;}composer.style.transform="none";const nodeRect=card.getBoundingClientRect(),viewRect=viewport.getBoundingClientRect(),minX=Math.max(12,viewRect.left+10),maxX=Math.min(innerWidth-12,viewRect.right-10),minY=Math.max(12,viewRect.top+10),maxY=Math.min(innerHeight-12,viewRect.bottom-10),availableWidth=Math.max(1,maxX-minX),availableHeight=Math.max(1,maxY-minY),width=Math.min(620,availableWidth),minWidth=Math.min(420,width);composer.style.width=`${width}px`;composer.style.minWidth=`${minWidth}px`;composer.style.maxHeight=`${availableHeight}px`;const measured=composer.getBoundingClientRect(),height=Math.min(measured.height,availableHeight),gap=12,candidates=[{placement:"below",left:nodeRect.left+(nodeRect.width-width)/2,top:nodeRect.bottom+gap},{placement:"right",left:nodeRect.right+gap,top:nodeRect.top},{placement:"left",left:nodeRect.left-width-gap,top:nodeRect.top},{placement:"above",left:nodeRect.left+(nodeRect.width-width)/2,top:nodeRect.top-height-gap}],fits=item=>item.left>=minX&&item.left+width<=maxX&&item.top>=minY&&item.top+height<=maxY,chosen=candidates.find(fits)||candidates[0];runtime.composerLayout={nodeId:runtime.composerNodeId,focused:false,left:Math.round(Math.max(minX,Math.min(maxX-width,chosen.left))),top:Math.round(Math.max(minY,Math.min(maxY-height,chosen.top))),width,height,maxHeight:availableHeight,minWidth,placement:chosen.placement};applyComposerLayout(composer,runtime.composerLayout);}
  function renderComposer(){
    let host=$(".lfc-node-composer-host");
    const node=nodeById(runtime.composerNodeId);
    if(!activePage()||!composerSupported(node)){host?.remove();runtime.composerFocused=false;runtime.composerLayout=null;return;}
    if(!host){host=document.createElement("div");host.className="lfc-node-composer-host";document.body.appendChild(host);}
    const meta=canvasNodeMeta(node.data.kind),route=effectiveRoute(node),targetType=meta.creationType||"",model=route.channel==="model-gateway"?modelByRoute(route,targetType):null,types=acceptedAssetTypes(node);
    let resolvedInput=core.resolveNodeExecutionInput(node.id,documentValue().nodes,documentValue().edges);
    if(ensureNodeInputDraft(node,resolvedInput)){markDirty();resolvedInput=core.resolveNodeExecutionInput(node.id,documentValue().nodes,documentValue().edges);}
    const localAssetIds=new Set((node.data.refs?.assetIds||[]).map(String));
    const upstreamAssetSources=new Map();for(const item of resolvedInput.upstream?.items||[])for(const asset of item.availableAssets||item.assets||[])if(asset.enabled!==false&&!upstreamAssetSources.has(String(asset.assetId)))upstreamAssetSources.set(String(asset.assetId),{scope:"upstream",bindingId:item.binding?.bindingId||item.sourceId,itemId:asset.id});
    const assets=[...(resolvedInput.assetIds||[])].map(assetById).filter(Boolean);
    const displayPrompt=node.data.inputDraft?.active?String(node.data.inputDraft.prompt||""):String(resolvedInput.prompt||node.data.instruction||node.data.content||"");
    const canReuse=runtime.composerLayout?.nodeId===node.id&&runtime.composerLayout.focused===runtime.composerFocused;
    host.innerHTML=`<section class="lfc-node-composer" style="--node-color:${meta.color}"><header><div><i>${esc(meta.icon)}</i><span><small>NODE COMPOSER · ${runtime.composerFocused?"FOCUS":"ATTACHED"}</small><strong>${esc(canvasNodeTitle(node))}</strong></span></div><div class="lfc-composer-head-actions"><button data-lfc-focus-composer title="${runtime.composerFocused?"退出专注编辑":"专注放大编辑"}">${runtime.composerFocused?"↙":"⛶"}</button><button data-lfc-close-composer>×</button></div></header><div class="lfc-composer-body"><div class="lfc-composer-primary">${composerResults(node)}<div class="lfc-composer-references"><div class="lfc-composer-tools"><button data-lfc-pick-assets ${types.length?"":"disabled"}>＋ 选择素材</button><button data-lfc-upload-assets ${types.length?"":"disabled"}>⬆ 本机上传</button><button data-lfc-open-resources>▧ 项目资源库</button><span>${types.length?`支持 ${types.map(type=>({image:"图片",video:"视频",audio:"音频",text:"文本"}[type]||type)).join(" / ")}`:"此节点不需要本地素材"}</span></div><div class="lfc-composer-assets">${assets.length?assets.map(asset=>assetPreview(asset,localAssetIds.has(String(asset.id))?{scope:"local"}:upstreamAssetSources.get(String(asset.id))||null)).join(""):`<div class="lfc-composer-no-assets">本节点暂无参考素材；连接兼容的直接上游素材后会在这里一次性加入。</div>`}</div></div>${renderUpstreamPicker(resolvedInput)}<textarea class="lfc-composer-prompt" data-lfc-composer-prompt placeholder="${meta.inputNode?"输入内容或素材说明…":"直接上游文本会加入一次；修改或删除后不会自动覆盖…"}">${esc(displayPrompt)}</textarea></div><aside class="lfc-composer-side">${meta.executable?`<div class="lfc-composer-route">${routeControls(route,"composer",targetType)}</div>${route.channel==="model-gateway"?renderParameterEditor(node,model):`<div class="lfc-doubao-parameter-note">豆包任务只接收本节点输入框、兼容的直接上游素材和参考证据；未直接连接的更早节点不会传递。</div>`}`:`<div class="lfc-composer-input-note">输入节点会把当前内容和素材传递给下游节点。</div>`}</aside></div><footer><span>${localAssetIds.size} 个本地素材 · ${(resolvedInput.upstream.assetIds||[]).length} 个直接上游素材 · 上游文本只同步一次</span><button data-lfc-composer-run>${meta.executable?"✦ 生成":"✓ 保存并完成"}</button></footer></section>`;
    bindComposer(host,node,model);
    patchComposerBindings(host,node);
    positionComposer(!canReuse);
    window.setTimeout(()=>positionComposer(true),0);
  }
  function patchComposerBindings(host,node){
    const promptInput=$("[data-lfc-composer-prompt]",host);
    const savePrompt=()=>{const value=promptInput.value.slice(0,12000);if(value===String(node.data.inputDraft?.prompt||""))return;snapshot();node.data.inputDraft=node.data.inputDraft&&typeof node.data.inputDraft==="object"?node.data.inputDraft:{version:1,active:true,acceptedBindings:{},createdAt:now()};node.data.inputDraft.active=true;node.data.inputDraft.prompt=value;node.data.inputDraft.updatedAt=now();node.data.updatedAt=now();markDirty();renderCanvasModule();};
    promptInput.onchange=savePrompt;
    $("[data-lfc-composer-run]",host).onclick=()=>{savePrompt();runSingleNode(node.id);};
  }
  function renderAssetPicker(){let host=$(".lfc-asset-picker-host");const node=nodeById(runtime.assetPickerNodeId);if(!activePage()||!node){host?.remove();return;}if(!host){host=document.createElement("div");host.className="lfc-asset-picker-host";document.body.appendChild(host);}const types=acceptedAssetTypes(node),assets=projectAssets(types),selected=new Set(runtime.assetPickerSelection);host.innerHTML=`<div class="lfc-picker-backdrop" data-lfc-close-picker></div><section class="lfc-asset-picker"><header><div><small>PROJECT RESOURCE LIBRARY</small><strong>素材管理</strong><span>${types.join(" / ")} · 当前项目资源</span></div><button data-lfc-close-picker>×</button></header><div class="lfc-picker-grid">${assets.length?assets.map(asset=>`<button class="${selected.has(asset.id)?"selected":""}" data-lfc-picker-asset="${esc(asset.id)}">${assetPreview(asset)}<em>${selected.has(asset.id)?"✓":"＋"}</em></button>`).join(""):`<div class="lfc-picker-empty">当前项目没有对应格式素材，可上传或打开项目资源库管理。</div>`}</div><footer><button data-lfc-open-resources>▧ 项目资源库</button><button data-lfc-picker-upload>⬆ 上传新素材</button><span>已选择 ${selected.size} 个</span><button class="primary" data-lfc-picker-apply>添加到节点</button></footer></section>`;$$('[data-lfc-close-picker]',host).forEach(button=>button.onclick=()=>{runtime.assetPickerNodeId="";renderAssetPicker();});$$('[data-lfc-picker-asset]',host).forEach(button=>button.onclick=()=>{const id=button.dataset.lfcPickerAsset,index=runtime.assetPickerSelection.indexOf(id);if(index>=0)runtime.assetPickerSelection.splice(index,1);else if(runtime.assetPickerSelection.length<12)runtime.assetPickerSelection.push(id);else toast("单个节点最多直接引用 12 个素材","error");renderAssetPicker();});$("[data-lfc-open-resources]",host).onclick=openProjectResources;$("[data-lfc-picker-upload]",host).onclick=()=>uploadAssetsForNode(node,true);$("[data-lfc-picker-apply]",host).onclick=()=>applyAssetSelection(node);}
  async function refreshRuntime(){runtime.boot=await api.workbench.bootstrap();}
  async function uploadAssetsForNode(node,keepPicker=false){try{const imported=await api.assets.pickImport({projectId:runtime.projectId});if(!imported.length)return;await refreshRuntime();const allowed=new Set(acceptedAssetTypes(node)),ids=imported.filter(asset=>allowed.has(asset.type)).map(asset=>asset.id);if(!ids.length){toast("上传文件格式与当前节点不匹配","error");return;}runtime.assetPickerSelection=[...new Set([...(keepPicker?runtime.assetPickerSelection:(node.data.refs?.assetIds||[])),...ids])].slice(0,12);if(keepPicker)renderAssetPicker();else await applyAssetSelection(node);}catch(error){toast(String(error.message||error),"error");}}
  async function applyAssetSelection(node){snapshot();node.data.refs=node.data.refs||{assetIds:[],assetRoles:{},jobIds:[],conversationIds:[]};node.data.refs.assetIds=[...new Set(runtime.assetPickerSelection)];if(node.data.kind==="text"&&api.assets.readText){const parts=[];for(const id of node.data.refs.assetIds){const asset=assetById(id);if(asset?.type!=="text")continue;try{const value=await api.assets.readText(id);if(value.content)parts.push(`【${value.name}】\n${value.content}`);}catch{}}if(parts.length){const importedText=parts.join("\n\n");node.data.instruction=appendPromptOnce(node.data.instruction,importedText).slice(0,12000);if(node.data.inputDraft?.active){node.data.inputDraft.prompt=appendPromptOnce(node.data.inputDraft.prompt,importedText).slice(0,12000);node.data.inputDraft.updatedAt=now();}}}node.data.updatedAt=now();runtime.assetPickerNodeId="";runtime.assetPickerSelection=[];markDirty();renderCanvasModule();}
  function rememberNodeOutput(node,output){node.data.output=output;if(!output?.assetId)return;const prior=Array.isArray(node.data.results)?node.data.results:[],key=String(output.assetId||output.taskId||output.completedAt);node.data.results=[...prior.filter(item=>String(item?.assetId||item?.taskId||item?.completedAt)!==key),clone(output)].slice(-20);node.data.activeResultId=String(output.assetId);}
  function setActiveResult(nodeId,assetId){const node=nodeById(nodeId),result=nodeResults(node).find(item=>String(item.assetId)===String(assetId));if(!node||!result)return;snapshot();rememberNodeOutput(node,clone(result));node.data.updatedAt=now();markDirty();renderCanvasModule();toast("已设为当前节点输出","success");}
  function expandResultAsNode(sourceId,assetId){const source=nodeById(sourceId),asset=assetById(assetId);if(!source||!asset){toast("生成结果素材不存在","error");return;}const existing=documentValue().nodes.find(node=>node.data?.expandedResult?.sourceNodeId===sourceId&&node.data?.expandedResult?.assetId===assetId);if(existing){runtime.selectedIds=[existing.id];runtime.composerNodeId=existing.id;runtime.composerFocused=false;renderCanvasModule();toast("该结果已经展开为素材节点");return;}snapshot();const kind={image:"image-input",video:"video-input",audio:"audio-input",text:"text"}[asset.type]||"asset",rightX=(Number(source.position?.x)||0)+320,position=rightX<3650?{x:rightX,y:Number(source.position?.y)||0}:{x:Number(source.position?.x)||0,y:(Number(source.position?.y)||0)+220},output={type:asset.type,assetId:asset.id,assetName:asset.name,sourceNodeId:source.id,completedAt:now()},resultNode=core.makeNode(kind,position,{title:`${asset.name} · 素材`,status:"completed",refs:{assetIds:[asset.id],assetRoles:{[asset.id]:"generated-result"},jobIds:[],conversationIds:[]},output});resultNode.data.expandedResult={sourceNodeId:source.id,assetId:asset.id,createdAt:now()};documentValue().nodes.push(resultNode);documentValue().edges.push(core.makeEdge(source.id,resultNode.id,{label:"生成结果"}));runtime.selectedIds=[resultNode.id];runtime.composerNodeId=resultNode.id;runtime.composerFocused=false;markDirty();renderCanvasModule();toast("已展开为独立素材节点","success");}
  async function openAssetPreview(assetId){const asset=assetById(assetId);if(!asset)return;runtime.previewAssetId=asset.id;runtime.previewZoom=1;runtime.previewText="";renderAssetPreview();if(asset.type==="text"&&api.assets.readText){try{const value=await api.assets.readText(asset.id);if(runtime.previewAssetId===asset.id){runtime.previewText=value.content||"";renderAssetPreview();}}catch(error){toast(String(error.message||error),"error");}}}
  function renderAssetPreview(){let host=$(".lfc-asset-preview-host"),asset=assetById(runtime.previewAssetId);if(!activePage()||!asset){host?.remove();return;}if(!host){host=document.createElement("div");host.className="lfc-asset-preview-host";document.body.appendChild(host);}const media=asset.type==="image"?`<div class="lfc-preview-image-stage"><img src="${esc(asset.contentUrl)}" alt="${esc(asset.name)}" style="transform:scale(${runtime.previewZoom})"></div>`:asset.type==="video"?`<video src="${esc(asset.contentUrl)}" controls autoplay></video>`:asset.type==="audio"?`<div class="lfc-preview-audio"><i>♫</i><strong>${esc(asset.name)}</strong><audio src="${esc(asset.contentUrl)}" controls autoplay></audio></div>`:`<pre>${esc(runtime.previewText||"正在读取文本内容…")}</pre>`;host.innerHTML=`<div class="lfc-preview-backdrop" data-lfc-close-preview></div><section class="lfc-asset-viewer"><header><div><small>ASSET PREVIEW</small><strong>${esc(asset.name)}</strong><span>${esc(asset.type.toUpperCase())}</span></div><nav>${asset.type==="image"?`<button data-lfc-preview-zoom="out">－</button><em>${Math.round(runtime.previewZoom*100)}%</em><button data-lfc-preview-zoom="in">＋</button><button data-lfc-preview-zoom="fit">适应</button>`:""}<button data-lfc-close-preview>×</button></nav></header><main>${media}</main><footer><span>结果仍保留在项目资源库，可继续展开为画布节点。</span><button data-lfc-open-resources>打开项目资源库</button><button data-lfc-close-preview>关闭预览</button></footer></section>`;$$('[data-lfc-close-preview]',host).forEach(button=>button.onclick=()=>{runtime.previewAssetId="";runtime.previewText="";host.remove();});$("[data-lfc-open-resources]",host)?.addEventListener("click",openProjectResources);$$('[data-lfc-preview-zoom]',host).forEach(button=>button.onclick=()=>{runtime.previewZoom=button.dataset.lfcPreviewZoom==="fit"?1:Math.max(.25,Math.min(4,runtime.previewZoom+(button.dataset.lfcPreviewZoom==="in"?.25:-.25)));renderAssetPreview();});}
  function bindPreviewTriggers(root){$$('[data-lfc-preview-asset]',root).forEach(element=>{element.onclick=event=>{event.stopPropagation();if(event.target.closest('[data-lfc-remove-asset]'))return;openAssetPreview(element.dataset.lfcPreviewAsset);};element.ondblclick=event=>{event.stopPropagation();openAssetPreview(element.dataset.lfcPreviewAsset);};element.onkeydown=event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();openAssetPreview(element.dataset.lfcPreviewAsset);}};});}
  function bindComposer(host,node,model){
    $("[data-lfc-close-composer]",host).onclick=()=>{runtime.composerNodeId="";runtime.composerFocused=false;runtime.composerLayout=null;saveCanvasSession();markDirty();host.remove();};
    $("[data-lfc-focus-composer]",host).onclick=()=>{runtime.composerFocused=!runtime.composerFocused;runtime.composerLayout=null;saveCanvasSession();markDirty();renderComposer();};
    $("[data-lfc-pick-assets]",host)?.addEventListener("click",()=>{runtime.assetPickerNodeId=node.id;runtime.assetPickerSelection=[...(node.data.refs?.assetIds||[])];renderAssetPicker();});
    $("[data-lfc-upload-assets]",host)?.addEventListener("click",()=>uploadAssetsForNode(node));
    $("[data-lfc-open-resources]",host)?.addEventListener("click",openProjectResources);
    $$('[data-lfc-remove-asset]',host).forEach(button=>button.onclick=event=>{event.stopPropagation();snapshot();node.data.refs=node.data.refs||{assetIds:[],assetRoles:{},jobIds:[],conversationIds:[]};node.data.refs.assetIds=(node.data.refs.assetIds||[]).filter(id=>id!==button.dataset.lfcRemoveAsset);markDirty();renderCanvasModule();});
    $$('[data-lfc-add-upstream-text]',host).forEach(button=>button.onclick=event=>{event.stopPropagation();addUpstreamText(node,button.dataset.lfcAddUpstreamText,button.dataset.lfcSnapshotItem);});
    $$('[data-lfc-toggle-upstream-asset]',host).forEach(button=>button.onclick=event=>{event.stopPropagation();setSnapshotItemEnabled(button.dataset.lfcToggleUpstreamAsset,"asset",button.dataset.lfcSnapshotItem,button.dataset.lfcSnapshotEnabled==="1");});
    $$('[data-lfc-set-result]',host).forEach(button=>button.onclick=()=>setActiveResult(node.id,button.dataset.lfcSetResult));
    $$('[data-lfc-expand-result]',host).forEach(button=>button.onclick=()=>expandResultAsNode(button.dataset.lfcExpandResult,button.dataset.resultAsset));
    bindPreviewTriggers(host);
    const promptInput=$("[data-lfc-composer-prompt]",host);
    promptInput.onchange=()=>{snapshot();node.data.inputDraft=node.data.inputDraft&&typeof node.data.inputDraft==="object"?node.data.inputDraft:{version:1,active:true,acceptedBindings:{},createdAt:now()};node.data.inputDraft.active=true;node.data.inputDraft.prompt=promptInput.value.slice(0,12000);node.data.inputDraft.updatedAt=now();node.data.updatedAt=now();markDirty();renderCanvasModule();};
    bindRouteControls(host,"composer",effectiveRoute(node),route=>{node.data.route=route;node.data.modelParameters={};node.data.updatedAt=now();markDirty();renderCanvasModule();});
    $$('[data-lfc-param]',host).forEach(input=>input.onchange=()=>{snapshot();node.data.modelParameters=node.data.modelParameters||{};node.data.modelParameters[input.dataset.lfcParam]=input.type==="number"&&input.value!==""?Number(input.value):input.value;node.data.updatedAt=now();markDirty();renderComposer();});
    $("[data-lfc-save-advanced]",host)?.addEventListener("click",()=>{try{const value=JSON.parse($("[data-lfc-advanced-params]",host).value||"{}");snapshot();node.data.modelParameters=value;node.data.updatedAt=now();markDirty();renderComposer();toast("高级模型参数已应用","success");}catch{toast("高级参数 JSON 格式不正确","error");}});
    $("[data-lfc-composer-run]",host).onclick=()=>{node.data.inputDraft.prompt=promptInput.value.slice(0,12000);node.data.inputDraft.updatedAt=now();markDirty();runSingleNode(node.id);};
  }
  function edgePath(edge) {
    const source = nodeById(edge.source), target = nodeById(edge.target); if (!source || !target) return "";
    const sx=(Number(source.position?.x)||0)+248, sy=(Number(source.position?.y)||0)+70, tx=Number(target.position?.x)||0, ty=(Number(target.position?.y)||0)+70;
    const bend=Math.max(70,Math.abs(tx-sx)*.42); return `M ${sx} ${sy} C ${sx+bend} ${sy}, ${tx-bend} ${ty}, ${tx} ${ty}`;
  }
  function edgeMarkup(edge) {
    const source=nodeById(edge.source), running=activeStates.has(source?.data?.status);
    return `<g class="lfc-edge ${running?"running":""} ${runtime.selectedEdgeIds.includes(edge.id)?"selected":""}" data-edge-id="${esc(edge.id)}"><path class="hit" d="${edgePath(edge)}"></path><path class="line" d="${edgePath(edge)}"></path>${edge.label?`<text><textPath href="#${esc(edge.id)}">${esc(edge.label)}</textPath></text>`:""}</g>`;
  }
  function renderCanvasModule() {
    const stage = $("[data-lfc-mounted='1']"); if (!stage || !activePage()) return;
    const shell = $(".shell"); shell?.classList.toggle("lfc-inspector-collapsed",runtime.inspectorCollapsed);
    stage.className = `lfc-stage ${runtime.leftCollapsed?"left-collapsed":""} ${runtime.runsExpanded?"runs-expanded":""} tool-${runtime.toolMode}`;
    const canvas = currentCanvas(); const stats = canvasStats();
    const library = core.nodeLibraryForMode(canvasMode());
    const groups = [...new Set(library.map(item => item.group))];
    const filtered = library.filter(item => !runtime.search || `${item.title}${item.description}${item.group}`.toLowerCase().includes(runtime.search.toLowerCase()));
    stage.innerHTML = `<aside class="lfc-library">
      <div class="lfc-library-head"><div><span>WORKFLOW LIBRARY</span><strong>画布与节点</strong></div><button data-lfc-toggle-left title="收起节点库">${runtime.leftCollapsed?"›":"‹"}</button></div>
      <div class="lfc-canvas-switcher"><select data-lfc-canvas-select>${runtime.canvases.map(item=>`<option value="${esc(item.id)}" ${item.id===runtime.activeId?"selected":""}>${esc(item.title)}</option>`).join("")}</select><button data-lfc-new-canvas title="新建画布">＋</button></div>
      <div class="lfc-node-search"><span>⌕</span><input data-lfc-search value="${esc(runtime.search)}" placeholder="搜索节点…"></div>
      <div class="lfc-library-scroll">${groups.map(group=>{const items=filtered.filter(item=>item.group===group);if(!items.length)return"";return`<section><header><span>${esc(group)}</span><em>${items.length}</em></header>${items.map(item=>`<button class="lfc-library-node" draggable="true" data-library-kind="${esc(item.type)}" title="双击或拖入画布"><i style="--node-color:${item.color}">${esc(item.icon)}</i><span><strong>${esc(item.title)}</strong><small>${esc(item.description)}</small></span><em>⋮⋮</em></button>`).join("")}</section>`}).join("")}</div>
      <button class="lfc-template-entry" data-lfc-new-canvas><i>✦</i><span><strong>从模板创建</strong><small>空白画布 / 短剧生产模板</small></span></button>
    </aside>
    <main class="lfc-main">
      <div class="lfc-commandbar">
        <div class="lfc-document-title"><span>ACTIVE WORKFLOW</span><input data-lfc-title value="${esc(canvas?.title || "")}"></div>
        <div class="lfc-command-route">${routeControls(runtime.defaultRoute,"default")}</div>
        <div class="lfc-command-actions"><button data-lfc-undo ${runtime.history.length?"":"disabled"} title="撤销 Ctrl+Z">↶</button><button data-lfc-redo ${runtime.future.length?"":"disabled"} title="重做 Ctrl+Y">↷</button><button data-lfc-fit title="适应画布">⌗</button><button data-lfc-export-workflow title="导出工作流">⇩ 导出</button><button data-lfc-import-workflow title="导入工作流">⇧ 导入</button><span data-lfc-save-state class="lfc-save-state ${runtime.saveState}">${runtime.saveState==="saved"?"已自动保存":"等待自动保存"}</span><button class="primary" data-lfc-run-all ${runtime.runningSequence?"disabled":""}>${runtime.runningSequence?"运行中…":"▶ 运行全部"}</button></div>
      </div>
      <div class="lfc-viewport" data-lfc-viewport tabindex="0">
        <nav class="lfc-canvas-tools" aria-label="画布工具栏"><button data-lfc-tool="select" class="${runtime.toolMode==="select"?"active":""}" title="选择与框选（V）">↖<span>选择</span></button><button data-lfc-tool="pan" class="${runtime.toolMode==="pan"?"active":""}" title="平移画布（H）">✋<span>平移</span></button><i></i><button data-lfc-group-selected ${runtime.selectedIds.length<2?"disabled":""} title="把选中的节点打组（Ctrl/Cmd+G）">▦<span>打组</span></button><button data-lfc-ungroup-selected ${runtime.selectedGroupIds.length?"":"disabled"} title="解散选中分组，不删除节点">▧<span>解组</span></button><i></i><button data-lfc-delete-edge ${runtime.selectedEdgeIds.length?"":"disabled"} title="删除选中连线，只解除后续输入绑定">⌫<span>删线</span></button><button data-lfc-open-resources title="打开项目资源库">▣<span>素材管理</span></button></nav>
        <div class="lfc-world" data-lfc-world>${groupsValue().map(groupMarkup).join("")}<svg class="lfc-edges" width="4000" height="2400">${documentValue().edges.map(edgeMarkup).join("")}<path class="lfc-temp-edge" data-lfc-temp-edge d=""></path></svg>${documentValue().nodes.map(nodeCard).join("")}</div><div class="lfc-selection-box" data-lfc-selection-box hidden></div>
        ${documentValue().nodes.length?"":`<div class="lfc-empty"><i>⌘</i><strong>从一个想法开始搭建流程</strong><span>拖入节点，或在空白处右键快速创建</span><button data-lfc-new-canvas>选择模板</button></div>`}
        <div class="lfc-zoom"><button data-lfc-zoom-out>−</button><span>${Math.round((documentValue().viewport?.zoom||1)*100)}%</span><button data-lfc-zoom-in>＋</button><button data-lfc-fit>适应</button></div>
        <div class="lfc-minimap"><div>${documentValue().nodes.map(node=>`<i style="left:${Math.max(2,(Number(node.position?.x)||0)/34)}px;top:${Math.max(2,(Number(node.position?.y)||0)/24)}px;background:${core.nodeMeta(node.data?.kind).color}"></i>`).join("")}</div></div>
        <div class="lfc-status"><div><span>节点</span><strong>${stats.total}</strong></div><div><span>运行中</span><strong class="active">${stats.active}</strong></div><div><span>已完成</span><strong class="completed">${stats.completed}</strong></div><div><span>需处理</span><strong class="failed">${stats.failed + stats.stale}</strong></div><button data-lfc-toggle-runs>${runtime.runsExpanded?"收起运行现场":"查看运行现场"}</button></div>
        ${renderRunsDock()}
      </div>
    </main>
    <div class="lfc-overlay" data-lfc-overlay></div>`;
    renderInspector(); bindStage(); applyViewport(); renderMenus(); renderComposer(); renderAssetPicker(); renderAssetPreview();
  }
  function renderRunsDock() {
    const tasks = (runtime.boot?.tasks || []).filter(task => task.creationSource === "infinite-canvas-v2" && !task.deletedAt).slice(0,12);
    return `<section class="lfc-runs-dock"><header><div><span>LIVE EXECUTION</span><strong>流程运行现场</strong></div><button data-lfc-toggle-runs>${runtime.runsExpanded?"⌄":"⌃"}</button></header><div class="lfc-run-list">${tasks.length?tasks.map(task=>`<button data-lfc-task="${esc(task.id)}"><i class="${esc(task.state)}"></i><span><strong>${esc(task.title)}</strong><small>${esc(task.statusText || statusText[task.state] || task.state)}</small></span><em>${taskProgressLabel(task)}</em></button>`).join(""):`<div class="lfc-no-runs">运行节点后，任务进度、验证提醒和结果会显示在这里。</div>`}</div><footer><button data-lfc-goto-tasks>打开任务中心</button><span>提交状态未知的任务不会自动重提</span></footer></section>`;
  }
  function renderInspector() {
    const right = $(".right"); if (!right) return;
    if (runtime.inspectorCollapsed) {
      right.innerHTML = `<div class="lfc-inspector-rail"><button data-lfc-toggle-inspector title="展开节点参数">‹</button><span>NODE<br>CONTROL</span><i>${runtime.selectedIds.length || documentValue().nodes.length}</i></div>`; bindInspector(); return;
    }
    const node = selectedNode(), edge=selectedEdge(); const stats = canvasStats();
    right.innerHTML = `<div class="lfc-inspector"><header class="lfc-inspector-head"><div><span>WORKFLOW CONTROL</span><strong>${esc(node ? canvasNodeTitle(node) : edge ? "连线输入绑定" : "画布控制台")}</strong><small>${node?`${esc(canvasNodeMeta(node.data?.kind).title)} · ${esc(statusText[isStale(node)?"stale":node.data?.status] || node.data?.status || "等待执行")}`:edge?`${esc(canvasNodeTitle(nodeById(edge.source)))} → ${esc(canvasNodeTitle(nodeById(edge.target)))}`:`${stats.total} 个节点 · ${documentValue().edges.length} 条连线 · ${groupsValue().length} 个分组`}</small></div><button data-lfc-toggle-inspector title="收起参数面板">›</button></header>
      <nav class="lfc-inspector-tabs"><button data-lfc-tab="properties" class="${runtime.inspectorTab==="properties"?"active":""}">◇<span>属性</span></button><button data-lfc-tab="data" class="${runtime.inspectorTab==="data"?"active":""}">⇄<span>数据</span></button><button data-lfc-tab="runs" class="${runtime.inspectorTab==="runs"?"active":""}">▶<span>运行</span></button><button data-lfc-tab="versions" class="${runtime.inspectorTab==="versions"?"active":""}">↺<span>版本</span></button></nav>
      <div class="lfc-inspector-body">${runtime.inspectorTab==="properties"?renderProperties(node):runtime.inspectorTab==="data"?renderDataPanel(node):runtime.inspectorTab==="runs"?renderRunPanel(node):renderVersions()}</div>
    </div>`;
    bindInspector();
  }
  function renderProperties(node) {
    if (!node) return `<section class="lfc-overview"><div class="lfc-overview-orb">⌘</div><strong>${esc(currentCanvas()?.title || "无限画布")}</strong><p>选择节点后可编辑提示词、执行通道和模型参数。</p><div class="lfc-overview-grid"><div><span>节点</span><b>${documentValue().nodes.length}</b></div><div><span>连线</span><b>${documentValue().edges.length}</b></div><div><span>版本</span><b>${currentCanvas()?.versions?.length || 0}</b></div><div><span>模板</span><b>${currentCanvas()?.templateId==="short-drama"?"短剧":"空白"}</b></div></div><button class="primary" data-lfc-new-canvas>＋ 新建画布</button><button class="danger" data-lfc-delete-canvas ${runtime.canvases.length<2?"disabled":""}>删除当前画布</button></section>`;
    const meta=canvasNodeMeta(node.data?.kind); const route={...runtime.defaultRoute,...(node.data?.route||{})},targetType=meta.creationType||"text",model=route.channel==="model-gateway"?modelByRoute(route,targetType):null,typeLabel={text:"文本模型",image:"图片模型",video:"视频模型",audio:"音频模型"}[targetType]||targetType;
    return `<section class="lfc-node-properties"><div class="lfc-selected-kind" style="--node-color:${meta.color}"><i>${esc(meta.icon)}</i><div><strong>${esc(meta.title)}</strong><small>${esc(node.id.slice(0,14))}</small></div><em>${esc((meta.outputTypes||[]).join(" / "))}</em></div>
      <label><span>节点名称</span><input data-lfc-node-title value="${esc(canvasNodeTitle(node))}"></label>
      <label><span>提示词 / 执行说明</span><textarea data-lfc-node-instruction placeholder="描述这个节点要完成的工作…">${esc(node.data?.instruction || node.data?.content || "")}</textarea></label>
      ${meta.executable?`<div class="lfc-node-route"><h4>执行通道与模型</h4><label class="lfc-inspector-model-category"><span>模型类别</span><select data-lfc-model-category disabled><option value="${esc(targetType)}">${esc(typeLabel)}</option></select><small>由当前节点类型决定，仅显示兼容模型</small></label>${routeControls(route,"node",targetType)}${route.channel==="model-gateway"?`<div class="lfc-inspector-parameters"><h4>模型参数</h4>${renderParameterEditor(node,model,"inspector")}</div>`:`<div class="lfc-doubao-parameter-note">豆包通道使用当前账号环境，生成参数由豆包页面任务适配器处理。</div>`}</div>`:""}
      ${composerSupported(node)?`<button class="lfc-open-composer" data-lfc-open-composer="${esc(node.id)}">✦ 打开节点输入与参数</button>`:""}
      <div class="lfc-node-actions"><button class="primary" data-lfc-run-node="${esc(node.id)}">▶ 运行当前节点</button><button data-lfc-run-from="${esc(node.id)}">从此节点继续</button></div>
      ${node.data?.status==="awaiting_approval"?`<button class="lfc-approve" data-lfc-approve-node="${esc(node.id)}">✓ 确认并允许流程继续</button>`:""}
      ${node.data?.status==="awaiting_verification"?`<button class="lfc-verify" data-lfc-goto-doubao>需要人工验证 · 打开豆包管理</button>`:""}
      ${node.data?.refs?.jobIds?.length?`<div class="lfc-bound-task"><span>最近任务</span><code>${esc(node.data.refs.jobIds.at(-1))}</code><button data-lfc-goto-tasks>查看任务</button></div>`:""}
      <div class="lfc-node-danger"><button data-lfc-duplicate-node="${esc(node.id)}">复制节点</button><button data-lfc-delete-node="${esc(node.id)}">删除节点</button></div>
    </section>`;
  }
  const inputRoleOptions = ["", "人物", "场景", "道具", "服装", "姿势", "风格", "首帧", "尾帧", "参考", "其他"];
  function inputEdgeByBinding(bindingId) {
    return documentValue().edges.find(edge => edge.id === bindingId || edge.data?.bindingId === bindingId) || null;
  }
  function bindingRoleSelect(bindingId, current, local = false) {
    return `<select data-lfc-${local ? "local-" : ""}input-role="${esc(bindingId)}">${inputRoleOptions.map(role => `<option value="${esc(role)}" ${role === String(current || "") ? "selected" : ""}>${role || "未指定角色"}</option>`).join("")}</select>`;
  }
  function renderInputBindingRows(node, input) {
    const items = input?.upstream?.items || [];
    const localAssets = (node.data?.refs?.assetIds || []).map(String);
    const localRoles = node.data?.refs?.assetRoles || {};
    const rows = items.map(item => {
      const binding = item.binding || {bindingId:item.sourceId,order:0,enabled:true,transferMode:"auto",role:""};
      const edge = inputEdgeByBinding(binding.bindingId);
      const mode = binding.transferMode || "auto";
      return `<article class="lfc-input-binding-row ${binding.enabled === false ? "disabled" : ""}" data-lfc-input-binding="${esc(binding.bindingId)}"><div class="lfc-input-binding-order"><button data-lfc-input-move="up" data-lfc-input-binding-id="${esc(binding.bindingId)}" title="上移">↑</button><span>${Number(binding.order || 0) + 1}</span><button data-lfc-input-move="down" data-lfc-input-binding-id="${esc(binding.bindingId)}" title="下移">↓</button></div><div class="lfc-input-binding-main"><strong>${esc(item.sourceTitle)}</strong><small>${esc(core.nodeMeta(item.sourceKind).title)} · ${item.refs?.assetIds?.length || 0} 个素材 · ${esc(statusText[item.status] || item.status)}</small><p>${esc((item.content || "暂无业务文本").slice(0, 180))}</p><div class="lfc-input-binding-controls"><label><input type="checkbox" data-lfc-input-enabled="${esc(binding.bindingId)}" ${binding.enabled === false ? "" : "checked"}> 启用</label><label>传递<select data-lfc-input-mode="${esc(binding.bindingId)}"><option value="auto" ${mode === "auto" ? "selected" : ""}>自动</option><option value="text" ${mode === "text" ? "selected" : ""}>仅文本</option><option value="asset" ${mode === "asset" ? "selected" : ""}>仅素材</option><option value="control" ${mode === "control" ? "selected" : ""}>控制</option></select></label><label>角色${bindingRoleSelect(binding.bindingId, binding.role)}</label></div></div></article>`;
    }).join("");
    const localRows = localAssets.map((assetId, index) => `<article class="lfc-input-binding-row local"><div class="lfc-input-binding-order"><span>${index + 1}</span></div><div class="lfc-input-binding-main"><strong>本地素材 ${esc(assetId.slice(0, 18))}</strong><small>当前节点引用 · 保持素材上传顺序</small><div class="lfc-input-binding-controls"><label>角色${bindingRoleSelect(assetId, localRoles[assetId], true)}</label></div></div></article>`).join("");
    if (!rows && !localRows) return `<div class="lfc-no-upstream">当前节点没有可配置的上游输入。</div>`;
    return `${rows}${localRows}`;
  }
  function updateInputEdge(bindingId, patch) {
    const edge = inputEdgeByBinding(bindingId); if (!edge) return;
    snapshot(); detachDraftForEdges([edge]); edge.data = {...(edge.data || {}), ...patch, bindingId:edge.data?.bindingId || edge.id};
    const target = nodeById(edge.target); if (target) target.data.updatedAt = now();
    if(target?.data?.inputDraft?.active&&edge.data.enabled!==false){try{ensureNodeInputDraft(target,core.resolveNodeExecutionInput(target.id,documentValue().nodes,documentValue().edges));}catch{}}
    markDirty(); renderCanvasModule();
  }
  function moveInputBinding(bindingId, direction) {
    const edge = inputEdgeByBinding(bindingId); if (!edge) return;
    const targetId = edge.target;
    const incoming = documentValue().edges.filter(item => item.target === targetId).sort((a, b) => {
      const ao = Number.isFinite(Number(a.data?.order)) ? Number(a.data.order) : documentValue().edges.indexOf(a);
      const bo = Number.isFinite(Number(b.data?.order)) ? Number(b.data.order) : documentValue().edges.indexOf(b);
      return ao - bo;
    });
    const index = incoming.findIndex(item => item.id === edge.id); const nextIndex = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || nextIndex < 0 || nextIndex >= incoming.length) return;
    snapshot();
    incoming.forEach((item, itemIndex) => { item.data = {...(item.data || {}), bindingId:item.data?.bindingId || item.id, order:itemIndex}; });
    const currentOrder = incoming[index].data.order; incoming[index].data.order = incoming[nextIndex].data.order; incoming[nextIndex].data.order = currentOrder;
    const target = nodeById(targetId); if (target) target.data.updatedAt = now();
    markDirty(); renderCanvasModule();
  }
  function updateLocalInputRole(assetId, role) {
    const node = selectedNode(); if (!node) return;
    snapshot(); node.data.refs = node.data.refs || {assetIds:[],assetRoles:{},jobIds:[],conversationIds:[]}; node.data.refs.assetRoles = {...(node.data.refs.assetRoles || {}), [assetId]:role}; node.data.updatedAt = now(); markDirty(); renderCanvasModule();
  }
  function renderDataPanel(node) {
    if (!node) {const edge=selectedEdge();if(edge){const source=nodeById(edge.source),target=nodeById(edge.target),snapshotValue=edge.data?.inputSnapshot||{};return`<section class="lfc-data-panel"><div class="lfc-data-heading"><span>DIRECT INPUT BINDING</span><strong>${esc(canvasNodeTitle(source))} → ${esc(canvasNodeTitle(target))}</strong><small>删除连线只解除后续输入，不取消已经执行的任务</small></div><div class="lfc-edge-binding-card"><span>绑定 ID</span><code>${esc(edge.data?.bindingId||edge.id)}</code><span>快照状态</span><b>${esc(snapshotValue.state||"pending")}</b><span>已捕获文本</span><b>${(snapshotValue.textBlocks||[]).filter(item=>item.enabled!==false).length}</b><span>已捕获素材</span><b>${(snapshotValue.assetBindings||[]).filter(item=>item.enabled!==false).length}</b></div><button class="danger lfc-delete-edge-action" data-lfc-delete-edge="${esc(edge.id)}">⌫ 删除这条连线</button></section>`;}return `<div class="lfc-panel-empty"><i>⇄</i><strong>选择节点或连线查看数据流</strong><span>这里会显示直接上游数据、输入快照和结果绑定。</span></div>`;}
    let input; try { input=core.resolveNodeExecutionInput(node.id,documentValue().nodes,documentValue().edges); } catch { input={upstream:{items:[],text:""},prompt:""}; }
    return `<section class="lfc-data-panel"><div class="lfc-data-heading"><span>UPSTREAM PAYLOAD</span><strong>节点信息传递</strong><small>${input.upstream.items.length} 个上游节点 · ${(input.upstream.assetIds||[]).length} 个素材引用</small></div>
      <div class="lfc-input-binding-panel"><header><div><strong>输入绑定</strong><small>调整顺序、启停、传递方式和参考角色</small></div><em>${(input.inputManifest || []).length} 条证据</em></header><div class="lfc-input-binding-list">${renderInputBindingRows(node, input)}</div></div>
      <div class="lfc-upstream-list">${input.upstream.items.length?input.upstream.items.map(item=>`<article><i style="background:${core.nodeMeta(item.sourceKind).color}"></i><div><strong>${esc(item.sourceTitle)}</strong><small>${esc(core.nodeMeta(item.sourceKind).title)} · ${esc(statusText[item.status] || item.status)}</small><p>${esc((item.content || "暂无文本输出").slice(0,260))}</p></div></article>`).join(""):`<div class="lfc-no-upstream">这是起始节点，目前没有上游输入。</div>`}</div>
      <details open><summary>本次执行输入预览</summary><pre>${esc(input.prompt || "暂无输入")}</pre></details>
      <details ${node.data?.output?"open":""}><summary>最近输出快照</summary><pre>${esc(node.data?.output ? JSON.stringify(node.data.output,null,2) : "尚未执行")}</pre></details>
      <div class="lfc-binding-proof"><strong>结果隔离绑定</strong><span>租户：${esc(runtime.tenantId)}</span><span>项目：${esc(runtime.projectId)}</span><span>画布：${esc(runtime.activeId)}</span><span>节点：${esc(node.id)}</span></div>
    </section>`;
  }
  function renderRunPanel(node) {
    const tasks=(runtime.boot?.tasks||[]).filter(task=>task.creationSource==="infinite-canvas-v2"&&!task.deletedAt&&(node?(node.data?.refs?.jobIds||[]).includes(task.id):true)).slice(0,20);
    return `<section class="lfc-run-panel"><div class="lfc-data-heading"><span>LIVE EXECUTION</span><strong>${node?"当前节点运行":"流程运行记录"}</strong><small>任务状态来自统一任务中心</small></div>${tasks.length?tasks.map(task=>`<article class="lfc-run-record"><header><i class="${esc(task.state)}"></i><div><strong>${esc(task.title)}</strong><small>${esc(task.executionChannel==="doubao"?`豆包 · ${task.accountName||task.accountId}`:`模型网关 · ${task.modelId||"未选择"}`)}</small></div><em>${taskProgressLabel(task)}</em></header><div class="lfc-progress ${indeterminateTask(task)?'indeterminate':''}"><i style="width:${taskProgressWidth(task)}%"></i></div><p>${esc(task.statusText || statusText[task.state] || task.state)}</p>${task.error?`<div class="lfc-run-error">${esc(task.error)}</div>`:""}<footer><code>${esc(task.id)}</code><button data-lfc-goto-tasks>任务中心</button></footer></article>`).join(""):`<div class="lfc-panel-empty"><i>▶</i><strong>还没有运行记录</strong><span>运行节点后可在这里追踪进度、验证和错误。</span></div>`}</section>`;
  }
  function renderVersions() {
    const versions=(currentCanvas()?.versions||[]).slice().reverse();
    return `<section class="lfc-version-panel"><div class="lfc-version-head"><div><span>VERSION HISTORY</span><strong>历史版本</strong></div><button data-lfc-create-version>＋ 保存当前</button></div><p>自动保存用于恢复当前工作，手动版本用于重要节点留档。</p>${versions.length?versions.map((version,index)=>`<article><i>${index===0?"当前":`V${versions.length-index}`}</i><div><strong>${esc(version.label)}</strong><small>${new Date(version.createdAt).toLocaleString("zh-CN")}</small></div><button data-lfc-restore-version="${esc(version.id)}">恢复</button></article>`).join(""):`<div class="lfc-no-versions">还没有手动保存的版本。</div>`}</section>`;
  }

  function bindStage() {
    const stage=$("[data-lfc-mounted='1']"); if(!stage)return;
    $("[data-lfc-toggle-left]",stage).onclick=()=>{runtime.leftCollapsed=!runtime.leftCollapsed;runtime.composerLayout=null;markDirty();renderCanvasModule();};
    $$("[data-lfc-new-canvas]",stage).forEach(button=>button.onclick=openTemplateDialog);
    $("[data-lfc-canvas-select]",stage).onchange=event=>{saveNow();if(!activateCanvas(event.target.value))return;renderCanvasModule();markDirty();};
    $("[data-lfc-search]",stage).oninput=event=>{runtime.search=event.target.value;const position=event.target.selectionStart;renderCanvasModule();const input=$("[data-lfc-search]");input?.focus();input?.setSelectionRange(position,position);};
    $$("[data-library-kind]",stage).forEach(button=>{button.ondragstart=event=>{event.dataTransfer.setData("application/lingframe-node",button.dataset.libraryKind);event.dataTransfer.effectAllowed="copy";};button.ondblclick=()=>addNodeAt(button.dataset.libraryKind,viewportCenter());});
    const title=$("[data-lfc-title]",stage); title.onchange=()=>{snapshot();currentCanvas().title=title.value.trim().slice(0,80)||"未命名画布";markDirty();renderCanvasModule();};
    $$('[data-lfc-tool]',stage).forEach(button=>button.onclick=()=>{runtime.toolMode=button.dataset.lfcTool==="pan"?"pan":"select";markDirty();renderCanvasModule();});
    $("[data-lfc-group-selected]",stage).onclick=createGroupFromSelection;
    $("[data-lfc-ungroup-selected]",stage).onclick=()=>ungroupGroups(runtime.selectedGroupIds);
    $("[data-lfc-delete-edge]",stage).onclick=()=>deleteEdges(runtime.selectedEdgeIds);
    $("[data-lfc-open-resources]",stage).onclick=openProjectResources;
    bindRouteControls(stage,"default",runtime.defaultRoute,route=>{runtime.defaultRoute=route;markDirty();});
    $("[data-lfc-undo]",stage).onclick=()=>restoreHistory("undo"); $("[data-lfc-redo]",stage).onclick=()=>restoreHistory("redo");
    $("[data-lfc-export-workflow]",stage).onclick=exportWorkflow; $("[data-lfc-import-workflow]",stage).onclick=importWorkflow;
    $$("[data-lfc-fit]",stage).forEach(button=>button.onclick=()=>fitView(false));
    $("[data-lfc-run-all]",stage).onclick=()=>runSequence("");
    $$("[data-lfc-toggle-runs]",stage).forEach(button=>button.onclick=()=>{runtime.runsExpanded=!runtime.runsExpanded;renderCanvasModule();});
    $("[data-lfc-zoom-in]",stage).onclick=()=>zoomBy(.12); $("[data-lfc-zoom-out]",stage).onclick=()=>zoomBy(-.12);
    $("[data-lfc-goto-tasks]",stage)?.addEventListener("click",()=>navigate("tasks"));
    $$("[data-lfc-task]",stage).forEach(button=>button.onclick=()=>{const binding=runtime.taskNodeMap.get(button.dataset.lfcTask);if(!binding)return;if(binding.canvasId!==runtime.activeId)activateCanvas(binding.canvasId);runtime.inspectorTab="runs";runtime.inspectorCollapsed=false;runtime.selectedIds=[binding.nodeId].filter(id=>nodeById(id));runtime.selectedEdgeIds=[];runtime.selectedGroupIds=[];saveCanvasSession();markDirty();renderCanvasModule();});
    const viewport=$("[data-lfc-viewport]",stage);
    runtime.composerViewportObserver?.disconnect?.();
    if(window.ResizeObserver){runtime.composerViewportObserver=new ResizeObserver(()=>positionComposer(true));runtime.composerViewportObserver.observe(viewport);}
    viewport.oncontextmenu=event=>{if(event.target.closest(".lfc-node,.lfc-node-group,.lfc-canvas-tools,.lfc-commandbar,.lfc-runs-dock,.lfc-zoom"))return;event.preventDefault();runtime.quickMenu={clientX:event.clientX,clientY:event.clientY,point:screenToWorld(event.clientX,event.clientY),sourceId:""};runtime.nodeMenu=null;renderMenus();};
    viewport.ondragover=event=>{event.preventDefault();event.dataTransfer.dropEffect="copy";};
    viewport.ondrop=event=>{event.preventDefault();const kind=event.dataTransfer.getData("application/lingframe-node");if(kind)addNodeAt(kind,screenToWorld(event.clientX,event.clientY));};
    viewport.onwheel=event=>{event.preventDefault();const doc=documentValue(),old=doc.viewport.zoom||1,next=Math.min(1.8,Math.max(.12,old*(event.deltaY>0?.9:1.1)));const rect=viewport.getBoundingClientRect(),px=event.clientX-rect.left,py=event.clientY-rect.top,worldX=(px-(doc.viewport.x||0))/old,worldY=(py-(doc.viewport.y||0))/old;doc.viewport.zoom=next;doc.viewport.x=px-worldX*next;doc.viewport.y=py-worldY*next;applyViewport(true);updateZoomLabel();markDirty();};
    viewport.onpointerdown=event=>{if(event.target.closest(".lfc-node,.lfc-node-group,.lfc-edge,.lfc-canvas-tools,.lfc-zoom,.lfc-status,.lfc-runs-dock,.lfc-minimap"))return;const additive=event.ctrlKey||event.metaKey||event.shiftKey;if(event.button===1||(event.button===0&&runtime.toolMode==="pan")){if(!additive){runtime.selectedIds=[];runtime.selectedEdgeIds=[];runtime.selectedGroupIds=[];saveCanvasSession();markDirty();renderSelection();renderInspector();}runtime.panDrag={startX:event.clientX,startY:event.clientY,x:documentValue().viewport.x||0,y:documentValue().viewport.y||0};viewport.setPointerCapture?.(event.pointerId);return;}if(event.button!==0)return;if(!additive){runtime.selectedIds=[];runtime.selectedEdgeIds=[];runtime.selectedGroupIds=[];}runtime.marquee={startX:event.clientX,startY:event.clientY,additive};const box=$("[data-lfc-selection-box]",stage);if(box){box.hidden=false;box.style.left=`${event.clientX-viewport.getBoundingClientRect().left}px`;box.style.top=`${event.clientY-viewport.getBoundingClientRect().top}px`;box.style.width="0px";box.style.height="0px";}renderSelection();renderInspector();viewport.setPointerCapture?.(event.pointerId);};
    bindGroups(stage); bindNodes(stage); bindEdges(stage);
  }
  function bindGroups(stage){$$('[data-lfc-group-id]',stage).forEach(card=>{const id=card.dataset.lfcGroupId,group=groupById(id);card.onclick=event=>{if(event.target.closest('button'))return;event.stopPropagation();runtime.selectedGroupIds=[id];runtime.selectedIds=[...(group?.nodeIds||[])];runtime.selectedEdgeIds=[];saveCanvasSession();markDirty();renderSelection();renderInspector();};$('[data-lfc-ungroup]',card).onclick=event=>{event.stopPropagation();ungroupGroups([id]);};$('[data-lfc-group-drag]',card).onpointerdown=event=>{if(event.button!==0||event.target.closest('button'))return;event.preventDefault();event.stopPropagation();const current=groupById(id);if(!current)return;snapshot();runtime.selectedGroupIds=[id];runtime.selectedIds=[...(current.nodeIds||[])];runtime.selectedEdgeIds=[];saveCanvasSession();runtime.groupDrag={id,startX:event.clientX,startY:event.clientY,groupPosition:{...current.position},nodes:(current.nodeIds||[]).map(nodeId=>{const node=nodeById(nodeId);return{id:nodeId,position:{...node.position}};})};card.setPointerCapture?.(event.pointerId);renderSelection();renderInspector();};});}
  function bindNodes(stage) {
    $$(".lfc-node",stage).forEach(card=>{
      const id=card.dataset.nodeId;
      card.onclick=event=>{if(event.target.closest("button"))return;runtime.selectedEdgeIds=[];runtime.selectedGroupIds=[];runtime.selectedIds=event.ctrlKey||event.metaKey||event.shiftKey?(runtime.selectedIds.includes(id)?runtime.selectedIds.filter(item=>item!==id):[...runtime.selectedIds,id]):[id];runtime.composerNodeId=composerSupported(nodeById(id))?id:"";runtime.composerFocused=false;saveCanvasSession();markDirty();renderSelection();renderInspector();renderComposer();};
      card.oncontextmenu=event=>{event.preventDefault();event.stopPropagation();runtime.nodeMenu={nodeId:id,clientX:event.clientX,clientY:event.clientY};runtime.quickMenu=null;runtime.selectedEdgeIds=[];runtime.selectedGroupIds=[];runtime.selectedIds=[id];saveCanvasSession();markDirty();renderSelection();renderInspector();renderMenus();};
      $(".lfc-node-head",card).onpointerdown=event=>{if(event.button!==0)return;event.preventDefault();event.stopPropagation();snapshot();runtime.selectedGroupIds=[];runtime.selectedIds=[id];const node=nodeById(id);runtime.nodeDrag={id,startX:event.clientX,startY:event.clientY,x:node.position.x,y:node.position.y,element:card};card.setPointerCapture?.(event.pointerId);renderSelection();renderInspector();};
      $("[data-node-run]",card).onclick=event=>{event.stopPropagation();runSingleNode(id);};
      $("[data-node-edit]",card)?.addEventListener("click",event=>{event.stopPropagation();runtime.selectedIds=[id];runtime.composerNodeId=id;runtime.composerFocused=false;saveCanvasSession();markDirty();renderSelection();renderInspector();renderComposer();});
      $$('[data-lfc-expand-result]',card).forEach(button=>button.onclick=event=>{event.stopPropagation();expandResultAsNode(button.dataset.lfcExpandResult,button.dataset.resultAsset);});
      bindPreviewTriggers(card);
      $("[data-node-output]",card).onpointerdown=event=>{event.preventDefault();event.stopPropagation();runtime.connecting={sourceId:id,clientX:event.clientX,clientY:event.clientY};window.addEventListener("pointermove",connectionMove);window.addEventListener("pointerup",connectionEnd,{once:true});};
      $("[data-node-input]",card).onclick=event=>event.stopPropagation();
    });
  }
  function bindEdges(stage) {
    $$(".lfc-edge",stage).forEach(group=>group.onclick=event=>{event.stopPropagation();const edge=documentValue().edges.find(item=>item.id===group.dataset.edgeId);if(!edge)return;const additive=event.ctrlKey||event.metaKey||event.shiftKey;runtime.selectedEdgeIds=additive?(runtime.selectedEdgeIds.includes(edge.id)?runtime.selectedEdgeIds.filter(id=>id!==edge.id):[...runtime.selectedEdgeIds,edge.id]):[edge.id];runtime.selectedIds=[];runtime.selectedGroupIds=[];runtime.inspectorTab="data";saveCanvasSession();markDirty();renderSelection();renderInspector();});
  }
  function bindRouteControls(root,scope,route,onChange) {
    const channel=$(`[data-lfc-route-channel='${scope}']`,root),model=$(`[data-lfc-route-model='${scope}']`,root),group=$(`[data-lfc-route-group='${scope}']`,root),account=$(`[data-lfc-route-account='${scope}']`,root),doubaoModel=$(`[data-lfc-route-doubao-model='${scope}']`,root),ratio=$(`[data-lfc-route-ratio='${scope}']`,root),duration=$(`[data-lfc-route-duration='${scope}']`,root);
    if(!channel)return;
    const read=(forceAuto=false)=>{const next={...route,channel:channel.value};if(next.channel==="model-gateway"){const [providerId,...parts]=String(model?.value||"").split("::");next.providerId=providerId;next.modelId=parts.join("::");}else{const groupId=group?.value||next.accountGroupId||"all",pool=accountsForGroup(groupId),selection=forceAuto?"__auto__":String(account?.value||""),automatic=selection==="__auto__"||(!selection&&next.accountSelectionMode==="auto"),selected=automatic?pool[0]:pool.find(item=>item.id===selection);next.accountGroupId=groupId;next.accountSelectionMode=automatic?"auto":"manual";next.accountId=selected?.id||"";next.accountName=selected?.name||"";next.accountCandidates=(automatic?pool:(selected?[selected]:[])).map(item=>({id:item.id,name:item.name||item.id,platform:"豆包"}));next.doubaoModel=doubaoModel?.value||next.doubaoModel||"Seedance 2.0 Mini";next.ratio=ratio?.value||next.ratio||"自动";next.duration=duration?.value||next.duration||"10s";}return next;};
    channel.onchange=()=>{onChange(read(channel.value==="doubao"));renderCanvasModule();};if(model)model.onchange=()=>onChange(read());if(group)group.onchange=()=>{onChange(read(true));renderCanvasModule();};if(account)account.onchange=()=>onChange(read());for(const field of [doubaoModel,ratio,duration])if(field)field.onchange=()=>onChange(read());
  }
  function bindInspector() {
    const right=$(".right"); if(!right)return;
    $("[data-lfc-toggle-inspector]",right)?.addEventListener("click",()=>{runtime.inspectorCollapsed=!runtime.inspectorCollapsed;runtime.composerLayout=null;markDirty();renderCanvasModule();});
    $$("[data-lfc-tab]",right).forEach(button=>button.onclick=()=>{runtime.inspectorTab=button.dataset.lfcTab;renderInspector();});
    $$("[data-lfc-new-canvas]",right).forEach(button=>button.onclick=openTemplateDialog);
    $("[data-lfc-delete-canvas]",right)?.addEventListener("click",deleteCurrentCanvas);
    const node=selectedNode();
    $$('[data-lfc-input-move]',right).forEach(button=>button.onclick=event=>{event.stopPropagation();moveInputBinding(button.dataset.lfcInputBindingId,button.dataset.lfcInputMove);});
    $$('[data-lfc-input-enabled]',right).forEach(input=>input.onchange=()=>updateInputEdge(input.dataset.lfcInputEnabled,{enabled:input.checked}));
    $$('[data-lfc-input-mode]',right).forEach(input=>input.onchange=()=>updateInputEdge(input.dataset.lfcInputMode,{transferMode:input.value}));
    $$('[data-lfc-input-role]',right).forEach(input=>input.onchange=()=>updateInputEdge(input.dataset.lfcInputRole,{role:input.value}));
    $$('[data-lfc-local-input-role]',right).forEach(input=>input.onchange=()=>updateLocalInputRole(input.dataset.lfcLocalInputRole,input.value));
    $$('[data-lfc-delete-edge]',right).forEach(button=>button.onclick=()=>deleteEdges([button.dataset.lfcDeleteEdge]));
    if(node){
      const titleInput=$("[data-lfc-node-title]",right),instructionInput=$("[data-lfc-node-instruction]",right);
      if(titleInput)titleInput.onchange=event=>{snapshot();node.data.title=event.target.value.trim().slice(0,80)||core.nodeMeta(node.data.kind).title;node.data.updatedAt=now();markDirty();renderCanvasModule();};
      if(instructionInput)instructionInput.onchange=event=>{snapshot();node.data.instruction=event.target.value.slice(0,12000);node.data.updatedAt=now();markDirty();renderCanvasModule();};
      bindRouteControls(right,"node",{...runtime.defaultRoute,...(node.data.route||{})},route=>{node.data.route=route;node.data.modelParameters={};node.data.updatedAt=now();markDirty();});
      const inspectorModel=$('[data-lfc-route-model="node"]',right);if(inspectorModel){const changeModel=inspectorModel.onchange;inspectorModel.onchange=()=>{changeModel?.();renderInspector();renderComposer();};}
      $$('[data-lfc-inspector-param]',right).forEach(input=>input.onchange=()=>{snapshot();node.data.modelParameters=node.data.modelParameters||{};node.data.modelParameters[input.dataset.lfcInspectorParam]=input.type==="number"&&input.value!==""?Number(input.value):input.value;node.data.updatedAt=now();markDirty();renderComposer();});
      $('[data-lfc-inspector-save-advanced]',right)?.addEventListener('click',()=>{try{const value=JSON.parse($('[data-lfc-inspector-advanced-params]',right).value||'{}');snapshot();node.data.modelParameters=value;node.data.updatedAt=now();markDirty();renderInspector();renderComposer();toast('高级模型参数已应用','success');}catch{toast('高级参数 JSON 格式不正确','error');}});
    }
    $$("[data-lfc-run-node]",right).forEach(button=>button.onclick=()=>runSingleNode(button.dataset.lfcRunNode));
    $$("[data-lfc-run-from]",right).forEach(button=>button.onclick=()=>runSequence(button.dataset.lfcRunFrom));
    $$("[data-lfc-open-composer]",right).forEach(button=>button.onclick=()=>{runtime.composerNodeId=button.dataset.lfcOpenComposer;runtime.composerFocused=false;saveCanvasSession();markDirty();renderComposer();});
    $$("[data-lfc-approve-node]",right).forEach(button=>button.onclick=()=>{const target=nodeById(button.dataset.lfcApproveNode);if(target){snapshot();target.data.status="completed";target.data.output={approved:true,approvedAt:now(),content:"人工确认已通过"};target.data.lastInputFingerprint=inputFingerprint(target.id);markDirty();renderCanvasModule();toast("人工确认已记录，可继续运行流程","success");}});
    $$("[data-lfc-duplicate-node]",right).forEach(button=>button.onclick=()=>duplicateNode(button.dataset.lfcDuplicateNode));
    $$("[data-lfc-delete-node]",right).forEach(button=>button.onclick=()=>deleteNodes([button.dataset.lfcDeleteNode]));
    $$("[data-lfc-goto-tasks]",right).forEach(button=>button.onclick=()=>navigate("tasks"));
    $$("[data-lfc-goto-doubao]",right).forEach(button=>button.onclick=()=>navigate("doubao"));
    $("[data-lfc-create-version]",right)?.addEventListener("click",createVersion);
    $$("[data-lfc-restore-version]",right).forEach(button=>button.onclick=()=>restoreVersion(button.dataset.lfcRestoreVersion));
  }

  function renderSelection() { $$(".lfc-node").forEach(card=>card.classList.toggle("selected",runtime.selectedIds.includes(card.dataset.nodeId))); $$(".lfc-edge").forEach(edge=>edge.classList.toggle("selected",runtime.selectedEdgeIds.includes(edge.dataset.edgeId))); $$(".lfc-node-group").forEach(group=>group.classList.toggle("selected",runtime.selectedGroupIds.includes(group.dataset.lfcGroupId))); const groupButton=$("[data-lfc-group-selected]"),ungroupButton=$("[data-lfc-ungroup-selected]"),edgeButton=$(".lfc-canvas-tools [data-lfc-delete-edge]");if(groupButton)groupButton.disabled=runtime.selectedIds.length<2;if(ungroupButton)ungroupButton.disabled=!runtime.selectedGroupIds.length;if(edgeButton)edgeButton.disabled=!runtime.selectedEdgeIds.length; }
  function applyViewport(reposition=false) { const world=$("[data-lfc-world]");if(!world)return;const view=documentValue().viewport||{x:0,y:0,zoom:1};world.style.transform=`translate(${view.x||0}px,${view.y||0}px) scale(${view.zoom||1})`;if(reposition){positionComposer(true);requestAnimationFrame(()=>positionComposer(true));} }
  function updateZoomLabel(){const label=$(".lfc-zoom span");if(label)label.textContent=`${Math.round((documentValue().viewport.zoom||1)*100)}%`;}
  function zoomBy(delta){const doc=documentValue();doc.viewport.zoom=Math.min(1.8,Math.max(.12,(doc.viewport.zoom||1)+delta));applyViewport(true);updateZoomLabel();markDirty();}
  function viewportCenter(){const rect=$("[data-lfc-viewport]")?.getBoundingClientRect();return rect?screenToWorld(rect.left+rect.width/2,rect.top+rect.height/2):{x:300,y:200};}
  function screenToWorld(clientX,clientY){const viewport=$("[data-lfc-viewport]");const rect=viewport?.getBoundingClientRect()||{left:0,top:0};const view=documentValue().viewport||{x:0,y:0,zoom:1};return{x:Math.round((clientX-rect.left-(view.x||0))/(view.zoom||1)),y:Math.round((clientY-rect.top-(view.y||0))/(view.zoom||1))};}
  function fitView(readableStart=false){const nodes=documentValue().nodes,viewport=$("[data-lfc-viewport]");if(!nodes.length||!viewport)return;const rect=viewport.getBoundingClientRect(),minX=Math.min(...nodes.map(n=>n.position.x)),minY=Math.min(...nodes.map(n=>n.position.y)),maxX=Math.max(...nodes.map(n=>n.position.x+248)),maxY=Math.max(...nodes.map(n=>n.position.y+150)),padding=54,width=maxX-minX,height=maxY-minY,fitZoom=Math.min(1.15,Math.max(.12,Math.min((rect.width-padding*2)/width,(rect.height-padding*2)/height))),zoom=readableStart?Math.max(.24,fitZoom):fitZoom,x=readableStart&&zoom>fitZoom?padding-minX*zoom:(rect.width-width*zoom)/2-minX*zoom,y=(rect.height-height*zoom)/2-minY*zoom;documentValue().viewport={x,y,zoom};applyViewport(true);updateZoomLabel();markDirty();}
  function addNodeAt(kind,point,sourceId=""){snapshot();const position=core.findAvailableNodePosition(documentValue().nodes,point),meta=canvasNodeMeta(kind);const node=core.makeNode(kind,position,{title:meta.title});documentValue().nodes.push(node);if(sourceId){const valid=core.canConnect(sourceId,node.id,documentValue().edges,documentValue().nodes);if(valid.ok)documentValue().edges.push(core.makeEdge(sourceId,node.id));}runtime.selectedIds=[node.id];runtime.selectedEdgeIds=[];runtime.selectedGroupIds=[];runtime.quickMenu=null;markDirty();renderCanvasModule();toast(`已添加“${meta.title}”`,"success");}
  function duplicateNode(id){const source=nodeById(id);if(!source)return;snapshot();const copy=clone(source);copy.id=core.makeId("node");copy.position={x:source.position.x+40,y:source.position.y+40};copy.data.title=`${source.data.title} 副本`;copy.data.status="idle";copy.data.output=null;copy.data.results=[];copy.data.activeResultId="";copy.data.expandedResult=null;copy.data.inputDraft=null;copy.data.refs={assetIds:[...(source.data.refs?.assetIds||[])],assetRoles:{...(source.data.refs?.assetRoles||{})},jobIds:[],conversationIds:[]};documentValue().nodes.push(copy);runtime.selectedIds=[copy.id];runtime.selectedGroupIds=[];markDirty();renderCanvasModule();}
  function deleteNodes(ids){if(!ids.length)return;snapshot();const set=new Set(ids),removedEdges=documentValue().edges.filter(edge=>set.has(edge.source)||set.has(edge.target));detachDraftForEdges(removedEdges);documentValue().nodes=documentValue().nodes.filter(node=>!set.has(node.id));documentValue().edges=documentValue().edges.filter(edge=>!set.has(edge.source)&&!set.has(edge.target));refreshGroups();runtime.selectedIds=[];runtime.selectedGroupIds=[];runtime.nodeMenu=null;if(set.has(runtime.composerNodeId))runtime.composerNodeId="";markDirty();renderCanvasModule();toast(`已删除 ${ids.length} 个节点`);}
  function deleteEdges(ids){if(!ids.length)return;snapshot();const set=new Set(ids),removed=documentValue().edges.filter(edge=>set.has(edge.id));detachDraftForEdges(removed);documentValue().edges=documentValue().edges.filter(edge=>!set.has(edge.id));runtime.selectedEdgeIds=[];markDirty();renderCanvasModule();toast(`已删除 ${removed.length} 条连线；已运行任务继续执行`);}
  function connectNodes(source,target){const result=core.canConnect(source,target,documentValue().edges,documentValue().nodes);if(!result.ok){toast(result.reason,"error");return false;}snapshot();const edge=core.makeEdge(source,target);documentValue().edges.push(edge);const targetNode=nodeById(target);if(targetNode?.data?.inputDraft?.active){try{ensureNodeInputDraft(targetNode,core.resolveNodeExecutionInput(target,documentValue().nodes,documentValue().edges));}catch{}}runtime.selectedEdgeIds=[];runtime.selectedGroupIds=[];markDirty();renderCanvasModule();toast("节点已连接，直接上游信息已同步一次","success");return true;}
  function redrawEdges(){const svg=$(".lfc-edges");if(!svg)return;for(const group of $$(".lfc-edge",svg)){const edge=documentValue().edges.find(item=>item.id===group.dataset.edgeId);if(!edge)continue;$$('path',group).forEach(path=>path.setAttribute('d',edgePath(edge)));}}
  function connectionMove(event){if(!runtime.connecting)return;runtime.connecting.clientX=event.clientX;runtime.connecting.clientY=event.clientY;const source=nodeById(runtime.connecting.sourceId),viewport=$("[data-lfc-viewport]");if(!source||!viewport)return;const point=screenToWorld(event.clientX,event.clientY),sx=source.position.x+248,sy=source.position.y+70,bend=Math.max(70,Math.abs(point.x-sx)*.42),path=$("[data-lfc-temp-edge]");path?.setAttribute("d",`M ${sx} ${sy} C ${sx+bend} ${sy}, ${point.x-bend} ${point.y}, ${point.x} ${point.y}`);}
  function connectionEnd(event){window.removeEventListener("pointermove",connectionMove);const connection=runtime.connecting;runtime.connecting=null;$("[data-lfc-temp-edge]")?.setAttribute("d","");if(!connection)return;const target=document.elementFromPoint(event.clientX,event.clientY)?.closest?.("[data-node-input]")?.dataset.nodeInput;if(target){connectNodes(connection.sourceId,target);return;}runtime.quickMenu={clientX:event.clientX,clientY:event.clientY,point:screenToWorld(event.clientX,event.clientY),sourceId:connection.sourceId};renderMenus();}
  function renderMenus(){const overlay=$("[data-lfc-overlay]");if(!overlay)return;overlay.innerHTML="";if(runtime.quickMenu){const menu=document.createElement("div");menu.className="lfc-quick-menu";menu.style.left=`${Math.min(runtime.quickMenu.clientX,window.innerWidth-300)}px`;menu.style.top=`${Math.min(runtime.quickMenu.clientY,window.innerHeight-430)}px`;const compatible=core.nodeLibraryForMode(canvasMode()).filter(item=>!runtime.quickMenu.sourceId||core.canConnect(runtime.quickMenu.sourceId,"virtual",[],[nodeById(runtime.quickMenu.sourceId),{id:"virtual",data:{kind:item.type}}]).ok);menu.innerHTML=`<header><div><span>${runtime.quickMenu.sourceId?"CONNECT NODE":"QUICK CREATE"}</span><strong>${runtime.quickMenu.sourceId?"创建并自动连接":"在这里添加节点"}</strong></div><button data-menu-close>×</button></header><div>${compatible.map(item=>`<button data-menu-kind="${esc(item.type)}"><i style="--node-color:${item.color}">${esc(item.icon)}</i><span><strong>${esc(item.title)}</strong><small>${esc(item.group)} · ${esc(item.description)}</small></span></button>`).join("")}</div>`;overlay.appendChild(menu);$("[data-menu-close]",menu).onclick=closeMenus;$$('[data-menu-kind]',menu).forEach(button=>button.onclick=()=>addNodeAt(button.dataset.menuKind,runtime.quickMenu.point,runtime.quickMenu.sourceId));}
    if(runtime.nodeMenu){const menu=document.createElement("div");menu.className="lfc-node-menu";menu.style.left=`${Math.min(runtime.nodeMenu.clientX,window.innerWidth-190)}px`;menu.style.top=`${Math.min(runtime.nodeMenu.clientY,window.innerHeight-190)}px`;menu.innerHTML=`<button data-menu-run>▶ 运行当前节点</button><button data-menu-duplicate>◇ 复制节点</button><button data-menu-data>⇄ 查看信息传递</button><button class="danger" data-menu-delete>× 删除节点</button>`;overlay.appendChild(menu);$("[data-menu-run]",menu).onclick=()=>{const id=runtime.nodeMenu.nodeId;closeMenus();runSingleNode(id);};$("[data-menu-duplicate]",menu).onclick=()=>duplicateNode(runtime.nodeMenu.nodeId);$("[data-menu-data]",menu).onclick=()=>{runtime.selectedIds=[runtime.nodeMenu.nodeId];runtime.inspectorTab="data";runtime.nodeMenu=null;renderCanvasModule();};$("[data-menu-delete]",menu).onclick=()=>deleteNodes([runtime.nodeMenu.nodeId]);}
    overlay.onclick=event=>{if(event.target===overlay)closeMenus();};
  }
  function closeMenus(){runtime.quickMenu=null;runtime.nodeMenu=null;const overlay=$("[data-lfc-overlay]");if(overlay)overlay.innerHTML="";}
  function openTemplateDialog(){runtime.modal={kind:"template"};renderModal();}
  function renderModal(){let host=$(".lfc-modal-host");if(!host){host=document.createElement("div");host.className="lfc-modal-host";document.body.appendChild(host);}if(!runtime.modal){host.remove();return;}host.innerHTML=`<div class="lfc-modal-backdrop"><section class="lfc-modal"><header><div><span>NEW WORKFLOW</span><strong>创建无限画布</strong><small>选择起点，后续仍可自由添加和修改节点。</small></div><button data-modal-close>×</button></header><div class="lfc-template-grid"><button data-template="blank"><i>◇</i><span><strong>空白画布</strong><small>适合自由探索和自定义工作流</small><em>0 个节点</em></span></button><button data-template="short-drama"><i>▶</i><span><strong>短剧生产模板 V1</strong><small>策划、编剧、资产、分镜、视频和交付</small><em>12 个节点 · 完整生产链</em></span></button></div><footer><button data-modal-close>取消</button></footer></section></div>`;$$('[data-modal-close]',host).forEach(button=>button.onclick=()=>{runtime.modal=null;renderModal();});$$('[data-template]',host).forEach(button=>button.onclick=()=>{snapshot();const templateId=button.dataset.template,title=templateId==="short-drama"?"短剧生产流程 V1":"未命名画布";const canvas=makeCanvas(title,templateId);runtime.canvases.push(canvas);runtime.canvasSessions.set(canvas.id,emptyCanvasSession());activateCanvas(canvas.id);runtime.modal=null;markDirty();renderModal();renderCanvasModule();window.setTimeout(fitView,80);});}
  function deleteCurrentCanvas(){if(runtime.canvases.length<2)return;if(!confirm(`确定删除画布“${currentCanvas().title}”吗？`))return;const removedId=runtime.activeId;runtime.canvases=runtime.canvases.filter(item=>item.id!==removedId);runtime.canvasSessions.delete(removedId);runtime.activeId="";activateCanvas(runtime.canvases[0].id);markDirty();renderCanvasModule();}
  function createVersion(){const canvas=currentCanvas();if(!canvas)return;const label=prompt("版本名称",`手动版本 ${new Date().toLocaleString("zh-CN")}`);if(!label)return;canvas.versions=canvas.versions||[];canvas.versions.push({id:core.makeId("version"),label:label.slice(0,80),createdAt:now(),document:clone(canvas.document)});if(canvas.versions.length>30)canvas.versions.shift();markDirty();renderInspector();toast("当前画布版本已保存","success");}
  function restoreVersion(id){const canvas=currentCanvas(),version=canvas?.versions?.find(item=>item.id===id);if(!version||!confirm(`恢复版本“${version.label}”？当前内容会先进入撤销记录。`))return;snapshot();canvas.document=core.migrateDocument(version.document);runtime.selectedIds=[];markDirty();renderCanvasModule();toast("历史版本已恢复","success");}
  function navigate(page){document.querySelector(`[data-page='${page}']`)?.click();}
  function exportWorkflow(){if(!portability){toast("工作流导出模块未加载","error");return;}const canvas=currentCanvas();if(!canvas)return;try{const payload=portability.exportWorkflow(canvas.document,{selectedIds:runtime.selectedIds,mode:canvasMode(),title:canvas.title,tenantId:runtime.tenantId});const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),anchor=document.createElement("a");anchor.href=url;anchor.download=`${String(canvas.title||"lingframe-workflow").replace(/[\\/:*?"<>|]/g,"_")}.lfworkflow.json`;document.body.appendChild(anchor);anchor.click();anchor.remove();URL.revokeObjectURL(url);toast(runtime.selectedIds.length?`已导出 ${runtime.selectedIds.length} 个选中节点`:"已导出当前工作流","success");}catch(error){toast(`导出失败：${error.message||error}`,"error");}}
  function importWorkflow(){if(!portability){toast("工作流导入模块未加载","error");return;}const input=document.createElement("input");input.type="file";input.accept=".json,.lfworkflow.json,application/json";input.onchange=async()=>{const file=input.files?.[0];if(!file)return;try{const payload=JSON.parse(await file.text()),available=(runtime.boot?.assets||[]).filter(asset=>!asset.deletedAt&&asset.projectId===runtime.projectId).map(asset=>String(asset.id)),result=portability.importWorkflow(payload,{tenantId:runtime.tenantId,availableAssetIds:available});const title=String(payload.title||file.name.replace(/\.lfworkflow\.json$|\.json$/i,"")||"导入工作流").slice(0,80),canvas=makeCanvas(title,payload.mode==="short-drama"?"short-drama":"blank");canvas.document=result.document;canvas.portability={assetBindings:result.assetBindings,missingAssetIds:result.missingAssetIds,environmentRefs:result.environmentRefs,importedAt:now()};runtime.canvases.push(canvas);runtime.canvasSessions.set(canvas.id,emptyCanvasSession());activateCanvas(canvas.id);markDirty();renderCanvasModule();window.setTimeout(()=>fitView(true),80);toast(result.missingAssetIds.length?`导入完成，${result.missingAssetIds.length} 个素材待重新绑定`:`工作流导入完成，共 ${result.document.nodes.length} 个节点`,result.missingAssetIds.length?"info":"success");}catch(error){toast(`导入失败：${error.message||error}`,"error");}};input.click();}

  function effectiveRoute(node){const local=node?.data?.route||{},merged={...runtime.defaultRoute,...local},channel=local.channel||runtime.defaultRoute.channel;if(channel==="doubao"){const accountGroupId=local.accountGroupId||merged.accountGroupId||"all",pool=accountsForGroup(accountGroupId),accountSelectionMode=local.accountSelectionMode||(local.accountId?"manual":merged.accountSelectionMode)||"auto",selected=accountSelectionMode==="auto"?pool[0]:pool.find(item=>item.id===(local.accountId||merged.accountId)),accountCandidates=(accountSelectionMode==="auto"?pool:(selected?[selected]:[])).map(item=>({id:item.id,name:item.name||item.id,platform:"豆包"}));return{channel:"doubao",accountGroupId,accountSelectionMode,accountCandidates,accountId:selected?.id||"",accountName:selected?.name||"",doubaoModel:merged.doubaoModel||"Seedance 2.0 Mini",ratio:merged.ratio||"自动",duration:merged.duration||"10s"};}const route={channel:"model-gateway",providerId:merged.providerId||"",modelId:merged.modelId||""},meta=core.nodeMeta(node?.data?.kind),compatible=modelByRoute(route,meta.executable?(meta.creationType||"text"):"");return compatible?{channel:"model-gateway",providerId:compatible.providerId,modelId:compatible.id}:route;}
  function setNodeState(node,patch,canvasId=runtime.activeId){Object.assign(node.data,patch,{updatedAt:now()});markDirty(canvasId);if(activePage()&&runtime.activeId===canvasId)renderCanvasModule();}
  function referenceAssetsFromInput(input) {
    const roleMap={"人物":"character","场景":"scene","道具":"prop","服装":"costume","姿势":"pose","风格":"style","首帧":"first-frame","尾帧":"last-frame","参考":"other","其他":"other"};
    const seen=new Set(),references=[];
    for(const item of input?.inputManifest||[]){
      const assetId=String(item?.assetId||"");if(!assetId||seen.has(assetId))continue;seen.add(assetId);
      references.push({assetId,role:roleMap[item.role]||item.role||"other",label:String(item.role||"参考素材").slice(0,120),description:String(item.contentPreview||"").slice(0,500),order:references.length+1});
      if(references.length>=10)break;
    }
    return references;
  }
  function buildGenerationEnvelope(node,input,route,meta,conversationId,modelParameters,canvasId = runtime.activeId) {
    const referenceAssets=referenceAssetsFromInput(input);
    return {
      title:canvasNodeTitle(node),
      prompt:input.prompt||node.data.instruction||canvasNodeTitle(node),
      projectId:runtime.projectId,
      creationType:meta.creationType||"text",
      creationSource:"infinite-canvas-v2",
      executionChannel:route.channel,
      providerId:route.providerId,
      modelId:route.modelId,
      accountGroupId:route.accountGroupId,
      accountSelectionMode:route.accountSelectionMode,
      accountCandidates:route.accountCandidates,
      accountId:route.accountId,
      accountName:route.accountName,
      doubaoModel:route.doubaoModel,
      conversationId,
      assetIds:input.assetIds,
      referenceAssets,
      inputManifest:input.inputManifest,
      modelParameters,
      ratio:route.channel==="doubao"?route.ratio:(modelParameters.ratio||""),
      duration:route.channel==="doubao"?route.duration:(modelParameters.duration||""),
      resolution:modelParameters.resolution||"",
      generationMode:modelParameters.mode||"",
      canvasId,
      canvasNodeId:node.id
    };
  }
  async function executeNode(node, canvasId = runtime.activeId) {
    const document=documentForCanvas(canvasId),meta=core.nodeMeta(node.data.kind);let input=core.resolveNodeExecutionInput(node.id,document.nodes,document.edges);if(node.data?.inputDraft?.active&&ensureNodeInputDraft(node,input))input=core.resolveNodeExecutionInput(node.id,document.nodes,document.edges);
    if(node.data.kind==="human-approval") { setNodeState(node,{status:"awaiting_approval",output:null},canvasId); throw new Error("流程已到达人工确认节点，请确认后继续"); }
    if(!meta.executable){
      const content=node.data.content||node.data.instruction||input.upstream.text||"";
      if(meta.inputNode&&node.data.kind==="text"&&!content&&!input.assetIds.length)throw new Error("文本输入节点没有内容或文本素材");
      if(meta.inputNode&&node.data.kind!=="text"&&!input.assetIds.length)throw new Error(meta.title+"没有添加对应素材");
      const outputType=meta.outputTypes?.find(type=>type!=="asset")||node.data.kind;
      setNodeState(node,{status:"completed",output:{type:outputType,content,assetIds:input.assetIds,upstreamCount:input.upstream.items.length,completedAt:now()},lastInputFingerprint:inputFingerprint(node.id,canvasId)},canvasId);return node.data.output;
    }
    const route=effectiveRoute(node);
    if(route.channel==="model-gateway"&&(!route.providerId||!route.modelId))throw new Error("请先为节点选择模型网关和模型");
    if(route.channel==="doubao"&&!route.accountId)throw new Error("当前账号分组没有可用豆包账号，请切换分组或添加账号");
    let conversationId="";
    if((meta.creationType||"text")==="text"&&api.text?.create){const conversation=await api.text.create({projectId:runtime.projectId,title:`画布 · ${canvasNodeTitle(node)}`,type:"画布节点",content:""});conversationId=conversation.id;}
    setNodeState(node,{status:"queued",runError:""},canvasId);
    const selectedModel=route.channel==="model-gateway"?modelByRoute(route,meta.creationType||"text"):null,modelParameters=selectedModel?core.mergeModelParameters(selectedModel,node.data.modelParameters||{}):{...(node.data.modelParameters||{})};
    const request=buildGenerationEnvelope(node,input,route,meta,conversationId,modelParameters,canvasId);
    node.data.executionEnvelope={version:1,createdAt:now(),nodeId:node.id,canvasId,prompt:request.prompt,assetIds:[...(request.assetIds||[])],referenceAssets:clone(request.referenceAssets||[]),inputManifest:clone(request.inputManifest||[]),conversationId,accountId:request.accountId||"",providerId:request.providerId||"",modelId:request.modelId||"",modelParameters:clone(modelParameters||{})};
    markDirty(canvasId);
    const task=await api.generation.create(request);
    node.data.refs=node.data.refs||{assetIds:[],jobIds:[],conversationIds:[]};node.data.refs.jobIds=[...new Set([...(node.data.refs.jobIds||[]),task.id])];if(conversationId)node.data.refs.conversationIds=[...new Set([...(node.data.refs.conversationIds||[]),conversationId])];runtime.taskNodeMap.set(task.id,{canvasId,nodeId:node.id});setNodeState(node,{status:task.state||"queued",taskId:task.id,lastInputFingerprint:inputFingerprint(node.id,canvasId)},canvasId);return await awaitTask(task.id,node.id,conversationId,canvasId);
  }
  function findTaskBinding(taskId) {
    const mapped=runtime.taskNodeMap.get(taskId),mappedNode=mapped?nodeInCanvas(mapped.canvasId,mapped.nodeId):null;
    if(mappedNode)return{canvasId:mapped.canvasId,nodeId:mapped.nodeId,node:mappedNode};
    for(const canvas of runtime.canvases){const node=(canvas.document.nodes||[]).find(item=>(item.data?.refs?.jobIds||[]).some(id=>String(id)===String(taskId)));if(node){const binding={canvasId:canvas.id,nodeId:node.id,node};runtime.taskNodeMap.set(taskId,{canvasId:canvas.id,nodeId:node.id});return binding;}}
    return null;
  }
  function findNodeForTask(taskId) { return findTaskBinding(taskId)?.node||null; }
  function validateTaskBinding(task,node,conversationId="",canvasId="") {
    if(!task||!node)throw new Error("任务或节点已不存在");
    const envelope=node.data?.executionEnvelope||{};
    const boundCanvasId=canvasId||envelope.canvasId||runtime.canvases.find(canvas=>canvas.document.nodes?.includes(node))?.id||"";
    if(task.projectId&&runtime.projectId&&String(task.projectId)!==String(runtime.projectId))throw new Error("任务项目与画布项目不一致，已阻止结果回填");
    if(task.creationSource&&task.creationSource!=="infinite-canvas-v2")throw new Error("任务来源与画布节点不一致，已阻止结果回填");
    if(envelope.nodeId&&String(envelope.nodeId)!==String(node.id))throw new Error("任务节点绑定不一致，已阻止结果回填");
    if(envelope.canvasId&&boundCanvasId&&String(envelope.canvasId)!==String(boundCanvasId))throw new Error("任务画布绑定不一致，已阻止结果回填");
    if(task.conversationId&&conversationId&&String(task.conversationId)!==String(conversationId))throw new Error("任务会话与画布会话不一致，已阻止结果回填");
    if(task.conversationId&&envelope.conversationId&&String(task.conversationId)!==String(envelope.conversationId))throw new Error("任务会话证据不一致，已阻止结果回填");
    if(task.accountId&&envelope.accountId&&String(task.accountId)!==String(envelope.accountId))throw new Error("任务账号与画布账号不一致，已阻止结果回填");
    return true;
  }
  async function awaitTask(taskId,nodeId,conversationId="",canvasId=runtime.activeId) {
    const started=Date.now();
    while(Date.now()-started<60*60*1000){await new Promise(resolve=>setTimeout(resolve,1200));const boot=await api.workbench.bootstrap();runtime.boot=boot;const task=boot.tasks.find(item=>item.id===taskId),node=nodeInCanvas(canvasId,nodeId);validateTaskBinding(task,node,conversationId,canvasId);node.data.status=task.state;node.data.progress=task.progress;node.data.runError=task.error||"";markDirty(canvasId);if(activePage()&&runtime.activeId===canvasId)renderCanvasModule();if(task.state==="awaiting_verification")throw new Error("豆包需要人工验证，请在豆包管理或任务现场完成验证");if(task.state==="awaiting_quota")throw new Error(task.statusText||"当前账号池额度已耗尽，任务会在额度刷新后自动继续");if(task.state==="submission_unknown")throw new Error("提交状态未知，为避免重复生成，流程已暂停且不会自动重提");if(task.state==="failed"||task.state==="cancelled")throw new Error(task.error||task.statusText||"节点执行失败");if(task.state==="completed"){const output=resolveTaskOutput(task,boot,conversationId,node,canvasId);rememberNodeOutput(node,output);setNodeState(node,{status:"completed",lastInputFingerprint:inputFingerprint(node.id,canvasId),runError:""},canvasId);return output;}}
    throw new Error("任务运行时间过长，请到任务中心继续查看");
  }
  function resolveTaskOutput(task,boot,conversationId="",node=null,canvasId="") {const binding=node?null:findTaskBinding(task?.id),target=node||binding?.node,boundCanvasId=canvasId||binding?.canvasId||target?.data?.executionEnvelope?.canvasId||"";validateTaskBinding(task,target,conversationId,boundCanvasId);const conversationIdValue=task.conversationId||conversationId||"",conversation=conversationIdValue?boot.textConversations?.find(item=>item.id===conversationIdValue):null,asset=task.resultAssetId?boot.assets?.find(item=>item.id===task.resultAssetId):null;if(task.resultAssetId&&(!asset||asset.deletedAt||String(asset.projectId||runtime.projectId)!==String(runtime.projectId)))throw new Error("结果素材不存在或不属于当前画布项目，已阻止重新生成");if(task.creationType==="text"&&!conversation)throw new Error("文本结果会话尚未恢复，已阻止重新生成");if(task.creationType!=="text"&&!asset&&!task.resultVid)throw new Error("结果尚未完成下载或回填，已阻止重新生成");return{type:conversation?"text":asset?.type||task.creationType||"result",content:conversation?.content||"",assetId:asset?.id||"",assetName:asset?.name||"",resultUrl:task.resultVid||"",taskId:task.id,accountId:task.accountId||"",conversationId:conversationIdValue,providerId:task.providerId||"",modelId:task.modelId||"",recoveryMode:"download-only",completedAt:now()};}
  async function runSingleNode(id){const canvasId=runtime.activeId,node=nodeInCanvas(canvasId,id);if(!node)return;runtime.selectedIds=[id];runtime.inspectorTab="runs";saveCanvasSession();renderCanvasModule();try{await executeNode(node,canvasId);toast(`“${node.data.title}”运行完成`,"success");}catch(error){if(node.data.status!=="awaiting_approval"&&!['awaiting_verification','awaiting_quota','submission_unknown'].includes(node.data.status))setNodeState(node,{status:"failed",runError:error.message},canvasId);toast(error.message,"error");}}
  async function runSequence(startId="") {if(runtime.runningSequence)return;const canvasId=runtime.activeId,document=documentForCanvas(canvasId);let order;try{order=core.topologicalOrder(document.nodes,document.edges,startId);}catch(error){toast(error.message,"error");return;}runtime.runningSequence=true;runtime.runsExpanded=true;renderCanvasModule();try{for(const id of order){const node=nodeInCanvas(canvasId,id);if(!node)continue;if(startId&&id===startId&&node.data.status==="completed")node.data.status="idle";if(!startId&&node.data.status==="completed"&&!isStale(node,canvasId))continue;if(runtime.activeId===canvasId){runtime.selectedIds=[id];runtime.inspectorTab="runs";saveCanvasSession();if(activePage())renderCanvasModule();}await executeNode(node,canvasId);}toast("整套流程运行完成","success");}catch(error){toast(error.message,"error");}finally{runtime.runningSequence=false;saveNow();if(activePage())renderCanvasModule();}}
  async function syncCompletedTask(status){if(runtime.syncingTasks.has(status.taskId))return;runtime.syncingTasks.add(status.taskId);try{const binding=findTaskBinding(status.taskId);if(!binding)return;const {node,canvasId}=binding,boot=await api.workbench.bootstrap();runtime.boot=boot;const task=boot.tasks.find(item=>item.id===status.taskId);if(!task)return;validateTaskBinding(task,node,node.data.refs?.conversationIds?.at(-1)||"",canvasId);node.data.status=task.state;node.data.progress=task.progress;node.data.runError=task.error||"";if(task.state==="completed")rememberNodeOutput(node,resolveTaskOutput(task,boot,node.data.refs?.conversationIds?.at(-1)||"",node,canvasId));markDirty(canvasId);if(activePage()&&runtime.activeId===canvasId)renderCanvasModule();}catch(error){const binding=findTaskBinding(status.taskId);if(binding?.node){binding.node.data.status="failed";binding.node.data.runError=String(error.message||error);markDirty(binding.canvasId);if(activePage()&&runtime.activeId===binding.canvasId)renderCanvasModule();}}finally{runtime.syncingTasks.delete(status.taskId);}}

  window.addEventListener("pointermove",event=>{
    if(runtime.nodeDrag){const node=nodeById(runtime.nodeDrag.id),zoom=documentValue().viewport.zoom||1;if(node){node.position.x=Math.round(runtime.nodeDrag.x+(event.clientX-runtime.nodeDrag.startX)/zoom);node.position.y=Math.round(runtime.nodeDrag.y+(event.clientY-runtime.nodeDrag.startY)/zoom);runtime.nodeDrag.element.style.left=`${node.position.x}px`;runtime.nodeDrag.element.style.top=`${node.position.y}px`;redrawEdges();positionComposer(true);}}
    if(runtime.groupDrag){const group=groupById(runtime.groupDrag.id),zoom=documentValue().viewport.zoom||1,dx=(event.clientX-runtime.groupDrag.startX)/zoom,dy=(event.clientY-runtime.groupDrag.startY)/zoom;if(group){group.position={x:Math.round(runtime.groupDrag.groupPosition.x+dx),y:Math.round(runtime.groupDrag.groupPosition.y+dy)};for(const item of runtime.groupDrag.nodes){const node=nodeById(item.id);if(node)node.position={x:Math.round(item.position.x+dx),y:Math.round(item.position.y+dy)};}const card=$(`[data-lfc-group-id='${group.id}']`);if(card){card.style.left=`${group.position.x}px`;card.style.top=`${group.position.y}px`;}for(const item of runtime.groupDrag.nodes){const node=nodeById(item.id),element=$(`.lfc-node[data-node-id='${item.id}']`);if(node&&element){element.style.left=`${node.position.x}px`;element.style.top=`${node.position.y}px`;}}redrawEdges();positionComposer(true);}}
    if(runtime.panDrag){documentValue().viewport.x=runtime.panDrag.x+event.clientX-runtime.panDrag.startX;documentValue().viewport.y=runtime.panDrag.y+event.clientY-runtime.panDrag.startY;applyViewport(true);}
    if(runtime.marquee){const viewport=$("[data-lfc-viewport]"),rect=viewport?.getBoundingClientRect(),box=$("[data-lfc-selection-box]");if(!rect||!box)return;runtime.marquee.currentX=event.clientX;runtime.marquee.currentY=event.clientY;const left=Math.min(runtime.marquee.startX,event.clientX)-rect.left,top=Math.min(runtime.marquee.startY,event.clientY)-rect.top,width=Math.abs(event.clientX-runtime.marquee.startX),height=Math.abs(event.clientY-runtime.marquee.startY);box.style.left=`${left}px`;box.style.top=`${top}px`;box.style.width=`${width}px`;box.style.height=`${height}px`;}
  });
  window.addEventListener("pointerup",()=>{
    if(runtime.nodeDrag){runtime.nodeDrag=null;refreshGroups();markDirty();renderCanvasModule();}
    if(runtime.groupDrag){runtime.groupDrag=null;markDirty();renderCanvasModule();}
    if(runtime.panDrag){runtime.panDrag=null;markDirty();renderCanvasModule();}
    if(runtime.marquee){const marquee=runtime.marquee,box=$("[data-lfc-selection-box]");const start=screenToWorld(marquee.startX,marquee.startY),end=screenToWorld(marquee.currentX??marquee.startX,marquee.currentY??marquee.startY),left=Math.min(start.x,end.x),right=Math.max(start.x,end.x),top=Math.min(start.y,end.y),bottom=Math.max(start.y,end.y),picked=documentValue().nodes.filter(node=>{const x=Number(node.position?.x)||0,y=Number(node.position?.y)||0;return x+248>=left&&x<=right&&y+150>=top&&y<=bottom;}).map(node=>node.id);runtime.selectedIds=marquee.additive?[...new Set([...runtime.selectedIds,...picked])]:picked;runtime.selectedGroupIds=[];runtime.marquee=null;if(box)box.hidden=true;saveCanvasSession();markDirty();renderSelection();renderInspector();renderCanvasModule();}
  });
  window.addEventListener("keydown",event=>{
    if(!activePage())return;
    if(event.key==="Escape"&&runtime.previewAssetId){runtime.previewAssetId="";runtime.previewText="";renderAssetPreview();return;}
    if(event.key==="Escape"&&runtime.composerFocused){runtime.composerFocused=false;saveCanvasSession();markDirty();renderComposer();return;}
    if(event.target.matches("input,textarea,select"))return;
    const key=event.key.toLowerCase();
    if(!event.ctrlKey&&!event.metaKey&&key==="v"){runtime.toolMode="select";markDirty();renderCanvasModule();}
    else if(!event.ctrlKey&&!event.metaKey&&key==="h"){runtime.toolMode="pan";markDirty();renderCanvasModule();}
    else if((event.ctrlKey||event.metaKey)&&key==="g"){event.preventDefault();if(event.shiftKey)ungroupGroups(runtime.selectedGroupIds);else createGroupFromSelection();}
    else if((event.ctrlKey||event.metaKey)&&key==="z"){event.preventDefault();restoreHistory(event.shiftKey?"redo":"undo");}
    else if((event.ctrlKey||event.metaKey)&&key==="y"){event.preventDefault();restoreHistory("redo");}
    else if((event.ctrlKey||event.metaKey)&&key==="c"){runtime.clipboard=runtime.selectedIds.map(nodeById).filter(Boolean).map(clone);toast(`已复制 ${runtime.clipboard.length} 个节点`);}
    else if((event.ctrlKey||event.metaKey)&&key==="v"&&runtime.clipboard.length){snapshot();const copies=runtime.clipboard.map(source=>{const node=clone(source);node.id=core.makeId("node");node.position={x:source.position.x+50,y:source.position.y+50};node.data.status="idle";node.data.output=null;node.data.results=[];node.data.activeResultId="";node.data.expandedResult=null;node.data.inputDraft=null;node.data.refs={assetIds:[...(source.data.refs?.assetIds||[])],assetRoles:{...(source.data.refs?.assetRoles||{})},jobIds:[],conversationIds:[]};return node;});documentValue().nodes.push(...copies);runtime.selectedIds=copies.map(node=>node.id);runtime.selectedGroupIds=[];markDirty();renderCanvasModule();}
    else if(["delete","backspace"].includes(key)&&(runtime.selectedGroupIds.length||runtime.selectedEdgeIds.length||runtime.selectedIds.length)){event.preventDefault();if(runtime.selectedGroupIds.length){ungroupGroups(runtime.selectedGroupIds);return;}if(runtime.selectedEdgeIds.length)deleteEdges(runtime.selectedEdgeIds);else if(runtime.selectedIds.length)deleteNodes(runtime.selectedIds);}
  });
  window.addEventListener("resize",()=>{positionComposer(true);requestAnimationFrame(()=>positionComposer(true));});
  api.generation?.onLiveStatus?.(status=>{if(!status?.taskId)return;const binding=findTaskBinding(status.taskId);if(!binding)return;const {node,canvasId}=binding;node.data.status=status.state;node.data.progress=status.progress;node.data.runError=status.error||"";markDirty(canvasId);if(activePage()&&runtime.activeId===canvasId)renderCanvasModule();if(terminalStates.has(status.state)||status.state==="awaiting_verification")syncCompletedTask(status);});
  window.addEventListener("lingframe:account-groups-changed",()=>{runtime.accounts=window.lingframeAccountStore?.accounts?.()||runtime.accounts;if(activePage())renderCanvasModule();});
  const observer=new MutationObserver(scheduleMount);observer.observe(document.body,{childList:true,subtree:true});scheduleMount();
})();
