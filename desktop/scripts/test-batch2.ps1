$ErrorActionPreference = 'Stop'
$Project = 'D:\project_v1\lingzhen_ai_desktop_v1'
$LogDir = Join-Path $Project 'scripts\log'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$results = @()
foreach ($test in @('tests/license-client.cjs','tests/tenant-storage.cjs','tests/agent-bridge.cjs','tests/agent-token-exchange.cjs','tests/browser-generation.cjs')) {
  $output = & node (Join-Path $Project $test) 2>&1
  $exitCode = $LASTEXITCODE
  $results += [ordered]@{test=$test; exitCode=$exitCode; output=($output -join "`n")}
  if ($exitCode -ne 0) { $results | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $LogDir 'desktop-batch2-tests.json'); throw "测试失败：$test" }
}
$report = [ordered]@{test='desktop-batch2-tests'; timestamp=(Get-Date).ToUniversalTime().ToString('o'); passed=$results.Count; failed=0; results=$results}
$report | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $LogDir 'desktop-batch2-tests.json')
$report | ConvertTo-Json -Depth 8
