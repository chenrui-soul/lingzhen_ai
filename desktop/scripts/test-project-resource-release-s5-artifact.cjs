"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {spawnSync} = require("child_process");
const asar = require("@electron/asar");

const root = path.resolve(__dirname, "..");
const distRoot = path.join(root, "dist-tenant");
const unpackedRoot = path.join(distRoot, "win-unpacked");
const appExe = path.join(unpackedRoot, "灵帧AI.exe");
const appAsar = path.join(unpackedRoot, "resources", "app.asar");
const setupExe = path.join(distRoot, "灵帧AI内测版-0.12.2-Setup-x64.exe");
const blockMap = `${setupExe}.blockmap`;
const logRoot = path.join(root, "scripts", "log");
const checks = [];

const sha256 = value => crypto.createHash("sha256").update(value).digest("hex").toUpperCase();
const fileHash = file => sha256(fs.readFileSync(file));
const packedPath = relative => relative.split("/").join(path.sep);
const check = (name, fn) => {
  try { fn(); checks.push({name, ok:true}); }
  catch (error) { checks.push({name, ok:false, error:String(error.message || error)}); }
};

function walkFiles(base, relative = "") {
  const current = path.join(base, relative);
  const output = [];
  for (const item of fs.readdirSync(current, {withFileTypes:true})) {
    const child = path.join(relative, item.name);
    if (item.isDirectory()) output.push(...walkFiles(base, child));
    else if (item.isFile()) output.push(child.split(path.sep).join("/"));
  }
  return output;
}

function peMachine(file) {
  const buffer = fs.readFileSync(file);
  assert.equal(buffer.toString("ascii", 0, 2), "MZ", `${path.basename(file)} 不是 PE 文件`);
  const peOffset = buffer.readUInt32LE(0x3c);
  assert.equal(buffer.toString("ascii", peOffset, peOffset + 4), "PE\0\0", `${path.basename(file)} PE 头无效`);
  return buffer.readUInt16LE(peOffset + 4);
}

function versionInfo() {
  const command = [
    "$ErrorActionPreference='Stop'",
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8",
    "Import-Module Microsoft.PowerShell.Security",
    "$items=@($env:S5_APP_EXE,$env:S5_SETUP_EXE)|ForEach-Object{",
    "  $f=Get-Item -LiteralPath $_; $s=Get-AuthenticodeSignature -LiteralPath $_;",
    "  [pscustomobject]@{name=$f.Name;product=$f.VersionInfo.ProductName;description=$f.VersionInfo.FileDescription;fileVersion=$f.VersionInfo.FileVersion;productVersion=$f.VersionInfo.ProductVersion;signatureStatus=$(if($s.SignerCertificate){[string]$s.Status}else{'NotSigned'});signerSubject=$(if($s.SignerCertificate){[string]$s.SignerCertificate.Subject}else{''})}",
    "}; $items|ConvertTo-Json -Compress"
  ].join("\n");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
    encoding:"utf8",
    windowsHide:true,
    env:{
      ...process.env,
      PSModulePath:path.join(process.env.WINDIR || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "Modules"),
      S5_APP_EXE:appExe,
      S5_SETUP_EXE:setupExe
    }
  });
  if (result.status !== 0) throw new Error(result.stderr || `读取版本资源失败：${result.status}`);
  const parsed = JSON.parse(result.stdout.trim());
  return Array.isArray(parsed) ? parsed : [parsed];
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
let entries = [];
let packagedPackage = null;
let sourceFiles = [];
let sourceHashes = [];
let mismatches = [];
let versions = [];

check("发布候选免安装目录、ASAR、安装包和 blockmap 均存在", () => {
  for (const file of [appExe, appAsar, setupExe, blockMap]) assert(fs.existsSync(file), `缺少 ${path.relative(root, file)}`);
  assert(fs.statSync(appExe).size > 100 * 1024 * 1024, "主程序大小异常");
  assert(fs.statSync(appAsar).size > 500 * 1024, "app.asar 大小异常");
  assert(fs.statSync(setupExe).size > 50 * 1024 * 1024, "安装包大小异常");
});

check("ASAR 可读取且产品名、版本、入口正确", () => {
  entries = asar.listPackage(appAsar).map(item => item.replace(/^[/\\]+/, "").replace(/\\/g, "/"));
  packagedPackage = JSON.parse(asar.extractFile(appAsar, "package.json").toString("utf8"));
  assert.equal(packagedPackage.name, packageJson.name);
  assert.equal(packagedPackage.version, "0.12.2");
  assert.equal(packagedPackage.main, packageJson.main);
  assert.equal(packagedPackage.productName, "灵帧AI");
  assert.equal(packagedPackage.description, packageJson.description);
});

