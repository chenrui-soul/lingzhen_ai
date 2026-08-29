"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {ConnectionConfig} = require("../src/main/connection-config.cjs");

(async () => {
  const root = path.resolve(__dirname, "..");
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-live-config-v0121-"));
  const bootstrapFile = path.join(root, "assets", "connection-bootstrap.json");
  const online = new ConnectionConfig({dataRoot, bootstrapFile, appVersion:"0.12.1"});
  const onlineStatus = await online.refresh();
  assert.equal(onlineStatus.connected, true);
  assert.ok(fs.existsSync(path.join(dataRoot, "connection-config-cache.json")));

  const offline = new ConnectionConfig({
    dataRoot,
    bootstrapFile,
    appVersion:"0.12.1",
    requestFn: async () => { throw new Error("simulated network outage"); },
  });
  const offlineStatus = await offline.refresh();
  assert.equal(offlineStatus.connected, true);
  assert.equal(offlineStatus.state, "cached");
  assert.equal(/https?:\/\//i.test(JSON.stringify(offlineStatus)), false);

  const result = {test:"live-connection-cache-v0121",passed:4,failed:0,onlineState:onlineStatus.state,offlineState:offlineStatus.state};
  const logDir = path.join(root, "scripts", "log");
  fs.mkdirSync(logDir, {recursive:true});
  fs.writeFileSync(path.join(logDir, "v0.12.1-live-connection-cache.json"), JSON.stringify(result, null, 2), "utf8");
  console.log(JSON.stringify(result, null, 2));
})().catch(error => { console.error(error); process.exit(1); });
