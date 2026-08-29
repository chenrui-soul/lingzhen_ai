"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const truthFile = path.join(root, "references", "project-resource-unification-ground-truth.json");
const truth = JSON.parse(fs.readFileSync(truthFile, "utf8"));
const source = fs.readFileSync(path.join(root, "src", "renderer", "project-materials.js"), "utf8");
const checks = [];
function check(name, fn) { try { fn(); checks.push({name, ok:true}); } catch (error) { checks.push({name, ok:false, error:String(error.message || error)}); } }

const match = source.match(/const matchesDoubaoVideoTask = \(asset, task\) => (Boolean\(.+?\));/);
let matchesTask = null;
check("actual renderer binding predicate is extractable", () => { assert(match); matchesTask = new Function("asset", "task", `return ${match[1]}`); });
const asset = {id:"asset-video-a", projectId:"project-a", type:"video"};
const valid = {id:"task-a", state:"completed", executionChannel:"doubao", resultAssetId:asset.id, projectId:asset.projectId, resultVid:"https://example.com/signed/a.mp4"};
check("completed doubao task with matching asset and project is valid", () => assert.equal(matchesTask(asset, valid), true));
for (const [name, patch] of [
  ["non-video asset rejected", {asset:{...asset,type:"image"}}],
  ["non-completed task rejected", {task:{...valid,state:"generating"}}],
  ["model gateway task rejected", {task:{...valid,executionChannel:"model-gateway"}}],
  ["different result asset rejected", {task:{...valid,resultAssetId:"asset-other"}}],
  ["different project rejected", {task:{...valid,projectId:"project-b"}}],
  ["empty result URL rejected", {task:{...valid,resultVid:"  "}}]
]) check(name, () => assert.equal(matchesTask(patch.asset || asset, patch.task || valid), false));
check("URL list deduplicates while preserving first-seen order", () => {
  const urls = [valid.resultVid, "https://example.com/b.mp4", valid.resultVid];
  const deduped = [...new Map(urls.map(url => [url, url])).values()];
  assert.deepEqual(deduped, [valid.resultVid, "https://example.com/b.mp4"]);
  assert(source.includes("new Map(assets.map"));
});
check("batch copy is one URL per line", () => assert(source.includes('navigator.clipboard.writeText(links.join("\\n"))')));
check("single select single copy current-filter select-all and selected batch copy remain", () => {
  for (const marker of ["data-select-doubao-asset", "data-copy-doubao-url", "data-select-visible-doubao", "data-copy-doubao-links"]) assert(source.includes(marker), marker);
});
check("signed URL expiry warning is visible", () => assert(source.includes("签名链接可能过期，请及时复制")));
check("binding predicate covers ground truth fields", () => {
  assert(source.includes(`asset?.type === "${truth.doubaoBinding.assetType}"`));
  assert(source.includes(`task?.state === "${truth.doubaoBinding.taskState}"`));
  assert(source.includes(`task.executionChannel === "${truth.doubaoBinding.executionChannel}"`));
  for (const field of truth.doubaoBinding.requiredFields) assert(source.includes(field), field);
});

const failed = checks.filter(item => !item.ok);
const result = {test:"project-resource-doubao-copy", timestamp:new Date().toISOString(), groundTruth:truthFile, total:checks.length, passed:checks.length-failed.length, failed:failed.length, failures:failed, checks};
const logDir = path.join(root, "scripts", "log"); fs.mkdirSync(logDir, {recursive:true});
fs.writeFileSync(path.join(logDir, "project-resource-doubao-copy.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (failed.length) process.exit(1);
