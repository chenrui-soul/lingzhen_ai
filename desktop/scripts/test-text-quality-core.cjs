"use strict";
const fs = require("fs");
const path = require("path");
const core = require("../src/renderer/text-quality-core.js");
const truth = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "references", "text-quality-batch-f-ground-truth.json"), "utf8"));
const checks = [];
const check = (name, ok, detail) => checks.push({name, ok:Boolean(ok), ...(detail === undefined ? {} : {detail})});

check("批次 F 核心版本、检查分类和导出格式", core.VERSION === truth.version && truth.categories.every(key => core.CATEGORY_META[key]) && truth.formats.every(key => core.EXPORT_FORMATS[key]));
check("文本和问题数量有固定上限", core.MAX_TEXT_LENGTH === truth.maximumTextLength && core.MAX_ISSUES === truth.maximumIssues, {text:core.MAX_TEXT_LENGTH, issues:core.MAX_ISSUES});

const structure = {
  templateId:"script", type:"剧本",
  fields:{format:"电影", apiKey:"should-not-export"},
  outline:[
    {id:"scene-1", parentId:"", kind:"场景", title:"城门", fields:{sceneHeading:"内 · 城门 · 日", characters:"云汐、陌生人", location:"云城", action:"云汐进入城门"}},
    {id:"scene-2", parentId:"", kind:"场景", title:"城门", fields:{sceneHeading:"外 · 港口 · 夜", characters:"云汐", location:"港口", action:"云汐离开"}}
  ],
  characters:[
    {id:"char-1", name:"云汐", role:"主角", appearance:"黑发蓝眼"},
    {id:"char-2", name:"云 汐", role:"重复人物", appearance:"黑发"}
  ],
  world:[],
  timeline:[
    {id:"time-1", label:"抵达", time:"第3天", location:"云城", participants:"云汐"},
    {id:"time-2", label:"回忆", time:"第1天", location:"旧城", participants:"陌生人"}
  ],
  variables:[]
};
const text = "云汐披着白发斗篷进入城门。作为测试，她迫不急待地宣传这是国家级、100%有效的唯一产品。。\n钥匙已经丢失。\n她随后拿出钥匙打开房门。   \n\n\n\n最后一句使用英文,标点。";
const textBefore = text;
const structureBefore = JSON.stringify(structure);
const report = core.checkText({text, type:"剧本", structure});
const codes = new Set(report.issues.map(item => item.code));
check("人物重复、人物引用、外观、时间线、场景和道具连续性均检查", ["duplicate-character", "unknown-character-reference", "character-appearance", "timeline-order", "scene-location", "prop-state"].every(code => codes.has(code)), [...codes]);
check("常见错别字能够定位并给出行列", report.issues.some(item => item.code === "common-typo" && item.line === 1 && item.column > 1 && item.suggestion.includes("迫不及待")), report.issues.filter(item => item.code === "common-typo"));
check("格式检查覆盖重复标点、空行、行尾空格和中文半角标点", ["repeat-punctuation", "blank-lines", "trailing-space", "ascii-punctuation"].every(code => codes.has(code)), [...codes]);
check("广告绝对化和保证性表达被标记为高风险", report.issues.filter(item => item.category === "risk" && item.severity === "high").length >= 2, report.counts);
check("检查不改正文和结构数据", text === textBefore && JSON.stringify(structure) === structureBefore);
check("报告包含指纹、分类计数和不自动修改声明", report.fingerprint === core.fingerprint(text) && report.counts.total === report.issues.length && report.disclaimer.includes("不会自动修改正文"), report.counts);

const spellingOnly = core.checkText({text, type:"广告文案", structure, categories:["spelling"]});
check("可以只运行用户选择的检查分类", spellingOnly.categories.length === 1 && spellingOnly.issues.every(item => item.category === "spelling"), spellingOnly.counts);

const storyboardReport = core.checkText({text:"镜头正文", type:"分镜", structure:{...structure, templateId:"storyboard", type:"分镜", outline:[{id:"shot-1", parentId:"", title:"镜头 1", fields:{visual:"", duration:""}}]}});
check("剧本场景标头和分镜关键字段检查均存在", codes.has("script-scene-heading") === false && storyboardReport.issues.some(item => item.code === "storyboard-required-fields"), storyboardReport.issues);
const missingHeading = core.checkText({text:"剧本正文", type:"剧本", structure:{...structure, outline:[{id:"scene-x", parentId:"", title:"室内", fields:{sceneHeading:""}}]}});
check("剧本缺失场景标头会提示但不自动补齐", missingHeading.issues.some(item => item.code === "script-scene-heading"));

const commonInput = {title:"云城：第一幕?", type:"剧本", content:"正文保持不变", projectId:"project-a", conversationId:"conversation-a", structure, apiKey:"top-secret", cookie:"sid=secret", accountProfile:{token:"secret"}};
const txt = core.buildExport("txt", commonInput);
const markdown = core.buildExport("markdown", commonInput);
const json = core.buildExport("json", commonInput);
const screenplay = core.buildExport("screenplay", commonInput);
const storyboard = core.buildExport("storyboard", {...commonInput, structure:{...structure, templateId:"storyboard", outline:[{id:"shot-1", parentId:"", title:"开场", fields:{shotSize:"近景", camera:"推进", duration:"5秒", visual:"云城出现", dialogue:"旁白", sound:"风声", prompt:"cinematic"}}]}});
check("TXT 只导出当前正文", txt.content === commonInput.content && txt.filename.endsWith(".txt"), txt);
check("Markdown 保留标题、类型、正文和结构附录", markdown.content.includes("# 云城：第一幕?") && markdown.content.includes("正文保持不变") && markdown.content.includes("## 结构目录") && markdown.filename.endsWith(".md"));
const parsedJson = JSON.parse(json.content);
const jsonText = JSON.stringify(parsedJson);
check("JSON 保留项目会话一对一绑定并采用字段白名单", parsedJson.projectId === "project-a" && parsedJson.conversationId === "conversation-a" && parsedJson.content === "正文保持不变" && !truth.protectedMetadata.some(key => Object.prototype.hasOwnProperty.call(parsedJson, key)), parsedJson);
check("JSON 不导出结构中的认证命名字段", !/apiKey|top-secret|sid=secret|accountProfile|authorization|baseUrl/.test(jsonText), parsedJson.structure?.fields);
check("剧本格式使用场次、场景标头、人物和动作字段", screenplay.content.includes("场次 1") && screenplay.content.includes("内 · 城门 · 日") && screenplay.content.includes("出场人物：云汐、陌生人") && screenplay.content.includes("云汐进入城门"), screenplay.content);
check("分镜表 CSV 包含 BOM、固定列和镜头字段", storyboard.content.startsWith("\uFEFF") && storyboard.content.includes('"镜头号"') && storyboard.content.includes('"近景"') && storyboard.content.includes('"cinematic"') && storyboard.filename.endsWith(".storyboard.csv"));
check("文件名过滤 Windows 非法字符", !/[<>:"/\\|?*]/.test(json.filename.replace(/\.json$/, "")), json.filename);

let rejected = false;
try { core.buildExport("pdf", commonInput); } catch { rejected = true; }
check("不支持的导出格式被明确拒绝", rejected);

const failed = checks.filter(item => !item.ok);
const output = {test:"text-quality-core", total:checks.length, passed:checks.length - failed.length, failed:failed.length, checks};
console.log(JSON.stringify(output, null, 2));
if (failed.length) process.exitCode = 1;
