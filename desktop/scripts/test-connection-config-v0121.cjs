"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {ConnectionConfig} = require("../src/main/connection-config.cjs");
const {LicenseClient} = require("../src/main/license-client.cjs");
const {AgentBridge} = require("../src/main/agent-bridge.cjs");

const root = path.resolve(__dirname, "..");
const referenceFile = path.join(root, "references", "connection-config-v0121-ground-truth.json");
const logFile = path.join(root, "scripts", "log", "v0.12.1-connection-config.json");
const groundTruth = {
  version: "0.12.1",
  bootstrapOrder: ["https://config-primary.example", "https://config-backup.example"],
  licenseUrls: ["https://api-primary.example", "https://api-backup.example"],
  businessUrls: ["https://api-primary.example", "https://api-backup.example"],
  requirements: {primaryFailureUsesBackup:true, offlineUsesSignedCache:true, tamperedConfigRejected:true, ordinaryStatusHidesUrls:true, adminOverrideRequiresSignedServer:true, licenseRequestsFailOver:true, agentRequestsFailOver:true, productionBuildRequiresHttpsBootstrap:true},
};
fs.mkdirSync(path.dirname(referenceFile), {recursive:true});
fs.writeFileSync(referenceFile, JSON.stringify(groundTruth, null, 2), "utf8");

const pair = crypto.generateKeyPairSync("ed25519");
const publicKey = pair.publicKey.export({type:"spki", format:"pem"});
const privateKey = pair.privateKey.export({type:"pkcs8", format:"pem"});
const now = Date.parse("2026-08-15T10:00:00.000Z");
function envelope(payload) {
  const bytes = Buffer.from(JSON.stringify(payload), "utf8");
  return {payload:bytes.toString("base64url"), signature:crypto.sign(null, bytes, privateKey).toString("base64url")};
}
function configEnvelope(baseUrls = groundTruth.licenseUrls) {
  return envelope({version:1, issuer:"dola-license-center", appId:"doubao-dola-workbench", scope:"client-connection-config", revision:7, enabled:true, baseUrls, licenseBaseUrls:baseUrls, businessBaseUrls:baseUrls, bootstrapUrls:groundTruth.bootstrapOrder, issuedAt:new Date(now).toISOString(), expiresAt:new Date(now + 3600000).toISOString()});
}
function adminEnvelope() {
  return envelope({version:1, issuer:"dola-license-center", appId:"doubao-dola-workbench", scope:"client-server-settings-admin", username:"admin", issuedAt:new Date(now).toISOString(), expiresAt:new Date(now + 600000).toISOString()});
}

