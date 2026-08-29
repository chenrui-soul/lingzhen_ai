"use strict";
const fs=require("fs");const path=require("path");const core=require("../src/renderer/text-research-core.js");
const truth=JSON.parse(fs.readFileSync(path.join(__dirname,"..","references","text-research-batch-d-ground-truth.json"),"utf8"));
const checks=[];const check=(name,ok,detail)=>checks.push({name,ok:Boolean(ok),...(detail===undefined?{}:{detail})});
const source=(assetId="asset-a",excerpt="明确摘录",start=10)=>core.sanitizeSource({assetId,projectId:"project-a",name:`来源 ${assetId}`,sourceLocation:`https://example.com/${assetId}`,excerpt,excerptStart:start,excerptEnd:start+excerpt.length});

check("批次 D 版本和存储前缀",core.VERSION===truth.version&&core.STORAGE_PREFIX===truth.storagePrefix);
check("五种资料研究动作完整",JSON.stringify(Object.keys(core.ACTIONS))===JSON.stringify(truth.actions),Object.keys(core.ACTIONS));
check("摘录和上下文上限固定",core.MAX_SOURCES===truth.maximumSources&&core.MAX_EXCERPT_CHARS===truth.maximumExcerptChars&&core.MAX_CONTEXT_CHARS===truth.maximumContextChars);

const sanitized=source("asset-a","  需要引用的句子  ",4);
check("来源保留素材、位置和范围证据",sanitized.assetId==="asset-a"&&sanitized.projectId==="project-a"&&sanitized.sourceLocation.includes("asset-a")&&sanitized.excerpt==="需要引用的句子"&&sanitized.excerptStart===4&&Boolean(sanitized.fingerprint),sanitized);
check("空摘录不会进入上下文",core.normalizeSources([{assetId:"asset-a",projectId:"project-a",excerpt:""}]).length===0);

const duplicate=source("asset-a","同一摘录",0);const normalized=core.normalizeSources([duplicate,duplicate,...Array.from({length:10},(_,index)=>source(`asset-${index}`,`摘录 ${index}`,index))]);
check("重复来源去重且数量受限",normalized.length===core.MAX_SOURCES&&normalized.filter(item=>item.assetId==="asset-a").length===1,normalized.map(item=>item.assetId));

const discover=core.validateResearch({action:"discover",query:"需要查找哪些行业资料",sources:[]});
check("资料查找允许零来源但必须有问题",discover.ok&&!core.validateResearch({action:"discover",query:"",sources:[]}).ok,discover);
check("摘要必须选择来源",!core.validateResearch({action:"summary",query:"整理摘要",sources:[]}).ok&&core.validateResearch({action:"summary",query:"整理摘要",sources:[source()]}).ok);
check("对比分析要求两个不同素材",!core.validateResearch({action:"compare",query:"比较",sources:[source("asset-a"),source("asset-a","另一个片段",30)]}).ok&&core.validateResearch({action:"compare",query:"比较",sources:[source("asset-a"),source("asset-b")]}).ok);

const oversized=[source("asset-a","甲".repeat(4000)),source("asset-b","乙".repeat(4000)),source("asset-c","丙".repeat(2000))];
check("超过上下文上限会被拒绝",!core.validateResearch({action:"summary",query:"整理",sources:oversized}).ok,core.contextSize(oversized));

const prompt=core.buildPrompt({action:"compare",query:"比较两份资料",sources:[source("asset-a","观点甲",12),source("asset-b","观点乙",32)]});
check("提示词包含来源编号、位置和摘录范围",prompt.includes("[S1]")&&prompt.includes("[S2]")&&prompt.includes("https://example.com/asset-a")&&prompt.includes("摘录范围：12-15")&&prompt.includes("只能依据"),prompt);
const discoverPrompt=core.buildPrompt({action:"discover",query:"生成检索计划",sources:[]});
check("无来源查找不会伪装联网结果",discoverPrompt.includes("不得编造检索结果")&&discoverPrompt.includes("没有提供来源摘录"),discoverPrompt);

const envelope=core.buildEnvelope({projectId:"project-a",conversationId:"conversation-a",documentTitle:"文档",action:"summary",query:"摘要",sources:[source()],providerId:"provider-a",modelId:"model-a",modelParameters:{temperature:.2},prompt:"prompt"});envelope.taskId="task-a";
check("执行信封绑定原项目文档来源和请求标识",envelope.projectId==="project-a"&&envelope.conversationId==="conversation-a"&&envelope.documentId==="conversation-a"&&envelope.sourceAssetIds[0]==="asset-a"&&envelope.contextChars===4&&Boolean(envelope.clientRequestId),envelope);
check("结果路由拒绝跨项目或错误来源",core.validRoute({id:"task-a",projectId:"project-a",creationType:"text",creationSource:"text-workspace-research"},envelope)&&!core.validRoute({id:"task-a",projectId:"project-b",creationType:"text",creationSource:"text-workspace-research"},envelope)&&!core.validRoute({id:"task-a",projectId:"project-a",creationType:"text",creationSource:"text-workspace-ai"},envelope));

const first={taskId:"task-a",resultId:"task-a",clientRequestId:"request-a",content:"旧结果",savedAssetId:"asset-result",updatedAt:"2026-08-17T00:00:00Z"};const merged=core.mergeResults([first],[{taskId:"task-a",resultId:"task-a",clientRequestId:"request-a",content:"新结果",updatedAt:"2026-08-17T01:00:00Z"}]);
check("重复结果幂等合并并保留处理状态",merged.length===1&&merged[0].content==="新结果"&&merged[0].savedAssetId==="asset-result",merged);

const failed=checks.filter(item=>!item.ok);const report={test:"text-research-core",total:checks.length,passed:checks.length-failed.length,failed:failed.length,checks};console.log(JSON.stringify(report,null,2));if(failed.length)process.exitCode=1;
