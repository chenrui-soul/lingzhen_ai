"use strict";
const fs=require("fs");
const path=require("path");
const root=path.resolve(__dirname,"..");
const renderer=fs.readFileSync(path.join(root,"src/renderer/infinite-canvas.js"),"utf8");
const adapter=require(path.join(root,"src/renderer/canvas-input-adapter.js"));
const results=[];
const check=(name,condition,detail="")=>results.push({name,passed:Boolean(condition),detail:condition?"":detail});

const nodes=[
  {id:"source",data:{kind:"text",title:"剧情",instruction:"镜头从左向右推进",status:"completed",output:{content:"一只红色气球飞过城市",taskId:"job-source"},refs:{assetIds:[],jobIds:["job-source"]}}},
  {id:"target",data:{kind:"image",title:"画面",instruction:"电影感，16:9",refs:{assetIds:["asset-local"],assetRoles:{"asset-local":"首帧"}}}}
];
const edges=[{id:"edge",source:"source",target:"target",data:{order:0,enabled:true,transferMode:"auto",role:"场景"}}];
const envelope=adapter.resolveExecutionEnvelope("target",nodes,edges);
check("画布只有一个 generation.create 提交点",(renderer.match(/api\.generation\.create\s*\(/g)||[]).length===1);
check("统一提交点使用执行信封",renderer.includes("buildGenerationEnvelope")&&renderer.includes("const request=buildGenerationEnvelope")&&renderer.includes("api.generation.create(request)"));
check("信封携带画布与节点绑定",(renderer.includes("canvasId:runtime.activeId")||(renderer.includes("canvasId = runtime.activeId")&&/canvasId,\s*\n\s*canvasNodeId:node\.id/.test(renderer)))&&renderer.includes("canvasNodeId:node.id"));
check("信封携带输入证据和参考素材",renderer.includes("inputManifest:input.inputManifest")&&renderer.includes("referenceAssets"));
check("Composer将直接上游提示词一次性写入输入草稿",renderer.includes("ensureNodeInputDraft")&&renderer.includes("node.data.inputDraft?.active")&&renderer.includes("data-lfc-composer-prompt"));
check("Composer显示直接上游参考素材",renderer.includes("resolvedInput.assetIds")&&renderer.includes("localAssetIds.has"));
check("Composer修改只更新输入草稿且不覆盖节点基础指令",renderer.includes("patchComposerBindings")&&renderer.includes("node.data.inputDraft.prompt=value")&&!renderer.includes("node.data.instruction=value;node.data.updatedAt=now();markDirty();renderCanvasModule();"));
check("输入证据不拼入提示词",!envelope.prompt.includes("job-source")&&!envelope.prompt.includes("completed")&&envelope.prompt.includes("一只红色气球飞过城市"));
check("提示词保留业务指令和上游文本",envelope.prompt.includes("电影感，16:9")&&envelope.prompt.includes("一只红色气球飞过城市"));
check("素材顺序和角色进入参考素材",envelope.inputManifest.some(item=>item.assetId==="asset-local"&&item.role==="首帧"));
check("本地执行快照保留信封",renderer.includes("node.data.executionEnvelope")&&renderer.includes("markDirty();"));
check("当前节点和整套流程共用 executeNode",(renderer.match(/executeNode\(node(?:,canvasId)?\)/g)||[]).length>=2);
check("画布不直接写任务中心",!/api\.tasks\.(create|report|complete|retry|cancel)/.test(renderer));
check("平移工具支持左键拖动画布",renderer.includes('event.button===0&&runtime.toolMode==="pan"')&&renderer.includes("runtime.panDrag"));
check("按住修饰键仍可框选节点",renderer.includes("runtime.marquee={startX:event.clientX,startY:event.clientY,additive}"));

const failed=results.filter(item=>!item.passed);
const output={test:"infinite-canvas-execution-envelope",at:new Date().toISOString(),total:results.length,passed:results.length-failed.length,failed:failed.length,results};
const logDir=path.join(root,"scripts","log");fs.mkdirSync(logDir,{recursive:true});fs.writeFileSync(path.join(logDir,"infinite-canvas-execution-envelope.json"),JSON.stringify(output,null,2),"utf8");
console.log(JSON.stringify(output,null,2));
if(failed.length)process.exitCode=1;
