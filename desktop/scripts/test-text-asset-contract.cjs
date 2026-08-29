"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {WorkbenchDataBridge, TYPE_LIMITS} = require("../src/main/workbench-data-bridge.cjs");

const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-text-asset-contract-"));
let tenant = "tenant-a";
const bridge = new WorkbenchDataBridge({tenantRootProvider: () => path.join(temp, "tenants", tenant)});
const checks = [];
function check(name, fn) { try { fn(); checks.push({name, ok:true}); } catch (error) { checks.push({name, ok:false, error:String(error.message || error)}); } }
function rejects(name, fn, pattern) { check(name, () => { let error; try { fn(); } catch (value) { error = value; } assert(error, "预期操作被拒绝"); assert.match(String(error.message || error), pattern); }); }

const projectId = bridge.bootstrap().currentProjectId;
const sourcePath = path.join(temp, "source.txt"); fs.writeFileSync(sourcePath, "原始文献内容", "utf8");
const sourceAsset = bridge.importAssets({projectId, paths:[sourcePath], source:"literature-reference"})[0];
const excerpt = bridge.createTextAsset({projectId, name:"第一章摘录", content:"选中的关键句。", source:"text-excerpt", sourceAssetId:sourceAsset.id, sourceLocation:"conversation:doc-1", tags:["摘录","文献参考"], notes:"测试摘录"});

check("creates formal text asset", () => { assert.equal(excerpt.type, "text"); assert.equal(excerpt.projectId, projectId); assert.equal(excerpt.source, "text-excerpt"); });
check("returns formal asset id", () => assert.match(excerpt.id, /^[a-f0-9]{32}$/i));
check("persists text file", () => { const resolved = bridge.resolveAsset(excerpt.id); assert(fs.existsSync(resolved.path)); assert.equal(fs.readFileSync(resolved.path, "utf8"), "选中的关键句。"); });
check("retains source evidence", () => { assert.equal(excerpt.sourceAssetId, sourceAsset.id); assert.equal(excerpt.sourceProjectId, projectId); assert.equal(excerpt.sourceLocation, "conversation:doc-1"); });
check("readText returns saved excerpt", () => assert.equal(bridge.readTextAsset(excerpt.id).content, "选中的关键句。"));
check("asset appears in shared bootstrap", () => assert(bridge.bootstrap().assets.some(asset => asset.id === excerpt.id)));
const otherProject = bridge.createProject({name:"其他项目"});
rejects("cross-project source rejected", () => bridge.createTextAsset({projectId:otherProject.id, name:"越权摘录", content:"内容", sourceAssetId:sourceAsset.id}), /来源素材必须属于当前项目/);
rejects("empty content rejected", () => bridge.createTextAsset({projectId, name:"空素材", content:"   "}), /内容不能为空/);
rejects("oversize content rejected", () => bridge.createTextAsset({projectId, name:"超限素材", content:"a".repeat(TYPE_LIMITS.text + 1)}), /超过 10MB/);
tenant = "tenant-b";
check("tenant isolation", () => assert(!bridge.bootstrap().assets.some(asset => asset.id === excerpt.id)));

const main = fs.readFileSync(path.join(root, "src/main/main.cjs"), "utf8");
const preload = fs.readFileSync(path.join(root, "src/preload/preload.cjs"), "utf8");
check("IPC contract exposed", () => { assert(main.includes("assets:create-text")); assert(preload.includes("assets:create-text")); assert(preload.includes("createText")); });

const failed = checks.filter(item => !item.ok);
const result = {test:"text-asset-contract", tempRoot:temp, total:checks.length, passed:checks.length-failed.length, failed:failed.length, checks};
const logDir = path.join(root, "scripts", "log"); fs.mkdirSync(logDir, {recursive:true}); fs.writeFileSync(path.join(logDir, "text-asset-contract.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (failed.length) process.exit(1);
