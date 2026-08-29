"use strict";

const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const {spawn} = require("child_process");
const {VideoDownloader} = require("./video-downloader.cjs");
const {DOUBAO_LOGIN_PROBE_EXPRESSION, classifyDoubaoLoginState, hasDecisivePageLoginSignal} = require("./doubao-login-state.cjs");
const {extractVideoVids, normalizeVideoVid, isVideoResourceRequest} = require("./doubao-video-identifiers.cjs");
const {resolveDoubaoWatermarkFreeVideo, isTrustedDoubaoVideoUrl, summarizeWatermarkFreeError} = require("./doubao-watermark-free-resolver.cjs");

const DOUBAO_VIDEO_MODELS = new Set(["Seedance 2.0 Fast", "Seedance 2.0 Mini"]);
const DOUBAO_VIDEO_RATIOS = new Set(["自动", "3:4", "4:3", "9:16", "16:9", "1:1", "21:9"]);
const REFERENCE_ROLE_LABELS = {character:"人物/角色",scene:"场景",prop:"道具",costume:"服装",pose:"姿势/构图",style:"风格",["first-frame"]:"首帧",["last-frame"]:"尾帧",other:"其他"};

function normalizeVideoParameters(payload = {}) {
  const requestedModel=String(payload.doubaoModel||"").trim();const requestedRatio=String(payload.ratio||"").trim();const seconds=Math.max(4,Math.min(15,Number.parseInt(String(payload.duration||"10"),10)||10));
  return {model:DOUBAO_VIDEO_MODELS.has(requestedModel)?requestedModel:"Seedance 2.0 Mini",ratio:DOUBAO_VIDEO_RATIOS.has(requestedRatio)?requestedRatio:"自动",duration:seconds};
}

function normalizeReferenceAssets(payload = {}) {
  const source=Array.isArray(payload.imageAssets)?payload.imageAssets:[];
  const unique=[];
  for(const item of source){
    if(!item||item.type&&item.type!=="image")continue;
    const filePath=path.resolve(String(item.path||""));
    if(!filePath||!fs.existsSync(filePath)||!fs.statSync(filePath).isFile())throw referenceUploadError(`参考图片文件不存在：${item.name||item.id||path.basename(filePath)}`);
    const ext=path.extname(filePath).toLowerCase();
    if(![".jpg",".jpeg",".png",".webp"].includes(ext))throw referenceUploadError(`豆包参考图不支持该格式：${path.basename(filePath)}`);
    if(unique.some(asset=>asset.path.toLowerCase()===filePath.toLowerCase()))continue;
    const name=String(item.name||item.originalName||path.basename(filePath));const role=normalizeReferenceRole(item.role||inferReferenceRole({...item,name}));const label=String(item.label||name).trim().slice(0,120)||name;const description=String(item.description||defaultReferenceDescription({role,label})).trim().slice(0,500);
    unique.push({id:String(item.id||""),name,originalName:String(item.originalName||path.basename(filePath)),mime:String(item.mime||"image/*"),size:Number(item.size||fs.statSync(filePath).size),path:filePath,role,label,description,order:Math.max(1,Math.min(10,Number(item.order)||unique.length+1))});
  }
  if(unique.length>10)throw referenceUploadError("单个豆包任务最多上传 10 张参考图，请精简人物、场景和道具素材");
  return unique.sort((a,b)=>a.order-b.order);
}

function normalizeReferenceRole(value) { const role=String(value||"").trim();return Object.hasOwn(REFERENCE_ROLE_LABELS,role)?role:"other"; }
function inferReferenceRole(item = {}) {
  const text=[item.name,item.originalName,item.notes,...(Array.isArray(item.tags)?item.tags:[])].filter(Boolean).join(" ");
  if(/首帧|第一帧|起始帧/.test(text))return"first-frame";if(/尾帧|末帧|结束帧/.test(text))return"last-frame";if(/场景|环境|建筑|室内|室外|街道|巷|便利店|房间|背景/.test(text))return"scene";if(/道具|物件|物品|武器|伞|车辆|手机|杯|门|桌|椅/.test(text))return"prop";if(/服装|服饰|衣服|造型|妆容/.test(text))return"costume";if(/姿势|动作|构图|机位|运镜/.test(text))return"pose";if(/风格|色调|画风|质感|光影/.test(text))return"style";if(/人物|角色|男主|女主|男人|女人|男孩|女孩|店员|陌生人|头像|人像/.test(text))return"character";return"other";
}
function defaultReferenceDescription(item = {}) {
  const role=normalizeReferenceRole(item.role),label=String(item.label||item.name||"参考素材").trim();
  return {character:`角色“${label}”的人物外观参考，只参考人物身份、发型、服装和整体造型。`,scene:`场景“${label}”的环境参考，用于空间、建筑、灯光、天气和氛围。`,prop:`道具“${label}”的造型参考，用于外形、颜色、材质和细节。`,costume:`服装“${label}”的造型参考，用于服饰、配色和穿着细节。`,pose:`“${label}”的姿势与构图参考，用于动作、机位和画面布局。`,style:`“${label}”的视觉风格参考，用于画风、色调、光影和质感。`,["first-frame"]:`“${label}”作为视频首帧参考，保持起始画面的主体与构图。`,["last-frame"]:`“${label}”作为视频尾帧参考，保持结束画面的主体与构图。`,other:`“${label}”作为补充参考图，仅使用与视频内容相关的视觉信息。`}[role];
}
function buildReferenceManifest(assets = []) { return assets.map((asset,index)=>`图${index+1}（${REFERENCE_ROLE_LABELS[normalizeReferenceRole(asset.role)]}）：${asset.description||defaultReferenceDescription(asset)}`); }
function buildReferencePrompt(prompt, assets = []) {
  const source=String(prompt||"").trim();if(!assets.length||source.includes("【参考图使用说明】"))return source;const manifest=buildReferenceManifest(assets);
  return `【视频内容】\n${source}\n\n【参考图使用说明】\n${manifest.join("\n")}\n\n请严格按照以上编号使用参考图，不要混淆人物、场景、道具和其他参考素材；未特别说明时不要改变角色身份和场景关系。`;
}

function referenceUploadError(message, extra = {}) {
  return Object.assign(new Error(String(message||"参考图上传失败")),{providerTerminal:true,terminalFailureVerified:true,safeToRetry:true,notSentVerified:true,code:"DOUBAO_ASSET_UPLOAD_FAILED",category:"asset_upload",retryMode:"edit_assets",requiresPromptEdit:false,userAction:"参考图没有完整上传到豆包，本次提示词尚未发送。请检查或替换素材后安全重试。",quotaConsumed:false,...extra});
}

function detectQuotaMessage(value) {
  const text=String(value||"").replace(/\s+/g," ").trim();const match=text.match(/(?:视频额度.{0,18}(?:没有|不足|用完|耗尽|上限)|(?:今日|本日).{0,12}(?:视频|生成).{0,12}(?:次数|额度).{0,8}(?:用完|耗尽|上限)|(?:额度|次数).{0,12}(?:不足|用完|耗尽).{0,12}(?:视频|生成))/i);return match?match[0]:"";
}

function validateSubmissionContextState(state = {}, expectedConversationId = "") {
  const currentConversationId=String(state.conversationId||"").trim(),expected=String(expectedConversationId||"").trim();
  const conversationMatched=Boolean(currentConversationId)&&(!expected||currentConversationId===expected);
  const promptMatched=state.promptPresentInCurrentConversation===true&&state.userMessage===true;
  return {matched:conversationMatched&&promptMatched,conversationMatched,promptMatched,conversationId:currentConversationId,expectedConversationId:expected,userMessageId:String(state.userMessageId||""),bindingMode:String(state.bindingMode||"")};
}

function probeDoubaoVideoResultPage() {
  const validVid=value=>{const text=String(value||"").trim();return !/^https?:\/\//i.test(text)&&/^[a-z0-9_-]{8,240}$/i.test(text)?text:""};
  const candidates=[],seen=new WeakSet();
  const add=(videoVid,url="")=>{const vid=validVid(videoVid);if(!vid)return;const normalizedUrl=/^https?:\/\//i.test(String(url||""))?String(url):"";if(!candidates.some(item=>item.videoVid===vid&&item.url===normalizedUrl))candidates.push({videoVid:vid,url:normalizedUrl})};
  const scan=(value,depth=0)=>{
    if(value==null||depth>10)return;
    if(typeof value==="string"){
      if(value.length<200000&&/["'](?:vid|video_id|videoId)["']\s*:/.test(value))try{scan(JSON.parse(value),depth+1)}catch{}
      return;
    }
    if(typeof value!=="object"||seen.has(value))return;seen.add(value);
    add(value.vid||value.video_id||value.videoId,value.download_url||value.downloadUrl||value.url);
    for(const [key,item] of Object.entries(value)){
      if(["ref","_owner","stateNode","return","alternate","child","sibling"].includes(key)||String(key).startsWith("__react"))continue;
      scan(item,depth+1);
    }
  };
  const messages=[...document.querySelectorAll('[data-message-id]')].filter(node=>/你的视频生成好了|视频生成完成|生成结果/.test(node.innerText||node.textContent||""));
  const message=messages[messages.length-1]||null,card=message?.querySelector?.('[class*="block-video"],[class*="video-player"],[class*="play-icon-wrapper"]')||null;
  for(const node of [card,message].filter(Boolean)){
    for(const key of Object.keys(node)){
      if(key.startsWith("__reactProps$"))scan(node[key],0);
      if(!key.startsWith("__reactFiber$"))continue;
      let fiber=node[key];for(let index=0;fiber&&index<16;index+=1,fiber=fiber.return){scan(fiber.memoizedProps,0);scan(fiber.pendingProps,0);scan(fiber.memoizedState,0);}
    }
  }
  const descriptor=candidates[candidates.length-1]||{videoVid:"",url:""};
  const videos=[...document.querySelectorAll('video')].map(video=>({url:video.currentSrc||video.src,readyState:video.readyState,duration:video.duration}));
  const playable=videos.find(video=>/^https?:\/\//i.test(video.url||"")&&video.readyState>=2),ready=Boolean(message)||/你的视频生成好了|视频生成完成|生成结果/.test(String(document.body?.innerText||""));
  if(playable?.url)return{...playable,ready:true,videoVid:descriptor.videoVid,descriptorUrl:descriptor.url,messageId:message?.getAttribute?.("data-message-id")||""};
  if(ready&&card&&!window.__lingframeResultCardClicked){card.click();window.__lingframeResultCardClicked=true;return{clicked:true,ready:true,videoVid:descriptor.videoVid,descriptorUrl:descriptor.url,messageId:message?.getAttribute?.("data-message-id")||""};}
  return{ready,videoVid:descriptor.videoVid,descriptorUrl:descriptor.url,messageId:message?.getAttribute?.("data-message-id")||""};
}

function classifyDoubaoFailureMessage(value) {
  const text=String(value||"").replace(/\s+/g," ").trim();
  const empty={failed:false,outcomeCode:"",terminal:false,providerTerminal:false,terminalFailureVerified:false,submittedVerified:false,safeToRetry:false,notSentVerified:false,code:"",category:"",retryMode:"",accountAction:"hold",requiresPromptEdit:false,userAction:"",providerMessage:"",quotaExhausted:false,quotaConsumed:null,evidence:null};
  if(!text)return empty;
  const noCharge=/(?:生成)?额度(?:未|没有|不会)(?:扣除|消耗)|未扣除(?:生成)?额度|本次不消耗额度/i.test(text);
  const rules=[
    {code:"DOUBAO_VIDEO_QUOTA_EXHAUSTED",category:"quota",retryMode:"switch_account",requiresPromptEdit:false,userAction:"当前模型额度已用完，请切换其他可用豆包账号；全部账号用完时等待北京时间零点恢复。",pattern:/(?:今日视频生成免费次数用完|视频额度.{0,18}(?:没有|不足|用完|耗尽|上限)|(?:今日|本日).{0,16}(?:视频|生成).{0,16}(?:次数|额度).{0,10}(?:用完|耗尽|上限)|(?:额度|次数).{0,12}(?:不足|用完|耗尽).{0,12}(?:视频|生成))/i,quotaExhausted:true},
    {code:"DOUBAO_FACE_REFERENCE_REJECTED",category:"portrait_policy",retryMode:"edit_assets",requiresPromptEdit:false,userAction:"豆包因肖像保护拒绝了真人脸参考图。请更换为非真人肖像、AI生成角色设定图或动漫角色图，也可以移除人物图后改用文生视频。",pattern:/(?:肖像保护|真人脸|真人面孔|真实人脸|真人肖像).{0,48}(?:暂不支持|不支持|无法|不能|禁止|拒绝)|暂不支持上传真人脸素材/i},
    {code:"DOUBAO_REFERENCE_ROLE_AMBIGUOUS",category:"reference_mapping",retryMode:"edit_assets",requiresPromptEdit:false,userAction:"豆包无法明确参考图用途。请为每张图片标注人物、场景、道具等用途，并确认图号与上传顺序一致后重新提交。",pattern:/(?:无法|不能|难以).{0,18}(?:判断|识别|确认).{0,18}参考图.{0,18}(?:用途|对应关系)|请.{0,12}(?:说明|标注|明确).{0,18}图\s*\d+.{0,18}(?:人物|角色|场景|道具|用途)|参考图.{0,18}(?:用途不明|对应关系不清|容易混淆)/i},
    {code:"DOUBAO_REFERENCE_LIMIT_EXCEEDED",category:"asset_limit",retryMode:"edit_assets",requiresPromptEdit:false,userAction:"参考图数量超过当前模型限制。请减少图片数量，并只保留必要的人物、场景和道具参考。",pattern:/(?:参考图|图片|素材).{0,20}(?:数量|张数).{0,16}(?:过多|超出|超过|上限)|最多.{0,8}(?:张|个).{0,12}(?:参考图|图片|素材)/i},
    {code:"DOUBAO_IMAGE_QUALITY_REJECTED",category:"asset_quality",retryMode:"edit_assets",requiresPromptEdit:false,userAction:"参考图质量不符合要求。请更换清晰、无遮挡、无二维码和明显水印的图片后重新提交。",pattern:/(?:图片|参考图|素材).{0,30}(?:模糊|不清晰|分辨率过低|质量过低|遮挡严重|二维码|水印|损坏|读取失败)/i},
    {code:"DOUBAO_COPYRIGHT_ASSET_REJECTED",category:"asset_copyright",retryMode:"edit_assets",requiresPromptEdit:false,userAction:"参考素材可能涉及版权、公众人物或受保护角色。请更换为自有或已授权素材后重新提交。",pattern:/(?:参考图|图片|素材|角色).{0,30}(?:版权|著作权|公众人物|明星|名人|受保护角色|知名IP|知识产权)/i},
    {code:"DOUBAO_CONTENT_REJECTED",category:"content_policy",retryMode:"edit_prompt",requiresPromptEdit:true,userAction:"豆包已明确拒绝本次内容。请修改提示词中的侵权、违规、暴力、惊悚或敏感描述后重新提交。",pattern:/(?:生成内容|内容|提示词).{0,32}(?:疑似|包含|涉及|存在).{0,20}(?:侵权|违规|违法|敏感|风险|不安全)|无法返回该内容|换个主题再试试|不符合(?:平台|社区|相关).{0,10}(?:规范|要求)|违反.{0,12}(?:规范|政策)|不支持生成该内容|(?:内容|作品|视频).{0,20}(?:未通过审核|审核未通过|被审核拦截)/i},
    {code:"DOUBAO_ASSET_REJECTED",category:"asset_policy",retryMode:"edit_assets",requiresPromptEdit:false,userAction:"参考素材未通过或无法处理。请删除、替换或压缩对应图片/视频后重新提交。",pattern:/(?:图片|视频|音频|文件|素材).{0,30}(?:违规|侵权|风险|无法处理|上传失败|解析失败|格式不支持|格式错误|文件过大|大小超限|不符合要求)/i},
    {code:"DOUBAO_PARAMETER_REJECTED",category:"parameters",retryMode:"adjust_parameters",requiresPromptEdit:false,userAction:"当前模型或生成参数不可用。请调整模型、画面比例、时长或素材数量后重新提交。",pattern:/(?:当前模型|该模型|参数|画面比例|宽高比|时长|分辨率).{0,24}(?:不支持|不可用|无效|错误|超出|上限)|暂不支持.{0,20}(?:比例|时长|生成|视频)/i},
    {code:"DOUBAO_LOGIN_REQUIRED",category:"authentication",retryMode:"reauthenticate",requiresPromptEdit:false,userAction:"豆包登录状态已失效。请重新登录该账号后再执行任务。",pattern:/(?:登录已失效|登录状态失效|请重新登录|登录后再试|账号已退出)/i},
    {code:"DOUBAO_SERVICE_BUSY",category:"transient_provider",retryMode:"retry_later",requiresPromptEdit:false,userAction:"豆包服务暂时繁忙。账号已经释放，请稍后重新执行；不要连续高频提交。",pattern:/(?:系统|服务|服务器|模型).{0,16}(?:繁忙|拥挤|异常|不可用)|请求过多|操作频繁|稍后再试|稍后重试|出了点问题|网络异常|网络错误/i},
    {code:"DOUBAO_GENERATION_FAILED",category:"provider_generation",retryMode:"retry_or_edit",requiresPromptEdit:false,userAction:"豆包已明确结束本次生成且没有返回视频。可检查提示词和素材后重新执行。",pattern:/(?:视频|内容|任务)?.{0,12}(?:生成失败|生成中断|生成超时|无法生成|任务失败|处理失败)/i},
    {code:"DOUBAO_TERMINAL_UNRECOGNIZED",category:"provider_terminal_unknown",retryMode:"retry_or_edit",requiresPromptEdit:false,userAction:"豆包已结束本次生成，但没有返回标准错误原因。请打开现场核对提示词、素材和参数后再决定是否重试。",pattern:/(?:这次|本次)?.{0,8}(?:没有|没能|未能|无法).{0,8}(?:生成出来|完成生成|生成成功)|(?:视频|内容|任务|创作)?.{0,10}(?:生成未成功|未生成成功|生成已停止|生成已终止|生成被终止|创作已停止|任务已终止|任务被终止)/i}
  ];
  const rule=rules.find(item=>item.pattern.test(text));
  if(!rule)return empty;
  const match=text.match(rule.pattern);const excerpt=String(match?.[0]||"").replace(/\s+/g," ").trim();
  return {failed:true,outcomeCode:rule.code,terminal:true,providerTerminal:true,terminalFailureVerified:true,submittedVerified:false,safeToRetry:true,notSentVerified:rule.quotaExhausted===true,code:rule.code,category:rule.category,retryMode:rule.retryMode,accountAction:"release",requiresPromptEdit:rule.requiresPromptEdit,userAction:rule.userAction,providerMessage:excerpt||String(match?.[0]||""),quotaExhausted:rule.quotaExhausted===true,quotaConsumed:noCharge?false:null,evidence:{source:"doubao-current-conversation",excerpt:excerpt||String(match?.[0]||"")}};
}

function safeAccountId(value) {
  const id = String(value || "").trim();
  if (!id || !/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error("账号标识无效");
  return id;
}

function browserCandidates(configured) {
  return [
    configured,
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
  ].filter(Boolean);
}

function findBrowser(configured) {
  const found = browserCandidates(configured).find(candidate => fs.existsSync(candidate));
  if (!found) throw new Error("未找到 Chrome 或 Edge，请在系统设置中指定浏览器路径");
  return found;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function getJson(url, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, {timeout: timeoutMs}, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch (error) { reject(error); }
      });
    });
    request.on("timeout", () => request.destroy(new Error("浏览器连接超时")));
    request.on("error", reject);
  });
}

async function waitTargets(port, platform = "") {
  const expected = String(platform || "").toLowerCase() === "dola" ? /dola\.com/i : /doubao\.com/i;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const targets = await getJson(`http://127.0.0.1:${port}/json`, 500);
      const page = targets.find(item => item.type === "page" && item.webSocketDebuggerUrl && expected.test(String(item.url || "")));
      if (page) return page;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("本机浏览器调试端口未就绪");
}

function classifySubmissionEvidence({prompt = "", beforeConversationId = "", after = {}, request = null} = {}) {
  const conversationId = String(after.conversationId || "").trim();
  const userMessageConfirmed = Boolean(after.userMessage);
  const conversationObserved = /^\d{6,}$/.test(conversationId);
  const conversationChanged = conversationObserved && conversationId !== String(beforeConversationId || "").trim();
  const requestConfirmed = Boolean(request?.videoGenerationRequest) && conversationObserved;
  const scopedGeneratingConfirmed = Boolean(after.scopedGenerating) && conversationObserved;
  const confirmed = requestConfirmed || scopedGeneratingConfirmed;
  const evidenceType = requestConfirmed ? "video-generation-request"
    : scopedGeneratingConfirmed ? "current-conversation-generation-status" : "";
  return {confirmed, evidenceType, requestConfirmed, userMessageConfirmed, conversationObserved, conversationChanged, scopedGeneratingConfirmed, conversationId};
}

class Cdp {
  constructor(url) {
    this.nextId = 0;
    this.pending = new Map();
    this.socket = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, {once: true});
      this.socket.addEventListener("error", () => reject(new Error("无法连接本机浏览器")), {once: true});
    });
    this.socket.addEventListener("message", event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (!message.id) {
        if (message.method) {
          for (const handler of this.handlers?.get(message.method) || []) {
            try { handler(message.params || {}); } catch {}
          }
        }
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || "CDP 执行失败"));
      else pending.resolve(message.result || {});
    });
  }
  on(method, handler) {
    if (!this.handlers) this.handlers = new Map();
    const list = this.handlers.get(method) || [];
    list.push(handler);
    this.handlers.set(method, list);
    return () => this.handlers.set(method, (this.handlers.get(method) || []).filter(item => item !== handler));
  }
  async send(method, params = {}) {
    await this.ready;
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {resolve, reject});
      this.socket.send(JSON.stringify({id, method, params}));
    });
  }
  close() { try { this.socket.close(); } catch {} }
}

