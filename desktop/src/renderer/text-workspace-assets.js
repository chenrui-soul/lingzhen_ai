(() => {
  "use strict";
  const api = window.lingframe;
  if (!api?.workbench || !api?.assets?.readText) return;

  const state = {bound: new WeakSet(), loading: new WeakSet()};
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;", "'":"&#39;"}[char]));
  const date = value => value ? new Date(value).toLocaleString("zh-CN", {month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit"}) : "--";
  const text = asset => `${asset?.name || ""} ${asset?.originalName || ""} ${(asset?.tags || []).join(" ")} ${asset?.notes || ""} ${asset?.source || ""}`.toLowerCase();
  const sourceLabel = asset => {
    const source = String(asset?.source || "").toLowerCase();
    if (source.includes("generated") || source.includes("ai")) return "AI 生成";
    if (source.includes("literature") || source.includes("文献") || source.includes("reference")) return "文献参考";
    if (source.includes("project")) return "项目资料";
    if (source.includes("version") || source.includes("history")) return "历史版本";
    return "本地上传";
  };
  const currentProjectId = workspace => workspace.querySelector("[data-text-project-id]")?.dataset.textProjectId || "";
  const currentConversationId = workspace => workspace.querySelector("[data-text-conversation-id]")?.dataset.textConversationId || "";
  const toast = (message, error = false) => {
    let node = document.querySelector(".pm-toast");
    if (!node) { node = document.createElement("div"); document.body.appendChild(node); }
    node.className = `pm-toast ${error ? "error" : ""}`;
    node.textContent = message;
    clearTimeout(node.timer);
    node.timer = setTimeout(() => node.remove(), 3200);
  };

  function modal(content, className = "") {
    const host = document.createElement("div");
    host.className = `pm-modal ${className}`;
    host.innerHTML = `<div class="pm-modal-backdrop" data-text-asset-modal-close></div><div class="pm-dialog glass">${content}</div>`;
    document.body.appendChild(host);
    host.querySelectorAll("[data-text-asset-modal-close]").forEach(node => node.onclick = () => host.remove());
    return host;
  }

  function currentTextArea(workspace) { return workspace.querySelector("[data-text-content]"); }
  function normalizeExcerpt(value) { return String(value || "").replace(/\r\n/g, "\n").trim(); }
  function insertionKey(assetId, excerpt) { return `${assetId}::${normalizeExcerpt(excerpt)}`; }

  function assetsFor(workspace) {
    const projectId = currentProjectId(workspace);
    const filter = workspace._textAssetState || {search:"", source:"all", assets:[]};
    return (filter.assets || []).filter(asset => !asset.deletedAt && !asset.archivedAt && asset.projectId === projectId && asset.type === "text").filter(asset => filter.source === "all" || sourceLabel(asset) === filter.source).filter(asset => !filter.search || text(asset).includes(filter.search.toLowerCase()));
  }

  function card(asset) {
    return `<article class="text-asset-card" draggable="true" data-text-asset-id="${esc(asset.id)}"><div class="text-asset-card-main"><div class="text-asset-icon">${esc(asset.ext?.slice(1).toUpperCase() || "TXT")}</div><div class="text-asset-copy"><b title="${esc(asset.name)}">${esc(asset.name)}</b><small>${esc(sourceLabel(asset))} · ${esc(asset.originalName || "文本素材")} · ${date(asset.updatedAt)}</small><span>${esc((asset.tags || []).slice(0, 3).join(" · ") || "未设置标签")}</span></div></div><div class="text-asset-actions"><button class="ghost" data-text-asset-action="preview">查看原文</button><button class="ghost" data-text-asset-action="copy">复制</button><button class="ghost" data-text-asset-action="extract">提取词句</button><button class="primary" data-text-asset-action="insert">插入正文</button></div></article>`;
  }

  function render(workspace) {
    const host = workspace.querySelector('[data-text-assist-body="assets"]');
    if (!host) return;
    const local = workspace._textAssetState || {search:"", source:"all", assets:[], loading:false};
    const items = assetsFor(workspace);
    host.innerHTML = `<section class="text-assist-card text-assets-library"><div class="text-assets-library-head"><div><b>文本素材库</b><small>素材中心同源 · 当前项目</small></div><button class="ghost" data-text-asset-refresh ${local.loading ? "disabled" : ""}>刷新</button></div><div class="text-assets-toolbar"><input data-text-asset-search value="${esc(local.search)}" placeholder="⌕ 搜索名称、标签或来源"><select data-text-asset-source><option value="all" ${local.source === "all" ? "selected" : ""}>全部来源</option><option value="AI 生成" ${local.source === "AI 生成" ? "selected" : ""}>AI 生成</option><option value="本地上传" ${local.source === "本地上传" ? "selected" : ""}>本地上传</option><option value="文献参考" ${local.source === "文献参考" ? "selected" : ""}>文献参考</option><option value="项目资料" ${local.source === "项目资料" ? "selected" : ""}>项目资料</option><option value="历史版本" ${local.source === "历史版本" ? "selected" : ""}>历史版本</option></select></div><div class="text-assets-summary">${items.length ? `当前项目可用文本素材 ${items.length} 个` : "当前项目暂无符合条件的文本素材"}</div><div class="text-assets-list">${items.length ? items.map(card).join("") : `<div class="text-assets-empty">素材中心中还没有可引用的文本素材。<small>可先在素材中心上传 TXT、MD、JSON 或 CSV 文件。</small></div>`}</div></section>`;
    bind(workspace, host);
  }

  async function load(workspace) {
    const local = workspace._textAssetState || {search:"", source:"all", assets:[], loading:false};
    if (local.loading) return;
    local.loading = true;
    workspace._textAssetState = local;
    render(workspace);
    try {
      const data = await api.workbench.bootstrap();
      local.assets = Array.isArray(data.assets) ? data.assets : [];
      local.currentProjectId = data.currentProjectId || local.currentProjectId || "";
      local.loadedAt = Date.now();
      local.error = "";
    } catch (error) {
      local.error = String(error.message || error);
      toast(local.error, true);
    } finally {
      local.loading = false;
      render(workspace);
    }
  }

  async function read(asset) {
    if (!asset || asset.type !== "text") throw new Error("只有文本素材可以读取");
    return api.assets.readText(asset.id);
  }

  function sourceLine(asset) { return `${sourceLabel(asset)} · ${asset.originalName || asset.name} · ${date(asset.updatedAt)} · assetId: ${asset.id}`; }

  async function previewAsset(asset) {
    try {
      const result = await read(asset);
      const content = String(result?.content || "");
      const host = modal(`<div class="pm-dialog-head"><div><b>${esc(asset.name)}</b><span>${esc(sourceLine(asset))}</span></div><button data-text-asset-modal-close>×</button></div><div class="text-asset-source-note">来源信息会随引用保留，不会复制素材文件。</div><article class="text-asset-preview-content">${content ? esc(content).replace(/\n/g, "<br>") : "<span>这个素材没有可读文本。</span>"}</article><div class="pm-dialog-actions"><button class="ghost" data-text-asset-modal-close>关闭</button></div>`, "text-asset-preview-modal");
      host.querySelectorAll("[data-text-asset-modal-close]").forEach(node => node.onclick = () => host.remove());
    } catch (error) { toast(String(error.message || error), true); }
  }

  async function copyAsset(asset) {
    try {
      const result = await read(asset);
      if (!navigator.clipboard?.writeText) throw new Error("当前环境不支持复制");
      await navigator.clipboard.writeText(String(result?.content || ""));
      toast(`已复制“${asset.name}”文本`);
    } catch (error) { toast(String(error.message || error), true); }
  }

  function insertText(workspace, asset, excerpt, source = "素材插入") {
    const area = currentTextArea(workspace);
    const value = normalizeExcerpt(excerpt);
    if (!area || !value) return toast("没有可插入的文本", true);
    const keys = workspace._textAssetInsertKeys || (workspace._textAssetInsertKeys = new Set());
    const key = insertionKey(asset.id, value);
    if (keys.has(key)) return toast("这段素材已经插入过，避免重复写入", true);
    const start = Number.isFinite(area.selectionStart) ? area.selectionStart : area.value.length;
    const end = Number.isFinite(area.selectionEnd) ? area.selectionEnd : start;
    const before = area.value.slice(0, start);
    const after = area.value.slice(end);
    const prefix = before && !/[\s\n]$/.test(before) ? "\n" : "";
    const suffix = after && !/^[\s\n]/.test(after) ? "\n" : "";
    const next = `${before}${prefix}${value}${suffix}${after}`;
    area.focus();
    area.value = next;
    const caret = before.length + prefix.length + value.length;
    area.setSelectionRange(caret, caret);
    area.dispatchEvent(new Event("input", {bubbles:true}));
    keys.add(key);
    toast(`${source}已加入正文，来源：${asset.name}`);
  }

  async function insertPreview(workspace, asset, excerpt = "", source = "素材插入") {
    try {
      const result = excerpt || (await read(asset)).content || "";
      const host = modal(`<div class="pm-dialog-head"><div><b>插入前预览</b><span>${esc(sourceLine(asset))}</span></div><button data-text-asset-modal-close>×</button></div><div class="text-asset-source-note">确认后才会写入正文；来源信息：${esc(sourceLine(asset))}</div><textarea class="text-asset-insert-editor" data-text-asset-insert-content>${esc(result)}</textarea><div class="pm-dialog-actions"><button class="ghost" data-text-asset-modal-close>取消</button><button class="primary" data-text-asset-confirm>确认插入</button></div>`, "text-asset-insert-modal");
      host.querySelectorAll("[data-text-asset-modal-close]").forEach(node => node.onclick = () => host.remove());
      host.querySelector("[data-text-asset-confirm]").onclick = () => { const value = host.querySelector("[data-text-asset-insert-content]").value; host.remove(); insertText(workspace, asset, value, source); };
      host.querySelector("[data-text-asset-insert-content]")?.focus();
    } catch (error) { toast(String(error.message || error), true); }
  }

  async function extractAsset(workspace, asset) {
    try {
      const result = await read(asset);
      const host = modal(`<div class="pm-dialog-head"><div><b>提取词句 · ${esc(asset.name)}</b><span>可以插入正文，也可以通过共享素材契约保存为正式文本素材。</span></div><button data-text-asset-modal-close>×</button></div><div class="text-asset-source-note">来源：${esc(sourceLine(asset))}</div><label>摘录素材名称<input data-text-asset-extract-name maxlength="120" value="${esc(asset.name)} 摘录"></label><textarea class="text-asset-extract-editor" data-text-asset-extract-content>${esc(result?.content || "")}</textarea><div class="pm-dialog-actions"><button class="ghost" data-text-asset-modal-close>取消</button><button class="ghost" data-text-asset-extract-save>保存到素材中心</button><button class="primary" data-text-asset-extract-confirm>提取并插入正文</button></div>`, "text-asset-extract-modal");
      host.querySelectorAll("[data-text-asset-modal-close]").forEach(node => node.onclick = () => host.remove());
      const editor = host.querySelector("[data-text-asset-extract-content]");
      host.querySelector("[data-text-asset-extract-confirm]").onclick = () => { const selected = editor.value.slice(editor.selectionStart, editor.selectionEnd) || editor.value; host.remove(); insertPreview(workspace, asset, selected, "摘录"); };
      host.querySelector("[data-text-asset-extract-save]").onclick = async () => {
        const selected = normalizeExcerpt(editor.value.slice(editor.selectionStart, editor.selectionEnd) || editor.value);
        const name = host.querySelector("[data-text-asset-extract-name]").value.trim();
        if (!selected) return toast("请先选择或保留需要保存的词句", true);
        if (!name) return toast("请输入摘录素材名称", true);
        if (!api.assets.createText) return toast("当前版本尚未加载共享文本素材契约", true);
        try {
          const created = await api.assets.createText({projectId:currentProjectId(workspace), name, content:selected, source:"text-excerpt", sourceAssetId:asset.id, sourceLocation:`conversation:${currentConversationId(workspace) || "unknown"}`, tags:["摘录", sourceLabel(asset)], notes:`摘录自素材：${asset.name}`});
          host.remove(); await load(workspace); toast(`已保存到素材中心：${created.name}`);
        } catch (error) { toast(String(error.message || error), true); }
      };
      editor.focus();
    } catch (error) { toast(String(error.message || error), true); }
  }

  function assetById(workspace, id) { return (workspace._textAssetState?.assets || []).find(asset => asset.id === id) || null; }

  function bind(workspace, host) {
    if (!host) return;
    host.dataset.textAssetsBound = "1";
    host.querySelector("[data-text-asset-refresh]")?.addEventListener("click", () => load(workspace));
    host.querySelector("[data-text-asset-search]")?.addEventListener("input", event => { workspace._textAssetState.search = event.target.value; render(workspace); });
    host.querySelector("[data-text-asset-source]")?.addEventListener("change", event => { workspace._textAssetState.source = event.target.value; render(workspace); });
    host.querySelectorAll("[data-text-asset-id]").forEach(card => {
      const asset = assetById(workspace, card.dataset.textAssetId);
      if (!asset) return;
      card.addEventListener("dragstart", event => {
        const payload = {assetId:asset.id, projectId:asset.projectId, source:sourceLine(asset)};
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("application/x-lingframe-text-asset", JSON.stringify(payload));
        event.dataTransfer.setData("text/plain", asset.name);
        card.classList.add("is-dragging");
      });
      card.addEventListener("dragend", () => card.classList.remove("is-dragging"));
      card.querySelectorAll("[data-text-asset-action]").forEach(button => button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        const action = button.dataset.textAssetAction;
        if (action === "preview") previewAsset(asset);
        else if (action === "copy") copyAsset(asset);
        else if (action === "extract") extractAsset(workspace, asset);
        else if (action === "insert") insertPreview(workspace, asset);
      }));
    });
  }

  function bindDrop(workspace) {
    if (workspace.dataset.textAssetDropBound === "1") return;
    const area = currentTextArea(workspace);
    if (!area) return;
    workspace.dataset.textAssetDropBound = "1";
    area.addEventListener("dragover", event => {
      if (![...event.dataTransfer.types].includes("application/x-lingframe-text-asset")) return;
      event.preventDefault();
      area.classList.add("text-asset-drop-target");
      event.dataTransfer.dropEffect = "copy";
    });
    area.addEventListener("dragleave", () => area.classList.remove("text-asset-drop-target"));
    area.addEventListener("drop", event => {
      area.classList.remove("text-asset-drop-target");
      const raw = event.dataTransfer.getData("application/x-lingframe-text-asset");
      if (!raw) return;
      event.preventDefault();
      try {
        const payload = JSON.parse(raw);
        const asset = assetById(workspace, payload.assetId);
        if (!asset || asset.projectId !== currentProjectId(workspace)) return toast("只能引用当前项目的文本素材", true);
        insertPreview(workspace, asset);
      } catch (error) { toast(String(error.message || error), true); }
    });
  }

  async function enhance(workspace) {
    const host = workspace.querySelector('[data-text-assist-body="assets"]');
    if (!host || workspace.dataset.textAssetsReady === "1") return;
    workspace.dataset.textAssetsReady = "1";
    workspace._textAssetState = {search:"", source:"all", assets:[], loading:false};
    bindDrop(workspace);
    await load(workspace);
  }

  function scan() { document.querySelectorAll('.text-workspace[data-text-layout-ready="1"]').forEach(workspace => enhance(workspace)); }
  function refreshActive() {
    if (document.querySelector(".nav.active")?.dataset.page !== "text") return;
    document.querySelectorAll('.text-workspace[data-text-assets-ready="1"]').forEach(workspace => load(workspace));
  }
  new MutationObserver(scan).observe(document.body, {childList:true, subtree:true});
  window.addEventListener("focus", refreshActive);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshActive(); });
  setInterval(refreshActive, 8000);
  scan();
})();
