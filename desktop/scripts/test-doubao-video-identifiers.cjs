"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {extractVideoVid, extractVideoVids, normalizeVideoVid, isVideoResourceRequest} = require("../src/main/doubao-video-identifiers.cjs");
const {BrowserController, probeDoubaoVideoResultPage} = require("../src/main/browser-controller.cjs");
const {WorkbenchDataBridge} = require("../src/main/workbench-data-bridge.cjs");

const root = path.resolve(__dirname, "..");
const referencePath = path.join(root, "references", "doubao-video-identifiers-ground-truth.json");
const logPath = path.join(root, "scripts", "log", "doubao-video-identifiers-test.json");
const defaultGroundTruth = {
  source: "2026-08-20 豆包真实完成任务 CDP 网络诊断",
  conversationId: "38438280791332866",
  expectedConversationVid: "38438280791332866",
  postData: "{\"vid\":[\"v0269cg10004da31lm27dld84kiu5uag\"]}",
  responseBody: "{\"data\":{\"vid\":\"v0269cg10004da31lm27dld84kiu5uag\",\"video_id\":\"v0269cg10004da31lm27dld84kiu5uag\"}}",
  expectedVideoVid: "v0269cg10004da31lm27dld84kiu5uag",
  videoUrl: "https://v3-default.douyinvod.com/example/video.mp4?token=temporary-signed-url",
  resourceEndpoint: "https://www.doubao.com/creativity/resource/get_without_watermark",
  latestRealTask: {taskId:"5b76d37d7bde4c80bfc962dc4c882512",conversationId:"38438304333091586",messageId:"53113317678646786",videoVid:"v0269cg10004da3cofq7dldbokquff60",messageContent:"[{\"block_type\":2074,\"content\":{\"creation_block\":{\"creations\":[{\"video\":{\"vid\":\"v0269cg10004da3cofq7dldbokquff60\",\"video_model\":\"{\\\"video_id\\\":\\\"v0269cg10004da3cofq7dldbokquff60\\\"}\"}}]}}}]"}
};

function ensureGroundTruth() {
  fs.mkdirSync(path.dirname(referencePath), {recursive:true});
  if (!fs.existsSync(referencePath)) fs.writeFileSync(referencePath, JSON.stringify(defaultGroundTruth, null, 2), "utf8");
  return JSON.parse(fs.readFileSync(referencePath, "utf8"));
}

function test(name, work, results) {
  try { work(); results.push({name, passed:true}); }
  catch (error) { results.push({name, passed:false, error:String(error.stack||error)}); }
}
const pendingTests=[];
function testAsync(name, work, results) { pendingTests.push(Promise.resolve().then(work).then(()=>results.push({name,passed:true})).catch(error=>results.push({name,passed:false,error:String(error.stack||error)}))); }

const truth = ensureGroundTruth();
const results = [];
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-video-vid-"));

test("从真实 get_without_watermark POST 数据提取视频 VID", () => {
  assert.strictEqual(extractVideoVid({url:truth.resourceEndpoint,postData:truth.postData}), truth.expectedVideoVid);
  assert.strictEqual(isVideoResourceRequest(truth.resourceEndpoint), true);
}, results);

test("从响应 vid 和 video_id 提取且去重", () => {
  assert.deepStrictEqual(extractVideoVids({responseBody:truth.responseBody}), [truth.expectedVideoVid]);
}, results);

test("浏览器网络监听把真实请求 VID 绑定到当前任务和会话", () => {
  const controller = new BrowserController({profileRootProvider:()=>temporaryRoot,downloadRootProvider:()=>temporaryRoot,testMode:true});
  const session = {currentJobId:"job-real-sample",conversationId:truth.conversationId,videoIdentifiers:[]};
  controller.recordVideoIdentifierRequest(session,{requestId:"request-real-sample",request:{url:truth.resourceEndpoint,method:"POST",postData:truth.postData}});
  assert.strictEqual(session.videoIdentifiers.length, 1);
  assert.strictEqual(session.videoIdentifiers[0].jobId, "job-real-sample");
  assert.strictEqual(session.videoIdentifiers[0].conversationId, truth.conversationId);
  assert.strictEqual(controller.latestVideoVid(session,{jobId:"job-real-sample",conversationId:truth.conversationId}), truth.expectedVideoVid);
}, results);

