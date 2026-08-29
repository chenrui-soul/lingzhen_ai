"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn, spawnSync } = require("child_process");
const { WorkbenchDataBridge } = require("../src/main/workbench-data-bridge.cjs");

const root = path.resolve(__dirname, "..");
const truth = JSON.parse(fs.readFileSync(path.join(root, "references", "home-asset-picker-project-switch-ground-truth.json"), "utf8"));
const cssFile = path.join(root, "src", "renderer", "styles", "home-conversations.css");
const appFile = path.join(root, "src", "renderer", "app-fixes.js");
const port = Number(process.env.LINGFRAME_CDP_PORT || 9591);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let spawnedElectron = null;
let isolatedRoot = "";
let identityServer = null;
const identityRequests = [];
const identityPort = 19691;

async function startIdentityServer() {
  const json = (response, status, value) => {
    response.writeHead(status, {"Content-Type":"application/json"});
    response.end(JSON.stringify(value));
  };
  identityServer = http.createServer((request, response) => {
    const pathname = new URL(request.url, `http://127.0.0.1:${identityPort}`).pathname;
    identityRequests.push(`${request.method} ${pathname}`);
    const authenticated = {
      status:"authenticated", accessToken:"wave4-test-access", refreshToken:"wave4-test-refresh",
      accessTokenExpiresAt:new Date(Date.now()+60*60_000).toISOString(), refreshTokenExpiresAt:new Date(Date.now()+24*60*60_000).toISOString(),
      session:{id:"session-test",membershipId:"membership-test"}, user:{id:"user-test",username:"test",email:"test@example.com"},
      tenant:{id:"test-tenant",code:"test-tenant",displayName:"测试租户"}, role:"member",
      permissions:["desktop.bootstrap","project.use","asset.use","task.use","creation.use","model.use","skill.use","doubao_account.use","credits.self.read","sync.use"], featurePolicies:{}
    };
    if (pathname === "/api/v1/auth/login" && request.method === "POST") return json(response, 200, authenticated);
    if (pathname === "/api/v1/auth/me" && request.method === "GET") return json(response, 200, {
      userId:"user-test",username:"test",email:"test@example.com",tenantId:"test-tenant",tenantCode:"test-tenant",tenantName:"测试租户",
      role:"member",permissions:authenticated.permissions,featurePolicies:{}
    });
    if (pathname === "/api/v1/desktop/bootstrap" && request.method === "GET") return json(response, 200, {
      schemaVersion:1, generatedAt:new Date().toISOString(), user:authenticated.user, tenant:authenticated.tenant,
      membership:{id:"membership-test",role:"member"}, permissions:authenticated.permissions,
      features:{infiniteCanvas:false}, credits:{available:true,balance:0}, modelCatalog:{available:false,version:null,publishedAt:null},
      models:[],skills:[],doubaoAccounts:[],recentProjects:[]
    });
    if (pathname === "/api/v1/desktop/workspace/snapshot" && request.method === "GET") return json(response, 200, {revision:0,snapshot:{},contentHash:null,updatedAt:null});
    if (pathname === "/api/v1/desktop/workspace/snapshot" && request.method === "PUT") return json(response, 200, {revision:1,snapshot:{},contentHash:"a".repeat(64),updatedAt:new Date().toISOString()});
    if (pathname === "/api/v1/desktop/doubao-accounts" && request.method === "GET") return json(response, 200, []);
    if (pathname.startsWith("/api/v1/desktop/doubao-accounts/") && ["PUT","DELETE"].includes(request.method)) {
      if (request.method === "DELETE") { response.writeHead(204); return response.end(); }
      return json(response, 200, {accountId:path.basename(pathname),displayName:"测试账号",loginState:"unknown",rowVersion:0});
    }
    return json(response, 404, {code:"NOT_FOUND"});
  });
  await new Promise((resolve, reject) => identityServer.listen(identityPort, "127.0.0.1", resolve).once("error", reject));
}

function copyTree(source, target) {
  const stat = fs.lstatSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive:true });
    for (const name of fs.readdirSync(source)) copyTree(path.join(source, name), path.join(target, name));
    return;
  }
  if (stat.isFile()) {
    fs.mkdirSync(path.dirname(target), { recursive:true });
    fs.copyFileSync(source, target);
  }
}

