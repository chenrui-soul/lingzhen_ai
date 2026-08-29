"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PROTOCOLS = new Set(["openai-compatible", "openai-responses", "anthropic-compatible", "custom-json"]);
const CAPABILITIES = new Set(["text", "image", "video", "audio"]);
const VISUAL_RATIOS = ["自动", "3:4", "4:3", "9:16", "16:9", "1:1", "21:9"];
const MAX_INLINE_REFERENCE_BYTES = 32 * 1024 * 1024;
const id = () => crypto.randomUUID().replaceAll("-", "");
const now = () => new Date().toISOString();
const text = (value, max = 500) => String(value ?? "").trim().slice(0, max);
const clone = value => JSON.parse(JSON.stringify(value));

function validUrl(value) {
  const url = new URL(String(value || ""));
  if (!/^https?:$/.test(url.protocol)) throw new Error("API Base URL 仅支持 HTTP/HTTPS");
  return url.toString().replace(/\/$/, "");
}
function endpointUrl(baseUrl, requestPath) {
  const base = new URL(String(baseUrl || ""));
  const baseParts = base.pathname.split("/").filter(Boolean);
  const pathParts = String(requestPath || "").split("/").filter(Boolean);
  while (baseParts.length && pathParts.length && baseParts.at(-1) === pathParts[0]) pathParts.shift();
  base.pathname = `/${[...baseParts, ...pathParts].join("/")}`;
  return base.toString();
}
function inferCapabilities(modelId, supplied = {}) {
  const name = String(modelId || "").toLowerCase();
  let inferredType = "text";
  if (/video|vidu|seedance|veo|kling|hailuo|runway|luma|wan\d|sora/.test(name)) inferredType = "video";
  else if (/image|imagegen|dall|flux|midjourney|stable[._-]?diffusion|sdxl|wanx/.test(name)) inferredType = "image";
  else if (/audio|speech|tts|voice|music/.test(name)) inferredType = "audio";
  const suppliedType = supplied && typeof supplied === "object" && CAPABILITIES.has(String(supplied.type || "")) ? String(supplied.type) : "";
  const adapterMayReinfer = supplied?.source === "adapter" && supplied?.confirmed !== true;
  const type = suppliedType && !adapterMayReinfer ? suppliedType : inferredType;
  const result = {type, modes: type === "video" ? ["text-to-video", "image-to-video", "video-to-video"] : type === "image" ? ["text-to-image", "image-to-image"] : type === "audio" ? ["text-to-audio", "audio-to-audio"] : [type], ratios: ["image", "video"].includes(type) ? ["1:1", "16:9", "9:16"] : [], durations: type === "video" ? ["5s", "10s"] : type === "audio" ? ["15s", "30s", "60s"] : [], resolutions: ["image", "video"].includes(type) ? ["720p", "1080p"] : [], maxReferenceImages: ["image", "video"].includes(type) ? 4 : 0, maxReferenceVideos:type === "video" ? 1 : 0, maxReferenceAudios:type === "audio" ? 1 : 0, source: "adapter", confirmed: false};
  if (supplied && typeof supplied === "object") {
    const extra = clone(supplied);
    if (adapterMayReinfer) for (const key of ["type", "modes", "ratios", "durations", "resolutions", "maxReferenceImages", "maxReferenceVideos", "maxReferenceAudios"]) delete extra[key];
    Object.assign(result, extra);
  }
  if (!CAPABILITIES.has(result.type)) result.type = inferredType;
  if (["image", "video"].includes(result.type)) result.ratios = [...new Set([...VISUAL_RATIOS, ...(Array.isArray(result.ratios) ? result.ratios : [])])];
  return result;
}

function normalizeGenerationParameters(type, input = {}) {
  const parameters=input&&typeof input==="object"?clone(input):{};
  if(["image","video"].includes(type)){const ratio=text(parameters.aspect_ratio??parameters.ratio,40);delete parameters.ratio;if(ratio&&ratio!=="自动")parameters.aspect_ratio=ratio;else delete parameters.aspect_ratio;}
  if(type==="video"){const rawDuration=parameters.seconds??parameters.duration;delete parameters.duration;if(rawDuration!==undefined&&rawDuration!==null&&rawDuration!==""){const seconds=Number(String(rawDuration).replace(/s$/i,""));if(Number.isFinite(seconds)&&seconds>0)parameters.seconds=seconds;}}
  return parameters;
}

