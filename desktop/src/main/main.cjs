const {app, BrowserWindow, ipcMain, shell, nativeTheme, dialog, safeStorage} = require('electron');
const path = require('path');
const fs = require('fs');
const {AgentBridge} = require('./agent-bridge.cjs');
const {EmbeddedBrowserManager} = require('./embedded-browser-manager.cjs');
const {DesktopAuthClient} = require('./desktop-auth-client.cjs');
const {WorkbenchDataBridge} = require('./workbench-data-bridge.cjs');
const {ModelGatewayBridge} = require('./model-gateway-bridge.cjs');
const {PlatformModelGatewayBridge, RoutedModelGatewayBridge} = require('./platform-model-gateway-bridge.cjs');
const {GenerationOrchestrator} = require('./generation-orchestrator.cjs');
const {ConnectionConfig} = require('./connection-config.cjs');
const {DoubaoAccountRegistry} = require('./doubao-account-registry.cjs');
const {AutoUpdaterManager} = require('./auto-updater.cjs');
const {DesktopCloudSync} = require('./desktop-cloud-sync.cjs');
const {TenantRuntimeLifecycle} = require('./tenant-runtime-lifecycle.cjs');
const {DesktopBillingClient} = require('./desktop-billing-client.cjs');

if(process.env.LINGFRAME_TEST_USER_DATA)app.setPath('userData',path.resolve(process.env.LINGFRAME_TEST_USER_DATA));
const dataRoot = path.join(app.getPath('userData'), 'tenants');
const systemRoot = path.join(app.getPath('userData'), 'system');
const connectionConfig = new ConnectionConfig({dataRoot: systemRoot, bootstrapFile: path.join(__dirname, '../../assets/connection-bootstrap.json'), appVersion: app.getVersion()});
const desktopIdentity = new DesktopAuthClient({
  dataRoot: systemRoot,
  appVersion: app.getVersion(),
  safeStorage,
  serverUrlsProvider:()=>connectionConfig.serviceUrls('business')
});
const desktopBilling = new DesktopBillingClient({authClient: desktopIdentity});
const agentCredentialAdapter={status:()=>desktopIdentity.status(),credentials:()=>({})};
let win;
function safeScopePart(value){return String(value||'').replace(/[^A-Za-z0-9-]/g,'_').slice(0,80)}
function tenantDataRoot(){const tenantId=desktopIdentity.runtimeTenantId(),userId=desktopIdentity.userId()||desktopIdentity.runtimeUserId();if(!tenantId||!userId)return null;const tenantRoot=path.join(dataRoot,safeScopePart(tenantId)),marker=path.join(tenantRoot,'.user-scope-v1.json');fs.mkdirSync(tenantRoot,{recursive:true});let owner='';try{owner=String(JSON.parse(fs.readFileSync(marker,'utf8'))?.ownerUserId||'')}catch{}let root=tenantRoot;if(!owner){const state={version:1,tenantId,userId,ownerUserId:userId,claimedAt:new Date().toISOString()};const temporary=`${marker}.${process.pid}.tmp`;fs.writeFileSync(temporary,JSON.stringify(state,null,2),{encoding:'utf8',mode:0o600});fs.renameSync(temporary,marker)}else if(owner!==String(userId)){root=path.join(tenantRoot,'users',safeScopePart(userId),safeScopePart(tenantId))}fs.mkdirSync(root,{recursive:true});for(const name of ['database','materials','downloads','documents','chrome-profiles','embedded-browser-profiles','task-cache','logs','agent'])fs.mkdirSync(path.join(root,name),{recursive:true});return root;}
let agentBridge;
let embeddedBrowser;
let generationOrchestrator;
function syncConnectionEndpoints(){
  agentBridge?.setServerUrls(connectionConfig.serviceUrls('business'));
}
function redactConnectionText(value){return typeof value==='string'?value.replace(/https?:\/\/[^\s"']+/gi,'[服务地址已隐藏]').replace(/(?:127\.0\.0\.1|localhost|\[?::1\]?):\d+/gi,'[服务地址已隐藏]'):value}
function publicIdentityStatus(value=desktopIdentity.status()){const {lastServerUrl,...safe}=value||{};return {...safe,reason:redactConnectionText(safe.reason),lastError:safe.lastError?{...safe.lastError,message:redactConnectionText(safe.lastError.message)}:null}}
function publicAgentStatus(value=agentBridge?.status()||{online:false,configured:false}){const {serverUrl,...safe}=value||{};return {...safe,reason:redactConnectionText(safe.reason),error:redactConnectionText(safe.error)}}
let cloudSync;
const workbenchData = new WorkbenchDataBridge({tenantRootProvider: tenantDataRoot,tenantIdProvider:()=>desktopIdentity.runtimeTenantId(),changeListener:snapshot=>cloudSync?.scheduleWorkspace(snapshot)});
const doubaoAccounts = new DoubaoAccountRegistry({tenantRootProvider: tenantDataRoot,tenantIdProvider:()=>desktopIdentity.runtimeTenantId(),userIdProvider:()=>desktopIdentity.runtimeUserId(),changeListener:event=>cloudSync?.scheduleAccounts(event)});
cloudSync = new DesktopCloudSync({authClient:desktopIdentity,workspaceProvider:()=>desktopIdentity.tenantId()?workbenchData.cloudSnapshot():null,accountProvider:()=>desktopIdentity.tenantId()?doubaoAccounts.list():[]});
const updateManager = new AutoUpdaterManager({app,windowProvider:()=>win,dataRootProvider:tenantDataRoot,taskProvider:()=>desktopIdentity.tenantId()?(workbenchData.bootstrap().tasks||[]):[],configFile:path.join(__dirname,'../../assets/update-config.json')});
const modelGateway = new ModelGatewayBridge({
  tenantRootProvider: tenantDataRoot,
  secretProvider: () => `${desktopIdentity.runtimeTenantId() || 'unknown'}|${desktopIdentity.status()?.deviceId || desktopIdentity.status()?.deviceSuffix || 'device'}`
});
const platformModelGateway = new PlatformModelGatewayBridge({authClient:desktopIdentity});
const routedModelGateway = new RoutedModelGatewayBridge({localGateway:modelGateway,platformGateway:platformModelGateway});
function tenantAgentConfig() {
  return desktopIdentity.agentConfig();
}
function disposeTenantRuntime() {
  generationOrchestrator?.dispose?.();
  generationOrchestrator = null;
  agentBridge?.stop?.();
  agentBridge = null;
  embeddedBrowser?.resetTenant?.();
}
function createTenantRuntime(identity = null) {
  const root = tenantDataRoot();
  if (!root) return null;
  const runtimeTenantId=String(identity?.tenantId||desktopIdentity.runtimeTenantId()||'');
  const runtimeUserId=String(identity?.userId||desktopIdentity.runtimeUserId()||'');
  const tenantRuntimeScope=()=>({tenantId:runtimeTenantId,userId:runtimeUserId});
  const assertRuntimeTenant=()=>{const scope=tenantRuntimeScope();if(String(desktopIdentity.runtimeTenantId()||'')!==scope.tenantId||String(desktopIdentity.runtimeUserId()||'')!==scope.userId)throw Object.assign(new Error('租户身份已切换，旧运行时已停止'),{code:'TENANT_CONTEXT_CHANGED'});};
  agentBridge = new AgentBridge({dataRoot: path.join(root, 'agent'), licenseClient:agentCredentialAdapter, identityProvider: () => desktopIdentity.status(), initialConfig: tenantAgentConfig(), serverUrls: connectionConfig.serviceUrls('business'), profileRootProvider: () => {assertRuntimeTenant();return path.join(root, 'chrome-profiles');}, embeddedBrowserProvider: () => {assertRuntimeTenant();return embeddedBrowser;}, accountAuthorizer: account => {assertRuntimeTenant();return doubaoAccounts.assert(account);}, testMode: process.env.LINGFRAME_AGENT_TEST_MODE === '1'});
  generationOrchestrator = new GenerationOrchestrator({tenantIdProvider:()=>{assertRuntimeTenant();return runtimeTenantId;},authorizationProvider:capability=>desktopIdentity.assert(capability),tasks:workbenchData,modelGateway:routedModelGateway,agentBridge,accountRegistry:doubaoAccounts,dataRootProvider:()=>{assertRuntimeTenant();return root;},liveViewProvider:async payload=>{win?.webContents.send('generation:live-view',payload);await new Promise(resolve=>setTimeout(resolve,650))},liveStatusProvider:payload=>win?.webContents.send('generation:live-status',payload)});
  generationOrchestrator.recoverInterruptedTasks();
  agentBridge.start();
  return {agentBridge, generationOrchestrator};
}
const tenantRuntimeLifecycle = new TenantRuntimeLifecycle({
  hasRuntime:()=>Boolean(generationOrchestrator),
  createRuntime:identity=>createTenantRuntime(identity),
  disposeRuntime:disposeTenantRuntime,
  refreshRuntime:syncConnectionEndpoints,
});
function refreshTenantRuntime(status=desktopIdentity.status()) { return tenantRuntimeLifecycle.sync(status).tenantId; }
desktopIdentity.on('change',status=>{refreshTenantRuntime(status);if(status?.workspaceReady)cloudSync.activate().catch(()=>{});else cloudSync.deactivate();win?.webContents.send('auth:changed',publicIdentityStatus(status))});
function licensed(capability,handler){return(...args)=>{desktopIdentity.assert(capability);return handler(...args)}}
function createWindow(){
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1120, minHeight: 700,
    frame: false, show: false, backgroundColor: '#070d19',
    webPreferences: {preload:path.join(__dirname,'../preload/preload.cjs'), contextIsolation:true, nodeIntegration:false, sandbox:false}
  });
  win.loadFile(path.join(__dirname,'../renderer/index.html'));
  win.once('ready-to-show',()=>win.show());
  win.webContents.on('did-finish-load',()=>{
    if(process.env.LINGFRAME_AUTH_SMOKE==='1'){
      setTimeout(async()=>{
        try{
          const deadline=Date.now()+15000;
          let ready=false;
          while(!ready&&Date.now()<deadline){ready=await win.webContents.executeJavaScript("Boolean(document.querySelector('#auth-gate .auth-form'))");if(!ready)await new Promise(resolve=>setTimeout(resolve,200));}
          if(!ready)throw new Error('登录表单未在限定时间内出现');
          if(process.env.LINGFRAME_AUTH_SMOKE_COMPACT==='1')win.setSize(1120,700);
          await new Promise(resolve=>setTimeout(resolve,350));
          if(process.env.LINGFRAME_AUTH_SMOKE_REGISTER==='1')await win.webContents.executeJavaScript("document.querySelector('[data-auth-mode=register]')?.click()");
          await new Promise(resolve=>setTimeout(resolve,150));
          const metrics=await win.webContents.executeJavaScript("(()=>{const gate=document.querySelector('#auth-gate'),card=document.querySelector('.auth-card'),form=document.querySelector('.auth-form');return{gate:Boolean(gate),form:Boolean(form),mode:card?.classList.contains('is-register')?'register':'login',viewport:{width:innerWidth,height:innerHeight},gateOverflow:gate?gate.scrollWidth>gate.clientWidth||gate.scrollHeight>gate.clientHeight:null,card:card?{width:Math.round(card.getBoundingClientRect().width),height:Math.round(card.getBoundingClientRect().height),clientHeight:card.clientHeight,scrollHeight:card.scrollHeight,overflow:card.scrollWidth>card.clientWidth||card.scrollHeight>card.clientHeight}:null,overflow:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight}})()");
          if(metrics.overflow||metrics.gateOverflow||metrics.card?.overflow)throw new Error(`认证页面发生滚动溢出: ${JSON.stringify(metrics)}`);
          const output=process.env.LINGFRAME_AUTH_SMOKE_SCREENSHOT||path.join(app.getPath('temp'),'lingframe-auth-smoke.png');
          const image=await win.webContents.capturePage();fs.writeFileSync(output,image.toPNG());
          console.log(`LINGFRAME_AUTH_SMOKE_OK ${JSON.stringify({output,metrics})}`);
          setTimeout(()=>app.quit(),100);
        }catch(error){console.error('LINGFRAME_AUTH_SMOKE_FAILED',error);app.exit(1)}
      },250);
      return;
    }
    if(process.env.LINGFRAME_EMBEDDED_SMOKE==='1'){
      setTimeout(async()=>{
        try{
          const account={id:'embedded-smoke',name:'内嵌冒烟账号',platform:'豆包'};
          await embeddedBrowser.open(account);
          const item=embeddedBrowser.sessions.get('embedded-smoke');
          const deadline=Date.now()+20000;
          while(item.webContents.isLoading()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,250));
          const output=process.env.LINGFRAME_EMBEDDED_SMOKE_SCREENSHOT||path.join(app.getPath('temp'),'lingframe-embedded-doubao-smoke.png');
          const image=await item.webContents.capturePage();fs.writeFileSync(output,image.toPNG());
          console.log(`LINGFRAME_EMBEDDED_SMOKE_OK ${JSON.stringify({url:item.webContents.getURL(),title:item.webContents.getTitle(),output})}`);
          setTimeout(()=>app.quit(),100);
        }catch(error){console.error('LINGFRAME_EMBEDDED_SMOKE_FAILED',error);app.exit(1)}
      },500);
      return;
    }
    if(process.env.LINGFRAME_SMOKE==='1'){
      const smokePage=String(process.env.LINGFRAME_SMOKE_PAGE||'').replace(/[^a-z-]/g,'');
      const prepare=smokePage?win.webContents.executeJavaScript(`(()=>{const node=document.querySelector('[data-page="${smokePage}"]');if(node){node.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));return node.dataset.page}return null})()`).then(()=>new Promise(resolve=>setTimeout(resolve,700))).then(async()=>{
        if(smokePage==='doubao'&&process.env.LINGFRAME_SMOKE_ADD_ACCOUNT==='1'){
          if(process.env.LINGFRAME_SMOKE_ADD_WITH_EMBEDDED==='1'){
            await embeddedBrowser.open({id:'desktop-1',name:'白同学',platform:'豆包'});
            await new Promise(resolve=>setTimeout(resolve,500));
          }
          const clicked=await win.webContents.executeJavaScript(`(() => { const button=document.querySelector('.account-add'); if(!button)return false; button.click(); return true; })()`);
          await new Promise(resolve=>setTimeout(resolve,250));
          const modal=await win.webContents.executeJavaScript('Boolean(document.querySelector("#doubao-account-modal"))');
          console.log(`LINGFRAME_SMOKE_ADD_ACCOUNT ${JSON.stringify({clicked,modal,embedded:embeddedBrowser.status('desktop-1')})}`);
          return;
        }
        if(smokePage==='doubao'&&process.env.LINGFRAME_SMOKE_OPEN_ACCOUNT==='1'){
          try{
            const clicked=await win.webContents.executeJavaScript(`(() => { const button=document.querySelector('.account-compact[data-account-id="desktop-1"] button[data-account-action="open"]'); if(!button)return false; button.click(); return true; })()`);
            await new Promise(resolve=>setTimeout(resolve,2500));
            console.log(`LINGFRAME_SMOKE_IDENTITY ${JSON.stringify({clicked,identity:desktopIdentity.status(),embedded:embeddedBrowser?.status('desktop-1')})}`);
          }catch(error){console.error('LINGFRAME_SMOKE_OPEN_ACCOUNT_FAILED',error)}
        }
      }):Promise.resolve();
      prepare.then(()=>win.webContents.capturePage()).then(image=>{
        const output=process.env.LINGFRAME_SMOKE_SCREENSHOT||path.join(app.getPath('temp'),'lingframe-desktop-smoke.png');
        fs.writeFileSync(output,image.toPNG());
        console.log(`LINGFRAME_SMOKE_OK ${output}`);
        setTimeout(()=>app.quit(),100);
      }).catch(error=>{console.error(error);app.exit(1)});
    }
  });
  embeddedBrowser = new EmbeddedBrowserManager({window: win, tenantProvider: () => desktopIdentity.runtimeTenantId(), dataRootProvider: tenantDataRoot, tenantsRootProvider: () => dataRoot, accountRegistry: doubaoAccounts});
  win.on('closed',()=>{embeddedBrowser?.dispose(); embeddedBrowser=null; win=null});
}
const allowSmokeSecondInstance=process.env.LINGFRAME_SMOKE_ALLOW_SECOND_INSTANCE==='1';
const singleInstanceReady=allowSmokeSecondInstance||app.requestSingleInstanceLock();
if(!singleInstanceReady){app.quit()}else{
 if(!allowSmokeSecondInstance)app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus()}});
	 app.whenReady().then(async()=>{nativeTheme.themeSource='dark';fs.mkdirSync(dataRoot,{recursive:true});createWindow();connectionConfig.refresh().then(syncConnectionEndpoints).catch(()=>{});await desktopIdentity.bootstrap();refreshTenantRuntime();if(desktopIdentity.status().workspaceReady)await cloudSync.activate();updateManager.start();app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow()})});
 app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});
 app.on('before-quit',()=>{generationOrchestrator?.dispose?.();agentBridge?.stop(); embeddedBrowser?.dispose();cloudSync.dispose();updateManager.dispose()});
}
ipcMain.handle('window:minimize',()=>win?.minimize());
ipcMain.handle('window:toggle-maximize',()=>{if(win?.isMaximized())win.unmaximize();else win?.maximize();return win?.isMaximized()});
ipcMain.handle('window:close',()=>win?.close());
ipcMain.handle('window:is-maximized',()=>Boolean(win?.isMaximized()));
ipcMain.handle('app:open-external',(_,url)=>{if(/^https?:\/\//i.test(url))return shell.openExternal(url)});
ipcMain.handle('app:diagnostics',()=>({version:app.getVersion(),platform:process.platform,service:connectionConfig.publicStatus(),identity:publicIdentityStatus(),agent:publicAgentStatus(),update:updateManager.status(),browser:'独立账号窗口'}));
ipcMain.handle('app:update-status',()=>updateManager.status());
ipcMain.handle('app:update-check',()=>updateManager.check(true));
ipcMain.handle('app:update-download',()=>updateManager.download());
ipcMain.handle('app:update-install',()=>updateManager.install());
ipcMain.handle('desktop-sync:status',()=>cloudSync.status());
ipcMain.handle('identity:status',async()=>{await desktopIdentity.bootstrap();return publicIdentityStatus()});
ipcMain.handle('auth:status',async()=>publicIdentityStatus(await desktopIdentity.bootstrap()));
ipcMain.handle('auth:login',async(_,input)=>{const status=await desktopIdentity.login(input||{});refreshTenantRuntime(status);return publicIdentityStatus(status)});
ipcMain.handle('auth:register',async(_,input)=>{const status=await desktopIdentity.register(input||{});refreshTenantRuntime(status);return publicIdentityStatus(status)});
ipcMain.handle('auth:select-tenant',async(_,tenantId)=>{const status=await desktopIdentity.selectTenant(tenantId);refreshTenantRuntime(status);return publicIdentityStatus(status)});
ipcMain.handle('auth:refresh',async()=>{const status=await desktopIdentity.refresh();refreshTenantRuntime(status);return publicIdentityStatus(status)});
ipcMain.handle('auth:desktop-bootstrap',async()=>{const status=await desktopIdentity.loadDesktopBootstrap();refreshTenantRuntime(status);return publicIdentityStatus(status)});
ipcMain.handle('auth:logout',async()=>{tenantRuntimeLifecycle.dispose();const status=await desktopIdentity.logout();return publicIdentityStatus(status)});
ipcMain.handle('agent:status',()=>publicAgentStatus());
ipcMain.handle('agent:configure',licensed('agent-control',(_,config)=>publicAgentStatus(agentBridge?.configure(config))));
ipcMain.handle('connection:status',()=>connectionConfig.publicStatus());
ipcMain.handle('connection:refresh',async()=>{await connectionConfig.refresh();syncConnectionEndpoints();return connectionConfig.publicStatus()});
ipcMain.handle('connection:admin-verify',(_,input)=>connectionConfig.verifyAdmin(input||{}));
ipcMain.handle('connection:admin-status',(_,sessionId)=>connectionConfig.adminStatus(sessionId));
ipcMain.handle('connection:admin-apply',async(_,sessionId,input)=>{const status=await connectionConfig.applyAdminOverride(sessionId,input||{});syncConnectionEndpoints();agentBridge?.stop();agentBridge?.start();return status});
ipcMain.handle('agent:open-account',licensed('account-control',(_,account)=>agentBridge?.openAccount(doubaoAccounts.assert(account))));
ipcMain.handle('agent:detect-account',licensed('account-control',(_,account)=>agentBridge?.detectAccount(doubaoAccounts.assert(account))));
ipcMain.handle('doubao-accounts:bootstrap',(_,input)=>desktopIdentity.tenantId()?doubaoAccounts.bootstrap(input||{}):({tenantId:null,accounts:[],locked:true}));
ipcMain.handle('doubao-accounts:list',()=>desktopIdentity.tenantId()?doubaoAccounts.list():[]);
ipcMain.handle('doubao-accounts:discover-local',licensed('read-local',()=>embeddedBrowser?.discoverLocalAccounts()||[]));
ipcMain.handle('doubao-accounts:import-local',licensed('write-local',(_,candidateRef)=>embeddedBrowser?.importLocalAccount(candidateRef)));
ipcMain.handle('doubao-accounts:upsert',licensed('write-local',(_,input)=>doubaoAccounts.upsert(input||{})));
ipcMain.handle('doubao-accounts:remove',licensed('write-local',(_,accountId)=>{
  const account=doubaoAccounts.assertRemovable(accountId,workbenchData.bootstrap().tasks);
  agentBridge?.closeAccount?.(account);
  embeddedBrowser?.close(account,{force:true});
  return doubaoAccounts.remove(account.id);
}));
ipcMain.handle('workbench:bootstrap',()=>desktopIdentity.tenantId()?workbenchData.bootstrap():({currentProjectId:null,projects:[],assets:[],textConversations:[],tasks:[],doubaoQuotaBlocks:[],locked:true}));
ipcMain.handle('credits:wallet',licensed('credits-read',()=>desktopBilling.wallet()));
ipcMain.handle('credits:packages',licensed('credits-read',()=>desktopBilling.packages()));
ipcMain.handle('credits:orders',licensed('credits-read',()=>desktopBilling.orders()));
ipcMain.handle('credits:ledger',licensed('credits-read',(_,limit,cursor)=>desktopBilling.ledger(limit,cursor)));
ipcMain.handle('credits:create-order',licensed('credits-recharge',(_,input)=>desktopBilling.createOrder(input||{})));
ipcMain.handle('credits:cancel-order',licensed('credits-recharge',(_,orderId)=>desktopBilling.cancelOrder(orderId)));
ipcMain.handle('models:bootstrap',()=>desktopIdentity.tenantId()?modelGateway.bootstrap():[]);
let desktopModelsRefreshAt = 0;
let desktopModelsRefreshPromise = null;
async function refreshDesktopModels() {
  if (!desktopIdentity.tenantId()) return false;
  const now = Date.now();
  if (desktopIdentity.status()?.workspaceReady && now - desktopModelsRefreshAt < 15000) return true;
  if (!desktopModelsRefreshPromise) {
    desktopModelsRefreshPromise = desktopIdentity.loadDesktopBootstrap()
      .then(status => { desktopModelsRefreshAt = Date.now(); return Boolean(status?.workspaceReady); })
      .finally(() => { desktopModelsRefreshPromise = null; });
  }
  return desktopModelsRefreshPromise;
}
ipcMain.handle('models:catalog',async()=>{if(!await refreshDesktopModels())return [];return routedModelGateway.catalog();});
ipcMain.handle('models:execution-catalog',async()=>{if(!await refreshDesktopModels())return [];return routedModelGateway.executionCatalog();});
ipcMain.handle('models:create-provider',licensed('write-local',(_,input)=>modelGateway.createProvider(input)));
ipcMain.handle('models:update-provider',licensed('write-local',(_,providerId,input)=>modelGateway.updateProvider(providerId,input)));
ipcMain.handle('models:delete-provider',licensed('write-local',(_,providerId)=>modelGateway.deleteProvider(providerId)));
ipcMain.handle('models:test-provider',licensed('generate',(_,providerId)=>modelGateway.testProvider(providerId)));
ipcMain.handle('models:discover',licensed('generate',(_,providerId)=>modelGateway.discoverModels(providerId)));
ipcMain.handle('models:add-model',licensed('write-local',(_,providerId,input)=>modelGateway.addModel(providerId,input)));
ipcMain.handle('models:update-model',licensed('write-local',(_,providerId,modelId,input)=>modelGateway.updateModel(providerId,modelId,input)));
ipcMain.handle('models:delete-model',licensed('write-local',(_,providerId,modelId)=>modelGateway.deleteModel(providerId,modelId)));
ipcMain.handle('projects:create',licensed('write-local',(_,input)=>workbenchData.createProject(input)));
ipcMain.handle('projects:update',licensed('write-local',(_,projectId,input)=>workbenchData.updateProject(projectId,input)));
ipcMain.handle('projects:set-current',licensed('write-local',(_,projectId)=>workbenchData.setCurrentProject(projectId)));
ipcMain.handle('projects:delete',licensed('write-local',(_,projectId)=>workbenchData.deleteProject(projectId)));
ipcMain.handle('projects:restore',licensed('write-local',(_,projectId)=>workbenchData.restoreProject(projectId)));
ipcMain.handle('assets:list',(_,filters)=>workbenchData.listAssets(filters));
ipcMain.handle('assets:pick-import',licensed('write-local',async(_,input)=>{
  const result=await dialog.showOpenDialog(win,{title:'导入素材',properties:['openFile','multiSelections'],filters:[{name:'支持的素材',extensions:['jpg','jpeg','png','webp','mp4','mov','webm','m4v','mp3','wav','m4a','aac','flac','ogg','txt','md','json','csv']}]});
  if(result.canceled)return [];
  return workbenchData.importAssets({...input,paths:result.filePaths});
}));
ipcMain.handle('assets:import',licensed('write-local',(_,input)=>workbenchData.importAssets(input)));
ipcMain.handle('assets:create-text',licensed('write-local',(_,input)=>workbenchData.createTextAsset(input)));
ipcMain.handle('assets:copy',licensed('write-local',(_,input)=>workbenchData.copyAssets(input)));
ipcMain.handle('assets:preview',(_,assetId)=>workbenchData.previewAsset(assetId));
ipcMain.handle('assets:update',licensed('write-local',(_,assetId,input)=>workbenchData.updateAsset(assetId,input)));
ipcMain.handle('assets:delete',licensed('write-local',(_,assetId)=>workbenchData.deleteAsset(assetId)));
ipcMain.handle('assets:restore',licensed('write-local',(_,assetId)=>workbenchData.restoreAsset(assetId)));
ipcMain.handle('assets:open',async(_,assetId)=>{
  const asset=workbenchData.resolveAsset(assetId); const error=await shell.openPath(asset.path); if(error)throw new Error(error); return {ok:true};
});
ipcMain.handle('assets:show-in-folder',(_,assetId)=>{const asset=workbenchData.resolveAsset(assetId);shell.showItemInFolder(asset.path);return {ok:true}});
ipcMain.handle('assets:read-text',(_,assetId)=>workbenchData.readTextAsset(assetId));
ipcMain.handle('text:create',licensed('write-local',(_,input)=>workbenchData.createConversation(input)));
ipcMain.handle('text:update',licensed('write-local',(_,conversationId,input)=>workbenchData.updateConversation(conversationId,input)));
ipcMain.handle('text:delete',licensed('write-local',(_,conversationId)=>workbenchData.deleteConversation(conversationId)));
ipcMain.handle('text:restore',licensed('write-local',(_,conversationId)=>workbenchData.restoreConversation(conversationId)));
ipcMain.handle('text:restore-version',licensed('write-local',(_,conversationId,versionId)=>workbenchData.restoreConversationVersion(conversationId,versionId)));
ipcMain.handle('text:delete-version',licensed('write-local',(_,conversationId,versionId)=>workbenchData.deleteConversationVersion(conversationId,versionId)));
ipcMain.handle('tasks:create',licensed('write-local',(_,input)=>workbenchData.createDraftTask(input)));
ipcMain.handle('tasks:report',licensed('write-local',(_,taskId,input)=>workbenchData.reportTask(taskId,input)));
ipcMain.handle('tasks:complete',licensed('write-local',(_,taskId,input)=>workbenchData.completeTask(taskId,input)));
ipcMain.handle('tasks:update-result-url',licensed('write-local',(_,taskId,url)=>workbenchData.updateResultUrl(taskId,url)));
ipcMain.handle('tasks:cancel',licensed('result-recovery',(_,taskId)=>generationOrchestrator?generationOrchestrator.cancel(taskId):workbenchData.cancelTask(taskId)));
ipcMain.handle('tasks:retry',licensed('generate',(_,taskId,input)=>generationOrchestrator.retryTask(taskId,input||{})));
ipcMain.handle('tasks:archive',licensed('write-local',(_,taskId,archived)=>workbenchData.archiveTask(taskId,archived)));
ipcMain.handle('tasks:delete',licensed('write-local',(_,taskId)=>workbenchData.deleteTask(taskId)));
ipcMain.handle('tasks:restore',licensed('write-local',(_,taskId)=>workbenchData.restoreTask(taskId)));
ipcMain.handle('generation:create',licensed('generate',(_,input)=>generationOrchestrator.create(input)));
ipcMain.handle('generation:run',licensed('generate',(_,taskId)=>generationOrchestrator.run(taskId)));
ipcMain.handle('generation:resume',licensed('result-recovery',(_,taskId)=>generationOrchestrator.resume(taskId)));
ipcMain.handle('generation:monitor',licensed('result-recovery',(_,taskId)=>generationOrchestrator.monitor(taskId)));
ipcMain.handle('generation:resolve-submission-unknown',licensed('result-recovery',(_,taskId,resolution)=>generationOrchestrator.resolveSubmissionUnknown(taskId,resolution)));
ipcMain.handle('generation:model-pause',licensed('result-recovery',(_,taskId)=>generationOrchestrator.pauseModel(taskId)));
ipcMain.handle('generation:model-resume',licensed('result-recovery',(_,taskId)=>generationOrchestrator.resumeModel(taskId)));
ipcMain.handle('generation:model-retry-result',licensed('result-recovery',(_,taskId)=>generationOrchestrator.retryModelResult(taskId)));
ipcMain.handle('generation:model-update-result',licensed('result-recovery',(_,taskId,input)=>generationOrchestrator.updateModelResult(taskId,input||{})));
ipcMain.handle('generation:doubao-retry-result',licensed('result-recovery',(_,taskId)=>generationOrchestrator.retryDoubaoResult(taskId)));
ipcMain.handle('generation:cancel',licensed('result-recovery',(_,taskId)=>generationOrchestrator.cancel(taskId)));
ipcMain.handle('doubao:open',licensed('account-control',async(_,account,options)=>{
  // Revalidate/import the existing desktop Agent identity at the moment the
  // user opens an account. This also recovers when the server was unavailable
  // during application startup, without trusting the token locally.
  const identity=await desktopIdentity.bootstrap();
  if(!identity.usable)throw new Error(identity.reason || '登录会话已失效，请重新登录');
  tenantDataRoot();
  return embeddedBrowser?.open(doubaoAccounts.assert(account), options || {});
}));
ipcMain.handle('doubao:detect',licensed('account-control',(_,account)=>embeddedBrowser?.detect(doubaoAccounts.assert(account))));
ipcMain.handle('doubao:close',(_,account)=>embeddedBrowser?.close(doubaoAccounts.assert(account)));
ipcMain.handle('doubao:popout',licensed('account-control',(_,account)=>embeddedBrowser?.open(doubaoAccounts.assert(account), {popout:true})));
ipcMain.handle('doubao:activate-account',licensed('account-control',(_,accountId)=>embeddedBrowser?.activateAccount(doubaoAccounts.assert(accountId).id)));
ipcMain.handle('doubao:hide-account',(_,accountId)=>embeddedBrowser?.hideAccount(doubaoAccounts.assert(accountId).id));
ipcMain.handle('doubao:set-bounds',(_,bounds)=>embeddedBrowser?.setBounds(bounds));
ipcMain.handle('doubao:set-page-active',(_,active)=>embeddedBrowser?.setPageActive(active));
ipcMain.handle('doubao:status',(_,accountId)=>embeddedBrowser?.status(accountId?doubaoAccounts.assert(accountId).id:""));
