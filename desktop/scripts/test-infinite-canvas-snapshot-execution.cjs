"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname,"..");
const core = require(path.join(root,"src","renderer","canvas-flow-core.js"));
const adapter = require(path.join(root,"src","renderer","canvas-input-adapter.js"));
const adapterSource = fs.readFileSync(path.join(root,"src","renderer","canvas-input-adapter.js"),"utf8");
const results = [];
const check = (name, condition, detail = "") => results.push({name,passed:Boolean(condition),detail:condition ? "" : String(detail)});

const nodes = [
  core.makeNode("video-prompt",{x:0,y:0},{id:"prompt",title:"视频提示词",status:"completed",output:{type:"text",content:"旧版镜头提示词"},refs:{assetIds:[],assetRoles:{},jobIds:["job-prompt-old"],conversationIds:["conv-prompt-old"]}}),
  core.makeNode("image-input",{x:0,y:220},{id:"image",title:"人物素材",refs:{assetIds:["asset-person-old"],assetRoles:{"asset-person-old":"人物"},jobIds:["job-image-old"],conversationIds:[]}}),
  core.makeNode("video-generation",{x:420,y:80},{id:"video",title:"视频生成",instruction:"10 秒，16:9",refs:{assetIds:["asset-local"],assetRoles:{"asset-local":"首帧"},jobIds:[],conversationIds:[]},modelParameters:{duration:"10s"}})
];
const edges = [
  core.makeEdge("prompt","video",{id:"edge-prompt",order:1}),
  core.makeEdge("image","video",{id:"edge-image",order:2,role:"人物"})
];

const first = adapter.resolveExecutionEnvelope("video",nodes,edges);
check("pending 连线首次解析时捕获一次",edges.every(edge => edge.data.inputSnapshot.state === "captured"),JSON.stringify(edges));
check("首次快照文本进入提示词",first.prompt === "10 秒，16:9\n\n旧版镜头提示词",first.prompt);
check("提示词不附加上游元数据标题",!first.prompt.includes("上游节点数据"),first.prompt);
check("首次快照素材与本地素材保持顺序",JSON.stringify(first.assetIds) === JSON.stringify(["asset-local","asset-person-old"]),JSON.stringify(first.assetIds));
check("快照素材角色和来源证据完整",first.inputManifest.some(item => item.assetId === "asset-person-old" && item.role === "人物" && item.evidence.sourceOutputFingerprint),JSON.stringify(first.inputManifest));
check("执行信封生成稳定输入指纹",Boolean(first.inputFingerprint),first.inputFingerprint);
const originalFingerprint = first.inputFingerprint;

nodes[0].data.output = {type:"text",content:"上游重新执行后的新提示词"};
nodes[0].data.refs.jobIds.push("job-prompt-new");
nodes[1].data.refs.assetIds = ["asset-person-new"];
nodes[1].data.refs.assetRoles = {"asset-person-new":"人物"};
const second = adapter.resolveExecutionEnvelope("video",nodes,edges);
check("上游重跑不覆盖已捕获文本",second.prompt.includes("旧版镜头提示词") && !second.prompt.includes("新提示词"),second.prompt);
check("上游素材变化不覆盖已捕获素材",second.assetIds.includes("asset-person-old") && !second.assetIds.includes("asset-person-new"),JSON.stringify(second.assetIds));
check("上游重跑不改变执行输入指纹",second.inputFingerprint === originalFingerprint,`${originalFingerprint}/${second.inputFingerprint}`);
check("上游新结果只形成更新提示",second.upstream.updatesAvailable.length === 2 && second.upstream.updatesAvailable.every(item => item.liveFingerprint !== item.capturedFingerprint),JSON.stringify(second.upstream.updatesAvailable));

edges[0].data.inputSnapshot.textBlocks[0].text = "用户修改后的快照提示词";
edges[0].data.inputSnapshot.textBlocks[0].edited = true;
const edited = adapter.resolveExecutionEnvelope("video",nodes,edges);
check("用户可以独立修改快照文本",edited.prompt.includes("用户修改后的快照提示词") && !edited.prompt.includes("旧版镜头提示词"),edited.prompt);
check("修改快照后执行指纹变化",edited.inputFingerprint !== originalFingerprint,`${originalFingerprint}/${edited.inputFingerprint}`);

edges[0].data.inputSnapshot.textBlocks[0].enabled = false;
edges[1].data.inputSnapshot.assetBindings[0].enabled = false;
const disabledItems = adapter.resolveExecutionEnvelope("video",nodes,edges);
check("停用快照文本后不进入提示词",disabledItems.prompt === "10 秒，16:9",disabledItems.prompt);
check("停用快照素材后不进入参考素材",JSON.stringify(disabledItems.assetIds) === JSON.stringify(["asset-local"]),JSON.stringify(disabledItems.assetIds));
check("停用后的文本仍保留为可手动添加项",disabledItems.upstream.items.find(item=>item.sourceId==="prompt")?.availableTextBlocks?.[0]?.enabled===false,JSON.stringify(disabledItems.upstream.items));
check("停用后的素材仍保留为可手动添加项",disabledItems.upstream.items.find(item=>item.sourceId==="image")?.availableAssets?.[0]?.enabled===false,JSON.stringify(disabledItems.upstream.items));

