(function canvasCoreFactory(root, factory) {
  const api = factory(root);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.LingframeCanvasCore = api;
})(typeof window !== "undefined" ? window : globalThis, function buildCanvasCore(root) {
  "use strict";

  const VERSION = 4;
  const INPUT_SNAPSHOT_VERSION = 1;
  const INPUT_SNAPSHOT_STATES = new Set(["pending", "captured"]);
  const INPUT_TRANSFER_MODES = new Set(["auto", "text", "asset", "control"]);
  const GROUP_NODE_WIDTH = 248;
  const GROUP_NODE_HEIGHT = 150;
  const GROUP_PADDING = 40;
  const NODE_LIBRARY = [
    {type:"text", group:"输入", icon:"Ｔ", title:"文本输入", description:"输入故事、需求或引用文本素材", color:"#35d7ff", inputTypes:[], outputTypes:["text"], inputNode:true, assetTypes:["text"]},
    {type:"image-input", group:"输入", icon:"▧", title:"图片输入", description:"上传、拖入或引用项目图片", color:"#ff69b4", inputTypes:[], outputTypes:["image","asset"], inputNode:true, assetTypes:["image"]},
    {type:"video-input", group:"输入", icon:"▶", title:"视频输入", description:"上传、预览或引用项目视频", color:"#55e6b1", inputTypes:[], outputTypes:["video","asset"], inputNode:true, assetTypes:["video"]},
    {type:"audio-input", group:"输入", icon:"♫", title:"音频输入", description:"上传、试听或引用项目音频", color:"#ffb454", inputTypes:[], outputTypes:["audio","asset"], inputNode:true, assetTypes:["audio"]},
    {type:"prompt", group:"基础", icon:"✦", title:"提示词", description:"整理并增强模型提示词", color:"#7c6cff", inputTypes:["text","json"], outputTypes:["text"]},
    {type:"asset", group:"资产", icon:"▧", title:"素材管理", description:"选择、上传并管理当前项目的图片、视频、音频或文本素材", color:"#ff7eb6", inputTypes:[], outputTypes:["asset","image","video","audio","text"], inputNode:true, assetTypes:["image","video","audio","text"]},
    {type:"human-approval", group:"控制", icon:"✓", title:"人工确认", description:"暂停流程、记录确认并透传上游内容", color:"#ffb454", inputTypes:["text","image","video","audio","json","asset"], outputTypes:["control","text","image","video","audio","json","asset"]},
    {type:"condition", group:"控制", icon:"◇", title:"条件判断", description:"按条件选择后续执行路径", color:"#ffb454", inputTypes:["text","json","control"], outputTypes:["control","json"]},
    {type:"output", group:"基础", icon:"↗", title:"结果输出", description:"汇总流程文本、图片、视频和音频结果", color:"#5ee6b7", inputTypes:["text","image","video","audio","json","asset","control"], outputTypes:["text","image","video","audio","json"]},
    {type:"story-outline", group:"文本与剧本", icon:"纲", title:"故事大纲", description:"生成剧情结构、冲突和节奏", color:"#46d7ff", inputTypes:["text","json"], outputTypes:["text","json"], executable:true},
    {type:"adaptation-strategy", group:"文本与剧本", icon:"改", title:"改编策略", description:"把原始内容整理为短剧结构", color:"#4ac9ff", inputTypes:["text","json"], outputTypes:["text","json"], executable:true},
    {type:"episode-script", group:"文本与剧本", icon:"剧", title:"分集剧本", description:"生成分场、对白和动作说明", color:"#8d74ff", inputTypes:["text","json"], outputTypes:["text","json"], executable:true},
    {type:"script-agent", group:"Agent", icon:"AI", title:"编剧 Agent", description:"分析上游内容并补全剧本", color:"#8d74ff", inputTypes:["text","json"], outputTypes:["text","json"], executable:true},
    {type:"character", group:"资产", icon:"角", title:"角色设定", description:"维护角色外观、性格和一致性", color:"#ff78b7", inputTypes:["text","json","image","asset"], outputTypes:["text","json","image"], executable:true},
    {type:"scene", group:"资产", icon:"景", title:"场景设定", description:"维护地点、时间和视觉风格", color:"#ff9670", inputTypes:["text","json","image","asset"], outputTypes:["text","json","image"], executable:true},
    {type:"director-plan", group:"分镜", icon:"导", title:"导演规划", description:"规划镜头语言、节奏和调度", color:"#9d75ff", inputTypes:["text","json","image"], outputTypes:["text","json"], executable:true},
    {type:"storyboard-table", group:"分镜", icon:"表", title:"分镜表", description:"把剧本拆分为结构化镜头表", color:"#56b8ff", inputTypes:["text","json"], outputTypes:["text","json"], executable:true},
    {type:"storyboard-image", group:"分镜", icon:"帧", title:"分镜图", description:"生成镜头草图或关键帧", color:"#ff73bb", inputTypes:["text","json","image","asset"], outputTypes:["image","json"], executable:true, creationType:"image"},
    {type:"image-generation", group:"生成", icon:"图", title:"图片生成", description:"调用模型生成图片素材", color:"#ff69b4", inputTypes:["text","json","image","asset"], outputTypes:["image","asset"], executable:true, creationType:"image"},
    {type:"video-prompt", group:"生成", icon:"词", title:"视频提示词", description:"整理镜头、动作和运镜提示词", color:"#6bc7ff", inputTypes:["text","json","image"], outputTypes:["text","json"], executable:true},
    {type:"video-generation", group:"生成", icon:"▶", title:"视频生成", description:"通过豆包或模型网关生成视频", color:"#55e6b1", inputTypes:["text","json","image","asset"], outputTypes:["video","asset"], executable:true, creationType:"video"},
    {type:"audio-generation", group:"生成", icon:"♫", title:"音频生成", description:"生成配音、音效或音乐素材", color:"#ffb454", inputTypes:["text","json","audio","asset"], outputTypes:["audio","asset"], executable:true, creationType:"audio"},
    {type:"final-cut", group:"后期", icon:"剪", title:"成片整理", description:"汇总镜头并生成交付清单", color:"#55e6b1", inputTypes:["video","audio","text","json","asset"], outputTypes:["video","audio","json"], executable:true}
  ];
  const LIBRARY_MAP = Object.fromEntries(NODE_LIBRARY.map(item => [item.type, item]));
  const CUSTOM_NODE_PRESENTATION = {
    text:{group:"输入",title:"文本输入",description:"输入文字、指令或文本素材"},
    "image-input":{group:"输入",title:"图片输入",description:"输入图片素材"},
    "video-input":{group:"输入",title:"视频输入",description:"输入视频素材"},
    "audio-input":{group:"输入",title:"音频输入",description:"输入音频素材"},
    prompt:{group:"文本处理",title:"提示词处理",description:"整理、改写或增强文本提示词"},
    asset:{group:"输入与素材",title:"素材管理",description:"与项目资源库打通，选择图片、视频、音频或文本"},
    "human-approval":{group:"流程控制",title:"人工确认",description:"暂停流程并等待人工确认"},
    condition:{group:"流程控制",title:"条件分支",description:"根据条件选择后续路径"},
    output:{group:"输出",title:"流程输出",description:"汇总并输出流程结果"},
    "story-outline":{group:"文本处理",title:"文本生成",description:"根据输入生成结构化文本"},
    "adaptation-strategy":{group:"文本处理",title:"内容改写",description:"将输入内容整理为新的文本结构"},
    "episode-script":{group:"文本处理",title:"结构化文本",description:"生成分段、步骤或对白文本"},
    "script-agent":{group:"智能处理",title:"智能文本处理",description:"分析上游内容并生成文本结果"},
    character:{group:"内容处理",title:"主体设定",description:"整理人物、对象或主体特征"},
    scene:{group:"内容处理",title:"环境设定",description:"整理场景、空间或环境特征"},
    "director-plan":{group:"内容处理",title:"视觉规划",description:"规划画面、节奏和表现方式"},
    "storyboard-table":{group:"内容处理",title:"镜头规划",description:"将内容拆分为镜头或步骤"},
    "storyboard-image":{group:"生成",title:"参考图生成",description:"生成图片或视觉参考"},
    "image-generation":{group:"生成",title:"图片生成",description:"根据输入生成图片"},
    "video-prompt":{group:"文本处理",title:"视频提示词",description:"整理视频生成所需的文本描述"},
    "video-generation":{group:"生成",title:"视频生成",description:"根据输入生成视频"},
    "audio-generation":{group:"生成",title:"音频生成",description:"根据输入生成音频"},
    "final-cut":{group:"输出",title:"媒体整理",description:"汇总媒体结果和交付信息"}
  };

  function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
  function makeId(prefix = "id") {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return `${prefix}-${crypto.randomUUID().replaceAll("-", "")}`;
    return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
  function normalizeText(value, max = 12000) { return String(value || "").trim().slice(0, max); }
  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  function fingerprintValue(value) {
    const text = JSON.stringify(stableValue(value ?? null));
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }
  function nodeMeta(type) { return LIBRARY_MAP[type] || LIBRARY_MAP.text; }
  function nodePresentation(type, mode = "short-drama") {
    const base = nodeMeta(type);
    if (mode !== "blank" && mode !== "custom") return base;
    return {...base, ...(CUSTOM_NODE_PRESENTATION[type] || {})};
  }
  function nodeLibraryForMode(mode = "short-drama") { return NODE_LIBRARY.map(item => nodePresentation(item.type, mode)); }
  function makeNode(type, position = {}, overrides = {}) {
    const meta = nodeMeta(type);
    return {
      id: overrides.id || makeId("node"),
      type: "lingframe",
      position: {x:Number(position.x) || 0, y:Number(position.y) || 0},
      data: {
        kind: meta.type,
        title: overrides.title || meta.title,
        instruction: overrides.instruction || "",
        content: overrides.content || "",
        output: overrides.output || null,
        status: overrides.status || "idle",
        route: overrides.route || {channel:"model-gateway", providerId:"", modelId:"", accountId:"", accountName:""},
        refs: overrides.refs || {assetIds:[], assetRoles:{}, jobIds:[], conversationIds:[]},
        modelParameters: clone(overrides.modelParameters || {}),
        phase: overrides.phase || "",
        collapsed: overrides.collapsed === true,
        updatedAt: new Date().toISOString()
      }
    };
  }
  function makeEdge(source, target, overrides = {}) {
    const id = overrides.id || makeId("edge");
    const dataInput = {...(overrides.data && typeof overrides.data === "object" ? overrides.data : {})};
    for (const key of ["bindingId", "enabled", "order", "transferMode", "role", "inputSnapshot"]) if (overrides[key] !== undefined) dataInput[key] = overrides[key];
    const data = normalizeEdgeData(dataInput, id, Number(overrides.order) || 0);
    if (!data.inputSnapshot.sourceNodeId) data.inputSnapshot.sourceNodeId = String(source);
    return {
      id,
      source:String(source),
      target:String(target),
      type:"smoothstep",
      label:overrides.label || "",
      createdAt:overrides.createdAt || new Date().toISOString(),
      data
    };
  }
  const BUSINESS_OUTPUT_KEYS = ["content", "text", "prompt", "value", "description", "summary", "result"];
  const RUNTIME_METADATA_KEYS = new Set(["status", "progress", "runError", "updatedAt", "results", "activeResultId", "phase", "lastInputFingerprint", "completedAt", "startedAt"]);
  function businessText(value, depth = 0) {
    if (value === undefined || value === null || depth > 3) return "";
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return normalizeText(value, 30000);
    if (Array.isArray(value)) return value.map(item => businessText(item, depth + 1)).filter(Boolean).join("\n");
    if (typeof value !== "object") return "";
    const parts = [];
    for (const key of BUSINESS_OUTPUT_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      const text = businessText(value[key], depth + 1);
      if (text && !parts.includes(text)) parts.push(text);
    }
    return normalizeText(parts.join("\n"), 30000);
  }
  function outputFromNode(node) {
    const data = node?.data || {};
    const output = data.output;
    const content = businessText(output) || businessText(data.content) || businessText(data.instruction);
    const refs = clone(data.refs || {});
    const outputAssetIds = [output?.assetId, ...(Array.isArray(output?.assetIds) ? output.assetIds : [])].filter(Boolean).map(String);
    refs.assetIds = [...new Set([...(refs.assetIds || []).map(String), ...outputAssetIds])];
    return {
      sourceId:String(node?.id || ""),
      sourceKind:String(data.kind || node?.type || ""),
      sourceTitle:String(data.title || data.kind || "未命名节点"),
      status:String(data.status || "idle"),
      content:normalizeText(content, 30000),
      refs,
      output:clone(output ?? null),
      metadata: Object.fromEntries(Object.entries(data).filter(([key]) => RUNTIME_METADATA_KEYS.has(key)))
    };
  }
  function emptyInputSnapshot(sourceNodeId = "") {
    return {
      version:INPUT_SNAPSHOT_VERSION,
      importMode:"once",
      state:"pending",
      sourceNodeId:String(sourceNodeId || ""),
      sourceOutputFingerprint:"",
      importedAt:"",
      textBlocks:[],
      assetBindings:[],
      excludedKeys:[]
    };
  }
  function sanitizeSnapshotEvidence(evidence = {}) {
    const source = evidence && typeof evidence === "object" ? evidence : {};
    return {
      sourceNodeId:String(source.sourceNodeId || ""),
      sourceKind:String(source.sourceKind || ""),
      sourceOutputFingerprint:String(source.sourceOutputFingerprint || ""),
      outputKey:String(source.outputKey || ""),
      jobIds:[...new Set((Array.isArray(source.jobIds) ? source.jobIds : [source.taskId]).map(String).filter(Boolean))],
      conversationIds:[...new Set((Array.isArray(source.conversationIds) ? source.conversationIds : [source.conversationId]).map(String).filter(Boolean))],
      accountId:String(source.accountId || ""),
      providerId:String(source.providerId || ""),
      modelId:String(source.modelId || "")
    };
  }
  function normalizeInputSnapshot(snapshot = {}, options = {}) {
    const bindingId = String(options.bindingId || "binding");
    const sourceNodeId = String(options.sourceNodeId || snapshot?.sourceNodeId || "");
    const source = snapshot && typeof snapshot === "object" ? snapshot : {};
    const next = emptyInputSnapshot(sourceNodeId);
    next.state = INPUT_SNAPSHOT_STATES.has(source.state) ? source.state : "pending";
    next.sourceOutputFingerprint = String(source.sourceOutputFingerprint || "");
    next.importedAt = String(source.importedAt || "");
    next.excludedKeys = [...new Set((Array.isArray(source.excludedKeys) ? source.excludedKeys : []).map(String).filter(Boolean))];
    next.textBlocks = (Array.isArray(source.textBlocks) ? source.textBlocks : []).map((block, index) => ({
      id:String(block?.id || `${bindingId}:text:${index}`),
      text:normalizeText(block?.text, 30000),
      originalFingerprint:String(block?.originalFingerprint || fingerprintValue(normalizeText(block?.text, 30000))),
      enabled:block?.enabled !== false,
      edited:block?.edited === true
    })).filter(block => block.text);
    const seenAssets = new Set();
    next.assetBindings = (Array.isArray(source.assetBindings) ? source.assetBindings : []).map((binding, index) => {
      const assetId = String(binding?.assetId || "");
      if (!assetId || seenAssets.has(assetId)) return null;
      seenAssets.add(assetId);
      return {
        id:String(binding?.id || `${bindingId}:asset:${index}`),
        assetId,
        mediaType:String(binding?.mediaType || binding?.type || "asset"),
        role:String(binding?.role || ""),
        order:Number.isFinite(Number(binding?.order)) ? Number(binding.order) : index,
        enabled:binding?.enabled !== false,
        evidence:{...sanitizeSnapshotEvidence(binding?.evidence), sourceNodeId:sourceNodeId || String(binding?.evidence?.sourceNodeId || "")}
      };
    }).filter(Boolean);
    if (next.state === "captured" && !next.importedAt) next.importedAt = String(options.importedAt || "");
    return next;
  }
  function snapshotPayloadFromNode(node) {
    const data = node?.data || {};
    const kind = String(data.kind || node?.type || "text");
    const meta = nodeMeta(kind);
    const passthrough = meta.inputNode === true || kind === "prompt";
    const hasOutput = data.output !== undefined && data.output !== null;
    const ready = hasOutput || passthrough;
    const content = ready ? normalizeText(hasOutput ? businessText(data.output) : (businessText(data.content) || businessText(data.instruction)), 30000) : "";
    const refs = data.refs && typeof data.refs === "object" ? data.refs : {};
    const outputAssetIds = [data.output?.assetId, ...(Array.isArray(data.output?.assetIds) ? data.output.assetIds : [])].filter(Boolean).map(String);
    const assetIds = ready ? [...new Set([...(passthrough && Array.isArray(refs.assetIds) ? refs.assetIds : []), ...outputAssetIds].map(String).filter(Boolean))] : [];
    const jobIds = [...new Set((Array.isArray(refs.jobIds) ? refs.jobIds : []).map(String).filter(Boolean))];
    const conversationIds = [...new Set((Array.isArray(refs.conversationIds) ? refs.conversationIds : []).map(String).filter(Boolean))];
    return {
      ready,
      sourceNodeId:String(node?.id || ""),
      sourceKind:kind,
      outputType:String(data.output?.type || meta.outputTypes?.[0] || ""),
      content,
      assetIds,
      assetRoles:refs.assetRoles && typeof refs.assetRoles === "object" ? refs.assetRoles : {},
      jobIds,
      conversationIds
    };
  }
  function captureInputSnapshot(sourceNode, options = {}) {
    const bindingId = String(options.bindingId || options.edgeId || "binding");
    const payload = snapshotPayloadFromNode(sourceNode);
    const fingerprint = payload.ready ? fingerprintValue({content:payload.content, assetIds:payload.assetIds, outputType:payload.outputType}) : "";
    const evidence = {
      sourceNodeId:payload.sourceNodeId,
      sourceKind:payload.sourceKind,
      sourceOutputFingerprint:fingerprint,
      jobIds:payload.jobIds,
      conversationIds:payload.conversationIds
    };
    const snapshot = {
      version:INPUT_SNAPSHOT_VERSION,
      importMode:"once",
      state:payload.ready && (payload.content || payload.assetIds.length) ? "captured" : "pending",
      sourceNodeId:payload.sourceNodeId,
      sourceOutputFingerprint:fingerprint,
      importedAt:payload.ready && (payload.content || payload.assetIds.length) ? String(options.importedAt || new Date().toISOString()) : "",
      textBlocks:payload.content ? [{id:`${bindingId}:text:0`, text:payload.content, originalFingerprint:fingerprintValue(payload.content), enabled:true, edited:false}] : [],
      assetBindings:payload.assetIds.map((assetId, index) => ({
        id:`${bindingId}:asset:${index}`,
        assetId,
        mediaType:String(options.assetTypes?.[assetId] || "asset"),
        role:String(payload.assetRoles?.[assetId] || options.role || ""),
        order:index,
        enabled:true,
        evidence
      })),
      excludedKeys:[]
    };
    return normalizeInputSnapshot(snapshot, {bindingId, sourceNodeId:payload.sourceNodeId, importedAt:snapshot.importedAt});
  }
  function normalizeEdgeData(data = {}, edgeId = "", order = 0, sourceNode = null) {
    const source = data && typeof data === "object" ? data : {};
    const next = {
      bindingId:String(source.bindingId || edgeId || makeId("binding")),
      enabled:source.enabled !== false,
      order:Number.isFinite(Number(source.order)) ? Number(source.order) : Number(order) || 0,
      transferMode:INPUT_TRANSFER_MODES.has(source.transferMode) ? source.transferMode : "auto",
      role:String(source.role || ""),
      label:String(source.label || "")
    };
    next.inputSnapshot = source.inputSnapshot
      ? normalizeInputSnapshot(source.inputSnapshot, {bindingId:next.bindingId, sourceNodeId:sourceNode?.id || source.inputSnapshot?.sourceNodeId || ""})
      : (sourceNode ? captureInputSnapshot(sourceNode, {bindingId:next.bindingId, role:next.role}) : emptyInputSnapshot(sourceNode?.id || ""));
    return next;
  }
  function calculateGroupBounds(nodes = [], nodeIds = [], padding = GROUP_PADDING) {
    const selected = (nodes || []).filter(node => (nodeIds || []).map(String).includes(String(node?.id)));
    if (!selected.length) return {position:{x:0,y:0},size:{width:0,height:0}};
    const left = Math.min(...selected.map(node => Number(node.position?.x) || 0));
    const top = Math.min(...selected.map(node => Number(node.position?.y) || 0));
    const right = Math.max(...selected.map(node => (Number(node.position?.x) || 0) + GROUP_NODE_WIDTH));
    const bottom = Math.max(...selected.map(node => (Number(node.position?.y) || 0) + GROUP_NODE_HEIGHT));
    const inset = Math.max(0, Number(padding) || 0);
    return {position:{x:left-inset,y:top-inset},size:{width:right-left+inset*2,height:bottom-top+inset*2}};
  }
  function makeGroup(nodeIds = [], nodes = [], overrides = {}) {
    const ids = [...new Set((nodeIds || []).map(String).filter(Boolean))];
    const bounds = calculateGroupBounds(nodes, ids, overrides.padding);
    const hasPosition = Number.isFinite(Number(overrides.position?.x)) && Number.isFinite(Number(overrides.position?.y));
    const hasSize = Number(overrides.size?.width) > 0 && Number(overrides.size?.height) > 0;
    return {
      id:String(overrides.id || makeId("group")),
      title:normalizeText(overrides.title || "节点组", 80),
      color:String(overrides.color || "#7c6cff"),
      nodeIds:ids,
      position:hasPosition && hasSize ? {x:Number(overrides.position.x),y:Number(overrides.position.y)} : bounds.position,
      size:hasSize ? {width:Number(overrides.size.width),height:Number(overrides.size.height)} : bounds.size,
      collapsed:overrides.collapsed === true,
      createdAt:String(overrides.createdAt || new Date().toISOString()),
      updatedAt:String(overrides.updatedAt || new Date().toISOString())
    };
  }
  function normalizeGroups(groups = [], nodes = []) {
    const nodeIds = new Set((nodes || []).map(node => String(node?.id || "")));
    const claimed = new Set();
    const groupIds = new Set();
    return (Array.isArray(groups) ? groups : []).map((group, index) => {
      let id = String(group?.id || `group-legacy-${index}`);
      if (groupIds.has(id)) id = `${id}-${index}`;
      groupIds.add(id);
      const members = [...new Set((Array.isArray(group?.nodeIds) ? group.nodeIds : []).map(String))].filter(nodeId => nodeIds.has(nodeId) && !claimed.has(nodeId));
      members.forEach(nodeId => claimed.add(nodeId));
      if (!members.length) return null;
      return makeGroup(members, nodes, {...group, id});
    }).filter(Boolean);
  }
  function incomingMap(edges) {
    const map = new Map();
    for (const edge of edges || []) {
      if (!map.has(edge.target)) map.set(edge.target, []);
      map.get(edge.target).push(edge.source);
    }
    return map;
  }
  function outgoingMap(edges) {
    const map = new Map();
    for (const edge of edges || []) {
      if (!map.has(edge.source)) map.set(edge.source, []);
      map.get(edge.source).push(edge.target);
    }
    return map;
  }
  function collectUpstreamPayload(targetId, nodes, edges) {
    const nodeMap = new Map((nodes || []).map(node => [node.id, node]));
    const incoming = incomingMap(edges);
    const ordered = [];
    const visited = new Set();
    function walk(nodeId) {
      for (const sourceId of incoming.get(nodeId) || []) {
        if (visited.has(sourceId)) continue;
        visited.add(sourceId);
        walk(sourceId);
        const source = nodeMap.get(sourceId);
        if (source) ordered.push(outputFromNode(source));
      }
    }
    walk(String(targetId));
    const text = ordered.map(item => item.content).filter(Boolean).join("\n\n");
    const assetIds = [...new Set(ordered.flatMap(item => item.refs?.assetIds || []).map(String))];
    const jobIds = [...new Set(ordered.flatMap(item => item.refs?.jobIds || []).map(String))];
    return {items:ordered, text, assetIds, jobIds};
  }
  function resolveNodeExecutionInput(nodeId, nodes, edges) {
    if (root?.LingframeCanvasInputAdapter?.resolveExecutionEnvelope) return root.LingframeCanvasInputAdapter.resolveExecutionEnvelope(nodeId, nodes, edges);
    const node = (nodes || []).find(item => item.id === String(nodeId));
    if (!node) throw new Error("节点不存在");
    const nodeMap = new Map((nodes || []).map(item => [String(item.id), item]));
    const incoming = (edges || []).filter(edge => String(edge.target) === String(nodeId) && edge?.data?.enabled !== false)
      .sort((a, b) => Number(a?.data?.order ?? 0) - Number(b?.data?.order ?? 0));
    const directItems = incoming.map(edge => outputFromNode(nodeMap.get(String(edge.source)))).filter(item => item.sourceId);
    const upstream = {
      items: directItems,
      text: directItems.map(item => item.content).filter(Boolean).join("\n\n"),
      assetIds: [...new Set(directItems.flatMap(item => item.refs?.assetIds || []).map(String))],
      jobIds: [...new Set(directItems.flatMap(item => item.refs?.jobIds || []).map(String))]
    };
    const instruction = normalizeText(node.data?.instruction || node.data?.content || "", 12000);
    const prompt = [instruction, upstream.text ? `上游节点数据：\n${upstream.text}` : ""].filter(Boolean).join("\n\n");
    const localAssetIds = [...new Set((node.data?.refs?.assetIds || []).map(String))];
    return {nodeId:node.id, kind:node.data?.kind || "text", title:node.data?.title || "未命名节点", instruction, prompt, upstream, assetIds:[...new Set([...localAssetIds,...upstream.assetIds])], refs:clone(node.data?.refs || {}), modelParameters:clone(node.data?.modelParameters || {})};
  }
  function compatibleModels(providers, targetType = "") {
    return (providers || []).flatMap(provider => (provider.models || []).filter(model => model.enabled !== false && (!targetType || String(model.capabilities?.type || "text") === targetType)).map(model => ({providerId:provider.id, providerName:provider.name || provider.id, ...clone(model)})));
  }
  function parameterDefaults(model) {
    const capabilities = model?.capabilities || {};
    const defaults = clone(model?.parameters || {});
    if (defaults.mode === undefined && capabilities.modes?.length) defaults.mode = capabilities.modes[0];
    if (defaults.ratio === undefined && capabilities.ratios?.length) defaults.ratio = capabilities.ratios.includes("16:9") ? "16:9" : capabilities.ratios[0];
    if (defaults.duration === undefined && capabilities.durations?.length) defaults.duration = capabilities.durations[0];
    if (defaults.resolution === undefined && capabilities.resolutions?.length) defaults.resolution = capabilities.resolutions.at(-1);
    return defaults;
  }
  function mergeModelParameters(model, overrides = {}) { return {...parameterDefaults(model), ...clone(overrides || {})}; }
  function migrateDocument(document = {}) {
    const next = clone(document || {});
    next.schemaVersion = VERSION;
    next.nodes = Array.isArray(next.nodes) ? next.nodes : [];
    next.edges = Array.isArray(next.edges) ? next.edges : [];
    next.viewport = next.viewport || {x:80,y:80,zoom:1};
    for (const node of next.nodes) {
      node.data = node.data || {};
      node.data.refs = node.data.refs || {};
      node.data.refs.assetIds = Array.isArray(node.data.refs.assetIds) ? [...new Set(node.data.refs.assetIds.map(String))] : [];
      node.data.refs.assetRoles = node.data.refs.assetRoles && typeof node.data.refs.assetRoles === "object" ? node.data.refs.assetRoles : {};
      node.data.refs.jobIds = Array.isArray(node.data.refs.jobIds) ? node.data.refs.jobIds : [];
      node.data.refs.conversationIds = Array.isArray(node.data.refs.conversationIds) ? node.data.refs.conversationIds : [];
      node.data.modelParameters = node.data.modelParameters && typeof node.data.modelParameters === "object" ? node.data.modelParameters : {};
      node.data.results = Array.isArray(node.data.results) ? node.data.results.filter(item => item && typeof item === "object") : [];
      node.data.activeResultId = String(node.data.activeResultId || node.data.output?.assetId || "");
    }
    const nodeMap = new Map(next.nodes.map(node => [String(node?.id || ""), node]));
    next.edges = next.edges.map((edge, index) => {
      const migrated = edge && typeof edge === "object" ? edge : {};
      migrated.id = String(migrated.id || `edge-legacy-${index}`);
      migrated.source = String(migrated.source || "");
      migrated.target = String(migrated.target || "");
      migrated.type = String(migrated.type || "smoothstep");
      migrated.label = String(migrated.label || "");
      migrated.createdAt = String(migrated.createdAt || "");
      migrated.data = normalizeEdgeData(migrated.data || {}, migrated.id, index, nodeMap.get(migrated.source) || null);
      return migrated;
    });
    next.groups = normalizeGroups(next.groups, next.nodes);
    return next;
  }
  function canConnect(source, target, edges, nodes = []) {
    source = String(source || ""); target = String(target || "");
    if (!source || !target) return {ok:false, reason:"连接端点无效"};
    if (source === target) return {ok:false, reason:"节点不能连接自己"};
    if ((edges || []).some(edge => edge.source === source && edge.target === target)) return {ok:false, reason:"两个节点已经连接"};
    const map = outgoingMap(edges);
    const pending = [target]; const visited = new Set();
    while (pending.length) {
      const nodeId = pending.pop();
      if (nodeId === source) return {ok:false, reason:"该连接会形成循环依赖"};
      if (visited.has(nodeId)) continue;
      visited.add(nodeId); pending.push(...(map.get(nodeId) || []));
    }
    if (nodes.length) {
      const sourceNode = nodes.find(node => node.id === source);
      const targetNode = nodes.find(node => node.id === target);
      if (!sourceNode || !targetNode) return {ok:false, reason:"连接节点不存在"};
      const sourceTypes = nodeMeta(sourceNode.data?.kind).outputTypes || [];
      const targetTypes = nodeMeta(targetNode.data?.kind).inputTypes || [];
      if (sourceTypes.length && targetTypes.length && !sourceTypes.some(type => targetTypes.includes(type) || type === "asset" || targetTypes.includes("asset"))) {
        return {ok:false, reason:`数据类型不兼容：${sourceTypes.join("/")} → ${targetTypes.join("/")}`};
      }
    }
    return {ok:true, reason:""};
  }
  function topologicalOrder(nodes, edges, startId = "") {
    const nodeIds = new Set((nodes || []).map(node => node.id));
    let allowed = nodeIds;
    if (startId) {
      allowed = new Set(); const map = outgoingMap(edges); const pending = [String(startId)];
      while (pending.length) { const id = pending.shift(); if (allowed.has(id) || !nodeIds.has(id)) continue; allowed.add(id); pending.push(...(map.get(id) || [])); }
    }
    const indegree = new Map([...allowed].map(id => [id, 0]));
    for (const edge of edges || []) if (allowed.has(edge.source) && allowed.has(edge.target)) indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
    const map = outgoingMap(edges);
    const queue = [...allowed].filter(id => indegree.get(id) === 0);
    const positions = new Map((nodes || []).map(node => [node.id, node.position || {}]));
    queue.sort((a,b) => (positions.get(a)?.x || 0) - (positions.get(b)?.x || 0));
    const result = [];
    while (queue.length) {
      const id = queue.shift(); result.push(id);
      for (const target of map.get(id) || []) {
        if (!allowed.has(target)) continue;
        indegree.set(target, indegree.get(target) - 1);
        if (indegree.get(target) === 0) queue.push(target);
      }
    }
    if (result.length !== allowed.size) throw new Error("画布存在循环依赖，无法运行整套流程");
    return result;
  }
  function validateDocument(document) {
    const nodes = Array.isArray(document?.nodes) ? document.nodes : [];
    const edges = Array.isArray(document?.edges) ? document.edges : [];
    const groups = Array.isArray(document?.groups) ? document.groups : [];
    const errors = [];
    const ids = new Set();
    for (const node of nodes) {
      if (!node?.id || ids.has(node.id)) errors.push(`节点ID无效或重复：${node?.id || "空"}`);
      ids.add(node?.id);
      if (!LIBRARY_MAP[node?.data?.kind]) errors.push(`未知节点类型：${node?.data?.kind || "空"}`);
    }
    const edgeIds = new Set();
    for (const edge of edges) {
      if (!edge?.id || edgeIds.has(edge.id)) errors.push(`连线ID无效或重复：${edge?.id || "空"}`);
      edgeIds.add(edge?.id);
      if (!ids.has(edge.source) || !ids.has(edge.target)) errors.push(`连线端点不存在：${edge?.id}`);
      if (edge?.data) {
        const snapshot = edge.data.inputSnapshot;
        if (!INPUT_TRANSFER_MODES.has(edge.data.transferMode || "auto")) errors.push(`连线${edge?.id}传递方式无效`);
        if (!snapshot || Number(snapshot.version) !== INPUT_SNAPSHOT_VERSION || !INPUT_SNAPSHOT_STATES.has(snapshot.state)) errors.push(`连线${edge?.id}输入快照无效`);
        else if (snapshot.sourceNodeId && String(snapshot.sourceNodeId) !== String(edge.source)) errors.push(`连线${edge?.id}输入快照来源不一致`);
      }
      const result = canConnect(edge.source, edge.target, edges.filter(item => item.id !== edge.id), nodes);
      if (!result.ok) errors.push(`连线${edge?.id}无效：${result.reason}`);
    }
    const groupIds = new Set();
    const groupedNodes = new Set();
    for (const group of groups) {
      if (!group?.id || groupIds.has(group.id)) errors.push(`节点组ID无效或重复：${group?.id || "空"}`);
      groupIds.add(group?.id);
      const members = Array.isArray(group?.nodeIds) ? group.nodeIds : [];
      if (!members.length) errors.push(`节点组${group?.id || "空"}没有成员`);
      for (const nodeId of members) {
        if (!ids.has(nodeId)) errors.push(`节点组${group?.id || "空"}引用不存在节点：${nodeId}`);
        if (groupedNodes.has(nodeId)) errors.push(`节点${nodeId}同时属于多个节点组`);
        groupedNodes.add(nodeId);
      }
      if ((Number(group?.size?.width) || 0) <= 0 || (Number(group?.size?.height) || 0) <= 0) errors.push(`节点组${group?.id || "空"}尺寸无效`);
    }
    try { topologicalOrder(nodes, edges); } catch (error) { errors.push(error.message); }
    return {ok:errors.length === 0, errors};
  }
  function createTemplateDocument(templateId = "short-drama") {
    if (templateId === "blank") return {schemaVersion:VERSION, nodes:[], edges:[], groups:[], viewport:{x:80,y:80,zoom:1}, metadata:{templateId:"blank"}};
    const specs = [
      ["idea","text",60,180,"故事创意","写下故事主题、受众、风格和核心冲突。","策划"],
      ["outline","story-outline",360,90,"故事大纲","生成完整故事结构、关键冲突和结局。","策划"],
      ["script","episode-script",680,90,"分集剧本","根据故事大纲生成分场、对白和动作。","编剧"],
      ["character","character",680,300,"角色设定","整理主要角色的外观、性格与一致性要求。","资产"],
      ["director","director-plan",1000,80,"导演规划","规划镜头语言、节奏、调度和视觉风格。","导演"],
      ["storyboard","storyboard-table",1320,80,"分镜表","拆分镜号、景别、动作、对白、时长。","分镜"],
      ["image","image-generation",1320,310,"关键帧生成","根据角色和分镜生成关键帧参考图。","图像"],
      ["approval","human-approval",1640,180,"人工确认","确认角色、分镜和关键帧后继续。","审核"],
      ["videoPrompt","video-prompt",1940,80,"视频提示词","整合分镜与关键帧生成视频提示词。","视频"],
      ["video","video-generation",2260,80,"视频生成","选择豆包账号或模型网关生成视频。","视频"],
      ["final","final-cut",2580,80,"成片整理","汇总镜头、视频地址和交付信息。","后期"],
      ["output","output",2890,80,"结果输出","输出最终文本、图片、视频和任务记录。","交付"]
    ];
    const byKey = {};
    const nodes = specs.map(([key,type,x,y,title,instruction,phase]) => {
      const node = makeNode(type,{x,y},{title,instruction,phase}); byKey[key] = node.id; return node;
    });
    const links = [["idea","outline"],["outline","script"],["outline","character"],["script","director"],["character","director"],["director","storyboard"],["character","image"],["storyboard","image"],["storyboard","approval"],["image","approval"],["approval","videoPrompt"],["videoPrompt","video"],["video","final"],["final","output"]];
    const edges = links.map(([source,target]) => makeEdge(byKey[source], byKey[target]));
    return {schemaVersion:VERSION, nodes, edges, groups:[], viewport:{x:30,y:90,zoom:.58}, metadata:{templateId:"short-drama", title:"短剧生产模板 V1"}};
  }

  function findAvailableNodePosition(nodes = [], point = {}) {
    const origin={x:Math.max(0,Math.round(Number(point.x)||0)-124),y:Math.max(0,Math.round(Number(point.y)||0)-70)};
    for(let index=0;index<120;index+=1){
      const candidate={x:origin.x+(index%3)*280,y:origin.y+Math.floor(index/3)*180};
      const occupied=nodes.some(node=>Math.abs((Number(node?.position?.x)||0)-candidate.x)<268&&Math.abs((Number(node?.position?.y)||0)-candidate.y)<160);
      if(!occupied)return candidate;
    }
    return {x:origin.x,y:origin.y+Math.ceil(nodes.length/3)*180};
  }

  return {VERSION, INPUT_SNAPSHOT_VERSION, NODE_LIBRARY, LIBRARY_MAP, CUSTOM_NODE_PRESENTATION, clone, makeId, makeNode, makeEdge, nodeMeta, nodePresentation, nodeLibraryForMode, outputFromNode, collectUpstreamPayload, resolveNodeExecutionInput, emptyInputSnapshot, normalizeInputSnapshot, captureInputSnapshot, normalizeEdgeData, fingerprintValue, calculateGroupBounds, makeGroup, normalizeGroups, compatibleModels, parameterDefaults, mergeModelParameters, migrateDocument, canConnect, topologicalOrder, validateDocument, createTemplateDocument, findAvailableNodePosition};
});
