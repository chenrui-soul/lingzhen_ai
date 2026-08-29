param(
    [switch]$ReplaceExisting,
    [switch]$Build,
    [ValidateRange(15, 300)]
    [int]$StartupTimeoutSeconds = 90
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'runtime-configuration.ps1')

function Wait-ForBackendReady {
    param(
        [Parameter(Mandatory = $true)]
        [System.Diagnostics.Process]$Process,

        [Parameter(Mandatory = $true)]
        [int]$TimeoutSeconds
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($Process.HasExited) {
            throw "Backend process exited during startup with code $($Process.ExitCode)"
        }
        try {
            $live = Invoke-RestMethod -Uri 'http://127.0.0.1:9001/health/live' -TimeoutSec 3
            $ready = Invoke-RestMethod -Uri 'http://127.0.0.1:9001/health/ready' -TimeoutSec 3
            if ($live.status -eq 'UP' -and $ready.status -eq 'UP') {
                return
            }
        }
        catch {
            Start-Sleep -Milliseconds 500
        }
    }

    throw "Backend did not become ready within $TimeoutSeconds seconds"
}

$backendRoot = Get-LingZhenBackendRoot
$existingListeners = @(Get-NetTCPConnection -LocalPort 9001 -State Listen -ErrorAction SilentlyContinue)
$replaceCurrentBackend = $false
if ($existingListeners.Count -gt 0) {
    if (-not $ReplaceExisting) {
        throw 'Port 9001 is already in use. Pass -ReplaceExisting only when replacing the LingZhen backend process.'
    }
    foreach ($listener in $existingListeners) {
        if (-not (Test-LingZhenBackendProcess -ProcessId $listener.OwningProcess)) {
            throw "Port 9001 is owned by an unexpected process: $($listener.OwningProcess)"
        }
    }
    $replaceCurrentBackend = $true
}

if ($Build -and $replaceCurrentBackend) {
    & (Join-Path $PSScriptRoot 'stop-backend.ps1') -AllowExpectedPortOwner | Out-Null
    $replaceCurrentBackend = $false
}

if ($Build) {
    & (Join-Path $backendRoot 'mvnw.cmd') -q -DskipTests package
    if ($LASTEXITCODE -ne 0) {
        throw 'Backend build failed'
    }
}

