"use strict";

const fs=require("fs");
const path=require("path");
const {BrowserController}=require("../src/main/browser-controller.cjs");

const port=Number(process.argv[2]||9333),files=process.argv.slice(3).map(value=>path.resolve(value));
if(!files.length)throw new Error("至少需要一张参考图");
for(const file of files)if(!fs.existsSync(file))throw new Error(`参考图不存在：${file}`);
const account={id:"desktop-1",name:"白同学",platform:"豆包"};
const controller=new BrowserController({profileRootProvider:()=>path.join(__dirname,"../.smoke-profile"),testMode:false});
const session={account,embedded:false,port,profile:"existing-electron-target",captures:[],captureSeq:0,consumedCaptures:new Set(),submissionRequests:[],assetUploadRequests:[],pendingAssetUpload:null,pendingSubmission:null,currentJobId:"reference-upload-smoke",conversationId:"",cdp:null,phase:"idle",testMode:false};
const assets=files.map((file,index)=>({id:`smoke-${index+1}`,name:["人物参考图","场景参考图","道具参考图"][index]||`参考图${index+1}`,originalName:path.basename(file),type:"image",mime:"image/png",size:fs.statSync(file).size,path:file}));

(async()=>{
  let evidence,errorText="";
  try{
    await controller.prepareFreshConversation(session,account);
    await controller.ensureVideoMode(session);
    await controller.setVideoParameters(session,{doubaoModel:"Seedance 2.0 Mini",ratio:"16:9",duration:"10s"});
    await controller.waitForComposer(session,12000);
    evidence=await controller.uploadReferenceImages(session,{imageAssets:assets});
  }catch(error){errorText=String(error.stack||error);throw error;}
  finally{
    try{await controller.prepareFreshConversation(session,account);}catch{}
    try{session.cdp?.close();}catch{}
    const logDir=path.join(__dirname,"log");fs.mkdirSync(logDir,{recursive:true});
    fs.writeFileSync(path.join(logDir,"doubao-reference-upload-no-submit-smoke.json"),JSON.stringify({port,files,evidence,error:errorText,submitted:false,completedAt:new Date().toISOString()},null,2)+"\n","utf8");
  }
  console.log(`DOUBAO_REFERENCE_UPLOAD_NO_SUBMIT ${evidence.uploadedCount}/${evidence.requestedCount}`);
})().catch(error=>{console.error(error);process.exit(1)});
