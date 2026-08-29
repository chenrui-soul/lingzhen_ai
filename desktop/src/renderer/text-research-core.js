(function (root, factory) {
  const value = factory();
  if (typeof module === "object" && module.exports) module.exports = value;
  if (root) root.lingframeTextResearchCore = value;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const VERSION = 1;
  const STORAGE_PREFIX = "lingframe.textResearchBatchD.v1";
  const MAX_SOURCES = 8;
  const MAX_EXCERPT_CHARS = 4000;
  const MAX_CONTEXT_CHARS = 9000;
  const ACTIONS = Object.freeze({
    discover: {label:"资料查找", minSources:0, instruction:"生成可执行的检索词、建议来源类型、交叉核验问题和查找步骤。不得声称已经联网检索或已经确认外部事实。"},
    summary: {label:"资料摘要", minSources:1, instruction:"基于所选摘录形成准确摘要，保留关键限定条件，并在相关句子后标注来源编号。"},
    keypoints: {label:"要点提取", minSources:1, instruction:"提取事实、观点、数据、时间和待核验事项，按主题分组并标注来源编号。"},
    compare: {label:"对比分析", minSources:2, instruction:"比较不同来源的一致点、差异、冲突、适用范围和证据缺口，每项结论标注来源编号。"},
    sources: {label:"来源清单", minSources:1, instruction:"整理来源名称、位置、摘录范围、可支持的观点、局限和后续核验建议。"}
  });

  const clone = value => JSON.parse(JSON.stringify(value ?? null));
  const text = (value, max = 12000) => String(value ?? "").slice(0, max);
  const id = prefix => `${prefix || "research"}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const storageKey = tenantId => `${STORAGE_PREFIX}.${encodeURIComponent(String(tenantId || "local"))}`;
  const hash = value => {
    let result = 2166136261;
    const source = String(value || "");
    for (let index = 0; index < source.length; index++) {
      result ^= source.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(16).padStart(8, "0");
  };

  function sanitizeSource(input) {
    const source = input && typeof input === "object" ? input : {};
    const excerpt = text(source.excerpt, MAX_EXCERPT_CHARS).trim();
    const start = Math.max(0, Number(source.excerptStart) || 0);
    const end = Math.max(start, Number(source.excerptEnd) || start + excerpt.length);
    const assetId = text(source.assetId, 100);
    return {
      sourceId:text(source.sourceId || id("source"), 100),
      assetId,
      projectId:text(source.projectId, 100),
      name:text(source.name || source.originalName || "未命名来源", 160),
      originalName:text(source.originalName, 260),
      source:text(source.source, 100),
      sourceLocation:text(source.sourceLocation || source.location || source.notes, 1000),
      excerpt,
      excerptStart:start,
      excerptEnd:end,
      fingerprint:text(source.fingerprint || hash(`${assetId}|${start}|${end}|${excerpt}`), 80),
      selectedAt:text(source.selectedAt || new Date().toISOString(), 100)
    };
  }

  function sourceKey(source) {
    const item = sanitizeSource(source);
    return `${item.assetId || item.sourceId}::${item.excerptStart}::${item.excerptEnd}::${item.fingerprint}`;
  }

  function normalizeSources(input) {
    const output = [];
    const seen = new Set();
    for (const raw of Array.isArray(input) ? input : []) {
      const source = sanitizeSource(raw);
      if (!source.assetId || !source.projectId || !source.excerpt) continue;
      const key = sourceKey(source);
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(source);
      if (output.length >= MAX_SOURCES) break;
    }
    return output;
  }

  const contextSize = sources => normalizeSources(sources).reduce((total, source) => total + source.excerpt.length, 0);

  function validateResearch(input) {
    const action = ACTIONS[input?.action] ? input.action : "discover";
    const query = text(input?.query, 1200).trim();
    const sources = normalizeSources(input?.sources);
    const errors = [];
    if (!query) errors.push("请输入研究问题或整理目标");
    if (sources.length < ACTIONS[action].minSources) errors.push(`${ACTIONS[action].label}至少需要 ${ACTIONS[action].minSources} 个已选摘录`);
    if (action === "compare" && new Set(sources.map(source => source.assetId)).size < 2) errors.push("对比分析必须来自至少两个不同素材");
    if (contextSize(sources) > MAX_CONTEXT_CHARS) errors.push(`所选上下文超过 ${MAX_CONTEXT_CHARS} 字，请缩小摘录范围`);
    return {ok:errors.length === 0, errors, action, query, sources, contextChars:contextSize(sources)};
  }

  function buildPrompt(input) {
    const validation = validateResearch(input);
    if (!validation.ok) throw new Error(validation.errors[0]);
    const action = ACTIONS[validation.action];
    const sourceBlocks = validation.sources.map((source, index) => [
      `[S${index + 1}] ${source.name}`,
      `位置：${source.sourceLocation || source.originalName || "素材中心"}`,
      `摘录范围：${source.excerptStart}-${source.excerptEnd}（${source.excerpt.length} 字）`,
      "摘录：",
      source.excerpt
    ].join("\n"));
    const noSourceRule = validation.action === "discover" && !sourceBlocks.length
      ? "本次没有提供来源摘录。你只能输出检索计划、关键词和核验框架，不得编造检索结果或外部事实。"
      : "只能依据下面明确选择的来源摘录作答；没有证据支持的内容必须标记为“待核验”。使用 [S1]、[S2] 形式标注来源。";
    return text([
      "你是灵帧AI资料研究助手。",
      `任务：${action.label}。${action.instruction}`,
      `研究问题：${validation.query}`,
      `已选上下文：${validation.contextChars} 字，${validation.sources.length} 个来源。`,
      noSourceRule,
      sourceBlocks.length ? "来源摘录：" : "",
      ...sourceBlocks,
      "输出应包含：结论或计划、来源对应关系、证据缺口、下一步建议。不要声明已经修改正文。"
    ].filter(Boolean).join("\n\n"), 12000);
  }

  function buildEnvelope(input) {
    const validation = validateResearch(input);
    if (!validation.ok) throw new Error(validation.errors[0]);
    const now = new Date().toISOString();
    return {
      version:VERSION,
      envelopeId:id("research-envelope"),
      clientRequestId:id("research-request"),
      taskId:"",
      projectId:text(input?.projectId, 100),
      conversationId:text(input?.conversationId, 180),
      documentId:text(input?.documentId || input?.conversationId, 180),
      documentTitle:text(input?.documentTitle, 160),
      action:validation.action,
      actionLabel:ACTIONS[validation.action].label,
      query:validation.query,
      sources:validation.sources,
      sourceAssetIds:[...new Set(validation.sources.map(source => source.assetId))],
      contextChars:validation.contextChars,
      providerId:text(input?.providerId, 180),
      modelId:text(input?.modelId, 180),
      modelParameters:clone(input?.modelParameters || {}),
      prompt:text(input?.prompt, 12000),
      state:"prepared",
      createdAt:now,
      updatedAt:now
    };
  }

  function validRoute(task, envelope) {
    if (!task || !envelope || task.id !== envelope.taskId) return false;
    if (String(task.projectId || "") !== String(envelope.projectId || "")) return false;
    if (String(task.creationType || "") !== "text" || String(task.creationSource || "") !== "text-workspace-research") return false;
    return Boolean(envelope.conversationId && envelope.documentId === envelope.conversationId);
  }

  function resultKey(result) {
    return `${result?.taskId || ""}::${result?.resultId || ""}::${result?.clientRequestId || ""}`;
  }

  function mergeResults(existing, incoming) {
    const map = new Map();
    for (const item of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]) {
      const key = resultKey(item);
      if (!key.replace(/:/g, "")) continue;
      map.set(key, {...(map.get(key) || {}), ...clone(item)});
    }
    return [...map.values()].sort((left, right) => Date.parse(right.updatedAt || 0) - Date.parse(left.updatedAt || 0)).slice(0, 100);
  }

  function sanitizeDraft(input) {
    const source = input && typeof input === "object" ? input : {};
    return {
      action:ACTIONS[source.action] ? source.action : "discover",
      query:text(source.query, 1200),
      modelKey:text(source.modelKey, 400),
      sources:normalizeSources(source.sources)
    };
  }

  return {
    VERSION,
    STORAGE_PREFIX,
    MAX_SOURCES,
    MAX_EXCERPT_CHARS,
    MAX_CONTEXT_CHARS,
    ACTIONS,
    storageKey,
    sanitizeSource,
    sourceKey,
    normalizeSources,
    contextSize,
    validateResearch,
    buildPrompt,
    buildEnvelope,
    validRoute,
    resultKey,
    mergeResults,
    sanitizeDraft
  };
});
