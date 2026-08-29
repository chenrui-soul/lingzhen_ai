"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {pathToFileURL} = require("url");

const TYPE_EXTENSIONS = {
  image: new Set([".jpg", ".jpeg", ".png", ".webp"]),
  video: new Set([".mp4", ".mov", ".webm", ".m4v"]),
  audio: new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".opus"]),
  text: new Set([".txt", ".md", ".json", ".csv"]),
};
const TYPE_LIMITS = {image: 30 * 1024 * 1024, video: 1024 * 1024 * 1024, audio: 200 * 1024 * 1024, text: 10 * 1024 * 1024};
const TASK_STATES = new Set(["draft","queued","preparing","assigned","launching","checking_login","uploading","configuring","submitting","awaiting_confirmation","generating","downloading","verifying","awaiting_login","awaiting_verification","awaiting_quota","submission_unknown","paused","completed","failed","cancelled"]);
const MODEL_PROTOCOLS = new Set(["openai-compatible","openai-responses","anthropic-compatible","custom-json"]);
const DOUBAO_MODELS = new Set(["Seedance 2.0 Fast", "Seedance 2.0 Mini"]);
const DOUBAO_RATIOS = new Set(["自动", "3:4", "4:3", "9:16", "16:9", "1:1", "21:9"]);
const REFERENCE_ROLES = new Set(["character","scene","prop","costume","pose","style","first-frame","last-frame","other"]);
const VISUAL_RATIOS = [...DOUBAO_RATIOS];
const TERMINAL_TASK_STATES = new Set(["completed", "failed", "cancelled"]);
const RESULT_ITEM_STATES = new Set(["pending", "downloading", "imported", "failed", "ignored"]);