test("豆包新版页面从视频消息 React 数据兜底提取 VID", () => {
  const card={clicked:false,click(){this.clicked=true}};
  const message={innerText:"你的视频生成好了。",textContent:"你的视频生成好了。",getAttribute:name=>name==="data-message-id"?truth.latestRealTask.messageId:"",querySelector:()=>card};
  card.__reactFiber$test={memoizedProps:{},pendingProps:{},memoizedState:null,return:{memoizedProps:{message:{content:truth.latestRealTask.messageContent}},pendingProps:null,memoizedState:null,return:null}};
  const previousDocument=global.document,previousWindow=global.window;
  global.document={body:{innerText:"你的视频生成好了。"},querySelectorAll:selector=>selector==="[data-message-id]"?[message]:selector==="video"?[]:[]};global.window={};
  try{const result=probeDoubaoVideoResultPage();assert.strictEqual(result.videoVid,truth.latestRealTask.videoVid);assert.strictEqual(result.messageId,truth.latestRealTask.messageId);assert.strictEqual(result.clicked,true);assert.strictEqual(card.clicked,true);}finally{global.document=previousDocument;global.window=previousWindow;}
}, results);

testAsync("视频网络地址先到达时仍先从页面消息补齐 VID", async () => {
  const controller=new BrowserController({profileRootProvider:()=>temporaryRoot,downloadRootProvider:()=>temporaryRoot,testMode:false});
  controller.connect=async()=>({});controller.evaluate=async()=>({videoVid:truth.latestRealTask.videoVid,messageId:truth.latestRealTask.messageId});
  const session={captures:[{seq:1,url:truth.videoUrl,mimeType:"video/mp4",jobId:truth.latestRealTask.taskId,conversationId:truth.latestRealTask.conversationId}],consumedCaptures:new Set(),videoIdentifiers:[],currentJobId:truth.latestRealTask.taskId,conversationId:truth.latestRealTask.conversationId};
  const result=await controller.waitForVideo(session,{jobId:truth.latestRealTask.taskId,conversationId:truth.latestRealTask.conversationId,timeoutMs:1000});
  assert.strictEqual(result.videoVid,truth.latestRealTask.videoVid);assert.strictEqual(controller.latestVideoVid(session,{jobId:truth.latestRealTask.taskId,conversationId:truth.latestRealTask.conversationId}),truth.latestRealTask.videoVid);
}, results);

test("不把完整 HTTP 视频地址误判为 VID", () => {
  assert.strictEqual(normalizeVideoVid(truth.videoUrl), "");
  assert.strictEqual(extractVideoVid({value:{vid:truth.videoUrl}}), "");
}, results);

test("会话 VID、视频 VID 持久化并可在重启后恢复", () => {
  const bridge = new WorkbenchDataBridge({tenantRootProvider:()=>temporaryRoot});
  const projectId = bridge.bootstrap().currentProjectId;
  const task = bridge.createTask({projectId,title:"VID 持久化测试",prompt:"测试视频",executionChannel:"doubao",accountId:"account-a",accountName:"账号 A",accountCandidates:[{id:"account-a",name:"账号 A"}],state:"generating"});
  const updated = bridge.reportTask(task.id,{conversationId:truth.conversationId,videoVid:truth.expectedVideoVid,statusText:"已捕获视频 VID"});
  assert.strictEqual(updated.conversationVid, truth.expectedConversationVid);
  assert.strictEqual(updated.videoVid, truth.expectedVideoVid);
  const restarted = new WorkbenchDataBridge({tenantRootProvider:()=>temporaryRoot});
  const restored = restarted.bootstrap().tasks.find(item=>item.id===task.id);
  assert.strictEqual(restored.conversationVid, truth.expectedConversationVid);
  assert.strictEqual(restored.videoVid, truth.expectedVideoVid);
}, results);

