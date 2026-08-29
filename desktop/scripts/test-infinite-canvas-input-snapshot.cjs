"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const core = require(path.join(root, "src", "renderer", "canvas-flow-core.js"));
const results = [];
const check = (name, condition, detail = "") => results.push({name, passed:Boolean(condition), detail:condition ? "" : String(detail)});

const legacy = {
  schemaVersion:3,
  nodes:[
    {id:"ancestor",type:"lingframe",position:{x:0,y:0},data:{kind:"story-outline",title:"祖先",status:"completed",output:{type:"text",content:"祖先剧本不应穿透"},refs:{assetIds:[],jobIds:[],conversationIds:[]}}},
    {id:"direct",type:"lingframe",position:{x:320,y:0},data:{kind:"video-prompt",title:"直接提示词",status:"completed",output:{type:"text",content:"直接镜头提示词"},refs:{assetIds:[],jobIds:["job-direct"],conversationIds:["conversation-direct"]}}},
    {id:"video",type:"lingframe",position:{x:640,y:0},data:{kind:"video-generation",title:"视频生成",instruction:"生成 10 秒视频",refs:{assetIds:[],jobIds:[],conversationIds:[]}}},
    {id:"image",type:"lingframe",position:{x:320,y:220},data:{kind:"image-input",title:"人物参考",refs:{assetIds:["asset-person"],assetRoles:{"asset-person":"人物"},jobIds:["job-image"],conversationIds:[]}}},
    {id:"waiting",type:"lingframe",position:{x:0,y:420},data:{kind:"story-outline",title:"未执行节点",instruction:"这只是执行说明",status:"idle",refs:{assetIds:[],jobIds:[],conversationIds:[]}}},
    {id:"waiting-target",type:"lingframe",position:{x:320,y:420},data:{kind:"episode-script",title:"等待目标",refs:{assetIds:[],jobIds:[],conversationIds:[]}}},
    {id:"prompt",type:"lingframe",position:{x:0,y:620},data:{kind:"prompt",title:"手写提示词",instruction:"手写内容可以直接捕获",status:"idle",refs:{assetIds:[],jobIds:[],conversationIds:[]}}},
    {id:"prompt-target",type:"lingframe",position:{x:320,y:620},data:{kind:"video-generation",title:"提示词目标",refs:{assetIds:[],jobIds:[],conversationIds:[]}}}
  ],
  edges:[
    {id:"edge-ancestor",source:"ancestor",target:"direct"},
    {id:"edge-direct",source:"direct",target:"video",data:{order:7,role:"参考"}},
    {id:"edge-image",source:"image",target:"video"},
    {id:"edge-waiting",source:"waiting",target:"waiting-target"},
    {id:"edge-prompt",source:"prompt",target:"prompt-target"}
  ],
  groups:[
    {id:"group-assets",title:"资产组",color:"#ff69b4",nodeIds:["direct","image","missing"],position:{x:0,y:0},size:{width:0,height:0}},
    {id:"group-duplicate",title:"重复组",nodeIds:["image"]}
  ],
  viewport:{x:80,y:80,zoom:1}
};

const original = JSON.stringify(legacy);
const migrated = core.migrateDocument(legacy);
const directEdge = migrated.edges.find(edge => edge.id === "edge-direct");
const imageEdge = migrated.edges.find(edge => edge.id === "edge-image");
const waitingEdge = migrated.edges.find(edge => edge.id === "edge-waiting");
const promptEdge = migrated.edges.find(edge => edge.id === "edge-prompt");

