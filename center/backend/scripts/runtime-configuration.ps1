Set-StrictMode -Version Latest

$script:RuntimeSchemaVersion = 1
$script:RuntimeApplicationName = 'LingZhenAI'
$script:RuntimeComponentName = 'center-backend'
$script:RuntimeSecretFileName = 'runtime-secrets.json'
$script:RuntimePidFileName = 'backend.pid.json'

function Get-LingZhenBackendRoot {
    return Split-Path -Parent $PSScriptRoot
}

function Get-LingZhenRuntimeRoot {
    if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        throw 'LOCALAPPDATA is required to resolve the protected runtime directory'
    }

    $localAppData = [System.IO.Path]::GetFullPath($env:LOCALAPPDATA)
    $runtimeRoot = [System.IO.Path]::GetFullPath(
        (Join-Path $localAppData "$script:RuntimeApplicationName\$script:RuntimeComponentName")
    )
    if (-not $runtimeRoot.StartsWith($localAppData, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Resolved runtime directory is outside LOCALAPPDATA'
    }

    return $runtimeRoot
}

function Get-LingZhenRuntimeSecretPath {
    return Join-Path (Get-LingZhenRuntimeRoot) $script:RuntimeSecretFileName
}

function Get-LingZhenRuntimePidPath {
    return Join-Path (Get-LingZhenRuntimeRoot) $script:RuntimePidFileName
}

function Set-LingZhenPrivateAcl {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        throw 'Windows DPAPI runtime configuration is only supported on Windows'
    }
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Cannot protect a missing path: $Path"
    }

    $account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $item = Get-Item -LiteralPath $Path
    if ($item.PSIsContainer) {
        $grant = "${account}:(OI)(CI)F"
    }
    else {
        $grant = "${account}:F"
    }

    & icacls.exe $Path /inheritance:r /grant:r $grant /Q | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to protect runtime path ACL: $Path"
    }
}

function Initialize-LingZhenRuntimeDirectory {
    $runtimeRoot = Get-LingZhenRuntimeRoot
    if (-not (Test-Path -LiteralPath $runtimeRoot)) {
        [void](New-Item -ItemType Directory -Path $runtimeRoot -Force)
    }
    Set-LingZhenPrivateAcl -Path $runtimeRoot
    return $runtimeRoot
}

function Protect-LingZhenPlainText {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Value
    )

    if ([string]::IsNullOrEmpty($Value)) {
        throw 'Secret value cannot be empty'
    }

    $secureValue = ConvertTo-SecureString -String $Value -AsPlainText -Force
    return ConvertFrom-SecureString -SecureString $secureValue
}

