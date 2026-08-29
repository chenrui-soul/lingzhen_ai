param()

$ErrorActionPreference = 'Stop'
$containerName = 'lingframe-schema-migration-test'
$backendRoot = Split-Path -Parent $PSScriptRoot
$solutionRoot = Split-Path -Parent $backendRoot
$migrationRoot = Join-Path $backendRoot 'src\main\resources\db\migration'
$rollbackRoot = Join-Path $backendRoot 'src\main\resources\db\rollback'
$identityAssertionFile = Join-Path $backendRoot 'src\test\resources\db\migration\identity_access_assertions.sql'
$modelAssertionFile = Join-Path $backendRoot 'src\test\resources\db\migration\model_catalog_assertions.sql'
$groundTruthFile = Join-Path $backendRoot 'references\model_catalog_migration_ground_truth.json'
$bootstrapFile = Join-Path $solutionRoot 'database\init\002-bootstrap.sql'
$logRoot = Join-Path $PSScriptRoot 'log'
$logFile = Join-Path $logRoot ("database-migrations-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$containerStarted = $false
$transcriptStarted = $false
$passCount = 0

New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
Start-Transcript -LiteralPath $logFile -Force | Out-Null
$transcriptStarted = $true

function Write-Pass {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    $script:passCount++
    Write-Host "[PASS] $Message"
}

function Invoke-SqlFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

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

function Invoke-VersionedMigrations {
    param(
        [Parameter(Mandatory = $true)]
        [System.IO.FileInfo[]]$MigrationFiles,

        [Parameter(Mandatory = $true)]
        [string]$Phase
    )

    foreach ($migration in $MigrationFiles) {
        Invoke-SqlFile -Path $migration.FullName
        Write-Pass "$Phase $($migration.Name)"
    }
}

function Invoke-Assertions {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Phase
    )

    Invoke-SqlFile -Path $identityAssertionFile -UsesOwnTransaction
    Write-Pass "$Phase identity constraints, terminal isolation, RBAC domains and least-privilege grants"

    Invoke-SqlFile -Path $modelAssertionFile -UsesOwnTransaction
    Write-Pass "$Phase model catalog constraints, publication immutability and tenant isolation"
}

function Assert-ExpectedFailure {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Sql,

        [Parameter(Mandatory = $true)]
        [string]$FailureMessage,

        [Parameter(Mandatory = $true)]
        [string]$PassMessage
    )

    $output = docker exec $containerName psql `
        --username lingframe_app `
        --dbname lingframe_identity `
        --set ON_ERROR_STOP=1 `
        --command $Sql 2>&1
    $exitCode = $LASTEXITCODE
    if ($exitCode -eq 0) {
        throw $FailureMessage
    }

    Write-Pass $PassMessage
}

