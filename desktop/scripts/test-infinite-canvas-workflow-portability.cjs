"use strict";
const fs=require("fs");const path=require("path");
const root=path.resolve(__dirname,"..");
const core=require(path.join(root,"src/renderer/canvas-flow-core.js"));
const portability=require(path.join(root,"src/renderer/canvas-workflow-portability.js"));
const renderer=fs.readFileSync(path.join(root,"src/renderer/infinite-canvas.js"),"utf8");
const index=fs.readFileSync(path.join(root,"src/renderer/index.html"),"utf8");
const results=[];const check=(name,condition,detail="")=>results.push({name,passed:Boolean(condition),detail:condition?"":detail});
const document={schemaVersion:3,viewport:{x:80,y:80,zoom:1},nodes:[
  {id:"n1",position:{x:10,y:20},data:{kind:"text",title:"输入",instruction:"业务提示",status:"completed",output:{content:"不应导出运行结果"},refs:{assetIds:["asset-1"],assetRoles:{"asset-1":"人物"},jobIds:["task-1"],conversationIds:["conv-1"]},route:{channel:"model-gateway",providerId:"provider-1",modelId:"model-1",accountId:"account-1",accountName:"账号"}}},
  {id:"n2",position:{x:300,y:20},data:{kind:"image-generation",title:"生成",instruction:"生成图像",refs:{assetIds:["asset-2"],assetRoles:{"asset-2":"首帧"}}}}
],edges:[{id:"e1",source:"n1",target:"n2",data:{order:0,enabled:true}}]};
const payload=portability.exportWorkflow(document,{selectedIds:["n1","n2"],mode:"blank",title:"测试流程",tenantId:"tenant-a"});
check("导出格式和版本正确",payload.format===portability.FORMAT&&payload.schemaVersion===4);
check("选中节点和内部连线导出",payload.nodes.length===2&&payload.edges.length===1);
check("导出重映射节点和连线 ID",payload.nodes[0].id!=="n1"&&payload.edges[0].id!=="e1"&&payload.edges[0].source===payload.nodes[0].id);
check("导出清除运行结果和任务会话",!JSON.stringify(payload).includes("不应导出运行结果")&&payload.nodes.every(node=>!(node.data.refs.jobIds||[]).length&&!(node.data.refs.conversationIds||[]).length));
check("导出不携带账号密钥或 Profile",!JSON.stringify(payload).match(/api.?key|cookie|profile|密码|secret/ig));
check("环境引用单独记录",payload.metadata.environmentRefs.tasks.includes("task-1")&&payload.metadata.environmentRefs.conversations.includes("conv-1")&&payload.metadata.environmentRefs.models.length===1);
const imported=portability.importWorkflow(payload,{tenantId:"tenant-b",availableAssetIds:["asset-1"]});
const importedValidation=core.validateDocument(imported.document);
check("导入重建节点并通过 DAG 校验",imported.document.nodes.length===2&&imported.document.edges.length===1&&importedValidation.ok,importedValidation.errors.join("；"));
check("导入清除跨环境运行绑定",imported.document.nodes.every(node=>!(node.data.refs.jobIds||[]).length&&!(node.data.refs.conversationIds||[]).length));
check("缺失素材标记待重新绑定",imported.missingAssetIds.includes("asset-2")&&imported.document.nodes.some(node=>node.data.portability?.pendingAssetBindings?.includes("asset-2")));
let rejected=false;try{portability.importWorkflow({...payload,metadata:{...payload.metadata,tenantId:"tenant-x"}},{tenantId:"tenant-b"});}catch{rejected=true;}
check("租户边界不一致时拒绝导入",rejected);
check("画布提供导入导出操作",renderer.includes("data-lfc-export-workflow")&&renderer.includes("data-lfc-import-workflow")&&renderer.includes("portability.importWorkflow"));
check("画布入口加载可移植模块",index.includes("canvas-workflow-portability.js")&&index.indexOf("canvas-workflow-portability.js")<index.indexOf("infinite-canvas.js"));
check("导入缺失素材不自动生成",renderer.includes("待重新绑定")&&!/importWorkflow[\s\S]{0,1000}generation\.create/.test(renderer));
const failed=results.filter(item=>!item.passed);const output={test:"infinite-canvas-workflow-portability",at:new Date().toISOString(),total:results.length,passed:results.length-failed.length,failed:failed.length,results};
const logDir=path.join(root,"scripts","log");fs.mkdirSync(logDir,{recursive:true});fs.writeFileSync(path.join(logDir,"infinite-canvas-workflow-portability.json"),JSON.stringify(output,null,2),"utf8");console.log(JSON.stringify(output,null,2));if(failed.length)process.exitCode=1;
