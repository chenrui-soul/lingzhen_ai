"use strict";
const {spawnSync} = require("child_process");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname,"..");
const tests = [
  "scripts/test-account-groups.cjs",
  "scripts/test-desktop-identity.cjs",
  "scripts/test-doubao-result-capture.cjs",
  "scripts/test-embedded-browser.cjs",
  "scripts/test-generation-live-layout.cjs",
  "scripts/test-home-account-profile.cjs",
  "scripts/test-model-gateway.cjs",
  "scripts/test-multi-task-dock.cjs",
  "scripts/test-project-materials.cjs",
  "scripts/test-task-center.cjs",
  "scripts/test-text-workspace.cjs",
  "scripts/test-unified-execution.cjs",
  "tests/smoke.cjs",
  "tests/tenant-storage.cjs",
  "tests/responsive-doubao-layout.cjs",
  "tests/video-capture-isolation.cjs",
  "tests/browser-generation.cjs",
  "tests/license-client.cjs",
  "tests/agent-bridge.cjs",
  "tests/agent-token-exchange.cjs"
];
const results = tests.map(file => {
  const started = Date.now();
  const run = spawnSync(process.execPath,[path.join(root,file)],{cwd:root,encoding:"utf8",timeout:120000,env:process.env});
  return {file,passed:run.status===0,durationMs:Date.now()-started,status:run.status,stdout:String(run.stdout||"").slice(-1600),stderr:String(run.stderr||"").slice(-1600),error:run.error?.message||""};
});
const output = {at:new Date().toISOString(),total:results.length,passed:results.filter(item=>item.passed).length,failed:results.filter(item=>!item.passed).length,results};
const logDirectory=path.join(root,"scripts","log");fs.mkdirSync(logDirectory,{recursive:true});fs.writeFileSync(path.join(logDirectory,"infinite-canvas-regression.json"),JSON.stringify(output,null,2),"utf8");
console.log(JSON.stringify({at:output.at,total:output.total,passed:output.passed,failed:output.failed,failures:results.filter(item=>!item.passed).map(item=>({file:item.file,status:item.status,error:item.error,stderr:item.stderr}))},null,2));
if(output.failed)process.exitCode=1;
