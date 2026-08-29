"use strict";
const fs=require("fs");const path=require("path");const {spawn}=require("child_process");
const root=path.resolve(__dirname,"..");const electron=path.join(root,"node_modules","electron","dist","electron.exe");const preview=path.join(root,"backups","infinite-canvas-optimization-20260816","batch-F-preview-userData");const port=9335;
fs.mkdirSync(preview,{recursive:true});
const checks=[];const check=(name,ok,detail="")=>checks.push({name,ok:Boolean(ok),detail:ok?"":detail});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  const child=spawn(electron,[".",`--remote-debugging-port=${port}`,`--user-data-dir=${preview}`,"--no-sandbox"],{cwd:root,windowsHide:true,stdio:"ignore"});
  try{
    let targets=[];for(let i=0;i<30;i++){await sleep(250);try{targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();if(targets.length)break;}catch{}}
    const page=targets.find(item=>String(item.url||"").includes("src/renderer"));
    check("Electron 预览进程可启动",Boolean(targets.length),`pid=${child.pid}`);
    check("隔离 CDP 页面已加载",Boolean(page),JSON.stringify(targets));
    check("预览页面指向当前源码",Boolean(page&&String(page.url).includes("lingzhen_ai_desktop_v1")),page?.url||"");
    check("工作流可移植模块已纳入入口",fs.readFileSync(path.join(root,"src/renderer/index.html"),"utf8").includes("canvas-workflow-portability.js"));
    check("预览使用独立 userData",fs.existsSync(preview),preview);
  }finally{try{child.kill();}catch{}await sleep(300);}
  const failed=checks.filter(item=>!item.ok);const output={test:"infinite-canvas-isolated-preview",at:new Date().toISOString(),total:checks.length,passed:checks.length-failed.length,failed:failed.length,pid:child.pid,preview,checks};
  const logDir=path.join(root,"scripts","log");fs.mkdirSync(logDir,{recursive:true});fs.writeFileSync(path.join(logDir,"infinite-canvas-isolated-preview.json"),JSON.stringify(output,null,2),"utf8");console.log(JSON.stringify(output,null,2));if(failed.length)process.exitCode=1;
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
