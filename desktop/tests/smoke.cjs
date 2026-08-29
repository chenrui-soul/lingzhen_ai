const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const must = [
  'package.json','README.md','assets/lingframe-mark.png',
  'src/main/main.cjs','src/preload/preload.cjs','src/renderer/index.html',
  'src/renderer/app.js','src/renderer/styles/app.css'
];
const checks = [];
for (const rel of must) checks.push({name:`exists:${rel}`,ok:fs.existsSync(path.join(root,rel))});
const css=fs.readFileSync(path.join(root,'src/renderer/styles/app.css'),'utf8');
const js=fs.readFileSync(path.join(root,'src/renderer/app.js'),'utf8');
const main=fs.readFileSync(path.join(root,'src/main/main.cjs'),'utf8');
for (const [name,ok] of [
  ['brand:lingframe',js.includes('灵帧AI')&&js.includes('lingframe-mark.png')],
  ['brand:slogan',js.includes('灵感，即刻成帧。')],
  ['nav:doubao',js.includes('豆包管理')],
  ['nav:all-core', ['创作首页','文本创作','任务中心','积分中心','无限画布','短剧模板','系统设置'].every(x=>js.includes(x))],
  ['ui:glass',css.includes('.glass')],
  ['ui:collapsible-panels',js.includes('data-toggle="right"')&&js.includes('left-off')&&js.includes('right-off')],
  ['electron:secure-preload',main.includes('contextIsolation:true')&&main.includes('nodeIntegration:false')],
  ['electron:single-instance',main.includes('requestSingleInstanceLock')],
  ['electron:window-controls',main.includes('window:minimize')&&main.includes('window:toggle-maximize')&&main.includes('window:close')]
]) checks.push({name,ok});
const failed=checks.filter(x=>!x.ok); const result={test:'desktop-batch1-smoke',timestamp:new Date().toISOString(),total:checks.length,passed:checks.length-failed.length,failed:failed.map(x=>x.name),checks};
const logDir=path.join(root,'scripts','log');fs.mkdirSync(logDir,{recursive:true});fs.writeFileSync(path.join(logDir,'desktop-batch1-smoke.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2)); if(failed.length) process.exit(1);
