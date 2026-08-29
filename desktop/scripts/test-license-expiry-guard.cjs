"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {LicenseClient, APP_ID} = require("../src/main/license-client.cjs");
const {DesktopIdentity} = require("../src/main/desktop-identity.cjs");
const {LicenseGuard} = require("../src/main/license-guard.cjs");

const referenceFile = path.join(__dirname, "../references/license-expiry-guard-ground-truth.json");
const groundTruth = JSON.parse(fs.readFileSync(referenceFile, "utf8"));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-license-expiry-"));
const device = {version: 1, hash: "b".repeat(64), suffix: "bbbbbbbbbb"};
const tenantId = "43ec40ae-962a-4c22-9f43-dc6d9e2ce92d";
const {publicKey, privateKey} = crypto.generateKeyPairSync("ed25519");
let passed = 0;

function check(name, operation) {
  operation();
  passed += 1;
  return name;
}
function iso(offsetMs) { return new Date(Date.now() + offsetMs).toISOString(); }
function grant({licenseExpiresIn = 30 * 24 * 60 * 60_000, leaseExpiresIn = 60 * 60_000} = {}) {
  const payload = {
    version: 1,
    issuer: "dola-license-center",
    appId: APP_ID,
    deviceHash: device.hash,
    tenantId,
    licenseId: "license-expiry-test",
    keyPrefix: "DOLA-TEST",
    serverTime: iso(0),
    refreshAfter: iso(leaseExpiresIn > 1_000 ? Math.min(30_000, leaseExpiresIn - 1) : leaseExpiresIn - 1_000),
    leaseExpiresAt: iso(leaseExpiresIn),
    licenseExpiresAt: iso(licenseExpiresIn),
  };
  const payloadBytes = Buffer.from(JSON.stringify(payload));
  return {payload: payloadBytes.toString("base64url"), signature: crypto.sign(null, payloadBytes, privateKey).toString("base64url")};
}
function clientWith(options) {
  const dataRoot = fs.mkdtempSync(path.join(root, "case-"));
  const client = new LicenseClient({dataRoot, device, publicKey, requestFn: async () => ({})});
  client.state = {version: 1, licenseId: "license-expiry-test", activationToken: "token", keyPrefix: "DOLA-TEST", grant: grant(options), lastServerTimeMs: Date.now(), lastVerifiedAt: new Date().toISOString()};
  return {client, dataRoot};
}

