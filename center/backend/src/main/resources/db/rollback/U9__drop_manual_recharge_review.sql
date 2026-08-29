SET lock_timeout = '5s';
SET statement_timeout = '60s';

DROP FUNCTION IF EXISTS billing.cancel_manual_recharge_order(uuid, uuid, timestamptz);
DROP FUNCTION IF EXISTS billing.reject_manual_recharge_order(uuid, uuid, varchar, timestamptz);
DROP FUNCTION IF EXISTS billing.approve_manual_recharge_order(uuid, uuid, varchar, timestamptz, uuid);
DROP FUNCTION IF EXISTS billing.create_manual_recharge_order(
    uuid, varchar, uuid, uuid, varchar, timestamptz, varchar
);

UPDATE billing.recharge_orders
SET status = 'closed',
    closed_at = COALESCE(closed_at, reviewed_at, now()),
    updated_at = now(),
    row_version = row_version + 1
WHERE payment_channel = 'manual_transfer'
  AND status IN ('manual_review', 'rejected');

DROP INDEX IF EXISTS billing.recharge_orders_manual_review_idx;

ALTER TABLE billing.recharge_orders
    DROP CONSTRAINT recharge_orders_review_ck,
    DROP CONSTRAINT recharge_orders_review_reason_ck,
    DROP CONSTRAINT recharge_orders_submission_note_ck,
    DROP CONSTRAINT recharge_orders_status_ck,
    ADD CONSTRAINT recharge_orders_status_ck CHECK (
        status IN ('pending', 'paid', 'closed', 'refund_pending', 'refunded', 'manual_review')
    ),
    DROP COLUMN submission_note,
    DROP COLUMN reviewed_by_user_id,
    DROP COLUMN reviewed_at,
    DROP COLUMN review_reason;

