SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $$
BEGIN
    IF current_user <> 'lingframe_owner' THEN
        RAISE EXCEPTION 'billing migrations must run as lingframe_owner';
    END IF;
    IF to_regnamespace('billing') IS NOT NULL THEN
        RAISE EXCEPTION 'billing schema already exists';
    END IF;
    IF to_regclass('identity.users') IS NULL
       OR to_regclass('identity.tenants') IS NULL
       OR to_regclass('model_catalog.models') IS NULL
       OR to_regclass('desktop_data.credit_accounts') IS NULL THEN
        RAISE EXCEPTION 'billing migration requires identity, model_catalog and desktop_data V6 state';
    END IF;
    IF EXISTS (
        SELECT account.user_id
        FROM desktop_data.credit_accounts AS account
        GROUP BY account.user_id
        HAVING min(account.balance) <> max(account.balance)
    ) THEN
        RAISE EXCEPTION 'legacy credit balance conflict: the same user has different tenant balances';
    END IF;
END
$$;

CREATE SCHEMA billing AUTHORIZATION lingframe_owner;
REVOKE ALL ON SCHEMA billing FROM PUBLIC, lingframe_app;
GRANT USAGE ON SCHEMA billing TO lingframe_app;

CREATE TABLE billing.user_wallets (
    user_id uuid PRIMARY KEY REFERENCES identity.users (id),
    available_balance bigint NOT NULL DEFAULT 0,
    reserved_balance bigint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    row_version bigint NOT NULL DEFAULT 0,
    CONSTRAINT user_wallets_available_ck CHECK (available_balance >= 0),
    CONSTRAINT user_wallets_reserved_ck CHECK (reserved_balance >= 0),
    CONSTRAINT user_wallets_row_version_ck CHECK (row_version >= 0)
);

CREATE INDEX user_wallets_updated_idx
    ON billing.user_wallets (updated_at DESC, user_id);