test("下载失败、暂停和重新回传不会丢失 VID，结果链接语义保持不变", () => {
  const bridge = new WorkbenchDataBridge({tenantRootProvider:()=>temporaryRoot});
  const task = bridge.bootstrap().tasks.find(item=>item.title==="VID 持久化测试");
  const downloading = bridge.reportTask(task.id,{state:"downloading",resultVid:truth.videoUrl,resultUrls:[truth.videoUrl],retryMode:"recover_result",recoveryState:"result_download_failed",error:"注入下载失败"});
  assert.strictEqual(downloading.videoVid, truth.expectedVideoVid);
  assert.strictEqual(downloading.resultVid, truth.videoUrl);
  const paused = bridge.reportTask(task.id,{state:"paused",recoveryState:"result_review_required",statusText:"等待人工处理"});
  assert.strictEqual(paused.conversationVid, truth.expectedConversationVid);
  assert.strictEqual(paused.videoVid, truth.expectedVideoVid);
  const recovered = bridge.prepareDoubaoResultRecovery(task.id,{resultUrl:truth.videoUrl,source:"test"});
  assert.strictEqual(recovered.videoVid, truth.expectedVideoVid);
  assert.strictEqual(recovered.resultVid, truth.videoUrl);
}, results);

test("完成绑定保存两个 VID，resultVid 仍保存视频 URL", () => {
  const bridge = new WorkbenchDataBridge({tenantRootProvider:()=>temporaryRoot});
  const task = bridge.bootstrap().tasks.find(item=>item.title==="VID 持久化测试");
  const videoPath = path.join(temporaryRoot, "result.mp4");
  fs.writeFileSync(videoPath, Buffer.from("fake-mp4-video-result"));
  const asset = bridge.importAssets({projectId:task.projectId,paths:[videoPath],source:"test"})[0];
  const completed = bridge.completeTask(task.id,{resultAssetId:asset.id,resultVid:truth.videoUrl,conversationVid:truth.expectedConversationVid,videoVid:truth.expectedVideoVid,resultType:"video",resultUrls:[truth.videoUrl],evidence:{tenantId:path.basename(temporaryRoot),accountId:task.accountId,conversationId:truth.conversationId,submittedAt:new Date(Date.now()-1000).toISOString()}});
  assert.strictEqual(completed.conversationVid, truth.expectedConversationVid);
  assert.strictEqual(completed.videoVid, truth.expectedVideoVid);
  assert.strictEqual(completed.resultVid, truth.videoUrl);
}, results);

test("安全重试创建的新任务不会继承旧会话或旧视频 VID", () => {
  const retryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-video-vid-retry-"));
  const bridge = new WorkbenchDataBridge({tenantRootProvider:()=>retryRoot});
  const projectId = bridge.bootstrap().currentProjectId;
  const source = bridge.createTask({projectId,title:"重试 VID 清理",prompt:"旧任务",executionChannel:"doubao",accountId:"account-a",accountName:"账号 A",accountCandidates:[{id:"account-a",name:"账号 A"}],state:"failed",conversationId:truth.conversationId,conversationVid:truth.expectedConversationVid,videoVid:truth.expectedVideoVid});
  bridge.reportTask(source.id,{safeToRetry:true,terminalFailureVerified:true,retryMode:"retry_or_edit"});
  const retry = bridge.retryTask(source.id,{prompt:"新任务"});
  assert.strictEqual(retry.conversationId, "");
  assert.strictEqual(retry.conversationVid, "");
  assert.strictEqual(retry.videoVid, "");
}, results);

test("任务中心包含独立的会话 VID 与视频 VID 展示逻辑", () => {
  const source = fs.readFileSync(path.join(root,"src","renderer","task-center.js"),"utf8");
  assert.match(source, /会话 VID/);
  assert.match(source, /视频 VID/);
  assert.match(source, /current\?\.conversationVid\|\|current\?\.conversationId/);
  assert.match(source, /current\?\.videoVid/);
}, results);

Promise.all(pendingTests).then(()=>{const failed=results.filter(item=>!item.passed);const report={testedAt:new Date().toISOString(),groundTruth:referencePath,temporaryRoot,passed:results.length-failed.length,failed:failed.length,results};fs.mkdirSync(path.dirname(logPath),{recursive:true});fs.writeFileSync(logPath,JSON.stringify(report,null,2),"utf8");process.stdout.write(JSON.stringify(report,null,2)+"\n");if(failed.length)process.exitCode=1;}).catch(error=>{console.error(error.stack||error);process.exitCode=1});
