const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const truthPath = path.join(root, 'references', 'task-dock-terminal-state-ground-truth.json');
const truth = JSON.parse(fs.readFileSync(truthPath, 'utf8'));
const source = fs.readFileSync(path.join(root, 'src', 'renderer', 'generation-ui.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');

const runningStates = new Set(['preparing','checking_login','uploading_references','uploading','configuring','submitting','generating','monitoring','result_detected','downloading','verifying']);
const attentionStates = new Set(['awaiting_verification','awaiting_login','submission_unknown','paused']);
const isRecoverableFailure = task => task?.state === 'failed' && task.executionChannel === 'doubao' && (task.resultUrls || []).length > 0 && (task.retryMode === 'recover_result' || ['result_download_failed','result_review_required','validating_result','manual_retry'].includes(task.recoveryState));
const isLiveDockTask = task => Boolean(task) && !task.deletedAt && !task.archivedAt && (isRecoverableFailure(task) || runningStates.has(task.state) || task.state === 'queued' || task.state === 'awaiting_quota' || attentionStates.has(task.state));
const needsAttention = task => attentionStates.has(task?.state) || isRecoverableFailure(task);

const results = truth.cases.map(testCase => {
  const live = isLiveDockTask(testCase.task);
  const attention = needsAttention(testCase.task);
  assert.equal(live, testCase.live, `${testCase.name}: live classification`);
  assert.equal(attention, testCase.attention, `${testCase.name}: attention classification`);
  return {name: testCase.name, live, attention, expectedLive: testCase.live, expectedAttention: testCase.attention};
});

// Regression guards: failed is not an attention state, and bootstrap no longer restores recent terminal failures.
assert.match(source, /const attentionStates = new Set\(\['awaiting_verification','awaiting_login','submission_unknown','paused'\]\)/);
assert.match(source, /filter\(isLiveDockTask\)/);
assert.doesNotMatch(source, /item\.state==='failed'&&item\.terminalFailureVerified===true&&Date\.parse\(item\.updatedAt/);
assert.doesNotMatch(appSource, /item\.state==='failed'&&item\.terminalFailureVerified===true&&Date\.parse\(item\.updatedAt/);
assert.match(source, /shell\.classList\.toggle\('idle',counts\.total===0\)/);
assert.match(source, /tasksButton\?\.click\(\)/);
const liveCss = fs.readFileSync(path.join(root, 'src', 'renderer', 'styles', 'generation-ui.css'), 'utf8');
assert.match(liveCss, /\.generation-live-shell\.idle\s*\{\s*display:\s*none\s*!important;/);

const logDir = path.join(root, 'scripts', 'log');
fs.mkdirSync(logDir, {recursive: true});
const log = {ok: true, generatedAt: new Date().toISOString(), source: truthPath, results};
fs.writeFileSync(path.join(logDir, 'task-dock-terminal-state.json'), JSON.stringify(log, null, 2));
console.log(JSON.stringify(log, null, 2));