(async () => {
  const activeCase = clientWith();
  const activeGuard = new LicenseGuard({licenseClient: activeCase.client});
  check("active status", () => assert.equal(activeGuard.checkLocal().usable, groundTruth.expected.active.usable));
  check("active mode", () => assert.equal(activeGuard.last.mode, groundTruth.expected.active.mode));
  check("active generate", () => assert.equal(activeGuard.can("generate"), groundTruth.expected.active.generate));
  check("signed refresh time exposed", () => assert.ok(Date.parse(activeGuard.last.refreshAfter) > Date.now()));
  check("automatic refresh follows signed deadline before maximum interval", () => assert.ok(activeGuard.nextNetworkDelay(activeGuard.last) <= 31_000));

  const expiringCase = clientWith({licenseExpiresIn: 24 * 60 * 60_000, leaseExpiresIn: 12 * 60 * 60_000});
  const expiringGuard = new LicenseGuard({licenseClient: expiringCase.client});
  check("expiring mode", () => assert.equal(expiringGuard.checkLocal().mode, groundTruth.expected.expiring.mode));

  const expiredCase = clientWith({licenseExpiresIn: -1_000, leaseExpiresIn: 60 * 60_000});
  const expiredGuard = new LicenseGuard({licenseClient: expiredCase.client});
  const expired = expiredGuard.checkLocal();
  check("expired state", () => assert.equal(expired.state, groundTruth.expected.expired.state));
  check("expired restricted", () => assert.equal(expired.mode, groundTruth.expected.expired.mode));
  check("expired blocks generate", () => assert.equal(expiredGuard.can("generate"), groundTruth.expected.expired.generate));
  check("expired blocks write", () => assert.equal(expiredGuard.can("write-local"), groundTruth.expected.expired.writeLocal));
  check("expired permits local read", () => assert.equal(expiredGuard.can("read-local"), groundTruth.expected.expired.readLocal));
  check("expired permits result recovery", () => assert.equal(expiredGuard.can("result-recovery"), groundTruth.expected.expired.resultRecovery));
  check("expired throws stable code", () => assert.throws(() => expiredGuard.assert("generate"), error => error.code === "LICENSE_EXPIRED" && error.licenseState === "expired"));

  fs.writeFileSync(path.join(expiredCase.dataRoot, "verified-agent-identity.json"), JSON.stringify({tenantId, agentToken: "x".repeat(64), serverUrl: "https://agent.example.test", verifiedAt: new Date().toISOString()}));
  const expiredIdentity = new DesktopIdentity({dataRoot: expiredCase.dataRoot, licenseClient: expiredCase.client, legacyConfigPaths: []});
  check("agent cannot bypass expiry", () => assert.equal(expiredIdentity.status().usable, groundTruth.expected.expired.agentFallback));
  check("expired tenant retained for recovery", () => assert.equal(expiredIdentity.status().tenantId, tenantId));
  check("expired agent config withheld", () => assert.equal(expiredIdentity.agentConfig(), null));

  const activeIdentity = new DesktopIdentity({dataRoot: expiredCase.dataRoot, licenseClient: activeCase.client, legacyConfigPaths: []});
  activeIdentity.state = {tenantId, agentToken: "x".repeat(64), serverUrl: "https://agent.example.test"};
  check("active matching agent accepted", () => assert.equal(activeIdentity.status().usable, true));
  check("active agent config available", () => assert.equal(activeIdentity.agentConfig().tokenSource, "verified-agent"));

  const graceCase = clientWith({licenseExpiresIn: 24 * 60 * 60_000, leaseExpiresIn: -1_000});
  const graceGuard = new LicenseGuard({licenseClient: graceCase.client});
  const grace = graceGuard.checkLocal();
  check("offline grace state", () => assert.equal(grace.state, groundTruth.expected.offlineGraceExpired.state));
  check("offline grace restricted", () => assert.equal(grace.mode, groundTruth.expected.offlineGraceExpired.mode));
  check("offline grace blocks generate", () => assert.equal(graceGuard.can("generate"), groundTruth.expected.offlineGraceExpired.generate));
  check("offline grace permits recovery", () => assert.equal(graceGuard.can("result-recovery"), groundTruth.expected.offlineGraceExpired.resultRecovery));

  const rollbackCase = clientWith();
  rollbackCase.client.state.lastServerTimeMs = Date.now() + 60 * 60_000;
  const rollbackGuard = new LicenseGuard({licenseClient: rollbackCase.client});
  const rollback = rollbackGuard.checkLocal();
  check("clock rollback state", () => assert.equal(rollback.state, groundTruth.expected.clockRollback.state));
  check("clock rollback restricted", () => assert.equal(rollback.mode, groundTruth.expected.clockRollback.mode));
  check("clock rollback blocks generate", () => assert.equal(rollbackGuard.can("generate"), groundTruth.expected.clockRollback.generate));

  const timedCase = clientWith({licenseExpiresIn: 180, leaseExpiresIn: 60_000});
  const timedGuard = new LicenseGuard({licenseClient: timedCase.client, localCheckMs: 60_000, networkCheckMs: 60_000});
  let timedChange = null;
  timedGuard.on("change", status => { if (!status.usable) timedChange = status; });
  timedGuard.start();
  await new Promise(resolve => setTimeout(resolve, 350));
  check("runtime expiry timer", () => assert.equal(timedGuard.last.state, "expired"));
  check("runtime expiry event", () => assert.equal(timedChange?.state, "expired"));
  timedGuard.stop();

  const mainSource = fs.readFileSync(path.join(__dirname, "../src/main/main.cjs"), "utf8");
  for (const capability of groundTruth.protectedMainCapabilities) check(`main guard ${capability}`, () => assert(mainSource.includes(`licensed('${capability}'`) || mainSource.includes(`licenseGuard.assert(capability)`), capability));
  const orchestratorSource = fs.readFileSync(path.join(__dirname, "../src/main/generation-orchestrator.cjs"), "utf8");
  check("orchestrator generation defense", () => assert(orchestratorSource.includes('this.authorize("generate")')));
  check("orchestrator recovery distinction", () => assert(orchestratorSource.includes('"result-recovery"')));
  const agentSource = fs.readFileSync(path.join(__dirname, "../src/main/agent-bridge.cjs"), "utf8");
  check("agent command defense", () => assert(agentSource.includes("assertUsableIdentity")));

  console.log(JSON.stringify({test: "license-expiry-guard", passed, failed: 0, referenceFile, root}));
})().catch(error => { console.error(error); process.exit(1); });