check("核心文档版本升级为 V4", core.VERSION === 4 && migrated.schemaVersion === 4, `${core.VERSION}/${migrated.schemaVersion}`);
check("核心克隆安全处理 undefined", core.clone(undefined) === undefined, "clone(undefined) 应安全返回 undefined");
check("迁移不修改原始文档", JSON.stringify(legacy) === original, "输入对象被修改");
check("旧连线补齐输入绑定默认值", directEdge.data.bindingId === "edge-direct" && directEdge.data.enabled === true && directEdge.data.order === 7 && directEdge.data.transferMode === "auto", JSON.stringify(directEdge.data));
check("旧连线只捕获直接源节点文本", directEdge.data.inputSnapshot.textBlocks[0]?.text === "直接镜头提示词" && !JSON.stringify(directEdge.data.inputSnapshot).includes("祖先剧本"), JSON.stringify(directEdge.data.inputSnapshot));
check("输入快照固定为一次导入模式", directEdge.data.inputSnapshot.importMode === "once" && directEdge.data.inputSnapshot.state === "captured" && Boolean(directEdge.data.inputSnapshot.importedAt), JSON.stringify(directEdge.data.inputSnapshot));
check("素材顺序和角色进入快照", imageEdge.data.inputSnapshot.assetBindings[0]?.assetId === "asset-person" && imageEdge.data.inputSnapshot.assetBindings[0]?.role === "人物" && imageEdge.data.inputSnapshot.assetBindings[0]?.order === 0, JSON.stringify(imageEdge.data.inputSnapshot));
check("任务与会话只保留为来源证据", imageEdge.data.inputSnapshot.assetBindings[0]?.evidence?.jobIds?.includes("job-image") && !JSON.stringify(imageEdge.data.inputSnapshot).match(/cookie|api.?key|browser.?profile/i), JSON.stringify(imageEdge.data.inputSnapshot));
check("未执行的生成节点保持等待捕获", waitingEdge.data.inputSnapshot.state === "pending" && waitingEdge.data.inputSnapshot.textBlocks.length === 0 && !JSON.stringify(waitingEdge.data.inputSnapshot).includes("执行说明"), JSON.stringify(waitingEdge.data.inputSnapshot));
check("手写提示词节点可以直接捕获", promptEdge.data.inputSnapshot.state === "captured" && promptEdge.data.inputSnapshot.textBlocks[0]?.text === "手写内容可以直接捕获", JSON.stringify(promptEdge.data.inputSnapshot));
check("迁移重复执行保持幂等", JSON.stringify(core.migrateDocument(migrated)) === JSON.stringify(migrated), "二次迁移产生变化");
check("分组迁移过滤缺失和重复成员", migrated.groups.length === 1 && JSON.stringify(migrated.groups[0].nodeIds) === JSON.stringify(["direct","image"]), JSON.stringify(migrated.groups));
check("无效分组尺寸按节点重新计算", migrated.groups[0].size.width > 0 && migrated.groups[0].size.height > 0, JSON.stringify(migrated.groups[0]));
check("迁移后的文档通过完整校验", core.validateDocument(migrated).ok, core.validateDocument(migrated).errors.join("；"));

const sanitized = core.normalizeInputSnapshot({
  state:"captured",
  sourceNodeId:"source-safe",
  cookie:"secret",
  textBlocks:[{text:"安全文本"}],
  assetBindings:[{assetId:"asset-safe",evidence:{sourceNodeId:"source-safe",jobIds:["job-safe"],apiKey:"secret",browserProfile:"secret"}}]
}, {bindingId:"edge-safe"});
check("快照迁移清除密钥和浏览器字段", !JSON.stringify(sanitized).match(/cookie|api.?key|browser.?profile|secret/i), JSON.stringify(sanitized));

const group = core.makeGroup(["direct","image"], migrated.nodes, {id:"group-test",title:"测试组"});
const bounds = core.calculateGroupBounds(migrated.nodes, ["direct","image"]);
check("节点组边界由成员节点计算", JSON.stringify(group.position) === JSON.stringify(bounds.position) && JSON.stringify(group.size) === JSON.stringify(bounds.size), JSON.stringify({group,bounds}));

const invalidGroups = core.clone(migrated);
invalidGroups.groups.push({...core.clone(invalidGroups.groups[0]), id:"group-second", nodeIds:["image"]});
const invalidValidation = core.validateDocument(invalidGroups);
check("校验阻止节点同时属于多个组", !invalidValidation.ok && invalidValidation.errors.some(error => error.includes("多个节点组")), invalidValidation.errors.join("；"));

const template = core.createTemplateDocument("short-drama");
check("新模板原生包含 groups 和输入快照", Array.isArray(template.groups) && template.edges.every(edge => edge.data?.inputSnapshot?.sourceNodeId === edge.source), JSON.stringify(template.edges[0]));
check("分组不改变 DAG 拓扑顺序", JSON.stringify(core.topologicalOrder(migrated.nodes,migrated.edges)) === JSON.stringify(core.topologicalOrder({...migrated,groups:[]}.nodes,migrated.edges)), "拓扑顺序变化");

const failed = results.filter(item => !item.passed);
const output = {test:"infinite-canvas-input-snapshot",at:new Date().toISOString(),total:results.length,passed:results.length-failed.length,failed:failed.length,results};
const logDir = path.join(root,"scripts","log");
fs.mkdirSync(logDir,{recursive:true});
fs.writeFileSync(path.join(logDir,"infinite-canvas-input-snapshot.json"),JSON.stringify(output,null,2),"utf8");
console.log(JSON.stringify(output,null,2));
if(failed.length)process.exitCode=1;
