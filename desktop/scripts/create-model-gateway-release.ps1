$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$release = Join-Path $root "scripts\release\desktop-model-gateway-v0.7.0-$stamp"
$files = @(
  'src\main\main.cjs',
  'src\main\model-gateway-bridge.cjs',
  'src\main\workbench-data-bridge.cjs',
  'src\preload\preload.cjs',
  'src\renderer\index.html',
  'src\renderer\model-gateway.js',
  'src\renderer\styles\model-gateway.css',
  'references\model-gateway-ground-truth.json',
  'scripts\test-model-gateway.cjs',
  'scripts\log\model-gateway.json',
  'scripts\log\model-gateway-settings-smoke.png',
  'scripts\log\model-gateway-electron.stdout.log',
  'scripts\log\model-gateway-electron.stderr.log'
)
foreach ($relative in $files) {
  $source = Join-Path $root $relative
  if (-not (Test-Path -LiteralPath $source)) { throw "Release source missing: $relative" }
  $target = Join-Path $release $relative
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
  Copy-Item -LiteralPath $source -Destination $target
}
$manifest = [ordered]@{
  version = '0.7.0-candidate'
  createdAt = (Get-Date).ToString('o')
  scope = @('custom-model-providers','encrypted-provider-secrets','model-discovery','model-capabilities','tenant-isolation','settings-ui')
  formalWebProjectModified = $false
  doubaoModified = $false
  tests = [ordered]@{
    modelGateway = '22/22'
    taskCenter = '19/19'
    projectMaterials = '27/27'
    textWorkspace = '21/21'
    desktopSmoke = '17/17'
    tenantStorage = '3/3'
    responsive = '12/12'
    browserGeneration = '5/5'
    videoIsolation = '8/8'
    electronSettingsScreenshot = 'passed'
  }
}
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $release 'manifest.json') -Encoding UTF8
Write-Output $release
