'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {DoubaoLocalAccountImport, partitionFor} = require('../src/main/doubao-local-account-import.cjs');
const {DoubaoAccountRegistry} = require('../src/main/doubao-account-registry.cjs');

const root = path.resolve(__dirname, '..');
const truth = JSON.parse(fs.readFileSync(path.join(root, 'references', 'doubao-account-local-import-ground-truth.json'), 'utf8'));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lingframe-local-account-import-'));
const tenantsRoot = path.join(temp, 'tenants');
let tenantId = 'tenant-B';
const tenantRoot = () => path.join(tenantsRoot, tenantId);
const registry = new DoubaoAccountRegistry({tenantRootProvider:tenantRoot});
const sessions = new Map();

function fakeSession(partition) {
  if (!sessions.has(partition)) {
    const jar = [];
    sessions.set(partition, {
      cookies:{
        get:async({url}) => jar.filter(cookie => String(url).includes(String(cookie.domain || '').replace(/^\./, ''))),
        set:async details => { const index=jar.findIndex(cookie=>cookie.name===details.name&&cookie.domain===details.domain); if(index>=0)jar[index]={...jar[index],...details};else jar.push({...details}); },
        remove:async(_url,name) => { for(let index=jar.length-1;index>=0;index-=1)if(jar[index].name===name)jar.splice(index,1); }
      },
      flushStorageData:async()=>{},
      jar
    });
  }
  return sessions.get(partition);
}

function authCookie(value) { return {name:'sessionid',value,domain:'.doubao.com',path:'/',secure:true,httpOnly:true,sameSite:'lax'}; }
function writeSource(tenant, accounts) {
  const sourceRoot=path.join(tenantsRoot,tenant);
  fs.mkdirSync(path.join(sourceRoot,'database'),{recursive:true});
  fs.mkdirSync(path.join(sourceRoot,'embedded-browser-profiles'),{recursive:true});
  fs.writeFileSync(path.join(sourceRoot,'database','doubao-accounts-v1.json'),JSON.stringify({version:1,tenantId:tenant,accounts}), 'utf8');
  for(const account of accounts)fs.mkdirSync(path.join(sourceRoot,'embedded-browser-profiles',account.id),{recursive:true});
}

let refIndex=0;
function createImporter(accountRegistry=registry) {
  return new DoubaoLocalAccountImport({tenantsRootProvider:()=>tenantsRoot,currentTenantProvider:()=>tenantId,sessionProvider:fakeSession,accountRegistry,refFactory:()=>`candidate-${++refIndex}`});
}
const checks=[];
async function check(name,operation){try{await operation();checks.push({name,ok:true})}catch(error){checks.push({name,ok:false,detail:String(error.stack||error)})}}

