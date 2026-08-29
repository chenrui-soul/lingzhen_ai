"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {AgentBridge} = require("../src/main/agent-bridge.cjs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-exchange-"));
const credentials = {licenseId: "12345678-1234-1234-1234-123456789012", activationToken: "t".repeat(42), deviceHash: "a".repeat(64), fingerprintVersion: 1, appId: "doubao-dola-workbench", appVersion: "0.2.0"};
let requested = null;
const licenseClient = {status: () => ({usable: true, tenantId: "tenant-a"}), credentials: () => credentials};
const bridge = new AgentBridge({dataRoot: root, licenseClient, profileRootProvider: () => path.join(root, "tenant-a", "chrome-profiles"), serverUrl: "http://exchange.test", testMode: true});
const originalFetch = global.fetch;
global.fetch = async (url, options) => {
  requested = {url, body: JSON.parse(options.body)};
  return {ok: true, status: 200, json: async () => ({ok: true, tenantId: "tenant-a", agentToken: "a".repeat(48), serverUrl: "http://127.0.0.1:53188"})};
};
(async () => {
  assert.equal(await bridge.acquireToken(), true);
  assert.equal(requested.url, "http://exchange.test/desktop/v1/agent-token");
  assert.equal(requested.body.tenantId, undefined);
  assert.equal(bridge.config.tokenSource, "license-grant");
  assert.equal(bridge.config.agentToken.length, 48);
  bridge.stop();
  global.fetch = originalFetch;
  console.log(JSON.stringify({test: "agent-token-exchange", passed: 4, failed: 0, root}));
})().catch(error => { global.fetch = originalFetch; console.error(error); process.exit(1); });
