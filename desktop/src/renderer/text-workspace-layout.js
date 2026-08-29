(() => {
  "use strict";
  const api = window.lingframe;
  if (!api?.workbench) return;

  const DEFAULTS = Object.freeze({leftWidth: 270, rightWidth: 460, leftCollapsed: false, rightCollapsed: false});
  const LIMITS = Object.freeze({leftMin: 220, leftMax: 420, rightMin: 320, rightMax: 620});
  const STORAGE_PREFIX = "lingframe.textWorkspaceLayout.v1";
  const state = {tenantId: "local", tenantReady: false, identityPromise: null, bound: new WeakSet(), resizeBound: new WeakSet()};

  const clamp = (value, min, max) => Math.max(min, Math.min(max, Math.round(Number(value) || min)));
  const safePart = value => encodeURIComponent(String(value || "default"));
  const storageKey = projectId => `${STORAGE_PREFIX}.${safePart(state.tenantId)}.${safePart(projectId)}`;
  const readLayout = projectId => {
    const fallback = {...DEFAULTS};
    try {
      const value = JSON.parse(localStorage.getItem(storageKey(projectId)) || "null");
      if (!value || typeof value !== "object") return fallback;
      return {
        leftWidth: clamp(value.leftWidth, LIMITS.leftMin, LIMITS.leftMax),
        rightWidth: clamp(value.rightWidth, LIMITS.rightMin, LIMITS.rightMax),
        leftCollapsed: value.leftCollapsed === true,
        rightCollapsed: value.rightCollapsed === true
      };
    } catch {
      return fallback;
    }
  };
  const writeLayout = (projectId, layout) => {
    try { localStorage.setItem(storageKey(projectId), JSON.stringify(layout)); } catch {}
  };
  const projectIdOf = workspace => workspace.querySelector("[data-text-project-id]")?.dataset.textProjectId || "default";

  function layoutPanelMarkup() {
    return `<div class="text-assist-head"><div><b>AI 协作</b><small>围绕选中内容辅助创作</small></div><button class="text-layout-toggle" data-text-layout-toggle="right" aria-label="收起右侧协作栏" title="收起右侧协作栏">›</button></div><div class="text-assist-tabs" role="tablist"><button class="on" data-text-assist-tab="ai" role="tab">AI 协作</button><button data-text-assist-tab="assets" role="tab">文本素材库</button><button data-text-assist-tab="research" role="tab">资料研究</button></div><div class="text-assist-body" data-text-assist-body="ai"><section class="text-assist-card"><div class="text-assist-card-head"><b>模型与参数</b><button class="text-assist-chevron" data-text-assist-expand aria-expanded="false">展开</button></div><p>批次 C 将支持智能默认、自定义和已保存预设。当前先保留工作区位置。</p></section><section class="text-assist-card"><b>选中内容后开始协作</b><p>续写、润色、改写、转剧本和转分镜等结果会先进入候选区，不会直接覆盖正文。</p><div class="text-assist-placeholder">AI 候选区 · 待批次 C 接入</div></section></div><div class="text-assist-body is-hidden" data-text-assist-body="assets"><section class="text-assist-card"><b>文本素材库</b><p>这里将显示素材中心中属于当前项目的文本资料和历史片段。</p><div class="text-assist-placeholder">素材中心同源视图 · 批次 B 接入</div></section></div><div class="text-assist-body is-hidden" data-text-assist-body="research"><section class="text-assist-card"><b>资料研究</b><p>资料查找、摘要、分析和来源追踪将在后续批次接入。</p><div class="text-assist-placeholder">研究任务区 · 待批次 D 接入</div></section></div>`;
  }

  function applyLayout(workspace, layout) {
    const availableWidth = workspace.getBoundingClientRect().width || window.innerWidth;
    // The measured workspace is smaller than the outer Electron viewport
    // once navigation and chrome are accounted for. Collapse both secondary
    // rails before the editor becomes unusably narrow.
    const narrow = availableWidth <= 1190;
    const leftCollapsed = layout.leftCollapsed || narrow;
    const rightCollapsed = layout.rightCollapsed || narrow;
    workspace.style.setProperty("--text-left-width", `${leftCollapsed ? 46 : layout.leftWidth}px`);
    workspace.style.setProperty("--text-right-width", `${rightCollapsed ? 46 : layout.rightWidth}px`);
    workspace.classList.toggle("is-left-collapsed", leftCollapsed);
    workspace.classList.toggle("is-right-collapsed", rightCollapsed);
    workspace.classList.toggle("is-narrow", narrow);
    const leftToggle = workspace.querySelector('[data-text-layout-toggle="left"]');
    const rightToggle = workspace.querySelector('[data-text-layout-toggle="right"]');
    if (leftToggle) {
      leftToggle.textContent = leftCollapsed ? "›" : "‹";
      leftToggle.title = leftCollapsed ? "展开左侧目录栏" : "收起左侧目录栏";
      leftToggle.setAttribute("aria-label", leftToggle.title);
      leftToggle.setAttribute("aria-expanded", String(!leftCollapsed));
    }
    if (rightToggle) {
      rightToggle.textContent = rightCollapsed ? "‹" : "›";
      rightToggle.title = rightCollapsed ? "展开右侧协作栏" : "收起右侧协作栏";
      rightToggle.setAttribute("aria-label", rightToggle.title);
      rightToggle.setAttribute("aria-expanded", String(!rightCollapsed));
    }
  }

  function addLeftToggle(workspace) {
    const head = workspace.querySelector(".text-history-head");
    if (!head || head.querySelector('[data-text-layout-toggle="left"]')) return;
    const button = document.createElement("button");
    button.className = "text-layout-toggle";
    button.dataset.textLayoutToggle = "left";
    button.type = "button";
    button.textContent = "‹";
    button.title = "收起左侧目录栏";
    button.setAttribute("aria-label", button.title);
    head.appendChild(button);
  }

  function addStructure(workspace) {
    if (workspace.dataset.textLayoutReady === "1") return;
    const editor = workspace.querySelector(".text-editor");
    const history = workspace.querySelector(".text-history");
    if (!editor || !history) return;
    const projectId = projectIdOf(workspace);
    const layout = readLayout(projectId);
    addLeftToggle(workspace);
    const leftSplitter = document.createElement("div");
    leftSplitter.className = "text-layout-splitter text-layout-splitter-left";
    leftSplitter.dataset.textLayoutResize = "left";
    leftSplitter.setAttribute("role", "separator");
    leftSplitter.setAttribute("aria-label", "调整左侧目录栏宽度");
    leftSplitter.tabIndex = 0;
    const rightSplitter = document.createElement("div");
    rightSplitter.className = "text-layout-splitter text-layout-splitter-right";
    rightSplitter.dataset.textLayoutResize = "right";
    rightSplitter.setAttribute("role", "separator");
    rightSplitter.setAttribute("aria-label", "调整右侧协作栏宽度");
    rightSplitter.tabIndex = 0;
    const assistant = document.createElement("aside");
    assistant.className = "text-assist glass";
    assistant.dataset.textLayoutPanel = "right";
    assistant.innerHTML = layoutPanelMarkup();
    history.after(leftSplitter);
    editor.after(rightSplitter);
    workspace.appendChild(assistant);
    workspace.dataset.textLayoutReady = "1";
    workspace._textLayout = layout;
    workspace._textLayoutProjectId = projectId;
    bindInteractions(workspace);
    applyLayout(workspace, layout);
  }

  function persist(workspace) {
    writeLayout(workspace._textLayoutProjectId || projectIdOf(workspace), workspace._textLayout || DEFAULTS);
  }

  function toggle(workspace, side) {
    const layout = workspace._textLayout;
    if (!layout) return;
    layout[`${side}Collapsed`] = !layout[`${side}Collapsed`];
    persist(workspace);
    applyLayout(workspace, layout);
  }

  function reset(workspace, side) {
    const layout = workspace._textLayout;
    if (!layout) return;
    layout[`${side}Width`] = DEFAULTS[`${side}Width`];
    layout[`${side}Collapsed`] = false;
    persist(workspace);
    applyLayout(workspace, layout);
  }

  function bindResize(workspace, splitter) {
    if (state.resizeBound.has(splitter)) return;
    state.resizeBound.add(splitter);
    const side = splitter.dataset.textLayoutResize;
    const begin = event => {
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();
      const layout = workspace._textLayout;
      if (!layout) return;
      if (layout[`${side}Collapsed`]) {
        layout[`${side}Collapsed`] = false;
        applyLayout(workspace, layout);
      }
      const startX = event.clientX;
      const startWidth = layout[`${side}Width`];
      const move = current => {
        const delta = current.clientX - startX;
        layout[`${side}Width`] = side === "left"
          ? clamp(startWidth + delta, LIMITS.leftMin, LIMITS.leftMax)
          : clamp(startWidth - delta, LIMITS.rightMin, LIMITS.rightMax);
        applyLayout(workspace, layout);
      };
      const end = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", end);
        document.body.classList.remove("text-layout-resizing");
        persist(workspace);
      };
      document.body.classList.add("text-layout-resizing");
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", end, {once: true});
    };
    splitter.addEventListener("pointerdown", begin);
    splitter.addEventListener("dblclick", () => reset(workspace, side));
    splitter.addEventListener("keydown", event => {
      if (event.key === "Home") { event.preventDefault(); reset(workspace, side); return; }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const layout = workspace._textLayout;
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const delta = side === "left" ? direction * 10 : -direction * 10;
      layout[`${side}Width`] = side === "left"
        ? clamp(layout.leftWidth + delta, LIMITS.leftMin, LIMITS.leftMax)
        : clamp(layout.rightWidth + delta, LIMITS.rightMin, LIMITS.rightMax);
      applyLayout(workspace, layout);
      persist(workspace);
    });
  }

  function bindInteractions(workspace) {
    if (state.bound.has(workspace)) return;
    state.bound.add(workspace);
    workspace.querySelectorAll("[data-text-layout-toggle]").forEach(button => {
      button.addEventListener("click", () => toggle(workspace, button.dataset.textLayoutToggle));
    });
    workspace.querySelectorAll("[data-text-layout-resize]").forEach(splitter => bindResize(workspace, splitter));
    workspace.querySelectorAll("[data-text-assist-tab]").forEach(button => button.addEventListener("click", () => {
      const active = button.dataset.textAssistTab;
      workspace.querySelectorAll("[data-text-assist-tab]").forEach(item => item.classList.toggle("on", item === button));
      workspace.querySelectorAll("[data-text-assist-body]").forEach(body => body.classList.toggle("is-hidden", body.dataset.textAssistBody !== active));
    }));
    workspace.querySelector("[data-text-assist-expand]")?.addEventListener("click", event => {
      const button = event.currentTarget;
      const expanded = button.getAttribute("aria-expanded") === "true";
      button.setAttribute("aria-expanded", String(!expanded));
      button.textContent = expanded ? "展开" : "收起";
      workspace.querySelector(".text-assist-card:first-child")?.classList.toggle("is-expanded", !expanded);
    });
  }

  async function resolveTenant() {
    if (state.identityPromise) return state.identityPromise;
    state.identityPromise = Promise.resolve().then(() => api.identity?.status?.()).then(identity => {
      if (identity?.tenantId) state.tenantId = String(identity.tenantId);
      state.tenantReady = true;
      scan();
    }).catch(() => { state.tenantReady = true; scan(); });
    return state.identityPromise;
  }

  function scan() {
    if (!state.tenantReady) return;
    document.querySelectorAll(".text-workspace").forEach(addStructure);
  }

  new MutationObserver(scan).observe(document.body, {childList: true, subtree: true});
  window.addEventListener("resize", () => document.querySelectorAll(".text-workspace[data-text-layout-ready=\"1\"]").forEach(workspace => applyLayout(workspace, workspace._textLayout || DEFAULTS)));
  resolveTenant();
})();
