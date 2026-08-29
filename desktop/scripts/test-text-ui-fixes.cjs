"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const renderer = fs.readFileSync(path.join(root, "src/renderer/text-workspace.js"), "utf8");
const assets = fs.readFileSync(path.join(root, "src/renderer/text-workspace-assets.js"), "utf8");
const textCss = fs.readFileSync(path.join(root, "src/renderer/styles/text-workspace.css"), "utf8");
const materialCss = fs.readFileSync(path.join(root, "src/renderer/styles/project-materials.css"), "utf8");
const checks = [];
function check(name, fn) { try { fn(); checks.push({name, ok:true}); } catch (error) { checks.push({name, ok:false, error:String(error.message || error)}); } }

check("new creation uses desktop modal", () => { assert(renderer.includes("新建文本创作")); assert(renderer.includes("data-text-create-confirm")); assert(renderer.includes("text-create-modal")); assert(!renderer.includes('prompt("创作标题"')); });
check("new creation supports title and type", () => { assert(renderer.includes("data-text-create-title")); assert(renderer.includes("data-text-create-type")); assert(renderer.includes("api.text.create")); });
check("text previews are resizable", () => { assert(renderer.includes("text-preview-resizable")); assert(textCss.includes("resize:both")); assert(textCss.includes("min-width:420px")); });
check("material previews are resizable", () => { assert(materialCss.includes(".preview-modal .pm-dialog")); assert(materialCss.includes("resize:both")); });
check("collapsed rails have visible labels", () => { assert(textCss.includes('content:"目录"')); assert(textCss.includes('content:"协作"')); });
check("excerpt can save as formal asset", () => { assert(assets.includes("api.assets.createText")); assert(assets.includes("保存到素材中心")); assert(assets.includes("sourceAssetId:asset.id")); });

const failed = checks.filter(item => !item.ok);
const result = {test:"text-ui-fixes", total:checks.length, passed:checks.length-failed.length, failed:failed.length, checks};
const logDir = path.join(root, "scripts", "log"); fs.mkdirSync(logDir, {recursive:true}); fs.writeFileSync(path.join(logDir, "text-ui-fixes.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (failed.length) process.exit(1);
