"use strict";

const fs=require("fs");
const path=require("path");
const {classifyDoubaoFailureMessage}=require("../src/main/browser-controller.cjs");
const root=path.resolve(__dirname,"..");
const groundTruthPath=path.join(root,"references","doubao-multi-task-recovery-ground-truth.json");
const groundTruth=JSON.parse(fs.readFileSync(groundTruthPath,"utf8"));
const results=[];
const check=(name,condition,detail="")=>results.push({name,ok:Boolean(condition),detail:condition?"":String(detail||"验证失败")});
const ui=fs.readFileSync(path.join(root,"src","renderer","generation-ui.js"),"utf8");
const css=fs.readFileSync(path.join(root,"src","renderer","styles","generation-ui.css"),"utf8");
const home=fs.readFileSync(path.join(root,"src","renderer","home-conversations.js"),"utf8");
const canvas=fs.readFileSync(path.join(root,"src","renderer","infinite-canvas.js"),"utf8");
const taskCenter=fs.readFileSync(path.join(root,"src","renderer","task-center.js"),"utf8");
const browser=fs.readFileSync(path.join(root,"src","main","browser-controller.cjs"),"utf8");
const orchestrator=fs.readFileSync(path.join(root,"src","main","generation-orchestrator.cjs"),"utf8");

check("Ground Truth 使用零额度测试",groundTruth.zeroQuota===true);
check("任务坞展示运行/排队/需处理计数",ui.includes("generation-live-running")&&ui.includes("generation-live-queued")&&ui.includes("generation-live-attention"));
check("任务坞默认最多四行并内部滚动",ui.includes("MAX_VISIBLE_LIVE_ROWS = 4")&&css.includes("max-height")&&css.includes("overflow:auto"));
check("任务坞按需处理优先级排序",ui.includes("attentionRank")&&ui.includes("generation-live-priority"));
check("任务坞启动时恢复当前任务",ui.includes("hydrateLiveTasks")&&ui.includes("restoredFromTaskCenter"));
check("生成中不显示百分比",home.includes("progressMode==='indeterminate'")&&canvas.includes("indeterminateTask")&&taskCenter.includes("indeterminateTask"));
check("恢复监控绑定当前会话",browser.includes("expectedConversationId")&&browser.includes("conversationMatches")&&browser.includes("latestUserNode"));
check("恢复监控支持提交后新回复指纹",browser.includes("evidenceFingerprint")&&browser.includes("submittedAt")&&browser.includes("signalNodes"));
check("终止失败统一释放账号",orchestrator.includes("handleProviderTerminalFailure")&&orchestrator.includes("this.releaseAccount(taskId)")&&orchestrator.includes("accountAction"));
for(const item of groundTruth.failureCases){
  const actual=classifyDoubaoFailureMessage(item.text);
  check(`识别失败：${item.code}`,actual.code===item.code&&actual.retryMode===item.retryMode&&actual.terminal===true,JSON.stringify(actual));
  check(`失败释放账号：${item.code}`,actual.accountAction==="release",JSON.stringify(actual));
}
const report={test:groundTruth.test,groundTruth:groundTruthPath,total:results.length,passed:results.filter(x=>x.ok).length,failed:results.filter(x=>!x.ok).length,results,completedAt:new Date().toISOString()};
const logPath=path.join(root,"scripts","log","doubao-multi-task-recovery.json");fs.mkdirSync(path.dirname(logPath),{recursive:true});fs.writeFileSync(logPath,JSON.stringify(report,null,2),"utf8");
console.log(`DOUBAO_MULTI_TASK_RECOVERY ${report.passed}/${report.total}`);
if(report.failed){for(const item of results.filter(x=>!x.ok))console.error(`FAIL ${item.name}: ${item.detail}`);process.exitCode=1;}