check("源码和资产在 ASAR 内逐文件字节一致", () => {
  sourceFiles = [
    ...walkFiles(path.join(root, "src")).map(item => `src/${item}`),
    ...walkFiles(path.join(root, "assets")).map(item => `assets/${item}`)
  ].sort();
  mismatches = [];
  sourceHashes = sourceFiles.map(relative => {
    const source = fs.readFileSync(path.join(root, relative));
    const packed = asar.extractFile(appAsar, packedPath(relative));
    const sourceSHA256 = sha256(source);
    const asarSHA256 = sha256(packed);
    if (sourceSHA256 !== asarSHA256) mismatches.push({path:relative, sourceSHA256, asarSHA256});
    return {path:relative, sha256:sourceSHA256, size:source.length};
  });
  assert.equal(mismatches.length, 0, `ASAR 文件漂移：${JSON.stringify(mismatches)}`);
});

check("项目资源库运行文件与 S4 冻结哈希一致", () => {
  assert.equal(fileHash(path.join(root, "src/renderer/project-materials.js")), "7B4B731F1E01008C59F346C166AD87EEB1BB6285A6224019D3A569E3B569A121");
  assert.equal(fileHash(path.join(root, "src/renderer/styles/project-materials.css")), "D99DE055AFAF9226F2088BF68534A530341A85328D4172B2F2002486FBAF703F");
  assert.equal(sha256(asar.extractFile(appAsar, packedPath("src/renderer/project-materials.js"))), "7B4B731F1E01008C59F346C166AD87EEB1BB6285A6224019D3A569E3B569A121");
  assert.equal(sha256(asar.extractFile(appAsar, packedPath("src/renderer/styles/project-materials.css"))), "D99DE055AFAF9226F2088BF68534A530341A85328D4172B2F2002486FBAF703F");
});

check("豆包、画布、文本创作、任务中心和统一生成链路均已装入", () => {
  for (const required of [
    "src/main/embedded-browser-manager.cjs",
    "src/main/generation-orchestrator.cjs",
    "src/renderer/infinite-canvas.js",
    "src/renderer/canvas-flow-core.js",
    "src/renderer/text-workspace.js",
    "src/renderer/text-ai-core.js",
    "src/renderer/task-center.js",
    "src/renderer/project-materials.js"
  ]) assert(entries.includes(required), `ASAR 缺少 ${required}`);
});

check("发布包不包含备份、测试、脚本、日志和 node_modules", () => {
  const forbidden = entries.filter(item => /^(?:backups|tests|scripts|references|node_modules|\.local-user-data)(?:\/|$)/i.test(item));
  assert.deepEqual(forbidden, []);
});

check("主程序为 Windows x64，NSIS x64 安装包使用标准引导壳", () => {
  assert.equal(peMachine(appExe), 0x8664);
  assert.equal(peMachine(setupExe), 0x014c);
  assert.equal(path.basename(setupExe), "灵帧AI内测版-0.12.2-Setup-x64.exe");
});

check("主程序与安装包版本资源均为灵帧AI 0.12.2", () => {
  versions = versionInfo();
  assert.equal(versions.length, 2);
  for (const item of versions) {
    assert.equal(item.product, "灵帧AI", `${item.name} 产品名错误`);
    assert(/^0\.12\.2(?:\.0)?$/.test(String(item.fileVersion)), `${item.name} 文件版本错误：${item.fileVersion}`);
    assert(/^0\.12\.2(?:\.0)?$/.test(String(item.productVersion)), `${item.name} 产品版本错误：${item.productVersion}`);
  }
});

check("内部测试候选明确保持未签名状态", () => {
  assert(versions.length === 2);
  assert(versions.every(item => item.signatureStatus === "NotSigned"), JSON.stringify(versions));
});

const failed = checks.filter(item => !item.ok);
const artifacts = [appExe, appAsar, setupExe, blockMap].map(file => ({
  path:path.relative(root, file).split(path.sep).join("/"),
  size:fs.existsSync(file) ? fs.statSync(file).size : null,
  sha256:fs.existsSync(file) ? fileHash(file) : null
}));
const aggregateSHA256 = sourceHashes.length ? sha256(Buffer.from(sourceHashes.map(item => `${item.path}\0${item.sha256}`).join("\n"), "utf8")) : null;
const report = {
  test:"project-resource-release-s5-artifact",
  timestamp:new Date().toISOString(),
  ok:failed.length === 0,
  total:checks.length,
  passed:checks.length - failed.length,
  failed:failed.length,
  checks,
  build:{productName:"灵帧AI", version:"0.12.2", arch:"x64", signed:false, sourceFileCount:sourceFiles.length, sourceAggregateSHA256:aggregateSHA256},
  versions,
  artifacts,
  mismatches
};
fs.mkdirSync(logRoot, {recursive:true});
fs.writeFileSync(path.join(logRoot, "project-resource-release-s5-artifact.json"), JSON.stringify(report, null, 2));
process.stdout.write(JSON.stringify(report, null, 2));
if (failed.length) process.exit(1);