(async()=>{
  writeSource('tenant-A',[{id:'account-a',name:'旧工作区账号 A',platform:'豆包'},{id:'account-empty',name:'已退出账号',platform:'豆包'}]);
  registry.bootstrap();
  fakeSession(partitionFor('tenant-A','account-a')).jar.push(authCookie('source-secret'));
  const importer=createImporter();

  await check('只发现有效豆包登录环境且不泄露内部资料',async()=>{
    const values=await importer.discover();
    assert.deepEqual(values.map(item=>({accountId:item.accountId,name:item.name,loginState:item.loginState})),[{accountId:'account-a',name:'旧工作区账号 A',loginState:'logged_in'}]);
    const serialized=JSON.stringify(values);
    assert.doesNotMatch(serialized,/source-secret|tenant-A|partition|cookie/i);
  });

  await check('用户确认后复制登录状态并写入新租户注册表',async()=>{
    const candidate=(await importer.discover())[0];
    const result=await importer.importCandidate(candidate.ref);
    assert.equal(result.status,'imported');
    assert.equal(registry.resolve('account-a').name,'旧工作区账号 A');
    assert.equal(fakeSession(partitionFor('tenant-B','account-a')).jar.some(cookie=>cookie.value==='source-secret'),true);
    assert.equal(fakeSession(partitionFor('tenant-A','account-a')).jar.some(cookie=>cookie.value==='source-secret'),true);
  });

  await check('当前租户已有账号不会重复显示或导入',async()=>{
    assert.deepEqual(await importer.discover(),[]);
  });

  await check('伪造或过期候选引用会被拒绝',async()=>{
    await assert.rejects(()=>importer.importCandidate('forged-ref'),error=>error.code===truth.errorCodes.expiredCandidate);
  });

  await check('源登录在确认前失效时不产生半成品账号',async()=>{
    tenantId='tenant-C';
    const registryC=new DoubaoAccountRegistry({tenantRootProvider:tenantRoot});registryC.bootstrap();
    fakeSession(partitionFor('tenant-A','account-a')).jar.splice(0,1,authCookie('temporary-secret'));
    const importerC=createImporter(registryC);const candidate=(await importerC.discover())[0];
    fakeSession(partitionFor('tenant-A','account-a')).jar.length=0;
    fakeSession(partitionFor('tenant-B','account-a')).jar.length=0;
    await assert.rejects(()=>importerC.importCandidate(candidate.ref),error=>error.code===truth.errorCodes.expiredLogin);
    assert.equal(registryC.resolve('account-a'),null);
    assert.equal(fs.existsSync(path.join(tenantRoot(),'embedded-browser-profiles','account-a')),false);
  });

  await check('Cookie 写入中途失败时回滚新租户',async()=>{
    tenantId='tenant-D';
    const registryD=new DoubaoAccountRegistry({tenantRootProvider:tenantRoot});registryD.bootstrap();
    const source=fakeSession(partitionFor('tenant-A','account-a'));source.jar.push(authCookie('rollback-secret'),{name:'sid_tt',value:'rollback-secret-2',domain:'.doubao.com',path:'/',secure:true,httpOnly:true});
    const importerD=createImporter(registryD);const candidate=(await importerD.discover())[0];
    const target=fakeSession(partitionFor('tenant-D','account-a'));const originalSet=target.cookies.set;let writes=0;
    target.cookies.set=async details=>{writes+=1;if(writes===2)throw new Error('注入的 Cookie 写入失败');return originalSet(details)};
    await assert.rejects(()=>importerD.importCandidate(candidate.ref),/Cookie 写入失败/);
    assert.equal(registryD.resolve('account-a'),null);
    assert.deepEqual(target.jar,[]);
    assert.equal(source.jar.length,2);
    assert.equal(fs.existsSync(path.join(tenantRoot(),'embedded-browser-profiles','account-a')),false);
  });

  await check('发现后如果秘钥再次变更则候选立即失效',async()=>{
    tenantId='tenant-E';registry.bootstrap();
    const source=fakeSession(partitionFor('tenant-A','account-a'));source.jar.splice(0,source.jar.length,authCookie('tenant-change-secret'));
    const importerE=createImporter();const candidate=(await importerE.discover())[0];
    tenantId='tenant-F';registry.bootstrap();
    await assert.rejects(()=>importerE.importCandidate(candidate.ref),error=>error.code===truth.errorCodes.expiredCandidate);
    assert.equal(registry.resolve('account-a'),null);
  });

  await check('扫描范围固定在灵帧AI tenants 目录',async()=>{
    const chromeRoot=path.join(temp,'SystemChrome','Default');fs.mkdirSync(chromeRoot,{recursive:true});fs.writeFileSync(path.join(chromeRoot,'Cookies'),'source-secret');
    const serialized=JSON.stringify(await importer.discover());
    assert.doesNotMatch(serialized,/SystemChrome|Default|source-secret/);
  });

  await check('主进程、预加载和界面都接入确认式迁移',async()=>{
    const main=fs.readFileSync(path.join(root,'src','main','main.cjs'),'utf8');const preload=fs.readFileSync(path.join(root,'src','preload','preload.cjs'),'utf8');const ui=fs.readFileSync(path.join(root,'src','renderer','desktop-ui.js'),'utf8');
    assert.match(main,/doubao-accounts:discover-local/);assert.match(main,/doubao-accounts:import-local/);assert.match(preload,/discoverLocal/);assert.match(preload,/importLocal/);
    assert.match(ui,/发现本机已登录的豆包账号/);assert.match(ui,/data-local-import-ref/);assert.match(ui,/加载选中账号/);assert.match(ui,/暂不加载/);
  });

  const failed=checks.filter(item=>!item.ok);const result={test:'doubao-account-local-import',timestamp:new Date().toISOString(),groundTruth:truth,total:checks.length,passed:checks.length-failed.length,failed:failed.length,checks};
  fs.mkdirSync(path.join(root,'scripts','log'),{recursive:true});fs.writeFileSync(path.join(root,'scripts','log','doubao-account-local-import.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));if(failed.length)process.exitCode=1;
})().finally(()=>{try{fs.rmSync(temp,{recursive:true,force:true})}catch{}});
