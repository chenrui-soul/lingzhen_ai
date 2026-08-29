"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {spawnSync} = require("child_process");
const {DesktopBillingClient} = require("../src/main/desktop-billing-client.cjs");

const root = path.resolve(__dirname, "..");
const checks = [];
async function check(name, fn) {
  try { await fn(); checks.push({name, ok: true}); }
  catch (error) { checks.push({name, ok: false, error: String(error.stack || error)}); }
}

async function run() {
  await check("billing scripts keep valid syntax", () => {
    for (const file of ["src/main/desktop-billing-client.cjs", "src/renderer/credits-center.js", "src/renderer/app.js"]) {
      const result = spawnSync(process.execPath, ["--check", path.join(root, file)], {encoding: "utf8"});
      assert.equal(result.status, 0, result.stderr || file);
    }
  });
  await check("desktop UI exposes recharge application without management actions", () => {
    const app = fs.readFileSync(path.join(root, "src/renderer/app.js"), "utf8");
    const ui = fs.readFileSync(path.join(root, "src/renderer/credits-center.js"), "utf8");
    assert(app.includes("积分中心"));
    assert(app.includes("data-desktop-user"));
    assert(app.includes("data-user-avatar"));
    assert(app.includes("data-user-credits"));
    assert(ui.includes("提交充值申请"));
    assert(ui.includes("Promise.allSettled"));
    assert(ui.includes("bootstrapWalletFallback"));
    assert(!ui.includes("确认到账并入账"));
    assert(!ui.includes("管理员充值"));
  });
  await check("main process sends manual order with idempotency header", async () => {
    const calls = [];
    const client = new DesktopBillingClient({authClient: {authenticatedRequest: async (pathname, options) => {
      calls.push({pathname, options});
      return {
        id: "order-1", orderNo: "LZ1", packageId: "package-1", packageCode: "starter",
        cashAmountCents: 990, creditAmount: 100, bonusCredits: 10,
        paymentChannel: "manual_transfer", status: "manual_review",
      };
    }}});
    const order = await client.createOrder({packageId: "package-1", note: "已转账"});
    assert.equal(order.status, "manual_review");
    assert.equal(calls[0].pathname, "/api/v1/recharge-orders");
    assert.equal(calls[0].options.body.paymentChannel, "manual_transfer");
    assert.match(calls[0].options.headers["Idempotency-Key"], /^desktop-manual-/);
  });
  await check("wallet packages orders and cancel stay scoped to current user endpoints", async () => {
    const paths = [];
    const client = new DesktopBillingClient({authClient: {authenticatedRequest: async pathname => {
      paths.push(pathname);
      if (pathname.includes("credits/wallet")) return {userId:"user-1",availableBalance:10,reservedBalance:2};
      if (pathname.includes("credits/ledger")) return {items:[],nextCursor:null};
      if (pathname.includes("recharge-packages")) return {items:[]};
      if (pathname.includes("recharge-orders?")) return {items:[]};
      return {id:"order-1",orderNo:"LZ1",packageId:"package-1",packageCode:"starter",cashAmountCents:990,creditAmount:100,bonusCredits:10,paymentChannel:"manual_transfer",status:"closed"};
    }}});
    await client.wallet(); await client.packages(); await client.orders(20);
    await client.ledger(20);
    await client.cancelOrder("order-1");
    assert.deepEqual(paths, [
      "/api/v1/credits/wallet", "/api/v1/recharge-packages",
      "/api/v1/recharge-orders?limit=20", "/api/v1/credits/ledger?limit=20",
      "/api/v1/recharge-orders/order-1/cancel",
    ]);
    assert(paths.every(item => !item.includes("userId") && !item.includes("tenantId")));
  });

  const failed = checks.filter(item => !item.ok);
  const report = {test: "desktop-manual-recharge", total: checks.length, passed: checks.length - failed.length, failed: failed.length, checks};
  console.log(JSON.stringify(report, null, 2));
  if (failed.length) process.exitCode = 1;
}

run().catch(error => { console.error(error.stack || error); process.exit(1); });
