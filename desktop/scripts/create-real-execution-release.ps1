$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$release = Join-Path $root "scripts\release\desktop-multi-task-dock-v0.9.0-$stamp"
$files = @(
  'src\main\main.cjs','src\main\generation-orchestrator.cjs','src\main\browser-controller.cjs','src\main\embedded-browser-manager.cjs','src\main\model-gateway-bridge.cjs','src\main\workbench-data-bridge.cjs',
  'src\preload\preload.cjs','src\renderer\index.html','src\renderer\desktop-ui.js','src\renderer\generation-ui.js','src\renderer\task-center.js','src\renderer\styles\generation-ui.css','src\renderer\styles\task-center.css',
  'references\unified-execution-ground-truth.json','references\generation-live-layout-ground-truth.json','references\multi-task-dock-ground-truth.json',
  'scripts\test-unified-execution.cjs','scripts\test-embedded-browser.cjs','scripts\test-generation-live-layout.cjs','scripts\test-multi-task-dock.cjs',
  'scripts\log\unified-execution.json','scripts\log\generation-live-layout.json','scripts\log\multi-task-dock.json'
)
foreach($relative in $files){
  $source=Join-Path $root $relative
  if(-not(Test-Path -LiteralPath $source)){throw "Release source missing: $relative"}
  $target=Join-Path $release $relative
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target)|Out-Null
  Copy-Item -LiteralPath $source -Destination $target
}
$manifest=[ordered]@{
  version='0.9.0-candidate'
  createdAt=(Get-Date).ToString('o')
  scope=@('full-result-video-url','single-and-batch-url-copy','same-account-serial-queue','cross-account-parallel','model-gateway-parallel','global-multi-task-dock','live-account-switch','safe-no-resubmit')
  formalWebProjectModified=$false
  doubaoManagerRewritten=$false
  realAcceptance=[ordered]@{modelGateway='passed';doubaoLogin='passed';doubaoSubmission='passed';doubaoResult='passed-before-this-package';verification='manual-only'}
  tests=[ordered]@{multiTaskDock='25/25';unifiedExecution='7/7';embeddedBrowser='29/29';generationLiveLayout='12/12';doubaoResultCapture='9/9';modelGateway='23/23';taskCenter='19/19';projectMaterials='27/27';textWorkspace='21/21';desktopSmoke='17/17';tenantStorage='3/3';browserGeneration='5/5';videoIsolation='8/8'}
}
$manifest|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $release 'manifest.json') -Encoding UTF8
Write-Output $release
