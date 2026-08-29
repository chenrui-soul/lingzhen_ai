(() => {
  "use strict";
  const core = window.lingframeTextQualityCore;
  if (!core) return;

  const state = {bound:new WeakSet(), ui:new Map(), activeWorkspace:null, focusBefore:null};
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[char]));
  const conversationId = workspace => workspace.querySelector("[data-text-conversation-id]")?.dataset.textConversationId || "";
  const projectId = workspace => workspace.querySelector("[data-text-project-id]")?.dataset.textProjectId || "";
  const currentText = workspace => workspace.querySelector("[data-text-content]")?.value || "";
  const currentTitle = workspace => workspace.querySelector("[data-text-title]")?.value || "未命名创作";
  const currentType = workspace => workspace.querySelector("[data-text-type]")?.value || "故事";
  const isActivePage = () => document.querySelector(".nav.active[data-page]")?.dataset.page === "text";
  const structureFor = workspace => window.lingframeTextStructureBatchE?.getDocument?.(conversationId(workspace)) || null;
  const formatDate = value => value ? new Date(value).toLocaleString("zh-CN", {month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", second:"2-digit"}) : "--";

  function uiFor(workspace) {
    const id = conversationId(workspace) || "empty";
    if (!state.ui.has(id)) state.ui.set(id, {report:null, categories:Object.keys(core.CATEGORY_META), filter:"all"});
    return state.ui.get(id);
  }

  function toast(message, error = false) {
    let node = document.querySelector(".pm-toast");
    if (!node) { node = document.createElement("div"); document.body.appendChild(node); }
    node.className = `pm-toast ${error ? "error" : ""}`;
    node.textContent = message;
    clearTimeout(node.timer);
    node.timer = setTimeout(() => node.remove(), 3600);
  }

  function currentFingerprint(workspace) { return core.fingerprint(currentText(workspace)); }
  function isStale(workspace, report = uiFor(workspace).report) { return Boolean(report && report.fingerprint !== currentFingerprint(workspace)); }

  function activate(workspace, options = {}) {
    if (!workspace || !conversationId(workspace)) return;
    state.activeWorkspace = workspace;
    state.focusBefore = document.activeElement;
    workspace.classList.add("text-quality-active");
    if (window.innerWidth <= 900) workspace.querySelector(".text-assist")?.classList.add("text-quality-overlay");
    else if (workspace.classList.contains("is-right-collapsed")) workspace.querySelector('[data-text-layout-toggle="right"]')?.click();
    workspace.querySelectorAll("[data-text-assist-tab]").forEach(item => {
      const on = item.dataset.textAssistTab === "quality";
      item.classList.toggle("on", on);
      item.setAttribute("aria-selected", String(on));
      item.tabIndex = on ? 0 : -1;
    });
    workspace.querySelectorAll("[data-text-assist-body]").forEach(body => body.classList.toggle("is-hidden", body.dataset.textAssistBody !== "quality"));
    render(workspace);
    if (options.run) runChecks(workspace);
    requestAnimationFrame(() => workspace.querySelector(options.focusExport ? "[data-text-quality-export-heading]" : "[data-text-quality-heading]")?.focus({preventScroll:true}));
  }

  function deactivateOverlay(workspace, restoreFocus = false) {
    workspace?.querySelector(".text-assist")?.classList.remove("text-quality-overlay");
    workspace?.classList.remove("text-quality-active");
    if (restoreFocus && state.focusBefore instanceof HTMLElement && document.contains(state.focusBefore)) state.focusBefore.focus({preventScroll:true});
  }

  function runChecks(workspace) {
    const ui = uiFor(workspace);
    try {
      ui.report = core.checkText({text:currentText(workspace), type:currentType(workspace), structure:structureFor(workspace), categories:ui.categories});
      ui.filter = "all";
      render(workspace);
      const count = ui.report.counts.total;
      toast(count ? `检查完成：发现 ${count} 条待人工核对项` : "检查完成：当前规则未发现待核对项");
    } catch (error) { toast(`检查失败：${error.message || error}`, true); }
  }

  function categoryControls(ui) {
    return Object.entries(core.CATEGORY_META).map(([key, meta]) => `<label class="text-quality-option"><input type="checkbox" data-text-quality-category="${key}" ${ui.categories.includes(key) ? "checked" : ""}><span><b>${esc(meta.label)}</b><small>${esc(meta.description)}</small></span></label>`).join("");
  }

  function summary(report, stale) {
    if (!report) return `<div class="text-quality-empty"><i>✓</i><b>尚未运行检查</b><span>选择检查范围后手动运行。检查不会自动改写正文。</span></div>`;
    const counts = report.counts;
    return `<div class="text-quality-summary ${stale ? "is-stale" : ""}" aria-live="polite"><div><strong>${counts.total}</strong><span>待核对项</span></div><div><strong>${counts.high}</strong><span>高优先级</span></div><div><strong>${counts.medium}</strong><span>中优先级</span></div><div><strong>${counts.low + counts.info}</strong><span>提示</span></div>${stale ? '<p>正文已变化，当前结果已过期，请重新检查。</p>' : `<p>检查于 ${esc(formatDate(report.checkedAt))} 完成 · ${report.textLength} 字</p>`}</div>`;
  }

  function issueMarkup(issue) {
    const meta = core.CATEGORY_META[issue.category];
    const location = issue.source === "text" && issue.line ? `第 ${issue.line} 行，第 ${issue.column} 列` : `结构记录${issue.structureRef?.title ? ` · ${esc(issue.structureRef.title)}` : ""}`;
    return `<button class="text-quality-issue severity-${issue.severity}" data-text-quality-issue="${esc(issue.id)}" type="button"><span class="text-quality-issue-top"><i>${esc(meta?.label || issue.category)}</i><em>${esc(location)}</em></span><b>${esc(issue.title)}</b><span>${esc(issue.message)}</span>${issue.excerpt ? `<q>${esc(issue.excerpt)}</q>` : ""}<small>建议：${esc(issue.suggestion || "人工核对上下文。")}</small></button>`;
  }

  function resultPanel(workspace, ui) {
    const report = ui.report;
    if (!report) return summary(null, false);
    const filters = [["all", "全部", report.counts.total], ...Object.entries(core.CATEGORY_META).map(([key, meta]) => [key, meta.label, report.counts[key]])];
    const issues = report.issues.filter(issue => ui.filter === "all" || issue.category === ui.filter);
    return `${summary(report, isStale(workspace, report))}<div class="text-quality-filters" role="tablist" aria-label="检查结果分类">${filters.map(([key, label, count]) => `<button type="button" class="${ui.filter === key ? "on" : ""}" data-text-quality-filter="${key}" role="tab" aria-selected="${ui.filter === key}">${esc(label)} <span>${count}</span></button>`).join("")}</div><div class="text-quality-issues">${issues.length ? issues.map(issueMarkup).join("") : '<div class="text-quality-empty compact"><i>✓</i><b>此分类没有待核对项</b><span>规则检查仅作辅助，发布前仍建议人工通读。</span></div>'}</div>`;
  }

  function exportButtons() {
    return Object.entries(core.EXPORT_FORMATS).map(([key, meta]) => `<button type="button" class="text-quality-export-card" data-text-quality-export="${key}"><i>${key === "json" ? "{}" : key === "storyboard" ? "▦" : key === "screenplay" ? "▤" : key === "markdown" ? "M↓" : "T↓"}</i><span><b>${esc(meta.label)}</b><small>${esc(meta.extension.toUpperCase())} · 本地导出</small></span></button>`).join("");
  }

  function render(workspace) {
    const host = workspace.querySelector('[data-text-assist-body="quality"]');
    if (!host || !conversationId(workspace)) return;
    const ui = uiFor(workspace);
    host.innerHTML = `<section class="text-assist-card text-quality-workbench"><header class="text-quality-head"><div tabindex="-1" data-text-quality-heading><b>质量检查</b><small>只定位和建议，不自动修改正文</small></div><button class="ghost text-quality-close" data-text-quality-close type="button">关闭</button></header><div class="text-quality-options">${categoryControls(ui)}</div><div class="text-quality-actions"><button class="primary" data-text-quality-run type="button">运行所选检查</button><small>快捷键 Ctrl+Alt+Q</small></div>${resultPanel(workspace, ui)}<hr><div class="text-quality-export-head" tabindex="-1" data-text-quality-export-heading><div><b>安全导出</b><small>TXT、Markdown、JSON、剧本和分镜表</small></div><span>${structureFor(workspace) ? "含当前会话结构数据" : "当前仅正文"}</span></div><div class="text-quality-export-grid">${exportButtons()}</div><p class="text-quality-disclaimer">导出只使用当前标题、类型、正文、项目/会话绑定和结构字段白名单，不读取 API Key、Cookie、认证头、服务地址或账号 Profile。快捷键 Ctrl+Alt+E。</p></section>`;
    bindPanel(workspace, host);
  }

  function locateIssue(workspace, issue) {
    if (!issue) return;
    if (issue.source === "text" && issue.start >= 0) {
      deactivateOverlay(workspace, false);
      const area = workspace.querySelector("[data-text-content]");
      if (!area) return;
      area.focus({preventScroll:false});
      area.setSelectionRange(issue.start, Math.max(issue.start + 1, issue.end));
      area.scrollIntoView({block:"center", behavior:"smooth"});
      toast(`已定位：${issue.title}`);
      return;
    }
    const ref = issue.structureRef;
    if (!ref) return toast("该问题来自结构汇总，请打开结构创作人工核对", true);
    deactivateOverlay(workspace, false);
    workspace.querySelector('[data-text-assist-tab="structure"]')?.click();
    setTimeout(() => {
      if (ref.kind === "timeline") {
        workspace.querySelector('[data-text-structure-mode="timeline"]')?.click();
        setTimeout(() => workspace.querySelector(`[data-text-structure-timeline-select="${CSS.escape(ref.id || "")}"]`)?.click(), 30);
      } else if (ref.kind === "character") {
        workspace.querySelector('[data-text-structure-mode="entities"]')?.click();
        setTimeout(() => {
          workspace.querySelector('[data-text-structure-entity-tab="characters"]')?.click();
          setTimeout(() => workspace.querySelector(`[data-text-structure-entity-select="${CSS.escape(ref.id || "")}"]`)?.click(), 30);
        }, 30);
      } else {
        workspace.querySelector('[data-text-structure-mode="outline"]')?.click();
        setTimeout(() => workspace.querySelector(`[data-text-structure-select-node="${CSS.escape(ref.id || "")}"]`)?.click(), 30);
      }
    }, 40);
    toast(`已转到结构记录：${ref.title || issue.title}`);
  }

  function exportInput(workspace) {
    return {title:currentTitle(workspace), type:currentType(workspace), content:currentText(workspace), projectId:projectId(workspace), conversationId:conversationId(workspace), structure:structureFor(workspace), includeStructure:true};
  }

  function downloadExport(workspace, format) {
    try {
      const result = core.buildExport(format, exportInput(workspace));
      const blob = new Blob([result.content], {type:result.mime});
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1200);
      toast(`已导出 ${result.label}：${result.filename}`);
    } catch (error) { toast(`导出失败：${error.message || error}`, true); }
  }

  function bindPanel(workspace, host) {
    const ui = uiFor(workspace);
    host.querySelector("[data-text-quality-run]")?.addEventListener("click", () => runChecks(workspace));
    host.querySelector("[data-text-quality-close]")?.addEventListener("click", () => deactivateOverlay(workspace, true));
    host.querySelectorAll("[data-text-quality-category]").forEach(input => input.addEventListener("change", () => {
      ui.categories = [...host.querySelectorAll("[data-text-quality-category]:checked")].map(item => item.dataset.textQualityCategory);
      if (!ui.categories.length) { input.checked = true; ui.categories = [input.dataset.textQualityCategory]; toast("至少保留一类检查", true); }
    }));
    host.querySelectorAll("[data-text-quality-filter]").forEach(button => button.addEventListener("click", () => { ui.filter = button.dataset.textQualityFilter; render(workspace); }));
    host.querySelectorAll("[data-text-quality-issue]").forEach(button => button.addEventListener("click", () => locateIssue(workspace, ui.report?.issues.find(issue => issue.id === button.dataset.textQualityIssue))));
    host.querySelectorAll("[data-text-quality-export]").forEach(button => button.addEventListener("click", () => downloadExport(workspace, button.dataset.textQualityExport)));
  }

  function cycleFocus(workspace, backwards) {
    const zones = [
      workspace.querySelector(".text-history [data-text-search]") || workspace.querySelector(".text-history button"),
      workspace.querySelector("[data-text-title]"),
      workspace.querySelector("[data-text-content]"),
      workspace.querySelector(".text-editor-footer button"),
      workspace.querySelector("[data-text-assist-tab].on") || workspace.querySelector("[data-text-assist-tab]")
    ].filter(Boolean);
    if (!zones.length) return;
    const activeIndex = zones.findIndex(node => node === document.activeElement || node.contains?.(document.activeElement));
    const next = activeIndex < 0 ? 0 : (activeIndex + (backwards ? -1 : 1) + zones.length) % zones.length;
    zones[next].focus({preventScroll:false});
  }

  function enhance(workspace) {
    if (!conversationId(workspace) || state.bound.has(workspace)) return;
    const tabs = workspace.querySelector(".text-assist-tabs");
    const assistant = workspace.querySelector(".text-assist");
    if (!tabs || !assistant) return;
    const tab = document.createElement("button");
    tab.type = "button";
    tab.dataset.textAssistTab = "quality";
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", "false");
    tab.textContent = "检查/导出";
    tabs.appendChild(tab);
    const body = document.createElement("div");
    body.className = "text-assist-body is-hidden";
    body.dataset.textAssistBody = "quality";
    assistant.appendChild(body);
    tab.addEventListener("click", () => activate(workspace));
    tabs.querySelectorAll('[data-text-assist-tab]:not([data-text-assist-tab="quality"])').forEach(button => button.addEventListener("click", () => deactivateOverlay(workspace, false)));
    workspace.addEventListener("click", event => {
      const exportButton = event.target.closest?.("[data-text-export]");
      if (!exportButton || !workspace.contains(exportButton)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      activate(workspace, {focusExport:true});
    }, true);
    workspace.addEventListener("keydown", event => {
      if (event.key !== "F6") return;
      event.preventDefault();
      cycleFocus(workspace, event.shiftKey);
    });
    workspace.querySelector("[data-text-content]")?.addEventListener("input", () => {
      const live = workspace.querySelector(".text-quality-summary");
      if (live && isStale(workspace)) {
        live.classList.add("is-stale");
        const note = live.querySelector("p");
        if (note) note.textContent = "正文已变化，当前结果已过期，请重新检查。";
      }
    });
    const editorExport = workspace.querySelector("[data-text-export]");
    if (editorExport) { editorExport.textContent = "检查/导出"; editorExport.title = "打开质量检查与多格式导出（Ctrl+Alt+E）"; }
    state.bound.add(workspace);
    render(workspace);
  }

  function scan() {
    if (!isActivePage()) return;
    document.querySelectorAll('.text-workspace[data-text-layout-ready="1"]').forEach(enhance);
  }

  document.addEventListener("keydown", event => {
    if (!isActivePage()) return;
    const workspace = document.querySelector('.text-workspace[data-text-layout-ready="1"]');
    if (!workspace || !conversationId(workspace)) return;
    const key = event.key.toLowerCase();
    if (event.ctrlKey && event.altKey && key === "q") { event.preventDefault(); activate(workspace, {run:true}); return; }
    if (event.ctrlKey && event.altKey && key === "e") { event.preventDefault(); activate(workspace, {focusExport:true}); return; }
    if (event.key === "Escape" && workspace.querySelector(".text-quality-overlay")) { event.preventDefault(); deactivateOverlay(workspace, true); }
  });
  window.addEventListener("resize", () => {
    document.querySelectorAll(".text-workspace").forEach(workspace => {
      if (window.innerWidth > 900) workspace.querySelector(".text-assist")?.classList.remove("text-quality-overlay");
    });
  });

  window.lingframeTextQualityBatchF = Object.freeze({
    ownsQualityAndExport:true,
    version:core.VERSION,
    categories:Object.keys(core.CATEGORY_META),
    formats:Object.keys(core.EXPORT_FORMATS),
    run(id) {
      const workspace = [...document.querySelectorAll(".text-workspace")].find(item => conversationId(item) === String(id || ""));
      if (!workspace) return null;
      runChecks(workspace);
      return core.clone(uiFor(workspace).report);
    },
    getReport(id) { return core.clone(state.ui.get(String(id || ""))?.report || null); },
    buildExport(format, input) { return core.buildExport(format, input); },
    open(options = {}) { const workspace = document.querySelector('.text-workspace[data-text-layout-ready="1"]'); if (workspace) activate(workspace, options); }
  });

  new MutationObserver(scan).observe(document.body, {childList:true, subtree:true});
  scan();
})();
