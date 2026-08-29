"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {spawnSync} = require("child_process");
const {DesktopAuthClient} = require("../src/main/desktop-auth-client.cjs");

const root = path.resolve(__dirname, "..");
const truth = JSON.parse(fs.readFileSync(path.join(root, "references", "desktop-bootstrap-loading-ground-truth.json"), "utf8"));
const ui = fs.readFileSync(path.join(root, "src", "renderer", "auth-ui.js"), "utf8");
const css = fs.readFileSync(path.join(root, "src", "renderer", "styles", "auth.css"), "utf8");
const main = fs.readFileSync(path.join(root, "src", "main", "desktop-auth-client.cjs"), "utf8");
const checks = [];
const check = async (name, fn) => {
  try { await fn(); checks.push({name, ok:true}); }
  catch (error) { checks.push({name, ok:false, error:String(error.stack || error)}); }
};

function safeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(String(value), "utf8"),
    decryptString: value => Buffer.from(value).toString("utf8"),
  };
}

async function mainTest() {
  await check("renderer and main scripts keep valid syntax", () => {
    for (const file of ["src/renderer/auth-ui.js", "src/main/desktop-auth-client.cjs"]) {
      const result = spawnSync(process.execPath, ["--check", path.join(root, file)], {encoding:"utf8"});
      assert.equal(result.status, 0, result.stderr || file);
    }
  });
  await check("slow notice threshold and actionable states match ground truth", () => {
    assert(ui.includes(`WORKSPACE_SLOW_NOTICE_MS = ${truth.slowNoticeMs}`));
    for (const token of truth.requiredCopy) assert(ui.includes(token), token);
    for (const selector of truth.requiredSelectors) assert(ui.includes(selector.replace(/^\[|\]$/g, "")) || css.includes(selector), selector);
  });
  await check("ready auth change removes the gate", () => {
    assert(ui.includes("next?.authenticated && next?.workspaceReady"));
    assert(ui.includes("gate()?.remove()"));
  });
  await check("loading UI exposes wait retry and reduced motion support", () => {
    for (const token of ["data-bootstrap-wait", "data-bootstrap-retry-slow", "auth-loading-status", "prefers-reduced-motion:reduce"]) assert(ui.includes(token) || css.includes(token), token);
  });
  await check("concurrent desktop bootstrap calls share one backend request", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-bootstrap-loading-"));
    let releaseRequest;
    let requestCalls = 0;
    const requestGate = new Promise(resolve => { releaseRequest = resolve; });
    const response = {
      schemaVersion:1,
      generatedAt:new Date().toISOString(),
      user:{id:"user-a",username:"user-a",email:"user-a@example.com"},
      tenant:{id:"tenant-a",code:"tenant-a",displayName:"Tenant A"},
      membership:{id:"membership-a",role:"owner"},
      permissions:["desktop.bootstrap"],
      features:{infiniteCanvas:false},
      credits:{available:false,balance:0},
      modelCatalog:{available:false,version:null,publishedAt:null},
      models:[],
      skills:[]
    };
    const client = new DesktopAuthClient({
      dataRoot:tempRoot,
      appVersion:"test",
      safeStorage:safeStorage(),
      serverUrl:"http://127.0.0.1:9001",
      device:{hash:"device-a",version:1,suffix:"device-a"},
      fetchFn:async()=>{
        requestCalls += 1;
        await requestGate;
        return {ok:true,status:200,json:async()=>response};
      }
    });
    client.saveSession({
      status:"authenticated",
      accessToken:"access",
      refreshToken:"refresh",
      accessTokenExpiresAt:new Date(Date.now()+3600000).toISOString(),
      refreshTokenExpiresAt:new Date(Date.now()+86400000).toISOString(),
      session:{membershipId:"membership-a"},
      user:response.user,
      tenant:response.tenant,
      role:"owner",
      permissions:["desktop.bootstrap"],
      featurePolicies:{}
    });
    const first = client.loadDesktopBootstrap();
    const second = client.loadDesktopBootstrap();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requestCalls, 1);
    releaseRequest();
    const [firstStatus, secondStatus] = await Promise.all([first, second]);
    assert.equal(firstStatus.workspaceReady, true);
    assert.equal(secondStatus.workspaceReady, true);
    assert.equal(requestCalls, 1);
  });

  const failed = checks.filter(item => !item.ok);
  const report = {test:truth.test,total:checks.length,passed:checks.length-failed.length,failed:failed.length,checks,generatedAt:new Date().toISOString()};
  const logDir = path.join(root, "scripts", "log");
  fs.mkdirSync(logDir, {recursive:true});
  fs.writeFileSync(path.join(logDir, "desktop-bootstrap-loading.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (failed.length) process.exitCode = 1;
}

mainTest().catch(error => { console.error(error.stack || error); process.exit(1); });