function Unprotect-LingZhenCipherText {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CipherText
    )

    if ([string]::IsNullOrWhiteSpace($CipherText)) {
        throw 'Protected secret cannot be empty'
    }

    $secureValue = ConvertTo-SecureString -String $CipherText
    $pointer = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
    try {
        return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

function Read-LingZhenRuntimeSecretDocument {
    $secretPath = Get-LingZhenRuntimeSecretPath
    if (-not (Test-Path -LiteralPath $secretPath)) {
        throw "Protected runtime configuration is missing: $secretPath"
    }

    $document = Get-Content -LiteralPath $secretPath -Raw | ConvertFrom-Json
    if ($document.schemaVersion -ne $script:RuntimeSchemaVersion) {
        throw "Unsupported runtime configuration schema: $($document.schemaVersion)"
    }
    if ($document.encryptionScope -ne 'CurrentUserDpapi') {
        throw 'Runtime configuration encryption scope is invalid'
    }
    if ([string]::IsNullOrWhiteSpace($document.databasePasswordProtected) -or
        [string]::IsNullOrWhiteSpace($document.hmacSecretProtected)) {
        throw 'Runtime configuration is incomplete'
    }

    return $document
}

function Get-LingZhenRuntimeSecretValues {
    $document = Read-LingZhenRuntimeSecretDocument
    $databasePassword = Unprotect-LingZhenCipherText -CipherText $document.databasePasswordProtected
    $hmacSecret = Unprotect-LingZhenCipherText -CipherText $document.hmacSecretProtected

    if ([string]::IsNullOrWhiteSpace($databasePassword)) {
        throw 'Decrypted database password is empty'
    }
    try {
        $hmacBytes = [Convert]::FromBase64String($hmacSecret)
    }
    catch {
        throw 'Decrypted HMAC secret is not valid Base64'
    }
    if ($hmacBytes.Length -lt 32) {
        throw 'Decrypted HMAC secret must contain at least 32 bytes'
    }

    return [pscustomobject]@{
        DatabasePassword = $databasePassword
        HmacSecret = $hmacSecret
        CreatedAt = $document.createdAt
        UpdatedAt = $document.updatedAt
    }
}

function Write-LingZhenRuntimeSecretDocument {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DatabasePassword,

        [Parameter(Mandatory = $true)]
        [string]$HmacSecret,

        [string]$CreatedAt
    )

    $runtimeRoot = Initialize-LingZhenRuntimeDirectory
    $secretPath = Get-LingZhenRuntimeSecretPath
    $now = [DateTimeOffset]::Now.ToString('o')
    if ([string]::IsNullOrWhiteSpace($CreatedAt)) {
        $CreatedAt = $now
    }

    $document = [ordered]@{
        schemaVersion = $script:RuntimeSchemaVersion
        encryptionScope = 'CurrentUserDpapi'
        createdAt = $CreatedAt
        updatedAt = $now
        databasePasswordProtected = Protect-LingZhenPlainText -Value $DatabasePassword
        hmacSecretProtected = Protect-LingZhenPlainText -Value $HmacSecret
    }
    $json = $document | ConvertTo-Json -Depth 3
    $temporaryPath = Join-Path $runtimeRoot ("runtime-secrets-{0}.tmp" -f [Guid]::NewGuid().ToString('N'))
    try {
        [System.IO.File]::WriteAllText(
            $temporaryPath,
            $json,
            [System.Text.UTF8Encoding]::new($false)
        )
        Set-LingZhenPrivateAcl -Path $temporaryPath
        Move-Item -LiteralPath $temporaryPath -Destination $secretPath -Force
        Set-LingZhenPrivateAcl -Path $secretPath
    }
    finally {
        if (Test-Path -LiteralPath $temporaryPath) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }

    return $secretPath
}

function Write-LingZhenRuntimeJson {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [object]$Value
    )

    $runtimeRoot = Initialize-LingZhenRuntimeDirectory
    $resolvedPath = [System.IO.Path]::GetFullPath($Path)
    if (-not $resolvedPath.StartsWith($runtimeRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Runtime state file must remain inside the protected runtime directory'
    }

    $json = $Value | ConvertTo-Json -Depth 4
    $temporaryPath = Join-Path $runtimeRoot ("runtime-state-{0}.tmp" -f [Guid]::NewGuid().ToString('N'))
    try {
        [System.IO.File]::WriteAllText($temporaryPath, $json, [System.Text.UTF8Encoding]::new($false))
        Set-LingZhenPrivateAcl -Path $temporaryPath
        Move-Item -LiteralPath $temporaryPath -Destination $resolvedPath -Force
        Set-LingZhenPrivateAcl -Path $resolvedPath
    }
    finally {
        if (Test-Path -LiteralPath $temporaryPath) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }
}

function Test-LingZhenBackendProcess {
    param(
        [Parameter(Mandatory = $true)]
        [int]$ProcessId
    )

    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
    if ($null -eq $process -or $process.Name -ne 'java.exe') {
        return $false
    }

    $commandLine = [string]$process.CommandLine
    return $commandLine.Contains('com.lingzhen.center.LingzhenCenterApplication') -or
        $commandLine.Contains('lingzhen-center-backend-')
}