$jar = Get-ChildItem -LiteralPath (Join-Path $backendRoot 'target') `
    -Filter 'lingzhen-center-backend-*.jar' -File |
    Where-Object { $_.Name -notlike '*.original' } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if ($null -eq $jar) {
    throw 'Executable backend JAR is missing. Run with -Build first.'
}

$secretValues = Get-LingZhenRuntimeSecretValues
if ($replaceCurrentBackend) {
    & (Join-Path $PSScriptRoot 'stop-backend.ps1') -AllowExpectedPortOwner | Out-Null
}

$java = Get-Command java.exe -ErrorAction Stop
$runtimeRoot = Initialize-LingZhenRuntimeDirectory
$logRoot = Join-Path $runtimeRoot 'logs'
if (-not (Test-Path -LiteralPath $logRoot)) {
    [void](New-Item -ItemType Directory -Path $logRoot -Force)
}
Set-LingZhenPrivateAcl -Path $logRoot
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stdoutPath = Join-Path $logRoot "backend-$timestamp.stdout.log"
$stderrPath = Join-Path $logRoot "backend-$timestamp.stderr.log"

$previousDatabasePassword = $env:APP_DB_PASSWORD
$previousHmacSecret = $env:APP_AUTH_HMAC_SECRET
$previousMinioEndpoint = $env:MINIO_ENDPOINT
$previousMinioRootUser = $env:MINIO_ROOT_USER
$previousMinioRootPassword = $env:MINIO_ROOT_PASSWORD
$previousMinioBucket = $env:MINIO_BUCKET
$minioEnvPath = Join-Path (Split-Path -Parent $backendRoot) '.env.minio'
$minioEnv = @{}
if (Test-Path -LiteralPath $minioEnvPath) {
    foreach ($line in Get-Content -LiteralPath $minioEnvPath) {
        if ($line -match '^\s*([^#=]+)=(.*)$') { $minioEnv[$matches[1].Trim()] = $matches[2].Trim() }
    }
}
$process = $null
try {
    $env:APP_DB_PASSWORD = $secretValues.DatabasePassword
    $env:APP_AUTH_HMAC_SECRET = $secretValues.HmacSecret
    if ($minioEnv.ContainsKey('MINIO_ENDPOINT')) { $env:MINIO_ENDPOINT = $minioEnv['MINIO_ENDPOINT'] }
    if ($minioEnv.ContainsKey('MINIO_ROOT_USER')) { $env:MINIO_ROOT_USER = $minioEnv['MINIO_ROOT_USER'] }
    if ($minioEnv.ContainsKey('MINIO_ROOT_PASSWORD')) { $env:MINIO_ROOT_PASSWORD = $minioEnv['MINIO_ROOT_PASSWORD'] }
    if ($minioEnv.ContainsKey('MINIO_BUCKET')) { $env:MINIO_BUCKET = $minioEnv['MINIO_BUCKET'] }
    $quotedJarPath = '"' + $jar.FullName + '"'
    $process = Start-Process `
        -FilePath $java.Source `
        -ArgumentList @('-jar', $quotedJarPath) `
        -WorkingDirectory $backendRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -PassThru
}
finally {
    if ($null -eq $previousDatabasePassword) {
        Remove-Item Env:APP_DB_PASSWORD -ErrorAction SilentlyContinue
    }
    else {
        $env:APP_DB_PASSWORD = $previousDatabasePassword
    }
    if ($null -eq $previousHmacSecret) {
        Remove-Item Env:APP_AUTH_HMAC_SECRET -ErrorAction SilentlyContinue
    }
    else {
        $env:APP_AUTH_HMAC_SECRET = $previousHmacSecret
    }
    foreach ($name in @('MINIO_ENDPOINT','MINIO_ROOT_USER','MINIO_ROOT_PASSWORD','MINIO_BUCKET')) {
        if ($name -eq 'MINIO_ENDPOINT') { $priorValue = $previousMinioEndpoint }
        elseif ($name -eq 'MINIO_ROOT_USER') { $priorValue = $previousMinioRootUser }
        elseif ($name -eq 'MINIO_ROOT_PASSWORD') { $priorValue = $previousMinioRootPassword }
        else { $priorValue = $previousMinioBucket }
        if ($null -eq $priorValue) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue } else { Set-Item "Env:$name" $priorValue }
    }
    $quotedJarPath = $null
    $secretValues = $null
}

try {
    Wait-ForBackendReady -Process $process -TimeoutSeconds $StartupTimeoutSeconds
}
catch {
    if ($null -ne $process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force
    }
    foreach ($listener in @(Get-NetTCPConnection -LocalPort 9001 -State Listen -ErrorAction SilentlyContinue)) {
        if (Test-LingZhenBackendProcess -ProcessId $listener.OwningProcess) {
            Stop-Process -Id $listener.OwningProcess -Force
        }
    }
    throw
}

$backendProcessId = 0
try {
    $readyListeners = @(Get-NetTCPConnection -LocalPort 9001 -State Listen -ErrorAction Stop)
    if ($readyListeners.Count -ne 1 -or
        -not (Test-LingZhenBackendProcess -ProcessId $readyListeners[0].OwningProcess)) {
        throw 'Backend became healthy but the port owner could not be identified safely'
    }
    $backendProcessId = [int]$readyListeners[0].OwningProcess
    $pidPath = Get-LingZhenRuntimePidPath
    Write-LingZhenRuntimeJson -Path $pidPath -Value ([ordered]@{
        processId = $backendProcessId
        launcherProcessId = $process.Id
        startedAt = [DateTimeOffset]::Now.ToString('o')
        executable = $java.Source
        jar = $jar.FullName
        port = 9001
        stdoutLog = $stdoutPath
        stderrLog = $stderrPath
    })
}
catch {
    foreach ($listener in @(Get-NetTCPConnection -LocalPort 9001 -State Listen -ErrorAction SilentlyContinue)) {
        if (Test-LingZhenBackendProcess -ProcessId $listener.OwningProcess) {
            Stop-Process -Id $listener.OwningProcess -Force
        }
    }
    if ($null -ne $process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force
    }
    throw
}

[pscustomobject]@{
    status = 'ready'
    processId = $backendProcessId
    port = 9001
    live = 'UP'
    ready = 'UP'
    stdoutLog = $stdoutPath
    stderrLog = $stderrPath
} | ConvertTo-Json -Compress