function prepareIsolatedFixture() {
  const sourceUserData = path.join(root, ".local-user-data-project-resource-batchF-preview-20260817");
  if (!fs.existsSync(sourceUserData)) throw new Error(`缺少项目切换基础夹具：${sourceUserData}`);
  isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-home-project-switch-"));
  const userData = path.join(isolatedRoot, "userData");
  fs.mkdirSync(userData, { recursive:true });
  const sourceSystem = path.join(sourceUserData, "system");
  if (fs.existsSync(sourceSystem)) copyTree(sourceSystem, path.join(userData, "system"));
  const sourceTenantsRoot = path.join(sourceUserData, "tenants");
  const sourceTenantId = fs.readdirSync(sourceTenantsRoot, { withFileTypes:true }).find(item => item.isDirectory())?.name;
  if (!sourceTenantId) throw new Error("项目切换基础夹具中没有租户数据");
  const targetTenantRoot = path.join(userData, "tenants", "test-tenant");
  for (const name of ["database", "materials"]) {
    const source = path.join(sourceTenantsRoot, sourceTenantId, name);
    if (fs.existsSync(source)) copyTree(source, path.join(targetTenantRoot, name));
  }
  const tenantsRoot = path.join(userData, "tenants");
  const tenantId = fs.readdirSync(tenantsRoot, { withFileTypes:true }).find(item => item.isDirectory())?.name;
  if (!tenantId) throw new Error("项目切换夹具中没有租户数据");
  const tenantRoot = path.join(tenantsRoot, tenantId);
  const bridge = new WorkbenchDataBridge({ tenantRootProvider:() => tenantRoot });
  let projects = bridge.bootstrap().projects.filter(item => !item.deletedAt && !item.archivedAt);
  while (projects.length < 2) projects.push(bridge.createProject({ name:`项目切换回归 ${projects.length + 1}` }));
  projects = projects.slice(0, 2).sort((a, b) => bridge.listAssets({projectId:a.id, type:"image"}).length - bridge.listAssets({projectId:b.id, type:"image"}).length);
  const fixtureRoot = path.join(root, "references", "home-asset-picker-project-switch-fixtures");
  fs.mkdirSync(fixtureRoot, { recursive:true });
  const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nL8AAAAASUVORK5CYII=", "base64");
  const paths = Array.from({length:20}, (_, index) => {
    const file = path.join(fixtureRoot, `project-switch-${String(index + 1).padStart(2, "0")}.png`);
    fs.writeFileSync(file, pixel);
    return file;
  });
  const fill = (project, desired, offset) => {
    const current = bridge.listAssets({projectId:project.id, type:"image"}).filter(item => !item.deletedAt && !item.archivedAt).length;
    if (current < desired) bridge.importAssets({projectId:project.id, paths:paths.slice(offset, offset + desired - current), source:"home-project-switch-regression"});
  };
  fill(projects[0], 6, 0);
  fill(projects[1], 10, 10);
  return userData;
}

async function launchIsolatedClient() {
  await startIdentityServer();
  const userData = prepareIsolatedFixture();
  spawnedElectron = spawn(path.join(root, "node_modules", "electron", "dist", "electron.exe"), [".", `--remote-debugging-port=${port}`, "--no-sandbox"], {
    cwd:root,
    windowsHide:true,
    stdio:"ignore",
    env:{...process.env, LINGFRAME_SMOKE_ALLOW_SECOND_INSTANCE:"1", LINGFRAME_TEST_USER_DATA:userData, LINGFRAME_IDENTITY_SERVER_URL:`http://127.0.0.1:${identityPort}`}
  });
}

async function stopIsolatedClient() {
  const pid = spawnedElectron?.pid;
  if (pid && process.platform === "win32") spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {windowsHide:true, stdio:"ignore"});
  else spawnedElectron?.kill();
  spawnedElectron = null;
  if (identityServer) await new Promise(resolve => identityServer.close(resolve));
  identityServer = null;
  await wait(400);
  if (isolatedRoot && path.dirname(isolatedRoot) === os.tmpdir()) try { fs.rmSync(isolatedRoot, {recursive:true, force:true}); } catch {}
}

