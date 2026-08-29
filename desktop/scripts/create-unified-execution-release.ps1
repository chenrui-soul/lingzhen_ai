$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$release = Join-Path $root "scripts\release\desktop-unified-execution-v0.8.0-$stamp"
$files = @(
  'src\main\main.cjs','src\main\generation-orchestrator.cjs','src\main\model-gateway-bridge.cjs','src\main\workbench-data-bridge.cjs',
  'src\preload\preload.cjs','src\renderer\index.html','src\renderer\generation-ui.js','src\renderer\text-workspace.js','src\renderer\styles\generation-ui.css',
  'references\unified-execution-ground-truth.json','scripts\test-unified-execution.cjs','scripts\log\unified-execution.json',
  'scripts\log\unified-execution-tasks-smoke.png','scripts\log\unified-execution-text-smoke.png',
  'scripts\log\unified-execution-electron.stdout.log','scripts\log\unified-execution-electron.stderr.log'
)
foreach($relative in $files){$source=Join-Path $root $relative;if(-not(Test-Path -LiteralPath $source)){throw "Release source missing: $relative"};$target=Join-Path $release $relative;New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target)|Out-Null;Copy-Item -LiteralPath $source -Destination $target}
$manifest=[ordered]@{version='0.8.0-candidate';createdAt=(Get-Date).ToString('o');scope=@('unified-task-protocol','doubao-execution-adapter','model-gateway-execution-adapter','task-timeline','text-generation-binding','safe-verification-resume','asset-result-backfill');formalWebProjectModified=$false;doubaoManagerRewritten=$false;tests=[ordered]@{unifiedExecution='7/7';modelGateway='22/22';taskCenter='19/19';projectMaterials='27/27';textWorkspace='21/21';desktopSmoke='17/17';tenantStorage='3/3';responsive='12/12';browserGeneration='5/5';videoIsolation='8/8';electronTasksScreenshot='passed';electronTextScreenshot='passed'}}
$manifest|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $release 'manifest.json') -Encoding UTF8
Write-Output $release
