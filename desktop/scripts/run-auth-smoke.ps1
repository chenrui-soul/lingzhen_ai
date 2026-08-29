$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$env:LINGFRAME_TEST_USER_DATA = Join-Path $projectRoot '.runtime-auth-smoke-user-data'
$env:LINGFRAME_IDENTITY_SERVER_URL = 'http://127.0.0.1:9001'
$env:LINGFRAME_AUTH_SMOKE = '1'
$env:LINGFRAME_AUTH_SMOKE_SCREENSHOT = Join-Path $projectRoot 'scripts\log\auth-login-1440.png'

if ($args -contains '-Compact') {
    $env:LINGFRAME_AUTH_SMOKE_COMPACT = '1'
    $env:LINGFRAME_AUTH_SMOKE_SCREENSHOT = Join-Path $projectRoot 'scripts\log\auth-login-1120x700.png'
}

if ($args -contains '-Register') {
    $env:LINGFRAME_AUTH_SMOKE_REGISTER = '1'
    $suffix = if ($args -contains '-Compact') { '1120x700' } else { '1440x900' }
    $env:LINGFRAME_AUTH_SMOKE_SCREENSHOT = Join-Path $projectRoot "scripts\log\auth-register-$suffix.png"
}

& npm start
exit $LASTEXITCODE
