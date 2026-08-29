"use strict";
const fs=require("fs");
const path=require("path");
const root=path.resolve(__dirname,"..");
const renderer=fs.readFileSync(path.join(root,"src/renderer/infinite-canvas.js"),"utf8");
const results=[];
const check=(name,condition,detail="")=>results.push({name,passed:Boolean(condition),detail:condition?"":detail});

check("结果回填先校验任务与节点绑定",renderer.includes("function validateTaskBinding")&&renderer.includes("validateTaskBinding(task,node"));
check("结果回填校验项目一致",renderer.includes("任务项目与画布项目不一致"));
check("结果回填校验画布和节点一致",renderer.includes("任务节点绑定不一致")&&renderer.includes("任务画布绑定不一致"));
check("结果回填校验会话与账号一致",renderer.includes("任务会话证据不一致")&&renderer.includes("任务账号与画布账号不一致"));
check("结果素材必须属于当前项目",renderer.includes("结果素材不存在或不属于当前画布项目"));
check("文本结果必须恢复原会话",renderer.includes("文本结果会话尚未恢复"));
check("恢复模式明确为只下载不重生成",renderer.includes('recoveryMode:"download-only"'));
check("提交未知状态保持暂停",renderer.includes("submission_unknown")&&renderer.includes("不会自动重提"));
check("完成任务按已有任务 ID 恢复节点绑定",renderer.includes("findNodeForTask")&&renderer.includes("refs?.jobIds"));
check("结果同步不调用 generation.create",(renderer.match(/api\.generation\.create\s*\(/g)||[]).length===1&&renderer.includes("syncCompletedTask"));
check("结果恢复失败不会重新生成",!/(syncCompletedTask|resolveTaskOutput)[\s\S]{0,300}api\.generation\.create/.test(renderer));
check("结果回填保留 task/account/conversation/provider/model",renderer.includes("taskId:task.id")&&renderer.includes("accountId:task.accountId")&&renderer.includes("providerId:task.providerId")&&renderer.includes("modelId:task.modelId"));

const failed=results.filter(item=>!item.passed);
const output={test:"infinite-canvas-result-recovery",at:new Date().toISOString(),total:results.length,passed:results.length-failed.length,failed:failed.length,results};
const logDir=path.join(root,"scripts","log");fs.mkdirSync(logDir,{recursive:true});fs.writeFileSync(path.join(logDir,"infinite-canvas-result-recovery.json"),JSON.stringify(output,null,2),"utf8");
console.log(JSON.stringify(output,null,2));
if(failed.length)process.exitCode=1;
