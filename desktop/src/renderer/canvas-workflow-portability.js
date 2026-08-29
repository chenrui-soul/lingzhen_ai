(function workflowPortabilityFactory(root,factory){
  const api=factory(root?.LingframeCanvasCore||null);
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
  if(root)root.LingframeCanvasWorkflowPortability=api;
})(typeof window!=="undefined"?window:globalThis,function(core){
  "use strict";
  const FORMAT="lingframe-infinite-canvas-workflow",SCHEMA_VERSION=4;
  const clone=value=>core?.clone?core.clone(value):JSON.parse(JSON.stringify(value??null));
  const id=(prefix)=>core?.makeId?core.makeId(prefix):`${prefix}-${Math.random().toString(36).slice(2)}`;
  const runtimeKeys=new Set(["status","progress","runError","updatedAt","output","results","activeResultId","lastInputFingerprint","taskId","executionEnvelope"]);
  const routeKeys=new Set(["accountId","accountName","accountCandidates","accountGroupId","providerId","modelId"]);
  function cleanData(data={}){
    const next=clone(data||{});for(const key of runtimeKeys)delete next[key];
    next.status="idle";next.progress=0;next.runError="";next.refs=next.refs&&typeof next.refs==="object"?next.refs:{};
    next.refs.assetIds=Array.isArray(next.refs.assetIds)?[...new Set(next.refs.assetIds.map(String))]:[];
    next.refs.assetRoles=next.refs.assetRoles&&typeof next.refs.assetRoles==="object"?clone(next.refs.assetRoles):{};
    next.refs.jobIds=[];next.refs.conversationIds=[];
    if(next.route&&typeof next.route==="object"){next.route=clone(next.route);for(const key of routeKeys)delete next.route[key];next.route.accountSelectionMode="auto";}
    return next;
  }
  function exportWorkflow(document,{selectedIds=[],mode="blank",title="未命名工作流",tenantId=""}={}){
    const source=clone(document||{}),nodes=Array.isArray(source.nodes)?source.nodes:[],selected=new Set((selectedIds||[]).map(String));
    const chosen=selected.size?nodes.filter(node=>selected.has(String(node.id))):nodes;
    const chosenIds=new Set(chosen.map(node=>String(node.id)));
    const nodeIdMap=new Map(chosen.map(node=>[String(node.id),id("node")]));
    const assetBindings=[],environmentRefs={accounts:[],models:[],tasks:[],conversations:[]};
    const exportedNodes=chosen.map(node=>{const data=cleanData(node.data);for(const assetId of data.refs.assetIds){assetBindings.push({assetId:String(assetId),nodeId:nodeIdMap.get(String(node.id)),role:data.refs.assetRoles?.[assetId]||"",status:"needs-rebind"});}if(node.data?.route?.accountId)environmentRefs.accounts.push(String(node.data.route.accountId));if(node.data?.route?.providerId||node.data?.route?.modelId)environmentRefs.models.push({providerId:String(node.data.route.providerId||""),modelId:String(node.data.route.modelId||"")});for(const taskId of node.data?.refs?.jobIds||[])environmentRefs.tasks.push(String(taskId));for(const conversationId of node.data?.refs?.conversationIds||[])environmentRefs.conversations.push(String(conversationId));return{...node,id:nodeIdMap.get(String(node.id)),data};});
    const exportedEdges=(source.edges||[]).filter(edge=>chosenIds.has(String(edge.source))&&chosenIds.has(String(edge.target))).map(edge=>({...clone(edge),id:id("edge"),source:nodeIdMap.get(String(edge.source)),target:nodeIdMap.get(String(edge.target))}));
    return{format:FORMAT,schemaVersion:SCHEMA_VERSION,mode,title:String(title||"未命名工作流").slice(0,120),nodes:exportedNodes,edges:exportedEdges,assetBindings,metadata:{exportedAt:new Date().toISOString(),selection:selected.size?"selected":"all",tenantBoundary:"portable",environmentRefs:{accounts:[...new Set(environmentRefs.accounts)],models:environmentRefs.models.filter((item,index,list)=>list.findIndex(other=>other.providerId===item.providerId&&other.modelId===item.modelId)===index),tasks:[...new Set(environmentRefs.tasks)],conversations:[...new Set(environmentRefs.conversations)]},sourceTenant:tenantId?"redacted":"external"}};
  }
  function importWorkflow(payload,{tenantId="",availableAssetIds=[],newId=id}={}){
    if(!payload||payload.format!==FORMAT)throw new Error("工作流格式不受支持");
    if(Number(payload.schemaVersion)>SCHEMA_VERSION)throw new Error("工作流版本高于当前客户端，请先升级");
    if(payload.metadata?.tenantId&&tenantId&&String(payload.metadata.tenantId)!==String(tenantId))throw new Error("工作流租户不一致，禁止导入");
    const sourceNodes=Array.isArray(payload.nodes)?payload.nodes:[],sourceEdges=Array.isArray(payload.edges)?payload.edges:[];if(!sourceNodes.length)throw new Error("工作流没有可导入节点");
    const nodeMap=new Map(sourceNodes.map(node=>[String(node.id),newId("node")]));
    const nodes=sourceNodes.map(source=>{const node=clone(source),data=cleanData(source.data);const missing=[];data.refs.assetIds=(data.refs.assetIds||[]).filter(assetId=>{if(availableAssetIds.length&&availableAssetIds.includes(String(assetId)))return true;missing.push(String(assetId));return false;});if(missing.length)data.portability={...(data.portability||{}),pendingAssetBindings:missing};node.id=nodeMap.get(String(source.id));node.data=data;node.position={x:Number(source.position?.x)||0,y:Number(source.position?.y)||0};return node;});
    const edges=sourceEdges.map(edge=>({...clone(edge),id:newId("edge"),source:nodeMap.get(String(edge.source)),target:nodeMap.get(String(edge.target))})).filter(edge=>edge.source&&edge.target);
    const document=core?.migrateDocument?core.migrateDocument({schemaVersion:SCHEMA_VERSION,nodes,edges,viewport:clone(payload.viewport)||{x:80,y:80,zoom:1},metadata:{...(clone(payload.metadata)||{}),importedAt:new Date().toISOString(),tenantBoundary:"local"}}):{schemaVersion:SCHEMA_VERSION,nodes,edges,viewport:clone(payload.viewport)||{x:80,y:80,zoom:1}};
    const validation=core?.validateDocument?core.validateDocument(document):{ok:true,errors:[]};if(!validation.ok)throw new Error(`导入工作流校验失败：${validation.errors.join("；")}`);
    return{document,assetBindings:(payload.assetBindings||[]).map(item=>({...clone(item),status:(availableAssetIds||[]).includes(String(item.assetId))?"bound":"needs-rebind"})),missingAssetIds:[...new Set(nodes.flatMap(node=>node.data?.portability?.pendingAssetBindings||[]))],environmentRefs:clone(payload.metadata?.environmentRefs||{})};
  }
  return{FORMAT,SCHEMA_VERSION,exportWorkflow,importWorkflow,cleanData};
});
