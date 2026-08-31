ALTER TABLE "opod"."credit_ledger_entries"
ADD COLUMN "promotion_code" TEXT;

ALTER TABLE "opod"."credit_refunds"
ADD COLUMN "promotion_amount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "opod"."credit_refunds"
ADD CONSTRAINT "credit_refunds_promotion_amount_check"
CHECK ("promotion_amount" >= 0);

CREATE TABLE "opod"."credit_refund_allocations" (
  "refund_id" UUID NOT NULL,
  "ledger_entry_id" UUID NOT NULL,
  "locked_amount" INTEGER NOT NULL,
  "recovery_amount" INTEGER NOT NULL,
  CONSTRAINT "credit_refund_allocations_pkey"
    PRIMARY KEY ("refund_id", "ledger_entry_id"),
  CONSTRAINT "credit_refund_allocations_amounts_check"
    CHECK (
      "locked_amount" >= 0
      AND "recovery_amount" > 0
      AND "locked_amount" <= "recovery_amount"
    )
);

CREATE INDEX "credit_refund_allocations_ledger_entry_id_idx"
ON "opod"."credit_refund_allocations"("ledger_entry_id");

ALTER TABLE "opod"."credit_refund_allocations"
ADD CONSTRAINT "credit_refund_allocations_refund_id_fkey"
FOREIGN KEY ("refund_id") REFERENCES "opod"."credit_refunds"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "opod"."credit_refund_allocations"
ADD CONSTRAINT "credit_refund_allocations_ledger_entry_id_fkey"
FOREIGN KEY ("ledger_entry_id") REFERENCES "opod"."credit_ledger_entries"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
