"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.resolve(__dirname, "..");
const truthPath = path.join(root, "references", "submission-evidence-ground-truth.json");
const generatedTruth = {prompt:"PROMPT",networkHost:"www.doubao.com",minimumEvidenceWaitMs:10000,cases:[]};
if (!fs.existsSync(truthPath)) fs.writeFileSync(truthPath, JSON.stringify(generatedTruth, null, 2));
const truth = JSON.parse(fs.readFileSync(truthPath, "utf8"));
const source = fs.readFileSync(path.join(root, "src", "main", "browser-controller.cjs"), "utf8");
const {BrowserController, classifySubmissionEvidence} = require(path.join(root, "src", "main", "browser-controller.cjs"));
const checks = [];
const check = (name, ok, detail = null) => checks.push({name, ok:Boolean(ok), detail});

for (const item of truth.cases) {
  const actual = classifySubmissionEvidence({prompt:truth.prompt,beforeConversationId:item.beforeConversationId,after:item.after,request:item.request});
  check(item.name, actual.confirmed === item.confirmed && actual.evidenceType === item.evidenceType, {expected:{confirmed:item.confirmed,evidenceType:item.evidenceType},actual});
}

const controller = new BrowserController({profileRootProvider:()=>root,downloadRootProvider:()=>root,testMode:true});
const session = {phase:"submitting",pendingSubmission:{jobId:"job-1",prompt:"PROMPT unique token"},submissionRequests:[]};
controller.recordSubmissionRequest(session,{requestId:"request-1",request:{method:"POST",url:`https://${truth.networkHost}/samantha/chat/completion`,postData:'{"prompt":"PROMPT unique token"}'}});
check("matching generic Doubao chat request is audit only", session.submissionRequests.length === 1 && session.submissionRequests[0].promptMatched === true && session.submissionRequests[0].videoGenerationRequest === false, session.submissionRequests);
controller.recordSubmissionRequest(session,{requestId:"analytics-1",request:{method:"POST",url:`https://${truth.networkHost}/api/log`,postData:'{"prompt":"PROMPT unique token"}'}});
check("analytics request is ignored", session.submissionRequests.length === 1, session.submissionRequests);
controller.recordSubmissionRequest(session,{requestId:"request-2",request:{method:"POST",url:`https://${truth.networkHost}/samantha/chat/completion`,postData:'{"prompt":"different"}'}});
check("unmatched endpoint is retained only as non-confirming audit", session.submissionRequests.length === 2 && session.submissionRequests[1].promptMatched === false, session.submissionRequests[1]);
controller.recordSubmissionRequest(session,{requestId:"video-1",request:{method:"POST",url:`https://${truth.networkHost}/api/video/generate`,postData:'{"prompt":"PROMPT unique token","model":"seedance"}'}});
check("matching video generation request is strong evidence", session.submissionRequests.length === 3 && session.submissionRequests[2].videoGenerationRequest === true, session.submissionRequests[2]);

check("whole-page generating text is no longer submission evidence", !source.includes("generating:/(正在生成|生成中|排队中|已提交)/i.test(text)"));
check("current conversation message scope is inspected", source.includes("[class*=\"message-list\"],[class*=\"message-container\"],[data-testid*=\"message-list\"]") && source.includes("userMessageId") && source.includes("recovery-current-conversation-text") && source.includes("promptPresentInCurrentConversation"));
check("network submission listener is registered", source.includes('Network.requestWillBeSent') && source.includes("recordSubmissionRequest"));
check("new conversation id alone is not accepted", !source.includes('"new-conversation-id"'));
check("generic chat request is not accepted as video submission", source.includes("videoGenerationRequest") && source.includes("videoEndpointMatched"));
const executeGenerateStart=source.indexOf('if (command.action === "generate") {',source.indexOf("async execute(command)"));
const executeMonitorStart=source.indexOf('if (command.action === "monitor") {',executeGenerateStart);
const initialExecuteBranch=executeGenerateStart>=0&&executeMonitorStart>executeGenerateStart?source.slice(executeGenerateStart,executeMonitorStart):"";
check("initial execute does not wait for completed video", initialExecuteBranch.includes("this.runGeneration(command)") && !initialExecuteBranch.includes("waitForVideo"));
const deadlineMatch = source.match(/let evidenceDeadline = Date\.now\(\) \+ (\d+)/);
check("evidence wait window allows asynchronous conversation creation", Number(deadlineMatch?.[1] || 0) >= truth.minimumEvidenceWaitMs, deadlineMatch?.[1]);
try { new vm.Script(source, {filename:"browser-controller.cjs"}); check("browser controller syntax", true); } catch (error) { check("browser controller syntax", false, error.message); }

const failed = checks.filter(item => !item.ok);
const report = {test:"submission-evidence",timestamp:new Date().toISOString(),groundTruth:truthPath,total:checks.length,passed:checks.length-failed.length,failed:failed.length,checks};
const logDir = path.join(root, "scripts", "log"); fs.mkdirSync(logDir, {recursive:true});
fs.writeFileSync(path.join(logDir, "submission-evidence.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (failed.length) process.exit(1);
