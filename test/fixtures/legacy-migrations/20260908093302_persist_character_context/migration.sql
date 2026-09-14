CREATE TABLE "opod"."character_persona_fragments" (
	"id" uuid PRIMARY KEY,
	"persona_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"content" text NOT NULL,
	"kind" text NOT NULL,
	"injection" text NOT NULL,
	"recall_keys" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"created_at" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp(6) with time zone NOT NULL,
	CONSTRAINT "character_persona_fragments_ordinal_check" CHECK ("ordinal" >= 0),
	CONSTRAINT "character_persona_fragments_content_check" CHECK (length("content") > 0),
	CONSTRAINT "character_persona_fragments_kind_check" CHECK ("kind" IN ('identity', 'behavior', 'voice', 'example', 'greeting', 'lore', 'creator_note')),
	CONSTRAINT "character_persona_fragments_injection_check" CHECK ("injection" IN ('always', 'start_only', 'retrieved', 'never_prompt'))
);
--> statement-breakpoint
ALTER TABLE "opod"."character_memories" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "opod"."character_memories" ADD COLUMN "injection" text;--> statement-breakpoint
ALTER TABLE "opod"."character_memories" ADD COLUMN "recall_keys" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "character_persona_fragments_persona_ordinal_idx" ON "opod"."character_persona_fragments" ("persona_id","ordinal");--> statement-breakpoint
ALTER TABLE "opod"."character_persona_fragments" ADD CONSTRAINT "character_persona_fragments_persona_id_fkey" FOREIGN KEY ("persona_id") REFERENCES "opod"."character_personas"("id") ON DELETE CASCADE ON UPDATE CASCADE;--> statement-breakpoint
ALTER TABLE "opod"."character_memories" ADD CONSTRAINT "character_memories_routing_check" CHECK (
      ("kind" IS NULL AND "injection" IS NULL)
      OR ("kind" IS NOT NULL AND "injection" IS NOT NULL
        AND "kind" IN ('fact', 'event')
        AND "injection" IN ('always', 'retrieved')
        AND ("kind" <> 'event' OR "injection" = 'retrieved'))
    );
