ALTER TABLE "opod"."credit_ledger_entries"
ADD CONSTRAINT "credit_ledger_entries_paid_purchase_check"
CHECK (
  "entry_type" <> 'grant'
  OR "credit_kind" <> 'paid'
  OR "purchase_id" IS NOT NULL
) NOT VALID;

ALTER TABLE "opod"."credit_refunds"
DROP CONSTRAINT "credit_refunds_amounts_check";
ALTER TABLE "opod"."credit_refunds"
ADD CONSTRAINT "credit_refunds_amounts_check"
CHECK (
  "credit_amount" >= 0
  AND "gross_amount" > 0
  AND "fee_amount" >= 0
  AND "refund_amount" = "gross_amount" - "fee_amount"
);

ALTER TABLE "opod"."credit_refund_allocations"
ADD COLUMN "recovered_amount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "opod"."credit_refund_allocations"
ADD CONSTRAINT "credit_refund_allocations_recovered_amount_check"
CHECK (
  "recovered_amount" >= 0
  AND "recovered_amount" <= "recovery_amount"
);

CREATE TABLE "opod"."credit_reconciliation_actions" (
  "id" UUID NOT NULL,
  "action_type" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "purchase_id" UUID NOT NULL,
  "admin_id" UUID NOT NULL,
  "reason" TEXT NOT NULL,
  "details" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "credit_reconciliation_actions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "credit_reconciliation_actions_reference_key"
ON "opod"."credit_reconciliation_actions"("reference");
CREATE INDEX "credit_reconciliation_actions_purchase_id_created_at_idx"
ON "opod"."credit_reconciliation_actions"("purchase_id", "created_at");
CREATE INDEX "credit_reconciliation_actions_admin_id_created_at_idx"
ON "opod"."credit_reconciliation_actions"("admin_id", "created_at");

ALTER TABLE "opod"."credit_reconciliation_actions"
ADD CONSTRAINT "credit_reconciliation_actions_purchase_id_fkey"
FOREIGN KEY ("purchase_id") REFERENCES "opod"."credit_purchases"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "opod"."credit_reconciliation_actions"
ADD CONSTRAINT "credit_reconciliation_actions_admin_id_fkey"
FOREIGN KEY ("admin_id") REFERENCES "opod"."admins"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
