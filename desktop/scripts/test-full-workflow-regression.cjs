'use strict';

const fs = require('fs');
const path = require('path');
const {spawnSync} = require('child_process');

const root = path.resolve(__dirname, '..');
const truthPath = path.join(root, 'references', 'full-workflow-regression-ground-truth.json');
const truth = JSON.parse(fs.readFileSync(truthPath, 'utf8'));
const category = String(process.argv[2] || 'all');
const selected = category === 'all' ? Object.entries(truth.categories).flatMap(([group, scripts]) => scripts.map(script => ({group, script}))) : (truth.categories[category] || []).map(script => ({group:category, script}));
if (!selected.length) throw new Error(`未知测试分类：${category}`);

const detailDir = path.join(root, 'scripts', 'log', `full-workflow-${category}`);
fs.mkdirSync(detailDir, {recursive:true});
const checks = [];
for (const item of selected) {
  const startedAt = Date.now();
  const scriptPath = path.join(root, 'scripts', item.script);
  if (!fs.existsSync(scriptPath)) {
    checks.push({...item, ok:false, exitCode:null, durationMs:0, error:'测试脚本不存在'});
    continue;
  }
  const result = spawnSync(process.execPath, [scriptPath], {cwd:root, encoding:'utf8', timeout:180000, maxBuffer:20*1024*1024, env:{...process.env, LINGFRAME_FULL_WORKFLOW_TEST:'1'}});
  const output = `${result.stdout || ''}${result.stderr ? `\n--- STDERR ---\n${result.stderr}` : ''}`;
  fs.writeFileSync(path.join(detailDir, `${path.basename(item.script, '.cjs')}.log`), output, 'utf8');
  checks.push({...item, ok:result.status === 0 && !result.error, exitCode:result.status, durationMs:Date.now()-startedAt, error:result.error ? String(result.error.message || result.error) : null});
}
const failed = checks.filter(item => !item.ok);
const report = {test:'full-workflow-regression', category, timestamp:new Date().toISOString(), groundTruth:truthPath, total:checks.length, passed:checks.length-failed.length, failed:failed.length, durationMs:checks.reduce((sum,item)=>sum+item.durationMs,0), checks};
fs.writeFileSync(path.join(root, 'scripts', 'log', `full-workflow-${category}.json`), JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify(report, null, 2));
if (failed.length) process.exitCode = 1;