function collectResultUrls(data) {
  const urls=[],seen=new Set();const add=value=>{const url=String(value||"").trim();if(!url||seen.has(url))return;if(/^(?:https?:|data:)/i.test(url)){seen.add(url);urls.push(url);}};
  const visit=(value,depth=0)=>{if(depth>5||value===null||value===undefined)return;if(typeof value==="string"){add(value);return;}if(Array.isArray(value)){for(const item of value)visit(item,depth+1);return;}if(typeof value!=="object")return;add(value.url);add(value.video_url);add(value.image_url);add(value.audio_url);add(value.download_url);if(value.b64_json)add(`data:application/octet-stream;base64,${value.b64_json}`);for(const key of ["data","images","image_urls","videos","video_urls","audios","audio_urls","output","result","results","content"])visit(value[key],depth+1);};visit(data);return urls;
}

function generationStatus(data={}) { return text(data.status||data.state||data.task_status||data.result?.status,60).toLowerCase(); }
function expectedResultCount(data = {}, fallback = 0) {
  const values=[data.expected_result_count,data.expected_count,data.result_count,data.output_count,data.n,data.result?.expected_count,data.result?.count,fallback];
  for(const value of values){const count=Number(value);if(Number.isFinite(count)&&count>0)return Math.max(1,Math.min(20,Math.floor(count)));}
  return 0;
}

function pathTemplate(value, replacements = {}) {
  let result = text(value, 300);
  for (const [key, replacement] of Object.entries(replacements)) result = result.replaceAll(`{${key}}`, encodeURIComponent(String(replacement || "")));
  return result;
}

function generationRoute(provider, type) {
  let hostname = "";
  try { hostname = new URL(provider.baseUrl).hostname.toLowerCase(); } catch {}
  const isCaiCai = hostname === "caicaiapi.cloud" || hostname.endsWith(".caicaiapi.cloud");
  if (type === "image") {
    return {
      submitPath: text(provider.imageTasksPath, 160) || (isCaiCai ? "/v1/images/tasks" : provider.imagesPath),
      statusPath: text(provider.imageStatusPath, 200) || (isCaiCai ? "/v1/images/tasks/{id}" : ""),
      cancelPath: text(provider.imageCancelPath, 200),
      asynchronous: Boolean(text(provider.imageTasksPath, 160) || isCaiCai),
      notFoundOn404: isCaiCai
    };
  }
  if (type === "video") {
    const submitPath = provider.videosPath === "/v1/videos/generations" ? "/v1/videos" : provider.videosPath;
    return {submitPath, statusPath:text(provider.videoStatusPath,200)||"/v1/videos/{id}", cancelPath:text(provider.videoCancelPath,200), asynchronous:true, notFoundOn404:isCaiCai};
  }
  return {submitPath:type === "audio" ? provider.audiosPath : provider.protocol === "openai-responses" ? provider.responsesPath : provider.chatPath, statusPath:"", cancelPath:"", asynchronous:false, notFoundOn404:false};
}

