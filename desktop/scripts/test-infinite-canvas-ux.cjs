"use strict";
const fs = require("fs");
const path = require("path");
const project = path.resolve(__dirname, "..");
const referencePath = path.join(project, "references", "infinite-canvas-ux-ground-truth.json");
const logDirectory = path.join(project, "scripts", "log");
const logPath = path.join(logDirectory, "infinite-canvas-ux.json");
fs.mkdirSync(logDirectory, {recursive:true});
const truth = JSON.parse(fs.readFileSync(referencePath, "utf8"));
const core = require(path.join(project, "src", "renderer", "canvas-flow-core.js"));
require(path.join(project, "src", "renderer", "canvas-input-adapter.js"));
const results = [];
function check(name, condition, detail = "") {
  results.push({name, passed:Boolean(condition), detail:condition ? "" : detail});
}
const fixture = truth.flowFixture;
check("核心版本为V4", core.VERSION === 4, `实际：${core.VERSION}`);
check("节点库覆盖基础类型", ["text","prompt","asset","human-approval","output"].every(type => core.LIBRARY_MAP[type]), "基础节点缺失");
check("节点库覆盖真实生成类型", ["story-outline","episode-script","image-generation","video-generation","final-cut"].every(type => core.LIBRARY_MAP[type]), "生成节点缺失");
const blankLibrary = core.nodeLibraryForMode("blank");
check("空白模式使用通用节点分类", blankLibrary.find(item => item.type === "story-outline")?.group === "文本处理" && blankLibrary.find(item => item.type === "story-outline")?.title === "文本生成", JSON.stringify(blankLibrary.find(item => item.type === "story-outline")));
check("空白模式素材节点命名为素材管理", blankLibrary.find(item => item.type === "asset")?.title === "素材管理" && blankLibrary.find(item => item.type === "asset")?.group === "输入与素材", JSON.stringify(blankLibrary.find(item => item.type === "asset")));
check("剧情模式保留明确节点名称", core.nodePresentation("story-outline", "short-drama").title === "故事大纲" && core.nodePresentation("story-outline", "short-drama").group === "文本与剧本", JSON.stringify(core.nodePresentation("story-outline", "short-drama")));
const migratedFixture = core.migrateDocument(fixture);
const validation = core.validateDocument(migratedFixture);
check("合法DAG校验通过", validation.ok, validation.errors.join("；"));
const order = core.topologicalOrder(migratedFixture.nodes, migratedFixture.edges);
check("拓扑顺序正确", JSON.stringify(order) === JSON.stringify(fixture.expectedOrder), JSON.stringify(order));
const input = core.resolveNodeExecutionInput("video", migratedFixture.nodes, migratedFixture.edges);
check("执行输入只包含直接上游", JSON.stringify(input.upstream.items.map(item => item.sourceId)) === JSON.stringify(fixture.expectedVideoUpstreamIds), JSON.stringify(input.upstream.items.map(item => item.sourceId)));
check("执行输入包含目标指令和直接提示词", fixture.expectedPromptFragments.every(fragment => input.prompt.includes(fragment)) && !input.prompt.includes("一只会飞的气球") && !input.prompt.includes("第一幕发现气球"), input.prompt);
const noisyNodes = [
  {id:"source",type:"lingframe",position:{x:0,y:0},data:{kind:"video-prompt",title:"业务输出",instruction:"不要把这条指令重复注入",status:"completed",progress:100,runError:"调试错误不应进入提示词",updatedAt:"2099-01-01T00:00:00.000Z",results:[{id:"history-1",description:"历史结果不应进入提示词"}],activeResultId:"history-1",output:{type:"text",content:"只保留这段业务内容",status:"completed",debug:"内部调试字段不应进入提示词",assetIds:["asset-1"]}}},
  {id:"target",type:"lingframe",position:{x:300,y:0},data:{kind:"video-generation",title:"下游生成",instruction:"生成视频"}}
];
const noisyInput = core.resolveNodeExecutionInput("target", noisyNodes, [{id:"noisy-edge",source:"source",target:"target"}]);
check("上游仅传递业务输出文本", noisyInput.prompt.includes("只保留这段业务内容") && !noisyInput.prompt.includes("历史结果不应进入提示词") && !noisyInput.prompt.includes("调试错误不应进入提示词") && !noisyInput.prompt.includes("内部调试字段不应进入提示词"), noisyInput.prompt);
check("上游运行元数据与业务文本分离", noisyInput.upstream.items[0]?.metadata?.runError === "调试错误不应进入提示词" && noisyInput.upstream.items[0]?.metadata?.activeResultId === "history-1", JSON.stringify(noisyInput.upstream.items[0]?.metadata));
check("上游素材引用仍独立传递", JSON.stringify(noisyInput.upstream.assetIds) === JSON.stringify(["asset-1"]), JSON.stringify(noisyInput.upstream.assetIds));
check("禁止节点自连接", !core.canConnect("video","video",fixture.edges,fixture.nodes).ok, "自连接未阻止");
check("禁止重复连接", !core.canConnect("idea","outline",fixture.edges,fixture.nodes).ok, "重复连接未阻止");
check("禁止形成循环", !core.canConnect("video","idea",fixture.edges,fixture.nodes).ok, "循环连接未阻止");
check("允许合法后续连接", core.canConnect("video","new-output",fixture.edges,[...fixture.nodes,{id:"new-output",data:{kind:"output"},position:{x:1200,y:0}}]).ok, "合法连接被阻止");
const template = core.createTemplateDocument("short-drama");
check("短剧模板节点完整", template.nodes.length === 12, `节点数：${template.nodes.length}`);
check("短剧模板连线完整", template.edges.length === 14, `连线数：${template.edges.length}`);
check("短剧模板无循环", core.validateDocument(template).ok, core.validateDocument(template).errors.join("；"));
const blank = core.createTemplateDocument("blank");
check("空白画布为空", blank.nodes.length === 0 && blank.edges.length === 0, JSON.stringify(blank));
const groupFixture=core.makeGroup(["idea","outline"],migratedFixture.nodes,{title:"策划组"});
check("框选节点可形成独立分组",groupFixture.nodeIds.length===2&&groupFixture.size.width>0&&groupFixture.size.height>0,JSON.stringify(groupFixture));
const groupedDocument=core.migrateDocument({...migratedFixture,groups:[groupFixture]});
check("分组不改变DAG拓扑顺序",core.validateDocument(groupedDocument).ok&&JSON.stringify(core.topologicalOrder(groupedDocument.nodes,groupedDocument.edges))===JSON.stringify(fixture.expectedOrder),JSON.stringify(core.validateDocument(groupedDocument)));
const requiredFiles = [
  "src/renderer/infinite-canvas.js",
  "src/renderer/styles/infinite-canvas.css"
  ,"src/renderer/styles/canvas-media-v2.css"
];
for (const file of requiredFiles) check(`文件存在：${file}`, fs.existsSync(path.join(project, file)), "文件不存在");
const index = fs.readFileSync(path.join(project, "src", "renderer", "index.html"), "utf8");
check("页面加载画布核心", index.includes("canvas-flow-core.js"), "index.html 未加载核心模块");
check("页面加载画布界面", index.includes("infinite-canvas.js") && index.includes("infinite-canvas.css"), "index.html 未加载画布界面资源");
const renderer=fs.readFileSync(path.join(project,"src","renderer","infinite-canvas.js"),"utf8");
check("工具栏与一次性输入交互进入画布UI",renderer.includes("lfc-canvas-tools")&&renderer.includes("ensureNodeInputDraft")&&renderer.includes("renderUpstreamPicker"),"G3 画布交互缺失");
check("素材管理只通过项目资源入口跳转",renderer.includes("openProjectResources")&&!renderer.includes("projectMaterials.create"),"画布越界写入素材模块");
check("贴合编辑器在缩放和布局变化时立即重定位",renderer.includes("if(reposition){positionComposer(true);requestAnimationFrame(()=>positionComposer(true));}")&&renderer.includes("new ResizeObserver(()=>positionComposer(true))")&&renderer.includes('composer.style.transition=layout.focused?"":"none"')&&renderer.includes('window.addEventListener("resize",()=>{positionComposer(true);requestAnimationFrame(()=>positionComposer(true));});'),"编辑器重定位保护缺失");
const output = {at:new Date().toISOString(), reference:path.relative(project, referencePath), passed:results.filter(item => item.passed).length, failed:results.filter(item => !item.passed).length, results};
fs.writeFileSync(logPath, JSON.stringify(output, null, 2), "utf8");
console.log(JSON.stringify(output, null, 2));
if (output.failed) process.exitCode = 1;
