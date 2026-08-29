param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'runtime-configuration.ps1')

$passed = 0
function Confirm-Check {
    param(
        [Parameter(Mandatory = $true)]
        [bool]$Condition,

        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    if (-not $Condition) {
        throw "[FAIL] $Name"
    }
    $script:passed++
    Write-Host "[PASS] $Name"
}

$scriptFiles = @(
    'runtime-configuration.ps1',
    'initialize-runtime-secrets.ps1',
    'start-backend.ps1',
    'stop-backend.ps1',
    'test-runtime-configuration.ps1',
    'test-regression-baseline.ps1'
)
foreach ($scriptFile in $scriptFiles) {
    $tokens = $null
    $errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile(
        (Join-Path $PSScriptRoot $scriptFile),
        [ref]$tokens,
        [ref]$errors
    )
    Confirm-Check -Condition ($errors.Count -eq 0) -Name "PowerShell syntax: $scriptFile"
}

$runtimeRoot = Get-LingZhenRuntimeRoot
$backendRoot = Get-LingZhenBackendRoot
$secretPath = Get-LingZhenRuntimeSecretPath
$secretValues = Get-LingZhenRuntimeSecretValues
try {
    Confirm-Check -Condition ($secretPath.StartsWith($runtimeRoot, [StringComparison]::OrdinalIgnoreCase)) `
        -Name 'Secret file remains outside source and inside LOCALAPPDATA runtime root'

    $runtimeAcl = Get-Acl -LiteralPath $runtimeRoot
    $secretAcl = Get-Acl -LiteralPath $secretPath
    Confirm-Check -Condition ($runtimeAcl.AreAccessRulesProtected -and $secretAcl.AreAccessRulesProtected) `
        -Name 'Runtime directory and secret file disable inherited ACLs'

    $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $allowedSids = @($secretAcl.Access |
        Where-Object { $_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow } |
        ForEach-Object {
            $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
        } | Select-Object -Unique)
    Confirm-Check -Condition ($allowedSids.Count -eq 1 -and $allowedSids[0] -eq $currentSid) `
        -Name 'Secret file grants access only to the current Windows user'

    $secretJson = Get-Content -LiteralPath $secretPath -Raw
    Confirm-Check -Condition (
        -not $secretJson.Contains($secretValues.DatabasePassword) -and
        -not $secretJson.Contains($secretValues.HmacSecret)
    ) -Name 'Protected runtime document contains no plaintext secrets'

    $textFiles = @(Get-ChildItem -LiteralPath $backendRoot -Recurse -File |
        Where-Object {
            $_.FullName -notlike "$(Join-Path $backendRoot 'target')*" -and
            $_.FullName -notlike "$(Join-Path $backendRoot 'backups')*" -and
            $_.Extension -in @('.ps1', '.md', '.yml', '.yaml', '.xml', '.properties', '.json', '.log')
        }) + @(Get-ChildItem -LiteralPath $runtimeRoot -Recurse -File |
        Where-Object { $_.FullName -ne $secretPath -and $_.Extension -in @('.json', '.log') })
    $plaintextLeaks = 0
    foreach ($file in $textFiles) {
        $content = Get-Content -LiteralPath $file.FullName -Raw -ErrorAction SilentlyContinue
        if ($null -eq $content) {
            $content = ''
        }
        else {
            $content = [string]$content
        }
        if ($content.Contains($secretValues.DatabasePassword) -or $content.Contains($secretValues.HmacSecret)) {
            $plaintextLeaks++
        }
    }
    Confirm-Check -Condition ($plaintextLeaks -eq 0) -Name 'Source and backend logs contain no configured plaintext secrets'

    $listener = @(Get-NetTCPConnection -LocalPort 9001 -State Listen -ErrorAction SilentlyContinue)
    Confirm-Check -Condition ($listener.Count -eq 1 -and (Test-LingZhenBackendProcess -ProcessId $listener[0].OwningProcess)) `
        -Name 'Port 9001 is owned by the expected LingZhen Java backend'

    $live = Invoke-RestMethod -Uri 'http://127.0.0.1:9001/health/live' -TimeoutSec 5
    $ready = Invoke-RestMethod -Uri 'http://127.0.0.1:9001/health/ready' -TimeoutSec 5
    Confirm-Check -Condition ($live.status -eq 'UP' -and $ready.status -eq 'UP') `
        -Name 'Live and database readiness endpoints are UP'

    $unauthorizedStatus = 0
    try {
        Invoke-WebRequest -Uri 'http://127.0.0.1:9001/api/v1/auth/me' -TimeoutSec 5 | Out-Null
    }
    catch {
        $unauthorizedStatus = [int]$_.Exception.Response.StatusCode
    }
    Confirm-Check -Condition ($unauthorizedStatus -eq 401) -Name 'Protected identity endpoint still rejects anonymous access'

    $invalidLoginStatus = 0
    $deviceSeed = [Guid]::NewGuid().ToString('N')
    $deviceHashBytes = [System.Security.Cryptography.SHA256]::HashData(
        [System.Text.Encoding]::UTF8.GetBytes($deviceSeed)
    )
    $deviceHash = [Convert]::ToHexString($deviceHashBytes).ToLowerInvariant()
    $invalidLoginBody = @{
        identity = "runtime-check-$([Guid]::NewGuid().ToString('N'))@invalid.local"
        password = [Guid]::NewGuid().ToString('N')
        clientType = 'desktop'
        device = @{
            deviceHash = $deviceHash
            fingerprintVersion = 1
            displayName = 'runtime-configuration-check'
            platform = 'windows'
            architecture = 'x64'
            appVersion = 'runtime-check'
        }
    } | ConvertTo-Json -Depth 4
    try {
        Invoke-WebRequest `
            -Uri 'http://127.0.0.1:9001/api/v1/auth/login' `
            -Method Post `
            -ContentType 'application/json' `
            -Body $invalidLoginBody `
            -TimeoutSec 5 | Out-Null
    }
    catch {
        $invalidLoginStatus = [int]$_.Exception.Response.StatusCode
    }
    Confirm-Check -Condition ($invalidLoginStatus -eq 401) `
        -Name 'Login endpoint still reaches the identity flow and rejects invalid credentials'
}
finally {
    $secretValues = $null
}

Write-Host "Runtime configuration verification completed: $passed checks passed."
