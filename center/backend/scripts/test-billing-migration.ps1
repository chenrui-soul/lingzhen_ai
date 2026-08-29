param()

$ErrorActionPreference = 'Stop'
$containerName = 'lingframe-billing-migration-test'
$backendRoot = Split-Path -Parent $PSScriptRoot
$solutionRoot = Split-Path -Parent $backendRoot
$migrationRoot = Join-Path $backendRoot 'src\main\resources\db\migration'
$rollbackRoot = Join-Path $backendRoot 'src\main\resources\db\rollback'
$assertionFile = Join-Path $backendRoot 'src\test\resources\db\migration\billing_assertions.sql'
$rechargeAssertionFile = Join-Path $backendRoot 'src\test\resources\db\migration\recharge_payment_assertions.sql'
$manualRechargeAssertionFile = Join-Path $backendRoot 'src\test\resources\db\migration\manual_recharge_assertions.sql'
$fixtureFile = Join-Path $backendRoot 'references\billing_migration_fixture.sql'
$groundTruthFile = Join-Path $backendRoot 'references\credit_domain_ground_truth.json'
$bootstrapFile = Join-Path $solutionRoot 'database\init\002-bootstrap.sql'
$logRoot = Join-Path $PSScriptRoot 'log'
$logFile = Join-Path $logRoot ("billing-migration-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$containerStarted = $false
$transcriptStarted = $false
$passCount = 0

New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
Start-Transcript -LiteralPath $logFile -Force | Out-Null
$transcriptStarted = $true

function Write-Pass {
    param([Parameter(Mandatory = $true)][string]$Message)
    $script:passCount++
    Write-Host "[PASS] $Message"
}

function Invoke-SqlFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [switch]$UsesOwnTransaction
    )
    $content = Get-Content -Raw -LiteralPath $Path
    if ($UsesOwnTransaction) {
        $content | docker exec -i $containerName psql `
            --username lingframe_owner `
            --dbname lingframe_identity `
            --set ON_ERROR_STOP=1 `
            --quiet
    }
    else {
        $content | docker exec -i $containerName psql `
            --username lingframe_owner `
            --dbname lingframe_identity `
            --set ON_ERROR_STOP=1 `
            --single-transaction `
            --quiet
    }
    if ($LASTEXITCODE -ne 0) {
        throw "SQL execution failed: $Path"
    }
}

function Invoke-ExpectedSqlFileFailure {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$ExpectedText
    )
    $content = Get-Content -Raw -LiteralPath $Path
    $output = $content | docker exec -i $containerName psql `
        --username lingframe_owner `
        --dbname lingframe_identity `
        --set ON_ERROR_STOP=1 `
        --single-transaction 2>&1
    $exitCode = $LASTEXITCODE
    if ($exitCode -eq 0 -or (($output -join "`n") -notmatch [regex]::Escape($ExpectedText))) {
        throw "Expected SQL failure was not observed: $ExpectedText"
    }
}

function Invoke-OwnerSql {
    param([Parameter(Mandatory = $true)][string]$Sql)
    docker exec $containerName psql `
        --username lingframe_owner `
        --dbname lingframe_identity `
        --set ON_ERROR_STOP=1 `
        --command $Sql `
        --quiet
    if ($LASTEXITCODE -ne 0) {
        throw "Owner SQL failed: $Sql"
    }
}

function Invoke-AppSql {
    param([Parameter(Mandatory = $true)][string]$Sql)
    docker exec $containerName psql `
        --username lingframe_app `
        --dbname lingframe_identity `
        --set ON_ERROR_STOP=1 `
        --command $Sql `
        --quiet
    if ($LASTEXITCODE -ne 0) {
        throw "Application SQL failed: $Sql"
    }
}

function Assert-ExpectedAppFailure {
    param(
        [Parameter(Mandatory = $true)][string]$Sql,
        [Parameter(Mandatory = $true)][string]$PassMessage
    )
    docker exec $containerName psql `
        --username lingframe_app `
        --dbname lingframe_identity `
        --set ON_ERROR_STOP=1 `
        --command $Sql *> $null
    if ($LASTEXITCODE -eq 0) {
        throw "Application role unexpectedly succeeded: $Sql"
    }
    Write-Pass $PassMessage
}

