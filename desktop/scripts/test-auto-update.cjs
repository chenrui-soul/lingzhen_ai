const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const truth = JSON.parse(fs.readFileSync(path.join(root, 'references', 'auto-update-v0123-ground-truth.json'), 'utf8'));
const {normalizeUpdateUrl, blockingTasks} = require(path.join(root, 'src', 'main', 'update-policy.cjs'));
const {AutoUpdaterManager} = require(path.join(root, 'src', 'main', 'auto-updater.cjs'));

const results = [];
const check = (name, fn) => { fn(); results.push({name, ok:true}); };

check('HTTP 更新地址仅在内测许可下接受', () => {
  assert.equal(normalizeUpdateUrl('http://updates.example.test/stable'), '');
  assert.equal(normalizeUpdateUrl('http://updates.example.test/stable/', {allowPublicHttp:true}), 'http://updates.example.test/stable');
  assert.equal(normalizeUpdateUrl('https://updates.example.test/stable'), 'https://updates.example.test/stable');
});

check('任务执行保护状态符合 Ground Truth', () => {
  for (const item of truth.taskCases) assert.equal(blockingTasks([{id:item.state,state:item.state}]).length > 0, item.blocking, item.state);
});

check('截图中的 failed 终态不会阻止安装', () => {
  const tasks = [{id:'screenshot-bug',title:'跳一支舞',state:'failed',safeToRetry:true,notSentVerified:true}];
  assert.equal(blockingTasks(tasks).length, 0);
});

check('更新前备份只复制核心 JSON 数据', () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'lingframe-update-test-'));
  const tenant = path.join(userData, 'tenants', 'tenant-a');
  fs.mkdirSync(path.join(tenant, 'database'), {recursive:true});
  fs.mkdirSync(path.join(tenant, 'materials'), {recursive:true});
  fs.mkdirSync(path.join(userData, 'system'), {recursive:true});
  fs.writeFileSync(path.join(tenant, 'database', 'workbench-data-v1.json'), '{"ok":true}');
  fs.writeFileSync(path.join(tenant, 'materials', 'video.mp4'), 'cache');
  fs.writeFileSync(path.join(userData, 'system', 'license-binding.json'), '{"ok":true}');
  const app = {isPackaged:false,getVersion:()=>truth.version,getPath:name=>name==='userData'?userData:userData};
  const manager = new AutoUpdaterManager({app,windowProvider:()=>null,dataRootProvider:()=>tenant,taskProvider:()=>[],configFile:path.join(root,'assets','update-config.json')});
  const backup = manager.backupJsonData();
  assert(backup && fs.existsSync(backup));
  const files = [];
  const walk = dir => { for (const entry of fs.readdirSync(dir,{withFileTypes:true})) entry.isDirectory()?walk(path.join(dir,entry.name)):files.push(path.relative(backup,path.join(dir,entry.name))); };
  walk(backup);
  assert(files.some(file=>file.endsWith('workbench-data-v1.json')));
  assert(files.some(file=>file.endsWith('license-binding.json')));
  assert(!files.some(file=>file.endsWith('video.mp4')));
  fs.rmSync(userData,{recursive:true,force:true});
});

check('构建与渲染层已接入自动更新', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  const main = fs.readFileSync(path.join(root,'src','main','main.cjs'),'utf8');
  const preload = fs.readFileSync(path.join(root,'src','preload','preload.cjs'),'utf8');
  const renderer = fs.readFileSync(path.join(root,'src','renderer','auto-update-ui.js'),'utf8');
  assert.equal(pkg.version, truth.version);
  assert(pkg.dependencies['electron-updater']);
  assert.equal(pkg.build.publish[0].provider, 'generic');
  assert.match(main, /app:update-check/);
  assert.match(preload, /updates:/);
  assert.equal((renderer.match(/id = 'lingframe-update-overlay'/g)||[]).length, 1);
  assert.match(renderer, /auto-update-settings-card/);
  assert.doesNotMatch(renderer, /new MutationObserver\(\(\) => renderSettingsCard\(\)\)/);
  assert.match(renderer, /!document\.querySelector\('#auto-update-settings-card'\)\) renderSettingsCard\(\)/);
});

const log = {ok:true,generatedAt:new Date().toISOString(),total:results.length,passed:results.length,failed:[],results};
fs.mkdirSync(path.join(root,'scripts','log'),{recursive:true});
fs.writeFileSync(path.join(root,'scripts','log','auto-update-v0123.json'),JSON.stringify(log,null,2));
console.log(JSON.stringify(log,null,2));
