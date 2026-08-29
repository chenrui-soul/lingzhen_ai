"use strict";
const fs=require("fs"),path=require("path"),vm=require("vm");
const root=path.resolve(__dirname,"..");
const truth=JSON.parse(fs.readFileSync(path.join(root,"references","account-groups-ground-truth.json"),"utf8"));
const read=f=>fs.readFileSync(path.join(root,f),"utf8");
const checks=[];const check=(name,value,detail)=>checks.push({name,ok:Boolean(value),...(detail?{detail}: {})});
const source=read("src/renderer/account-store.js");
check("租户级分组键",source.includes("lingframe.${type}.${tenantId}")&&source.includes("doubaoGroups"));
check("全部与自定义分组筛选",source.includes("accountsForGroup")&&source.includes("group.accountIds.includes(item.id)"));
check("分组事件",source.includes("lingframe:account-groups-changed"));
for(const file of ["src/renderer/account-store.js","src/renderer/app-fixes.js","src/renderer/generation-fixes.js","src/renderer/desktop-ui.js"]){try{new vm.Script(read(file),{filename:file});check(`语法 ${file}`,true)}catch(error){check(`语法 ${file}`,false,error.message)}}
const storage={
  "lingframe.doubaoAccounts.tenant-A":JSON.stringify([{id:"custom-1",name:"短剧账号"}]),
  "lingframe.doubaoProfiles.tenant-A":JSON.stringify({"custom-1":{name:"主账号备注",avatar:"data:image/png;base64,abc"}}),
  "lingframe.doubaoAccounts.tenant-B":JSON.stringify([{id:"foreign-1",name:"其他租户账号"}])
};
const context={
  window:{lingframe:{identity:{status:async()=>({tenantId:"tenant-A"})},doubaoAccounts:{bootstrap:async()=>({tenantId:"tenant-A",accounts:[{id:"custom-1",name:"短剧账号"},{id:"custom-2",name:"分镜账号"}]})}}},
  localStorage:{getItem:key=>storage[key]??null,setItem:(key,value)=>{storage[key]=String(value)}},
  CustomEvent:function(type,init){this.type=type;this.detail=init?.detail},
  setTimeout,clearTimeout,console
};
context.window.window=context.window;context.window.dispatchEvent=()=>{};
vm.createContext(context);vm.runInContext(source,context,{filename:"account-store.js"});
(async()=>{
  await context.window.lingframeAccountStore.ready;
  const list=context.window.lingframeAccountStore.accounts();
  check("账号合并备注名",list.some(item=>item.id==="custom-1"&&item.name==="主账号备注"));
  check("自定义账号可见",list.some(item=>item.id==="custom-1"));
  check("其他租户账号不可见",!list.some(item=>item.id==="foreign-1"));
  const next={version:1,selectedGroupId:"group-short",groups:[{id:"group-short",name:"短剧组",accountIds:["custom-1","custom-2"]}]};
  context.window.lingframeAccountStore.saveGroups(next);
  const filtered=context.window.lingframeAccountStore.accountsForGroup("group-short");
  check("按分组返回账号",filtered.length===2&&filtered.every(item=>["custom-1","custom-2"].includes(item.id)));
  check("租户数据不落到local",storage["lingframe.doubaoGroups.local"]===undefined);
  const failed=checks.filter(item=>!item.ok);const result={groundTruth:truth,total:checks.length,passed:checks.length-failed.length,failed:failed.length,checks};
  const logDir=path.join(root,"scripts","log");fs.mkdirSync(logDir,{recursive:true});fs.writeFileSync(path.join(logDir,"account-groups.json"),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));if(failed.length)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1});
