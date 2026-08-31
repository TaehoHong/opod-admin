-- CreateEnum
CREATE TYPE "opod"."consent_type" AS ENUM ('terms_of_service', 'privacy', 'age_14', 'marketing');

-- CreateTable
CREATE TABLE "opod"."terms_documents" (
    "id" UUID NOT NULL,
    "type" "opod"."consent_type" NOT NULL,
    "version" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "effective_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "terms_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opod"."user_consents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "opod"."consent_type" NOT NULL,
    "version" TEXT NOT NULL,
    "agreed" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_consents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "terms_documents_type_version_key" ON "opod"."terms_documents"("type", "version");

-- CreateIndex
CREATE INDEX "terms_documents_type_effective_at_idx" ON "opod"."terms_documents"("type", "effective_at");

-- CreateIndex
CREATE INDEX "user_consents_user_id_type_created_at_idx" ON "opod"."user_consents"("user_id", "type", "created_at");

-- AddForeignKey
ALTER TABLE "opod"."user_consents" ADD CONSTRAINT "user_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "opod"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