try {
    Write-Host "Isolated migration log: $logFile"
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

    docker exec $containerName psql `
        --username lingframe_owner `
        --dbname lingframe_identity `
        --set ON_ERROR_STOP=1 `
        --command 'CREATE ROLE lingframe_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION' `
        --quiet
    if ($LASTEXITCODE -ne 0) {
        throw 'Failed to create isolated application role'
    }

    Invoke-SqlFile -Path $bootstrapFile -UsesOwnTransaction
    Write-Pass 'V1 bootstrap applied inside isolated container'

    $expectedMigrationNames = @(
        'V2__create_identity_tables.sql',
        'V3__create_access_control_tables.sql',
        'V4__seed_identity_rbac_catalog.sql',
        'V5__create_model_catalog_tables.sql'
    )
    $migrationFiles = @(
        $expectedMigrationNames |
            ForEach-Object { Get-Item -LiteralPath (Join-Path $migrationRoot $_) }
    )
    if ($migrationFiles.Count -ne $expectedMigrationNames.Count) {
        throw "Expected $($expectedMigrationNames.Count) model-catalog migrations, found $($migrationFiles.Count)"
    }

    if (Compare-Object -ReferenceObject $expectedMigrationNames -DifferenceObject $migrationFiles.Name) {
        throw "Unexpected migration chain: $($migrationFiles.Name -join ', ')"
    }

    foreach ($migration in $migrationFiles) {
        if ($migration.Name -notmatch '^V\d+__[a-z0-9_]+\.sql$') {
            throw "Invalid Flyway migration name: $($migration.Name)"
        }
        $migrationContent = Get-Content -Raw -LiteralPath $migration.FullName
        if ($migrationContent -match '(?i)\blicensing\b|\blicense\.') {
            throw "Retired licensing content found in active migration: $($migration.Name)"
        }
    }
    Write-Pass 'V2-V5 migration names and retired licensing static guard'

    Invoke-VersionedMigrations -MigrationFiles $migrationFiles -Phase 'initial chain'

    $groundTruth = Get-Content -Raw -LiteralPath $groundTruthFile | ConvertFrom-Json
    $tableOutput = docker exec $containerName psql `
        --username lingframe_owner `
        --dbname lingframe_identity `
        --tuples-only `
        --no-align `
        --command "SELECT tablename FROM pg_tables WHERE schemaname = 'model_catalog' ORDER BY tablename"
    if ($LASTEXITCODE -ne 0) {
        throw 'Failed to read model_catalog tables for Ground Truth validation'
    }

    $actualTables = @(
        $tableOutput -split "`r?`n" |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ }
    )
    $expectedTables = @($groundTruth.schema.tables | Sort-Object)
    if (Compare-Object -ReferenceObject $expectedTables -DifferenceObject ($actualTables | Sort-Object)) {
        throw "Ground Truth table mismatch. Expected: $($expectedTables -join ', '); actual: $($actualTables -join ', ')"
    }
    Write-Pass 'model_catalog Ground Truth table set matches PostgreSQL catalog'

    Invoke-Assertions -Phase 'initial chain'

    Assert-ExpectedFailure `
        -Sql 'CREATE TABLE identity.application_role_must_not_create_objects (id integer)' `
        -FailureMessage 'lingframe_app unexpectedly received DDL permission in identity schema' `
        -PassMessage 'application role identity DDL denied'

    Assert-ExpectedFailure `
        -Sql 'CREATE TABLE model_catalog.application_role_must_not_create_objects (id integer)' `
        -FailureMessage 'lingframe_app unexpectedly received DDL permission in model_catalog schema' `
        -PassMessage 'application role model_catalog DDL denied'

    Assert-ExpectedFailure `
        -Sql 'UPDATE identity.roles SET display_name = display_name WHERE false' `
        -FailureMessage 'lingframe_app unexpectedly received RBAC catalog write permission' `
        -PassMessage 'application role RBAC catalog writes denied'

    Assert-ExpectedFailure `
        -Sql 'DELETE FROM identity.users WHERE false' `
        -FailureMessage 'lingframe_app unexpectedly received hard-delete permission on identity.users' `
        -PassMessage 'application role identity hard deletes denied'

    Assert-ExpectedFailure `
        -Sql 'UPDATE model_catalog.catalog_version_items SET display_name = display_name WHERE false' `
        -FailureMessage 'lingframe_app unexpectedly received catalog snapshot update permission' `
        -PassMessage 'application role catalog snapshot updates denied'

    Assert-ExpectedFailure `
        -Sql 'DELETE FROM model_catalog.catalog_version_items WHERE false' `
        -FailureMessage 'lingframe_app unexpectedly received catalog snapshot delete permission' `
        -PassMessage 'application role catalog snapshot hard deletes denied'

    Assert-ExpectedFailure `
        -Sql 'UPDATE model_catalog.catalog_versions SET content_hash = content_hash WHERE false' `
        -FailureMessage 'lingframe_app unexpectedly received catalog version metadata update permission' `
        -PassMessage 'application role catalog version metadata updates denied'

    Invoke-SqlFile -Path (Join-Path $rollbackRoot 'U5__drop_model_catalog_tables.sql')
    Write-Pass 'U5__drop_model_catalog_tables.sql'

    $u5State = docker exec $containerName psql `
        --username lingframe_owner `
        --dbname lingframe_identity `
        --tuples-only `
        --no-align `
        --command "SELECT to_regnamespace('model_catalog') IS NULL, to_regnamespace('identity') IS NOT NULL, to_regclass('identity.users') IS NOT NULL, (SELECT count(*) FROM identity.roles), (SELECT count(*) FROM identity.permissions)"
    if ($LASTEXITCODE -ne 0 -or $u5State.Trim() -ne 't|t|t|6|41') {
        throw "U5 isolation verification failed: $u5State"
    }
    Write-Pass 'U5 removed only model_catalog and preserved V2-V4 identity state'

    Invoke-SqlFile -Path (Join-Path $migrationRoot 'V5__create_model_catalog_tables.sql')
    Write-Pass 'V5 reapplied after isolated U5 rollback'
    Invoke-SqlFile -Path $modelAssertionFile -UsesOwnTransaction
    Write-Pass 'model catalog assertions pass after V5 reapply'

    foreach ($rollbackName in @(
        'U5__drop_model_catalog_tables.sql',
        'U4__remove_identity_rbac_catalog.sql',
        'U3__drop_access_control_tables.sql',
        'U2__drop_identity_tables.sql'
    )) {
        Invoke-SqlFile -Path (Join-Path $rollbackRoot $rollbackName)
        Write-Pass $rollbackName
    }

    $rollbackState = docker exec $containerName psql `
        --username lingframe_owner `
        --dbname lingframe_identity `
        --tuples-only `
        --no-align `
        --command "SELECT to_regnamespace('model_catalog') IS NULL, to_regclass('identity.users') IS NULL, to_regclass('identity.platform_role_assignments') IS NULL, to_regclass('identity.tenant_invitations') IS NULL, to_regclass('identity.permission_overrides') IS NULL, to_regclass('identity.feature_policies') IS NULL, to_regnamespace('licensing') IS NULL, to_regnamespace('identity') IS NOT NULL"
    if ($LASTEXITCODE -ne 0 -or $rollbackState.Trim() -ne 't|t|t|t|t|t|t|t') {
        throw "Full rollback verification failed: $rollbackState"
    }
    Write-Pass 'U5-U2 rollback restored the V1 schema boundary'

    Invoke-VersionedMigrations -MigrationFiles $migrationFiles -Phase 'full-chain regression'
    Invoke-Assertions -Phase 'full-chain regression'

    Write-Host "Migration test completed successfully. Passed check groups: $passCount"
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
