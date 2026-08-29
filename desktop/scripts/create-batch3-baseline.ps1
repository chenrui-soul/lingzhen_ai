$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$release = Join-Path $root 'scripts\release\desktop-batch3-token-verification-resume'
if (Test-Path -LiteralPath $release) { throw "Baseline already exists: $release" }
New-Item -ItemType Directory -Force -Path $release | Out-Null
$include = @('package.json','package-lock.json','README.md','启动灵帧AI桌面版预览.cmd','assets','references','src','tests','scripts\log')
foreach ($item in $include) { $source=Join-Path $root $item; if(Test-Path -LiteralPath $source){Copy-Item -LiteralPath $source -Destination $release -Recurse -Force} }
Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object { $_.FullName -notmatch '\\node_modules\\|\\scripts\\release\\' } | ForEach-Object { $hash=Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256; [PSCustomObject]@{Path=$_.FullName.Substring($root.Length+1);SHA256=$hash.Hash;Length=$_.Length} } | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $release 'baseline-hashes.json') -Encoding UTF8
Write-Output $release