(async()=>{
  const checks=[];
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-connection-v0121-"));
  const bootstrapFile = path.join(temp, "bootstrap.json");
  fs.writeFileSync(bootstrapFile, JSON.stringify({bootstrapUrls:groundTruth.bootstrapOrder, productionDomainRequired:true}), "utf8");
  const calls=[];
  const remote = new ConnectionConfig({dataRoot:path.join(temp,"system"), bootstrapFile, publicKey, now:()=>now, requestFn:async(url,options)=>{
    calls.push(url);
    if (url.startsWith(groundTruth.bootstrapOrder[0])) throw new Error("primary offline");
    if (url.endsWith("/api/v1/client-config")) return {ok:true, config:configEnvelope(url.startsWith("https://new") ? ["https://new.example"] : groundTruth.licenseUrls)};
    if (url.endsWith("/api/v1/client-admin/verify")) return {ok:true, grant:adminEnvelope()};
    throw new Error(`unexpected ${url} ${options?.method}`);
  }});
  await remote.refresh();
  assert.ok(calls[0].startsWith(groundTruth.bootstrapOrder[0]));
  assert.ok(calls[1].startsWith(groundTruth.bootstrapOrder[1]));
  assert.deepEqual(remote.serviceUrls("license"), groundTruth.licenseUrls);
  assert.deepEqual(remote.serviceUrls("business"), groundTruth.businessUrls);
  checks.push("primaryFailureUsesBackup");

  const publicText = JSON.stringify(remote.publicStatus());
  for (const url of [...groundTruth.bootstrapOrder, ...groundTruth.licenseUrls]) assert.equal(publicText.includes(url), false);
  checks.push("ordinaryStatusHidesUrls");

  const cached = new ConnectionConfig({dataRoot:path.join(temp,"system"), bootstrapFile, publicKey, now:()=>now + 120000, requestFn:async()=>{throw new Error("offline")}});
  const cachedStatus = await cached.refresh();
  assert.equal(cachedStatus.state, "cached");
  assert.deepEqual(cached.serviceUrls("license"), groundTruth.licenseUrls);
  checks.push("offlineUsesSignedCache");

  const tamperRoot = path.join(temp,"tamper"); fs.mkdirSync(tamperRoot,{recursive:true});
  const bad = configEnvelope(); bad.payload = Buffer.from("{}", "utf8").toString("base64url");
  const tampered = new ConnectionConfig({dataRoot:tamperRoot, bootstrapFile, publicKey, now:()=>now, requestFn:async()=>({config:bad})});
  await assert.rejects(()=>tampered.refresh(), error=>error.code === "INVALID_CONFIG_SIGNATURE");
  checks.push("tamperedConfigRejected");

  const verified = await remote.verifyAdmin({username:"admin",password:"correct"});
  await remote.applyAdminOverride(verified.sessionId,{mode:"custom",baseUrls:["https://new.example"]});
  assert.deepEqual(remote.serviceUrls("license"), ["https://new.example"]);
  assert.deepEqual(remote.serviceUrls("business"), ["https://new.example"]);
  checks.push("adminOverrideRequiresSignedServer");

  const device={version:1,hash:"d".repeat(64),suffix:"dddddddddd"};
  const licensePayload={version:1,issuer:"dola-license-center",appId:"doubao-dola-workbench",deviceHash:device.hash,tenantId:"11111111-1111-1111-1111-111111111111",licenseId:"22222222-2222-2222-2222-222222222222",keyPrefix:"DOLA-TEST",serverTime:new Date(now).toISOString(),refreshAfter:new Date(now+10000).toISOString(),leaseExpiresAt:new Date(now+20000).toISOString(),licenseExpiresAt:null};
  const licenseCalls=[];
  const license = new LicenseClient({dataRoot:path.join(temp,"license"),serverUrls:groundTruth.licenseUrls,publicKey,device,appVersion:"0.12.1",requestFn:async(serverUrl)=>{licenseCalls.push(serverUrl);if(serverUrl===groundTruth.licenseUrls[0])throw new Error("network");return {grant:envelope(licensePayload),activationToken:"token"}}});
  await license.activate("DOLA-ABCD-EFGH-JKLM-NPQR-STUV");
  assert.deepEqual(licenseCalls, groundTruth.licenseUrls);
  assert.equal(license.serverUrl, groundTruth.licenseUrls[1]);
  checks.push("licenseRequestsFailOver");

  const originalFetch=global.fetch; const agentCalls=[];
  global.fetch=async(url)=>{agentCalls.push(String(url));if(String(url).startsWith(groundTruth.businessUrls[0]))throw new Error("network");return {ok:true,status:200,json:async()=>({ok:true,tenantId:"11111111-1111-1111-1111-111111111111"})}};
  try {
    const agent=new AgentBridge({dataRoot:path.join(temp,"agent"),licenseClient:license,identityProvider:()=>({usable:true,tenantId:"11111111-1111-1111-1111-111111111111"}),initialConfig:{agentToken:"a".repeat(48)},serverUrls:groundTruth.businessUrls,profileRootProvider:()=>path.join(temp,"profiles"),testMode:true});
    await agent.request("/agent/v1/register",{},1000);
    assert.equal(agentCalls.length,2); assert.equal(agent.serverUrl,groundTruth.businessUrls[1]);
  } finally { global.fetch=originalFetch; }
  checks.push("agentRequestsFailOver");

  const renderer=fs.readFileSync(path.join(root,"src","renderer","desktop-ui.js"),"utf8");
  assert.ok(renderer.includes("普通租户无需填写任何服务器信息"));
  assert.ok(renderer.includes("event.ctrlKey && event.shiftKey && event.altKey"));
  assert.equal(renderer.includes("53188 服务器"),false);
  assert.ok(renderer.includes("服务连接正常"));
  assert.ok(renderer.includes("服务连接异常"));
  assert.ok(renderer.includes("node.className = 'license-gate'"));
  assert.equal(renderer.includes("verify-existing-agent"),false);
  assert.equal(renderer.includes("本机设备尾号"),false);
  assert.equal(renderer.includes("手工 Agent 令牌"),false);
  const buildGuard=fs.readFileSync(path.join(root,"scripts","preflight-production-build.cjs"),"utf8");
  const packageJson=JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8"));
  assert.ok(buildGuard.includes('url.protocol !== "https:"'));
  assert.ok(packageJson.scripts["dist:win"].includes("preflight:dist"));
  checks.push("tenantUiHiddenAndAdminEntry");

  const result={test:"connection-config-v0121",timestamp:new Date().toISOString(),passed:checks.length,checks};
  fs.mkdirSync(path.dirname(logFile),{recursive:true}); fs.writeFileSync(logFile,JSON.stringify(result,null,2),"utf8");
  console.log(JSON.stringify(result,null,2));
})().catch(error=>{console.error(error);process.exit(1)});
