param()

$ErrorActionPreference = 'Stop'
$backendRoot = Split-Path -Parent $PSScriptRoot
$solutionRoot = Split-Path -Parent $backendRoot
$desktopRoot = Join-Path (Split-Path -Parent $solutionRoot) '03 灵帧AI桌面客户端源码-V0.12.2\lingzhen_ai_desktop_v1'
$frontendRoot = Join-Path $solutionRoot 'lingzhen_center_frontend'
$planFile = Join-Path $backendRoot 'WAVE5_CREDIT_MANAGEMENT_PLAN.md'
$truthFile = Join-Path $backendRoot 'references\credit_domain_ground_truth.json'
$migrationFile = Join-Path $backendRoot 'src\main\resources\db\migration\V7__create_billing_tables.sql'
$rollbackFile = Join-Path $backendRoot 'src\main\resources\db\rollback\U7__drop_billing_tables.sql'
$rechargeMigrationFile = Join-Path $backendRoot 'src\main\resources\db\migration\V8__create_recharge_payment_commands.sql'
$rechargeRollbackFile = Join-Path $backendRoot 'src\main\resources\db\rollback\U8__drop_recharge_payment_commands.sql'
$legacyMigrationFile = Join-Path $backendRoot 'src\main\resources\db\migration\V6__create_desktop_workspace_tables.sql'
$bootstrapDtoFile = Join-Path $backendRoot 'src\main\java\com\lingzhen\center\model\dto\desktop\DesktopBootstrapResponse.java'
$walletControllerFile = Join-Path $backendRoot 'src\main\java\com\lingzhen\center\controller\BillingWalletController.java'
$walletServiceFile = Join-Path $backendRoot 'src\main\java\com\lingzhen\center\service\impl\BillingWalletServiceImpl.java'
$walletRepositoryFile = Join-Path $backendRoot 'src\main\java\com\lingzhen\center\repository\BillingWalletRepository.java'
$walletAdapterFile = Join-Path $backendRoot 'src\main\java\com\lingzhen\center\repository\BillingWalletPersistenceAdapter.java'
$bootstrapServiceFile = Join-Path $backendRoot 'src\main\java\com\lingzhen\center\service\impl\DesktopBootstrapServiceImpl.java'
$workspaceRepositoryFile = Join-Path $backendRoot 'src\main\java\com\lingzhen\center\repository\DesktopWorkspaceRepository.java'
$workspaceAdapterFile = Join-Path $backendRoot 'src\main\java\com\lingzhen\center\repository\DesktopWorkspacePersistenceAdapter.java'
$securityConfigFile = Join-Path $backendRoot 'src\main\java\com\lingzhen\center\config\SecurityConfig.java'
$managementCreditsControllerFile = Join-Path $backendRoot 'src\main\java\com\lingzhen\center\controller\CreditsManagementController.java'
$managementCreditsServiceFile = Join-Path $backendRoot 'src\main\java\com\lingzhen\center\service\impl\CreditsManagementServiceImpl.java'
$managementCreditsAdapterFile = Join-Path $backendRoot 'src\main\java\com\lingzhen\center\repository\CreditsManagementPersistenceAdapter.java'
$rechargeControllerFile = Join-Path $backendRoot 'src\main\java\com\lingzhen\center\controller\RechargeController.java'
$rechargeManagementControllerFile = Join-Path $backendRoot 'src\main\java\com\lingzhen\center\controller\RechargeManagementController.java'
$rechargeServiceFile = Join-Path $backendRoot 'src\main\java\com\lingzhen\center\service\impl\RechargeServiceImpl.java'
$rechargeManagementServiceFile = Join-Path $backendRoot 'src\main\java\com\lingzhen\center\service\impl\RechargeManagementServiceImpl.java'
$rechargeAdapterFile = Join-Path $backendRoot 'src\main\java\com\lingzhen\center\repository\RechargePersistenceAdapter.java'
$sandboxAdapterFile = Join-Path $backendRoot 'src\main\java\com\lingzhen\center\payment\SandboxPaymentAdapter.java'
$frontendRoutesFile = Join-Path $frontendRoot 'src\router\routes.ts'
$frontendLayoutFile = Join-Path $frontendRoot 'src\layouts\ManagementLayout.vue'
$frontendCreditsPageFile = Join-Path $frontendRoot 'src\features\credits-management\pages\CreditsManagementPage.vue'
$frontendRechargePackageFile = Join-Path $frontendRoot 'src\features\credits-management\components\RechargePackagePanel.vue'
$frontendRechargeDrawerFile = Join-Path $frontendRoot 'src\features\credits-management\components\RechargePackageDrawer.vue'
$frontendCreditsApiFile = Join-Path $frontendRoot 'src\features\credits-management\api\credits-management-api.ts'
$desktopAuthFile = Join-Path $desktopRoot 'src\main\desktop-auth-client.cjs'
$logRoot = Join-Path $PSScriptRoot 'log'
$logFile = Join-Path $logRoot ("wave5-credit-contract-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$passCount = 0
$transcriptStarted = $false

New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
Start-Transcript -LiteralPath $logFile -Force | Out-Null
$transcriptStarted = $true

function Assert-True {
    param(
        [Parameter(Mandatory = $true)][bool]$Condition,
        [Parameter(Mandatory = $true)][string]$Message
    )
    if (-not $Condition) {
        throw $Message
    }
    $script:passCount++
    Write-Host "[PASS] $Message"
}

try {
    $truth = Get-Content -Raw -LiteralPath $truthFile | ConvertFrom-Json
    $plan = Get-Content -Raw -LiteralPath $planFile
    $migration = Get-Content -Raw -LiteralPath $migrationFile
    $rollback = Get-Content -Raw -LiteralPath $rollbackFile
    $rechargeMigration = Get-Content -Raw -LiteralPath $rechargeMigrationFile
    $rechargeRollback = Get-Content -Raw -LiteralPath $rechargeRollbackFile
    $legacyMigration = Get-Content -Raw -LiteralPath $legacyMigrationFile
    $bootstrapDto = Get-Content -Raw -LiteralPath $bootstrapDtoFile
    $walletController = Get-Content -Raw -LiteralPath $walletControllerFile
    $walletService = Get-Content -Raw -LiteralPath $walletServiceFile
    $walletRepository = Get-Content -Raw -LiteralPath $walletRepositoryFile
    $walletAdapter = Get-Content -Raw -LiteralPath $walletAdapterFile
    $bootstrapService = Get-Content -Raw -LiteralPath $bootstrapServiceFile
    $workspaceRepository = Get-Content -Raw -LiteralPath $workspaceRepositoryFile
    $workspaceAdapter = Get-Content -Raw -LiteralPath $workspaceAdapterFile
    $securityConfig = Get-Content -Raw -LiteralPath $securityConfigFile
    $managementCreditsController = Get-Content -Raw -LiteralPath $managementCreditsControllerFile
    $managementCreditsService = Get-Content -Raw -LiteralPath $managementCreditsServiceFile
    $managementCreditsAdapter = Get-Content -Raw -LiteralPath $managementCreditsAdapterFile
    $rechargeController = Get-Content -Raw -LiteralPath $rechargeControllerFile
    $rechargeManagementController = Get-Content -Raw -LiteralPath $rechargeManagementControllerFile
    $rechargeService = Get-Content -Raw -LiteralPath $rechargeServiceFile
    $rechargeManagementService = Get-Content -Raw -LiteralPath $rechargeManagementServiceFile
    $rechargeAdapter = Get-Content -Raw -LiteralPath $rechargeAdapterFile
    $sandboxAdapter = Get-Content -Raw -LiteralPath $sandboxAdapterFile
    $frontendRoutes = Get-Content -Raw -LiteralPath $frontendRoutesFile
    $frontendLayout = Get-Content -Raw -LiteralPath $frontendLayoutFile
    $frontendCreditsPage = Get-Content -Raw -LiteralPath $frontendCreditsPageFile
    $frontendRechargePackage = Get-Content -Raw -LiteralPath $frontendRechargePackageFile
    $frontendRechargeDrawer = Get-Content -Raw -LiteralPath $frontendRechargeDrawerFile
    $frontendCreditsApi = Get-Content -Raw -LiteralPath $frontendCreditsApiFile
    $desktopAuth = Get-Content -Raw -LiteralPath $desktopAuthFile
    $walletQuery = [regex]::Match(
        $walletAdapter,
        'SELECT user_id, available_balance, reserved_balance, updated_at, row_version[\s\S]*?WHERE user_id = :userId'
    ).Value

    Assert-True ($truth.node -eq '5.4' -and $truth.status -eq 'node_5_4_verified') 'Ground Truth marks node 5.4 verified'
    Assert-True ($truth.database.migrationVersion -eq 8) 'Ground Truth fixes billing migration version at V8'
    Assert-True (@($truth.database.tables).Count -eq 7) 'Ground Truth declares exactly seven billing tables'
    Assert-True (@($truth.invariants).Count -eq 18) 'Ground Truth contains eighteen accounting invariants'
    Assert-True (-not $truth.wallet.tenantScoped) 'Wallet ownership is global to the user, not tenant scoped'
    Assert-True ($truth.desktopCompatibility.schemaVersion -eq 1) 'Desktop bootstrap schemaVersion remains 1'
    Assert-True (-not $truth.paymentBoundary.realChannelConfigured -and $truth.paymentBoundary.sandboxManagementOnly) 'Real payment remains out of scope and Sandbox is management only'

    foreach ($table in @($truth.database.tables)) {
        Assert-True ($migration -match [regex]::Escape("CREATE TABLE billing.$table")) "V7 creates billing.$table"
        Assert-True ($rollback -match [regex]::Escape("DROP TABLE billing.$table")) "U7 drops billing.$table"
    }

    $walletDefinition = [regex]::Match(
        $migration,
        'CREATE TABLE billing\.user_wallets\s*\((?<body>[\s\S]*?)\n\);'
    ).Groups['body'].Value
    Assert-True ($walletDefinition -notmatch '\btenant_id\b') 'billing.user_wallets has no tenant_id column'
    Assert-True ($migration -match 'legacy credit balance conflict') 'V7 aborts when one user has conflicting tenant balances'
    Assert-True ($migration -match "entry_type, available_delta" -and $migration -match "'migration'") 'V7 writes a migration ledger entry for non-zero legacy balance'
    Assert-True ($migration -match 'prevent_immutable_record_mutation') 'V7 protects immutable ledger and settlement records'
    Assert-True ($migration -match 'GRANT SELECT ON[\s\S]*TO lingframe_app') 'V7 grants the application role read access'
    Assert-True ($migration -notmatch 'GRANT\s+(INSERT|UPDATE|DELETE)[\s\S]*billing\.user_wallets') 'V7 does not grant direct wallet mutation'
    Assert-True ($migration -notmatch 'GRANT\s+(INSERT|UPDATE|DELETE)[\s\S]*billing\.credit_ledger_entries') 'V7 does not grant direct ledger mutation'
    Assert-True ($migration -match 'CREATE FUNCTION billing\.create_user_wallet_after_insert\(\)') 'V7 defines automatic wallet provisioning for future users'
    Assert-True ($migration -match 'SECURITY DEFINER\s+SET search_path = pg_catalog, billing') 'Wallet provisioning function fixes a safe search path'
    Assert-True ($migration -match 'CREATE TRIGGER billing_user_wallet_after_insert_trg[\s\S]*AFTER INSERT ON identity\.users') 'V7 installs the new-user wallet trigger on identity.users'
    Assert-True ($migration -match 'REVOKE ALL ON FUNCTION billing\.create_user_wallet_after_insert\(\) FROM PUBLIC, lingframe_app') 'Application role cannot execute wallet provisioning directly'
    Assert-True ($rollback -match 'DROP TRIGGER billing_user_wallet_after_insert_trg ON identity\.users') 'U7 removes the new-user wallet trigger'
    Assert-True ($rollback -match 'DROP FUNCTION billing\.create_user_wallet_after_insert\(\)') 'U7 removes the wallet provisioning function'

    foreach ($functionName in @(
        'create_recharge_package',
        'update_recharge_package',
        'create_recharge_order',
        'close_recharge_order',
        'apply_sandbox_payment'
    )) {
        Assert-True ($rechargeMigration -match [regex]::Escape("CREATE FUNCTION billing.$functionName")) "V8 defines billing.$functionName"
        Assert-True ($rechargeRollback -match [regex]::Escape("DROP FUNCTION billing.$functionName")) "U8 removes billing.$functionName"
    }
    Assert-True ([regex]::Matches($rechargeMigration, 'SECURITY DEFINER').Count -eq 5) 'All V8 command functions are SECURITY DEFINER'
    Assert-True ([regex]::Matches($rechargeMigration, 'SET search_path = pg_catalog, billing').Count -eq 5) 'All V8 command functions fix a safe search path'
    Assert-True ($rechargeMigration -match 'credit_ledger_entries[\s\S]*recharge_order' -and $rechargeMigration -match "status = 'paid'") 'Sandbox success appends one recharge ledger entry and marks the order paid'
    Assert-True ($rechargeMigration -match "IF selected_order\.status = 'paid'" -and $rechargeMigration -match 'idempotent_replay' -and $rechargeMigration -match 'PAYMENT_AMOUNT_MISMATCH') 'Sandbox success is idempotent and rejects amount mismatch'
    Assert-True ($rechargeMigration -match 'GRANT EXECUTE ON FUNCTION billing\.apply_sandbox_payment' -and $rechargeMigration -notmatch 'GRANT\s+(INSERT|UPDATE|DELETE)') 'V8 grants function execution without direct table writes'

    Assert-True ($legacyMigration -match 'GRANT SELECT, INSERT ON desktop_data\.credit_accounts') 'Legacy account remains readable/creatable without UPDATE privilege'
    Assert-True ($bootstrapDto -match 'SCHEMA_VERSION\s*=\s*1') 'Backend bootstrap DTO remains schemaVersion 1'
    Assert-True ($bootstrapDto -match 'record CreditSummary\(boolean available, long balance\)') 'Backend preserves credits.available and credits.balance'
    Assert-True ($walletController -match '@GetMapping\("/wallet"\)' -and $walletController -match '@GetMapping\("/ledger"\)') 'Desktop wallet and ledger read APIs are exposed under /api/v1/credits'
    Assert-True ([regex]::Matches($walletController, "hasAuthority\('PERM_credits\.self\.read'\)").Count -eq 2) 'Both credit read endpoints require credits.self.read'
    Assert-True ($walletService -match 'clientType\(\) != ClientType\.DESKTOP' -and $walletService -match 'permissions\(\)\.contains\(READ_PERMISSION\)') 'Billing service enforces desktop terminal and self-read permission'
    Assert-True ($walletService -match 'catch \(DataAccessException exception\)' -and $walletService -notmatch 'DataAccessException \| ApiException') 'Bootstrap degrades database outages without hiding invalid credit values'
    Assert-True ($bootstrapService -match 'BillingWalletService billingWalletService' -and $bootstrapService -match 'availableBalanceForBootstrap\(sessionContext\)') 'Desktop bootstrap reads credits through BillingWalletService'
    Assert-True ($workspaceRepository -notmatch 'CreditBalance|findOrCreateCreditBalance|credit_accounts') 'Workspace repository no longer exposes the legacy credit account'
    Assert-True ($workspaceAdapter -notmatch 'desktop_data\.credit_accounts|findOrCreateCreditBalance') 'Workspace persistence no longer reads or creates legacy credit accounts'
    Assert-True ($walletRepository -match 'findWallet\(UUID userId\)' -and $walletRepository -notmatch 'findWallet\(UUID tenantId') 'Wallet repository contract is isolated by userId only'
    Assert-True (-not [string]::IsNullOrWhiteSpace($walletQuery) -and $walletQuery -notmatch '\btenant_id\b') 'Wallet SQL is parameterized by userId and not tenant scoped'
    Assert-True ($walletAdapter -match 'ORDER BY created_at DESC, id DESC' -and $walletAdapter -match '\(created_at, id\) < \(:beforeCreatedAt, :beforeId\)') 'Ledger uses stable created_at plus id cursor ordering'
    Assert-True ($securityConfig -match 'requestMatchers\("/api/v1/credits/\*\*"\)\.hasAuthority\("CLIENT_desktop"\)') 'SecurityConfig rejects non-desktop credit API clients'
    Assert-True ($desktopAuth -match 'Number\.isSafeInteger\(balance\)\s*\|\|\s*balance\s*<\s*0') 'Desktop rejects unsafe or negative credit balances'
    Assert-True ($desktopAuth -match 'response\?\.schemaVersion\s*===\s*1') 'Desktop continues to require bootstrap schemaVersion 1'
    Assert-True (
        $managementCreditsController -match '@GetMapping\("/wallets"\)' -and
        $managementCreditsController -match '@GetMapping\("/orders"\)' -and
        $managementCreditsController -match '@GetMapping\("/ledger"\)' -and
        $managementCreditsController -match '@GetMapping\("/reservations/anomalies"\)'
    ) 'Management credits exposes wallet, order, ledger and reservation anomaly read endpoints'
    Assert-True ([regex]::Matches($managementCreditsController, "hasAuthority\('PERM_credits\.manage'\)").Count -eq 4) 'All management credit endpoints require credits.manage'
    Assert-True ($managementCreditsService -match 'ClientType\.MANAGEMENT_WEB' -and $managementCreditsService -match 'credits\.manage') 'Management credit service enforces management terminal and permission'
    Assert-True ($managementCreditsService -match 'MAX_PAGE_SIZE\s*=\s*100' -and $managementCreditsService -match 'limit \+ 1') 'Management credit lists enforce a 100 row maximum with lookahead pagination'
    Assert-True ($managementCreditsService -match 'wallets\|' -or $managementCreditsService -match 'encodeCursor\("wallets"') 'Management credit cursors are scoped per view'
    Assert-True ($managementCreditsAdapter -notmatch 'channel_trade_no' -and $managementCreditsAdapter -notmatch 'idempotency_key') 'Management credit responses do not select private payment or idempotency fields'
    Assert-True ($managementCreditsAdapter -match "r\.status = 'reserved'" -and $managementCreditsAdapter -match 'r\.expires_at < :now' -and $managementCreditsAdapter -match 'r\.updated_at < :staleBefore') 'Reservation anomaly query covers expired and stale reserved records'
    Assert-True ($rechargeController -match '@GetMapping\("/recharge-packages"\)' -and $rechargeController -match '@PostMapping\("/recharge-orders"\)' -and $rechargeController -match '@GetMapping\("/recharge-orders/\{orderId\}"\)') 'Desktop recharge exposes package list, create order and own-order read endpoints'
    Assert-True ([regex]::Matches($rechargeController, "hasAuthority\('PERM_credits\.self\.recharge'\)").Count -eq 3) 'All desktop recharge endpoints require credits.self.recharge'
    Assert-True ($rechargeService -match 'ClientType\.DESKTOP' -and $rechargeService -match 'CREDIT_IDEMPOTENCY_CONFLICT' -and $rechargeService -match 'findUserOrder') 'Desktop recharge service enforces terminal, idempotency and order ownership'
    Assert-True ($rechargeManagementController -match '@PostMapping\("/packages"\)' -and $rechargeManagementController -match '@PutMapping\("/packages/\{packageId\}"\)' -and $rechargeManagementController -match '@PostMapping\("/sandbox/orders/\{orderId\}/events"\)') 'Management recharge exposes package writes and Sandbox event simulation'
    Assert-True ([regex]::Matches($rechargeManagementController, "hasAuthority\('PERM_credits\.manage'\)").Count -eq 4) 'All management recharge endpoints require credits.manage'
    Assert-True ($rechargeManagementService -match 'ClientType\.MANAGEMENT_WEB' -and $rechargeManagementService -match 'RECHARGE_PACKAGE_ROW_VERSION_CONFLICT' -and $rechargeManagementService -match 'PAYMENT_AMOUNT_MISMATCH') 'Management recharge service enforces terminal, optimistic lock and amount checks'
    Assert-True ($rechargeAdapter -match 'billing\.create_recharge_package' -and $rechargeAdapter -match 'billing\.update_recharge_package' -and $rechargeAdapter -match 'billing\.apply_sandbox_payment') 'Recharge persistence delegates writes to controlled V8 functions'
    Assert-True ($sandboxAdapter -match 'Set\.of\("paid", "failed", "cancelled"\)' -and $sandboxAdapter -match 'SBX-' -and $sandboxAdapter -match 'PAYMENT_CALLBACK_INVALID') 'Sandbox adapter normalizes only paid, failed and cancelled events'
    Assert-True ($frontendRoutes -match "path: 'credits'" -and $frontendRoutes -match "requiredPermission: 'credits\.manage'") 'Management center credits route is protected by credits.manage'
    Assert-True ($frontendLayout -match 'canManageCredits' -and $frontendLayout -match "navigateTo\('credits'\)") 'Management navigation hides credits from users without permission'
    Assert-True ([regex]::Matches($frontendCreditsPage, "key: '(wallets|orders|packages|ledger|anomalies)'").Count -eq 5 -and $frontendCreditsPage -match '@media \(max-width: 48rem\)') 'Credits UI contains five responsive billing views'
    Assert-True ($frontendCreditsPage -match 'simulateSandboxPayment|useSandboxPaymentMutation|支付成功|支付失败|用户取消' -and $frontendCreditsPage -notmatch '当前节点仅开放查询|只读审计') 'Credits order UI exposes one Sandbox action dialog and removes read-only copy'
    Assert-True ($frontendRechargePackage -match '新增套餐' -and $frontendRechargePackage -match 'toggleStatus' -and $frontendRechargePackage -match 'RECHARGE_PACKAGE_ROW_VERSION_CONFLICT') 'Recharge package UI supports create, edit, enable, disable and conflict refresh'
    Assert-True ($frontendRechargeDrawer -match 'rowVersion: props\.rechargePackage\.rowVersion' -and $frontendRechargeDrawer -match '创建后不可修改') 'Recharge package drawer sends optimistic-lock version and keeps code immutable'
    Assert-True ($frontendCreditsApi -match '/management/credits/packages' -and $frontendCreditsApi -match '/management/credits/sandbox/orders/\$\{orderId\}/events') 'Frontend API uses management package and Sandbox endpoints'

    foreach ($requiredText in @(
        '同一用户旧余额冲突时 V7 整体失败并回滚',
        '上游状态未知时保持预占',
        '积分不足只影响需要平台积分的提交动作',
        '正式 `5433` 不在本 Wave 自动迁移'
    )) {
        Assert-True ($plan.Contains($requiredText)) "Plan contains required contract: $requiredText"
    }

    Write-Host "Wave 5 credit contract test completed successfully. Passed checks: $passCount"
    Write-Host "Log saved to: $logFile"
}
finally {
    if ($transcriptStarted) {
        Stop-Transcript | Out-Null
    }
}
