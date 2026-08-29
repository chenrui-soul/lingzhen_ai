param(
    [switch]$AllowExpectedPortOwner
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'runtime-configuration.ps1')

$candidateProcessIds = [System.Collections.Generic.HashSet[int]]::new()
$pidPath = Get-LingZhenRuntimePidPath
if (Test-Path -LiteralPath $pidPath) {
    $pidDocument = Get-Content -LiteralPath $pidPath -Raw | ConvertFrom-Json
    if ($pidDocument.PSObject.Properties.Name -contains 'processId' -and
        $null -ne $pidDocument.processId) {
        [void]$candidateProcessIds.Add([int]$pidDocument.processId)
    }
    if ($pidDocument.PSObject.Properties.Name -contains 'launcherProcessId' -and
        $null -ne $pidDocument.launcherProcessId) {
        [void]$candidateProcessIds.Add([int]$pidDocument.launcherProcessId)
    }
}

if ($AllowExpectedPortOwner) {
    foreach ($listener in @(Get-NetTCPConnection -LocalPort 9001 -State Listen -ErrorAction SilentlyContinue)) {
        if (Test-LingZhenBackendProcess -ProcessId $listener.OwningProcess) {
            [void]$candidateProcessIds.Add([int]$listener.OwningProcess)
        }
    }
}

$stopped = @()
foreach ($processId in $candidateProcessIds) {
    if (-not (Test-LingZhenBackendProcess -ProcessId $processId)) {
        continue
    }

    Stop-Process -Id $processId
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while (Get-Process -Id $processId -ErrorAction SilentlyContinue) {
        if ([DateTime]::UtcNow -ge $deadline) {
            Stop-Process -Id $processId -Force
            break
        }
        Start-Sleep -Milliseconds 250
    }
    $stopped += $processId
}

if (Test-Path -LiteralPath $pidPath) {
    Remove-Item -LiteralPath $pidPath -Force
}

[pscustomobject]@{
    status = 'stopped'
    processIds = $stopped
} | ConvertTo-Json -Compress
