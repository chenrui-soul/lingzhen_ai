param(
    [switch]$RefreshDatabasePassword,
    [switch]$RotateHmacSecret,
    [string]$PostgresContainerName = 'lingframe-license-postgres'
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'runtime-configuration.ps1')

function Remove-OptionalQuotes {
    param([string]$Value)

    $trimmed = $Value.Trim()
    if ($trimmed.Length -ge 2) {
        if (($trimmed.StartsWith('"') -and $trimmed.EndsWith('"')) -or
            ($trimmed.StartsWith("'") -and $trimmed.EndsWith("'"))) {
            return $trimmed.Substring(1, $trimmed.Length - 2)
        }
    }
    return $trimmed
}

function Get-DatabasePasswordFromEnvironmentFile {
    $backendRoot = Get-LingZhenBackendRoot
    $environmentPath = Join-Path (Split-Path -Parent $backendRoot) '.env.postgres'
    if (-not (Test-Path -LiteralPath $environmentPath)) {
        return $null
    }

    foreach ($line in Get-Content -LiteralPath $environmentPath) {
        if ($line -match '^\s*APP_DB_PASSWORD\s*=\s*(.+?)\s*$') {
            return Remove-OptionalQuotes -Value $matches[1]
        }
    }
    return $null
}

function Get-DatabasePasswordFromContainer {
    param([string]$ContainerName)

    $docker = Get-Command docker -ErrorAction SilentlyContinue
    if ($null -eq $docker) {
        return $null
    }

    $inspectionJson = & $docker.Source inspect $ContainerName 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace(($inspectionJson -join ''))) {
        return $null
    }

    $inspection = ($inspectionJson -join [Environment]::NewLine) | ConvertFrom-Json
    foreach ($entry in @($inspection[0].Config.Env)) {
        if ($entry -like 'APP_DB_PASSWORD=*') {
            return $entry.Substring('APP_DB_PASSWORD='.Length)
        }
    }
    return $null
}

function New-HmacSecret {
    $bytes = [byte[]]::new(64)
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    return [Convert]::ToBase64String($bytes)
}

$existingDocument = $null
$existingValues = $null
$secretPath = Get-LingZhenRuntimeSecretPath
if (Test-Path -LiteralPath $secretPath) {
    $existingDocument = Read-LingZhenRuntimeSecretDocument
    $existingValues = Get-LingZhenRuntimeSecretValues
}

if ($null -ne $existingValues -and -not $RefreshDatabasePassword -and -not $RotateHmacSecret) {
    $existingValues = $null
    [pscustomobject]@{
        status = 'already_configured'
        path = $secretPath
        encryption = 'Windows DPAPI CurrentUser'
        databasePasswordRefreshed = $false
        hmacSecretRotated = $false
    } | ConvertTo-Json -Compress
    return
}

$databasePassword = $null
$hmacSecret = $null
try {
    if ($null -ne $existingValues -and -not $RefreshDatabasePassword) {
        $databasePassword = $existingValues.DatabasePassword
    }
    elseif (-not [string]::IsNullOrWhiteSpace($env:APP_DB_PASSWORD)) {
        $databasePassword = $env:APP_DB_PASSWORD
    }
    else {
        $databasePassword = Get-DatabasePasswordFromEnvironmentFile
        if ([string]::IsNullOrWhiteSpace($databasePassword)) {
            $databasePassword = Get-DatabasePasswordFromContainer -ContainerName $PostgresContainerName
        }
    }

    if ([string]::IsNullOrWhiteSpace($databasePassword)) {
        throw 'APP_DB_PASSWORD was not found in the process environment, local .env.postgres, or PostgreSQL container'
    }

    if ($null -ne $existingValues -and -not $RotateHmacSecret) {
        $hmacSecret = $existingValues.HmacSecret
    }
    else {
        $hmacSecret = New-HmacSecret
    }

    $createdAt = if ($null -ne $existingDocument) { [string]$existingDocument.createdAt } else { $null }
    $writtenPath = Write-LingZhenRuntimeSecretDocument `
        -DatabasePassword $databasePassword `
        -HmacSecret $hmacSecret `
        -CreatedAt $createdAt

    [pscustomobject]@{
        status = 'configured'
        path = $writtenPath
        encryption = 'Windows DPAPI CurrentUser'
        databasePasswordRefreshed = [bool]($RefreshDatabasePassword -or $null -eq $existingValues)
        hmacSecretRotated = [bool]($RotateHmacSecret -or $null -eq $existingValues)
    } | ConvertTo-Json -Compress
}
finally {
    $databasePassword = $null
    $hmacSecret = $null
    $existingValues = $null
}
