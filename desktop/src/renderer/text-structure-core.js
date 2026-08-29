(function (root, factory) {
  const value = factory();
  if (typeof module === "object" && module.exports) module.exports = value;
  if (root) root.lingframeTextStructureCore = value;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const VERSION = 1;
  const STORAGE_PREFIX = "lingframe.textStructureBatchE.v1";
  const LIMITS = Object.freeze({outline: 200, characters: 80, world: 120, timeline: 200, variables: 80, versions: 30});
  const now = () => new Date().toISOString();
  const uid = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const clone = value => JSON.parse(JSON.stringify(value));
  const clean = (value, max = 12000) => String(value ?? "").replace(/\u0000/g, "").slice(0, max);

  const field = (key, label, type = "text", extra = {}) => Object.freeze({key, label, type, maxLength: type === "textarea" ? 8000 : 500, ...extra});
  const commonNodeFields = Object.freeze([
    field("summary", "内容摘要", "textarea", {placeholder: "这一部分发生什么、解决什么问题"}),
    field("status", "创作状态", "select", {options: ["待规划", "草稿", "修订中", "已完成"]}),
    field("notes", "创作备注", "textarea", {placeholder: "伏笔、衔接、待核验事项或创作提醒"})
  ]);

  const TEMPLATES = Object.freeze({
    novel: Object.freeze({
      id: "novel", label: "小说", types: ["小说"], rootLabel: "章节", childLabel: "场景",
      fields: [
        field("genre", "题材/类型", "text", {placeholder: "奇幻、悬疑、都市、科幻……"}),
        field("theme", "核心主题", "textarea", {placeholder: "作品想讨论的核心命题"}),
        field("logline", "一句话梗概", "textarea", {placeholder: "主角 + 目标 + 阻力 + 风险"}),
        field("pov", "叙事视角", "select", {options: ["第一人称", "第三人称限知", "第三人称全知", "多视角"]}),
        field("tone", "语言与基调", "text", {placeholder: "克制、轻快、冷峻、诗意……"}),
        field("targetLength", "目标篇幅", "text", {placeholder: "例如 30 万字 / 80 章"})
      ],
      nodeFields: [...commonNodeFields, field("hook", "章节钩子", "textarea"), field("povCharacter", "视角人物"), field("location", "主要地点")]
    }),
    story: Object.freeze({
      id: "story", label: "故事", types: ["故事"], rootLabel: "段落", childLabel: "情节",
      fields: [
        field("audience", "目标读者"), field("theme", "主题", "textarea"), field("premise", "故事前提", "textarea"),
        field("conflict", "核心冲突", "textarea"), field("turningPoint", "关键转折", "textarea"), field("ending", "结局方向", "textarea")
      ],
      nodeFields: [...commonNodeFields, field("emotion", "情绪变化"), field("purpose", "叙事作用")]
    }),
    script: Object.freeze({
      id: "script", label: "剧本", types: ["剧本"], rootLabel: "场景", childLabel: "节拍",
      fields: [
        field("format", "剧本形式", "select", {options: ["电影", "短剧", "电视剧", "舞台剧", "短视频"]}),
        field("episode", "集数/幕数"), field("logline", "一句话梗概", "textarea"), field("theme", "主题", "textarea"),
        field("tone", "基调"), field("duration", "目标时长")
      ],
      nodeFields: [...commonNodeFields, field("sceneHeading", "场景标头", "text", {placeholder: "内/外 · 地点 · 日/夜"}), field("characters", "出场人物"), field("action", "动作与调度", "textarea"), field("dialogueGoal", "对白目标", "textarea")]
    }),
    storyboard: Object.freeze({
      id: "storyboard", label: "分镜", types: ["分镜"], rootLabel: "镜头", childLabel: "镜头变化",
      fields: [
        field("aspectRatio", "画面比例", "select", {options: ["自动", "3:4", "4:3", "9:16", "16:9", "1:1", "21:9"]}),
        field("style", "视觉风格"), field("totalDuration", "总时长"), field("fps", "帧率/节奏"), field("continuity", "连续性原则", "textarea")
      ],
      nodeFields: [...commonNodeFields, field("shotSize", "景别"), field("camera", "机位/运镜"), field("duration", "时长"), field("visual", "画面内容", "textarea"), field("dialogue", "对白/字幕", "textarea"), field("sound", "声音/音乐", "textarea"), field("prompt", "生成提示词", "textarea")]
    }),
    prompt: Object.freeze({
      id: "prompt", label: "提示词", types: ["提示词"], rootLabel: "提示块", childLabel: "变量方案",
      fields: [
        field("targetModel", "目标模型"), field("mediaType", "媒介", "select", {options: ["文本", "图片", "视频", "音频"]}),
        field("subject", "主体", "textarea"), field("scene", "场景", "textarea"), field("action", "动作", "textarea"),
        field("style", "风格", "textarea"), field("camera", "镜头与构图", "textarea"), field("lighting", "光线与色彩", "textarea"),
        field("negative", "负向约束", "textarea")
      ],
      nodeFields: [...commonNodeFields, field("prompt", "提示词正文", "textarea"), field("negative", "负向提示词", "textarea"), field("parameters", "参数说明", "textarea")]
    }),
    advertising: Object.freeze({
      id: "advertising", label: "广告文案", types: ["广告文案", "短视频文案"], rootLabel: "段落", childLabel: "镜头/卖点",
      fields: [
        field("product", "产品/服务"), field("audience", "目标人群"), field("channel", "投放渠道"), field("objective", "传播目标"),
        field("sellingPoints", "核心卖点", "textarea"), field("tone", "语气"), field("cta", "行动号召", "textarea"), field("constraints", "合规与禁用表达", "textarea")
      ],
      nodeFields: [...commonNodeFields, field("hook", "开头钩子", "textarea"), field("message", "核心表达", "textarea"), field("visual", "画面/动作", "textarea"), field("cta", "行动号召", "textarea")]
    }),
    worldbuilding: Object.freeze({
      id: "worldbuilding", label: "人物与世界观", types: ["人物设定", "世界观"], rootLabel: "设定条目", childLabel: "细节",
      fields: [field("premise", "设定总览", "textarea"), field("era", "时代/时间"), field("location", "主要地域"), field("rules", "核心规则", "textarea"), field("conflict", "设定冲突", "textarea")],
      nodeFields: [...commonNodeFields, field("category", "设定类别"), field("rule", "规则/限制", "textarea")]
    })
  });

  const templateList = () => Object.values(TEMPLATES).map(item => ({id: item.id, label: item.label, types: item.types.slice()}));
  const templateById = value => TEMPLATES[String(value || "")] || TEMPLATES.story;
  const resolveTemplate = type => Object.values(TEMPLATES).find(item => item.types.includes(String(type || ""))) || TEMPLATES.story;
  const defaultsFor = template => Object.fromEntries(template.fields.map(item => [item.key, item.type === "select" ? item.options?.[0] || "" : ""]));
  const normalizeFieldMap = (value, definitions) => Object.fromEntries(definitions.map(definition => [definition.key, clean(value?.[definition.key], definition.maxLength)]));

  function createDocument(context = {}) {
    const template = templateById(context.templateId || resolveTemplate(context.type).id);
    const timestamp = now();
    return {
      schemaVersion: VERSION,
      tenantId: clean(context.tenantId || "local", 100),
      projectId: clean(context.projectId, 100),
      conversationId: clean(context.conversationId, 180),
      type: clean(context.type || template.types[0] || "故事", 40),
      templateId: template.id,
      derivedFromType: context.derivedFromType !== false,
      fields: defaultsFor(template),
      outline: [], characters: [], world: [], timeline: [], variables: [], versions: [],
      createdAt: timestamp, updatedAt: timestamp
    };
  }

  const normalizeEntity = (item, schema, prefix) => {
    const result = {id: clean(item?.id, 100) || uid(prefix), createdAt: clean(item?.createdAt, 100) || now(), updatedAt: clean(item?.updatedAt, 100) || now()};
    for (const [key, max] of Object.entries(schema)) result[key] = clean(item?.[key], max);
    return result;
  };
  const CHARACTER_SCHEMA = Object.freeze({name: 200, role: 500, goal: 2000, conflict: 2000, appearance: 2000, voice: 2000, relationships: 3000, notes: 5000});
  const WORLD_SCHEMA = Object.freeze({name: 200, category: 200, rule: 3000, description: 5000, notes: 5000});
  const TIMELINE_SCHEMA = Object.freeze({label: 300, time: 300, location: 300, participants: 1000, event: 5000, consequence: 3000});
  const VARIABLE_SCHEMA = Object.freeze({name: 200, placeholder: 300, value: 3000, notes: 3000});

  function normalizeDocument(input, context = {}) {
    const source = input && typeof input === "object" ? input : {};
    if (source.projectId && context.projectId && String(source.projectId) !== String(context.projectId)) throw new Error("结构化文档与当前项目不一致");
    if (source.conversationId && context.conversationId && String(source.conversationId) !== String(context.conversationId)) throw new Error("结构化文档与当前文本会话不一致");
    if (source.tenantId && context.tenantId && String(source.tenantId) !== String(context.tenantId)) throw new Error("结构化文档与当前租户不一致");
    const base = createDocument({...context, ...source});
    const template = templateById(source.templateId || base.templateId);
    const outline = (Array.isArray(source.outline) ? source.outline : []).slice(0, LIMITS.outline).map(item => ({
      id: clean(item?.id, 100) || uid("outline"), parentId: clean(item?.parentId, 100), kind: clean(item?.kind, 80) || template.rootLabel,
      title: clean(item?.title, 300), fields: normalizeFieldMap(item?.fields || item, template.nodeFields),
      createdAt: clean(item?.createdAt, 100) || now(), updatedAt: clean(item?.updatedAt, 100) || now()
    }));
    const ids = new Set(outline.map(item => item.id));
    outline.forEach(item => { if (item.parentId && (!ids.has(item.parentId) || item.parentId === item.id)) item.parentId = ""; });
    return {
      ...base,
      schemaVersion: VERSION,
      type: clean(source.type || context.type || base.type, 40),
      templateId: template.id,
      derivedFromType: source.derivedFromType !== false,
      fields: normalizeFieldMap(source.fields || {}, template.fields),
      outline,
      characters: (Array.isArray(source.characters) ? source.characters : []).slice(0, LIMITS.characters).map(item => normalizeEntity(item, CHARACTER_SCHEMA, "character")),
      world: (Array.isArray(source.world) ? source.world : []).slice(0, LIMITS.world).map(item => normalizeEntity(item, WORLD_SCHEMA, "world")),
      timeline: (Array.isArray(source.timeline) ? source.timeline : []).slice(0, LIMITS.timeline).map(item => normalizeEntity(item, TIMELINE_SCHEMA, "timeline")),
      variables: (Array.isArray(source.variables) ? source.variables : []).slice(0, LIMITS.variables).map(item => normalizeEntity(item, VARIABLE_SCHEMA, "variable")),
      versions: (Array.isArray(source.versions) ? source.versions : []).slice(-LIMITS.versions).map(item => ({
        id: clean(item?.id, 100) || uid("structure-version"), label: clean(item?.label, 200) || "结构快照", createdAt: clean(item?.createdAt, 100) || now(),
        templateId: templateById(item?.templateId || template.id).id, type: clean(item?.type || source.type || base.type, 40),
        fields: item?.fields && typeof item.fields === "object" ? clone(item.fields) : {}, outline: Array.isArray(item?.outline) ? clone(item.outline) : [],
        characters: Array.isArray(item?.characters) ? clone(item.characters) : [], world: Array.isArray(item?.world) ? clone(item.world) : [],
        timeline: Array.isArray(item?.timeline) ? clone(item.timeline) : [], variables: Array.isArray(item?.variables) ? clone(item.variables) : []
      })),
      createdAt: clean(source.createdAt, 100) || base.createdAt,
      updatedAt: clean(source.updatedAt, 100) || base.updatedAt
    };
  }

  function meaningful(document) {
    const template = templateById(document?.templateId);
    const defaults = defaultsFor(template);
    const fieldsChanged = template.fields.some(definition => {
      const value = String(document?.fields?.[definition.key] || "").trim();
      return value && value !== String(defaults[definition.key] || "").trim();
    });
    return fieldsChanged || ["outline", "characters", "world", "timeline", "variables"].some(key => Array.isArray(document?.[key]) && document[key].length);
  }

  function touch(document) { document.updatedAt = now(); return document; }
  function addOutlineNode(document, input = {}) {
    if (document.outline.length >= LIMITS.outline) throw new Error(`结构节点最多 ${LIMITS.outline} 个`);
    const template = templateById(document.templateId);
    const parentId = clean(input.parentId, 100);
    if (parentId && !document.outline.some(item => item.id === parentId)) throw new Error("上级结构节点不存在");
    const timestamp = now();
    const node = {id: uid("outline"), parentId, kind: clean(input.kind, 80) || (parentId ? template.childLabel : template.rootLabel), title: clean(input.title, 300) || `新建${parentId ? template.childLabel : template.rootLabel}`, fields: normalizeFieldMap(input.fields || {}, template.nodeFields), createdAt: timestamp, updatedAt: timestamp};
    document.outline.push(node); touch(document); return node;
  }
  function updateOutlineNode(document, nodeId, patch = {}) {
    const node = document.outline.find(item => item.id === nodeId); if (!node) throw new Error("结构节点不存在");
    const template = templateById(document.templateId);
    if (patch.title !== undefined) node.title = clean(patch.title, 300);
    if (patch.kind !== undefined) node.kind = clean(patch.kind, 80);
    if (patch.fields !== undefined) node.fields = normalizeFieldMap({...node.fields, ...patch.fields}, template.nodeFields);
    node.updatedAt = now(); touch(document); return node;
  }
  function removeOutlineNode(document, nodeId) {
    const remove = new Set([nodeId]); let changed = true;
    while (changed) { changed = false; document.outline.forEach(item => { if (item.parentId && remove.has(item.parentId) && !remove.has(item.id)) { remove.add(item.id); changed = true; } }); }
    const before = document.outline.length; document.outline = document.outline.filter(item => !remove.has(item.id));
    if (before === document.outline.length) throw new Error("结构节点不存在"); touch(document); return [...remove];
  }
  function moveOutlineNode(document, nodeId, direction) {
    const node = document.outline.find(item => item.id === nodeId); if (!node) throw new Error("结构节点不存在");
    const siblings = document.outline.filter(item => item.parentId === node.parentId); const index = siblings.findIndex(item => item.id === nodeId); const next = index + (direction < 0 ? -1 : 1);
    if (next < 0 || next >= siblings.length) return false;
    const a = document.outline.indexOf(siblings[index]), b = document.outline.indexOf(siblings[next]); [document.outline[a], document.outline[b]] = [document.outline[b], document.outline[a]]; touch(document); return true;
  }

  const collectionSchema = name => ({characters: CHARACTER_SCHEMA, world: WORLD_SCHEMA, timeline: TIMELINE_SCHEMA, variables: VARIABLE_SCHEMA}[name]);
  function addEntity(document, collection, input = {}) {
    const schema = collectionSchema(collection); if (!schema) throw new Error("未知结构集合");
    if (document[collection].length >= LIMITS[collection]) throw new Error(`数量不能超过 ${LIMITS[collection]}`);
    const entity = normalizeEntity(input, schema, collection.replace(/s$/, "")); document[collection].push(entity); touch(document); return entity;
  }
  function updateEntity(document, collection, entityId, patch = {}) {
    const schema = collectionSchema(collection); const entity = document[collection]?.find(item => item.id === entityId); if (!schema || !entity) throw new Error("结构记录不存在");
    for (const [key, max] of Object.entries(schema)) if (patch[key] !== undefined) entity[key] = clean(patch[key], max);
    entity.updatedAt = now(); touch(document); return entity;
  }
  function removeEntity(document, collection, entityId) {
    if (!collectionSchema(collection)) throw new Error("未知结构集合"); const before = document[collection].length; document[collection] = document[collection].filter(item => item.id !== entityId); if (before === document[collection].length) throw new Error("结构记录不存在"); touch(document);
  }

  function versionPayload(document) {
    return {templateId: document.templateId, type: document.type, fields: clone(document.fields), outline: clone(document.outline), characters: clone(document.characters), world: clone(document.world), timeline: clone(document.timeline), variables: clone(document.variables)};
  }
  function createVersion(document, label = "结构快照") {
    document.versions.push({id: uid("structure-version"), label: clean(label, 200) || "结构快照", createdAt: now(), ...versionPayload(document)});
    document.versions = document.versions.slice(-LIMITS.versions); touch(document); return document.versions[document.versions.length - 1];
  }
  function restoreVersion(document, versionId) {
    const version = document.versions.find(item => item.id === versionId); if (!version) throw new Error("结构版本不存在");
    const restored = normalizeDocument({...document, ...versionPayload(version), versions: document.versions, updatedAt: now()}, document);
    return restored;
  }

  function switchTemplate(document, templateId) {
    const target = templateById(templateId); const current = templateById(document.templateId);
    if (target.id === current.id) return document;
    const nextFields = defaultsFor(target);
    for (const key of Object.keys(nextFields)) if (document.fields?.[key] !== undefined) nextFields[key] = clean(document.fields[key], target.fields.find(item => item.key === key)?.maxLength);
    document.templateId = target.id; document.fields = nextFields;
    document.outline = document.outline.map(item => ({...item, kind: item.kind === current.rootLabel ? target.rootLabel : item.kind === current.childLabel ? target.childLabel : item.kind, fields: normalizeFieldMap(item.fields || {}, target.nodeFields), updatedAt: now()}));
    document.derivedFromType = false; touch(document); return document;
  }

  function parseOutline(content, templateId) {
    const template = templateById(templateId); const result = []; let headingParent = "";
    for (const raw of String(content || "").split(/\r?\n/)) {
      const line = raw.trim(); if (!line) continue;
      const markdown = /^(#{1,6})\s+(.+)$/.exec(line);
      const chapter = /^(第[^\s]{1,16}[章幕集卷])(?:\s*[：:]?\s*)?(.*)$/.exec(line);
      const labelled = /^(章节|场景|镜头|场|幕|段落)\s*[\d一二三四五六七八九十百零-]*\s*[：:.、-]?\s*(.+)$/.exec(line);
      if (!markdown && !chapter && !labelled) continue;
      const level = markdown ? markdown[1].length : labelled && /^(场景|镜头|场)/.test(labelled[1]) ? 2 : 1;
      const title = clean(markdown?.[2] || [chapter?.[1], chapter?.[2]].filter(Boolean).join(" ") || labelled?.[2], 300);
      const node = {id: uid("outline"), parentId: level > 1 ? headingParent : "", kind: level > 1 ? template.childLabel : template.rootLabel, title, fields: normalizeFieldMap({}, template.nodeFields), createdAt: now(), updatedAt: now()};
      result.push(node); if (level === 1) headingParent = node.id; if (result.length >= 100) break;
    }
    return result;
  }

  function compileDocument(document, options = {}) {
    const template = templateById(document.templateId); const lines = [];
    lines.push(`# ${clean(options.title || "未命名创作", 300)}`, "", `> 结构模板：${template.label}`, "");
    const fieldLines = template.fields.map(definition => [definition.label, clean(document.fields?.[definition.key], definition.maxLength)]).filter(([, value]) => value.trim());
    if (fieldLines.length) { lines.push("## 项目设定", ""); fieldLines.forEach(([label, value]) => lines.push(`### ${label}`, value, "")); }
    if (document.outline.length) {
      lines.push("## 结构目录", "");
      const render = (parentId, level) => document.outline.filter(item => item.parentId === parentId).forEach(item => {
        lines.push(`${"#".repeat(Math.min(6, level + 2))} ${item.title || item.kind}`);
        const definitions = template.nodeFields;
        definitions.forEach(definition => { const value = clean(item.fields?.[definition.key], definition.maxLength); if (value.trim()) lines.push(`**${definition.label}：** ${value}`); });
        lines.push(""); render(item.id, level + 1);
      });
      render("", 1);
    }
    const sections = [
      ["人物卡", document.characters, CHARACTER_SCHEMA, item => item.name || "未命名人物"],
      ["世界观", document.world, WORLD_SCHEMA, item => item.name || "未命名设定"],
      ["时间线", document.timeline, TIMELINE_SCHEMA, item => item.label || item.time || "未命名事件"],
      ["提示词变量", document.variables, VARIABLE_SCHEMA, item => item.name || item.placeholder || "未命名变量"]
    ];
    sections.forEach(([label, items, schema, title]) => {
      if (!items.length) return; lines.push(`## ${label}`, ""); items.forEach(item => { lines.push(`### ${title(item)}`); Object.keys(schema).forEach(key => { const value = clean(item[key], schema[key]); if (value.trim() && value !== title(item)) lines.push(`- ${key}: ${value}`); }); lines.push(""); });
    });
    if (!meaningful(document)) lines.push("当前还没有保存结构化内容。", "");
    if (options.includePlainText && String(options.plainText || "").trim()) lines.push("## 原始正文", "", String(options.plainText));
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function exportDocument(document, options = {}) {
    const normalized = normalizeDocument(document, document);
    return {schemaVersion: VERSION, exportedAt: now(), title: clean(options.title, 300), projectId: normalized.projectId, conversationId: normalized.conversationId, type: normalized.type, templateId: normalized.templateId, templateLabel: templateById(normalized.templateId).label, fields: clone(normalized.fields), outline: clone(normalized.outline), characters: clone(normalized.characters), world: clone(normalized.world), timeline: clone(normalized.timeline), variables: clone(normalized.variables), plainText: options.includePlainText ? clean(options.plainText, 200000) : ""};
  }

  return Object.freeze({
    VERSION, STORAGE_PREFIX, LIMITS, TEMPLATES, templateList, templateById, resolveTemplate, createDocument, normalizeDocument, meaningful,
    addOutlineNode, updateOutlineNode, removeOutlineNode, moveOutlineNode, addEntity, updateEntity, removeEntity,
    createVersion, restoreVersion, switchTemplate, parseOutline, compileDocument, exportDocument, clone
  });
});
