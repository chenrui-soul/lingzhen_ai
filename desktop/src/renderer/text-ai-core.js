(function (root, factory) {
  const value = factory();
  if (typeof module === "object" && module.exports) module.exports = value;
  if (root) root.lingframeTextAiCore = value;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const VERSION = 1;
  const STORAGE_PREFIX = "lingframe.textAiBatchC.v1";
  const SENSITIVE = /(?:api.?key|authorization|cookie|token|secret|password|credential|header|base.?url|endpoint)/i;
  const ACTIONS = Object.freeze({
    continue: {label:"续写", instruction:"延续原文语气、人物关系和叙事节奏继续创作。"},
    polish: {label:"润色", instruction:"优化表达、节奏和可读性，保留原意和事实。"},
    rewrite: {label:"改写", instruction:"在保留核心信息的前提下重新组织语言和结构。"},
    expand: {label:"扩写", instruction:"补充必要细节、动作、情绪和场景信息，避免无意义重复。"},
    shorten: {label:"精简", instruction:"删除重复和空泛表达，保留关键信息。"},
    script: {label:"转剧本", instruction:"转换为可拍摄的剧本格式，明确场景、人物、动作和对白。"},
    storyboard: {label:"转分镜", instruction:"转换为逐镜头分镜描述，包含景别、画面、动作和镜头意图。"},
    prompt: {label:"转提示词", instruction:"整理为清晰、可复用的生成提示词，不虚构未提供的约束。"}
  });

  const clone = value => JSON.parse(JSON.stringify(value ?? null));
  const text = (value, max = 12000) => String(value ?? "").slice(0, max);
  const id = prefix => `${prefix || "text-ai"}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const modelKey = model => `${model?.providerId || ""}::${model?.modelId || model?.id || ""}`;
  const storageKey = tenantId => `${STORAGE_PREFIX}.${encodeURIComponent(String(tenantId || "local"))}`;

  function flattenTextModels(providers) {
    const result = [];
    for (const provider of Array.isArray(providers) ? providers : []) {
      if (!provider || provider.enabled === false) continue;
      for (const model of Array.isArray(provider.models) ? provider.models : []) {
        if (!model || model.enabled === false || model.hidden === true || model.capabilities?.type !== "text") continue;
        result.push({
          providerId:String(provider.id || ""), providerName:String(provider.name || provider.id || "模型厂商"),
          modelId:String(model.id || ""), modelName:String(model.displayName || model.id || "文本模型"),
          parameters:clone(model.parameters || {}), capabilities:clone(model.capabilities || {}),
          providerStatus:String(provider.status || ""), providerEnabled:provider.enabled !== false
        });
      }
    }
    return result;
  }

  function parameterDefinitions(model) {
    const raw = model?.parameters && typeof model.parameters === "object" ? model.parameters : {};
    const definitions = [];
    for (const [key, source] of Object.entries(raw)) {
      if (!key || SENSITIVE.test(key)) continue;
      const descriptor = source && typeof source === "object" && !Array.isArray(source) ? source : {default:source};
      const fallback = descriptor.default ?? descriptor.value ?? (typeof source === "object" ? "" : source);
      const options = Array.isArray(descriptor.options) ? descriptor.options.filter(item => ["string","number","boolean"].includes(typeof item)).slice(0, 30) : [];
      const type = options.length ? "select" : typeof fallback === "boolean" ? "boolean" : typeof fallback === "number" || descriptor.type === "number" || descriptor.type === "integer" ? "number" : "text";
      definitions.push({
        key:text(key,80), label:text(descriptor.label || descriptor.title || key,80), type,
        default:fallback, min:Number.isFinite(Number(descriptor.min)) ? Number(descriptor.min) : undefined,
        max:Number.isFinite(Number(descriptor.max)) ? Number(descriptor.max) : undefined,
        step:Number.isFinite(Number(descriptor.step)) ? Number(descriptor.step) : type === "number" ? 0.1 : undefined,
        options
      });
    }
    return definitions.slice(0, 24);
  }

  function sanitizeParameters(model, input) {
    const supplied = input && typeof input === "object" ? input : {};
    const output = {};
    for (const definition of parameterDefinitions(model)) {
      let value = supplied[definition.key];
      if (value === undefined) value = definition.default;
      if (definition.type === "number") {
        value = Number(value);
        if (!Number.isFinite(value)) continue;
        if (definition.min !== undefined) value = Math.max(definition.min, value);
        if (definition.max !== undefined) value = Math.min(definition.max, value);
      } else if (definition.type === "boolean") value = value === true || value === "true";
      else if (definition.type === "select") {
        if (!definition.options.some(option => String(option) === String(value))) value = definition.default;
      } else value = text(value, 500);
      output[definition.key] = value;
    }
    return output;
  }

  function sanitizePreset(input) {
    const source = input && typeof input === "object" ? input : {};
    const parameters = {};
    for (const [key, value] of Object.entries(source.parameters && typeof source.parameters === "object" ? source.parameters : {})) {
      if (!key || SENSITIVE.test(key) || !["string","number","boolean"].includes(typeof value)) continue;
      parameters[text(key,80)] = typeof value === "string" ? text(value,500) : value;
    }
    return {
      id:text(source.id || id("preset"),100), name:text(source.name || "文本预设",80),
      scope:source.scope === "project" ? "project" : "personal", projectId:text(source.projectId,100),
      providerId:text(source.providerId,180), modelId:text(source.modelId,180), parameters,
      isDefault:source.isDefault === true, createdAt:text(source.createdAt || new Date().toISOString(),100),
      updatedAt:new Date().toISOString()
    };
  }

  function resolveRange(content, selectionStart, selectionEnd, scope) {
    const value = String(content || "");
    let start = Math.max(0, Math.min(value.length, Number(selectionStart) || 0));
    let end = Math.max(start, Math.min(value.length, Number(selectionEnd) || start));
    if (scope === "document") return {start:0,end:value.length,text:value};
    if (scope === "selection" && end > start) return {start,end,text:value.slice(start,end)};
    const anchor = start;
    const beforeBreak = value.lastIndexOf("\n", Math.max(0, anchor - 1));
    const afterBreak = value.indexOf("\n", anchor);
    start = beforeBreak < 0 ? 0 : beforeBreak + 1;
    end = afterBreak < 0 ? value.length : afterBreak;
    const paragraph = value.slice(start,end).trim();
    if (paragraph) {
      const leftTrim = value.slice(start,end).search(/\S/);
      const rightTrim = value.slice(start,end).match(/\s*$/)?.[0]?.length || 0;
      start += Math.max(0,leftTrim); end -= rightTrim;
      return {start,end,text:value.slice(start,end)};
    }
    return {start:0,end:value.length,text:value};
  }

  function buildPrompt(input) {
    const action = ACTIONS[input?.action] || ACTIONS.rewrite;
    const references = Array.isArray(input?.assetNames) && input.assetNames.length ? `\n明确引用素材：${input.assetNames.map(item=>text(item,120)).join("、")}` : "";
    const requirement = text(input?.instruction,1000).trim();
    return [
      `你是灵帧AI文本创作助手。任务：${action.label}。`, action.instruction,
      `文档：${text(input?.documentTitle || "未命名文档",160)}`,
      requirement ? `补充要求：${requirement}` : "",
      references,
      "只输出可供用户审阅的候选文本，不解释过程，不声明已经修改原文。",
      "待处理原文：", text(input?.sourceText,12000)
    ].filter(Boolean).join("\n");
  }

  function buildEnvelope(input) {
    const range = input?.range || {start:0,end:0,text:""};
    const action = ACTIONS[input?.action] ? input.action : "rewrite";
    const now = new Date().toISOString();
    return {
      version:VERSION, envelopeId:id("envelope"), clientRequestId:id("text-request"), taskId:"",
      projectId:text(input?.projectId,100), conversationId:text(input?.conversationId,180), documentId:text(input?.documentId || input?.conversationId,180),
      documentTitle:text(input?.documentTitle,160), action, actionLabel:ACTIONS[action].label,
      scope:["selection","paragraph","document"].includes(input?.scope) ? input.scope : "paragraph",
      sourceStart:Math.max(0,Number(range.start)||0), sourceEnd:Math.max(0,Number(range.end)||0), sourceText:text(range.text,12000),
      sourceAssetIds:[...new Set((Array.isArray(input?.sourceAssetIds)?input.sourceAssetIds:[]).map(value=>text(value,100)).filter(Boolean))].slice(0,10),
      providerId:text(input?.providerId,180), modelId:text(input?.modelId,180), modelParameters:clone(input?.modelParameters || {}),
      prompt:text(input?.prompt,12000), state:"prepared", createdAt:now, updatedAt:now
    };
  }

  function validRoute(task, envelope) {
    if (!task || !envelope || task.id !== envelope.taskId) return false;
    if (String(task.projectId || "") !== String(envelope.projectId || "")) return false;
    if (String(task.creationType || "") !== "text" || String(task.creationSource || "") !== "text-workspace-ai") return false;
    return Boolean(envelope.conversationId && envelope.documentId === envelope.conversationId);
  }

  function candidateKey(candidate) { return `${candidate?.taskId || ""}::${candidate?.resultId || ""}::${candidate?.clientRequestId || ""}`; }
  function mergeCandidates(existing, incoming) {
    const map = new Map();
    for (const item of [...(Array.isArray(existing)?existing:[]), ...(Array.isArray(incoming)?incoming:[])]) {
      const key = candidateKey(item); if (!key.replace(/:/g,"")) continue;
      map.set(key,{...(map.get(key)||{}),...clone(item)});
    }
    return [...map.values()].sort((a,b)=>Date.parse(b.updatedAt||0)-Date.parse(a.updatedAt||0)).slice(0,100);
  }

  return {VERSION,STORAGE_PREFIX,ACTIONS,storageKey,modelKey,flattenTextModels,parameterDefinitions,sanitizeParameters,sanitizePreset,resolveRange,buildPrompt,buildEnvelope,validRoute,candidateKey,mergeCandidates};
});
