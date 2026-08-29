"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const truthPath = path.join(root, "references", "account-store-bootstrap-race-ground-truth.json");
const truth = JSON.parse(fs.readFileSync(truthPath, "utf8"));
const source = fs.readFileSync(path.join(root, "src", "renderer", "account-store.js"), "utf8");
const storage = new Map();
const events = [];
let bootstrapCalls = 0;
let authChanged = null;
const account = {id:truth.expected.accountId, name:truth.expected.accountName, platform:"豆包"};
const context = {
  console,
  setTimeout,
  clearTimeout,
  Promise,
  CustomEvent:class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
  localStorage:{
    getItem:key=>storage.has(key)?storage.get(key):null,
    setItem:(key,value)=>storage.set(key,String(value)),
  },
};
context.window = {
  lingframe:{
    identity:{status:async()=>({workspaceReady:true, tenantId:"tenant-test"})},
    auth:{onChanged:handler=>{authChanged=handler;}},
    doubaoAccounts:{
      bootstrap:async()=>{
        bootstrapCalls += 1;
        return bootstrapCalls === 1
          ? {tenantId:null, accounts:[], locked:truth.expected.firstResponseLocked}
          : {tenantId:"tenant-test", accounts:[account]};
      },
      upsert:async value=>value,
      remove:async accountId=>({ok:true, removed:true, accountId}),
    },
  },
  dispatchEvent:event=>events.push(event),
};
vm.runInNewContext(source, context, {filename:"account-store.js"});

(async()=>{
  await context.window.lingframeAccountStore.ready;
  const accounts = context.window.lingframeAccountStore.accounts();
  assert.equal(bootstrapCalls, truth.expected.bootstrapCalls);
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].id, truth.expected.accountId);
  assert.equal(accounts[0].name, truth.expected.accountName);
  assert(events.some(event=>event.type==="lingframe:account-store-ready"));
  assert.equal(typeof authChanged, "function");
  const report={test:truth.test,total:6,passed:6,failed:0,bootstrapCalls,accounts,events:events.map(event=>event.type),generatedAt:new Date().toISOString()};
  const logDir=path.join(root,"scripts","log");fs.mkdirSync(logDir,{recursive:true});
  fs.writeFileSync(path.join(logDir,"account-store-bootstrap-race.json"),JSON.stringify(report,null,2),"utf8");
  console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error.stack||error);process.exit(1);});