const draftNodes = [
  core.makeNode("video-prompt",{x:0,y:0},{id:"draft-source",title:"直接上游",status:"completed",output:{type:"text",content:"首次同步的镜头提示词"},refs:{assetIds:[],jobIds:[],conversationIds:[]}}),
  core.makeNode("video-generation",{x:320,y:0},{id:"draft-target",title:"视频生成",instruction:"节点基础说明",refs:{assetIds:[],jobIds:[],conversationIds:[]}})
];
draftNodes[1].data.inputDraft={version:1,active:true,prompt:"用户修改后的最终输入",acceptedBindings:{"draft-edge":{fingerprint:"locked",text:"首次同步的镜头提示词"}}};
const draftEdges = [core.makeEdge("draft-source","draft-target",{id:"draft-edge"})];
const draftEnvelope = adapter.resolveExecutionEnvelope("draft-target",draftNodes,draftEdges);
check("激活输入草稿后执行只使用用户输入框内容",draftEnvelope.prompt==="用户修改后的最终输入",draftEnvelope.prompt);
draftNodes[0].data.output={type:"text",content:"上游重跑后的新内容"};
const draftAfterRerun=adapter.resolveExecutionEnvelope("draft-target",draftNodes,draftEdges);
check("输入草稿不被上游重跑自动覆盖",draftAfterRerun.prompt==="用户修改后的最终输入"&&draftAfterRerun.upstream.updatesAvailable.length===1,JSON.stringify(draftAfterRerun));

const orderNodes = [
  core.makeNode("prompt",{x:0,y:0},{id:"later",instruction:"后连接但顺序靠后",refs:{assetIds:[],jobIds:[],conversationIds:[]}}),
  core.makeNode("prompt",{x:0,y:180},{id:"earlier",instruction:"顺序靠前",refs:{assetIds:[],jobIds:[],conversationIds:[]}}),
  core.makeNode("image-generation",{x:360,y:0},{id:"image-target",instruction:"生成图片",refs:{assetIds:[],jobIds:[],conversationIds:[]}})
];
const orderEdges = [core.makeEdge("later","image-target",{id:"edge-later",order:20}),core.makeEdge("earlier","image-target",{id:"edge-earlier",order:10})];
const ordered = adapter.resolveExecutionEnvelope("image-target",orderNodes,orderEdges);
check("多个直接上游按连线顺序输入",ordered.prompt.indexOf("顺序靠前") < ordered.prompt.indexOf("后连接但顺序靠后"),ordered.prompt);

const visualTarget = core.makeNode("director-plan",{x:760,y:220},{id:"visual-target",instruction:"规划镜头",refs:{assetIds:[],jobIds:[],conversationIds:[]}});
const visualEdge = core.makeEdge("image","visual-target",{id:"edge-visual"});
const visualInput = adapter.resolveExecutionEnvelope("visual-target",[...nodes,visualTarget],[visualEdge]);
check("asset 类型快照仍按源节点媒体类型兼容",visualInput.assetIds.includes("asset-person-new"),JSON.stringify(visualInput));

const waitingNodes = [
  core.makeNode("story-outline",{x:0,y:0},{id:"waiting",instruction:"未执行节点说明",refs:{assetIds:[],jobIds:[],conversationIds:[]}}),
  core.makeNode("episode-script",{x:300,y:0},{id:"waiting-target",instruction:"生成剧本",refs:{assetIds:[],jobIds:[],conversationIds:[]}})
];
const waitingEdge = core.makeEdge("waiting","waiting-target",{id:"edge-waiting",transferMode:"text"});
const waiting = adapter.resolveExecutionEnvelope("waiting-target",waitingNodes,[waitingEdge]);
check("未执行生成节点保持 pending 且不传执行说明",waitingEdge.data.inputSnapshot.state === "pending" && !waiting.prompt.includes("未执行节点说明"),JSON.stringify({snapshot:waitingEdge.data.inputSnapshot,prompt:waiting.prompt}));

const withoutPromptEdge = adapter.resolveExecutionEnvelope("video",nodes,[edges[1]]);
check("删除连线只解除后续输入关系",!withoutPromptEdge.prompt.includes("用户修改后的快照提示词"),withoutPromptEdge.prompt);
check("输入适配器不包含任务取消调用",!/api\.(tasks|generation)\.cancel/.test(adapterSource),"发现任务取消调用");
check("执行证据不包含密钥和浏览器字段",!JSON.stringify(second.inputManifest).match(/cookie|api.?key|browser.?profile/i),JSON.stringify(second.inputManifest));

const failed = results.filter(item => !item.passed);
const output = {test:"infinite-canvas-snapshot-execution",at:new Date().toISOString(),total:results.length,passed:results.length-failed.length,failed:failed.length,results};
const logDir = path.join(root,"scripts","log");
fs.mkdirSync(logDir,{recursive:true});
fs.writeFileSync(path.join(logDir,"infinite-canvas-snapshot-execution.json"),JSON.stringify(output,null,2),"utf8");
console.log(JSON.stringify(output,null,2));
if(failed.length)process.exitCode=1;