function id() { return crypto.randomUUID().replaceAll("-", ""); }
function now() { return new Date().toISOString(); }
function cleanName(value, fallback = "未命名") {
  return String(value || fallback).replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_").trim().slice(0, 120) || fallback;
}
function cleanText(value, max = 1000) { return String(value || "").trim().slice(0, max); }
function shanghaiParts(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {timeZone:"Asia/Shanghai", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", second:"2-digit", hourCycle:"h23"}).formatToParts(value);
  const result = {}; for (const item of parts) if (item.type !== "literal") result[item.type] = Number(item.value);
  return result;
}
function shanghaiDateKey(value = new Date()) { const item=shanghaiParts(value);return `${item.year}-${String(item.month).padStart(2,"0")}-${String(item.day).padStart(2,"0")}`; }
function nextShanghaiMidnight(value = new Date()) { const item=shanghaiParts(value);return new Date(Date.UTC(item.year,item.month-1,item.day+1,0,0,0)-8*60*60*1000).toISOString(); }
function normalizeDoubaoModel(value) { const model=cleanText(value,80);return DOUBAO_MODELS.has(model)?model:"Seedance 2.0 Mini"; }
function normalizeDoubaoRatio(value) { const ratio=cleanText(value,20);return DOUBAO_RATIOS.has(ratio)?ratio:"自动"; }
function normalizeDoubaoDuration(value) { const seconds=Math.max(4,Math.min(15,Number.parseInt(String(value||"10"),10)||10));return `${seconds}s`; }
function doubaoBatchKey(model, assetIds = []) { const ids=[...new Set((Array.isArray(assetIds)?assetIds:[]).map(value=>cleanText(value,100)).filter(Boolean))].sort();if(!ids.length)return "";return crypto.createHash("sha256").update(`${normalizeDoubaoModel(model)}\n${ids.join("\n")}`).digest("hex").slice(0,32); }
function normalizeExecutionCheckpoint(value) { if(!value||typeof value!=="object"||Array.isArray(value))return null;return {phase:cleanText(value.phase,80),action:cleanText(value.action,100),irreversible:value.irreversible===true,startedAt:cleanText(value.startedAt,100)||null,updatedAt:cleanText(value.updatedAt,100)||null,submissionStartedAt:cleanText(value.submissionStartedAt,100)||null,submissionConfirmedAt:cleanText(value.submissionConfirmedAt,100)||null}; }
function normalizeAccountCandidates(value) {
  const list=Array.isArray(value)?value:[];const seen=new Set();const output=[];
  for(const item of list){const accountId=cleanText(item?.id||item?.accountId,100);if(!accountId||seen.has(accountId))continue;seen.add(accountId);output.push({id:accountId,name:cleanText(item?.name||item?.accountName,100)||accountId,platform:"豆包"});if(output.length>=50)break;}
  return output;
}
function normalizeTaskReferenceAssets(value, assetIds = []) {
  const allowed=new Set((Array.isArray(assetIds)?assetIds:[]).map(String));const source=Array.isArray(value)?value:[];const byId=new Map();
  for(const item of source){const assetId=cleanText(item?.assetId||item?.id,100);if(!assetId||!allowed.has(assetId)||byId.has(assetId))continue;const role=REFERENCE_ROLES.has(String(item?.role||""))?String(item.role):"other";byId.set(assetId,{assetId,role,label:cleanText(item?.label||item?.name,120),description:cleanText(item?.description,500),order:Math.max(1,Math.min(10,Number(item?.order)||byId.size+1))});}
  return [...byId.values()].sort((a,b)=>a.order-b.order).slice(0,10);
}
function inside(root, candidate) {
  const base = path.resolve(root);
  const target = path.resolve(candidate);
  return target === base || target.startsWith(base + path.sep);
}
function mediaType(file) {
  const ext = path.extname(file).toLowerCase();
  return Object.entries(TYPE_EXTENSIONS).find(([, extensions]) => extensions.has(ext))?.[0] || null;
}
function mimeFor(type, ext) {
  return {
    ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".png":"image/png", ".webp":"image/webp",
    ".mp4":"video/mp4", ".mov":"video/quicktime", ".webm":"video/webm", ".m4v":"video/x-m4v",
    ".mp3":"audio/mpeg", ".wav":"audio/wav", ".m4a":"audio/mp4", ".aac":"audio/aac",
    ".ogg":"audio/ogg", ".flac":"audio/flac", ".opus":"audio/opus",
    ".txt":"text/plain; charset=utf-8", ".md":"text/markdown; charset=utf-8",
    ".json":"application/json; charset=utf-8", ".csv":"text/csv; charset=utf-8",
  }[ext] || (type === "image" ? "image/*" : type === "video" ? "video/*" : type === "audio" ? "audio/*" : "text/plain; charset=utf-8");
}

function normalizeTaskParameters(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  let serialized;
  try { serialized = JSON.stringify(value); } catch { throw new Error("模型参数必须是可序列化的对象"); }
  if (Buffer.byteLength(serialized, "utf8") > 32 * 1024) throw new Error("模型参数不能超过 32KB");
  const parsed = JSON.parse(serialized);
  for (const key of ["__proto__", "prototype", "constructor"]) delete parsed[key];
  return parsed;
}
function normalizeResultItems(value) {
  const source=Array.isArray(value)?value:[],output=[],seen=new Set();
  for(let index=0;index<source.length&&output.length<20;index+=1){
    const item=source[index]&&typeof source[index]==="object"?source[index]:{};
    const url=cleanText(item.url,8192),key=cleanText(item.key,180)||`${Number(item.index??index)}:${url}`;
    if(!key||seen.has(key))continue;seen.add(key);
    output.push({key,index:Math.max(0,Number(item.index??index)||0),url,type:cleanText(item.type,40),status:RESULT_ITEM_STATES.has(String(item.status||""))?String(item.status):"pending",assetId:cleanText(item.assetId,100),attempts:Math.max(0,Math.min(100,Number(item.attempts)||0)),lastError:cleanText(item.lastError,2000),checksum:cleanText(item.checksum,180),bytes:Math.max(0,Number(item.bytes)||0),required:item.required!==false,updatedAt:cleanText(item.updatedAt,100)||null});
  }
  return output.sort((a,b)=>a.index-b.index);
}
function inferCapabilities(modelId, supplied = {}) {
  const name=String(modelId||"").toLowerCase();let inferredType="text";
  if(/video|vidu|seedance|veo|kling|hailuo|runway|luma|wan\d|sora/.test(name))inferredType="video";
  else if(/image|imagegen|dall|flux|midjourney|stable.diffusion|sdxl|wanx|图像/.test(name))inferredType="image";
  else if(/audio|speech|tts|voice|music/.test(name))inferredType="audio";
  const allowed=new Set(["text","image","video","audio"]);const suppliedType=allowed.has(String(supplied?.type||""))?String(supplied.type):"";const type=suppliedType&&!(supplied?.source==="adapter"&&supplied?.confirmed!==true)?suppliedType:inferredType;
  const base={type,modes:type==="video"?["text-to-video","image-to-video"]:type==="image"?["text-to-image","image-to-image"]:[type],ratios:["image","video"].includes(type)?[...VISUAL_RATIOS]:[],durations:type==="video"?["5s","10s"]:[],resolutions:["image","video"].includes(type)?["720p","1080p"]:[],maxReferenceImages:["image","video"].includes(type)?1:0,source:"adapter",confirmed:false};
  const extra=supplied&&typeof supplied==="object"?{...supplied}:{};
  if(supplied?.source==="adapter"&&supplied?.confirmed!==true){
    for(const key of ["type","modes","ratios","durations","resolutions","maxReferenceImages"])delete extra[key];
  }
  const result={...base,...extra};
  if(["image","video"].includes(result.type))result.ratios=[...new Set([...VISUAL_RATIOS,...(Array.isArray(result.ratios)?result.ratios:[])])];
  return result;
}
function sanitizeModel(model,index=0) { return {id:cleanText(model.id,180),displayName:cleanText(model.displayName||model.id,180),enabled:model.enabled!==false,hidden:model.hidden===true,sortOrder:Number.isFinite(Number(model.sortOrder))?Number(model.sortOrder):index,parameters:model.parameters&&typeof model.parameters==="object"?JSON.parse(JSON.stringify(model.parameters)):{},capabilities:inferCapabilities(model.id,model.capabilities),detectedAt:model.detectedAt||null}; }

class WorkbenchDataBridge {
  constructor({tenantRootProvider, tenantIdProvider = null, changeListener = null, secretProvider = null, requestJson = null}) {
    if (typeof tenantRootProvider !== "function") throw new Error("tenantRootProvider 必须是函数");
    this.tenantRootProvider = tenantRootProvider;
    this.tenantIdProvider = typeof tenantIdProvider === "function" ? tenantIdProvider : () => path.basename(this.root());
    this.changeListener = typeof changeListener === "function" ? changeListener : null;
    this.secretProvider = typeof secretProvider === "function" ? secretProvider : () => "lingframe-desktop-v11-local-secret";
    this.requestJson = requestJson || this.defaultRequestJson.bind(this);
  }
  async defaultRequestJson(url, options = {}) {
    const target = String(url || '').trim();
    if (!/^https?:\/\//i.test(target)) throw new Error('请求地址无效');
    const response = await fetch(target, {...options, headers:{'Content-Type':'application/json', ...(options.headers || {})}});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `请求失败：${response.status}`);
    return data;
  }
  root() {
    const root = this.tenantRootProvider();
    if (!root) throw new Error("桌面身份尚未验证，无法访问项目与素材");
    const resolved = path.resolve(root);
    fs.mkdirSync(path.join(resolved, "database"), {recursive:true});
    fs.mkdirSync(path.join(resolved, "materials"), {recursive:true});
    return resolved;
  }
  file() { return path.join(this.root(), "database", "workbench-data-v1.json"); }
  load() {
    const file = this.file();
    let state;
    try { state = JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) {
      if (error.code !== "ENOENT") {
        try { fs.copyFileSync(file, `${file}.broken-${Date.now()}`); } catch {}
      }
      state = null;
    }
    if (!state || !Array.isArray(state.projects) || !Array.isArray(state.assets)) {
      const timestamp = now();
      const project = {id:id(), name:"默认项目", description:"未分类素材与创作内容", parentId:null, sortOrder:0, archivedAt:null, deletedAt:null, createdAt:timestamp, updatedAt:timestamp};
      state = {version:4, currentProjectId:project.id, projects:[project], assets:[], textConversations:[], tasks:[], modelProviders:[]};
      this.save(state);
    }
    if (!Array.isArray(state.textConversations)) state.textConversations = [];
    if (!Array.isArray(state.tasks)) state.tasks = [];
    if (!Array.isArray(state.modelProviders)) state.modelProviders = [];
    if (!state.doubaoQuotaBlocks || typeof state.doubaoQuotaBlocks !== "object" || Array.isArray(state.doubaoQuotaBlocks)) state.doubaoQuotaBlocks = {};
    if (!state.currentProjectId || !state.projects.some(item => item.id === state.currentProjectId && !item.deletedAt)) {
      state.currentProjectId = state.projects.find(item => !item.deletedAt)?.id || "";
    }
    return state;
  }
  save(state) {
    const file = this.file();
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(temporary, file);
    try { this.changeListener?.(this.cloudSnapshot(state)); } catch {}
  }
  setChangeListener(listener) { this.changeListener = typeof listener === "function" ? listener : null; }
  currentTenantId() { return String(this.tenantIdProvider() || ""); }
  cloudSnapshot(state = this.load()) {
    const strip = (value, key = "", depth = 0) => {
      if (depth > 12 || value === undefined) return undefined;
      const normalizedKey = String(key).replace(/[^A-Za-z0-9]/g, "").toLowerCase();
      if (["accesstoken","refreshtoken","authorization","apikey","secret","cookie","cookies","partition","profileroot","profilepath","databaseurl","credential","credentialref","headers","privateheaders","localpath","filepath","fileurl","resultvid","fallbackresultvid","resulturls","sourceurl","downloadurl"].includes(normalizedKey)) return undefined;
      if (value === null || typeof value === "boolean" || typeof value === "number") return value;
      if (typeof value === "string") {
        if (/^(?:file:\/\/|[A-Za-z]:[\\/]|\/(?:Users|home|var|tmp)\/)/i.test(value.trim())) return undefined;
        return value.length > 32000 ? value.slice(0, 32000) : value;
      }
      if (Array.isArray(value)) return value.slice(0, 10000).map((item) => strip(item, key, depth + 1)).filter((item) => item !== undefined);
      if (!value || typeof value !== "object") return undefined;
      const output = {};
      for (const [childKey, childValue] of Object.entries(value)) {
        const clean = strip(childValue, childKey, depth + 1);
        if (clean !== undefined) output[childKey] = clean;
      }
      return output;
    };
    return strip({
      version: 1,
      currentProjectId: state.currentProjectId || "",
      projects: state.projects || [],
      assets: state.assets || [],
      textConversations: state.textConversations || [],
      tasks: state.tasks || [],
      updatedAt: now(),
    });
  }
  bootstrap() {
    const state = this.load();
    this.clearExpiredDoubaoQuotaBlocks(state);
    return {currentProjectId:state.currentProjectId, projects:state.projects.map(item => ({...item})), assets:state.assets.map(item => this.publicAsset(item)), textConversations:state.textConversations.map(item => this.publicConversation(item)), tasks:state.tasks.map(item => this.publicTask(item)), doubaoQuotaBlocks:Object.values(state.doubaoQuotaBlocks).map(item=>({...item}))};
  }
  doubaoQuotaBlockKey(accountId, model = "") { return `${cleanText(accountId,100)}::${cleanText(model,100)||"video"}`; }
  clearExpiredDoubaoQuotaBlocks(state, at = new Date()) {
    const nowMs=at instanceof Date?at.getTime():new Date(at).getTime();let changed=false;
    for(const [blockKey,item] of Object.entries(state.doubaoQuotaBlocks||{})){const resetMs=Date.parse(item?.resetAt||"");if(!Number.isFinite(resetMs)||resetMs<=nowMs){delete state.doubaoQuotaBlocks[blockKey];changed=true;}}
    if(changed)this.save(state);return changed;
  }
  doubaoQuotaBlock(accountId, model = "", at = new Date()) { const state=this.load();this.clearExpiredDoubaoQuotaBlocks(state,at);const key=this.doubaoQuotaBlockKey(accountId,model);const item=state.doubaoQuotaBlocks[key];return item?{...item}:null; }
  markDoubaoQuotaExhausted(account={}, input={}) {
    const state=this.load();const accountId=cleanText(account.id||account.accountId,100);if(!accountId)throw new Error("额度熔断缺少豆包账号");const detectedAt=input.at?new Date(input.at):new Date();if(!Number.isFinite(detectedAt.getTime()))throw new Error("额度熔断时间无效");
    const model=cleanText(input.model||account.doubaoModel,100)||"Seedance 2.0 Mini";const item={accountId,accountName:cleanText(account.name||account.accountName,100)||accountId,model,status:"exhausted",scope:"video-model",reason:cleanText(input.reason||"豆包明确提示视频额度已用完",500),detectedAt:detectedAt.toISOString(),dateKey:shanghaiDateKey(detectedAt),resetAt:nextShanghaiMidnight(detectedAt)};
    state.doubaoQuotaBlocks[this.doubaoQuotaBlockKey(accountId,model)]=item;this.save(state);return {...item};
  }
  nextDoubaoQuotaReset(accountIds=[], model="", at=new Date()) { const state=this.load();this.clearExpiredDoubaoQuotaBlocks(state,at);const ids=new Set((Array.isArray(accountIds)?accountIds:[]).map(String));const normalizedModel=cleanText(model,100);const values=Object.values(state.doubaoQuotaBlocks).filter(item=>(!ids.size||ids.has(item.accountId))&&(!normalizedModel||item.model===normalizedModel)).map(item=>Date.parse(item.resetAt)).filter(Number.isFinite);return values.length?new Date(Math.min(...values)).toISOString():nextShanghaiMidnight(at); }
  project(state, projectId) { return state.projects.find(item => item.id === String(projectId || "")) || null; }
  asset(state, assetId) { return state.assets.find(item => item.id === String(assetId || "")) || null; }
  createProject(input = {}) {
    const state = this.load();
    const timestamp = now();
    const project = {id:id(), name:cleanName(input.name, "新项目"), description:cleanText(input.description), parentId:null, sortOrder:state.projects.length, archivedAt:null, deletedAt:null, createdAt:timestamp, updatedAt:timestamp};
    state.projects.unshift(project); state.currentProjectId = project.id; this.save(state); return {...project};
  }
  updateProject(projectId, input = {}) {
    const state = this.load(); const project = this.project(state, projectId);
    if (!project) throw new Error("项目不存在");
    if (input.name !== undefined) project.name = cleanName(input.name, project.name);
    if (input.description !== undefined) project.description = cleanText(input.description);
    if (input.archived !== undefined) project.archivedAt = input.archived ? now() : null;
    project.updatedAt = now(); this.save(state); return {...project};
  }
  setCurrentProject(projectId) {
    const state = this.load(); const project = this.project(state, projectId);
    if (!project || project.deletedAt || project.archivedAt) throw new Error("请选择有效的项目");
    state.currentProjectId = project.id; this.save(state); return {currentProjectId:project.id, project:{...project}};
  }
  deleteProject(projectId) {
    const state = this.load(); const project = this.project(state, projectId);
    if (!project) throw new Error("项目不存在");
    if (state.projects.filter(item => !item.deletedAt).length <= 1) throw new Error("至少保留一个项目");
    if (state.assets.some(item => item.projectId === project.id)) throw new Error("项目内仍有素材记录，请先移动素材；回收站素材也必须先恢复后移动");
    if (state.textConversations.some(item => item.projectId === project.id)) throw new Error("项目内仍有文本创作记录，不能删除项目");
    if (state.tasks.some(item => item.projectId === project.id)) throw new Error("项目内仍有任务记录，不能删除项目");
    project.deletedAt = now(); project.updatedAt = project.deletedAt;
    if (state.currentProjectId === project.id) state.currentProjectId = state.projects.find(item => item.id !== project.id && !item.deletedAt && !item.archivedAt)?.id || "";
    this.save(state); return {ok:true, trashed:project.name};
  }
  restoreProject(projectId) {
    const state = this.load(); const project = this.project(state, projectId);
    if (!project) throw new Error("项目不存在");
    project.deletedAt = null; project.updatedAt = now(); if (!state.currentProjectId) state.currentProjectId = project.id;
    this.save(state); return {...project};
  }
  listAssets(filters = {}) {
    const state = this.load();
    return state.assets.filter(item => (!filters.projectId || item.projectId === filters.projectId) && (!filters.type || item.type === filters.type)).map(item => this.publicAsset(item));
  }
  importAssets(input = {}) {
    const state = this.load(); const project = this.project(state, input.projectId || state.currentProjectId);
    if (!project || project.deletedAt || project.archivedAt) throw new Error("请选择有效的归属项目");
    const sourcePaths = [...new Set((Array.isArray(input.paths) ? input.paths : []).map(value => path.resolve(String(value || ""))).filter(Boolean))];
    if (!sourcePaths.length) return [];
    if (sourcePaths.length > 50) throw new Error("单次最多导入 50 个素材");
    const materialRoot = path.join(this.root(), "materials");
    const projectRoot = path.join(materialRoot, project.id); fs.mkdirSync(projectRoot, {recursive:true});
    const imported = [],dedupeKeys=Array.isArray(input.dedupeKeys)?input.dedupeKeys.map(value=>cleanText(value,180)):[cleanText(input.dedupeKey,180)];
    for (let sourceIndex=0;sourceIndex<sourcePaths.length;sourceIndex+=1) {
      const source=sourcePaths[sourceIndex],dedupeKey=dedupeKeys[sourceIndex]||"",existing=dedupeKey?state.assets.find(item=>item.projectId===project.id&&item.generationResultKey===dedupeKey&&!item.deletedAt):null;if(existing){imported.push(this.publicAsset(existing));continue;}
      const stat = fs.statSync(source);
      if (!stat.isFile()) throw new Error(`不是有效文件：${path.basename(source)}`);
      const type = mediaType(source); const ext = path.extname(source).toLowerCase();
      if (!type) throw new Error(`不支持的素材格式：${path.basename(source)}`);
      if (stat.size <= 0) throw new Error(`素材文件为空：${path.basename(source)}`);
      if (stat.size > TYPE_LIMITS[type]) throw new Error(`${path.basename(source)} 超过 ${type === "video" ? "1GB" : type === "audio" ? "200MB" : type === "image" ? "30MB" : "10MB"} 限制`);
      const assetId = id(); const target = path.join(projectRoot, assetId + ext);
      if (!inside(materialRoot, target)) throw new Error("素材目标路径不安全");
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
      const timestamp = now();
      const asset = {id:assetId, projectId:project.id, type, name:cleanName(path.basename(source, ext), "素材"), originalName:cleanName(path.basename(source), "素材"), ext, mime:mimeFor(type, ext), size:stat.size, path:target, tags:[], notes:"", source:cleanText(input.source,80)||"local-import", generationResultKey:dedupeKey, archivedAt:null, deletedAt:null, createdAt:timestamp, updatedAt:timestamp};
      state.assets.unshift(asset); imported.push(this.publicAsset(asset));
    }
    project.updatedAt = now(); this.save(state); return imported;
  }
  createTextAsset(input = {}) {
    const state = this.load(); const project = this.project(state, input.projectId || state.currentProjectId);
    if (!project || project.deletedAt || project.archivedAt) throw new Error("请选择有效的归属项目");
    const content = String(input.content || "").replace(/\r\n/g, "\n");
    if (!content.trim()) throw new Error("文本素材内容不能为空");
    const size = Buffer.byteLength(content, "utf8");
    if (size > TYPE_LIMITS.text) throw new Error("文本素材超过 10MB 限制");
    const sourceAssetId = cleanText(input.sourceAssetId, 180);
    const sourceAsset = sourceAssetId ? this.asset(state, sourceAssetId) : null;
    if (sourceAssetId && (!sourceAsset || sourceAsset.deletedAt)) throw new Error("来源素材不存在");
    if (sourceAsset && sourceAsset.projectId !== project.id) throw new Error("来源素材必须属于当前项目");
    const materialRoot = path.join(this.root(), "materials"); const projectRoot = path.join(materialRoot, project.id); fs.mkdirSync(projectRoot, {recursive:true});
    const assetId = id(); const target = path.join(projectRoot, `${assetId}.txt`);
    if (!inside(materialRoot, target)) throw new Error("素材目标路径不安全");
    fs.writeFileSync(target, content, {encoding:"utf8", flag:"wx"});
    const timestamp = now(); const name = cleanName(input.name || input.title, "文本摘录");
    const asset = {id:assetId, projectId:project.id, type:"text", name, originalName:`${name}.txt`, ext:".txt", mime:"text/plain", size, path:target, tags:(Array.isArray(input.tags)?input.tags:String(input.tags||"").split(",")).map(value=>cleanText(value,40)).filter(Boolean).slice(0,20), notes:cleanText(input.notes,2000), source:cleanText(input.source,80)||"text-excerpt", sourceAssetId:sourceAsset?.id||"", sourceProjectId:sourceAsset?.projectId||"", sourceLocation:cleanText(input.sourceLocation,500), archivedAt:null, deletedAt:null, createdAt:timestamp, updatedAt:timestamp};
    state.assets.unshift(asset); project.updatedAt = timestamp; this.save(state); return this.publicAsset(asset);
  }
  copyAssets(input = {}) {
    const state=this.load();const targetProject=this.project(state,input.targetProjectId||state.currentProjectId);
    if(!targetProject||targetProject.deletedAt||targetProject.archivedAt)throw new Error("请选择有效的目标项目");
    const assetIds=[...new Set((Array.isArray(input.assetIds)?input.assetIds:[]).map(String).filter(Boolean))].slice(0,50);if(!assetIds.length)return{assets:[],mapping:[]};
    const materialRoot=path.join(this.root(),"materials"),targetRoot=path.join(materialRoot,targetProject.id);fs.mkdirSync(targetRoot,{recursive:true});
    const assets=[],mapping=[];let copiedCount=0;
    for(const assetId of assetIds){
      const source=this.asset(state,assetId);if(!source||source.deletedAt)throw new Error(`素材不存在：${assetId}`);if(!fs.existsSync(source.path))throw new Error(`素材文件已丢失：${source.name}`);
      if(source.projectId===targetProject.id){assets.push(this.publicAsset(source));mapping.push({sourceAssetId:source.id,targetAssetId:source.id,copied:false});continue;}
      const copiedId=id(),targetPath=path.join(targetRoot,copiedId+source.ext);if(!inside(materialRoot,targetPath))throw new Error("素材复制目标路径不安全");fs.copyFileSync(source.path,targetPath,fs.constants.COPYFILE_EXCL);
      const timestamp=now();const copied={...source,id:copiedId,projectId:targetProject.id,path:targetPath,name:cleanName(source.name,"素材"),source:"cross-project-copy",sourceAssetId:source.id,sourceProjectId:source.projectId,archivedAt:null,deletedAt:null,createdAt:timestamp,updatedAt:timestamp};
      state.assets.unshift(copied);assets.push(this.publicAsset(copied));mapping.push({sourceAssetId:source.id,targetAssetId:copied.id,copied:true});copiedCount++;
    }
    if(copiedCount)targetProject.updatedAt=now();this.save(state);return{assets,mapping};
  }
  assetReferenceUsage(state, assetId) {
    const value=String(assetId||"");
    const inputTasks=state.tasks.filter(item=>Array.isArray(item.assetIds)&&item.assetIds.map(String).includes(value));
    const resultTasks=state.tasks.filter(item=>String(item.resultAssetId||"")===value);
    const conversations=state.textConversations.filter(item=>Array.isArray(item.assetIds)&&item.assetIds.map(String).includes(value));
    return {inputTasks,resultTasks,conversations,total:new Set([...inputTasks,...resultTasks].map(item=>item.id)).size+conversations.length};
  }
  updateAsset(assetId, input = {}) {
    const state = this.load(); const asset = this.asset(state, assetId);
    if (!asset) throw new Error("素材不存在");
    if (input.projectId !== undefined) {
      const project = this.project(state, input.projectId);
      if (!project || project.deletedAt || project.archivedAt) throw new Error("目标项目不存在");
      if (project.id !== asset.projectId) throw new Error("素材项目归属不可直接修改，请使用“复制到项目”生成新的 assetId");
    }
    if (input.name !== undefined) asset.name = cleanName(input.name, asset.name);
    if (input.tags !== undefined) asset.tags = (Array.isArray(input.tags) ? input.tags : String(input.tags).split(",")).map(value => cleanText(value, 40)).filter(Boolean).slice(0, 20);
    if (input.notes !== undefined) asset.notes = cleanText(input.notes, 2000);
    if (input.archived !== undefined) asset.archivedAt = input.archived ? now() : null;
    asset.updatedAt = now(); this.save(state); return this.publicAsset(asset);
  }
  deleteAsset(assetId) {
    const state = this.load(); const asset = this.asset(state, assetId); if (!asset) throw new Error("素材不存在");
    const usage=this.assetReferenceUsage(state,asset.id);if(usage.total){const parts=[];if(usage.inputTasks.length)parts.push(`${usage.inputTasks.length} 个任务输入`);if(usage.resultTasks.length)parts.push(`${usage.resultTasks.length} 个任务结果`);if(usage.conversations.length)parts.push(`${usage.conversations.length} 个文本会话`);throw new Error(`素材正在被${parts.join("、")}引用，不能删除`);}
    asset.deletedAt = now(); asset.updatedAt = asset.deletedAt; this.save(state); return {ok:true, trashed:asset.name};
  }
  restoreAsset(assetId) {
    const state = this.load(); const asset = this.asset(state, assetId); if (!asset) throw new Error("素材不存在");
    asset.deletedAt = null; asset.updatedAt = now(); this.save(state); return this.publicAsset(asset);
  }
  resolveAsset(assetId) {
    const state = this.load(); const asset = this.asset(state, assetId);
    if (!asset) throw new Error("素材不存在");
    const materialRoot = path.join(this.root(), "materials");
    if (!inside(materialRoot, asset.path)) throw new Error("素材路径越界");
    if (!fs.existsSync(asset.path)) throw new Error("素材文件已丢失");
    return {...this.publicAsset(asset), path:asset.path};
  }
  previewAsset(assetId) {
    const {path:assetPath, ...asset} = this.resolveAsset(assetId);
    if (asset.type !== "text") return {...asset, previewType:asset.type};
    const maxBytes = 512 * 1024;
    const buffer = fs.readFileSync(assetPath);
    return {...asset, previewType:"text", text:buffer.subarray(0, maxBytes).toString("utf8"), truncated:buffer.length > maxBytes};
  }
  readTextAsset(assetId) {
    const asset=this.resolveAsset(assetId);
    if(asset.type!=="text")throw new Error("只有文本素材可以读取内容");
    const value=fs.readFileSync(asset.path,"utf8");
    return{id:asset.id,name:asset.name,content:value.slice(0,12000)};
  }
  publicAsset(asset) {
    return {id:asset.id, projectId:asset.projectId, type:asset.type, name:asset.name, originalName:asset.originalName, ext:asset.ext, mime:asset.mime, size:asset.size, tags:asset.tags || [], notes:asset.notes || "", source:asset.source || "", sourceAssetId:asset.sourceAssetId || "", sourceProjectId:asset.sourceProjectId || "", sourceLocation:asset.sourceLocation || "", archivedAt:asset.archivedAt || null, deletedAt:asset.deletedAt || null, createdAt:asset.createdAt, updatedAt:asset.updatedAt, contentUrl:pathToFileURL(asset.path).href};
  }
  conversation(state, conversationId) { return state.textConversations.find(item => item.id === String(conversationId || "")) || null; }
  createConversation(input = {}) {
    const state = this.load(); const project = this.project(state, input.projectId || state.currentProjectId);
    if (!project || project.deletedAt || project.archivedAt) throw new Error("请选择有效的归属项目");
    const timestamp = now(); const content = String(input.content || "");
    const conversation = {id:id(), projectId:project.id, title:cleanName(input.title, "新建文本"), type:cleanText(input.type || "剧本", 40) || "剧本", content, assetIds:[], versions:content ? [{id:id(), label:"初始版本", content, createdAt:timestamp}] : [], archivedAt:null, deletedAt:null, createdAt:timestamp, updatedAt:timestamp};
    state.textConversations.unshift(conversation); this.save(state); return this.publicConversation(conversation);
  }
  updateConversation(conversationId, input = {}) {
    const state = this.load(); const conversation = this.conversation(state, conversationId); if (!conversation) throw new Error("文本会话不存在");
    if (input.projectId !== undefined) { const project=this.project(state,input.projectId); if(!project||project.deletedAt||project.archivedAt)throw new Error("目标项目不存在"); conversation.projectId=project.id; }
    if (input.title !== undefined) conversation.title=cleanName(input.title,conversation.title);
    if (input.type !== undefined) conversation.type=cleanText(input.type,40)||conversation.type;
    if (input.assetIds !== undefined) { const unique=[...new Set((Array.isArray(input.assetIds)?input.assetIds:[]).map(String))].slice(0,20); for(const assetId of unique){const asset=this.asset(state,assetId);if(!asset||asset.deletedAt)throw new Error(`引用素材不存在：${assetId}`);if(asset.projectId!==conversation.projectId)throw new Error("引用素材必须属于当前文本项目");} conversation.assetIds=unique; }
    if (input.archived !== undefined) conversation.archivedAt=input.archived?now():null;
    if (input.content !== undefined) {
      const content=String(input.content); if(Buffer.byteLength(content,"utf8")>2*1024*1024)throw new Error("单个文本文档不能超过 2MB");
      if(content!==conversation.content){conversation.content=content;conversation.versions=Array.isArray(conversation.versions)?conversation.versions:[];conversation.versions.push({id:id(),label:cleanText(input.versionLabel,60)||`自动保存 ${conversation.versions.length+1}`,content,createdAt:now()});if(conversation.versions.length>100)conversation.versions=conversation.versions.slice(-100);}
    }
    conversation.updatedAt=now(); this.save(state); return this.publicConversation(conversation);
  }
  deleteConversation(conversationId) { const state=this.load();const conversation=this.conversation(state,conversationId);if(!conversation)throw new Error("文本会话不存在");conversation.deletedAt=now();conversation.updatedAt=conversation.deletedAt;this.save(state);return{ok:true,trashed:conversation.title}; }
  restoreConversation(conversationId) { const state=this.load();const conversation=this.conversation(state,conversationId);if(!conversation)throw new Error("文本会话不存在");conversation.deletedAt=null;conversation.updatedAt=now();this.save(state);return this.publicConversation(conversation); }
  restoreConversationVersion(conversationId, versionId) { const state=this.load();const conversation=this.conversation(state,conversationId);if(!conversation)throw new Error("文本会话不存在");const version=(conversation.versions||[]).find(item=>item.id===versionId);if(!version)throw new Error("文本版本不存在");conversation.content=version.content;conversation.updatedAt=now();conversation.versions.push({id:id(),label:`恢复：${version.label}`,content:version.content,createdAt:conversation.updatedAt,restoredFrom:version.id});this.save(state);return this.publicConversation(conversation); }
  deleteConversationVersion(conversationId, versionId) { const state=this.load();const conversation=this.conversation(state,conversationId);if(!conversation)throw new Error("文本会话不存在");const index=(conversation.versions||[]).findIndex(item=>item.id===versionId);if(index<0)throw new Error("文本版本不存在");if(conversation.versions.length<=1)throw new Error("至少保留一个文本版本");conversation.versions.splice(index,1);conversation.updatedAt=now();this.save(state);return this.publicConversation(conversation); }
  publicConversation(conversation) { return {id:conversation.id,projectId:conversation.projectId,title:conversation.title,type:conversation.type||"文本",content:conversation.content||"",assetIds:Array.isArray(conversation.assetIds)?conversation.assetIds:[],versions:(conversation.versions||[]).map(item=>({...item})),archivedAt:conversation.archivedAt||null,deletedAt:conversation.deletedAt||null,createdAt:conversation.createdAt,updatedAt:conversation.updatedAt}; }
  task(state, taskId) { return state.tasks.find(item => item.id === String(taskId || "")) || null; }
  validateTaskAssets(state, projectId, assetIds) { const unique=[...new Set((Array.isArray(assetIds)?assetIds:[]).map(String))].slice(0,10);for(const assetId of unique){const asset=this.asset(state,assetId);if(!asset||asset.deletedAt)throw new Error(`任务素材不存在：${assetId}`);if(asset.projectId!==projectId)throw new Error("任务素材必须属于任务项目");}return unique; }
  createDraftTask(input = {}) {
    const source=input&&typeof input==="object"&&!Array.isArray(input)?input:{};
    const executionFields=["executionChannel","accountId","accountName","accountCandidates","accountSelectionMode","accountGroupId","providerId","modelId","model","clientRequestId","tenantId"];
    if(String(source.state||"draft")!=="draft"||executionFields.some(key=>source[key]!==undefined))throw Object.assign(new Error("普通任务入口只能保存草稿；执行任务请使用受控生成入口"),{code:"TASK_DRAFT_ONLY"});
    return this.createTask({title:source.title,prompt:source.prompt,projectId:source.projectId,creationType:source.creationType,creationSource:source.creationSource,assetIds:source.assetIds||source.imageAssetIds,referenceAssets:source.referenceAssets,state:"draft"});
  }
  createTask(input = {}) {
    const state=this.load();const project=this.project(state,input.projectId||state.currentProjectId);if(!project||project.deletedAt||project.archivedAt)throw new Error("请选择有效的任务项目");
    const timestamp=now();const prompt=cleanText(input.prompt,12000);const title=cleanName(input.title||input.resultName||prompt.slice(0,36),"新任务");const taskState=TASK_STATES.has(input.state)?input.state:"draft";const assetIds=this.validateTaskAssets(state,project.id,input.assetIds||input.imageAssetIds);
    const executionChannel = ["doubao", "model-gateway"].includes(String(input.executionChannel || "")) ? String(input.executionChannel) : "";const accountCandidates=normalizeAccountCandidates(input.accountCandidates);const selectedAccountId=cleanText(input.accountId,100);if(selectedAccountId&&!accountCandidates.some(item=>item.id===selectedAccountId))accountCandidates.unshift({id:selectedAccountId,name:cleanText(input.accountName,100)||selectedAccountId,platform:"豆包"});
    const parameters=normalizeTaskParameters(input.parameters||input.modelParameters);const resolution=cleanText(input.resolution||parameters.resolution||parameters.quality,40);if(resolution&&!parameters.resolution)parameters.resolution=resolution;if(input.generationMode&&!parameters.mode)parameters.mode=cleanText(input.generationMode,80);const doubaoModel=normalizeDoubaoModel(input.doubaoModel);
    const conversationId=cleanText(input.conversationId,180),conversationVid=cleanText(input.conversationVid||conversationId,180);
    const task={id:id(),parentTaskId:cleanText(input.parentTaskId,100),batchId:cleanText(input.batchId,100),batchKey:executionChannel==="doubao"?doubaoBatchKey(doubaoModel,assetIds):"",projectId:project.id,title,prompt,creationType:cleanText(input.creationType||"video",40)||"video",creationSource:cleanText(input.creationSource||"task-center",60),executionChannel,tenantId:this.currentTenantId(),providerId:cleanText(input.providerId,180),modelId:cleanText(input.modelId||input.model,180),clientRequestId:cleanText(input.clientRequestId,300),assetIds,referenceAssets:normalizeTaskReferenceAssets(input.referenceAssets,assetIds),model:cleanText(input.modelId||input.model,180),doubaoModel,ratio:executionChannel==="doubao"?normalizeDoubaoRatio(input.ratio):cleanText(input.ratio||"16:9",40),duration:executionChannel==="doubao"?normalizeDoubaoDuration(input.duration):cleanText(input.duration,40),resolution,parameters,accountGroupId:cleanText(input.accountGroupId,100),accountSelectionMode:input.accountSelectionMode==="auto"?"auto":"manual",accountCandidates,accountId:selectedAccountId,accountName:cleanText(input.accountName,100),accountAttempts:[],quotaFailures:[],quotaResetAt:null,conversationId,conversationVid,videoVid:cleanText(input.videoVid,300),executionAttemptId:cleanText(input.executionAttemptId,100),executionCheckpoint:normalizeExecutionCheckpoint(input.executionCheckpoint),lastHeartbeatAt:cleanText(input.lastHeartbeatAt,100)||null,state:taskState,stage:cleanText(input.stage,60)||taskState,progressMode:cleanText(input.progressMode,30)||"determinate",monitorAttempt:0,lastCheckedAt:null,monitorError:"",monitorProbe:null,statusText:cleanText(input.statusText,500)||(taskState==="draft"?"等待选择执行方式":"排队中"),progress:Math.max(0,Math.min(100,Number(input.progress)||0)),safeToRetry:input.safeToRetry===true,notSentVerified:input.notSentVerified===true,terminalFailureVerified:input.terminalFailureVerified===true,outcomeCode:cleanText(input.outcomeCode,100),submittedVerified:input.submittedVerified===true,accountAction:cleanText(input.accountAction,40),retryMode:cleanText(input.retryMode,60),requiresPromptEdit:input.requiresPromptEdit===true,failureCode:cleanText(input.failureCode,100),failureCategory:cleanText(input.failureCategory,100),providerMessage:cleanText(input.providerMessage,2000),userAction:cleanText(input.userAction,1000),quotaConsumed:typeof input.quotaConsumed==="boolean"?input.quotaConsumed:null,failureEvidence:null,resultAssetId:"",resultAssetIds:[],resultItems:[],expectedResultCount:0,recoveredResultCount:0,resultVid:"",resultUrlSource:cleanText(input.resultUrlSource,80),watermarkFree:typeof input.watermarkFree==="boolean"?input.watermarkFree:null,watermarkFreeError:cleanText(input.watermarkFreeError,2000),resultSourceResolvedAt:cleanText(input.resultSourceResolvedAt,100)||null,fallbackResultVid:cleanText(input.fallbackResultVid,8192),resultType:"",resultText:"",resultUrls:[],providerJobId:"",recoveryState:"",error:null,evidence:null,steps:[{at:timestamp,state:taskState,message:taskState==="draft"?"等待选择执行方式":"任务已创建"}],archivedAt:null,deletedAt:null,createdAt:timestamp,updatedAt:timestamp};
    if(taskState==="draft")task.steps[0].message="任务草稿已创建";
    state.tasks.unshift(task);this.save(state);return this.publicTask(task);
  }
  reportTask(taskId,input={}) {
    const state=this.load();const task=this.task(state,taskId);if(!task)throw new Error("任务不存在");const nextState=input.state===undefined?task.state:String(input.state);if(!TASK_STATES.has(nextState))throw new Error("任务状态无效");
    if(TERMINAL_TASK_STATES.has(task.state)&&nextState!==task.state)return this.publicTask(task);
    if(input.executionChannel!==undefined){const channel=String(input.executionChannel||"");if(channel&&!['doubao','model-gateway'].includes(channel))throw new Error("执行通道无效");task.executionChannel=channel;}if(input.providerId!==undefined)task.providerId=cleanText(input.providerId,180);if(input.modelId!==undefined){task.modelId=cleanText(input.modelId,180);task.model=task.modelId;}if(input.clientRequestId!==undefined)task.clientRequestId=cleanText(input.clientRequestId,300);if(input.referenceAssets!==undefined)task.referenceAssets=normalizeTaskReferenceAssets(input.referenceAssets,task.assetIds);if(input.doubaoModel!==undefined)task.doubaoModel=normalizeDoubaoModel(input.doubaoModel);if(input.ratio!==undefined)task.ratio=task.executionChannel==="doubao"?normalizeDoubaoRatio(input.ratio):cleanText(input.ratio,40);if(input.duration!==undefined)task.duration=task.executionChannel==="doubao"?normalizeDoubaoDuration(input.duration):cleanText(input.duration,40);if(input.resolution!==undefined)task.resolution=cleanText(input.resolution,40);if(input.parameters!==undefined||input.modelParameters!==undefined)task.parameters=normalizeTaskParameters(input.parameters||input.modelParameters);if(input.generationMode!==undefined){task.parameters=normalizeTaskParameters(task.parameters);task.parameters.mode=cleanText(input.generationMode,80);}if(input.accountId!==undefined)task.accountId=cleanText(input.accountId,100);if(input.accountName!==undefined)task.accountName=cleanText(input.accountName,100);if(input.accountSelectionMode!==undefined)task.accountSelectionMode=input.accountSelectionMode==="auto"?"auto":"manual";if(input.accountCandidates!==undefined)task.accountCandidates=normalizeAccountCandidates(input.accountCandidates);if(input.accountAttempts!==undefined)task.accountAttempts=Array.isArray(input.accountAttempts)?JSON.parse(JSON.stringify(input.accountAttempts)).slice(-100):[];if(input.quotaFailures!==undefined)task.quotaFailures=Array.isArray(input.quotaFailures)?JSON.parse(JSON.stringify(input.quotaFailures)).slice(-100):[];if(input.quotaResetAt!==undefined)task.quotaResetAt=cleanText(input.quotaResetAt,100)||null;if(input.conversationId!==undefined){task.conversationId=cleanText(input.conversationId,180);if(input.conversationVid===undefined)task.conversationVid=task.conversationId;}if(input.conversationVid!==undefined)task.conversationVid=cleanText(input.conversationVid,180);if(input.videoVid!==undefined)task.videoVid=cleanText(input.videoVid,300);if(input.stage!==undefined)task.stage=cleanText(input.stage,60);if(input.progressMode!==undefined)task.progressMode=cleanText(input.progressMode,30)||"determinate";if(input.monitorAttempt!==undefined)task.monitorAttempt=Math.max(0,Number(input.monitorAttempt)||0);if(input.lastCheckedAt!==undefined)task.lastCheckedAt=cleanText(input.lastCheckedAt,100)||null;if(input.progress!==undefined)task.progress=Math.max(0,Math.min(100,Number(input.progress)||0));if(input.resultType!==undefined)task.resultType=cleanText(input.resultType,40);if(input.resultText!==undefined)task.resultText=String(input.resultText||"").slice(0,200000);if(input.resultUrls!==undefined)task.resultUrls=[...new Set((Array.isArray(input.resultUrls)?input.resultUrls:[]).map(value=>cleanText(value,8192)).filter(Boolean))].slice(0,20);if(input.resultItems!==undefined)task.resultItems=normalizeResultItems(input.resultItems);if(input.resultAssetIds!==undefined)task.resultAssetIds=[...new Set((Array.isArray(input.resultAssetIds)?input.resultAssetIds:[]).map(value=>cleanText(value,100)).filter(Boolean))].slice(0,20);if(input.expectedResultCount!==undefined)task.expectedResultCount=Math.max(0,Math.min(20,Number(input.expectedResultCount)||0));if(input.recoveredResultCount!==undefined)task.recoveredResultCount=Math.max(0,Math.min(20,Number(input.recoveredResultCount)||0));if(input.providerJobId!==undefined)task.providerJobId=cleanText(input.providerJobId,300);if(input.recoveryState!==undefined)task.recoveryState=cleanText(input.recoveryState,80);if(input.error!==undefined)task.error=cleanText(input.error,2000)||null;if(input.safeToRetry!==undefined)task.safeToRetry=input.safeToRetry===true;if(input.notSentVerified!==undefined)task.notSentVerified=input.notSentVerified===true;if(input.terminalFailureVerified!==undefined)task.terminalFailureVerified=input.terminalFailureVerified===true;if(input.retryMode!==undefined)task.retryMode=cleanText(input.retryMode,60);if(input.requiresPromptEdit!==undefined)task.requiresPromptEdit=input.requiresPromptEdit===true;if(input.failureCode!==undefined)task.failureCode=cleanText(input.failureCode,100);if(input.failureCategory!==undefined)task.failureCategory=cleanText(input.failureCategory,100);if(input.providerMessage!==undefined)task.providerMessage=cleanText(input.providerMessage,2000);if(input.userAction!==undefined)task.userAction=cleanText(input.userAction,1000);if(input.quotaConsumed!==undefined)task.quotaConsumed=typeof input.quotaConsumed==="boolean"?input.quotaConsumed:null;if(input.evidence!==undefined)task.evidence=input.evidence&&typeof input.evidence==="object"?JSON.parse(JSON.stringify(input.evidence)):null;
    if(input.batchId!==undefined)task.batchId=cleanText(input.batchId,100);if(input.batchKey!==undefined)task.batchKey=cleanText(input.batchKey,100);if(input.executionAttemptId!==undefined)task.executionAttemptId=cleanText(input.executionAttemptId,100);if(input.executionCheckpoint!==undefined)task.executionCheckpoint=normalizeExecutionCheckpoint(input.executionCheckpoint);if(input.lastHeartbeatAt!==undefined)task.lastHeartbeatAt=cleanText(input.lastHeartbeatAt,100)||null;if(input.monitorError!==undefined)task.monitorError=cleanText(input.monitorError,2000);if(input.monitorProbe!==undefined)task.monitorProbe=input.monitorProbe&&typeof input.monitorProbe==="object"?JSON.parse(JSON.stringify(input.monitorProbe)):null;if(input.outcomeCode!==undefined)task.outcomeCode=cleanText(input.outcomeCode,100);if(input.submittedVerified!==undefined)task.submittedVerified=input.submittedVerified===true;if(input.accountAction!==undefined)task.accountAction=cleanText(input.accountAction,40);if(input.failureEvidence!==undefined)task.failureEvidence=input.failureEvidence&&typeof input.failureEvidence==="object"?JSON.parse(JSON.stringify(input.failureEvidence)):null;if(input.resultVid!==undefined)task.resultVid=cleanText(input.resultVid,8192);if(input.resultUrlSource!==undefined)task.resultUrlSource=cleanText(input.resultUrlSource,80);if(input.watermarkFree!==undefined)task.watermarkFree=typeof input.watermarkFree==="boolean"?input.watermarkFree:null;if(input.watermarkFreeError!==undefined)task.watermarkFreeError=cleanText(input.watermarkFreeError,2000);if(input.resultSourceResolvedAt!==undefined)task.resultSourceResolvedAt=cleanText(input.resultSourceResolvedAt,100)||null;if(input.fallbackResultVid!==undefined)task.fallbackResultVid=cleanText(input.fallbackResultVid,8192);
    const message=cleanText(input.statusText||input.message,500);const changed=nextState!==task.state||Boolean(message);if(input.stage===undefined&&nextState!==task.state)task.stage=nextState;task.state=nextState;if(message)task.statusText=message;if(nextState==="completed"){task.progress=100;task.progressMode="determinate";task.stage="completed";}task.updatedAt=now();if(changed&&input.appendStep!==false){const step={at:task.updatedAt,state:task.state,message:message||task.statusText},group=cleanText(input.stepGroup,80),last=task.steps.at(-1);if(group)step.group=group;if(group&&input.replaceStepGroup===true&&last?.group===group)task.steps[task.steps.length-1]=step;else task.steps.push(step);}this.save(state);return this.publicTask(task);
  }
  completeTask(taskId,input={}) {
    const state=this.load();const task=this.task(state,taskId);if(!task)throw new Error("任务不存在");
    const requestedAssetIds=[...new Set((Array.isArray(input.resultAssetIds)?input.resultAssetIds:[input.resultAssetId]).map(value=>cleanText(value,100)).filter(Boolean))].slice(0,20);if(!requestedAssetIds.length)throw new Error("结果素材不存在");
    if(task.state==="completed"){const currentAssetIds=[...new Set([task.resultAssetId,...(Array.isArray(task.resultAssetIds)?task.resultAssetIds:[])].map(value=>cleanText(value,100)).filter(Boolean))],requestedVid=cleanText(input.resultVid,8192),requestedVideoVid=cleanText(input.videoVid,300),requestedConversationVid=cleanText(input.conversationVid,180),requestedProviderJobId=cleanText(input.providerJobId,300),sameAssets=currentAssetIds.length===requestedAssetIds.length&&currentAssetIds.every((assetId,index)=>assetId===requestedAssetIds[index]),sameVid=!requestedVid||requestedVid===task.resultVid,sameVideoVid=!requestedVideoVid||requestedVideoVid===task.videoVid,sameConversationVid=!requestedConversationVid||requestedConversationVid===(task.conversationVid||task.conversationId),sameProviderJob=!requestedProviderJobId||requestedProviderJobId===task.providerJobId;if(sameAssets&&sameVid&&sameVideoVid&&sameConversationVid&&sameProviderJob)return this.publicTask(task);throw new Error("已完成任务的结果绑定不可变更");}
    const assets=requestedAssetIds.map(assetId=>{const asset=this.asset(state,assetId);if(!asset||asset.deletedAt)throw new Error("结果素材不存在");if(asset.projectId!==task.projectId)throw new Error("结果素材与任务项目不一致");if(state.tasks.some(item=>item.id!==task.id&&!item.deletedAt&&[item.resultAssetId,...(Array.isArray(item.resultAssetIds)?item.resultAssetIds:[])].includes(asset.id)))throw new Error("结果素材已归属其他任务");return asset;});
    const asset=assets[0],resultItems=normalizeResultItems(input.resultItems===undefined?task.resultItems:input.resultItems),expectedResultCount=Math.max(0,Number(input.expectedResultCount??task.expectedResultCount)||0);
    if(task.executionChannel==="model-gateway"&&resultItems.length){const required=resultItems.filter(item=>item.required!==false);if(expectedResultCount&&required.length!==expectedResultCount)throw new Error(`结果数量不一致：预期 ${expectedResultCount} 项，当前 ${required.length} 项`);if(required.some(item=>item.status!=="imported"||!item.assetId))throw new Error("仍有模型结果未完成入库");const itemAssetIds=[...new Set(required.map(item=>item.assetId))];if(itemAssetIds.length!==required.length||itemAssetIds.some(assetId=>!requestedAssetIds.includes(assetId)))throw new Error("模型结果素材绑定不完整");}
    const vid=cleanText(input.resultVid,8192),videoVid=cleanText(input.videoVid||task.videoVid,300);if(vid&&state.tasks.some(item=>item.id!==task.id&&!item.deletedAt&&item.resultVid===vid))throw new Error("结果 VID 已归属其他任务");if(videoVid&&state.tasks.some(item=>item.id!==task.id&&!item.deletedAt&&item.videoVid===videoVid))throw new Error("豆包视频 VID 已归属其他任务");
    const evidence=input.evidence&&typeof input.evidence==="object"?JSON.parse(JSON.stringify(input.evidence)):{};const evidenceTenant=cleanText(evidence.tenantId,100),evidenceAccount=cleanText(evidence.accountId||task.accountId,100),evidenceConversation=cleanText(evidence.conversationId||task.conversationId,180),submittedAt=cleanText(evidence.submittedAt,100);const isModelTask=task.executionChannel==="model-gateway";if(!evidenceTenant||!submittedAt||(!isModelTask&&(!evidenceAccount||!evidenceConversation)))throw new Error("结果回填证据链不完整");if(evidenceTenant!==path.basename(this.root()))throw new Error("结果证据租户与当前租户不一致");if(!isModelTask&&task.accountId&&evidenceAccount!==task.accountId)throw new Error("结果证据账号与任务账号不一致");if(!isModelTask&&task.conversationId&&evidenceConversation!==task.conversationId)throw new Error("结果证据会话与任务会话不一致");const submittedMs=Date.parse(submittedAt);if(!Number.isFinite(submittedMs)||submittedMs>Date.now()+300000)throw new Error("结果证据提交时间无效");
    task.resultAssetId=asset.id;task.resultAssetIds=requestedAssetIds;task.resultItems=resultItems;task.expectedResultCount=expectedResultCount||resultItems.length||requestedAssetIds.length;task.recoveredResultCount=requestedAssetIds.length;task.resultVid=vid;task.resultUrlSource=cleanText(input.resultUrlSource||task.resultUrlSource,80);task.watermarkFree=typeof input.watermarkFree==="boolean"?input.watermarkFree:(typeof task.watermarkFree==="boolean"?task.watermarkFree:null);task.watermarkFreeError=cleanText(input.watermarkFreeError!==undefined?input.watermarkFreeError:task.watermarkFreeError,2000);task.resultSourceResolvedAt=cleanText(input.resultSourceResolvedAt||task.resultSourceResolvedAt,100)||null;task.fallbackResultVid=cleanText(input.fallbackResultVid||task.fallbackResultVid,8192);task.conversationVid=cleanText(input.conversationVid||task.conversationVid||evidenceConversation||task.conversationId,180);task.videoVid=videoVid;task.resultType=cleanText(input.resultType||task.resultType||asset.type,40);task.resultUrls=[...new Set((Array.isArray(input.resultUrls)?input.resultUrls:task.resultUrls||[]).map(value=>cleanText(value,8192)).filter(Boolean))].slice(0,20);task.providerJobId=cleanText(input.providerJobId||task.providerJobId,300);task.recoveryState="completed";task.evidence={...evidence,tenantId:evidenceTenant,accountId:evidenceAccount,conversationId:evidenceConversation,conversationVid:task.conversationVid,videoVid:task.videoVid,providerId:cleanText(evidence.providerId||task.providerId,180),modelId:cleanText(evidence.modelId||task.modelId,180),submittedAt:new Date(submittedMs).toISOString()};task.state="completed";task.stage="completed";task.progressMode="determinate";task.statusText=requestedAssetIds.length>1?`全部 ${requestedAssetIds.length} 项结果已校验并回填素材中心`:"结果已校验并回填素材中心";task.progress=100;task.error=null;task.safeToRetry=false;task.notSentVerified=false;task.updatedAt=now();task.steps.push({at:task.updatedAt,state:"completed",message:task.statusText});this.save(state);return this.publicTask(task);
  }
  checkpointModelResultItem(taskId,input={}) {
    const state=this.load();const task=this.task(state,taskId);if(!task)throw new Error("任务不存在");if(task.executionChannel!=="model-gateway")throw new Error("只有模型网关任务支持结果检查点");
    const incoming=normalizeResultItems([input.item])[0];if(!incoming)throw new Error("结果检查点无效");const items=normalizeResultItems(task.resultItems);const itemIndex=items.findIndex(item=>item.key===incoming.key);if(itemIndex>=0)items[itemIndex]={...items[itemIndex],...incoming};else items.push(incoming);task.resultItems=normalizeResultItems(items);task.resultAssetIds=[...new Set(task.resultItems.filter(item=>item.status==="imported"&&item.assetId).map(item=>item.assetId))];task.recoveredResultCount=task.resultItems.filter(item=>item.required!==false&&item.status==="imported"&&item.assetId).length;task.expectedResultCount=Math.max(task.expectedResultCount||0,Math.min(20,Number(input.expectedResultCount)||0),task.resultItems.filter(item=>item.required!==false).length);task.updatedAt=now();this.save(state);return this.publicTask(task);
  }
  prepareModelResultRecovery(taskId,input={}) {
    const state=this.load();const task=this.task(state,taskId);if(!task)throw new Error("任务不存在");
    if(task.executionChannel!=="model-gateway")throw new Error("只有模型网关任务支持结果恢复");
    if(!["failed","submission_unknown","generating","downloading","verifying","paused"].includes(task.state))throw new Error("当前任务状态不支持结果恢复");
    const supplied=(Array.isArray(input.resultUrls)?input.resultUrls:[input.resultUrl]).map(value=>cleanText(value,8192)).filter(value=>/^(?:https?:|data:)/i.test(value)),existing=[...(task.resultUrls||[]),...normalizeResultItems(task.resultItems).map(item=>item.url)].filter(Boolean),urls=[...new Set(input.replace===true?supplied:[...existing,...supplied])].slice(0,20);if(!urls.length)throw new Error("缺少有效的厂商结果地址");
    const timestamp=now();task.resultType=cleanText(input.resultType||task.resultType||task.creationType,40)||"image";task.resultUrls=urls;task.expectedResultCount=Math.max(1,Math.min(20,Number(input.expectedResultCount||task.expectedResultCount||urls.length)||urls.length));task.providerJobId=cleanText(input.providerJobId||task.providerJobId,300);task.recoveryState="manual_result_found";task.state="downloading";task.statusText="已从厂商记录找回结果地址，正在回传";task.progress=85;task.error=null;task.safeToRetry=false;task.notSentVerified=false;task.evidence={...(task.evidence||{}),tenantId:path.basename(this.root()),providerId:task.providerId,modelId:task.modelId,providerJobId:task.providerJobId||"",submittedAt:task.evidence?.submittedAt||timestamp,resultRecoveredAt:timestamp,resultRecoverySource:cleanText(input.source||"provider-log",100)};task.updatedAt=timestamp;task.steps.push({at:timestamp,state:"downloading",message:task.statusText});this.save(state);return this.publicTask(task);
  }
  prepareDoubaoResultRecovery(taskId,input={}) {
    const state=this.load();const task=this.task(state,taskId);if(!task)throw new Error("任务不存在");
    if(task.executionChannel!=="doubao")throw new Error("只有豆包任务支持结果回传恢复");
    if(!["failed","downloading","verifying","paused"].includes(task.state))throw new Error("当前豆包任务状态不支持重新回传");
    const supplied=(Array.isArray(input.resultUrls)?input.resultUrls:[input.resultUrl]).map(value=>cleanText(value,8192)).filter(value=>/^https?:/i.test(value)),existing=(task.resultUrls||[]).filter(Boolean),urls=[...new Set(input.replace===true?supplied:[...existing,...supplied])].slice(0,20),videoVid=cleanText(input.videoVid||task.videoVid,300);if(!urls.length&&!videoVid)throw new Error("缺少有效的豆包视频 VID 或地址");
    const timestamp=now();task.resultType="video";task.resultUrls=urls;task.videoVid=videoVid;task.fallbackResultVid=cleanText(input.fallbackResultVid||task.fallbackResultVid||urls[0],8192);task.recoveryState="manual_retry";task.state="downloading";task.stage="downloading";task.progressMode="determinate";task.statusText="正在凭视频 VID 重新解析并回传豆包结果，不会重新生成";task.progress=Math.max(85,Number(task.progress)||0);task.error=null;task.safeToRetry=false;task.notSentVerified=false;task.submittedVerified=true;task.accountAction="release";task.evidence={...(task.evidence||{}),tenantId:path.basename(this.root()),accountId:task.accountId||"",conversationId:task.conversationId||"",resultRecoveredAt:timestamp,resultRecoverySource:cleanText(input.source||"human-review",100)};task.updatedAt=timestamp;task.steps.push({at:timestamp,state:"downloading",message:task.statusText});this.save(state);return this.publicTask(task);
  }
  updateResultUrl(taskId, resultVid) {
    const state=this.load();const task=this.task(state,taskId);if(!task)throw new Error("任务不存在");
    if(task.state!=="completed")throw new Error("只有已完成任务可更新视频地址");
    if(!task.resultAssetId)throw new Error("任务缺少结果素材");
    const url=cleanText(resultVid,8192);if(!/^https?:\/\//i.test(url))throw new Error("视频地址必须是有效的 HTTP/HTTPS URL");
    if(state.tasks.some(item=>item.id!==task.id&&!item.deletedAt&&item.resultVid===url))throw new Error("结果视频地址已归属其他任务");
    task.resultVid=url;task.resultUrlCapturedAt=now();task.updatedAt=now();this.save(state);return this.publicTask(task);
  }
  cancelTask(taskId,input={}) { const state=this.load();const task=this.task(state,taskId);if(!task)throw new Error("任务不存在");const normallyCancelable=["draft","queued","preparing","awaiting_login","awaiting_verification","awaiting_quota"].includes(task.state);if(!normallyCancelable&&input.force!==true)throw new Error(task.executionChannel==="model-gateway"?"任务已提交到模型厂商，请使用停止追踪操作":"任务已进入提交或生成阶段，无法取消豆包服务器上的任务");task.state="cancelled";task.stage="cancelled";task.progressMode="determinate";task.statusText=cleanText(input.statusText,500)||"用户已取消任务";if(input.recoveryState!==undefined)task.recoveryState=cleanText(input.recoveryState,80);if(input.providerMessage!==undefined)task.providerMessage=cleanText(input.providerMessage,2000);if(input.userAction!==undefined)task.userAction=cleanText(input.userAction,1000);task.updatedAt=now();task.steps.push({at:task.updatedAt,state:"cancelled",message:task.statusText});this.save(state);return this.publicTask(task); }
  retryTask(taskId,input={},executionPatch={}) {
    const state=this.load();const task=this.task(state,taskId);if(!task)throw new Error("任务不存在");
    if(!["failed","cancelled","submission_unknown"].includes(task.state)&&!(task.state==="paused"&&task.recoveryState==="batch_circuit_open"))throw new Error("当前任务状态不能重试");
    if(!task.safeToRetry||(!task.notSentVerified&&!task.terminalFailureVerified))throw new Error("尚未确认任务未发送或已明确终止，为避免重复生成，禁止自动重试");
    const suppliedPrompt=cleanText(input.prompt,12000);if(task.requiresPromptEdit&&(!suppliedPrompt||suppliedPrompt===task.prompt))throw new Error("豆包已拒绝原内容，请先修改提示词再重新提交");
    const prompt=suppliedPrompt||task.prompt;const title=cleanName(input.title||task.title,task.title);const doubaoModel=input.doubaoModel!==undefined?normalizeDoubaoModel(input.doubaoModel):task.doubaoModel;const ratio=input.ratio!==undefined?normalizeDoubaoRatio(input.ratio):task.ratio;const duration=input.duration!==undefined?normalizeDoubaoDuration(input.duration):task.duration;const assetIds=input.assetIds!==undefined?this.validateTaskAssets(state,task.projectId,input.assetIds):task.assetIds;const referenceAssets=input.referenceAssets!==undefined?normalizeTaskReferenceAssets(input.referenceAssets,assetIds):normalizeTaskReferenceAssets(task.referenceAssets,assetIds);
    if(task.retryMode==="edit_assets"&&task.recoveryState!=="batch_circuit_open"&&doubaoModel===task.doubaoModel&&JSON.stringify(assetIds)===JSON.stringify(task.assetIds||[])&&JSON.stringify(referenceAssets)===JSON.stringify(task.referenceAssets||[]))throw new Error("参考素材被豆包拒绝，请先替换素材、修改参考图用途说明或切换模型后重试");
    if(task.retryMode==="adjust_parameters"&&!task.notSentVerified&&doubaoModel===task.doubaoModel&&ratio===task.ratio&&duration===task.duration)throw new Error("当前参数被豆包拒绝，请先修改模型、比例或时长再重试");
    const timestamp=now();const revised=prompt!==task.prompt||doubaoModel!==task.doubaoModel||ratio!==task.ratio||duration!==task.duration||JSON.stringify(assetIds)!==JSON.stringify(task.assetIds||[])||JSON.stringify(referenceAssets)!==JSON.stringify(task.referenceAssets||[]);const accountId=executionPatch.accountId===undefined?task.accountId:cleanText(executionPatch.accountId,100),accountName=executionPatch.accountName===undefined?task.accountName:cleanText(executionPatch.accountName,100),accountCandidates=executionPatch.accountCandidates===undefined?normalizeAccountCandidates(task.accountCandidates):normalizeAccountCandidates(executionPatch.accountCandidates);
    const clone={...task,id:id(),parentTaskId:task.id,title,prompt,doubaoModel,ratio,duration,assetIds,referenceAssets,batchKey:task.executionChannel==="doubao"?doubaoBatchKey(doubaoModel,assetIds):"",accountId,accountName,accountCandidates,clientRequestId:"",conversationId:"",conversationVid:"",videoVid:"",executionAttemptId:"",executionCheckpoint:null,lastHeartbeatAt:null,state:"queued",stage:"queued",progressMode:"determinate",monitorAttempt:0,lastCheckedAt:null,monitorError:"",monitorProbe:null,statusText:revised?"任务内容已修改，重新排队执行":"已确认原任务终止，任务重新排队",progress:0,resultAssetId:"",resultAssetIds:[],resultItems:[],expectedResultCount:0,recoveredResultCount:0,resultVid:"",resultUrlSource:"",watermarkFree:null,watermarkFreeError:"",resultSourceResolvedAt:null,fallbackResultVid:"",resultType:"",resultText:"",resultUrls:[],providerJobId:"",recoveryState:"",error:null,evidence:null,safeToRetry:false,notSentVerified:false,terminalFailureVerified:false,outcomeCode:"",submittedVerified:false,accountAction:"",retryMode:"",requiresPromptEdit:false,failureCode:"",failureCategory:"",providerMessage:"",userAction:"",quotaConsumed:null,failureEvidence:null,steps:[{at:timestamp,state:"queued",message:revised?"由修改后重试创建：原失败任务保留":"由安全重试创建：原任务已明确终止"}],archivedAt:null,deletedAt:null,createdAt:timestamp,updatedAt:timestamp};state.tasks.unshift(clone);this.save(state);return this.publicTask(clone);
  }
  archiveTask(taskId, archived=true) { const state=this.load();const task=this.task(state,taskId);if(!task)throw new Error("任务不存在");if(!["completed","failed","cancelled"].includes(task.state))throw new Error("只能归档已结束任务");task.archivedAt=archived?now():null;task.updatedAt=now();this.save(state);return this.publicTask(task); }
  deleteTask(taskId) { const state=this.load();const task=this.task(state,taskId);if(!task)throw new Error("任务不存在");if(!["draft","completed","failed","cancelled"].includes(task.state))throw new Error("运行中的任务不能删除");task.deletedAt=now();task.updatedAt=task.deletedAt;this.save(state);return{ok:true,trashed:task.title}; }
  restoreTask(taskId) { const state=this.load();const task=this.task(state,taskId);if(!task)throw new Error("任务不存在");task.deletedAt=null;task.updatedAt=now();this.save(state);return this.publicTask(task); }
  publicTask(task) { const parameters=normalizeTaskParameters(task.parameters||task.modelParameters),resultItems=normalizeResultItems(task.resultItems);const resultAssetIds=[...new Set((Array.isArray(task.resultAssetIds)?task.resultAssetIds:resultItems.map(item=>item.assetId)).map(String).filter(Boolean))];return {id:task.id,parentTaskId:task.parentTaskId||"",batchId:task.batchId||"",batchKey:task.batchKey||"",projectId:task.projectId,title:task.title,prompt:task.prompt,creationType:task.creationType||"video",creationSource:task.creationSource||"",executionChannel:task.executionChannel||"",tenantId:task.tenantId||path.basename(this.root()),providerId:task.providerId||"",modelId:task.modelId||task.model||"",clientRequestId:task.clientRequestId||"",assetIds:Array.isArray(task.assetIds)?task.assetIds:[],referenceAssets:normalizeTaskReferenceAssets(task.referenceAssets,task.assetIds),model:task.model||task.modelId||"",doubaoModel:task.doubaoModel||"Seedance 2.0 Mini",ratio:task.ratio||"",duration:task.duration||"",resolution:task.resolution||"",parameters,modelParameters:{...parameters},generationMode:task.generationMode||parameters.mode||"",accountGroupId:task.accountGroupId||"",accountSelectionMode:task.accountSelectionMode||"manual",accountCandidates:normalizeAccountCandidates(task.accountCandidates),accountAttempts:Array.isArray(task.accountAttempts)?task.accountAttempts.map(item=>({...item})):[],quotaFailures:Array.isArray(task.quotaFailures)?task.quotaFailures.map(item=>({...item})):[],quotaResetAt:task.quotaResetAt||null,accountId:task.accountId||"",accountName:task.accountName||"",conversationId:task.conversationId||"",conversationVid:task.conversationVid||task.conversationId||"",videoVid:task.videoVid||"",executionAttemptId:task.executionAttemptId||"",executionCheckpoint:normalizeExecutionCheckpoint(task.executionCheckpoint),lastHeartbeatAt:task.lastHeartbeatAt||null,state:task.state,stage:task.stage||task.state,progressMode:task.progressMode||"determinate",monitorAttempt:Number(task.monitorAttempt||0),lastCheckedAt:task.lastCheckedAt||null,monitorError:task.monitorError||"",monitorProbe:task.monitorProbe||null,statusText:task.statusText||"",progress:Number(task.progress||0),safeToRetry:task.safeToRetry===true,notSentVerified:task.notSentVerified===true,terminalFailureVerified:task.terminalFailureVerified===true,outcomeCode:task.outcomeCode||task.failureCode||"",submittedVerified:task.submittedVerified===true,accountAction:task.accountAction||"",retryMode:task.retryMode||"",requiresPromptEdit:task.requiresPromptEdit===true,failureCode:task.failureCode||"",failureCategory:task.failureCategory||"",providerMessage:task.providerMessage||"",userAction:task.userAction||"",quotaConsumed:typeof task.quotaConsumed==="boolean"?task.quotaConsumed:null,failureEvidence:task.failureEvidence||null,resultAssetId:task.resultAssetId||resultAssetIds[0]||"",resultAssetIds,resultItems,expectedResultCount:Math.max(0,Number(task.expectedResultCount)||resultItems.filter(item=>item.required!==false).length),recoveredResultCount:Math.max(0,Number(task.recoveredResultCount)||resultItems.filter(item=>item.required!==false&&item.status==="imported"&&item.assetId).length),resultVid:task.resultVid||"",resultUrlSource:task.resultUrlSource||"",watermarkFree:typeof task.watermarkFree==="boolean"?task.watermarkFree:null,watermarkFreeError:task.watermarkFreeError||"",resultSourceResolvedAt:task.resultSourceResolvedAt||null,fallbackResultVid:task.fallbackResultVid||"",resultType:task.resultType||"",resultText:task.resultText||"",resultUrls:Array.isArray(task.resultUrls)?task.resultUrls.slice():[],providerJobId:task.providerJobId||"",recoveryState:task.recoveryState||"",resultUrlCapturedAt:task.resultUrlCapturedAt||null,error:task.error||null,evidence:task.evidence||null,steps:(task.steps||[]).map(item=>({...item})),archivedAt:task.archivedAt||null,deletedAt:task.deletedAt||null,createdAt:task.createdAt,updatedAt:task.updatedAt}; }
}

module.exports = {WorkbenchDataBridge, TYPE_EXTENSIONS, TYPE_LIMITS, TASK_STATES, DOUBAO_MODELS, DOUBAO_RATIOS, REFERENCE_ROLES, RESULT_ITEM_STATES, cleanName, inside, mediaType, shanghaiDateKey, nextShanghaiMidnight, normalizeDoubaoDuration, normalizeTaskReferenceAssets, normalizeResultItems, doubaoBatchKey, normalizeExecutionCheckpoint};
