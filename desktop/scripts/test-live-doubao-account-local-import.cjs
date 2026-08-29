'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const endpoint = process.argv[2] || 'http://127.0.0.1:9223';
const root = path.resolve(__dirname, '..');

async function connect() {
  const targets=await fetch(`${endpoint}/json`).then(response=>response.json());const target=targets.find(item=>item.type==='page'&&item.url.includes('/src/renderer/index.html'));if(!target?.webSocketDebuggerUrl)throw new Error('未找到灵帧AI客户端调试页面');
  const socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})});
  let sequence=0;const pending=new Map();socket.addEventListener('message',event=>{const message=JSON.parse(String(event.data));if(!message.id||!pending.has(message.id))return;const request=pending.get(message.id);pending.delete(message.id);if(message.error)request.reject(new Error(message.error.message));else request.resolve(message.result)});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}))});return{socket,send};
}

(async()=>{
  const {socket,send}=await connect();
  try {
    const expression=`(async()=>{const values=await window.lingframe.doubaoAccounts.discoverLocal();return{values,styles:Boolean(document.querySelector('#doubao-local-import-style')),notice:document.querySelector('#license-notice-title')?.textContent?.trim()||null}})()`;
    const response=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(response.exceptionDetails)throw new Error(response.exceptionDetails.text||'客户端执行失败');const result=response.result.value;
    assert.equal(Array.isArray(result.values),true);assert.equal(result.styles,true);
    for(const item of result.values){assert.deepEqual(Object.keys(item).sort(),['accountId','loginState','name','platform','ref']);assert.equal(item.loginState,'logged_in')}
    const serialized=JSON.stringify(result.values);assert.doesNotMatch(serialized,/sessionid|sid_tt|cookie|partition|tenantId|sourceTenant/i);
    const report={test:'live-doubao-account-local-import',timestamp:new Date().toISOString(),passed:true,candidateCount:result.values.length,licenseNotice:result.notice,fields:['ref','accountId','name','platform','loginState']};
    fs.writeFileSync(path.join(root,'scripts','log','live-doubao-account-local-import.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  } finally { socket.close(); }
})().catch(error=>{const report={test:'live-doubao-account-local-import',timestamp:new Date().toISOString(),passed:false,error:String(error.stack||error)};fs.mkdirSync(path.join(root,'scripts','log'),{recursive:true});fs.writeFileSync(path.join(root,'scripts','log','live-doubao-account-local-import.json'),JSON.stringify(report,null,2));console.error(JSON.stringify(report,null,2));process.exit(1)});
