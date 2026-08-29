(() => {
  "use strict";
  const api = window.lingframe;
  const core = window.lingframeTextStructureCore;
  if (!api?.workbench || !core) return;

  const state = {tenantId: "local", documents: [], ready: false, ui: new Map(), timer: null};
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[char]));
  const safe = value => encodeURIComponent(String(value || "default"));
  const date = value => value ? new Date(value).toLocaleString("zh-CN", {month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit"}) : "--";
  const storageKey = () => `${core.STORAGE_PREFIX}.${safe(state.tenantId)}`;
  const conversationId = workspace => workspace.querySelector("[data-text-conversation-id]")?.dataset.textConversationId || "";
  const projectId = workspace => workspace.querySelector("[data-text-project-id]")?.dataset.textProjectId || "";
  const currentType = workspace => workspace.querySelector("[data-text-type]")?.value || "故事";
  const currentTitle = workspace => workspace.querySelector("[data-text-title]")?.value || "未命名创作";
  const currentText = workspace => workspace.querySelector("[data-text-content]")?.value || "";
  const isActive = () => document.querySelector(".nav.active[data-page]")?.dataset.page === "text";

  function toast(message, error = false) {
    let node = document.querySelector(".pm-toast");
    if (!node) { node = document.createElement("div"); document.body.appendChild(node); }
    node.className = `pm-toast ${error ? "error" : ""}`;
    node.textContent = message;
    clearTimeout(node.timer);
    node.timer = setTimeout(() => node.remove(), 3200);
  }

  function modal(content, className = "") {
    const host = document.createElement("div");
    host.className = `pm-modal ${className}`;
    host.innerHTML = `<div class="pm-modal-backdrop" data-text-structure-close></div><div class="pm-dialog glass">${content}</div>`;
    document.body.appendChild(host);
    host.querySelectorAll("[data-text-structure-close]").forEach(node => node.onclick = () => host.remove());
    return host;
  }

  function confirmDialog(title, text, confirmLabel = "确定") {
    return new Promise(resolve => {
      const host = modal(`<div class="pm-dialog-head"><div><b>${esc(title)}</b><span>${esc(text)}</span></div><button data-text-structure-close>×</button></div><div class="pm-dialog-actions"><button class="ghost" data-text-structure-no>取消</button><button class="primary" data-text-structure-yes>${esc(confirmLabel)}</button></div>`, "text-structure-confirm-modal");
      const done = value => { host.remove(); resolve(value); };
      host.querySelectorAll("[data-text-structure-close],[data-text-structure-no]").forEach(node => node.onclick = () => done(false));
      host.querySelector("[data-text-structure-yes]").onclick = () => done(true);
    });
  }

  function readStored() {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey()) || "null");
      state.documents = Array.isArray(value?.documents) ? value.documents.slice(0, 200) : [];
    } catch { state.documents = []; }
  }

  function persistStored() {
    try { localStorage.setItem(storageKey(), JSON.stringify({version: core.VERSION, documents: state.documents.slice(0, 200), updatedAt: new Date().toISOString()})); }
    catch (error) { toast(`结构化内容保存失败：${error.message || error}`, true); }
  }

  function contextFor(workspace) {
    return {tenantId: state.tenantId, projectId: projectId(workspace), conversationId: conversationId(workspace), type: currentType(workspace), derivedFromType: true};
  }

  function storedIndex(workspace) {
    return state.documents.findIndex(item => item?.projectId === projectId(workspace) && item?.conversationId === conversationId(workspace));
  }

  function hasStored(workspace) { return storedIndex(workspace) >= 0; }

  function documentFor(workspace) {
    const context = contextFor(workspace);
    const index = storedIndex(workspace);
    if (index >= 0) return core.normalizeDocument(state.documents[index], context);
    if (!workspace._textStructureTransient || workspace._textStructureTransient.conversationId !== context.conversationId || workspace._textStructureTransient.type !== context.type) {
      workspace._textStructureTransient = core.createDocument(context);
    }
    return core.normalizeDocument(workspace._textStructureTransient, context);
  }

  function uiFor(workspace) {
    const id = conversationId(workspace) || "empty";
    if (!state.ui.has(id)) state.ui.set(id, {mode:"template", entityCollection:"characters", selectedNodeId:"", selectedEntityId:"", undo:[], redo:[]});
    return state.ui.get(id);
  }

  function saveDocument(workspace, document) {
    const normalized = core.normalizeDocument({...document, tenantId: state.tenantId, projectId: projectId(workspace), conversationId: conversationId(workspace), type: currentType(workspace), derivedFromType: false}, contextFor(workspace));
    const index = storedIndex(workspace);
    if (index >= 0) state.documents[index] = normalized; else state.documents.unshift(normalized);
    workspace._textStructureTransient = core.clone(normalized);
    persistStored();
    return normalized;
  }

  function mutate(workspace, action, message = "结构已保存") {
    try {
      const ui = uiFor(workspace); const before = documentFor(workspace); let next = core.clone(before);
      const replacement = action(next);
      if (replacement && replacement.schemaVersion === core.VERSION && Array.isArray(replacement.outline) && Array.isArray(replacement.characters)) next = replacement;
      next = saveDocument(workspace, next);
      ui.undo.push(core.clone(before)); ui.undo = ui.undo.slice(-30); ui.redo = [];
      renderAll(workspace);
      if (message) toast(message);
      return next;
    } catch (error) { toast(String(error.message || error), true); return null; }
  }

  function undo(workspace) {
    const ui = uiFor(workspace); if (!ui.undo.length) return toast("没有可撤销的结构操作", true);
    const current = documentFor(workspace); const previous = ui.undo.pop(); ui.redo.push(core.clone(current)); saveDocument(workspace, previous); renderAll(workspace); toast("已撤销上一次结构操作");
  }

  function redo(workspace) {
    const ui = uiFor(workspace); if (!ui.redo.length) return toast("没有可重做的结构操作", true);
    const current = documentFor(workspace); const next = ui.redo.pop(); ui.undo.push(core.clone(current)); saveDocument(workspace, next); renderAll(workspace); toast("已重做结构操作");
  }

  function activate(workspace) {
    workspace.querySelectorAll("[data-text-assist-tab]").forEach(item => item.classList.toggle("on", item.dataset.textAssistTab === "structure"));
    workspace.querySelectorAll("[data-text-assist-body]").forEach(body => body.classList.toggle("is-hidden", body.dataset.textAssistBody !== "structure"));
    workspace.querySelector(".text-assist")?.scrollIntoView({block:"nearest"});
    renderAssist(workspace);
  }

  function templateOptions(document) {
    return core.templateList().map(item => `<option value="${esc(item.id)}" ${document.templateId === item.id ? "selected" : ""}>${esc(item.label)}</option>`).join("");
  }

  function fieldControl(definition, value, attribute) {
    if (definition.type === "select") return `<label class="text-structure-field"><span>${esc(definition.label)}</span><select ${attribute}>${(definition.options || []).map(option => `<option ${String(value) === option ? "selected" : ""}>${esc(option)}</option>`).join("")}</select></label>`;
    if (definition.type === "textarea") return `<label class="text-structure-field"><span>${esc(definition.label)}</span><textarea ${attribute} maxlength="${definition.maxLength}" placeholder="${esc(definition.placeholder || "")}">${esc(value)}</textarea></label>`;
    return `<label class="text-structure-field"><span>${esc(definition.label)}</span><input ${attribute} maxlength="${definition.maxLength}" value="${esc(value)}" placeholder="${esc(definition.placeholder || "")}"></label>`;
  }

  function treeMarkup(workspace, document) {
    const ui = uiFor(workspace); const template = core.templateById(document.templateId);
    const render = (parentId = "", depth = 0) => document.outline.filter(item => item.parentId === parentId).map(node => `<div class="text-structure-tree-branch"><button class="text-structure-tree-node ${ui.selectedNodeId === node.id ? "on" : ""}" data-text-structure-select-node="${esc(node.id)}" style="--structure-depth:${depth}"><i>${depth ? "└" : "◇"}</i><span><b>${esc(node.title || node.kind)}</b><small>${esc(node.kind)}</small></span></button>${render(node.id, depth + 1)}</div>`).join("");
    return `<section class="text-structure-left"><div class="text-structure-left-head"><div><b>作品结构</b><small>${esc(template.label)} · ${document.outline.length} 个节点</small></div><button data-text-structure-left-toggle title="收起作品结构">−</button></div><div class="text-structure-left-body"><div class="text-structure-tree">${document.outline.length ? render() : `<div class="text-structure-tree-empty">旧会话已兼容打开<small>可手动新建，或从正文提取标题</small></div>`}</div><div class="text-structure-left-actions"><button class="ghost" data-text-structure-add-root>＋ ${esc(template.rootLabel)}</button><button class="ghost" data-text-structure-add-child ${ui.selectedNodeId ? "" : "disabled"}>＋ ${esc(template.childLabel)}</button><button class="ghost" data-text-structure-import>从正文提取</button></div></div></section>`;
  }

  function renderLeft(workspace) {
    const history = workspace.querySelector(".text-history"); const list = history?.querySelector(".history-list"); if (!history || !list || !conversationId(workspace)) return;
    history.querySelector(".text-structure-left")?.remove();
    const document = documentFor(workspace);
    const host = window.document.createElement("div"); host.innerHTML = treeMarkup(workspace, document); const section = host.firstElementChild; list.before(section); bindLeft(workspace, section);
  }

  function addRoot(workspace) {
    const template = core.templateById(documentFor(workspace).templateId);
    mutate(workspace, document => { const node = core.addOutlineNode(document, {kind: template.rootLabel}); uiFor(workspace).selectedNodeId = node.id; uiFor(workspace).mode = "outline"; }, `已新建${template.rootLabel}`);
  }

  function addChild(workspace) {
    const ui = uiFor(workspace); if (!ui.selectedNodeId) return;
    const template = core.templateById(documentFor(workspace).templateId);
    mutate(workspace, document => { const node = core.addOutlineNode(document, {parentId: ui.selectedNodeId, kind: template.childLabel}); ui.selectedNodeId = node.id; ui.mode = "outline"; }, `已新建${template.childLabel}`);
  }

  async function importOutline(workspace) {
    const document = documentFor(workspace); const parsed = core.parseOutline(currentText(workspace), document.templateId);
    if (!parsed.length) return toast("正文中未识别到 Markdown 标题、章节、场景或镜头标记", true);
    if (document.outline.length && !await confirmDialog("重新提取结构", `已有 ${document.outline.length} 个节点，确认用正文中的 ${parsed.length} 个标题替换？`, "替换结构")) return;
    mutate(workspace, next => { next.outline = parsed; next.updatedAt = new Date().toISOString(); uiFor(workspace).selectedNodeId = parsed[0]?.id || ""; uiFor(workspace).mode = "outline"; }, `已从正文提取 ${parsed.length} 个结构节点`);
  }

  function bindLeft(workspace, host) {
    host.querySelector("[data-text-structure-left-toggle]")?.addEventListener("click", () => host.classList.toggle("is-collapsed"));
    host.querySelector("[data-text-structure-add-root]")?.addEventListener("click", () => addRoot(workspace));
    host.querySelector("[data-text-structure-add-child]")?.addEventListener("click", () => addChild(workspace));
    host.querySelector("[data-text-structure-import]")?.addEventListener("click", () => importOutline(workspace));
    host.querySelectorAll("[data-text-structure-select-node]").forEach(button => button.onclick = () => { const ui = uiFor(workspace); ui.selectedNodeId = button.dataset.textStructureSelectNode; ui.mode = "outline"; activate(workspace); renderAll(workspace); });
  }

  function templatePanel(document) {
    const template = core.templateById(document.templateId);
    return `<section class="text-structure-panel"><div class="text-structure-section-title"><div><b>专业模板字段</b><small>结构字段独立保存，不会静默改写正文</small></div></div><div class="text-structure-fields">${template.fields.map(definition => fieldControl(definition, document.fields[definition.key], `data-text-structure-field="${esc(definition.key)}"`)).join("")}</div></section>`;
  }

  function outlinePanel(workspace, document) {
    const ui = uiFor(workspace); let node = document.outline.find(item => item.id === ui.selectedNodeId);
    if (!node && document.outline.length) { node = document.outline[0]; ui.selectedNodeId = node.id; }
    if (!node) return `<section class="text-structure-panel"><div class="text-structure-empty">还没有结构节点<small>可从左侧新建，或从当前正文提取标题。</small><button class="primary" data-text-structure-add-root>＋ 新建第一个节点</button></div></section>`;
    const template = core.templateById(document.templateId);
    return `<section class="text-structure-panel"><div class="text-structure-section-title"><div><b>${esc(node.kind)}编辑</b><small>${esc(node.parentId ? "子节点" : "顶级节点")} · ${date(node.updatedAt)}</small></div><div class="text-structure-inline-actions"><button class="ghost" data-text-structure-node-up>上移</button><button class="ghost" data-text-structure-node-down>下移</button><button class="ghost danger-button" data-text-structure-node-remove>删除</button></div></div><label class="text-structure-field"><span>标题</span><input data-text-structure-node-title maxlength="300" value="${esc(node.title)}"></label><div class="text-structure-fields">${template.nodeFields.map(definition => fieldControl(definition, node.fields[definition.key], `data-text-structure-node-field="${esc(definition.key)}"`)).join("")}</div><button class="ghost text-structure-wide-button" data-text-structure-add-child>＋ 在当前节点下新建${esc(template.childLabel)}</button></section>`;
  }

  const ENTITY_META = Object.freeze({
    characters: {label:"人物卡", add:"新建人物", title:"name", fields:[["name","姓名"],["role","角色定位"],["goal","目标","textarea"],["conflict","冲突/弱点","textarea"],["appearance","外形与服装","textarea"],["voice","语言与声音","textarea"],["relationships","人物关系","textarea"],["notes","备注","textarea"]]},
    world: {label:"世界观", add:"新建设定", title:"name", fields:[["name","设定名称"],["category","类别"],["rule","规则与限制","textarea"],["description","详细说明","textarea"],["notes","备注","textarea"]]},
    variables: {label:"提示词变量", add:"新建变量", title:"name", fields:[["name","变量名"],["placeholder","占位符"],["value","当前值","textarea"],["notes","使用说明","textarea"]]}
  });

  function entitiesPanel(workspace, document) {
    const ui = uiFor(workspace); const collection = ENTITY_META[ui.entityCollection] ? ui.entityCollection : "characters"; const meta = ENTITY_META[collection]; const items = document[collection];
    let selected = items.find(item => item.id === ui.selectedEntityId); if (!selected && items.length) { selected = items[0]; ui.selectedEntityId = selected.id; }
    return `<section class="text-structure-panel"><div class="text-structure-subtabs">${Object.entries(ENTITY_META).map(([key, value]) => `<button class="${collection === key ? "on" : ""}" data-text-structure-entity-tab="${key}">${esc(value.label)}</button>`).join("")}</div><div class="text-structure-entity-layout"><div class="text-structure-entity-list"><button class="primary" data-text-structure-entity-add>＋ ${esc(meta.add)}</button>${items.map(item => `<button class="${selected?.id === item.id ? "on" : ""}" data-text-structure-entity-select="${esc(item.id)}"><b>${esc(item[meta.title] || "未命名")}</b><small>${date(item.updatedAt)}</small></button>`).join("") || `<div class="text-structure-mini-empty">暂无${esc(meta.label)}</div>`}</div><div class="text-structure-entity-editor">${selected ? `<div class="text-structure-section-title"><div><b>${esc(selected[meta.title] || meta.label)}</b><small>字段自动保存</small></div><button class="ghost danger-button" data-text-structure-entity-remove>删除</button></div>${meta.fields.map(([key, label, type]) => fieldControl({key,label,type:type || "text",maxLength:type === "textarea" ? 5000 : 500}, selected[key], `data-text-structure-entity-field="${key}"`)).join("")}` : `<div class="text-structure-empty">选择或新建${esc(meta.label)}</div>`}</div></div></section>`;
  }

  function timelinePanel(workspace, document) {
    const ui = uiFor(workspace); let selected = document.timeline.find(item => item.id === ui.selectedEntityId); if (!selected && document.timeline.length) { selected = document.timeline[0]; ui.selectedEntityId = selected.id; }
    const fields = [["label","事件名称"],["time","时间"],["location","地点"],["participants","参与人物"],["event","事件","textarea"],["consequence","结果与影响","textarea"]];
    return `<section class="text-structure-panel"><div class="text-structure-entity-layout"><div class="text-structure-entity-list"><button class="primary" data-text-structure-timeline-add>＋ 新建时间线事件</button>${document.timeline.map(item => `<button class="${selected?.id === item.id ? "on" : ""}" data-text-structure-timeline-select="${esc(item.id)}"><b>${esc(item.label || item.time || "未命名事件")}</b><small>${esc(item.time || "未设置时间")}</small></button>`).join("") || '<div class="text-structure-mini-empty">暂无时间线事件</div>'}</div><div class="text-structure-entity-editor">${selected ? `<div class="text-structure-section-title"><div><b>${esc(selected.label || "时间线事件")}</b><small>与正文分开保存</small></div><button class="ghost danger-button" data-text-structure-timeline-remove>删除</button></div>${fields.map(([key,label,type]) => fieldControl({key,label,type:type || "text",maxLength:type === "textarea" ? 5000 : 1000}, selected[key], `data-text-structure-timeline-field="${key}"`)).join("")}` : '<div class="text-structure-empty">选择或新建一个时间线事件</div>'}</div></div></section>`;
  }

  function versionsPanel(document) {
    return `<section class="text-structure-panel"><div class="text-structure-section-title"><div><b>结构版本</b><small>最多保留 ${core.LIMITS.versions} 个手动快照</small></div><button class="primary" data-text-structure-version-create>＋ 保存快照</button></div><div class="text-structure-version-list">${document.versions.slice().reverse().map(version => `<article><span><b>${esc(version.label)}</b><small>${date(version.createdAt)} · ${esc(core.templateById(version.templateId).label)}</small></span><button class="ghost" data-text-structure-version-preview="${esc(version.id)}">查看</button><button class="ghost" data-text-structure-version-restore="${esc(version.id)}">恢复</button></article>`).join("") || '<div class="text-structure-empty">还没有结构快照<small>日常编辑会自动保存；快照用于标记关键结构版本。</small></div>'}</div></section>`;
  }

  function renderAssist(workspace) {
    const host = workspace.querySelector('[data-text-assist-body="structure"]'); if (!host || !conversationId(workspace)) return;
    const document = documentFor(workspace); const template = core.templateById(document.templateId); const ui = uiFor(workspace); const persisted = hasStored(workspace);
    host.innerHTML = `<section class="text-assist-card text-structure-workbench"><div class="text-structure-head"><div><b>结构化创作</b><small>${persisted ? `已保存 · ${date(document.updatedAt)}` : "旧会话兼容打开 · 未强制迁移"}</small></div><div class="text-structure-head-actions"><button class="ghost" data-text-structure-undo ${ui.undo.length ? "" : "disabled"}>撤销</button><button class="ghost" data-text-structure-redo ${ui.redo.length ? "" : "disabled"}>重做</button><button class="ghost" data-text-structure-preview>预览/导出</button></div></div><label class="text-structure-template-select"><span>专业模板</span><select data-text-structure-template>${templateOptions(document)}</select><small>当前会话类型：${esc(currentType(workspace))}</small></label><div class="text-structure-mode-tabs"><button class="${ui.mode === "template" ? "on" : ""}" data-text-structure-mode="template">模板字段</button><button class="${ui.mode === "outline" ? "on" : ""}" data-text-structure-mode="outline">章节/场景</button><button class="${ui.mode === "entities" ? "on" : ""}" data-text-structure-mode="entities">人物与世界</button><button class="${ui.mode === "timeline" ? "on" : ""}" data-text-structure-mode="timeline">时间线</button><button class="${ui.mode === "versions" ? "on" : ""}" data-text-structure-mode="versions">结构版本</button></div>${ui.mode === "outline" ? outlinePanel(workspace, document) : ui.mode === "entities" ? entitiesPanel(workspace, document) : ui.mode === "timeline" ? timelinePanel(workspace, document) : ui.mode === "versions" ? versionsPanel(document) : templatePanel(document)}<footer class="text-structure-footer"><span>${esc(template.label)} · ${document.outline.length} 节点 · ${document.characters.length} 人物 · ${document.world.length} 设定 · ${document.timeline.length} 事件</span><button class="ghost" data-text-structure-copy>复制结构稿</button></footer></section>`;
    bindAssist(workspace, host);
  }

  function renderAll(workspace) { renderLeft(workspace); renderAssist(workspace); }

  async function removeNode(workspace) {
    const ui = uiFor(workspace); const document = documentFor(workspace); const node = document.outline.find(item => item.id === ui.selectedNodeId); if (!node) return;
    const descendants = document.outline.filter(item => item.parentId === node.id).length;
    if (!await confirmDialog("删除结构节点", descendants ? `删除“${node.title}”及其子节点？正文不会变化。` : `删除“${node.title}”？正文不会变化。`, "删除")) return;
    mutate(workspace, next => { core.removeOutlineNode(next, node.id); ui.selectedNodeId = next.outline[0]?.id || ""; }, "结构节点已删除");
  }

  async function switchTemplate(workspace, templateId) {
    const document = documentFor(workspace); if (document.templateId === templateId) return;
    const target = core.templateById(templateId);
    if (core.meaningful(document) && !await confirmDialog("切换专业模板", `切换到“${target.label}”后会保留结构节点、人物、世界观和时间线，但不兼容的模板字段会被移除。`, "确认切换")) return renderAssist(workspace);
    mutate(workspace, next => { core.createVersion(next, `切换模板前 · ${core.templateById(next.templateId).label}`); return core.switchTemplate(next, templateId); }, `已切换到${target.label}模板`);
  }

  function preview(workspace, document = documentFor(workspace)) {
    const compiled = core.compileDocument(document, {title: currentTitle(workspace)});
    const host = modal(`<div class="pm-preview-head"><div><b>结构化创作预览</b><span>${esc(core.templateById(document.templateId).label)} · 不会自动覆盖正文</span></div><button data-text-structure-close>×</button></div><pre class="text-structure-preview-content">${esc(compiled)}</pre><div class="text-structure-preview-actions"><button class="ghost" data-text-structure-preview-copy>复制 Markdown</button><button class="ghost" data-text-structure-export-md>导出 Markdown</button><button class="ghost" data-text-structure-export-json>导出 JSON</button><button class="primary" data-text-structure-insert>确认插入到光标</button></div>`, "text-preview-resizable text-structure-preview-modal");
    host.querySelector("[data-text-structure-preview-copy]").onclick = () => copyText(compiled, "已复制结构化 Markdown");
    host.querySelector("[data-text-structure-export-md]").onclick = () => download(`${currentTitle(workspace)}-结构稿.md`, compiled, "text/markdown;charset=utf-8");
    host.querySelector("[data-text-structure-export-json]").onclick = () => download(`${currentTitle(workspace)}-结构稿.json`, JSON.stringify(core.exportDocument(document, {title: currentTitle(workspace)}), null, 2), "application/json;charset=utf-8");
    host.querySelector("[data-text-structure-insert]").onclick = () => {
      const area = workspace.querySelector("[data-text-content]"); if (!area) return;
      const position = Number.isFinite(area.selectionStart) ? area.selectionStart : area.value.length;
      const before = area.value.slice(0, position), after = area.value.slice(position);
      const prefix = before && !/\n\s*$/.test(before) ? "\n\n" : "";
      const suffix = after && !/^\s*\n/.test(after) ? "\n\n" : "";
      area.value = `${before}${prefix}${compiled}${suffix}${after}`; area.setSelectionRange(position + prefix.length, position + prefix.length + compiled.length); area.dispatchEvent(new Event("input", {bubbles:true})); host.remove(); toast("结构稿已经人工确认插入正文");
    };
  }

  function download(name, content, mime) {
    const blob = new Blob([content], {type: mime}); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = name.replace(/[\\/:*?"<>|]/g, "-"); link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast(`已导出 ${link.download}`);
  }

  function copyText(content, success) {
    if (!navigator.clipboard?.writeText) return toast("当前环境不支持复制", true);
    navigator.clipboard.writeText(content).then(() => toast(success)).catch(error => toast(String(error.message || error), true));
  }

  function createStructureVersion(workspace) {
    const host = modal(`<div class="pm-dialog-head"><div><b>保存结构快照</b><span>快照只保存结构字段，不改变正文和正文版本。</span></div><button data-text-structure-close>×</button></div><label>快照名称<input data-text-structure-version-name maxlength="200" value="${esc(`${core.templateById(documentFor(workspace).templateId).label}结构 ${date(new Date().toISOString())}`)}"></label><div class="pm-dialog-actions"><button class="ghost" data-text-structure-close>取消</button><button class="primary" data-text-structure-version-confirm>保存快照</button></div>`, "text-structure-version-modal");
    host.querySelector("[data-text-structure-version-confirm]").onclick = () => { const name = host.querySelector("[data-text-structure-version-name]").value.trim(); mutate(workspace, next => core.createVersion(next, name), "结构快照已保存"); host.remove(); };
  }

  function previewVersion(workspace, versionId) {
    const document = documentFor(workspace); const version = document.versions.find(item => item.id === versionId); if (!version) return;
    const snapshot = core.normalizeDocument({...document, ...version, versions: document.versions}, document); preview(workspace, snapshot);
  }

  async function restoreStructureVersion(workspace, versionId) {
    const version = documentFor(workspace).versions.find(item => item.id === versionId); if (!version) return;
    if (!await confirmDialog("恢复结构快照", `恢复“${version.label}”？当前结构会进入撤销栈，正文不会变化。`, "恢复")) return;
    mutate(workspace, next => core.restoreVersion(next, versionId), "结构快照已恢复");
  }

  function bindAssist(workspace, host) {
    const ui = uiFor(workspace);
    host.querySelector("[data-text-structure-template]")?.addEventListener("change", event => switchTemplate(workspace, event.target.value));
    host.querySelectorAll("[data-text-structure-mode]").forEach(button => button.onclick = () => { ui.mode = button.dataset.textStructureMode; if (ui.mode !== "entities" && ui.mode !== "timeline") ui.selectedEntityId = ""; renderAssist(workspace); });
    host.querySelector("[data-text-structure-undo]")?.addEventListener("click", () => undo(workspace));
    host.querySelector("[data-text-structure-redo]")?.addEventListener("click", () => redo(workspace));
    host.querySelector("[data-text-structure-preview]")?.addEventListener("click", () => preview(workspace));
    host.querySelector("[data-text-structure-copy]")?.addEventListener("click", () => copyText(core.compileDocument(documentFor(workspace), {title: currentTitle(workspace)}), "已复制结构稿"));
    host.querySelectorAll("[data-text-structure-field]").forEach(input => input.addEventListener("change", () => mutate(workspace, next => { next.fields[input.dataset.textStructureField] = input.value; next.updatedAt = new Date().toISOString(); }, "模板字段已保存")));
    host.querySelector("[data-text-structure-add-root]")?.addEventListener("click", () => addRoot(workspace));
    host.querySelector("[data-text-structure-add-child]")?.addEventListener("click", () => addChild(workspace));
    const nodeId = ui.selectedNodeId;
    host.querySelector("[data-text-structure-node-title]")?.addEventListener("change", event => mutate(workspace, next => core.updateOutlineNode(next, nodeId, {title:event.target.value}), "节点标题已保存"));
    host.querySelectorAll("[data-text-structure-node-field]").forEach(input => input.addEventListener("change", () => mutate(workspace, next => core.updateOutlineNode(next, nodeId, {fields:{[input.dataset.textStructureNodeField]:input.value}}), "节点字段已保存")));
    host.querySelector("[data-text-structure-node-up]")?.addEventListener("click", () => mutate(workspace, next => core.moveOutlineNode(next, nodeId, -1), "节点已上移"));
    host.querySelector("[data-text-structure-node-down]")?.addEventListener("click", () => mutate(workspace, next => core.moveOutlineNode(next, nodeId, 1), "节点已下移"));
    host.querySelector("[data-text-structure-node-remove]")?.addEventListener("click", () => removeNode(workspace));
    host.querySelectorAll("[data-text-structure-entity-tab]").forEach(button => button.onclick = () => { ui.entityCollection = button.dataset.textStructureEntityTab; ui.selectedEntityId = ""; renderAssist(workspace); });
    host.querySelector("[data-text-structure-entity-add]")?.addEventListener("click", () => mutate(workspace, next => { const entity = core.addEntity(next, ui.entityCollection, {name:"未命名"}); ui.selectedEntityId = entity.id; }, `已新建${ENTITY_META[ui.entityCollection].label}`));
    host.querySelectorAll("[data-text-structure-entity-select]").forEach(button => button.onclick = () => { ui.selectedEntityId = button.dataset.textStructureEntitySelect; renderAssist(workspace); });
    host.querySelectorAll("[data-text-structure-entity-field]").forEach(input => input.addEventListener("change", () => mutate(workspace, next => core.updateEntity(next, ui.entityCollection, ui.selectedEntityId, {[input.dataset.textStructureEntityField]:input.value}), `${ENTITY_META[ui.entityCollection].label}已保存`)));
    host.querySelector("[data-text-structure-entity-remove]")?.addEventListener("click", async () => { if (!await confirmDialog("删除结构记录", "正文不会变化，确认删除当前记录？", "删除")) return; mutate(workspace, next => { core.removeEntity(next, ui.entityCollection, ui.selectedEntityId); ui.selectedEntityId = ""; }, "结构记录已删除"); });
    host.querySelector("[data-text-structure-timeline-add]")?.addEventListener("click", () => mutate(workspace, next => { const entity = core.addEntity(next, "timeline", {label:"未命名事件"}); ui.selectedEntityId = entity.id; }, "已新建时间线事件"));
    host.querySelectorAll("[data-text-structure-timeline-select]").forEach(button => button.onclick = () => { ui.selectedEntityId = button.dataset.textStructureTimelineSelect; renderAssist(workspace); });
    host.querySelectorAll("[data-text-structure-timeline-field]").forEach(input => input.addEventListener("change", () => mutate(workspace, next => core.updateEntity(next, "timeline", ui.selectedEntityId, {[input.dataset.textStructureTimelineField]:input.value}), "时间线已保存")));
    host.querySelector("[data-text-structure-timeline-remove]")?.addEventListener("click", async () => { if (!await confirmDialog("删除时间线事件", "确认删除当前事件？", "删除")) return; mutate(workspace, next => { core.removeEntity(next, "timeline", ui.selectedEntityId); ui.selectedEntityId = ""; }, "时间线事件已删除"); });
    host.querySelector("[data-text-structure-version-create]")?.addEventListener("click", () => createStructureVersion(workspace));
    host.querySelectorAll("[data-text-structure-version-preview]").forEach(button => button.onclick = () => previewVersion(workspace, button.dataset.textStructureVersionPreview));
    host.querySelectorAll("[data-text-structure-version-restore]").forEach(button => button.onclick = () => restoreStructureVersion(workspace, button.dataset.textStructureVersionRestore));
  }

  function enhance(workspace) {
    if (!conversationId(workspace) || workspace.dataset.textStructureReady === "1") return;
    const tabs = workspace.querySelector(".text-assist-tabs"); const assistant = workspace.querySelector(".text-assist"); if (!tabs || !assistant) return;
    const tab = document.createElement("button"); tab.type = "button"; tab.dataset.textAssistTab = "structure"; tab.setAttribute("role", "tab"); tab.textContent = "结构创作"; tabs.appendChild(tab);
    const body = document.createElement("div"); body.className = "text-assist-body is-hidden"; body.dataset.textAssistBody = "structure"; assistant.appendChild(body);
    tab.addEventListener("click", () => activate(workspace));
    const editorTabs = workspace.querySelector(".text-tabs"); if (editorTabs) { const open = document.createElement("button"); open.type = "button"; open.dataset.textStructureOpen = "1"; open.textContent = "结构化"; open.onclick = () => activate(workspace); editorTabs.appendChild(open); }
    workspace.querySelector("[data-text-type]")?.addEventListener("change", () => { if (!hasStored(workspace)) workspace._textStructureTransient = null; setTimeout(() => renderAll(workspace), 0); });
    workspace.dataset.textStructureReady = "1";
    renderAll(workspace);
  }

  function scan() {
    if (!state.ready || !isActive()) return;
    document.querySelectorAll('.text-workspace[data-text-layout-ready="1"]').forEach(enhance);
  }

  window.lingframeTextStructureBatchE = Object.freeze({
    ownsStructure: true,
    version: core.VERSION,
    templates: core.templateList(),
    getDocument(id) { const raw = state.documents.find(item => item.conversationId === String(id || "")); return raw ? core.clone(raw) : null; },
    compile(id, title = "") { const raw = state.documents.find(item => item.conversationId === String(id || "")); return raw ? core.compileDocument(raw, {title}) : ""; }
  });

  new MutationObserver(scan).observe(document.body, {childList:true, subtree:true});
  Promise.resolve(api.identity?.status?.()).then(identity => { state.tenantId = String(identity?.tenantId || "local"); readStored(); state.ready = true; scan(); }).catch(() => { readStored(); state.ready = true; scan(); });
})();