class EmbeddedCdp {
  constructor(webContents) {
    this.webContents = webContents;
    this.handlers = new Map();
    this.socket = {readyState: 1};
    this.listener = (_event, method, params) => {
      for (const handler of this.handlers.get(method) || []) { try { handler(params || {}); } catch {} }
    };
    if (!webContents.debugger.isAttached()) webContents.debugger.attach("1.3");
    webContents.debugger.on("message", this.listener);
  }
  on(method, handler) { const list = this.handlers.get(method) || []; list.push(handler); this.handlers.set(method, list); return () => this.handlers.set(method, list.filter(item => item !== handler)); }
  async send(method, params = {}) {
    let timer;
    try {
      return await Promise.race([
        this.webContents.debugger.sendCommand(method, params),
        new Promise((_, reject) => { timer=setTimeout(()=>reject(new Error(`内嵌豆包调试命令超时：${method}`)),15000); })
      ]);
    } finally { if(timer)clearTimeout(timer); }
  }
  close() { try { this.webContents.debugger.off("message", this.listener); } catch {} try { if (this.webContents.debugger.isAttached()) this.webContents.debugger.detach(); } catch {} this.socket.readyState = 0; }
}

class BrowserController {
  constructor({profileRootProvider, downloadRootProvider, browserExe = "", embeddedBrowserProvider = null, testMode = false}) {
    this.profileRootProvider = profileRootProvider;
    this.configuredBrowser = browserExe;
    this.embeddedBrowserProvider = embeddedBrowserProvider;
    this.testMode = testMode;
    this.sessions = new Map();
    this.submissionTails = new Map();
    this.downloader = new VideoDownloader({rootProvider: downloadRootProvider || (() => {
      const root = this.profileRoot();
      return path.join(path.dirname(root), "downloads");
    }), testMode});
  }
  profileRoot() {
    const root = this.profileRootProvider && this.profileRootProvider();
    if (!root) throw new Error("授权未生效，不能创建账号环境");
    fs.mkdirSync(root, {recursive: true});
    return root;
  }
  platformUrl(platform) {
    return String(platform || "豆包").toLowerCase() === "dola" ? "https://www.dola.com/chat/" : "https://www.doubao.com/chat/";
  }
  async withSubmissionLock(accountId, work) {
    const key = safeAccountId(accountId);
    const previous = this.submissionTails.get(key) || Promise.resolve();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const tail = previous.catch(() => {}).then(() => gate);
    this.submissionTails.set(key, tail);
    await previous.catch(() => {});
    try { return await work(); }
    finally {
      release();
      if (this.submissionTails.get(key) === tail) this.submissionTails.delete(key);
    }
  }
  async open(account) {
    const accountId = safeAccountId(account && account.id);
    const current = this.sessions.get(accountId);
    if (current?.embedded && current.webContents && !current.webContents.isDestroyed()) return current;
    if (current?.embedded) {
      try { current.cdp?.close(); } catch {}
      this.sessions.delete(accountId);
    }
    if (current && (current.testMode || current.process?.exitCode === null)) return current;
    if (this.embeddedBrowserProvider) {
      const manager = this.embeddedBrowserProvider();
      if (manager) {
        const item = await manager.automationSession(account);
        const session = {account, embedded: true, webContents: item.webContents, window: item.window || null, view: item.view || null, profile: item.partition, captures: [], captureSeq: 0, consumedCaptures: new Set(), submissionRequests: [], assetUploadRequests: [], videoIdentifiers: [], pendingAssetUpload: null, pendingSubmission: null, currentJobId: null, conversationId: "", cdp: null, phase: "idle"};
        this.sessions.set(accountId, session);
        return session;
      }
    }
    const profile = path.join(this.profileRoot(), `account_${accountId}`);
    fs.mkdirSync(profile, {recursive: true});
    if (this.testMode) {
      const session = {account, profile, testMode: true};
      this.sessions.set(accountId, session);
      return session;
    }
    const port = await freePort();
    const child = spawn(findBrowser(this.configuredBrowser), [
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${port}`,
      "--remote-debugging-address=127.0.0.1",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-mode",
      "--start-maximized",
      "--window-size=1280,900",
      "--new-window",
      this.platformUrl(account.platform),
    ], {detached: false, stdio: "ignore", windowsHide: false});
    let target;
    try { target = await waitTargets(port, account.platform); }
    catch (error) { try { child.kill(); } catch {} throw error; }
    const session = {account, process: child, port, profile, target, captures: [], captureSeq: 0, consumedCaptures: new Set(), submissionRequests: [], assetUploadRequests: [], videoIdentifiers: [], pendingAssetUpload: null, pendingSubmission: null, currentJobId: null, conversationId: "", cdp: null, phase: "idle"};
    child.once("exit", () => this.sessions.delete(accountId));
    this.sessions.set(accountId, session);
    return session;
  }
  async detect(account) {
    const session = await this.open(account);
    if (session.embedded) {
      const manager = this.embeddedBrowserProvider?.();
      if (manager?.detect) return manager.detect(account);
      const cdp = await this.connect(session);
      const cookieResult = await cdp.send("Network.getCookies", {urls: [this.platformUrl(account.platform)]});
      const value = await this.evaluate(session, DOUBAO_LOGIN_PROBE_EXPRESSION);
      const detected = classifyDoubaoLoginState(value, cookieResult.cookies || []);
      if (session.phase === "verification" && detected.loggedIn && !detected.verificationRequired) session.phase = "idle";
      return detected;
    }
    if (session.testMode) return {loggedIn: false, verificationRequired: false, platformAccountName: "", message: "测试模式浏览器已打开"};
    const targets = await getJson(`http://127.0.0.1:${session.port}/json`, 1000);
    const page = targets.find(item => item.type === "page" && /doubao\.com|dola\.com/i.test(item.url)) || targets.find(item => item.type === "page");
    if (!page) throw new Error("没有找到豆包页面");
    const cdp = new Cdp(page.webSocketDebuggerUrl);
    try {
      await cdp.send("Network.enable");
      const cookieResult = await cdp.send("Network.getCookies", {urls: [this.platformUrl(account.platform)]});
      let value = {};
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const result = await cdp.send("Runtime.evaluate", {returnByValue: true, expression: DOUBAO_LOGIN_PROBE_EXPRESSION});
        value = result.result && result.result.value || {};
        const pageStable = value.readyState === "complete" && Number(value.bodyTextLength || 0) > 20;
        if (value.onPlatform && (hasDecisivePageLoginSignal(value) || (pageStable && attempt >= 4))) break;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      const detected = classifyDoubaoLoginState(value, cookieResult.cookies || []);
      if (session.phase === "verification" && detected.loggedIn && !detected.verificationRequired) session.phase = "idle";
      return detected;
    } finally { cdp.close(); }
  }
  async refreshPage(session) {
    if (!session || session.phase !== "idle" || session.testMode) return {refreshed: false, reason: "busy-or-test-mode"};
    if (session.embedded) { await session.webContents.reload(); return {refreshed: true, url: session.webContents.getURL()}; }
    const targets = await getJson(`http://127.0.0.1:${session.port}/json`, 1000);
    const page = targets.find(item => item.type === "page" && /doubao\.com|dola\.com/i.test(String(item.url || "")) && item.webSocketDebuggerUrl);
    if (!page) return {refreshed: false, reason: "platform-page-not-ready"};
    const cdp = new Cdp(page.webSocketDebuggerUrl);
    try {
      await cdp.send("Page.enable");
      await cdp.send("Page.reload", {ignoreCache: false});
    } finally { cdp.close(); }
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      try {
        const next = await getJson(`http://127.0.0.1:${session.port}/json`, 700);
        const current = next.find(item => item.type === "page" && /doubao\.com|dola\.com/i.test(String(item.url || "")) && item.webSocketDebuggerUrl);
        if (current) {
          const probe = new Cdp(current.webSocketDebuggerUrl);
          try {
            const ready = await probe.send("Runtime.evaluate", {returnByValue: true, expression: "document.readyState === 'complete' && Boolean(document.body && document.body.innerText)"});
            if (ready.result?.value) return {refreshed: true, url: current.url};
          } finally { probe.close(); }
        }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error("豆包刷新后页面未完成加载");
  }
  async evaluate(session, expression) {
    if (session.testMode) return {testMode: true};
    if (session.embedded) {
      const cdp = await this.connect(session);
      const result = await cdp.send("Runtime.evaluate", {returnByValue: true, awaitPromise: true, expression});
      return result.result?.value;
    }
    const targets = await getJson(`http://127.0.0.1:${session.port}/json`, 1000);
    const page = targets.find(item => item.type === "page" && /doubao\.com|dola\.com/i.test(item.url)) || targets.find(item => item.type === "page");
    if (!page) throw new Error("没有找到豆包页面");
    const cdp = new Cdp(page.webSocketDebuggerUrl);
    try { const result = await cdp.send("Runtime.evaluate", {returnByValue: true, awaitPromise: true, expression}); return result.result?.value; }
    finally { cdp.close(); }
  }
  async navigateSession(session, url) {
    if (session.embedded) {
      try { session.cdp?.close(); } catch {}
      session.cdp = null;
      await session.webContents.loadURL(url);
      return {url:session.webContents.getURL()};
    }
    const cdp=await this.connect(session);return cdp.send("Page.navigate",{url});
  }
  recordSubmissionRequest(session, params = {}) {
    const pending = session.pendingSubmission;
    const request = params.request || {};
    const url = String(request.url || "");
    const method = String(request.method || "GET").toUpperCase();
    if (!pending || session.phase !== "submitting" || method !== "POST" || !/^https?:\/\/(?:[^/]+\.)?(?:doubao|dola)\.com\//i.test(url)) return;
    const endpointMatched = /(?:chat|conversation|message|completion|generate|video)/i.test(url);
    if (!endpointMatched) return;
    const postData = String(request.postData || "");
    const token = String(pending.prompt || "").trim().slice(0, 24);
    const promptMatched = token.length >= 6 && postData.includes(token);
    const videoEndpointMatched = /(?:^|[/_-])(?:video|generate[_-]?video|video[_-]?generation)(?:[/_.?-]|$)/i.test(url);
    const videoGenerationRequest = Boolean(videoEndpointMatched && (promptMatched || /(?:seedance|video[_-]?generation|generate[_-]?video)/i.test(postData)));
    session.submissionRequests = Array.isArray(session.submissionRequests) ? session.submissionRequests : [];
    session.submissionRequests.push({at:Date.now(),requestId:params.requestId || "",url,method,endpointMatched,promptMatched,videoEndpointMatched,videoGenerationRequest,jobId:pending.jobId || ""});
    if (session.submissionRequests.length > 100) session.submissionRequests.splice(0, session.submissionRequests.length - 100);
  }
  recordVideoIdentifierRequest(session, params = {}) {
    const request=params.request||{},url=String(request.url||"");
    if(!isVideoResourceRequest(url))return;
    const requestId=String(params.requestId||""),at=Date.now(),jobId=String(session.currentJobId||""),conversationId=String(session.conversationId||"");
    session.videoResourceRequests=Array.isArray(session.videoResourceRequests)?session.videoResourceRequests:[];
    session.videoResourceRequests.push({requestId,url,at,jobId,conversationId});
    if(session.videoResourceRequests.length>100)session.videoResourceRequests.splice(0,session.videoResourceRequests.length-100);
    this.storeVideoIdentifiers(session,extractVideoVids({url,postData:request.postData}),{requestId,url,at,jobId,conversationId,source:"resource-request"});
  }
  async recordVideoIdentifierResponse(session, cdp, params = {}) {
    const requestId=String(params.requestId||""),request=(session.videoResourceRequests||[]).find(item=>item.requestId===requestId);
    if(!request)return;
    try{
      const result=await cdp.send("Network.getResponseBody",{requestId});
      const responseBody=result?.base64Encoded?Buffer.from(String(result.body||""),"base64").toString("utf8"):String(result?.body||"");
      this.storeVideoIdentifiers(session,extractVideoVids({url:request.url,responseBody}),{...request,at:Date.now(),source:"resource-response"});
    }catch{}
  }
  storeVideoIdentifiers(session, values = [], metadata = {}) {
    session.videoIdentifiers=Array.isArray(session.videoIdentifiers)?session.videoIdentifiers:[];
    for(const value of values){const videoVid=normalizeVideoVid(value);if(!videoVid)continue;const duplicate=session.videoIdentifiers.find(item=>item.videoVid===videoVid&&String(item.jobId||"")===String(metadata.jobId||""));if(duplicate){Object.assign(duplicate,metadata,{videoVid});continue;}session.videoIdentifiers.push({...metadata,videoVid});}
    if(session.videoIdentifiers.length>100)session.videoIdentifiers.splice(0,session.videoIdentifiers.length-100);
  }
  latestVideoVid(session,{jobId="",conversationId=""}={}) {
    const values=(session.videoIdentifiers||[]).filter(item=>(!jobId||String(item.jobId||"")===String(jobId))&&(!conversationId||!item.conversationId||String(item.conversationId)===String(conversationId))).sort((a,b)=>Number(b.at||0)-Number(a.at||0));
    return normalizeVideoVid(values[0]?.videoVid);
  }
  recordAssetUploadRequest(session, params = {}) {
    const pending=session.pendingAssetUpload,request=params.request||{},url=String(request.url||""),method=String(request.method||"GET").toUpperCase();
    if(!pending||session.phase!="submitting"&&session.phase!="uploading")return;
    if(!/^https?:\/\//i.test(url)||!["POST","PUT","PATCH"].includes(method))return;
    const headers=request.headers||{},contentType=String(headers["Content-Type"]||headers["content-type"]||"");
    if(!/(?:upload|image|file|media|object|tos|storage|attachment|resource)/i.test(url)&&!/(?:multipart\/form-data|image\/|application\/octet-stream)/i.test(contentType))return;
    session.assetUploadRequests=Array.isArray(session.assetUploadRequests)?session.assetUploadRequests:[];
    session.assetUploadRequests.push({at:Date.now(),assetId:pending.assetId||"",name:pending.name||"",requestId:String(params.requestId||""),url,method,status:null});
    if(session.assetUploadRequests.length>100)session.assetUploadRequests.splice(0,session.assetUploadRequests.length-100);
  }
  recordAssetUploadResponse(session, params = {}) {
    const requestId=String(params.requestId||""),response=params.response||{},item=(session.assetUploadRequests||[]).find(entry=>entry.requestId===requestId&&!entry.status);
    if(!item)return;
    item.status=Number(response.status||0);item.mimeType=String(response.mimeType||"");item.completedAt=Date.now();
  }
  async connect(session) {
    if (session.testMode) return null;
    if (session.embedded) {
      if (session.cdp && session.cdp.socket.readyState === 1) return session.cdp;
      const cdp = new EmbeddedCdp(session.webContents);
      await cdp.send("Page.enable"); await cdp.send("Runtime.enable"); await cdp.send("Network.enable");
      cdp.on("Network.responseReceived", params => {
        this.recordAssetUploadResponse(session,params);
        const response = params && params.response || {}, url = String(response.url || ""), mimeType = String(response.mimeType || "");
        if (!/^https?:\/\//i.test(url) || (!/^video\//i.test(mimeType) && !/\.mp4(?:\?|$)|\.m3u8(?:\?|$)/i.test(url))) return;
        session.captures.push({seq: ++session.captureSeq, at: Date.now(), url, mimeType, status: response.status, requestId: params.requestId, jobId: session.currentJobId, conversationId: session.conversationId || null, videoVid:this.latestVideoVid(session,{jobId:session.currentJobId,conversationId:session.conversationId}), source: "embedded-network"});
        if (session.captures.length > 500) session.captures.splice(0, session.captures.length - 500);
      });
      cdp.on("Network.requestWillBeSent", params => {this.recordAssetUploadRequest(session,params);this.recordSubmissionRequest(session, params);this.recordVideoIdentifierRequest(session,params);});
      cdp.on("Network.loadingFinished", params => {this.recordVideoIdentifierResponse(session,cdp,params).catch(()=>{});});
      session.cdp = cdp;
      return cdp;
    }
    const targets = await getJson(`http://127.0.0.1:${session.port}/json`, 1000);
    const page = targets.find(item => item.type === "page" && /doubao\.com|dola\.com/i.test(item.url)) || targets.find(item => item.type === "page");
    if (!page) throw new Error("没有找到豆包页面");
    if (session.cdp && session.cdp.socket && session.cdp.socket.readyState === 1) return session.cdp;
    const cdp = new Cdp(page.webSocketDebuggerUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    cdp.on("Network.responseReceived", params => {
      this.recordAssetUploadResponse(session,params);
      const response = params && params.response || {};
      const url = String(response.url || "");
      const mimeType = String(response.mimeType || "");
      if (!/^https?:\/\//i.test(url) || (!/^video\//i.test(mimeType) && !/\.mp4(?:\?|$)|\.m3u8(?:\?|$)/i.test(url))) return;
      session.captures.push({seq: ++session.captureSeq, at: Date.now(), url, mimeType, status: response.status, requestId: params.requestId, jobId: session.currentJobId, conversationId: session.conversationId || null, videoVid:this.latestVideoVid(session,{jobId:session.currentJobId,conversationId:session.conversationId}), source: "network"});
      if (session.captures.length > 500) session.captures.splice(0, session.captures.length - 500);
    });
    cdp.on("Network.requestWillBeSent", params => {this.recordAssetUploadRequest(session,params);this.recordSubmissionRequest(session, params);this.recordVideoIdentifierRequest(session,params);});
    cdp.on("Network.loadingFinished", params => {this.recordVideoIdentifierResponse(session,cdp,params).catch(()=>{});});
    session.cdp = cdp;
    return cdp;
  }
  async waitForComposer(session, timeoutMs = 15000) {
    const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 15000);
    while (Date.now() < deadline) {
      const state = await this.evaluate(session, `(() => {
        const visible = el => { if (!el) return false; const r=el.getBoundingClientRect(),s=getComputedStyle(el); return r.width>2&&r.height>2&&s.display!=='none'&&s.visibility!=='hidden'&&s.pointerEvents!=='none'; };
        const nodes=[];const seen=new Set();
        const collect=root=>{ if(!root||seen.has(root))return;seen.add(root); for(const selector of ['textarea','input:not([type="file"]):not([type="search"]):not([type="button"]):not([type="submit"])','[contenteditable="true"]','[role="textbox"]','[data-slate-editor="true"]','.ProseMirror']) for(const el of root.querySelectorAll?.(selector)||[]) nodes.push(el); for(const host of root.querySelectorAll?.('*')||[]) if(host.shadowRoot) collect(host.shadowRoot); };
        collect(document);
        const describe=el=>{const r=el.getBoundingClientRect(),placeholder=String(el.getAttribute('placeholder')||el.getAttribute('aria-placeholder')||el.querySelector?.('[data-placeholder]')?.getAttribute('data-placeholder')||'');const hint=[placeholder,el.getAttribute('aria-label')||'',el.getAttribute('data-testid')||'',String(el.className||'')].join(' ');return{el,r,placeholder,hint};};
        const candidates=nodes.filter(visible).map(describe).filter(item=>{const hint=item.hint,tag=String(item.el?.tagName||'').toUpperCase(),genericComposer=tag==='TEXTAREA'||item.el?.isContentEditable===true||item.el?.getAttribute?.('role')==='textbox';return !/(?:search|搜索|项目|素材|任务)/i.test(hint)&&(genericComposer||!item.placeholder||/(?:描述|视频|想要|输入|prompt|创作|内容|故事)/i.test(hint));}).sort((a,b)=>b.r.bottom-a.r.bottom||b.r.width-a.r.width);
        const input=candidates[0];
        return {ready:Boolean(input),url:location.href,placeholder:input?.placeholder||'',candidateCount:candidates.length,candidates:candidates.slice(0,6).map(item=>({placeholder:item.placeholder,top:Math.round(item.r.top),bottom:Math.round(item.r.bottom),width:Math.round(item.r.width),height:Math.round(item.r.height)}))};
      })()`);
      if (state?.ready) return state;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error("豆包新对话页面未加载完成");
  }
  async prepareFreshConversation(session, account) {
    if (session.testMode) return {ready: true, url: "mock://new-chat"};
    await this.navigateSession(session, this.platformUrl(account.platform));
    await this.waitForComposer(session, 20000);
    const opened = await this.evaluate(session, `(() => {
      const visible=el=>{if(!el)return false;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>2&&r.height>2&&s.display!=='none'&&s.visibility!=='hidden'};
      const candidates=[...document.querySelectorAll('span,button,[role="button"],a,div')].filter(visible)
        .map(el=>({el,text:String(el.innerText||el.textContent||el.getAttribute('aria-label')||'').replace(/\\s+/g,'').trim(),rect:el.getBoundingClientRect()}))
        .filter(item=>item.text==='新对话'&&item.rect.top>=60&&item.rect.top<180)
        .sort((left,right)=>left.rect.width*left.rect.height-right.rect.width*right.rect.height);
      if(!candidates[0])return false;candidates[0].el.click();return true;
    })()`);
    if (opened) {
      const deadline=Date.now()+10000;
      let ordinary=false;
      while(Date.now()<deadline&&!ordinary){
        ordinary=Boolean(await this.evaluate(session, `(() => {
          const visible=el=>{if(!el)return false;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>2&&r.height>2&&s.display!=='none'&&s.visibility!=='hidden'};
          const editor=[...document.querySelectorAll('textarea,input,[contenteditable="true"],[role="textbox"],[data-slate-editor="true"]')].filter(visible).sort((a,b)=>b.getBoundingClientRect().bottom-a.getBoundingClientRect().bottom)[0];
          const placeholder=String(editor?.getAttribute('placeholder')||editor?.getAttribute('aria-placeholder')||editor?.querySelector?.('[data-placeholder]')?.getAttribute('data-placeholder')||'');
          return Boolean(editor&&!/描述.*视频|想要的视频/.test(placeholder));
        })()`));
        if(!ordinary)await new Promise(resolve=>setTimeout(resolve,250));
      }
      if(!ordinary)throw new Error("豆包普通新对话页面未加载完成");
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    const state = await this.waitForComposer(session, 10000);
    session.conversationId = "";
    return state;
  }
  async restoreConversation(session, command) {
    if (session.testMode) return {restored:true,conversationId:String(command.payload?.conversationId||"")};
    const requested=String(command.payload?.conversationId||"").trim();
    const prompt=String(command.payload?.prompt||"").trim();
    if (/^\d{6,}$/.test(requested)) {
      const target=`https://www.doubao.com/chat/${requested}`;
      const current=await this.evaluate(session,"location.href");
      if (current!==target) { await this.navigateSession(session,target); await new Promise(resolve=>setTimeout(resolve,900)); }
    } else {
      const restored=await this.evaluate(session, `(() => { const prompt=${JSON.stringify(prompt)};const clean=value=>String(value||'').replace(/[\\s，。！？、：；,.!?;:]/g,'');const source=clean(prompt);const grams=[];for(let i=0;i<source.length-1;i++){const token=source.slice(i,i+2);if(!['一个','画面','镜头','视频','生成'].includes(token))grams.push(token)}const links=[...document.querySelectorAll('a[href*="/chat/"]')].map(a=>{const text=clean(a.innerText||a.textContent);const score=grams.reduce((sum,g)=>sum+(text.includes(g)?1:0),0);return {a,score,text}}).sort((a,b)=>b.score-a.score);if(!links[0]||links[0].score<2)return false;links[0].a.click();return true;})()`);
      if (restored) await new Promise(resolve=>setTimeout(resolve,900));
    }
    const state=await this.evaluate(session, `(() => {const match=location.pathname.match(/\\/chat\\/([^/?#]+)/);const root=document.querySelector('main')||document.body;const clean=value=>String(value||'').replace(/[\\s，。！？、：；,.!?;:]/g,'');const token=clean(${JSON.stringify(prompt.slice(0,32))});const text=clean(root?.innerText||root?.textContent||'');return {conversationId:match?match[1]:'',restored:token?text.includes(token):true,url:location.href}})()`);
    if (!state?.restored) throw Object.assign(new Error("未能恢复当前任务对应的豆包会话；不会重新提交"),{code:"DOUBAO_CONVERSATION_RESTORE_FAILED",recoveryState:"conversation_restore_failed",safeToRetry:false,notSentVerified:false,monitorProbe:{conversationId:String(state?.conversationId||requested||""),requestedConversationId:requested,url:String(state?.url||""),promptMatched:false}});
    session.conversationId=String(state.conversationId||requested||session.conversationId||"");
    return state;
  }
  async ensureVideoMode(session) {
    const clickPoint=async point=>{if(!point?.verified)return false;const cdp=await this.connect(session);await cdp.send("Input.dispatchMouseEvent",{type:"mouseMoved",x:point.x,y:point.y});await cdp.send("Input.dispatchMouseEvent",{type:"mousePressed",x:point.x,y:point.y,button:"left",clickCount:1});await cdp.send("Input.dispatchMouseEvent",{type:"mouseReleased",x:point.x,y:point.y,button:"left",clickCount:1});return true;};
    const dismissTransientUi=async()=>{const cdp=await this.connect(session);for(let index=0;index<2;index+=1){await cdp.send("Input.dispatchKeyEvent",{type:"rawKeyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});await cdp.send("Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27,nativeVirtualKeyCode:27});}await new Promise(resolve=>setTimeout(resolve,80));};
    const modeState = async () => this.evaluate(session, `(() => {/*doubao-video-mode-state*/
      const visible=el=>{if(!el)return false;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>2&&r.height>2&&s.display!=='none'&&s.visibility!=='hidden'&&s.pointerEvents!=='none'};
      const model=[...document.querySelectorAll('[data-input-engine-actionbar-control-key="video-model"]')].find(visible);
      const params=[...document.querySelectorAll('[data-input-engine-actionbar-render-entry-key="video-generation-params-panel"],[data-creation-params-panel-id]')].find(visible);
      const composer=[...document.querySelectorAll('textarea,input,[contenteditable="true"],[role="textbox"],[data-slate-editor="true"],.ProseMirror')].filter(visible).find(el=>/描述.*视频|想要的视频/.test(String(el.getAttribute('placeholder')||el.getAttribute('aria-placeholder')||el.querySelector?.('[data-placeholder]')?.getAttribute('data-placeholder')||'')));
      return {active:Boolean(model||params||composer),videoComposer:Boolean(composer),legacyControls:Boolean(model||params)};
    })()`);
    let currentMode=await modeState();
    if (currentMode?.active) return true;
    const findDirect=()=>this.evaluate(session, `(() => {/*doubao-video-entry-target*/
      const visible=el=>{if(!el)return false;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>2&&r.height>2&&s.display!=='none'&&s.visibility!=='hidden'&&s.pointerEvents!=='none'};
      const editors=[...document.querySelectorAll('textarea,input,[contenteditable="true"],[role="textbox"],[data-slate-editor="true"],.ProseMirror')].filter(visible).sort((a,b)=>b.getBoundingClientRect().bottom-a.getBoundingClientRect().bottom),editor=editors[0];
      if(!editor)return false;const ir=editor.getBoundingClientRect(),clean=value=>String(value||'').replace(/\\s+/g,'').trim();
      const candidates=[...document.querySelectorAll('button,[role="button"],a,[tabindex]')].filter(visible).map(el=>({el,r:el.getBoundingClientRect(),label:clean(el.innerText||el.textContent||el.getAttribute('aria-label')||el.getAttribute('title')||'')})).filter(item=>/^(视频生成|生成视频)$/.test(item.label)&&item.r.bottom>=ir.top-180&&item.r.top<=ir.bottom+80&&item.r.left>=Math.max(0,ir.left-96));
      const hit=candidates.map(item=>{const x=item.r.left+item.r.width/2,y=item.r.top+item.r.height/2,top=document.elementFromPoint(x,y),verified=Boolean(top&&(item.el===top||item.el.contains(top)||top.contains?.(item.el)));return{...item,x,y,verified,topText:clean(top?.innerText||top?.textContent||top?.getAttribute?.('aria-label')||'')}}).filter(item=>item.verified).sort((a,b)=>Math.abs(a.r.bottom-ir.bottom)-Math.abs(b.r.bottom-ir.bottom)||b.r.left-a.r.left)[0];
      return hit?{x:hit.x,y:hit.y,label:hit.label,scope:'composer-toolbar',verified:true,topText:hit.topText}:{verified:false,scope:'composer-toolbar',candidateCount:candidates.length};
    })()`);
    await dismissTransientUi();
    let direct = await findDirect();
    if(direct?.verified)await clickPoint(direct);
    if (!direct?.verified && !direct?.candidateCount) {
      const more = await this.evaluate(session, `(() => {/*doubao-video-more-target*/
        const visible=el=>{if(!el)return false;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>2&&r.height>2&&s.display!=='none'&&s.visibility!=='hidden'};
        const inputs=[...document.querySelectorAll('textarea,[contenteditable="true"],[role="textbox"],[data-slate-editor="true"]')].filter(visible).sort((a,b)=>b.getBoundingClientRect().bottom-a.getBoundingClientRect().bottom);
        const input=inputs[0];if(!input)return false;const ir=input.getBoundingClientRect();
        const all=[...document.querySelectorAll('button,[role="button"],[tabindex]')].filter(visible);
        const hit=all.map(el=>{const r=el.getBoundingClientRect(),label=String(el.innerText||el.textContent||el.getAttribute('aria-label')||el.getAttribute('title')||'').replace(/\\s+/g,'').trim();return {el,r,label};})
          .filter(x=>/^(更多|…|\\.\\.\\.)$/.test(x.label)&&x.r.bottom>ir.top-160&&x.r.left>ir.left)
          .sort((a,b)=>b.r.left-a.r.left)[0];
        if(!hit)return false;hit.el.click();return true;
      })()`);
      if (!more) throw new Error("没有找到豆包“视频生成”或“更多”入口");
      await new Promise(resolve => setTimeout(resolve, 350));
      const menuVideo = await this.evaluate(session, `(() => {
        const visible=el=>{if(!el)return false;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>2&&r.height>2&&s.display!=='none'&&s.visibility!=='hidden'};
        const hit=[...document.querySelectorAll('button,[role="button"],[role="menuitem"],a,[tabindex]')].filter(visible)
          .find(el=>/^(视频生成|生成视频)$/.test(String(el.innerText||el.textContent||el.getAttribute('aria-label')||'').replace(/\\s+/g,'').trim()));
        if(!hit)return false;hit.click();return true;
      })()`);
      if (!menuVideo) throw new Error("已展开“更多”，但没有找到“视频生成”");
    }
    const maxAttempts=2,confirmTimeoutMs=Math.max(20,Number(session?.videoModeConfirmTimeoutMs)||10000),confirmIntervalMs=Math.min(200,Math.max(5,Math.round(confirmTimeoutMs/3)));let active=false;
    for(let attempt=1;attempt<=maxAttempts&&!active;attempt+=1){
      const deadline=Date.now()+confirmTimeoutMs;
      while(Date.now()<deadline&&!active){active=Boolean((await modeState())?.active);if(!active)await new Promise(resolve=>setTimeout(resolve,confirmIntervalMs));}
      if(!active&&attempt<maxAttempts){await dismissTransientUi();direct=await findDirect();if(direct?.verified)await clickPoint(direct);}
    }
    if (!active){const diagnostic=await this.evaluate(session, `(() => {/*doubao-video-mode-diagnostic*/const visible=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>2&&r.height>2&&s.display!=='none'&&s.visibility!=='hidden'};const editor=[...document.querySelectorAll('textarea,input,[contenteditable="true"],[role="textbox"],[data-slate-editor="true"],.ProseMirror')].filter(visible).sort((a,b)=>b.getBoundingClientRect().bottom-a.getBoundingClientRect().bottom)[0];return{url:location.href,placeholder:String(editor?.getAttribute('placeholder')||editor?.getAttribute('aria-placeholder')||editor?.querySelector?.('[data-placeholder]')?.getAttribute('data-placeholder')||''),videoButtons:[...document.querySelectorAll('button,[role="button"],a,[tabindex]')].filter(visible).map(e=>String(e.innerText||e.textContent||e.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim()).filter(value=>/视频生成|生成视频/.test(value)).slice(-12),actionbarKeys:[...document.querySelectorAll('[data-input-engine-actionbar-control-key],[data-input-engine-actionbar-render-entry-key],[data-creation-params-panel-id]')].filter(visible).map(e=>({control:e.getAttribute('data-input-engine-actionbar-control-key')||'',render:e.getAttribute('data-input-engine-actionbar-render-entry-key')||'',panel:e.getAttribute('data-creation-params-panel-id')||'',text:String(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim()})),viewport:{width:innerWidth,height:innerHeight}}})()`);throw new Error(`点击后未确认进入豆包视频生成模式：${JSON.stringify({...diagnostic,lastTarget:direct,attempts:maxAttempts})}`);}
    return true;
  }
  async setVideoParameters(session, payload = {}) {
    if (session.testMode) return normalizeVideoParameters(payload);
    const desired=normalizeVideoParameters(payload);
    const waitForAction=async(action,{timeoutMs=5000,intervalMs=200}={})=>{const deadline=Date.now()+timeoutMs;let result=false;while(Date.now()<deadline&&!result){result=await action();if(!result)await new Promise(resolve=>setTimeout(resolve,intervalMs));}return result;};
    const clickPoint=async point=>{const cdp=await this.connect(session);await cdp.send("Input.dispatchMouseEvent",{type:"mouseMoved",x:point.x,y:point.y});await cdp.send("Input.dispatchMouseEvent",{type:"mousePressed",x:point.x,y:point.y,button:"left",clickCount:1});await cdp.send("Input.dispatchMouseEvent",{type:"mouseReleased",x:point.x,y:point.y,button:"left",clickCount:1});};
    const findModelControl=()=>this.evaluate(session, `(() => {/*doubao-model-control*/const target=${JSON.stringify(desired.model)},clean=v=>String(v||'').replace(/\\s+/g,'').toLowerCase(),visible=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>2&&r.height>2&&s.display!=='none'&&s.visibility!=='hidden'};const targetText=clean(target),control=[...document.querySelectorAll('[data-input-engine-actionbar-control-key="video-model"],button,[role="button"]')].filter(visible).find(e=>e.matches?.('[data-input-engine-actionbar-control-key="video-model"]')||clean(e.innerText||e.textContent||'').includes('seedance2.0'));if(!control)return false;const r=control.getBoundingClientRect(),text=String(control.innerText||control.textContent||'').trim();return{x:r.left+r.width/2,y:r.top+r.height/2,selected:clean(text).includes(targetText),text,state:control.getAttribute('data-state')||'',ariaChecked:control.getAttribute('aria-checked')||''}})()`);
    let modelControl=await waitForAction(findModelControl);
    if(!modelControl){
      const diagnostic=await this.evaluate(session, `(() => {const visible=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>2&&r.height>2&&s.display!=='none'&&s.visibility!=='hidden'};const text=String(document.body?.innerText||'').replace(/\s+/g,' ');const editor=[...document.querySelectorAll('textarea,input,[contenteditable="true"],[role="textbox"],[data-slate-editor="true"]')].filter(visible).sort((a,b)=>b.getBoundingClientRect().bottom-a.getBoundingClientRect().bottom)[0];const quota=(text.match(/(?:今日视频生成免费次数用完了|视频额度.{0,30}(?:没有|不足|用完|耗尽|上限)|(?:今日|本日).{0,20}(?:视频|生成).{0,20}(?:次数|额度).{0,12}(?:用完|耗尽|上限))/i)||[])[0]||'';return{url:location.href,placeholder:String(editor?.getAttribute('placeholder')||editor?.getAttribute('aria-placeholder')||editor?.querySelector?.('[data-placeholder]')?.getAttribute('data-placeholder')||''),quota,videoButtons:[...document.querySelectorAll('button,[role="button"]')].filter(visible).map(e=>String(e.innerText||e.textContent||e.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim()).filter(value=>/视频生成|生成视频/.test(value)).slice(-8),actionbarKeys:[...document.querySelectorAll('[data-input-engine-actionbar-control-key],[data-input-engine-actionbar-render-entry-key],[data-creation-params-panel-id]')].filter(visible).map(e=>({control:e.getAttribute('data-input-engine-actionbar-control-key')||'',render:e.getAttribute('data-input-engine-actionbar-render-entry-key')||'',panel:e.getAttribute('data-creation-params-panel-id')||'',text:String(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim()})),viewport:{width:innerWidth,height:innerHeight}}})()`);
      if(diagnostic?.quota){const error=new Error(diagnostic.quota);error.code="DOUBAO_QUOTA_EXHAUSTED";error.quotaExhausted=true;error.notSentVerified=true;throw error;}
      throw new Error(`没有找到豆包视频模型选择器：${JSON.stringify(diagnostic)}`);
    }
    if(!modelControl.selected){
      const findModelItem=()=>this.evaluate(session, `(() => {/*doubao-model-menu-item*/const target=${JSON.stringify(desired.model)},clean=v=>String(v||'').replace(/\\s+/g,'').toLowerCase(),visible=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>2&&r.height>2&&s.display!=='none'&&s.visibility!=='hidden'};const targetText=clean(target),items=[...new Set(document.querySelectorAll('[role="menuitem"],[role="option"],[data-radix-collection-item]'))].filter(visible).map(e=>({e,r:e.getBoundingClientRect(),text:String(e.innerText||e.textContent||'').trim(),state:e.getAttribute('data-state')||'',ariaChecked:e.getAttribute('aria-checked')||''})).filter(x=>clean(x.text)===targetText||clean(x.text).startsWith(targetText)).sort((a,b)=>Number(clean(a.text)!==targetText)-Number(clean(b.text)!==targetText)||a.r.width*a.r.height-b.r.width*b.r.height||a.r.top-b.r.top);if(!items[0])return false;return{x:items[0].r.left+items[0].r.width/2,y:items[0].r.top+items[0].r.height/2,text:items[0].text,state:items[0].state,ariaChecked:items[0].ariaChecked}})()`);
      const isModelMenuOpen=()=>this.evaluate(session, `(() => {/*doubao-model-menu-open*/const clean=v=>String(v||'').replace(/\\s+/g,'').toLowerCase(),visible=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>2&&r.height>2&&s.display!=='none'&&s.visibility!=='hidden'};return[...document.querySelectorAll('[role="menu"][data-state="open"],[role="listbox"],[data-radix-popper-content-wrapper]')].filter(visible).some(menu=>{const text=clean(menu.innerText||menu.textContent||'');return text.includes('seedance2.0fast')||text.includes('seedance2.0mini')})})()`);
      const verifyModel=()=>this.evaluate(session, `(() => {/*doubao-model-verified*/const target=${JSON.stringify(desired.model)},clean=v=>String(v||'').replace(/\\s+/g,'').toLowerCase(),visible=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>2&&r.height>2&&s.display!=='none'&&s.visibility!=='hidden'};const targetText=clean(target),control=[...document.querySelectorAll('[data-input-engine-actionbar-control-key="video-model"],button,[role="button"]')].filter(visible).find(e=>e.matches?.('[data-input-engine-actionbar-control-key="video-model"]')&&clean(e.innerText||e.textContent||'').includes(targetText));return Boolean(control)})()`);
      const closeModelMenu=async()=>{const cdp=await this.connect(session);await cdp.send("Input.dispatchKeyEvent",{type:"rawKeyDown",key:"Escape",code:"Escape"});await cdp.send("Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape"});};
      const maxAttempts=3;
      const verifyTimeoutMs=Math.max(50,Number(session?.modelSelectionVerificationTimeoutMs)||3500);
      let modelVerified=false;
      for(let attempt=1;attempt<=maxAttempts&&!modelVerified;attempt+=1){
        modelControl=await waitForAction(findModelControl,{timeoutMs:attempt===1?2500:1500,intervalMs:100});
        if(modelControl?.selected||await verifyModel()){modelVerified=true;break;}
        let modelItem=await waitForAction(findModelItem,{timeoutMs:350,intervalMs:100});
        if(!modelItem){
          if(!await isModelMenuOpen()){
            if(!modelControl)continue;
            await clickPoint(modelControl);
            await waitForAction(isModelMenuOpen,{timeoutMs:2500,intervalMs:100});
          }
          modelItem=await waitForAction(findModelItem,{timeoutMs:2500,intervalMs:100});
        }
        if(modelItem){
          await clickPoint(modelItem);
          await new Promise(resolve=>setTimeout(resolve,250));
          modelVerified=Boolean(await waitForAction(verifyModel,{timeoutMs:verifyTimeoutMs,intervalMs:150}));
        }
        if(!modelVerified&&attempt<maxAttempts){await closeModelMenu();await new Promise(resolve=>setTimeout(resolve,250));}
      }
      if(!modelVerified){
        const diagnostic=await this.evaluate(session, `(() => {/*doubao-model-diagnostic*/const visible=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>2&&r.height>2&&s.display!=='none'&&s.visibility!=='hidden'},describe=e=>({text:String(e.innerText||e.textContent||'').replace(/\\s+/g,' ').trim(),role:e.getAttribute('role')||'',state:e.getAttribute('data-state')||'',ariaChecked:e.getAttribute('aria-checked')||''});return{target:${JSON.stringify(desired.model)},attempts:${maxAttempts},controls:[...document.querySelectorAll('[data-input-engine-actionbar-control-key="video-model"]')].filter(visible).map(describe),menus:[...document.querySelectorAll('[role="menu"],[role="listbox"],[data-radix-popper-content-wrapper]')].filter(visible).map(describe),items:[...document.querySelectorAll('[role="menuitem"],[role="option"],[data-radix-collection-item]')].filter(visible).map(describe).filter(x=>/Seedance/i.test(x.text)).slice(0,12)}})()`);
        throw new Error(`豆包视频模型确认失败：${desired.model} ${JSON.stringify(diagnostic)}`);
      }
    }
    const panelControl=await waitForAction(()=>this.evaluate(session, `(() => {const visible=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>2&&r.height>2&&s.display!=='none'&&s.visibility!=='hidden'};const control=[...document.querySelectorAll('[data-input-engine-actionbar-render-entry-key="video-generation-params-panel"],[data-creation-params-panel-id],button,[role="button"]')].filter(visible).find(e=>e.matches?.('[data-input-engine-actionbar-render-entry-key="video-generation-params-panel"],[data-creation-params-panel-id]')||/(?:自动|3:4|4:3|9:16|16:9|1:1|21:9).*(?:4|5|6|7|8|9|10|11|12|13|14|15)\s*s?/.test(String(e.innerText||e.textContent||'')));if(!control)return false;const r=control.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,text:String(control.innerText||control.textContent||'').replace(/\s+/g,' ').trim()}})()`),{timeoutMs:3500});
    if(!panelControl)throw new Error("没有找到豆包画面比例和时长设置");await clickPoint(panelControl);await new Promise(resolve=>setTimeout(resolve,200));
    const findRatio=()=>this.evaluate(session, `(() => {const target=${JSON.stringify(desired.ratio)},clean=v=>String(v||'').replace(/\s+/g,'').trim(),visible=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>2&&r.height>2&&s.display!=='none'&&s.visibility!=='hidden'};const items=[...document.querySelectorAll('[role="menu"][data-state="open"] button,[role="menu"][data-state="open"] [role="button"],[role="menu"][data-state="open"] [role="radio"],[data-radix-popper-content-wrapper] button,button,[role="button"],[role="radio"],[data-radix-collection-item],[tabindex],div')].filter(visible).map(e=>({e,r:e.getBoundingClientRect(),text:clean(e.innerText||e.textContent||e.getAttribute('aria-label'))})).filter(x=>x.text===clean(target)).sort((a,b)=>a.r.width*a.r.height-b.r.width*b.r.height);if(!items[0])return false;return{x:items[0].r.left+items[0].r.width/2,y:items[0].r.top+items[0].r.height/2,text:items[0].text}})()`);
    let ratioItem=await waitForAction(findRatio,{timeoutMs:3500});
    if(!ratioItem){await clickPoint(panelControl);await new Promise(resolve=>setTimeout(resolve,350));ratioItem=await waitForAction(findRatio,{timeoutMs:3500});}
    const ratioSelected=Boolean(ratioItem);if(ratioItem)await clickPoint(ratioItem);
    if(!ratioSelected){const diagnostic=await this.evaluate(session, `(() => {const visible=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>2&&r.height>2&&s.display!=='none'&&s.visibility!=='hidden'};return{menus:[...document.querySelectorAll('[role="menu"],[data-radix-popper-content-wrapper]')].filter(visible).map(e=>String(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim()),panel:[...document.querySelectorAll('[data-input-engine-actionbar-render-entry-key="video-generation-params-panel"],[data-creation-params-panel-id]')].filter(visible).map(e=>({state:e.getAttribute('data-state'),text:String(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim()}))}})()`);throw new Error(`豆包当前页面没有找到画面比例：${desired.ratio} ${JSON.stringify(diagnostic)}`);}await new Promise(resolve=>setTimeout(resolve,150));
    const findDuration=()=>this.evaluate(session, `(() => {const desired=${desired.duration},visible=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>2&&r.height>2&&s.display!=='none'&&s.visibility!=='hidden'};const range=[...document.querySelectorAll('input[type="range"]')].find(visible);if(range){const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;setter?setter.call(range,String(desired)):(range.value=String(desired));range.dispatchEvent(new Event('input',{bubbles:true}));range.dispatchEvent(new Event('change',{bubbles:true}));return{method:'native'}}const slider=[...document.querySelectorAll('[role="slider"]')].find(visible);if(slider){slider.focus();return{method:'keyboard'}}const labels=[...document.querySelectorAll('*')].filter(visible).filter(e=>/4s/.test(e.innerText||'')&&/15s/.test(e.innerText||'')).sort((a,b)=>a.getBoundingClientRect().height-b.getBoundingClientRect().height);const host=labels[0];if(!host)return null;const track=[...host.querySelectorAll('div')].filter(visible).map(e=>({e,r:e.getBoundingClientRect()})).filter(x=>x.r.width>180&&x.r.height<=24).sort((a,b)=>b.r.width-a.r.width)[0];if(!track)return null;const ratio=(desired-4)/11;return{method:'mouse',x:track.r.left+track.r.width*ratio,y:track.r.top+track.r.height/2}})()`);
    let durationTarget=await findDuration();
    if(!durationTarget){await clickPoint(panelControl);await new Promise(resolve=>setTimeout(resolve,350));durationTarget=await waitForAction(findDuration,{timeoutMs:3500});}
    if(!durationTarget)throw new Error("没有找到豆包视频时长滑杆");
    if(durationTarget.method==="keyboard"){
      const cdp=await this.connect(session);const press=async key=>{await cdp.send("Input.dispatchKeyEvent",{type:"rawKeyDown",key,code:key});await cdp.send("Input.dispatchKeyEvent",{type:"keyUp",key,code:key});};await press("Home");for(let index=4;index<desired.duration;index+=1)await press("ArrowRight");
    } else if(durationTarget.method==="mouse") {
      const cdp=await this.connect(session);await cdp.send("Input.dispatchMouseEvent",{type:"mousePressed",x:durationTarget.x,y:durationTarget.y,button:"left",clickCount:1});await cdp.send("Input.dispatchMouseEvent",{type:"mouseReleased",x:durationTarget.x,y:durationTarget.y,button:"left",clickCount:1});
    }
    await new Promise(resolve=>setTimeout(resolve,250));
    const verified=await this.evaluate(session, `(() => {const model=${JSON.stringify(desired.model)},ratio=${JSON.stringify(desired.ratio)},duration=${JSON.stringify(`${desired.duration}s`)},clean=v=>String(v||'').replace(/\\s+/g,'').toLowerCase(),text=String(document.body?.innerText||'').replace(/\\s+/g,' '),modelText=clean(model);const modelControl=[...document.querySelectorAll('[data-input-engine-actionbar-control-key="video-model"]')].find(e=>clean(e.innerText||e.textContent||'').includes(modelText));const paramsControl=[...document.querySelectorAll('[data-input-engine-actionbar-render-entry-key="video-generation-params-panel"],[data-creation-params-panel-id]')].find(e=>{const value=String(e.innerText||e.textContent||'');return value.includes(ratio)&&value.includes(duration)});const slider=[...document.querySelectorAll('[role="slider"],input[type="range"]')].find(e=>String(e.getAttribute('aria-valuenow')||e.value||'')===String(${desired.duration}));return{model:Boolean(modelControl)||clean(text).includes(modelText),ratio:Boolean(paramsControl)||text.includes(ratio),duration:Boolean(paramsControl)||Boolean(slider)||text.includes(duration)}})()`);
    if(!verified?.model||!verified?.ratio||!verified?.duration)throw new Error(`豆包视频参数确认失败：${desired.model} · ${desired.ratio} · ${desired.duration}s`);return desired;
  }
  async waitForVideo(session, {jobId, conversationId = "", timeoutMs = 30000} = {}) {
    if (session.testMode) return {url: `mock://video/${jobId}`, mimeType: "video/mp4", conversationId, videoVid:`mock_vid_${jobId}`, source: "mock"};
    session.currentJobId = String(jobId || session.currentJobId || "");
    if (conversationId) session.conversationId = String(conversationId);
    await this.connect(session);
    const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 30000);
    while (Date.now() < deadline) {
      const candidates = session.captures.filter(item => !session.consumedCaptures.has(item.seq));
      const match = candidates.find(item => {
        const sameJob = !jobId || String(item.jobId || "") === String(jobId);
        const sameConversation = !conversationId || String(item.conversationId || "") === String(conversationId);
        return sameJob && sameConversation;
      });
      if (match) {
        session.consumedCaptures.add(match.seq);
        let videoVid=normalizeVideoVid(match.videoVid)||this.latestVideoVid(session,{jobId,conversationId});
        if(!videoVid){const pageProbe=await this.evaluate(session,`(${probeDoubaoVideoResultPage.toString()})()`);videoVid=normalizeVideoVid(pageProbe?.videoVid);if(videoVid)this.storeVideoIdentifiers(session,[videoVid],{at:Date.now(),jobId:String(jobId||""),conversationId:String(conversationId||session.conversationId||""),messageId:String(pageProbe?.messageId||""),source:"dom-message-before-capture"});}
        return {...match, conversationId: match.conversationId || conversationId || "", videoVid};
      }
      const pageVideo = await this.evaluate(session, `(${probeDoubaoVideoResultPage.toString()})()`);
      if(pageVideo?.videoVid)this.storeVideoIdentifiers(session,[pageVideo.videoVid],{at:Date.now(),jobId:String(jobId||""),conversationId:String(conversationId||session.conversationId||""),messageId:String(pageVideo.messageId||""),source:"dom-message"});
      if (pageVideo?.url) return {seq: `dom-${Date.now()}`, at: Date.now(), url: pageVideo.url, mimeType: "video/mp4", status: 200, jobId: String(jobId || ""), conversationId: String(conversationId || session.conversationId || ""), videoVid:normalizeVideoVid(pageVideo.videoVid)||this.latestVideoVid(session,{jobId,conversationId}), source: "dom-video"};
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error("等待当前任务视频资源超时");
  }
  async resolveWatermarkFreeVideo(session, {videoVid, conversationId = ""} = {}) {
    if (session.testMode) return null;
    return resolveDoubaoWatermarkFreeVideo({
      evaluate: expression => this.evaluate(session, expression),
      videoVid,
      conversationId,
    });
  }
  async downloadDoubaoVideoWithFallback(session, resource = {}, {jobId, conversationId = "", videoVid = "", fallbackResultVid = ""} = {}) {
    const normalizedVideoVid = normalizeVideoVid(videoVid || resource.videoVid);
    const pageUrl = String(fallbackResultVid || resource.fallbackResultVid || resource.pageUrl || resource.url || "").trim();
    const errors = [];
    let watermark = null;
    if (!session.testMode && normalizedVideoVid) {
      try {
        watermark = await this.resolveWatermarkFreeVideo(session, {videoVid: normalizedVideoVid, conversationId});
      } catch (error) {
        errors.push(summarizeWatermarkFreeError(error));
      }
    } else if (!session.testMode) {
      errors.push("DOUBAO_AISPACE_VIDEO_VID_MISSING: 缺少豆包视频 VID，已使用页面视频地址");
    }
    const candidates = [
      {url: watermark?.mainUrl || "", source: "doubao-aispace-watermark-free", candidate: "main_url", watermarkFree: true},
      {url: watermark?.backupUrl || "", source: "doubao-aispace-watermark-free", candidate: "backup_url", watermarkFree: true},
      {url: pageUrl, source: "doubao-page-fallback", candidate: "page_url", watermarkFree: false},
    ].filter((item, index, items) => item.url && items.findIndex(value => value.url === item.url) === index);
    const allowed = candidates.filter(item => session.testMode ? /^(?:mock|https?):\/\//i.test(item.url) : isTrustedDoubaoVideoUrl(item.url));
    if (!allowed.length) {
      throw Object.assign(new Error(errors.at(-1) || "没有可下载的可信豆包视频地址"), {code: "DOUBAO_RESULT_URL_UNAVAILABLE", watermarkFreeError: errors.join("；")});
    }
    let cookie = "";
    if (!session.testMode) {
      const cdp = await this.connect(session);
      const cookies = await cdp.send("Network.getCookies", {urls: [...allowed.map(item => item.url), "https://www.doubao.com/"]});
      cookie = (cookies.cookies || []).map(item => `${item.name}=${item.value}`).join("; ");
    }
    let lastError = null;
    for (const candidate of allowed) {
      try {
        const downloaded = await this.downloader.download({...resource, url: candidate.url, mimeType: resource.mimeType || "video/mp4"}, {jobId, cookie});
        return {
          ...downloaded,
          videoUrl: candidate.url,
          resultUrls: [candidate.url],
          resultUrlSource: candidate.source,
          resultUrlCandidate: candidate.candidate,
          watermarkFree: candidate.watermarkFree,
          watermarkFreeError: errors.join("；"),
          resultSourceResolvedAt: watermark?.resolvedAt || new Date().toISOString(),
          fallbackResultVid: pageUrl,
          videoVid: normalizedVideoVid,
          resourceDescriptor: {...resource, url: candidate.url, pageUrl, videoVid: normalizedVideoVid, resultUrlSource: candidate.source},
        };
      } catch (error) {
        lastError = error;
        errors.push(`${candidate.candidate} 下载失败：${String(error?.message || error).replace(/https?:\/\/\S+/gi, "[已隐藏签名地址]").slice(0, 300)}`);
      }
    }
    const failure = lastError || new Error("豆包视频下载失败");
    failure.code = failure.code || "DOUBAO_RESULT_DOWNLOAD_FAILED";
    failure.watermarkFreeError = errors.join("；");
    throw failure;
  }
  async findReferenceFileInput(session) {
    const cdp=await this.connect(session);
    await cdp.send("DOM.enable").catch(()=>{});
    const document=await cdp.send("DOM.getDocument",{depth:-1,pierce:true}),rootId=document.root?.nodeId;
    if(!rootId)return null;
    for(const selector of ['input[type="file"][accept*=".png"]','input[type="file"][accept*="image"]','input[type="file"]']){
      const result=await cdp.send("DOM.querySelector",{nodeId:rootId,selector});
      if(result.nodeId)return{cdp,nodeId:result.nodeId};
    }
    return null;
  }
  async clickReferenceUploadTrigger(session) {
    return this.evaluate(session,`(() => {
      const visible=el=>{if(!el)return false;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>2&&r.height>2&&s.display!=='none'&&s.visibility!=='hidden'};
      const editor=[...document.querySelectorAll('textarea,[contenteditable="true"],[role="textbox"],[data-slate-editor="true"]')].filter(visible).sort((a,b)=>b.getBoundingClientRect().bottom-a.getBoundingClientRect().bottom)[0];
      const er=editor?.getBoundingClientRect();
      const candidates=[...document.querySelectorAll('button,[role="button"],label,[data-dbx-name="button"],div[tabindex]')].filter(visible).map(el=>{const text=String(el.innerText||el.textContent||el.getAttribute('aria-label')||el.getAttribute('title')||'').replace(/\\s+/g,'').trim(),hint=String(el.outerHTML||'').slice(0,1200),r=el.getBoundingClientRect();let score=0;if(/上传图片|添加图片|参考图|图片参考|上传素材|添加素材|附件/.test(text))score+=220;if(/upload|image|picture|attachment|file|photo/i.test(hint))score+=90;if(er&&r.top>=er.top-140&&r.bottom<=er.bottom+100)score+=80;if(r.top>innerHeight*.45)score+=30;if(/发送|生成|模型|比例|时长/.test(text))score-=240;return{el,text,score}}).filter(item=>item.score>70).sort((a,b)=>b.score-a.score);
      if(!candidates[0])return'';candidates[0].el.click();return candidates[0].text||'图标按钮';
    })()`);
  }
  async setReferenceFile(session, filePath) {
    for(let attempt=0;attempt<5;attempt++){
      const input=await this.findReferenceFileInput(session);
      if(input){await input.cdp.send("DOM.setFileInputFiles",{nodeId:input.nodeId,files:[filePath]});return true;}
      await this.clickReferenceUploadTrigger(session);
      await new Promise(resolve=>setTimeout(resolve,350));
    }
    throw referenceUploadError("没有找到豆包参考图片上传入口");
  }
  async readReferenceUploadState(session) {
    return this.evaluate(session,`(() => {
      const visible=el=>{if(!el)return false;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>2&&r.height>2&&s.display!=='none'&&s.visibility!=='hidden'};
      const editor=[...document.querySelectorAll('textarea,[contenteditable="true"],[role="textbox"],[data-slate-editor="true"]')].filter(visible).sort((a,b)=>b.getBoundingClientRect().bottom-a.getBoundingClientRect().bottom)[0],er=editor?.getBoundingClientRect();
      const near=el=>{const r=el.getBoundingClientRect();return !er||(r.bottom>=Math.max(0,er.top-430)&&r.top<=Math.min(innerHeight,er.bottom+120))};
      const sources=new Set();
      for(const image of [...document.querySelectorAll('img')].filter(el=>visible(el)&&near(el))){const r=image.getBoundingClientRect(),src=String(image.currentSrc||image.src||'');if(r.width>=24&&r.height>=24&&r.width<=520&&r.height<=520&&src)sources.add(src);}
      for(const node of [...document.querySelectorAll('[style*="background-image"]')].filter(el=>visible(el)&&near(el))){const value=String(node.style.backgroundImage||'');if(value&&value!=='none')sources.add(value);}
      const fileNames=[...document.querySelectorAll('[class*="upload"],[class*="attachment"],[class*="file"],[class*="image"],[class*="preview"]')].filter(el=>visible(el)&&near(el)).map(el=>String(el.innerText||el.textContent||'').trim()).filter(text=>/\\.(?:png|jpe?g|webp)/i.test(text));
      const fileCount=[...document.querySelectorAll('input[type="file"]')].reduce((sum,input)=>sum+Number(input.files?.length||0),0);
      const alerts=[...document.querySelectorAll('[role="alert"],[class*="toast"],[class*="Toast"],[class*="notice"],[class*="Notice"]')].filter(visible).map(el=>String(el.innerText||el.textContent||'')).join(' ');
      const bodyTail=String(document.body?.innerText||'').slice(-3000),statusText=(alerts+' '+bodyTail).replace(/\\s+/g,' ');
      return{previewCount:sources.size,fileCount,fileNames:[...new Set(fileNames)].slice(0,20),pending:/(上传中|正在上传|处理中|解析中)/.test(statusText),failure:/(上传失败|解析失败|格式不支持|文件过大|图片违规|素材违规)/.test(statusText)?statusText.slice(-500):''};
    })()`);
  }
  async uploadSingleReferenceImage(session, asset, index, total) {
    const before=await this.readReferenceUploadState(session),startedAt=Date.now();
    session.assetUploadRequests=Array.isArray(session.assetUploadRequests)?session.assetUploadRequests:[];
    session.pendingAssetUpload={assetId:asset.id,name:asset.name,startedAt};session.phase="uploading";
    try{
      await this.setReferenceFile(session,asset.path);
      let stable=0,lastState=before;
      const deadline=Date.now()+30000;
      while(Date.now()<deadline){
        await new Promise(resolve=>setTimeout(resolve,350));
        const state=await this.readReferenceUploadState(session);lastState=state;
        if(state?.failure)throw referenceUploadError(`参考图“${asset.name}”上传失败：${state.failure}`);
        const requests=(session.assetUploadRequests||[]).filter(item=>item.assetId===asset.id&&item.at>=startedAt-500),successful=requests.filter(item=>item.status>=200&&item.status<300);
        const previewDelta=Math.max(0,Number(state?.previewCount||0)-Number(before?.previewCount||0));
        const verifiedBy=previewDelta>=1?"reference-preview":successful.length?"upload-response":"";
        if(verifiedBy&&!state?.pending&&Date.now()-startedAt>=700)stable++;else stable=0;
        if(stable>=2)return{assetId:asset.id,name:asset.name,index:index+1,total,path:asset.path,verified:true,verifiedBy,previewDelta,requestIds:successful.map(item=>item.requestId).filter(Boolean),completedAt:new Date().toISOString()};
      }
      throw referenceUploadError(`参考图“${asset.name}”未获得上传完成证据`,{uploadState:lastState});
    }finally{session.pendingAssetUpload=null;}
  }
  async uploadReferenceImages(session, payload = {}) {
    const assets=normalizeReferenceAssets(payload);
    if(!assets.length)return{requestedCount:0,uploadedCount:0,verified:true,items:[]};
    if(session.testMode)return{requestedCount:assets.length,uploadedCount:assets.length,verified:true,items:assets.map((asset,index)=>({assetId:asset.id,name:asset.name,index:index+1,total:assets.length,role:asset.role,label:asset.label,description:asset.description,verified:true,verifiedBy:"test-mode"})),manifest:buildReferenceManifest(assets)};
    const items=[];
    for(let index=0;index<assets.length;index++)items.push(await this.uploadSingleReferenceImage(session,assets[index],index,assets.length));
    return{requestedCount:assets.length,uploadedCount:items.length,verified:items.length===assets.length,items:items.map((item,index)=>({...item,role:assets[index]?.role||"other",label:assets[index]?.label||assets[index]?.name||"",description:assets[index]?.description||""})),manifest:buildReferenceManifest(assets),completedAt:new Date().toISOString()};
  }
  async fillComposer(session, prompt) {
    const source=String(prompt||'');
    const deadline=Date.now()+15000;
    let fallbackUsed=false;
    while(Date.now()<deadline){
      const result=await this.evaluate(session, `(() => {
        const prompt=${JSON.stringify(source)};
        const visible = el => { if (!el) return false; const r=el.getBoundingClientRect(),s=getComputedStyle(el); return r.width>2&&r.height>2&&s.display!=='none'&&s.visibility!=='hidden'&&s.pointerEvents!=='none'; };
        const nodes=[];const seen=new Set();
        const collect=root=>{ if(!root||seen.has(root))return;seen.add(root); for(const selector of ['textarea','input:not([type="file"]):not([type="search"]):not([type="button"]):not([type="submit"])','[contenteditable="true"]','[role="textbox"]','[data-slate-editor="true"]','.ProseMirror']) for(const el of root.querySelectorAll?.(selector)||[]) nodes.push(el); for(const host of root.querySelectorAll?.('*')||[]) if(host.shadowRoot) collect(host.shadowRoot); };
        collect(document);
        const describe=el=>{const r=el.getBoundingClientRect(),placeholder=String(el.getAttribute('placeholder')||el.getAttribute('aria-placeholder')||el.querySelector?.('[data-placeholder]')?.getAttribute('data-placeholder')||'');const hint=[placeholder,el.getAttribute('aria-label')||'',el.getAttribute('data-testid')||'',String(el.className||'')].join(' ');return{el,r,placeholder,hint};};
        const candidates=nodes.filter(visible).map(describe).filter(item=>{const hint=item.hint,tag=String(item.el?.tagName||'').toUpperCase(),genericComposer=tag==='TEXTAREA'||item.el?.isContentEditable===true||item.el?.getAttribute?.('role')==='textbox';return !/(?:search|搜索|项目|素材|任务)/i.test(hint)&&(genericComposer||!item.placeholder||/(?:描述|视频|想要|输入|prompt|创作|内容|故事)/i.test(hint));}).sort((a,b)=>b.r.bottom-a.r.bottom||b.r.width-a.r.width);
        const input=candidates[0];
        const diagnostics={candidateCount:candidates.length,candidates:candidates.slice(0,6).map(item=>({placeholder:item.placeholder,top:Math.round(item.r.top),bottom:Math.round(item.r.bottom),width:Math.round(item.r.width),height:Math.round(item.r.height)})),url:location.href};
        if(!input)return{filled:false,diagnostics};
        input.el.focus();
        if('value' in input.el){const proto=input.el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;setter?setter.call(input.el,prompt):(input.el.value=prompt);input.el.dispatchEvent(new InputEvent('input',{bubbles:true,composed:true,inputType:'insertText',data:prompt}));input.el.dispatchEvent(new Event('change',{bubbles:true,composed:true}));}
        else {const range=document.createRange();range.selectNodeContents(input.el);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);document.execCommand('delete',false);document.execCommand('insertText',false,prompt);if(!String(input.el.textContent||'').includes(prompt.slice(0,Math.min(12,prompt.length))))input.el.textContent=prompt;input.el.dispatchEvent(new InputEvent('input',{bubbles:true,composed:true,inputType:'insertText',data:prompt}));}
        const current=String(('value' in input.el?input.el.value:input.el.textContent||''));
        const r=input.el.getBoundingClientRect();
        return{filled:current.includes(prompt.slice(0,Math.min(12,prompt.length))),point:{x:r.left+r.width/2,y:r.top+r.height/2},diagnostics};
      })()`);
      session.lastComposerDiagnostic=result?.diagnostics||null;
      if(result?.filled)return true;
      if(result?.point&&!fallbackUsed){
        fallbackUsed=true;
        const cdp=await this.connect(session);
        await cdp.send("Input.dispatchMouseEvent",{type:"mouseMoved",x:result.point.x,y:result.point.y});
        await cdp.send("Input.dispatchMouseEvent",{type:"mousePressed",x:result.point.x,y:result.point.y,button:"left",clickCount:1});
        await cdp.send("Input.dispatchMouseEvent",{type:"mouseReleased",x:result.point.x,y:result.point.y,button:"left",clickCount:1});
        await cdp.send("Input.insertText",{text:source});
        const verified=await this.evaluate(session, `(() => {const token=${JSON.stringify(source.slice(0,12))};const values=[...document.querySelectorAll('textarea,input,[contenteditable="true"],[role="textbox"],[data-slate-editor="true"],.ProseMirror')].map(el=>String(('value' in el?el.value:el.textContent)||''));return values.some(value=>value.includes(token));})()`);
        if(verified)return true;
      }
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    return false;
  }
  async dispatchHumanClick(session, point) {
    if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) return false;
    const cdp=await this.connect(session),x=Number(point.x),y=Number(point.y);
    const trail=[{x:x-9,y:y+5},{x:x-5,y:y+2},{x:x-2,y:y+1},{x,y}];
    for(const item of trail){await cdp.send("Input.dispatchMouseEvent",{type:"mouseMoved",x:item.x,y:item.y,button:"none"});await new Promise(resolve=>setTimeout(resolve,24));}
    await cdp.send("Input.dispatchMouseEvent",{type:"mousePressed",x,y,button:"left",buttons:1,clickCount:1});
    await new Promise(resolve=>setTimeout(resolve,86));
    await cdp.send("Input.dispatchMouseEvent",{type:"mouseReleased",x,y,button:"left",buttons:0,clickCount:1});
    return true;
  }
  async clickComposerSend(session) {
    const deadline=Date.now()+5000;
    let diagnostic={reason:"send-control-not-found"};
    while(Date.now()<deadline){
      const point=await this.evaluate(session, `(() => { const visible=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>2&&r.height>2&&s.display!=='none'&&s.visibility!=='hidden'&&s.pointerEvents!=='none'}; const inputs=[...document.querySelectorAll('textarea,[contenteditable="true"],[role="textbox"],[data-slate-editor="true"]')].filter(visible).sort((a,b)=>b.getBoundingClientRect().bottom-a.getBoundingClientRect().bottom);const input=inputs[0];if(!input)return{reason:'composer-not-found'};const ir=input.getBoundingClientRect(),all=[...document.querySelectorAll('button,[role="button"],[data-dbx-name="button"]')].filter(visible);const candidates=all.map(e=>{const r=e.getBoundingClientRect(),label=String(e.innerText||e.textContent||e.getAttribute('aria-label')||e.getAttribute('title')||'').replace(/\\s+/g,'').trim(),hint=String(e.outerHTML||''),semantic=/(发送|生成|开始生成|立即生成)/.test(label)||/send|generate|submit|g-send-msg-btn/i.test(hint),inside=r.left>=ir.left-24&&r.right<=ir.right+24&&r.top>=ir.top-24&&r.bottom<=ir.bottom+86,nearBottom=r.top>=ir.bottom-36&&r.top<=ir.bottom+86&&r.left>=ir.left-24&&r.right<=ir.right+24,dataDisabled=String(e.getAttribute('data-disabled')||'').toLowerCase(),disabled=Boolean(e.disabled)||e.getAttribute('aria-disabled')==='true'||['true','1','disabled'].includes(dataDisabled)||String(getComputedStyle(e).pointerEvents)==='none';return{e,r,label,semantic,near:inside||nearBottom,disabled,dataDisabled}}).filter(item=>item.semantic&&item.near).sort((a,b)=>Math.hypot(a.r.left-ir.right,a.r.top-ir.bottom)-Math.hypot(b.r.left-ir.right,b.r.top-ir.bottom));const item=candidates[0];if(!item)return{reason:'send-control-not-found',composer:{left:ir.left,top:ir.top,right:ir.right,bottom:ir.bottom}};if(item.disabled)return{reason:'send-control-disabled',label:item.label,ariaDisabled:item.e.getAttribute('aria-disabled')||'',dataDisabled:item.dataDisabled};item.e.focus();return{x:item.r.left+item.r.width/2,y:item.r.top+item.r.height/2,label:item.label,reason:''}; })()`);
      diagnostic=point||diagnostic;
      if(point?.x!==undefined&&point?.y!==undefined){session.lastSendDiagnostic={...point,clickedAt:new Date().toISOString(),clickMode:"cdp-human"};return this.dispatchHumanClick(session,point);}
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    session.lastSendDiagnostic={...diagnostic,failedAt:new Date().toISOString(),clickMode:"cdp-human"};
    return false;
  }
  async readSubmissionState(session, prompt, expectedUserMessageId = "", expectedConversationId = "", submittedAt = "") {
    const state=await this.evaluate(session, `(() => {
      const classifyFailure=${classifyDoubaoFailureMessage.toString()};
      const match=location.pathname.match(/\\/chat\\/(\\d{6,})/);
      const conversationId=match?match[1]:'';
      const expectedConversationId=${JSON.stringify(String(expectedConversationId||""))};
      const conversationMatches=!expectedConversationId||conversationId===expectedConversationId;
      const submittedAtMs=Date.parse(${JSON.stringify(String(submittedAt||""))})||0;
      const visible=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>2&&r.height>2&&s.display!=='none'&&s.visibility!=='hidden'};
      const input=[...document.querySelectorAll('textarea,[contenteditable="true"],[role="textbox"],[data-slate-editor="true"]')].filter(visible).sort((a,b)=>b.getBoundingClientRect().bottom-a.getBoundingClientRect().bottom)[0];
      const inputText=String(input?.value||input?.textContent||'').trim();
      const token=${JSON.stringify(prompt.slice(0,24))};
      const expectedUserMessageId=${JSON.stringify(String(expectedUserMessageId||""))};
      const compact=value=>String(value||'').replace(/\\s+/g,'').replace(/[\\*_#>~]/g,'');
      const ownText=node=>String(node?.innerText||node?.textContent||'').replace(/\\s+/g,' ').trim();
      const roots=[...document.querySelectorAll('[class*="message-list"],[class*="message-container"],[data-testid*="message-list"]')].filter(visible).sort((a,b)=>b.querySelectorAll('[data-message-id]').length-a.querySelectorAll('[data-message-id]').length);
      const root=roots[0]||document.querySelector('main')||document.body;
      const primary=[...root.querySelectorAll('[data-message-id]')];
      const fallback=primary.length?[]:[...root.querySelectorAll('article,[class*="message-item"],[class*="message-block"],[class*="chat-message"]')].filter(visible).filter(node=>ownText(node).length>0);
      const messages=[...new Set(primary.length?primary:fallback)];
      const isUser=node=>{const cls=String(node?.className||'');const role=String(node?.getAttribute?.('data-role')||node?.getAttribute?.('data-author')||'');const bubble=node?.querySelector?.('[class*="g-send-msg-bubble"],[class*="send-msg-bubble"],[class*="user-message"]');return /user/i.test(role)||/(^|\\s)justify-end(\\s|$)/.test(cls)||Boolean(bubble)};
      const reversed=[...messages].reverse();
      const exactUserNode=expectedUserMessageId?messages.find(node=>node.getAttribute('data-message-id')===expectedUserMessageId):null;
      const promptUserNode=reversed.find(node=>isUser(node)&&compact(ownText(node)).includes(compact(token)));
      const latestUserNode=!expectedUserMessageId&&conversationMatches&&submittedAtMs?reversed.find(isUser):null;
      const userNode=exactUserNode||promptUserNode||latestUserNode||null;
      const currentConversationText=ownText(root);
      const promptPresentInCurrentConversation=conversationMatches&&compact(currentConversationText).includes(compact(token));
      const bindingMode=exactUserNode?'message-id':promptUserNode?'prompt-token':latestUserNode?'recovery-latest-user':promptPresentInCurrentConversation&&submittedAtMs?'recovery-current-conversation-text':'';
      const userIndex=userNode?messages.indexOf(userNode):-1;
      const messageTime=node=>{const raw=node?.getAttribute?.('data-created-at')||node?.getAttribute?.('data-timestamp')||node?.querySelector?.('time')?.getAttribute?.('datetime')||'';const value=Date.parse(raw);return Number.isFinite(value)?value:0};
      const signalNodes=(userIndex>=0?messages.slice(userIndex+1):[]).filter(node=>{const at=messageTime(node);return !submittedAtMs||!at||at>=submittedAtMs-5000});
      const visibleUserNodes=messages.filter(isUser);
      const hasUnmatchedVisibleUser=visibleUserNodes.some(node=>node!==exactUserNode&&node!==promptUserNode&&node!==latestUserNode);
      const recoveryTailEligible=conversationMatches&&Boolean(expectedConversationId)&&Boolean(submittedAtMs)&&!userNode&&!promptPresentInCurrentConversation&&!hasUnmatchedVisibleUser;
      const recentSignalNodes=(userIndex>=0?signalNodes:recoveryTailEligible?messages.slice(-4).filter(node=>!isUser(node)):[]).filter(node=>{const at=messageTime(node);return !submittedAtMs||!at||at>=submittedAtMs-5000});
      const followingText=signalNodes.map(ownText).join(' ');
      const alerts=[...document.querySelectorAll('[role="alert"],[role="dialog"],[class*="toast"],[class*="Toast"],[class*="notice"],[class*="Notice"]')].filter(visible).map(node=>String(node.innerText||node.textContent||'')).join(' ');
      const verificationOverlays=[...document.querySelectorAll('body *')].filter(node=>{if(!visible(node))return false;const hint=String(node.className||'')+' '+String(node.id||'')+' '+String(node.getAttribute?.('aria-label')||'');const own=String(node.innerText||node.textContent||'').replace(/\\s+/g,' ').trim();const style=getComputedStyle(node);return(/captcha|verify|verification|slider/i.test(hint)||['fixed','sticky'].includes(style.position))&&own.length<500&&/(安全验证|人工验证|拖动滑块|请完成验证|身份验证|captcha)/i.test(own)}).map(node=>String(node.innerText||node.textContent||'')).join(' ');
      const scopedGenerating=/(视频生成已提交|视频生成中|正在生成视频|排队生成|预计等待)/.test(followingText);
      const explicitFallback=/(本轮内容生成时请不要进行澄清，直接生成)/.test(followingText)&&!scopedGenerating;
      const recoveryScopedText=conversationMatches&&submittedAtMs&&promptPresentInCurrentConversation?currentConversationText.slice(-8000):'';
      const recoveryTailText=recoveryTailEligible?recentSignalNodes.map(ownText).join(' '):'';
      const taskBound=Boolean(userNode||promptPresentInCurrentConversation||(recoveryTailEligible&&recentSignalNodes.length));
      const scopedAlerts=conversationMatches&&taskBound?alerts:'';
      const providerSignal=[followingText,recoveryScopedText,recoveryTailText,scopedAlerts].join(' ').replace(/\\s+/g,' ').trim();
      const providerFailure=conversationMatches&&taskBound?classifyFailure(providerSignal):classifyFailure('');
      if(providerFailure.failed){providerFailure.submittedVerified=Boolean(userNode||promptPresentInCurrentConversation||expectedConversationId&&submittedAtMs);if(!userNode&&!promptPresentInCurrentConversation)providerFailure.evidence={...(providerFailure.evidence||{}),source:"doubao-current-conversation-tail",confidence:0.78};}
      const fingerprintNodes=signalNodes.length?signalNodes:recentSignalNodes;
      const fingerprintSource=[conversationId,userNode?.getAttribute?.('data-message-id')||'',...fingerprintNodes.map(node=>node.getAttribute?.('data-message-id')||ownText(node).slice(0,160)),providerFailure.code||''].join('|');
      let hash=5381;for(let index=0;index<fingerprintSource.length;index++)hash=((hash<<5)+hash)^fingerprintSource.charCodeAt(index);const evidenceFingerprint=fingerprintSource?conversationId+':'+(hash>>>0).toString(16):'';
      const latestSignalAt=fingerprintNodes.map(messageTime).filter(Boolean).sort((a,b)=>b-a)[0]||0;
      return {verification:conversationMatches&&/(安全验证|人工验证|拖动滑块|请完成验证|身份验证|captcha)/i.test([scopedAlerts,verificationOverlays].join(' ')),conversationId,conversationMatches,bindingMode,promptPresentInCurrentConversation,inputText,userMessage:Boolean(userNode||promptPresentInCurrentConversation),userMessageId:userNode?.getAttribute('data-message-id')||'',scopedGenerating,explicitFallback,providerSignal:providerSignal.slice(-1200),providerSignalAt:latestSignalAt?new Date(latestSignalAt).toISOString():(providerSignal?new Date().toISOString():''),evidenceFingerprint,signalCount:fingerprintNodes.length,...providerFailure,quotaMessage:providerFailure.quotaExhausted?providerFailure.providerMessage:''};
    })()`);
    state.isNewSignal=Boolean(state.evidenceFingerprint&&state.evidenceFingerprint!==session.lastEvidenceFingerprint);
    if(state.evidenceFingerprint)session.lastEvidenceFingerprint=state.evidenceFingerprint;
    return state;
  }
  async validateSubmissionContext(command) {
    const session=await this.open(command.account),sourcePrompt=String(command.payload?.prompt||"").trim();
    if(!sourcePrompt)throw new Error("人工核对缺少任务提示词");
    const expectedConversationId=String(command.payload?.conversationId||"").trim();
    let state;
    if(session.testMode){const currentConversationId=String(command.payload?.simulateConversationId||expectedConversationId||"mock-context");const promptMatched=command.payload?.simulatePromptMatched!==false;state={conversationId:currentConversationId,conversationMatches:!expectedConversationId||currentConversationId===expectedConversationId,promptPresentInCurrentConversation:promptMatched,userMessage:promptMatched,userMessageId:promptMatched?"mock-user-message":"",bindingMode:promptMatched?"prompt-token":""};}
    else{
      await this.connect(session);const login=await this.detect(command.account);
      if(!login.loggedIn)return {ok:false,matched:false,code:"DOUBAO_LOGIN_REQUIRED",category:"authentication",message:"当前豆包账号尚未登录，请先登录并打开正确会话",monitorProbe:{conversationId:"",requestedConversationId:expectedConversationId,promptMatched:false,conversationMatched:false}};
      state=await this.readSubmissionState(session,sourcePrompt,command.payload?.userMessageId||"",expectedConversationId,command.payload?.submittedAt||"");
    }
    const validation=validateSubmissionContextState(state,expectedConversationId),monitorProbe={conversationId:validation.conversationId,requestedConversationId:validation.expectedConversationId,promptMatched:validation.promptMatched,conversationMatched:validation.conversationMatched,bindingMode:validation.bindingMode,userMessageId:validation.userMessageId};
    if(!validation.matched){session.phase="submission_unknown";return {ok:false,matched:false,code:"DOUBAO_SUBMISSION_CONTEXT_MISMATCH",category:"monitor_binding",conversationId:validation.conversationId,userMessageId:validation.userMessageId,monitorProbe,message:validation.conversationMatched?"当前豆包会话没有匹配到该任务提示词，请先打开包含该提示词的正确会话":"当前豆包会话与任务记录不一致，请先打开该任务对应的正确会话"};}
    session.conversationId=validation.conversationId;session.phase="submission_unknown";
    return {ok:true,matched:true,conversationId:validation.conversationId,userMessageId:validation.userMessageId,monitorProbe,message:"当前会话与任务提示词匹配成功"};
  }
  async runGeneration(command) {
    const session = await this.open(command.account);
    session.phase = "preparing";
    session.currentJobId = String(command.payload?.jobId || command.id || "");
    const sourcePrompt = String(command.payload?.prompt || "").trim();
    const referenceAssets=normalizeReferenceAssets(command.payload||{});
    const prompt=buildReferencePrompt(sourcePrompt,referenceAssets);
    if (!sourcePrompt) throw new Error("生成任务缺少提示词");
    if (session.testMode) {
      session.phase = "idle";
      if (command.payload?.simulateQuotaExhausted) return {ok:false,quotaExhausted:true,notSentVerified:true,code:"DOUBAO_VIDEO_QUOTA_EXHAUSTED",message:"豆包明确提示视频额度没有了，本次未创建生成任务"};
      if (command.payload?.simulateProviderFailureMessage) return {ok:false,...classifyDoubaoFailureMessage(command.payload.simulateProviderFailureMessage),message:String(command.payload.simulateProviderFailureMessage)};
      if (command.action === "resume") return {ok: true, resumed: true, generating: true, verificationRequired: false, message: "人工验证已解除，继续监控原任务；未重新发送提示词"};
      if (command.payload?.simulateVerification) return {ok: true, paused: true, verificationRequired: true, submittedEvidence: {prompt,sourcePrompt,referenceManifest:buildReferenceManifest(referenceAssets), commandId: command.id}, message: "测试模式检测到人工验证，任务已暂停"};
      const conversationId = `mock-${command.payload?.jobId || command.id}`;
      session.conversationId = conversationId;
      const referenceUpload=await this.uploadReferenceImages(session,{imageAssets:referenceAssets});
      return {ok: true, generating: true, conversationId, submittedEvidence: {prompt,sourcePrompt,referenceManifest:buildReferenceManifest(referenceAssets), commandId: command.id, conversationId, referenceUpload}, message: "测试模式已提交生成任务"};
    }
    await this.connect(session);
    const login = await this.detect(command.account);
    if (login.verificationRequired) { session.phase = "verification"; return {ok:true,paused:true,verificationRequired:true,loginState:login.state,notSentVerified:command.action==="generate",message:"豆包需要人工验证，请完成后继续"}; }
    if (!login.loggedIn) { session.phase = "idle"; return {ok:true,loginRequired:true,loginState:login.state||"unknown",notSentVerified:true,code:"DOUBAO_LOGIN_REQUIRED",category:"authentication",retryMode:"reauthenticate",requiresPromptEdit:false,userAction:"请打开该豆包账号完成登录，然后点击继续。",providerMessage:login.message||"豆包账号尚未登录",quotaConsumed:false,message:login.message||"豆包账号尚未登录"}; }
    if (command.action === "monitor") {
      const stateArgs=[sourcePrompt,command.payload?.userMessageId||"",command.payload?.conversationId||"",command.payload?.submittedAt||""];
      let monitorState = await this.readSubmissionState(session,...stateArgs);
      const currentPageBound=Boolean(monitorState?.conversationMatches&&(monitorState?.providerTerminal||monitorState?.verification||monitorState?.userMessage||monitorState?.promptPresentInCurrentConversation||monitorState?.scopedGenerating));
      if(!currentPageBound){await this.restoreConversation(session, command);monitorState=await this.readSubmissionState(session,...stateArgs);}
      const conversationId = String(monitorState?.conversationId || session.conversationId || command.payload?.conversationId || "");
      session.conversationId = conversationId;
      if (monitorState?.quotaExhausted && !monitorState?.scopedGenerating) {
        session.phase = "idle";
        return {ok:false,quotaExhausted:true,notSentVerified:true,safeToRetry:true,submissionRejected:true,code:"DOUBAO_VIDEO_QUOTA_EXHAUSTED",conversationId,message:`豆包明确提示今日视频额度已用完，当前账号停止执行并允许安全换号${monitorState.quotaMessage?`：${monitorState.quotaMessage}`:""}`};
      }
      if (monitorState?.providerTerminal) { session.phase="idle";return {ok:false,...monitorState,conversationId,message:monitorState.providerMessage||monitorState.userAction||"豆包明确结束本次生成"}; }
      if (monitorState?.verification) { session.phase = "verification"; return {ok: true, paused: true, verificationRequired: true, conversationId, message: "豆包出现人工验证，请在本机窗口完成后继续"}; }
      if (command.payload?.terminalProbe) {
        const recovered=Boolean(monitorState?.conversationId&&monitorState?.userMessage&&monitorState?.promptPresentInCurrentConversation&&(monitorState?.scopedGenerating||/(?:视频生成已提交|视频生成中|正在生成视频|排队生成|预计等待|视频生成好了)/.test(String(monitorState?.providerSignal||""))));
        if(recovered){
          session.phase="generating";
          return {ok:true,generating:true,resumed:true,submissionRecovered:true,conversationId:monitorState.conversationId,submittedEvidence:{prompt:buildReferencePrompt(sourcePrompt,referenceAssets),sourcePrompt,conversationId:monitorState.conversationId,userMessageId:String(monitorState.userMessageId||""),evidenceType:"terminal-audit-current-conversation",scopedGenerating:Boolean(monitorState.scopedGenerating),providerSignalExcerpt:String(monitorState.providerSignal||"").slice(-500),referenceManifest:buildReferenceManifest(referenceAssets)},message:"已在原豆包会话确认提交，继续监控；未重新发送提示词"};
        }
        session.phase="submission_unknown";return {ok:true,unchanged:true,submissionUnknown:true,conversationId,message:"未发现豆包明确终止信息，继续保持提交状态未知；不会重新提交"};
      }
      session.phase = "generating";
      return {ok: true, verificationRequired: false, generating: true, resumed: true, conversationId, monitorProbe:{conversationMatches:monitorState?.conversationMatches===true,bindingMode:String(monitorState?.bindingMode||""),promptPresentInCurrentConversation:monitorState?.promptPresentInCurrentConversation===true,signalCount:Number(monitorState?.signalCount||0),evidenceFingerprint:String(monitorState?.evidenceFingerprint||""),providerSignalExcerpt:String(monitorState?.providerSignal||"").slice(-500)}, message: "已恢复原会话，继续监控；未重新发送提示词"};
    }
    const state = await this.evaluate(session, `(() => { const text=String(document.body?.innerText||'').replace(/\\s+/g,' '); return {verification:/(安全验证|人工验证|拖动滑块|请完成验证|captcha)/i.test(text)}; })()`);
    if (state?.verification) { session.phase = "verification"; return {ok: true, paused: true, verificationRequired: true, message: "豆包出现人工验证，请在本机窗口完成后继续"}; }
    if (command.action === "resume") { session.phase = "generating"; return {ok: true, verificationRequired: false, generating: true, resumed: true, conversationId:session.conversationId||String(command.payload?.conversationId||""), message: "人工验证已解除，继续监控原任务；未重新发送提示词"}; }
    await this.prepareFreshConversation(session, command.account);
    try{await this.ensureVideoMode(session);await this.setVideoParameters(session, command.payload || {});}
    catch(error){if(error?.notSentVerified!==true)Object.assign(error,{safeToRetry:true,notSentVerified:true,submittedVerified:false,code:error?.code||"DOUBAO_PARAMETER_CONFIG_FAILED",category:error?.category||"parameters",retryMode:error?.retryMode||"adjust_parameters",userAction:error?.userAction||"豆包页面参数没有配置成功，本次提示词尚未发送。请确认模型、比例和时长后安全重试。",quotaConsumed:false});throw error;}
    await this.waitForComposer(session, 12000);
    const referenceUpload=await this.uploadReferenceImages(session,{imageAssets:referenceAssets});
    session.phase="preparing";
    // 豆包上传参考图后可能重建编辑器节点；重新等待可见输入框，避免在旧节点销毁窗口期直接判定失败。
    await this.waitForComposer(session, 15000);
    const filled = await this.fillComposer(session, prompt);
    if (!filled) throw new Error("没有找到豆包提示词输入框");
    const beforeConversationId = String(await this.evaluate(session, `location.pathname.match(/\\/chat\\/(\\d{6,})/)?.[1] || ''`) || "");
    let clickedAt = Date.now();
    session.phase = "submitting";
    session.submissionRequests = [];
    session.pendingSubmission = {jobId:session.currentJobId,prompt:sourcePrompt,providerPrompt:prompt,beforeConversationId,startedAt:clickedAt};
    const sent = await this.clickComposerSend(session);
    if (!sent) { session.pendingSubmission = null; session.phase = "idle"; throw new Error(`没有找到可点击的豆包发送或生成按钮：${JSON.stringify(session.lastSendDiagnostic||{})}`); }
    let after = {};
    let requestEvidence = null;
    let submissionEvidence = classifySubmissionEvidence({prompt:sourcePrompt,beforeConversationId,after});
    let evidenceDeadline = Date.now() + 30000;
    while (true) {
      after = await this.readSubmissionState(session, sourcePrompt);
      if (after?.verification) break;
      requestEvidence = (session.submissionRequests || []).find(item => item.jobId === session.currentJobId && item.at >= clickedAt - 250 && item.videoGenerationRequest) || null;
      submissionEvidence = classifySubmissionEvidence({prompt:sourcePrompt,beforeConversationId,after,request:requestEvidence});
      if (after?.providerTerminal) break;
      if (submissionEvidence.confirmed) break;
      if (Date.now() >= evidenceDeadline) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    session.pendingSubmission = null;
    if (after?.verification) { session.phase = "verification"; return {ok: true, paused: true, verificationRequired: true, message: "豆包出现人工验证，请在本机窗口完成后继续"}; }
    if (after?.quotaExhausted && !submissionEvidence.confirmed && !requestEvidence?.videoGenerationRequest && !after?.scopedGenerating) { session.phase="idle";return {ok:false,quotaExhausted:true,notSentVerified:true,code:"DOUBAO_VIDEO_QUOTA_EXHAUSTED",conversationId:String(after.conversationId||""),message:`豆包明确提示视频额度已用完，本次未创建生成任务${after.quotaMessage?`：${after.quotaMessage}`:""}`}; }
    if (after?.providerTerminal) { session.phase="idle";return {ok:false,...after,conversationId:String(after.conversationId||""),message:after.providerMessage||after.userAction||"豆包明确结束本次生成"}; }
    if (!submissionEvidence.confirmed) { session.phase = "submission_unknown"; throw new Error(`提交状态未知：已执行真人轨迹点击，但当前会话未出现“视频生成已提交/正在生成”或真正的视频生成请求；为避免重复生成，不再自动重提。点击证据：${JSON.stringify(session.lastSendDiagnostic||{})}`); }
    session.conversationId = String(submissionEvidence.conversationId || session.conversationId || "");
    session.phase = "generating";
    return {ok: true, generating: true, conversationId: session.conversationId, submittedEvidence: {prompt,sourcePrompt,referenceManifest:buildReferenceManifest(referenceAssets), commandId: command.id, conversationId: session.conversationId, evidenceType:submissionEvidence.evidenceType, userMessageId:String(after?.userMessageId||""), requestId:String(requestEvidence?.requestId||""), requestUrl:String(requestEvidence?.url||""), scopedGenerating:Boolean(after?.scopedGenerating), retryCount:0,referenceUpload}, message: after?.scopedGenerating ? "豆包当前会话已确认正在生成" : `豆包提交已确认（${submissionEvidence.evidenceType}）`};
  }
  async execute(command) {
    if (!command || !command.account) throw new Error("服务器命令缺少账号信息");
    if (command.action === "open") {
      await this.open(command.account);
      return {ok: true, loggedIn: false, verificationRequired: false, message: "已在本机打开独立 Chrome 窗口，请完成登录或验证"};
    }
    if (command.action === "detect") {
      const result = await this.detect(command.account);
      return {ok: true, ...result, message: result.verificationRequired ? "豆包需要人工验证" : (result.loggedIn ? "豆包账号已登录" : "豆包账号尚未登录")};
    }
    if (command.action === "validate_submission_context") return this.validateSubmissionContext(command);
    if (command.action === "recover_result") {
      const session = await this.open(command.account);
      const resultUrl = String(command.payload?.resultUrl || command.payload?.resultUrls?.[0] || "").trim();
      const videoVid = normalizeVideoVid(command.payload?.videoVid);
      if (!videoVid && !/^https?:\/\//i.test(resultUrl) && !session.testMode) throw new Error("豆包结果回传缺少视频 VID 或有效的视频地址");
      session.phase = "downloading";
      const jobId = command.payload?.jobId || command.id;
      const resource = {...(command.payload?.resourceDescriptor || {}), url: resultUrl, pageUrl: command.payload?.fallbackResultVid || resultUrl, videoVid, mimeType: command.payload?.mimeType || command.payload?.resourceDescriptor?.mimeType || "video/mp4"};
      const downloaded = await this.downloadDoubaoVideoWithFallback(session, resource, {jobId, conversationId: command.payload?.conversationId || "", videoVid, fallbackResultVid: command.payload?.fallbackResultVid || resultUrl});
      session.phase = "idle";
      return {ok: true, state: "completed", jobId, ...downloaded, conversationId: String(command.payload?.conversationId || ""), conversationVid:String(command.payload?.conversationVid||command.payload?.conversationId||""), videoVid:downloaded.videoVid||videoVid||this.latestVideoVid(session,{jobId,conversationId:command.payload?.conversationId||""})};
    }
    if (command.action === "generate") {
      return this.withSubmissionLock(command.account.id, () => this.runGeneration(command));
    }
    if (command.action === "resume") {
      return this.runGeneration(command);
    }
    if (command.action === "monitor") {
      const result = await this.runGeneration(command);
      if (result.verificationRequired || result.paused) return result;
      if (result.generating || result.resumed) {
        const session = await this.open(command.account);
        const jobId = command.payload?.jobId || command.id;
        let video;
        try {
          video = await this.waitForVideo(session, {jobId, conversationId: result.conversationId || "", timeoutMs: Number(command.payload?.monitorTimeoutMs || 10000)});
        } catch (error) {
          return {...result, state: "generating", videoPending: true, videoError: String(error.message || error), conversationVid:result.conversationVid||result.conversationId||"", videoVid:normalizeVideoVid(result.videoVid)||this.latestVideoVid(session,{jobId,conversationId:result.conversationId||""})};
        }
        try {
          const downloaded = await this.downloadDoubaoVideoWithFallback(session, video, {jobId, conversationId: video.conversationId || result.conversationId || "", videoVid: normalizeVideoVid(video.videoVid)||normalizeVideoVid(result.videoVid)||this.latestVideoVid(session,{jobId,conversationId:video.conversationId||result.conversationId||""}), fallbackResultVid: video.url});
          session.phase = "idle";
          return {...result, ...downloaded, state: "completed", jobId, conversationId: video.conversationId || result.conversationId || "", conversationVid:result.conversationVid||result.conversationId||video.conversationId||"", videoVid:downloaded.videoVid||normalizeVideoVid(video.videoVid)||normalizeVideoVid(result.videoVid)||this.latestVideoVid(session,{jobId,conversationId:video.conversationId||result.conversationId||""})};
        } catch (error) {
          session.phase = "downloading";
          const diagnostic = error.downloadDiagnostic ? `；响应类型 ${error.downloadDiagnostic.contentType || "未知"}，大小 ${error.downloadDiagnostic.bytes || 0} 字节` : "";
          return {...result, state: "downloading", resultDownloadFailed: true, videoPending: true, videoError: `${String(error.message || error)}${diagnostic}`, videoUrl: video.url, resultUrls: [video.url], fallbackResultVid:video.url, watermarkFree:false, watermarkFreeError:String(error.watermarkFreeError||""), resultUrlSource:"doubao-page-fallback", resultSourceResolvedAt:new Date().toISOString(), resourceDescriptor: video, conversationId: video.conversationId || result.conversationId || "", conversationVid:result.conversationVid||result.conversationId||video.conversationId||"", videoVid:normalizeVideoVid(video.videoVid)||normalizeVideoVid(result.videoVid)||this.latestVideoVid(session,{jobId,conversationId:video.conversationId||result.conversationId||""}), code: "DOUBAO_RESULT_DOWNLOAD_FAILED", category: "result_download", retryMode: "recover_result", accountAction: "hold", submittedVerified: true, safeToRetry: false, notSentVerified: false, terminalFailureVerified: false, userAction: "豆包结果已经生成并绑定到原任务，正在仅恢复视频下载与素材回填；不会重新提交生成。", message: `豆包结果下载或校验失败，稍后仅恢复结果回传：${String(error.message || error)}${diagnostic}`};
        }
      }
      return result;
    }
    throw new Error(`不支持的命令：${command.action}`);
  }
  closeAll() {
    for (const session of this.sessions.values()) {
      if (session.process && session.process.exitCode === null) try { session.process.kill(); } catch {}
    }
    this.sessions.clear();
    this.submissionTails.clear();
  }
  closeAccount(accountOrId, options = {}) {
    const accountId = safeAccountId(typeof accountOrId === "object" ? accountOrId?.id || accountOrId?.accountId : accountOrId);
    const session = this.sessions.get(accountId);
    if (session) {
      try { session.cdp?.close(); } catch {}
      if (session.embedded) {
        const manager = this.embeddedBrowserProvider?.();
        if (manager) manager.close({id: accountId}, {force: options.force === true});
        else if (session.window && !session.window.isDestroyed?.()) session.window.destroy?.();
      } else if (session.process && session.process.exitCode === null) {
        session.process.kill();
      }
      this.sessions.delete(accountId);
    } else if (options.closeEmbedded !== false) {
      this.embeddedBrowserProvider?.()?.close({id: accountId}, {force: options.force === true});
    }
    this.submissionTails.delete(accountId);
    return {ok: true, closed: Boolean(session), accountId};
  }
}

module.exports = {BrowserController, classifySubmissionEvidence, classifyDoubaoFailureMessage, validateSubmissionContextState, probeDoubaoVideoResultPage, findBrowser, freePort, safeAccountId, normalizeVideoParameters, normalizeReferenceAssets, normalizeReferenceRole, inferReferenceRole, defaultReferenceDescription, buildReferenceManifest, buildReferencePrompt, referenceUploadError, detectQuotaMessage, REFERENCE_ROLE_LABELS, DOUBAO_VIDEO_MODELS, DOUBAO_VIDEO_RATIOS};
