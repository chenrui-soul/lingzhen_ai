$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
$logDir = Join-Path $root 'scripts\log'
$screenshot = Join-Path $logDir 'electron-desktop-smoke.png'
$stdout = Join-Path $logDir 'electron-desktop-smoke.stdout.log'
$stderr = Join-Path $logDir 'electron-desktop-smoke.stderr.log'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
if (-not (Test-Path -LiteralPath $electron)) { throw "Electron executable missing: $electron" }
$env:LINGFRAME_SMOKE = '1'
$env:LINGFRAME_SMOKE_SCREENSHOT = $screenshot
$process = Start-Process -FilePath $electron -ArgumentList @('.') -WorkingDirectory $root -WindowStyle Hidden -PassThru -Wait -RedirectStandardOutput $stdout -RedirectStandardError $stderr
Remove-Item Env:\LINGFRAME_SMOKE -ErrorAction SilentlyContinue
Remove-Item Env:\LINGFRAME_SMOKE_SCREENSHOT -ErrorAction SilentlyContinue
if ($process.ExitCode -ne 0) { throw "Electron smoke failed with code $($process.ExitCode): $(Get-Content -Raw $stderr)" }
if (-not (Test-Path -LiteralPath $screenshot)) { throw 'Electron smoke screenshot was not created' }
$stdoutText = Get-Content -Raw $stdout
if ($stdoutText -notmatch 'LINGFRAME_SMOKE_OK') { throw "Electron success marker missing: $stdoutText" }
$result = [ordered]@{test='desktop-batch1-electron-smoke'; passed=$true; exitCode=$process.ExitCode; screenshot=$screenshot; stdout=$stdout}
$result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $logDir 'desktop-batch1-electron-smoke.json') -Encoding UTF8
$result | ConvertTo-Json
