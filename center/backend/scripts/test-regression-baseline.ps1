param(
    [Parameter(Mandatory = $true)]
    [string]$DesktopRoot
)

$ErrorActionPreference = 'Stop'
$backendRoot = Split-Path -Parent $PSScriptRoot
$resolvedDesktopRoot = (Resolve-Path -LiteralPath $DesktopRoot).Path

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        [scriptblock]$Action
    )

    & $Action
    if ($LASTEXITCODE -ne 0) {
        throw "Regression baseline failed: $Name"
    }
    Write-Host "[PASS] $Name"
}

Push-Location $backendRoot
try {
    Invoke-CheckedCommand -Name 'Spring Boot tests' -Action { & .\mvnw.cmd test }
}
finally {
    Pop-Location
}

Push-Location $resolvedDesktopRoot
try {
    Invoke-CheckedCommand -Name 'Desktop authentication tests' -Action { & node scripts/test-desktop-auth.cjs }
    Invoke-CheckedCommand -Name 'Desktop smoke tests' -Action { & npm test }
}
finally {
    Pop-Location
}

$live = Invoke-RestMethod -Uri 'http://127.0.0.1:9001/health/live' -TimeoutSec 5
$ready = Invoke-RestMethod -Uri 'http://127.0.0.1:9001/health/ready' -TimeoutSec 5
if ($live.status -ne 'UP' -or $ready.status -ne 'UP') {
    throw 'Regression baseline failed: live/ready health endpoints'
}
Write-Host '[PASS] live/ready health endpoints'
Write-Host 'Regression baseline completed successfully.'