async function connect(timeout = 30000) {
  const started = Date.now();
  let target = null;
  while (Date.now() - started < timeout && !target) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = targets.find(item => item.type === "page" && String(item.url || "").includes("src/renderer/index.html"));
    } catch {}
    if (!target) await wait(150);
  }
  if (!target) throw new Error(`未找到灵帧AI主页面 @ ${port}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const send = (method, params = {}, timeoutMs = 10000) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => reject(new Error(`${method} timeout`)), timeoutMs);
    const handler = event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      clearTimeout(timer);
      socket.removeEventListener("message", handler);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result || {});
    };
    socket.addEventListener("message", handler);
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Runtime.evaluate failed");
    return result.result?.value;
  };
  return { send, evaluate, close: () => socket.close() };
}

async function waitFor(evaluate, expression, label, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return;
    await wait(100);
  }
  throw new Error(`等待超时：${label}`);
}

(async () => {
  const checks = [];
  const check = (name, ok, detail = null) => checks.push({ name, ok: Boolean(ok), detail });
  const css = fs.readFileSync(cssFile, "utf8");
  const appSource = fs.readFileSync(appFile, "utf8");
  const compactCss = css.replace(/\s+/g, "");
  check("grid uses content-sized implicit rows", compactCss.includes(truth.requiredCssDeclaration.replace(/\s+/g, "")), truth.requiredCssDeclaration);
  check("project switch rerenders asset grid", /data-home-picker-source[^\n]+onchange=async event=>\{sourceProjectId=event\.target\.value;await render\(\);\}/.test(appSource));
  check("selection uses delegated grid click", /data-home-picker-grid[^\n]+onclick=async event=>/.test(appSource));

  await launchIsolatedClient();
  const cdp = await connect();
  try {
    const loginStatus = await cdp.evaluate(`window.lingframe.auth.login({identity:"test@example.com",password:"ValidPassword!123"})`);
    if (!loginStatus?.workspaceReady) throw new Error(`测试用户登录未完成：${JSON.stringify(loginStatus)}；请求：${JSON.stringify(identityRequests)}`);
    await waitFor(cdp.evaluate, "Boolean(document.querySelector('.shell'))", "登录后的桌面工作台");
    await cdp.evaluate(`(()=>{document.querySelectorAll('.home-preview:not(.home-asset-picker) [data-home-preview-close]').forEach(button=>button.click());document.querySelector('[data-home-picker-cancel]')?.click();document.querySelector('[data-page="home"]')?.click();return true})()`);
    try {
      await waitFor(cdp.evaluate, "Boolean(document.querySelector('[data-home-asset-add=\"image\"]'))", "创作首页图片入口");
    } catch (error) {
      const diagnostic = await cdp.evaluate(`(async()=>{const boot=await window.lingframe?.workbench?.bootstrap?.().catch(error=>({error:String(error)}));const ready=await Promise.race([window.lingframeAccountStore?.ready?.then(()=>"resolved").catch(error=>"rejected:"+error),new Promise(resolve=>setTimeout(()=>resolve("pending"),300))]);const before=document.querySelectorAll('[data-home-asset-add]').length;window.dispatchEvent(new CustomEvent('lingframe:account-store-ready'));await new Promise(resolve=>setTimeout(resolve,800));return{activePage:document.querySelector('.nav.active')?.dataset.page||'',composer:Boolean(document.querySelector('.composer')),attach:Boolean(document.querySelector('[data-home-attach]')),assetButtonsBefore:before,assetButtonsAfter:document.querySelectorAll('[data-home-asset-add]').length,accountReady:ready,bootProjects:(boot?.projects||[]).length,bootError:boot?.error||'',bodyText:(document.body.innerText||'').slice(0,500)}})()`);
      throw new Error(`${error.message}；诊断：${JSON.stringify(diagnostic)}`);
    }
    const projects = await cdp.evaluate(`(async()=>{const boot=await window.lingframe.workbench.bootstrap();const rows=[];for(const project of (boot.projects||[]).filter(item=>!item.deletedAt&&!item.archivedAt)){const assets=(await window.lingframe.assets.list({projectId:project.id})).filter(item=>!item.deletedAt&&!item.archivedAt&&item.type==='image');rows.push({id:project.id,name:project.name,count:assets.length});}return rows})()`);
    const sourceProject = projects.find(item => item.count >= truth.sourceProjectImageCount.min && item.count <= truth.sourceProjectImageCount.max);
    const targetProject = projects.find(item => item.id !== sourceProject?.id && item.count >= truth.targetProjectImageCount.min);
    check("fixture has a two-row source project", Boolean(sourceProject), projects);
    check("fixture has a three-row target project", Boolean(targetProject), projects);
    if (!sourceProject || !targetProject) throw new Error(`项目素材数量不满足回归场景：${JSON.stringify(projects)}`);

    await cdp.evaluate("document.querySelector('.composer [data-home-asset-add=\"image\"]').click();true");
    await waitFor(cdp.evaluate, "Boolean(document.querySelector('[data-home-source=\"center\"]'))", "素材来源弹窗");
    await cdp.evaluate("document.querySelector('[data-home-source=\"center\"]').click();true");
    await waitFor(cdp.evaluate, "Boolean(document.querySelector('[data-home-picker-source]'))", "素材中心选择器");

    const switchProject = async projectId => {
      await cdp.evaluate(`(()=>{const select=document.querySelector('[data-home-picker-source]');select.value=${JSON.stringify(projectId)};select.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
      await waitFor(cdp.evaluate, `document.querySelector('[data-home-picker-source]')?.value===${JSON.stringify(projectId)}&&document.querySelectorAll('[data-home-picker-card]').length>0`, `切换项目 ${projectId}`);
      await wait(250);
    };
    const inspectFirstButton = () => cdp.evaluate(`(()=>{const card=document.querySelector('[data-home-picker-card]'),button=card?.querySelector('[data-home-picker-select]');if(!card||!button)return null;const cardRect=card.getBoundingClientRect(),buttonRect=button.getBoundingClientRect(),x=buttonRect.left+buttonRect.width/2,y=buttonRect.top+buttonRect.height/2,hit=document.elementFromPoint(x,y);return{assetId:button.dataset.homePickerSelect,pressed:button.getAttribute('aria-pressed'),card:{top:cardRect.top,bottom:cardRect.bottom,height:cardRect.height},button:{left:buttonRect.left,top:buttonRect.top,bottom:buttonRect.bottom,width:buttonRect.width,height:buttonRect.height,centerX:x,centerY:y},inside:buttonRect.top>=cardRect.top&&buttonRect.bottom<=cardRect.bottom,hitTestable:hit===button||button.contains(hit),hitTag:hit?.tagName||'',hitClass:hit?.className||'',gridRows:getComputedStyle(document.querySelector('[data-home-picker-grid]')).gridTemplateRows}})()`);

    await switchProject(sourceProject.id);
    const sourceLayout = await inspectFirstButton();
    check("two-row project selection button is visible", sourceLayout?.inside && sourceLayout?.hitTestable, sourceLayout);

    await switchProject(targetProject.id);
    const before = await inspectFirstButton();
    check("three-row project button stays inside its card", before?.inside === truth.expected.buttonInsideOwnCard, before);
    check("three-row project button wins hit testing", before?.hitTestable === truth.expected.buttonHitTestable, before);
    if (!before) throw new Error("切换后没有可测试的素材按钮");
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: before.button.centerX, y: before.button.centerY, button: "left", clickCount: 1 });
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: before.button.centerX, y: before.button.centerY, button: "left", clickCount: 1 });
    await wait(180);
    const after = await inspectFirstButton();
    const previewOpened = await cdp.evaluate("Boolean(document.querySelector('.home-preview:not(.home-asset-picker) [data-home-preview-close]'))");
    check("human pointer click toggles the same asset", Boolean(after && after.assetId === before.assetId && after.pressed !== before.pressed) === truth.expected.pointerClickTogglesSelection, { before, after });
    check("selection click does not open image preview", previewOpened === !truth.expected.pointerClickDoesNotOpenPreview, { previewOpened });
    await cdp.send("Page.bringToFront");
    const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, 30000);
    const logDir = path.join(root, "scripts", "log");
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(path.join(logDir, "home-asset-picker-project-switch.png"), Buffer.from(screenshot.data, "base64"));
  } finally {
    await cdp.evaluate(`(()=>{document.querySelectorAll('.home-preview:not(.home-asset-picker) [data-home-preview-close]').forEach(button=>button.click());document.querySelector('[data-home-picker-cancel]')?.click();return true})()`).catch(() => {});
    cdp.close();
    await stopIsolatedClient();
  }

  const failed = checks.filter(item => !item.ok);
  const report = { test: truth.test, timestamp: new Date().toISOString(), port, groundTruth: truth, total: checks.length, passed: checks.length - failed.length, failed: failed.length, checks };
  const logDir = path.join(root, "scripts", "log");
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(path.join(logDir, "home-asset-picker-project-switch.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (failed.length) process.exitCode = 1;
})().catch(async error => { console.error(error.stack || error);await stopIsolatedClient();process.exitCode = 1; });
