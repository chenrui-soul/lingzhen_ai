"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {ConnectionConfig, cleanBaseUrl, uniqueUrls} = require("../src/main/connection-config.cjs");

const root = path.resolve(__dirname, "..");
const referenceFile = path.join(root, "references", "connection-http-mode-v0122-ground-truth.json");
const logFile = path.join(root, "scripts", "log", "connection-http-mode-v0122.json");
const groundTruth = JSON.parse(fs.readFileSync(referenceFile, "utf8"));
const pair = crypto.generateKeyPairSync("ed25519");
const publicKey = pair.publicKey.export({type: "spki", format: "pem"});
const privateKey = pair.privateKey.export({type: "pkcs8", format: "pem"});
const now = Date.parse("2026-08-16T10:00:00.000Z");
const envelope = payload => { const bytes = Buffer.from(JSON.stringify(payload)); return {payload: bytes.toString("base64url"), signature: crypto.sign(null, bytes, privateKey).toString("base64url")}; };
const configEnvelope = baseUrls => envelope({version: 1, issuer: "dola-license-center", appId: "doubao-dola-workbench", scope: "client-connection-config", revision: 1, enabled: true, allowPublicHttp: true, baseUrls, licenseBaseUrls: baseUrls, businessBaseUrls: baseUrls, bootstrapUrls: baseUrls, issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 3600000).toISOString()});

(async () => {
  const checks = [];
  assert.equal(cleanBaseUrl("http://public.example"), "");
  assert.equal(cleanBaseUrl("https://public.example"), "https://public.example");
  checks.push("strictRejectsPublicHttp");
  assert.equal(cleanBaseUrl("http://public.example", {allowPublicHttp: true}), "http://public.example");
  assert.deepEqual(uniqueUrls(["http://public.example", "https://secure.example"], {allowPublicHttp: true}), ["http://public.example", "https://secure.example"]);
  checks.push("internalModeAcceptsPublicHttp");

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-http-mode-v0122-"));
  const bootstrapFile = path.join(temp, "bootstrap.json");
  fs.writeFileSync(bootstrapFile, JSON.stringify({version: 1, bootstrapUrls: ["http://bootstrap.example"], allowPublicHttp: true}), "utf8");
  const client = new ConnectionConfig({dataRoot: path.join(temp, "system"), bootstrapFile, publicKey, now: () => now, requestFn: async url => ({ok: true, config: configEnvelope(["http://primary.example", "https://backup.example"])})});
  await client.refresh();
  assert.deepEqual(client.serviceUrls("license"), ["http://primary.example", "https://backup.example"]);
  checks.push("mixedHttpHttpsFailoverPreserved");
  fs.rmSync(temp, {recursive: true, force: true});

  const result = {test: "connection-http-mode-v0122", version: groundTruth.version, passed: checks.length, checks, timestamp: new Date().toISOString()};
  fs.mkdirSync(path.dirname(logFile), {recursive: true});
  fs.writeFileSync(logFile, JSON.stringify(result, null, 2), "utf8");
  console.log(JSON.stringify(result, null, 2));
})().catch(error => { console.error(error && error.stack ? error.stack : error); process.exit(1); });
