CREATE TYPE "opod"."credit_kind" AS ENUM ('free', 'paid');

ALTER TABLE "opod"."credit_ledger_entries"
ADD COLUMN "credit_kind" "opod"."credit_kind",
ADD COLUMN "purchase_id" UUID;

UPDATE "opod"."credit_ledger_entries"
SET "credit_kind" = CASE
    WHEN "expires_at" IS NULL THEN 'paid'::"opod"."credit_kind"
    ELSE 'free'::"opod"."credit_kind"
END
WHERE "entry_type" = 'grant';

UPDATE "opod"."credit_ledger_entries" AS ledger
SET "purchase_id" = split_part(ledger."external_reference", ':', 2)::UUID
WHERE ledger."entry_type" = 'grant'
  AND ledger."external_reference" ~ '^credit_purchase:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND EXISTS (
    SELECT 1
    FROM "opod"."credit_purchases" AS purchase
    WHERE purchase."id" = split_part(ledger."external_reference", ':', 2)::UUID
  );

ALTER TABLE "opod"."credit_ledger_entries"
ADD CONSTRAINT "credit_ledger_entries_grant_kind_check"
CHECK (
  ("entry_type" = 'grant' AND "credit_kind" IS NOT NULL)
  OR ("entry_type" = 'debit' AND "credit_kind" IS NULL)
);

CREATE TABLE "opod"."credit_accounts" (
  "user_id" UUID NOT NULL,
  "paid_debt" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "credit_accounts_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "credit_accounts_paid_debt_check" CHECK ("paid_debt" >= 0)
);

DROP INDEX "opod"."credit_ledger_entries_user_id_entry_type_expires_at_idx";
CREATE INDEX "credit_ledger_entries_user_id_entry_type_credit_kind_expires_at_idx"
ON "opod"."credit_ledger_entries"("user_id", "entry_type", "credit_kind", "expires_at");
CREATE INDEX "credit_ledger_entries_purchase_id_idx"
ON "opod"."credit_ledger_entries"("purchase_id");

ALTER TABLE "opod"."credit_ledger_entries"
ADD CONSTRAINT "credit_ledger_entries_purchase_id_fkey"
FOREIGN KEY ("purchase_id") REFERENCES "opod"."credit_purchases"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "opod"."credit_accounts"
ADD CONSTRAINT "credit_accounts_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "opod"."users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