class ModelGatewayBridge {
  constructor({tenantRootProvider, secretProvider = () => "lingframe-model-gateway", requestJson = null} = {}) {
    if (typeof tenantRootProvider !== "function") throw new Error("tenantRootProvider 必须是函数");
    this.tenantRootProvider = tenantRootProvider;
    this.secretProvider = secretProvider;
    this.requestJson = requestJson || this.defaultRequestJson.bind(this);
    this.providerSemaphores = new Map();
  }
  root() {
    const root = this.tenantRootProvider();
    if (!root) throw new Error("桌面身份尚未验证，无法访问模型网关");
    const resolved = path.resolve(root);
    fs.mkdirSync(path.join(resolved, "database"), {recursive: true});
    return resolved;
  }
  stateFile() { return path.join(this.root(), "database", "model-gateway-v1.json"); }
  secretFile() { return path.join(this.root(), "database", "model-provider-secrets-v1.json"); }
  loadState() {
    try { const state = JSON.parse(fs.readFileSync(this.stateFile(), "utf8")); if (Array.isArray(state.providers)) return state; } catch {}
    return {version: 1, providers: []};
  }
  saveState(state) { const file = this.stateFile(); const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8"); fs.renameSync(tmp, file); }
  loadSecrets() { try { return JSON.parse(fs.readFileSync(this.secretFile(), "utf8")); } catch { return {version: 1, entries: {}}; } }
  saveSecrets(value) { const file = this.secretFile(); const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8"); fs.renameSync(tmp, file); }
  key() { return crypto.createHash("sha256").update(`${this.secretProvider()}|lingframe-model-gateway-v1`).digest(); }
  encrypt(value) { const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv("aes-256-gcm", this.key(), iv); const data = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]); return {v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64")}; }
  decrypt(entry) { if (!entry || entry.v !== 1) return ""; const decipher = crypto.createDecipheriv("aes-256-gcm", this.key(), Buffer.from(entry.iv, "base64")); decipher.setAuthTag(Buffer.from(entry.tag, "base64")); return Buffer.concat([decipher.update(Buffer.from(entry.data, "base64")), decipher.final()]).toString("utf8"); }
  publicModel(model) { return {id: model.id, displayName: model.displayName, enabled: model.enabled !== false, hidden: model.hidden === true, sortOrder: Number(model.sortOrder || 0), parameters: clone(model.parameters || {}), capabilities: inferCapabilities(model.id, model.capabilities), detectedAt: model.detectedAt || null}; }
  secretPayload(provider) { const secrets = this.loadSecrets(); if (!provider.secretRef || !secrets.entries[provider.secretRef]) return {apiKey: "", customHeaders: {}}; try { const decoded = this.decrypt(secrets.entries[provider.secretRef]); const parsed = JSON.parse(decoded); return {apiKey: text(parsed.apiKey, 2000), customHeaders: parsed.customHeaders && typeof parsed.customHeaders === "object" ? parsed.customHeaders : {}}; } catch { return {apiKey: "", customHeaders: {}}; } }
  publicProvider(provider) { return {id: provider.id, name: provider.name, protocol: provider.protocol, baseUrl: provider.baseUrl, modelsPath: provider.modelsPath, chatPath: provider.chatPath, responsesPath: provider.responsesPath, imagesPath: provider.imagesPath, imageTasksPath:provider.imageTasksPath||"", imageStatusPath:provider.imageStatusPath||"", imageCancelPath:provider.imageCancelPath||"", videosPath: provider.videosPath, videoStatusPath:provider.videoStatusPath||"", videoCancelPath:provider.videoCancelPath||"", requestStatusPath:provider.requestStatusPath||"", requestCancelPath:provider.requestCancelPath||"", audiosPath:provider.audiosPath, organization: provider.organization || "", project: provider.project || "", customHeaderNames: Array.isArray(provider.customHeaderNames) ? provider.customHeaderNames : [], concurrency: provider.concurrency || 1, timeoutSeconds: provider.timeoutSeconds || 60, enabled: provider.enabled !== false, hasApiKey: provider.hasApiKey === true, apiKeyMask: provider.hasApiKey ? "••••••••" : "", status: provider.status || "unverified", statusText: provider.statusText || "", lastTestedAt: provider.lastTestedAt || null, models: (provider.models || []).map(item => this.publicModel(item)), createdAt: provider.createdAt, updatedAt: provider.updatedAt}; }
  provider(idValue) { return this.loadState().providers.find(item => item.id === String(idValue || "")) || null; }
  normalize(input = {}, existing = {}) {
    const protocol = text(input.protocol ?? existing.protocol ?? "openai-compatible", 40); if (!PROTOCOLS.has(protocol)) throw new Error("不支持的模型协议");
    const baseUrl = validUrl(input.baseUrl ?? existing.baseUrl); const timestamp = now();
    const headerNames = input.customHeaders !== undefined ? Object.keys(input.customHeaders && typeof input.customHeaders === "object" ? input.customHeaders : {}).map(value => text(value,80)).filter(Boolean) : (existing.customHeaderNames || []);
    return {...existing, name: text(input.name ?? existing.name, 100) || "未命名厂商", protocol, baseUrl, modelsPath: text(input.modelsPath ?? existing.modelsPath ?? "/v1/models", 160) || "/v1/models", chatPath: text(input.chatPath ?? existing.chatPath ?? "/v1/chat/completions", 160), responsesPath: text(input.responsesPath ?? existing.responsesPath ?? "/v1/responses", 160), imagesPath: text(input.imagesPath ?? existing.imagesPath ?? "/v1/images/generations", 160), imageTasksPath:text(input.imageTasksPath ?? existing.imageTasksPath,160), imageStatusPath:text(input.imageStatusPath ?? existing.imageStatusPath,200), imageCancelPath:text(input.imageCancelPath ?? existing.imageCancelPath,200), videosPath: text(input.videosPath ?? existing.videosPath ?? "/v1/videos/generations", 160), videoStatusPath:text(input.videoStatusPath ?? existing.videoStatusPath,200), videoCancelPath:text(input.videoCancelPath ?? existing.videoCancelPath,200), requestStatusPath:text(input.requestStatusPath ?? existing.requestStatusPath,200), requestCancelPath:text(input.requestCancelPath ?? existing.requestCancelPath,200), audiosPath:text(input.audiosPath ?? existing.audiosPath ?? "/v1/audio/generations",160), organization: text(input.organization ?? existing.organization, 200), project: text(input.project ?? existing.project, 200), customHeaderNames: headerNames, concurrency: Math.max(1, Math.min(64, Number(input.concurrency ?? existing.concurrency ?? 1) || 1)), timeoutSeconds: Math.max(5, Math.min(600, Number(input.timeoutSeconds ?? existing.timeoutSeconds ?? 60) || 60)), enabled: input.enabled === undefined ? existing.enabled !== false : input.enabled === true, models: existing.models || [], createdAt: existing.createdAt || timestamp, updatedAt: timestamp};
  }
  createProvider(input = {}) { const state = this.loadState(); const provider = this.normalize(input, {id: id()}); const apiKey = text(input.apiKey, 2000); const customHeaders = input.customHeaders && typeof input.customHeaders === "object" ? Object.fromEntries(Object.entries(input.customHeaders).map(([k,v]) => [text(k,80), text(v,500)]).filter(([k,v]) => k && v)) : {}; if (apiKey || Object.keys(customHeaders).length) { const secrets = this.loadSecrets(); secrets.entries[provider.id] = this.encrypt(JSON.stringify({apiKey, customHeaders})); provider.secretRef = provider.id; provider.hasApiKey = Boolean(apiKey); this.saveSecrets(secrets); } state.providers.unshift(provider); this.saveState(state); return this.publicProvider(provider); }
  updateProvider(providerId, input = {}) { const state = this.loadState(); const provider = state.providers.find(item => item.id === String(providerId || "")); if (!provider) throw new Error("模型厂商不存在"); const next = this.normalize(input, provider); const prior = this.secretPayload(provider); const apiKey = input.apiKey === undefined ? prior.apiKey : text(input.apiKey, 2000); const customHeaders = input.customHeaders === undefined ? prior.customHeaders : (input.customHeaders && typeof input.customHeaders === "object" ? Object.fromEntries(Object.entries(input.customHeaders).map(([k,v]) => [text(k,80), text(v,500)]).filter(([k,v]) => k && v)) : {}); const secrets = this.loadSecrets(); if (apiKey || Object.keys(customHeaders).length) { secrets.entries[provider.id] = this.encrypt(JSON.stringify({apiKey, customHeaders})); next.secretRef = provider.id; next.hasApiKey = Boolean(apiKey); } else { delete secrets.entries[provider.id]; delete next.secretRef; next.hasApiKey = false; } this.saveSecrets(secrets); state.providers[state.providers.indexOf(provider)] = next; this.saveState(state); return this.publicProvider(next); }
  deleteProvider(providerId) { const state = this.loadState(); const index = state.providers.findIndex(item => item.id === String(providerId || "")); if (index < 0) throw new Error("模型厂商不存在"); const provider = state.providers[index]; state.providers.splice(index, 1); this.saveState(state); const secrets = this.loadSecrets(); delete secrets.entries[provider.id]; this.saveSecrets(secrets); return {ok: true, deleted: provider.id}; }
  addModel(providerId, input = {}) {
    const state = this.loadState();
    const provider = state.providers.find(item => item.id === String(providerId || ""));
    if (!provider) throw new Error("模型厂商不存在");
    const modelId = text(input.id, 180);
    if (!modelId) throw new Error("模型 ID 不能为空");
    if ((provider.models || []).some(item => item.id === modelId)) throw new Error("模型已存在");
    const suppliedCapabilities = input.capabilities && typeof input.capabilities === "object" ? clone(input.capabilities) : {};
    const capabilities = suppliedCapabilities.source === "adapter"
      ? inferCapabilities(modelId, suppliedCapabilities)
      : inferCapabilities(modelId, {...suppliedCapabilities, source: "manual", confirmed: true});
    provider.models = provider.models || [];
    provider.models.push({id: modelId, displayName: text(input.displayName || modelId, 180), enabled: input.enabled !== false, hidden: input.hidden === true, sortOrder: provider.models.length, parameters: input.parameters && typeof input.parameters === "object" ? clone(input.parameters) : {}, capabilities, detectedAt: input.detectedAt || null});
    provider.updatedAt = now();
    this.saveState(state);
    return this.publicProvider(provider);
  }
  updateModel(providerId, modelId, input = {}) { const state = this.loadState(); const provider = state.providers.find(item => item.id === String(providerId || "")); const model = provider?.models?.find(item => item.id === String(modelId || "")); if (!provider || !model) throw new Error("模型不存在"); if (input.displayName !== undefined) model.displayName = text(input.displayName, 180) || model.displayName; if (input.enabled !== undefined) model.enabled = input.enabled === true; if (input.hidden !== undefined) model.hidden = input.hidden === true; if (input.parameters !== undefined) model.parameters = input.parameters && typeof input.parameters === "object" ? clone(input.parameters) : {}; if (input.capabilities !== undefined) model.capabilities = inferCapabilities(model.id, input.capabilities); provider.updatedAt = now(); this.saveState(state); return this.publicProvider(provider); }
  deleteModel(providerId, modelId) { const state = this.loadState(); const provider = state.providers.find(item => item.id === String(providerId || "")); if (!provider) throw new Error("模型厂商不存在"); const index = (provider.models || []).findIndex(item => item.id === String(modelId || "")); if (index < 0) throw new Error("模型不存在"); provider.models.splice(index, 1); provider.updatedAt = now(); this.saveState(state); return this.publicProvider(provider); }
  async testProvider(providerId) { const provider = this.provider(providerId); if (!provider) throw new Error("模型厂商不存在"); const result = await this.requestJson(provider, provider.modelsPath || "/v1/models"); provider.status = result.ok ? "online" : "error"; provider.statusText = result.ok ? "连接成功" : text(result.error || "连接失败", 300); provider.lastTestedAt = now(); provider.updatedAt = provider.lastTestedAt; const state = this.loadState(); const current = state.providers.find(item => item.id === provider.id); Object.assign(current, provider); this.saveState(state); return {ok: result.ok, status: provider.status, statusText: provider.statusText, provider: this.publicProvider(provider)}; }
  async discoverModels(providerId) {
    const provider = this.provider(providerId);
    if (!provider) throw new Error("模型厂商不存在");
    const result = await this.requestJson(provider, provider.modelsPath || "/v1/models");
    if (!result.ok) throw new Error(text(result.error || "获取模型列表失败", 300));
    const raw = Array.isArray(result.body) ? result.body : Array.isArray(result.body?.data) ? result.body.data : Array.isArray(result.body?.models) ? result.body.models : [];
    const discovered = raw.map((item, index) => typeof item === "string" ? {id: item, displayName: item, sortOrder: index, capabilities: {}} : {id: item.id || item.name, displayName: item.displayName || item.name || item.id, sortOrder: index, capabilities: item.capabilities || {}}).filter(item => item.id);
    const state = this.loadState();
    const current = state.providers.find(item => item.id === provider.id);
    const existingModels = Array.isArray(current.models) ? current.models : [];
    const existingById = new Map(existingModels.map(item => [String(item.id), item]));
    const discoveredIds = new Set(discovered.map(item => String(item.id)));
    const detectedAt = now();
    const mergedDiscovered = discovered.map(item => {
      const existing = existingById.get(String(item.id));
      const discoveredCapabilities = inferCapabilities(item.id, {...clone(item.capabilities || {}), source: "adapter", confirmed: false});
      if (!existing) return {...item, enabled: true, hidden: false, parameters: {}, capabilities: discoveredCapabilities, detectedAt};
      const existingCapabilities = existing.capabilities?.confirmed === true || existing.capabilities?.source === "manual"
        ? inferCapabilities(item.id, existing.capabilities)
        : inferCapabilities(item.id, existing.capabilities || discoveredCapabilities);
      return {...item, ...existing, id: item.id, displayName: existing.displayName || item.displayName || item.id, enabled: existing.enabled !== false, hidden: existing.hidden === true, sortOrder: Number.isFinite(Number(existing.sortOrder)) ? Number(existing.sortOrder) : item.sortOrder, parameters: clone(existing.parameters || {}), capabilities: existingCapabilities, detectedAt};
    });
    const retainedModels = existingModels.filter(item => !discoveredIds.has(String(item.id))).map(item => ({...item, capabilities: inferCapabilities(item.id, item.capabilities)}));
    current.models = [...mergedDiscovered, ...retainedModels];
    current.status = "online";
    current.statusText = `已获取 ${discovered.length} 个模型，共保留 ${current.models.length} 个配置`;
    current.lastTestedAt = now();
    current.updatedAt = current.lastTestedAt;
    this.saveState(state);
    return this.publicProvider(current);
  }
  bootstrap() { return this.loadState().providers.map(item => this.publicProvider(item)); }
  async acquireProviderSlot(provider) {
    const providerId=String(provider?.id||""),limit=Math.max(1,Math.min(64,Number(provider?.concurrency)||1));let semaphore=this.providerSemaphores.get(providerId);
    if(!semaphore){semaphore={active:0,limit,queue:[]};this.providerSemaphores.set(providerId,semaphore);}semaphore.limit=limit;
    if(semaphore.active<semaphore.limit)semaphore.active+=1;else await new Promise(resolve=>semaphore.queue.push(resolve));
    let released=false;return()=>{if(released)return;released=true;const next=semaphore.queue.shift();if(next)next();else semaphore.active=Math.max(0,semaphore.active-1);if(!semaphore.active&&!semaphore.queue.length)this.providerSemaphores.delete(providerId);};
  }
  async withProviderSlot(provider, operation) { const release=await this.acquireProviderSlot(provider);try{return await operation();}finally{release();} }
  async defaultRequestJson(provider, requestPath, options = {}) { const secret = this.secretPayload(provider); const headers = {'Accept': 'application/json', ...secret.customHeaders, ...(options.headers || {})}; if (secret.apiKey) headers.Authorization = `Bearer ${secret.apiKey}`; const timeoutSeconds=Math.max(5,Math.min(600,Number(options.timeoutSeconds ?? provider.timeoutSeconds ?? 60)||60));const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000); try { const response = await fetch(endpointUrl(provider.baseUrl, requestPath), {method: options.method || "GET", headers: {...headers, ...(options.body ? {'Content-Type': 'application/json'} : {})}, body: options.body ? JSON.stringify(options.body) : undefined, signal: controller.signal}); const body = await response.json().catch(() => ({})); return {ok: response.ok, status: response.status, body, error: response.ok ? "" : body?.error?.message || body?.message || `HTTP ${response.status}`, transportError:false}; } catch (error) { return {ok: false, error: error.name === "AbortError" ? "请求超时" : error.message, transportError:true, errorCode:error.cause?.code||error.code||""}; } finally { clearTimeout(timer); } }
  referencePayload(assets = []) {
    const references=[];
    for(const asset of assets){
      if(!asset?.path||!fs.existsSync(asset.path))continue;
      const stat=fs.statSync(asset.path);
      if(stat.size>MAX_INLINE_REFERENCE_BYTES)throw new Error(`参考素材“${asset.name||path.basename(asset.path)}”超过 32MB，通用 JSON 网关不能安全内联；请压缩素材或使用厂商专用上传适配器`);
      const data=fs.readFileSync(asset.path);if(!data.length)continue;
      references.push({id:String(asset.id||""),name:text(asset.name||path.basename(asset.path),180),type:text(asset.type,20),mime:text(asset.mime||"application/octet-stream",100),dataUrl:`data:${asset.mime||"application/octet-stream"};base64,${data.toString("base64")}`});
    }
    const images=references.filter(item=>item.type==="image").map(item=>item.dataUrl),videos=references.filter(item=>item.type==="video").map(item=>item.dataUrl),audios=references.filter(item=>item.type==="audio").map(item=>item.dataUrl);
    return {references,images,videos,audios};
  }
  async generate(providerId, modelId, input = {}) {
    const provider = this.provider(providerId); if (!provider) throw new Error("模型厂商不存在");
    const model = (provider.models || []).find(item => item.id === String(modelId || "")); if (!model) throw new Error("模型不存在");
    if (provider.enabled === false || model.enabled === false) throw new Error("模型厂商或模型已停用");
    const prompt = text(input.prompt, 12000); if (!prompt) throw new Error("生成提示词不能为空");
    const type = inferCapabilities(model.id, model.capabilities).type || "text";
    const route=generationRoute(provider,type),pathName=route.submitPath;
    const clientRequestId=text(input.clientRequestId,300)||id();
    const parameters = normalizeGenerationParameters(type,{...clone(model.parameters || {}), ...(input.parameters && typeof input.parameters === "object" ? clone(input.parameters) : {})});
    const refs=this.referencePayload(input.assets || []);
    let body;
    if(type==="text"){
      const content=refs.images.length||refs.audios.length||refs.videos.length?[{type:"text",text:prompt},...refs.images.map(url=>({type:"image_url",image_url:{url}})),...refs.audios.map(url=>({type:"input_audio",input_audio:{data:url.split(",")[1],format:"base64"}})),...refs.videos.map(url=>({type:"input_video",video_url:url}))]:prompt;
      body={model:model.id,messages:[{role:"user",content}],...parameters};
    }else{
      body={model:model.id,prompt,...parameters};
      if(refs.images.length){body.image=refs.images;body.images=refs.images;body.reference_images=refs.images;}
      if(refs.videos.length){body.video=refs.videos;body.videos=refs.videos;body.reference_videos=refs.videos;}
      if(refs.audios.length){body.audio=refs.audios;body.audios=refs.audios;body.reference_audios=refs.audios;}
      if(refs.references.length)body.references=refs.references.map(({id,name,type,mime,dataUrl})=>({id,name,type,mime,data:dataUrl}));
    }
    const minimumGenerationTimeout=type==="video"?300:type==="image"?180:0;
    const result = await this.withProviderSlot(provider,()=>this.requestJson(provider, pathName, {method: "POST", body, headers:{"Idempotency-Key":clientRequestId,"X-Request-ID":clientRequestId}, timeoutSeconds:Math.max(Number(provider.timeoutSeconds)||60,minimumGenerationTimeout)}));
    if (!result.ok) { const data=result.body||{},error=new Error(text(result.error||"模型执行失败",500));error.code=result.transportError?"MODEL_SUBMISSION_UNKNOWN":"MODEL_REQUEST_FAILED";error.submissionUnknown=result.transportError===true;error.safeToRetry=false;error.providerId=provider.id;error.modelId=model.id;error.clientRequestId=clientRequestId;error.providerJobId=text(data.id||data.task_id||data.job_id||data.request_id||data.result?.id,300);error.resultType=type;throw error; }
    const data = result.body || {};
    const content = data.choices?.[0]?.message?.content || data.choices?.[0]?.text || data.output_text || data.output?.[0]?.content?.[0]?.text || data.content || "";
    const urls=collectResultUrls(data),providerJobId=text(data.id||data.task_id||data.job_id||data.request_id||data.result?.id,300),status=generationStatus(data),pending=route.asynchronous&&!urls.length&&Boolean(providerJobId)&&!["completed","succeeded","success","failed","cancelled","canceled","error"].includes(status);
    return {ok: true, type, providerId: provider.id, providerName: provider.name, modelId: model.id, content: typeof content === "string" ? content : JSON.stringify(content), urls, expectedResultCount:expectedResultCount(data,parameters.n||parameters.count||urls.length), providerJobId, clientRequestId, status, pending, raw: data};
  }
  async queryGeneration(providerId, modelId, query = {}) {
    const provider=this.provider(providerId);if(!provider)throw new Error("模型厂商不存在");const model=(provider.models||[]).find(item=>item.id===String(modelId||""));if(!model)throw new Error("模型不存在");
    const input=typeof query==="string"?{providerJobId:query}:query||{},jobId=text(input.providerJobId,300),clientRequestId=text(input.clientRequestId,300),type=text(input.type,40)||inferCapabilities(model.id,model.capabilities).type||"text",route=generationRoute(provider,type);
    let statusPath="",queryKind="";
    if(jobId&&route.statusPath){statusPath=pathTemplate(route.statusPath,{id:jobId,jobId});queryKind="providerJobId";}
    else if(clientRequestId&&provider.requestStatusPath){statusPath=pathTemplate(provider.requestStatusPath,{id:clientRequestId,requestId:clientRequestId});queryKind="clientRequestId";}
    if(!statusPath)return{supported:false,ok:false,failed:false,completed:false,pending:false,notFound:false,notSentVerified:false,status:"unsupported",urls:[],providerId:provider.id,modelId:model.id,providerJobId:jobId,clientRequestId,error:"当前厂商未配置可用的任务查询接口"};
    const result=await this.requestJson(provider,statusPath,{method:"GET",headers:clientRequestId?{"X-Request-ID":clientRequestId}:{}}),data=result.body||{},errorCode=text(data.error?.code||data.error?.type||data.code,100).toLowerCase(),explicitNotFound=["not_found","task_not_found","request_not_found","generation_not_found"].includes(errorCode),notFound=explicitNotFound||(route.notFoundOn404&&result.status===404);
    if(!result.ok&&!notFound){const error=new Error(text(result.error||"查询厂商任务失败",500));error.transportError=result.transportError===true;error.querySupported=true;error.providerJobId=jobId;error.clientRequestId=clientRequestId;throw error;}
    const status=notFound?"not_found":generationStatus(data),urls=collectResultUrls(data),failed=!notFound&&["failed","cancelled","canceled","error"].includes(status),completed=!notFound&&(["completed","succeeded","success"].includes(status)||Boolean(urls.length)),resolvedJobId=text(data.id||data.task_id||data.job_id||data.request_id||data.result?.id,300)||jobId;
    return{supported:true,ok:!failed&&!notFound,failed,completed,pending:!failed&&!completed&&!notFound,notFound,notSentVerified:notFound&&queryKind==="clientRequestId",status,urls,expectedResultCount:expectedResultCount(data,urls.length),providerId:provider.id,modelId:model.id,providerJobId:resolvedJobId,clientRequestId,error:text(data.error?.message||data.message||result.error,500),raw:data};
  }
  async cancelGeneration(providerId, modelId, query = {}) {
    const provider=this.provider(providerId);if(!provider)throw new Error("模型厂商不存在");const model=(provider.models||[]).find(item=>item.id===String(modelId||""));if(!model)throw new Error("模型不存在");
    const input=query||{},jobId=text(input.providerJobId,300),clientRequestId=text(input.clientRequestId,300),type=text(input.type,40)||inferCapabilities(model.id,model.capabilities).type||"text",route=generationRoute(provider,type);
    const template=jobId?route.cancelPath:provider.requestCancelPath,pathName=pathTemplate(template,{id:jobId||clientRequestId,jobId,requestId:clientRequestId});if(!pathName)return{supported:false,cancelled:false,error:"当前厂商未配置远程取消接口"};
    const result=await this.requestJson(provider,pathName,{method:"POST",headers:clientRequestId?{"X-Request-ID":clientRequestId}:{},body:{id:jobId||clientRequestId}});return{supported:true,cancelled:result.ok,status:result.status||0,error:text(result.error||result.body?.message,500)};
  }
}

module.exports = {ModelGatewayBridge, inferCapabilities, endpointUrl, normalizeGenerationParameters, collectResultUrls, generationRoute, expectedResultCount, PROTOCOLS, VISUAL_RATIOS};