function Assert-ExpectedAppSqlFailure {
    param(
        [Parameter(Mandatory = $true)][string]$Sql,
        [Parameter(Mandatory = $true)][string]$ExpectedText,
        [Parameter(Mandatory = $true)][string]$PassMessage
    )
    $output = docker exec $containerName psql `
        --username lingframe_app `
        --dbname lingframe_identity `
        --set ON_ERROR_STOP=1 `
        --command $Sql 2>&1
    $exitCode = $LASTEXITCODE
    if ($exitCode -eq 0 -or (($output -join "`n") -notmatch [regex]::Escape($ExpectedText))) {
        throw "Expected application SQL failure was not observed: $ExpectedText"
    }
    Write-Pass $PassMessage
}

try {
    Write-Host "Isolated billing migration log: $logFile"
    Write-Host 'Production boundary: 127.0.0.1:5433/lingframe_identity will not be contacted.'

    docker inspect $containerName *> $null
    if ($LASTEXITCODE -eq 0) {
        throw "Temporary container already exists: $containerName"
    }

    docker run --rm --detach `
        --name $containerName `
        --env POSTGRES_HOST_AUTH_METHOD=trust `
        --env POSTGRES_USER=lingframe_owner `
        --env POSTGRES_DB=lingframe_identity `
        postgres:16-alpine *> $null
    if ($LASTEXITCODE -ne 0) {
        throw 'Failed to start isolated PostgreSQL container'
    }
    $containerStarted = $true

    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        docker exec $containerName pg_isready `
            --host 127.0.0.1 `
            --port 5432 `
            --username lingframe_owner `
            --dbname lingframe_identity *> $null
        if ($LASTEXITCODE -eq 0) {
            $ready = $true
            break
        }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready) {
        throw 'Isolated PostgreSQL did not become ready'
    }

    Invoke-OwnerSql "CREATE ROLE lingframe_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION"
    Invoke-SqlFile -Path $bootstrapFile -UsesOwnTransaction
    Write-Pass 'V1 bootstrap applied inside isolated container'

    $baseMigrationNames = @(
        'V2__create_identity_tables.sql',
        'V3__create_access_control_tables.sql',
        'V4__seed_identity_rbac_catalog.sql',
        'V5__create_model_catalog_tables.sql',
        'V6__create_desktop_workspace_tables.sql'
    )
    foreach ($migrationName in $baseMigrationNames) {
        Invoke-SqlFile -Path (Join-Path $migrationRoot $migrationName)
        Write-Pass "base chain $migrationName"
    }

    Invoke-SqlFile -Path $fixtureFile
    Write-Pass 'legacy multi-tenant credit fixture created with matching balances'

    $v7File = Join-Path $migrationRoot 'V7__create_billing_tables.sql'
    $v8File = Join-Path $migrationRoot 'V8__create_recharge_payment_commands.sql'
    $v9File = Join-Path $migrationRoot 'V9__create_manual_recharge_review.sql'
    $u8File = Join-Path $rollbackRoot 'U8__drop_recharge_payment_commands.sql'
    $u9File = Join-Path $rollbackRoot 'U9__drop_manual_recharge_review.sql'
    Invoke-SqlFile -Path $v7File
    Write-Pass 'V7 billing schema applied without summing duplicate tenant balances'
    Invoke-SqlFile -Path $v8File
    Write-Pass 'V8 recharge and Sandbox payment command functions applied'
    Invoke-SqlFile -Path $v9File
    Write-Pass 'V9 manual recharge review functions applied'

    $truth = Get-Content -Raw -LiteralPath $groundTruthFile | ConvertFrom-Json
    $tableOutput = docker exec $containerName psql `
        --username lingframe_owner `
        --dbname lingframe_identity `
        --tuples-only `
        --no-align `
        --command "SELECT tablename FROM pg_tables WHERE schemaname = 'billing' ORDER BY tablename"
    if ($LASTEXITCODE -ne 0) {
        throw 'Failed to read billing tables'
    }
    $actualTables = @(
        $tableOutput -split "`r?`n" |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ }
    )
    $expectedTables = @($truth.database.tables | Sort-Object)
    if (Compare-Object -ReferenceObject $expectedTables -DifferenceObject ($actualTables | Sort-Object)) {
        throw "Billing table mismatch. Expected: $($expectedTables -join ', '); actual: $($actualTables -join ', ')"
    }
    Write-Pass 'Ground Truth billing table set matches PostgreSQL catalog'

    Invoke-SqlFile -Path $assertionFile -UsesOwnTransaction
    Write-Pass 'billing constraints, migration semantics, idempotency and immutability assertions'
    Invoke-SqlFile -Path $rechargeAssertionFile -UsesOwnTransaction
    Write-Pass 'V8 command functions use safe definer privileges without direct table writes'
    Invoke-SqlFile -Path $manualRechargeAssertionFile -UsesOwnTransaction
    Write-Pass 'V9 manual review structure and least privilege assertions'

    Invoke-AppSql "INSERT INTO identity.users (id,username,password_hash) VALUES ('42000000-0000-4000-8000-000000000099','billing_new_user','argon2id-test-hash')"
    $newWalletState = docker exec $containerName psql `
        --username lingframe_owner `
        --dbname lingframe_identity `
        --tuples-only `
        --no-align `
        --command "SELECT available_balance, reserved_balance FROM billing.user_wallets WHERE user_id = '42000000-0000-4000-8000-000000000099'"
    if ($LASTEXITCODE -ne 0 -or $newWalletState.Trim() -ne '0|0') {
        throw "New user wallet provisioning failed: $newWalletState"
    }
    Write-Pass 'new users receive a zero-balance global wallet through the protected trigger'

    Assert-ExpectedAppFailure `
        -Sql "UPDATE billing.user_wallets SET available_balance = available_balance WHERE false" `
        -PassMessage 'application role direct wallet UPDATE denied'
    Assert-ExpectedAppFailure `
        -Sql "INSERT INTO billing.credit_ledger_entries (id,user_id,entry_type,available_delta,reserved_delta,available_after,reserved_after,business_type,business_id,idempotency_key) VALUES ('4c000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-000000000001','recharge',1,0,126,0,'forbidden','1','forbidden')" `
        -PassMessage 'application role direct ledger INSERT denied'
    Assert-ExpectedAppFailure `
        -Sql "DELETE FROM billing.credit_ledger_entries WHERE false" `
        -PassMessage 'application role ledger DELETE denied'

    Invoke-AppSql "SELECT id FROM billing.create_recharge_package('4d000000-0000-4000-8000-000000000001','sandbox_110','Sandbox 110',1000,100,10,10,'42000000-0000-4000-8000-000000000001')"
    Invoke-AppSql "SELECT id FROM billing.update_recharge_package('4d000000-0000-4000-8000-000000000001','Sandbox 110',1000,100,10,'active',10,0)"
    Invoke-AppSql "SELECT id FROM billing.create_recharge_order('4e000000-0000-4000-8000-000000000001','LZ202608260001','42000000-0000-4000-8000-000000000001','4d000000-0000-4000-8000-000000000001','sandbox','sandbox-order-0001',now() + interval '30 minutes')"
    Invoke-AppSql "SELECT order_status FROM billing.apply_sandbox_payment('4e000000-0000-4000-8000-000000000001','SBX-event-0001','event-0001',1000,now(),'4f000000-0000-4000-8000-000000000001')"
    Invoke-AppSql "SELECT order_status FROM billing.apply_sandbox_payment('4e000000-0000-4000-8000-000000000001','SBX-event-0001','event-0001',1000,now(),'4f000000-0000-4000-8000-000000000002')"
    Invoke-OwnerSql "DO `$`$ BEGIN IF (SELECT available_balance FROM billing.user_wallets WHERE user_id='42000000-0000-4000-8000-000000000001') <> 235 THEN RAISE EXCEPTION 'sandbox wallet credit mismatch'; END IF; IF (SELECT count(*) FROM billing.credit_ledger_entries WHERE recharge_order_id='4e000000-0000-4000-8000-000000000001') <> 1 THEN RAISE EXCEPTION 'sandbox duplicate ledger entry'; END IF; END `$`$"
    Write-Pass 'duplicate Sandbox success event credits the wallet and ledger exactly once'

    Invoke-AppSql "SELECT id FROM billing.create_recharge_order('4e000000-0000-4000-8000-000000000002','LZ202608260002','42000000-0000-4000-8000-000000000001','4d000000-0000-4000-8000-000000000001','sandbox','sandbox-order-0002',now() + interval '30 minutes')"
    Assert-ExpectedAppSqlFailure `
        -Sql "SELECT * FROM billing.apply_sandbox_payment('4e000000-0000-4000-8000-000000000002','SBX-event-0002','event-0002',999,now(),'4f000000-0000-4000-8000-000000000003')" `
        -ExpectedText 'PAYMENT_AMOUNT_MISMATCH' `
        -PassMessage 'Sandbox amount mismatch is rejected without wallet mutation'

    Invoke-AppSql "SELECT id FROM billing.create_manual_recharge_order('4e000000-0000-4000-8000-000000000010','LZ202608260010','42000000-0000-4000-8000-000000000001','4d000000-0000-4000-8000-000000000001','manual-order-0010',now() + interval '7 days','已完成线下转账')"
    Invoke-AppSql "SELECT order_status FROM billing.approve_manual_recharge_order('4e000000-0000-4000-8000-000000000010','42000000-0000-4000-8000-000000000001','已核实到账',now(),'4f000000-0000-4000-8000-000000000010')"
    Invoke-AppSql "SELECT order_status FROM billing.approve_manual_recharge_order('4e000000-0000-4000-8000-000000000010','42000000-0000-4000-8000-000000000001','重复核对',now(),'4f000000-0000-4000-8000-000000000011')"
    Invoke-OwnerSql "DO `$`$ BEGIN IF (SELECT available_balance FROM billing.user_wallets WHERE user_id='42000000-0000-4000-8000-000000000001') <> 345 THEN RAISE EXCEPTION 'manual wallet credit mismatch'; END IF; IF (SELECT count(*) FROM billing.credit_ledger_entries WHERE recharge_order_id='4e000000-0000-4000-8000-000000000010') <> 1 THEN RAISE EXCEPTION 'manual duplicate ledger entry'; END IF; END `$`$"
    Write-Pass 'duplicate manual approval credits wallet and immutable ledger exactly once'

    Invoke-AppSql "SELECT id FROM billing.create_manual_recharge_order('4e000000-0000-4000-8000-000000000011','LZ202608260011','42000000-0000-4000-8000-000000000001','4d000000-0000-4000-8000-000000000001','manual-order-0011',now() + interval '7 days','等待核对')"
    Invoke-AppSql "SELECT id FROM billing.reject_manual_recharge_order('4e000000-0000-4000-8000-000000000011','42000000-0000-4000-8000-000000000001','未查询到款项',now())"
    Invoke-OwnerSql "DO `$`$ BEGIN IF (SELECT status FROM billing.recharge_orders WHERE id='4e000000-0000-4000-8000-000000000011') <> 'rejected' OR (SELECT available_balance FROM billing.user_wallets WHERE user_id='42000000-0000-4000-8000-000000000001') <> 345 THEN RAISE EXCEPTION 'manual rejection changed wallet'; END IF; END `$`$"
    Write-Pass 'manual rejection records reason without wallet mutation'

    Invoke-AppSql "SELECT id FROM billing.create_manual_recharge_order('4e000000-0000-4000-8000-000000000012','LZ202608260012','42000000-0000-4000-8000-000000000001','4d000000-0000-4000-8000-000000000001','manual-order-0012',now() + interval '7 days',null)"
    Invoke-AppSql "SELECT id FROM billing.cancel_manual_recharge_order('4e000000-0000-4000-8000-000000000012','42000000-0000-4000-8000-000000000001',now())"
    Invoke-OwnerSql "DO `$`$ BEGIN IF (SELECT status FROM billing.recharge_orders WHERE id='4e000000-0000-4000-8000-000000000012') <> 'closed' THEN RAISE EXCEPTION 'manual cancellation failed'; END IF; END `$`$"
    Write-Pass 'desktop owner can cancel an open manual recharge request'

    Invoke-SqlFile -Path $u9File
    Write-Pass 'U9 removes manual review functions and columns after safely closing unfinished orders'
    Invoke-OwnerSql "DO `$`$ BEGIN IF to_regprocedure('billing.approve_manual_recharge_order(uuid,uuid,character varying,timestamp with time zone,uuid)') IS NOT NULL OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='billing' AND table_name='recharge_orders' AND column_name='submission_note') THEN RAISE EXCEPTION 'U9 isolation failed'; END IF; END `$`$"
    Write-Pass 'U9 preserves V8 recharge and billing data'

    Invoke-SqlFile -Path $u8File
    Write-Pass 'U8 removes only recharge command functions'
    Invoke-OwnerSql "DO `$`$ BEGIN IF to_regprocedure('billing.apply_sandbox_payment(uuid,character varying,character varying,bigint,timestamp with time zone,uuid)') IS NOT NULL OR to_regclass('billing.user_wallets') IS NULL THEN RAISE EXCEPTION 'U8 isolation failed'; END IF; END `$`$"
    Write-Pass 'U8 preserves the V7 billing schema and data'

    Invoke-SqlFile -Path (Join-Path $rollbackRoot 'U7__drop_billing_tables.sql')
    Write-Pass 'U7__drop_billing_tables.sql'

    $rollbackState = docker exec $containerName psql `
        --username lingframe_owner `
        --dbname lingframe_identity `
        --tuples-only `
        --no-align `
        --command "SELECT to_regnamespace('billing') IS NULL, to_regnamespace('desktop_data') IS NOT NULL, (SELECT count(*) FROM desktop_data.credit_accounts), (SELECT min(balance) FROM desktop_data.credit_accounts), (SELECT max(balance) FROM desktop_data.credit_accounts)"
    if ($LASTEXITCODE -ne 0 -or $rollbackState.Trim() -ne 't|t|2|125|125') {
        throw "U7 isolation verification failed: $rollbackState"
    }
    Write-Pass 'U7 removed only billing and preserved legacy credit data'

    Invoke-OwnerSql "UPDATE desktop_data.credit_accounts SET balance = 80 WHERE id = '44000000-0000-4000-8000-000000000002'"
    Invoke-ExpectedSqlFileFailure `
        -Path $v7File `
        -ExpectedText 'legacy credit balance conflict'
    Write-Pass 'conflicting legacy tenant balances abort V7 atomically'

    $conflictState = docker exec $containerName psql `
        --username lingframe_owner `
        --dbname lingframe_identity `
        --tuples-only `
        --no-align `
        --command "SELECT to_regnamespace('billing') IS NULL, min(balance), max(balance) FROM desktop_data.credit_accounts"
    if ($LASTEXITCODE -ne 0 -or $conflictState.Trim() -ne 't|80|125') {
        throw "Conflict rollback verification failed: $conflictState"
    }
    Write-Pass 'failed V7 leaves billing absent and legacy balances untouched'

    Invoke-OwnerSql "UPDATE desktop_data.credit_accounts SET balance = 125 WHERE id = '44000000-0000-4000-8000-000000000002'"
    Invoke-SqlFile -Path $v7File
    Write-Pass 'V7 reapplied after resolving legacy balance conflict'
    Invoke-SqlFile -Path $v8File
    Write-Pass 'V8 reapplied after V7 recovery'
    Invoke-SqlFile -Path $v9File
    Write-Pass 'V9 reapplied after V8 recovery'
    Invoke-SqlFile -Path $assertionFile -UsesOwnTransaction
    Write-Pass 'billing assertions pass after V7 reapply'
    Invoke-SqlFile -Path $rechargeAssertionFile -UsesOwnTransaction
    Write-Pass 'recharge command assertions pass after V8 reapply'
    Invoke-SqlFile -Path $manualRechargeAssertionFile -UsesOwnTransaction
    Write-Pass 'manual recharge assertions pass after V9 reapply'

    Write-Host "Billing migration test completed successfully. Passed check groups: $passCount"
    Write-Host "Log saved to: $logFile"
}
finally {
    if ($containerStarted) {
        docker stop --time 5 $containerName *> $null
    }
    if ($transcriptStarted) {
        Stop-Transcript | Out-Null
    }
}