CREATE FUNCTION billing.create_user_wallet_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, billing
AS $$
BEGIN
    INSERT INTO billing.user_wallets (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
    RETURN NEW;
END;
$$;

CREATE TRIGGER billing_user_wallet_after_insert_trg
AFTER INSERT ON identity.users
FOR EACH ROW
EXECUTE FUNCTION billing.create_user_wallet_after_insert();

CREATE TABLE billing.recharge_packages (
    id uuid PRIMARY KEY,
    package_code varchar(64) NOT NULL,
    display_name varchar(120) NOT NULL,
    cash_amount_cents bigint NOT NULL,
    credit_amount bigint NOT NULL,
    bonus_credits bigint NOT NULL DEFAULT 0,
    status varchar(16) NOT NULL DEFAULT 'draft',
    sort_order integer NOT NULL DEFAULT 0,
    created_by_user_id uuid REFERENCES identity.users (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    row_version bigint NOT NULL DEFAULT 0,
    CONSTRAINT recharge_packages_code_ck CHECK (package_code ~ '^[a-z][a-z0-9_.-]{2,63}$'),
    CONSTRAINT recharge_packages_name_ck CHECK (btrim(display_name) <> ''),
    CONSTRAINT recharge_packages_cash_ck CHECK (cash_amount_cents > 0),
    CONSTRAINT recharge_packages_credit_ck CHECK (credit_amount > 0),
    CONSTRAINT recharge_packages_bonus_ck CHECK (bonus_credits >= 0),
    CONSTRAINT recharge_packages_status_ck CHECK (status IN ('draft', 'active', 'inactive')),
    CONSTRAINT recharge_packages_row_version_ck CHECK (row_version >= 0),
    CONSTRAINT recharge_packages_code_uk UNIQUE (package_code)
);

CREATE INDEX recharge_packages_status_sort_idx
    ON billing.recharge_packages (status, sort_order, cash_amount_cents);

CREATE TABLE billing.recharge_orders (
    id uuid PRIMARY KEY,
    order_no varchar(48) NOT NULL,
    user_id uuid NOT NULL REFERENCES billing.user_wallets (user_id),
    package_id uuid NOT NULL REFERENCES billing.recharge_packages (id),
    package_code_snapshot varchar(64) NOT NULL,
    cash_amount_cents bigint NOT NULL,
    credit_amount bigint NOT NULL,
    bonus_credits bigint NOT NULL DEFAULT 0,
    payment_channel varchar(32) NOT NULL,
    channel_trade_no varchar(128),
    status varchar(24) NOT NULL DEFAULT 'pending',
    idempotency_key varchar(160) NOT NULL,
    expires_at timestamptz NOT NULL,
    paid_at timestamptz,
    closed_at timestamptz,
    refund_requested_at timestamptz,
    refunded_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    row_version bigint NOT NULL DEFAULT 0,
    CONSTRAINT recharge_orders_no_ck CHECK (order_no ~ '^[A-Z0-9][A-Z0-9_-]{7,47}$'),
    CONSTRAINT recharge_orders_package_code_ck CHECK (package_code_snapshot ~ '^[a-z][a-z0-9_.-]{2,63}$'),
    CONSTRAINT recharge_orders_cash_ck CHECK (cash_amount_cents > 0),
    CONSTRAINT recharge_orders_credit_ck CHECK (credit_amount > 0),
    CONSTRAINT recharge_orders_bonus_ck CHECK (bonus_credits >= 0),
    CONSTRAINT recharge_orders_channel_ck CHECK (payment_channel ~ '^[a-z][a-z0-9_.-]{1,31}$'),
    CONSTRAINT recharge_orders_trade_ck CHECK (channel_trade_no IS NULL OR btrim(channel_trade_no) <> ''),
    CONSTRAINT recharge_orders_status_ck CHECK (
        status IN ('pending', 'paid', 'closed', 'refund_pending', 'refunded', 'manual_review')
    ),
    CONSTRAINT recharge_orders_idempotency_ck CHECK (btrim(idempotency_key) <> ''),
    CONSTRAINT recharge_orders_expiry_ck CHECK (expires_at > created_at),
    CONSTRAINT recharge_orders_row_version_ck CHECK (row_version >= 0),
    CONSTRAINT recharge_orders_no_uk UNIQUE (order_no),
    CONSTRAINT recharge_orders_user_idempotency_uk UNIQUE (user_id, idempotency_key)
);

CREATE UNIQUE INDEX recharge_orders_channel_trade_ux
    ON billing.recharge_orders (payment_channel, channel_trade_no)
    WHERE channel_trade_no IS NOT NULL;

CREATE INDEX recharge_orders_user_status_created_idx
    ON billing.recharge_orders (user_id, status, created_at DESC, id DESC);

CREATE INDEX recharge_orders_pending_expiry_idx
    ON billing.recharge_orders (expires_at, id)
    WHERE status = 'pending';

CREATE TABLE billing.model_price_versions (
    id uuid PRIMARY KEY,
    model_id uuid NOT NULL REFERENCES model_catalog.models (id),
    version_no bigint NOT NULL,
    pricing_unit varchar(24) NOT NULL,
    base_credits bigint NOT NULL,
    max_reserve_credits bigint NOT NULL,
    price_rule jsonb NOT NULL DEFAULT '{}'::jsonb,
    content_hash varchar(64) NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'draft',
    created_by_user_id uuid REFERENCES identity.users (id),
    activated_at timestamptz,
    retired_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    row_version bigint NOT NULL DEFAULT 0,
    CONSTRAINT model_price_versions_version_ck CHECK (version_no > 0),
    CONSTRAINT model_price_versions_unit_ck CHECK (
        pricing_unit IN ('request', 'second', 'image', 'token', 'custom')
    ),
    CONSTRAINT model_price_versions_base_ck CHECK (base_credits >= 0),
    CONSTRAINT model_price_versions_reserve_ck CHECK (
        max_reserve_credits >= base_credits AND max_reserve_credits > 0
    ),
    CONSTRAINT model_price_versions_rule_ck CHECK (jsonb_typeof(price_rule) = 'object'),
    CONSTRAINT model_price_versions_hash_ck CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT model_price_versions_status_ck CHECK (status IN ('draft', 'active', 'retired')),
    CONSTRAINT model_price_versions_activation_ck CHECK (
        (status = 'draft' AND activated_at IS NULL AND retired_at IS NULL)
        OR (status = 'active' AND activated_at IS NOT NULL AND retired_at IS NULL)
        OR (status = 'retired' AND activated_at IS NOT NULL AND retired_at IS NOT NULL)
    ),
    CONSTRAINT model_price_versions_row_version_ck CHECK (row_version >= 0),
    CONSTRAINT model_price_versions_model_version_uk UNIQUE (model_id, version_no)
);

CREATE UNIQUE INDEX model_price_versions_active_model_ux
    ON billing.model_price_versions (model_id)
    WHERE status = 'active';

CREATE INDEX model_price_versions_model_status_idx
    ON billing.model_price_versions (model_id, status, version_no DESC);

CREATE TABLE billing.credit_reservations (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES billing.user_wallets (user_id),
    tenant_id uuid NOT NULL REFERENCES identity.tenants (id),
    task_id varchar(128) NOT NULL,
    attempt_id varchar(128) NOT NULL,
    client_request_id varchar(160) NOT NULL,
    price_version_id uuid NOT NULL REFERENCES billing.model_price_versions (id),
    reserved_credits bigint NOT NULL,
    settled_credits bigint NOT NULL DEFAULT 0,
    released_credits bigint NOT NULL DEFAULT 0,
    status varchar(16) NOT NULL DEFAULT 'reserved',
    idempotency_key varchar(160) NOT NULL,
    expires_at timestamptz,
    settled_at timestamptz,
    released_at timestamptz,
    refunded_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    row_version bigint NOT NULL DEFAULT 0,
    CONSTRAINT credit_reservations_task_ck CHECK (btrim(task_id) <> ''),
    CONSTRAINT credit_reservations_attempt_ck CHECK (btrim(attempt_id) <> ''),
    CONSTRAINT credit_reservations_request_ck CHECK (btrim(client_request_id) <> ''),
    CONSTRAINT credit_reservations_reserved_ck CHECK (reserved_credits > 0),
    CONSTRAINT credit_reservations_settled_ck CHECK (settled_credits >= 0),
    CONSTRAINT credit_reservations_released_ck CHECK (released_credits >= 0),
    CONSTRAINT credit_reservations_total_ck CHECK (
        settled_credits + released_credits <= reserved_credits
    ),
    CONSTRAINT credit_reservations_status_ck CHECK (status IN ('reserved', 'settled', 'released', 'refunded')),
    CONSTRAINT credit_reservations_idempotency_ck CHECK (btrim(idempotency_key) <> ''),
    CONSTRAINT credit_reservations_row_version_ck CHECK (row_version >= 0),
    CONSTRAINT credit_reservations_task_attempt_uk UNIQUE (task_id, attempt_id),
    CONSTRAINT credit_reservations_user_request_uk UNIQUE (user_id, client_request_id),
    CONSTRAINT credit_reservations_user_idempotency_uk UNIQUE (user_id, idempotency_key)
);

CREATE INDEX credit_reservations_user_status_updated_idx
    ON billing.credit_reservations (user_id, status, updated_at DESC, id DESC);

CREATE INDEX credit_reservations_status_expiry_idx
    ON billing.credit_reservations (status, expires_at, id)
    WHERE status = 'reserved';

CREATE TABLE billing.credit_settlements (
    id uuid PRIMARY KEY,
    reservation_id uuid NOT NULL REFERENCES billing.credit_reservations (id),
    user_id uuid NOT NULL REFERENCES billing.user_wallets (user_id),
    tenant_id uuid NOT NULL REFERENCES identity.tenants (id),
    task_id varchar(128) NOT NULL,
    attempt_id varchar(128) NOT NULL,
    charged_credits bigint NOT NULL,
    result_reference varchar(300),
    idempotency_key varchar(160) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT credit_settlements_task_ck CHECK (btrim(task_id) <> ''),
    CONSTRAINT credit_settlements_attempt_ck CHECK (btrim(attempt_id) <> ''),
    CONSTRAINT credit_settlements_charge_ck CHECK (charged_credits > 0),
    CONSTRAINT credit_settlements_result_ck CHECK (
        result_reference IS NULL OR btrim(result_reference) <> ''
    ),
    CONSTRAINT credit_settlements_idempotency_ck CHECK (btrim(idempotency_key) <> ''),
    CONSTRAINT credit_settlements_reservation_uk UNIQUE (reservation_id),
    CONSTRAINT credit_settlements_task_uk UNIQUE (task_id),
    CONSTRAINT credit_settlements_idempotency_uk UNIQUE (idempotency_key)
);

CREATE INDEX credit_settlements_user_created_idx
    ON billing.credit_settlements (user_id, created_at DESC, id DESC);

CREATE TABLE billing.credit_ledger_entries (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES billing.user_wallets (user_id),
    tenant_id uuid REFERENCES identity.tenants (id),
    entry_type varchar(24) NOT NULL,
    available_delta bigint NOT NULL,
    reserved_delta bigint NOT NULL,
    available_after bigint NOT NULL,
    reserved_after bigint NOT NULL,
    business_type varchar(48) NOT NULL,
    business_id varchar(160) NOT NULL,
    idempotency_key varchar(160) NOT NULL,
    recharge_order_id uuid REFERENCES billing.recharge_orders (id),
    reservation_id uuid REFERENCES billing.credit_reservations (id),
    settlement_id uuid REFERENCES billing.credit_settlements (id),
    reversal_of_entry_id uuid REFERENCES billing.credit_ledger_entries (id),
    operator_user_id uuid REFERENCES identity.users (id),
    operator_membership_id uuid REFERENCES identity.tenant_memberships (id),
    reason varchar(500),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT credit_ledger_entries_type_ck CHECK (
        entry_type IN (
            'migration', 'recharge', 'reserve', 'settle', 'release',
            'refund', 'manual_adjustment', 'reversal'
        )
    ),
    CONSTRAINT credit_ledger_entries_delta_ck CHECK (
        available_delta <> 0 OR reserved_delta <> 0
    ),
    CONSTRAINT credit_ledger_entries_after_ck CHECK (
        available_after >= 0 AND reserved_after >= 0
    ),
    CONSTRAINT credit_ledger_entries_business_ck CHECK (
        btrim(business_type) <> '' AND btrim(business_id) <> ''
    ),
    CONSTRAINT credit_ledger_entries_idempotency_ck CHECK (btrim(idempotency_key) <> ''),
    CONSTRAINT credit_ledger_entries_adjustment_ck CHECK (
        entry_type <> 'manual_adjustment'
        OR (operator_user_id IS NOT NULL AND reason IS NOT NULL AND btrim(reason) <> '')
    ),
    CONSTRAINT credit_ledger_entries_business_idempotency_uk UNIQUE (business_type, idempotency_key)
);

CREATE INDEX credit_ledger_entries_user_created_idx
    ON billing.credit_ledger_entries (user_id, created_at DESC, id DESC);

CREATE INDEX credit_ledger_entries_business_idx
    ON billing.credit_ledger_entries (business_type, business_id, created_at DESC);

CREATE INDEX credit_ledger_entries_reservation_idx
    ON billing.credit_ledger_entries (reservation_id, created_at)
    WHERE reservation_id IS NOT NULL;

CREATE FUNCTION billing.prevent_immutable_record_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, billing
AS $$
BEGIN
    RAISE EXCEPTION 'billing immutable records cannot be updated or deleted';
END;
$$;

CREATE TRIGGER credit_ledger_entries_immutable_trg
BEFORE UPDATE OR DELETE ON billing.credit_ledger_entries
FOR EACH ROW
EXECUTE FUNCTION billing.prevent_immutable_record_mutation();

CREATE TRIGGER credit_settlements_immutable_trg
BEFORE UPDATE OR DELETE ON billing.credit_settlements
FOR EACH ROW
EXECUTE FUNCTION billing.prevent_immutable_record_mutation();

WITH legacy_balance AS (
    SELECT account.user_id, max(account.balance) AS balance, min(account.created_at) AS created_at,
           max(account.updated_at) AS updated_at
    FROM desktop_data.credit_accounts AS account
    GROUP BY account.user_id
)
INSERT INTO billing.user_wallets (
    user_id, available_balance, reserved_balance, created_at, updated_at, row_version
)
SELECT user_account.id,
       COALESCE(legacy.balance, 0),
       0,
       COALESCE(legacy.created_at, now()),
       COALESCE(legacy.updated_at, now()),
       0
FROM identity.users AS user_account
LEFT JOIN legacy_balance AS legacy ON legacy.user_id = user_account.id;

INSERT INTO billing.credit_ledger_entries (
    id, user_id, tenant_id, entry_type, available_delta, reserved_delta,
    available_after, reserved_after, business_type, business_id,
    idempotency_key, reason, created_at
)
SELECT md5(wallet.user_id::text || ':billing-v7-migration')::uuid,
       wallet.user_id,
       NULL,
       'migration',
       wallet.available_balance,
       0,
       wallet.available_balance,
       0,
       'desktop_credit_migration',
       wallet.user_id::text,
       'v7:' || wallet.user_id::text,
       'Imported from desktop_data.credit_accounts without summing tenant duplicates',
       wallet.created_at
FROM billing.user_wallets AS wallet
WHERE wallet.available_balance > 0;

COMMENT ON SCHEMA billing IS '用户个人积分、充值、模型价格和任务计费账务域。';
COMMENT ON TABLE billing.user_wallets IS '每个用户一个全局个人钱包；不按租户或设备拆分。';
COMMENT ON TABLE billing.recharge_packages IS '服务端维护的充值套餐；客户端金额和积分仅作展示。';
COMMENT ON TABLE billing.recharge_orders IS '充值订单与支付状态；支付成功只能由验签后的渠道事实驱动。';
COMMENT ON TABLE billing.model_price_versions IS '平台模型版本化积分价格；任务固定提交时价格版本。';
COMMENT ON TABLE billing.credit_reservations IS '平台模型任务积分预占；提交未知时保持 reserved。';
COMMENT ON TABLE billing.credit_settlements IS '任务成功后的不可变结算事实；同一任务最多一次。';
COMMENT ON TABLE billing.credit_ledger_entries IS '积分审计真相源；只允许追加，不允许 UPDATE 或 DELETE。';

REVOKE ALL ON
    billing.user_wallets,
    billing.recharge_packages,
    billing.recharge_orders,
    billing.model_price_versions,
    billing.credit_reservations,
    billing.credit_settlements,
    billing.credit_ledger_entries
FROM PUBLIC, lingframe_app;

GRANT SELECT ON
    billing.user_wallets,
    billing.recharge_packages,
    billing.recharge_orders,
    billing.model_price_versions,
    billing.credit_reservations,
    billing.credit_settlements,
    billing.credit_ledger_entries
TO lingframe_app;

REVOKE ALL ON FUNCTION billing.prevent_immutable_record_mutation() FROM PUBLIC, lingframe_app;
REVOKE ALL ON FUNCTION billing.create_user_wallet_after_insert() FROM PUBLIC, lingframe_app;
