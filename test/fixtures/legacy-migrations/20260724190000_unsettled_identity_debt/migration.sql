ALTER TABLE "opod"."users"
ADD COLUMN "adult_verified_at" TIMESTAMPTZ(6),
ADD COLUMN "adult_identity_hash" TEXT,
ADD COLUMN "debt_identity_hash" TEXT;

CREATE UNIQUE INDEX "users_adult_identity_hash_key"
ON "opod"."users"("adult_identity_hash");
CREATE UNIQUE INDEX "users_debt_identity_hash_key"
ON "opod"."users"("debt_identity_hash");

CREATE TABLE "opod"."unsettled_credit_debts" (
  "identity_hash" TEXT NOT NULL,
  "paid_debt" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "unsettled_credit_debts_pkey" PRIMARY KEY ("identity_hash"),
  CONSTRAINT "unsettled_credit_debts_paid_debt_check" CHECK ("paid_debt" > 0)
);
