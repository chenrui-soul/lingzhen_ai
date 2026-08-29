"use strict";

const fs=require("fs");
const path=require("path");
const vm=require("vm");

const root=path.resolve(__dirname,"..");
const truth=JSON.parse(fs.readFileSync(path.join(root,"references","canvas-coming-soon-ground-truth.json"),"utf8"));
const app=fs.readFileSync(path.join(root,"src","renderer","app.js"),"utf8");
const css=fs.readFileSync(path.join(root,"src","renderer","styles","app.css"),"utf8");
const index=fs.readFileSync(path.join(root,"src","renderer","index.html"),"utf8");
const canvas=fs.readFileSync(path.join(root,"src","renderer","infinite-canvas.js"),"utf8");
const checks=[];
const check=(name,value,detail=null)=>checks.push({name,ok:Boolean(value),detail});

check("无限画布入口保留",app.includes("['canvas','⌘','无限画布']"));
check("侧边栏显示开发中标识",app.includes("nav-coming-soon")&&app.includes(`'<em>${truth.badge}</em>'`));
check("点击画布时拦截页面切换",app.includes("if(page==='canvas')return showCanvasComingSoon();state.page=page"));
check("弹窗文案正确",app.includes(truth.dialogTitle)&&app.includes(truth.dialogMessage));
check("弹窗语义与焦点完整",app.includes('role="dialog"')&&app.includes('aria-modal="true"')&&app.includes("canvas-coming-soon-dialog')?.focus()"));
check("支持四种关闭方式",app.includes("querySelectorAll('[data-canvas-coming-soon-close]')")&&app.includes("if(event.key==='Escape')close()")&&app.includes("pm-modal-backdrop"));
check("弹窗样式与无动画偏好",css.includes(".canvas-coming-soon-dialog")&&css.includes(".canvas-coming-soon-badge")&&css.includes("prefers-reduced-motion:reduce"));
check("画布实现仍保留",truth.preserveCanvasImplementation&&index.includes('src="./infinite-canvas.js"')&&canvas.includes("renderCanvasModule"));
try{new vm.Script(app,{filename:"src/renderer/app.js"});check("app.js 语法",true)}catch(error){check("app.js 语法",false,error.message)}

const failed=checks.filter(item=>!item.ok);
const report={test:truth.feature,timestamp:new Date().toISOString(),groundTruth:truth,total:checks.length,passed:checks.length-failed.length,failed:failed.length,checks};
const logDir=path.join(root,"scripts","log");fs.mkdirSync(logDir,{recursive:true});fs.writeFileSync(path.join(logDir,"canvas-coming-soon.json"),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));if(failed.length)process.exitCode=1;
