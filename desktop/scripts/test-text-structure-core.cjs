"use strict";
const fs = require("fs");
const path = require("path");
const core = require("../src/renderer/text-structure-core.js");
const truth = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "references", "text-structure-batch-e-ground-truth.json"), "utf8"));
const checks = [];
const check = (name, ok, detail) => checks.push({name, ok:Boolean(ok), ...(detail === undefined ? {} : {detail})});
const context = {tenantId:"tenant-a", projectId:"project-a", conversationId:"conversation-a", type:"小说"};

check("批次 E 版本和租户存储前缀", core.VERSION === truth.version && core.STORAGE_PREFIX === truth.storagePrefix);
const templateIds = core.templateList().map(item => item.id);
check("六类专业模板完整", truth.requiredTemplates.every(id => templateIds.includes(id)), templateIds);
check("九类旧会话类型均可平滑映射", truth.legacyTypes.every(type => Boolean(core.resolveTemplate(type)?.id)), truth.legacyTypes.map(type => [type, core.resolveTemplate(type).id]));
check("结构集合上限固定", Object.entries(truth.maximums).every(([key, value]) => core.LIMITS[key] === value), core.LIMITS);

const legacy = core.createDocument(context);
check("旧会话兼容打开不强制产生结构数据", legacy.derivedFromType === true && legacy.templateId === "novel" && !core.meaningful(legacy) && legacy.outline.length === 0, core.clone(legacy));

const chapter = core.addOutlineNode(legacy, {title:"第一章 云城", kind:"章节", fields:{summary:"主角进入云城"}});
const scene = core.addOutlineNode(legacy, {parentId:chapter.id, title:"城门相遇", kind:"场景", fields:{location:"云城门"}});
check("章节树和场景树保留父子关系", legacy.outline.length === 2 && scene.parentId === chapter.id && legacy.outline[0].fields.summary === "主角进入云城", legacy.outline);
core.updateOutlineNode(legacy, scene.id, {title:"城门初遇", fields:{summary:"主角遇见守城人"}});
check("结构节点字段可编辑", legacy.outline.find(item => item.id === scene.id)?.title === "城门初遇" && legacy.outline.find(item => item.id === scene.id)?.fields.summary === "主角遇见守城人");

const character = core.addEntity(legacy, "characters", {name:"云汐", role:"女主角", goal:"寻找时间停止的原因"});
const world = core.addEntity(legacy, "world", {name:"云城时间法则", category:"规则", rule:"午夜后重置"});
const event = core.addEntity(legacy, "timeline", {label:"进入云城", time:"第一日黄昏", participants:"云汐", event:"穿过城门"});
check("人物卡、世界观和时间线可独立保存", character.name === "云汐" && world.rule.includes("重置") && event.time.includes("黄昏"), {character, world, event});

legacy.fields.genre = "奇幻悬疑";
const version = core.createVersion(legacy, "初版结构");
legacy.fields.genre = "都市情感";
const restored = core.restoreVersion(legacy, version.id);
check("结构快照恢复不依赖正文版本", restored.fields.genre === "奇幻悬疑" && restored.versions.length === 1, restored.versions);

const switched = core.switchTemplate(restored, "script");
check("模板切换保留树和资料卡但收敛字段", switched.templateId === "script" && switched.outline.length === 2 && switched.characters.length === 1 && switched.world.length === 1 && Object.prototype.hasOwnProperty.call(switched.fields, "format"), switched);

const parsed = core.parseOutline("# 第一幕\n## 场景 1：城门\n第2章 真相", "script");
check("可从旧正文显式提取章节场景", parsed.length === 3 && parsed[1].parentId === parsed[0].id && parsed[2].parentId === "", parsed);

const markdown = core.compileDocument(switched, {title:"云城", plainText:"原正文", includePlainText:false});
check("结构可编译为不覆盖正文的 Markdown", markdown.includes("# 云城") && markdown.includes("## 结构目录") && markdown.includes("云汐") && !markdown.includes("原正文"), markdown);
const exported = core.exportDocument(switched, {title:"云城", includePlainText:true, plainText:"正文"});
const exportedText = JSON.stringify(exported);
check("JSON 导出保留绑定且不包含认证字段", exported.projectId === "project-a" && exported.conversationId === "conversation-a" && exported.plainText === "正文" && !/(apiKey|cookie|authorization|secret|baseUrl)/i.test(exportedText), exported);

let rejected = false;
try { core.normalizeDocument(switched, {...context, projectId:"project-b"}); } catch { rejected = true; }
check("跨项目结构文档被拒绝", rejected);

const cascade = core.clone(switched); const removed = core.removeOutlineNode(cascade, chapter.id);
check("删除父节点会循环保护并级联删除子节点", removed.includes(chapter.id) && removed.includes(scene.id) && cascade.outline.length === 0, removed);

const failed = checks.filter(item => !item.ok);
const report = {test:"text-structure-core", total:checks.length, passed:checks.length - failed.length, failed:failed.length, checks};
console.log(JSON.stringify(report, null, 2));
if (failed.length) process.exitCode = 1;
