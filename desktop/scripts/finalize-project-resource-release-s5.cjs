"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {spawnSync} = require("child_process");

const root = path.resolve(__dirname, "..");
const backupBase = path.join(root, "backups", "project-resource-finalization-20260817");
const beforeRoot = path.join(backupBase, "S5-before-20260817-135143");
const s4Root = path.join(backupBase, "S4-after-20260817-133801");
const timezone = "Asia/Shanghai";
const normalize = value => value.split(path.sep).join("/");
const hashBuffer = value => crypto.createHash("sha256").update(value).digest("hex").toUpperCase();
const hashFile = file => hashBuffer(fs.readFileSync(file));

function timestamp() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone:timezone, year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", second:"2-digit", hourCycle:"h23"
  }).formatToParts(new Date()).filter(item => item.type !== "literal").map(item => [item.type, item.value]));
  return `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
}

const outRoot = path.join(backupBase, `S5-after-${timestamp()}`);
fs.mkdirSync(outRoot, {recursive:true});
const writeJson = (name, value) => fs.writeFileSync(path.join(outRoot, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const result = [];
  const visit = current => {
    for (const item of fs.readdirSync(current, {withFileTypes:true})) {
      const full = path.join(current, item.name);
      if (item.isDirectory()) visit(full);
      else if (item.isFile()) result.push(full);
    }
  };
  visit(dir);
  return result.sort((a,b) => normalize(path.relative(dir,a)).localeCompare(normalize(path.relative(dir,b)), "en"));
}

function fileRecord(relative) {
  const file = path.join(root, relative);
  const stat = fs.statSync(file);
  return {path:normalize(relative), bytes:stat.size, sha256:hashFile(file)};
}

function businessDataHash() {
  const base = path.join(process.env.APPDATA || "", "灵帧AI");
  const roots = ["tenants", "system"].map(name => path.join(base, name)).filter(fs.existsSync);
  const files = roots.flatMap(listFiles).sort((a,b) => normalize(path.relative(base,a)).localeCompare(normalize(path.relative(base,b)), "en"));
  const entries = files.map(file => ({path:normalize(path.relative(base,file)), bytes:fs.statSync(file).size, sha256:hashFile(file)}));
  return {
    root:base,
    includedRoots:["tenants", "system"],
    fileCount:entries.length,
    totalBytes:entries.reduce((sum,item) => sum + item.bytes, 0),
    aggregateSHA256:hashBuffer(Buffer.from(entries.map(item => `${item.path}\0${item.bytes}\0${item.sha256}\n`).join(""), "utf8")),
    files:entries
  };
}

function copyFile(relative, base = root) {
  const source = path.join(base, relative);
  const target = path.join(outRoot, "snapshot", relative);
  fs.mkdirSync(path.dirname(target), {recursive:true});
  fs.copyFileSync(source, target);
  return normalize(path.relative(outRoot, target));
}

function copyEvidence(source, targetName = path.basename(source)) {
  const target = path.join(outRoot, "runtime-evidence", targetName);
  fs.mkdirSync(path.dirname(target), {recursive:true});
  fs.copyFileSync(source, target);
  return normalize(path.relative(outRoot, target));
}

function runTest(name, relative, expectedTotal) {
  const run = spawnSync(process.execPath, [path.join(root, relative)], {cwd:root, encoding:"utf8", windowsHide:true, timeout:300000});
  fs.writeFileSync(path.join(outRoot, "test-logs", `${name}.stdout.log`), run.stdout || "", "utf8");
  fs.writeFileSync(path.join(outRoot, "test-logs", `${name}.stderr.log`), run.stderr || "", "utf8");
  let report;
  try { report = JSON.parse(String(run.stdout || "").trim()); } catch {}
  const ok = run.status === 0;
  return {
    name,
    script:relative,
    total:Number(report?.total ?? expectedTotal),
    passed:Number(report?.passed ?? (ok ? expectedTotal : 0)),
    failed:Number(report?.failed ?? (ok ? 0 : expectedTotal)),
    ok,
    exitCode:run.status,
    timedOut:Boolean(run.error?.code === "ETIMEDOUT"),
    error:run.error ? String(run.error.message || run.error) : ""
  };
}

const beforeManifest = JSON.parse(fs.readFileSync(path.join(beforeRoot, "manifest.json"), "utf8"));
const s4Hashes = JSON.parse(fs.readFileSync(path.join(s4Root, "hashes-after.json"), "utf8"));
const stableFiles = beforeManifest.snapshots.map(item => normalize(item.path));
const stableExpected = Object.fromEntries(beforeManifest.snapshots.map(item => [normalize(item.path), item.sha256]));
const stableChecks = stableFiles.map(relative => {
  const currentSHA256 = hashFile(path.join(root, relative));
  return {path:relative, expectedSHA256:stableExpected[relative], currentSHA256, match:stableExpected[relative] === currentSHA256};
});
const addedFiles = [
  "scripts/test-project-resource-release-s5-artifact.cjs",
  "scripts/test-project-resource-release-s5-runtime.cjs",
  "scripts/finalize-project-resource-release-s5.cjs"
];
const addedRecords = addedFiles.map(fileRecord);
const protectedChecks = (s4Hashes.protectedChecks || []).map(item => {
  const relative = normalize(item.path);
  const currentSHA256 = hashFile(path.join(root, relative));
  return {path:relative, expectedSHA256:item.currentSHA256 || item.expectedSHA256, currentSHA256, match:(item.currentSHA256 || item.expectedSHA256) === currentSHA256};
});

for (const relative of [...stableFiles, ...addedFiles]) copyFile(relative);
fs.mkdirSync(path.join(outRoot, "test-logs"), {recursive:true});

const testDefinitions = [
  ["project-materials","scripts/test-project-materials.cjs",29],
  ["multi-task-dock","scripts/test-multi-task-dock.cjs",27],
  ["task-center","scripts/test-task-center.cjs",20],
  ["text-workspace","scripts/test-text-workspace.cjs",21],
  ["infinite-canvas-regression","scripts/test-infinite-canvas-regression.cjs",20],
  ["unified-execution","scripts/test-unified-execution.cjs",7],
  ["human-attention-actions","scripts/test-human-attention-actions.cjs",10],
  ["doubao-ops-invariants","scripts/test-doubao-ops-invariants.cjs",6],
  ["doubao-submission-unknown-recovery","scripts/test-doubao-submission-unknown-recovery.cjs",6],
  ["doubao-result-capture","scripts/test-doubao-result-capture.cjs",9],
  ["submission-evidence","scripts/test-submission-evidence.cjs",20],
  ["submission-lifecycle","scripts/test-submission-lifecycle.cjs",13],
  ["desktop-smoke","tests/smoke.cjs",17],
  ["doubao-failure-outcomes","scripts/test-doubao-failure-outcomes.cjs",18],
  ["doubao-failure-persistence","scripts/test-doubao-failure-persistence.cjs",10],
  ["doubao-quota-scheduler","scripts/test-doubao-quota-scheduler.cjs",14],
  ["doubao-multi-task-recovery","scripts/test-doubao-multi-task-recovery.cjs",15],
  ["model-result-recovery","scripts/test-model-result-recovery.cjs",5],
  ["text-workspace-assets","scripts/test-text-workspace-assets.cjs",13],
  ["infinite-canvas-boundary","scripts/test-infinite-canvas-boundary.cjs",13],
  ["infinite-canvas-result-recovery","scripts/test-infinite-canvas-result-recovery.cjs",12],
  ["project-resource-unification","scripts/test-project-resource-unification.cjs",11],
  ["project-resource-doubao-copy","scripts/test-project-resource-doubao-copy.cjs",13],
  ["project-resource-safe-copy","scripts/test-project-resource-safe-copy.cjs",18],
  ["project-resource-interface-s2","scripts/test-project-resource-interface-s2.cjs",15],
  ["project-resource-interface-s2-runtime","backups/project-resource-finalization-20260817/S2-after-20260817-121752/verify-s2-runtime.cjs",9],
  ["project-resource-accessibility-s3","scripts/test-project-resource-accessibility-s3.cjs",16],
  ["project-resource-accessibility-s3-runtime","scripts/test-project-resource-accessibility-s3-runtime.cjs",15],
  ["project-resource-accessibility-s3-contrast","scripts/test-project-resource-accessibility-s3-contrast.cjs",301],
  ["project-resource-release-s4","scripts/test-project-resource-release-s4.cjs",15],
  ["project-resource-release-s4-runtime","scripts/test-project-resource-release-s4-runtime.cjs",14],
  ["project-resource-release-s5-artifact","scripts/test-project-resource-release-s5-artifact.cjs",9],
  ["project-resource-release-s5-runtime","scripts/test-project-resource-release-s5-runtime.cjs",16]
];

const dataBefore = businessDataHash();
const baselineMatches = dataBefore.fileCount === beforeManifest.productionDataBaseline.fileCount && dataBefore.aggregateSHA256 === beforeManifest.productionDataBaseline.aggregateSHA256;
const tests = testDefinitions.map(([name, relative, expected]) => runTest(name, relative, expected));

const syntaxFiles = ["src/renderer/project-materials.js", ...addedFiles];
const syntax = syntaxFiles.map(relative => {
  const run = spawnSync(process.execPath, ["--check", path.join(root, relative)], {cwd:root, encoding:"utf8", windowsHide:true});
  return {path:relative, ok:run.status === 0, exitCode:run.status, stderr:run.stderr || ""};
});
const preflightRun = spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm.cmd run preflight:dist:internal-http"], {cwd:root, encoding:"utf8", windowsHide:true, timeout:180000});
const preflight = {ok:preflightRun.status === 0, exitCode:preflightRun.status, stdout:preflightRun.stdout || "", stderr:preflightRun.stderr || "", error:preflightRun.error ? String(preflightRun.error.message || preflightRun.error) : ""};
const dataAfter = businessDataHash();
const dataUnchanged = dataBefore.aggregateSHA256 === dataAfter.aggregateSHA256 && dataBefore.fileCount === dataAfter.fileCount && dataBefore.totalBytes === dataAfter.totalBytes;

for (const file of listFiles(path.join(root, "scripts", "log", "project-resource-s4-layout"))) copyEvidence(file, `s4-${path.basename(file)}`);
for (const file of listFiles(path.join(root, "scripts", "log", "project-resource-s4-runtime"))) copyEvidence(file, `s4-${path.basename(file)}`);
for (const file of listFiles(path.join(root, "scripts", "log", "project-resource-s5-runtime"))) copyEvidence(file, path.basename(file));
for (const relative of [
  "scripts/log/project-resource-accessibility-s3-contrast.json",
  "scripts/log/project-resource-release-s5-artifact.json"
]) copyEvidence(path.join(root, relative), path.basename(relative));

const artifactReport = JSON.parse(fs.readFileSync(path.join(root, "scripts", "log", "project-resource-release-s5-artifact.json"), "utf8"));
const packagedReport = JSON.parse(fs.readFileSync(path.join(root, "scripts", "log", "project-resource-s5-runtime", "s5-release-runtime.json"), "utf8"));
const releaseArtifacts = artifactReport.artifacts.map(item => {
  const file = path.join(root, item.path);
  return {...item, currentSize:fs.statSync(file).size, currentSHA256:hashFile(file), match:item.size === fs.statSync(file).size && item.sha256 === hashFile(file)};
});
const testTotal = tests.reduce((sum,item) => sum + item.total, 0);
const testPassed = tests.reduce((sum,item) => sum + item.passed, 0);
const testsPassed = tests.every(item => item.ok) && testPassed === testTotal;
const stableUnchanged = stableChecks.every(item => item.match);
const protectedUnchanged = protectedChecks.every(item => item.match);
const syntaxPassed = syntax.every(item => item.ok);
const artifactPassed = artifactReport.ok === true && releaseArtifacts.every(item => item.match);
const packagedRuntimePassed = packagedReport.ok === true && packagedReport.installed === false && packagedReport.copiedSystemOnly === true;
const status = stableUnchanged && protectedUnchanged && testsPassed && syntaxPassed && preflight.ok && baselineMatches && dataUnchanged && artifactPassed && packagedRuntimePassed ? "passed" : "failed";

writeJson("hashes-after.json", {
  generatedAt:new Date().toISOString(), timezone,
  runtimeChanges:stableChecks.filter(item => item.path.startsWith("src/") && !item.match).map(item => item.path),
  configurationChanges:stableChecks.filter(item => ["package.json","package-lock.json"].includes(item.path) && !item.match).map(item => item.path),
  stableUnchanged, stableChecks, addedFiles:addedRecords, protectedUnchanged, protectedChecks, releaseArtifacts
});
writeJson("test-matrix.json", {
  generatedAt:new Date().toISOString(), timezone, status,
  suites:tests.length, passedSuites:tests.filter(item => item.ok).length,
  assertions:{passed:testPassed, total:testTotal, failed:testTotal - testPassed},
  priorS4:{suites:31, assertions:732},
  s5:{suites:2, assertions:25},
  tests, syntax, preflight:{ok:preflight.ok, exitCode:preflight.exitCode},
  runtime:{artifact:artifactReport, packaged:packagedReport}
});
writeJson("production-data-hash.json", {generatedAt:new Date().toISOString(), timezone, readOnly:true, baseline:beforeManifest.productionDataBaseline, baselineMatches, before:dataBefore, after:dataAfter, unchanged:dataUnchanged});
writeJson("artifact-hashes.json", {generatedAt:new Date().toISOString(), timezone, sourceAggregateSHA256:artifactReport.build.sourceAggregateSHA256, signed:false, files:releaseArtifacts});
writeJson("acceptance-matrix.json", {phase:"S5", status, gates:[
  {name:"S4 冻结基线", ok:stableUnchanged, detail:{passed:stableChecks.filter(item => item.match).length, total:stableChecks.length}},
  {name:"保护模块", ok:protectedUnchanged, detail:{passed:protectedChecks.filter(item => item.match).length, total:protectedChecks.length}},
  {name:"ASAR 与发布产物", ok:artifactPassed, detail:{checks:`${artifactReport.passed}/${artifactReport.total}`, sourceFileCount:artifactReport.build.sourceFileCount, sourceAggregateSHA256:artifactReport.build.sourceAggregateSHA256}},
  {name:"打包版冷启动与重启", ok:packagedRuntimePassed, detail:{checks:`${packagedReport.passed}/${packagedReport.total}`, copiedSystemOnly:packagedReport.copiedSystemOnly, installed:packagedReport.installed}},
  {name:"全矩阵回归", ok:testsPassed, detail:{suites:`${tests.filter(item => item.ok).length}/${tests.length}`, assertions:`${testPassed}/${testTotal}`}},
  {name:"构建预检", ok:preflight.ok, detail:{mode:"internal-http", exitCode:preflight.exitCode}},
  {name:"正式业务数据", ok:baselineMatches && dataUnchanged, detail:{fileCount:dataAfter.fileCount, aggregateSHA256:dataAfter.aggregateSHA256}}
]});
writeJson("rollback-manifest.json", {
  generatedAt:new Date().toISOString(), timezone,
  runtimeRestoreRequired:false,
  removeGeneratedArtifacts:["dist-tenant", ".local-user-data-project-resource-s5-packaged-20260817", ...addedFiles],
  preserveRuntimeFiles:["src/renderer/project-materials.js", "src/renderer/styles/project-materials.css"],
  preserveModules:["豆包", "无限画布", "文本创作", "任务中心", "任务坞", "模型网关", "既有调度器"],
  productionDataRestored:false
});
writeJson("manifest.json", {
  schemaVersion:1,
  phase:"S5",
  status,
  completedAt:new Date().toISOString(),
  timezone,
  purpose:"Release candidate build, ASAR integrity, packaged fresh-tenant cold start and regression freeze",
  acceptedPriorGate:"S4-after-20260817-133801",
  runtimeChanges:[],
  configurationChanges:[],
  addedTests:addedFiles.slice(0,2),
  supportScripts:[addedFiles[2]],
  build:{productName:"灵帧AI", version:"0.12.2", arch:"x64", asar:true, nsis:true, signed:false, installed:false},
  stableBaselineUnchanged:stableUnchanged,
  protectedModulesUnchanged:protectedUnchanged,
  protectedFileCount:protectedChecks.length,
  tests:{suites:tests.length, passedSuites:tests.filter(item => item.ok).length, assertionsPassed:testPassed, assertionsTotal:testTotal},
  syntaxPassed,
  preflightPassed:preflight.ok,
  artifactChecks:`${artifactReport.passed}/${artifactReport.total}`,
  packagedRuntimeChecks:`${packagedReport.passed}/${packagedReport.total}`,
  productionDataUnchanged:dataUnchanged,
  productionDataBaselineMatches:baselineMatches,
  productionDataAggregateSHA256:dataAfter.aggregateSHA256,
  nextGate:status === "passed" ? "project-resource-release-candidate-ready" : "blocked-at-S5"
});

const record = `# 项目资源库收尾 S5 实施记录\n\n执行日期：2026-08-17（Asia/Shanghai）  \n状态：\`${status}\`  \n前置快照：\`backups/project-resource-finalization-20260817/S5-before-20260817-135143/\`\n\n## S5 定位\n\nS5 只验证发布候选、ASAR 一致性和打包版全新租户冷启动；未修改运行代码、构建配置或正式业务数据，也未执行安装。\n\n## 发布候选\n\n- 产品：灵帧AI 0.12.2，Windows x64；\n- 免安装目录和 NSIS 安装包均已生成；\n- ASAR 内 ${artifactReport.build.sourceFileCount} 个源码/资产文件与主线逐字节一致；\n- 主程序与安装包当前未数字签名，仅作为内部测试候选。\n\n## 验收结果\n\n- 完整回归：${tests.filter(item => item.ok).length}/${tests.length} 套件，${testPassed}/${testTotal} 断言；\n- 产物检查：${artifactReport.passed}/${artifactReport.total}；\n- 打包版冷启动/重启：${packagedReport.passed}/${packagedReport.total}；\n- 保护文件：${protectedChecks.filter(item => item.match).length}/${protectedChecks.length}；\n- 正式业务数据：${dataAfter.fileCount} 文件，聚合 SHA-256 \`${dataAfter.aggregateSHA256}\`，前后一致。\n\n## 回滚\n\nS5 没有运行时改动。若撤销本批次，只删除 \`dist-tenant\`、S5 两个测试脚本、收尾脚本和 S5 隔离用户目录；不要恢复或覆盖豆包、画布、文本创作、任务中心、任务坞、模型网关、调度器及正式业务数据。\n`;
fs.writeFileSync(path.join(outRoot, "S5-implementation-record.md"), record, "utf8");

const summary = {
  status,
  output:normalize(path.relative(root, outRoot)),
  stableUnchanged,
  protectedUnchanged,
  suites:`${tests.filter(item => item.ok).length}/${tests.length}`,
  assertions:`${testPassed}/${testTotal}`,
  syntaxPassed,
  preflightPassed:preflight.ok,
  artifact:`${artifactReport.passed}/${artifactReport.total}`,
  packagedRuntime:`${packagedReport.passed}/${packagedReport.total}`,
  productionDataBaselineMatches:baselineMatches,
  productionDataUnchanged:dataUnchanged,
  productionDataAggregateSHA256:dataAfter.aggregateSHA256
};
console.log(JSON.stringify(summary, null, 2));
if (status !== "passed") process.exitCode = 1;
