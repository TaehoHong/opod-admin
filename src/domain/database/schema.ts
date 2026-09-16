import {
  pgSchema,
  uuid,
  bigint,
  bigserial,
  text,
  integer,
  smallint,
  timestamp,
  boolean,
  doublePrecision,
  jsonb,
  numeric,
  uniqueIndex,
  index,
  foreignKey,
  primaryKey,
  check,
  vector,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { v7 as createUuidV7 } from "uuid";

export const opod = pgSchema("opod");
export const mediaType = opod.enum("media_type", ["image", "video"]);
export const postContentType = opod.enum("post_content_type", ["feed", "reel"]);
export const messageSenderType = opod.enum("chat_message_sender_role", [
  "user",
  "character",
]);
export const creditReservationStatus = opod.enum("credit_reservation_status", [
  "reserved",
  "captured",
  "released",
]);
export const generationJobStatus = opod.enum("generation_job_status", [
  "draft",
  "queued",
  "running",
  "completed",
  "failed",
]);
export const postDraftStatus = opod.enum("post_draft_status", [
  "planned",
  "generating",
  "needs_review",
  "regenerating",
  "approved",
  "rejected",
  "published",
  "failed",
]);
export const postDraftType = opod.enum("post_draft_type", ["post", "story"]);
export const reportTargetType = opod.enum("report_target_type", [
  "character",
  "post",
  "message",
]);
export const reportStatus = opod.enum("report_status", [
  "submitted",
  "reviewing",
  "resolved",
  "rejected",
]);
export const characterStatus = opod.enum("character_status", [
  "active",
  "inactive",
]);
export const inquiryStatus = opod.enum("inquiry_status", [
  "submitted",
  "answered",
]);
export const agentMemoryKind = opod.enum("chat_memory_derivation_type", [
  "observation",
  "reflection",
]);
export const chatMemoryContextInjectionMode = opod.enum(
  "chat_memory_context_injection_mode",
  ["always", "retrieved"],
);
export const agentJobStatus = opod.enum(
  "chat_memory_consolidation_job_status",
  ["queued", "running", "completed", "failed"],
);
export const creditKind = opod.enum("credit_kind", ["free", "paid"]);
export const consentType = opod.enum("consent_type", [
  "terms_of_service",
  "privacy",
  "age_14",
  "marketing",
]);
export const llmLogStatus = opod.enum("llm_log_status", [
  "running",
  "succeeded",
  "failed",
]);
export const llmLogMediaRole = opod.enum("llm_log_media_role", [
  "input",
  "output",
]);
export const creditLedgerType = opod.enum("credit_ledger_type", [
  "grant",
  "usage",
  "refund_recovery",
  "adjustment",
]);
export const creditRefundState = opod.enum("credit_refund_state", [
  "reserved",
  "payment_processing",
  "payment_succeeded",
  "completed",
  "failed",
  "canceled",
]);
export const paymentChannel = opod.enum("payment_channel", [
  "web",
  "apple",
  "google",
]);
export const paymentStatus = opod.enum("payment_status", [
  "pending",
  "verified",
  "processing",
  "paid",
  "failed",
  "canceled",
  "partially_refunded",
  "refunded",
  "reversed",
]);
export const paymentLedgerType = opod.enum("payment_ledger_type", [
  "capture",
  "refund",
  "chargeback",
  "adjustment",
]);
export const paymentDirection = opod.enum("payment_direction", [
  "inflow",
  "outflow",
]);
export const paymentProviderEventStatus = opod.enum(
  "payment_provider_event_status",
  ["processing", "processed", "failed"],
);
export const creditPurchaseStatus = opod.enum("credit_purchase_status", [
  "pending",
  "payment_processing",
  "completed",
  "failed",
  "canceled",
  "refunded",
  "reversed",
]);
export const draftEvaluationKind = opod.enum("draft_evaluation_kind", [
  "plan",
  "prompt",
  "image",
  "image_plan",
]);
export const draftEvaluationStatus = opod.enum("draft_evaluation_status", [
  "pending",
  "completed",
  "failed",
]);
export const messageReplyJobStatus = opod.enum(
  "chat_reply_generation_job_status",
  ["queued", "running", "completed", "failed"],
);

export const adminSettings = opod.table("admin_settings", {
  key: text().primaryKey(),
  value: text().notNull(),
  updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true })
    .notNull()
    .$onUpdateFn(() => new Date()),
});

export const admins = opod.table(
  "admins",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    email: text().notNull(),
    password: text().notNull(),
    isEnabled: boolean("is_enabled").default(true).notNull(),
    isDeleted: boolean("is_deleted").default(false).notNull(),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true })
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("admins_email_key").using(
      "btree",
      table.email.asc().nullsLast(),
    ),
    index("admins_is_enabled_is_deleted_idx").using(
      "btree",
      table.isEnabled.asc().nullsLast(),
      table.isDeleted.asc().nullsLast(),
    ),
  ],
);

export const agentArchivalMemories = opod.table(
  "chat_memory_entries",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    userId: text("user_id").notNull(),
    characterId: text("character_id").notNull(),
    content: text("memory_text").notNull(),
    kind: agentMemoryKind("derivation_type").notNull(),
    importance: doublePrecision("importance_score").notNull(),
    embedding: doublePrecision("memory_embedding").array(),
    embeddingModel: text("embedding_model"),
    embeddingSourceSha256: text("embedded_text_sha256"),
    sourceSessionId: text("source_session_id"),
    sourceMessages: jsonb("source_message_snapshots"),
    memoryType: text("memory_category"),
    contextInjectionMode: chatMemoryContextInjectionMode(
      "context_injection_mode",
    )
      .default("retrieved")
      .notNull(),
    occurredAt: timestamp("event_occurred_at", {
      precision: 6,
      withTimezone: true,
    }),
    evidence: text("supporting_memory_ids")
      .array()
      .default(sql`ARRAY[]::text[]`),
    operationKey: text("write_operation_key"),
    ordinal: integer("write_batch_index").default(0).notNull(),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    lastAccessedAt: timestamp("last_recalled_at", {
      precision: 6,
      withTimezone: true,
    })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    check(
      "chat_memory_entries_source_message_snapshots_check",
      sql`${table.sourceMessages} IS NULL OR jsonb_typeof(${table.sourceMessages}) = 'array'`,
    ),
    check(
      "chat_memory_entries_memory_category_check",
      sql`${table.memoryType} IS NULL OR ${table.memoryType} IN ('user_fact', 'shared_episode', 'interpretation')`,
    ),
    index("chat_memory_entries_user_character_derivation_created_idx").using(
      "btree",
      table.userId.asc().nullsLast(),
      table.characterId.asc().nullsLast(),
      table.kind.asc().nullsLast(),
      table.createdAt.asc().nullsLast(),
    ),
    index("chat_memory_entries_user_character_last_recalled_idx").using(
      "btree",
      table.userId.asc().nullsLast(),
      table.characterId.asc().nullsLast(),
      table.lastAccessedAt.asc().nullsLast(),
    ),
    uniqueIndex(
      "chat_memory_entries_user_character_write_operation_batch_key",
    ).using(
      "btree",
      table.userId.asc().nullsLast(),
      table.characterId.asc().nullsLast(),
      table.operationKey.asc().nullsLast(),
      table.ordinal.asc().nullsLast(),
    ),
  ],
);

export const agentMemoryJobs = opod.table(
  "chat_memory_consolidation_jobs",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    idempotencyKey: text("idempotency_key").notNull(),
    payloadJson: jsonb("consolidation_request").notNull(),
    status: agentJobStatus("processing_status").default("queued").notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    leaseExpiresAt: timestamp("processing_lease_expires_at", {
      precision: 6,
      withTimezone: true,
    }),
    errorMessage: text("last_error_message"),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true })
      .notNull()
      .$onUpdateFn(() => new Date()),
    characterId: text("character_id").notNull(),
    userId: text("user_id").notNull(),
  },
  (table) => [
    uniqueIndex("chat_memory_consolidation_jobs_idempotency_key_key").using(
      "btree",
      table.idempotencyKey.asc().nullsLast(),
    ),
    index("chat_memory_consolidation_jobs_status_lease_idx").using(
      "btree",
      table.status.asc().nullsLast(),
      table.leaseExpiresAt.asc().nullsLast(),
    ),
    index("chat_memory_consolidation_jobs_user_character_status_idx").using(
      "btree",
      table.userId.asc().nullsLast(),
      table.characterId.asc().nullsLast(),
      table.status.asc().nullsLast(),
    ),
  ],
);

export const agentMemoryOperations = opod.table(
  "chat_applied_state_changes",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    userId: text("user_id").notNull(),
    characterId: text("character_id").notNull(),
    operationKey: text("idempotency_key").notNull(),
    createdAt: timestamp("applied_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    uniqueIndex(
      "chat_applied_state_changes_user_character_idempotency_key",
    ).using(
      "btree",
      table.userId.asc().nullsLast(),
      table.characterId.asc().nullsLast(),
      table.operationKey.asc().nullsLast(),
    ),
  ],
);

export const agentRelationshipState = opod.table(
  "chat_relationship_states",
  {
    userId: text("user_id").notNull(),
    characterId: text("character_id").notNull(),
    importanceSinceReflection: doublePrecision("unreflected_importance_score")
      .default(0)
      .notNull(),
    updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true })
      .notNull()
      .$onUpdateFn(() => new Date()),
    bondXp: integer("bond_experience_points").default(0).notNull(),
    bondLevel: integer("bond_level").default(1).notNull(),
    lastDecayAt: timestamp("last_exchange_at", {
      precision: 6,
      withTimezone: true,
    })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    dailyBondDate: text("daily_bond_experience_date").default("").notNull(),
    dailyBondXp: integer("daily_bond_experience_points").default(0).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.characterId],
      name: "chat_relationship_states_pkey",
    }),
  ],
);

export const agentSummaries = opod.table(
  "chat_memory_session_summaries",
  {
    userId: text("user_id").notNull(),
    characterId: text("character_id").notNull(),
    sessionId: text("session_id").notNull(),
    content: text("summary_text").notNull(),
    turnsCovered: integer("summarized_message_count").notNull(),
    revision: integer("revision_number").notNull(),
    updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true })
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.characterId, table.sessionId],
      name: "chat_memory_session_summaries_pkey",
    }),
  ],
);

export const characterActionLogs = opod.table(
  "character_action_logs",
  {
    id: bigserial({ mode: "bigint" }).primaryKey(),
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, {
        name: "character_action_logs_character_id_fkey",
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    actionType: text("action_type").notNull(),
    targetTable: text("target_table"),
    targetId: uuid("target_id"),
    reason: text().notNull(),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index("character_action_logs_character_id_created_at_idx").using(
      "btree",
      table.characterId.asc().nullsLast(),
      table.createdAt.asc().nullsLast(),
    ),
  ],
);

export const characterLocationReferences = opod.table(
  "character_location_references",
  {
    locationId: uuid("location_id")
      .notNull()
      .references(() => characterLocations.id, {
        name: "character_location_references_location_id_fkey",
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => media.id, {
        name: "character_location_references_media_id_fkey",
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    sortOrder: integer("sort_order").default(0).notNull(),
    description: text().default("").notNull(),
    embedding: vector({ dimensions: 1024 }),
    embeddingModel: text("embedding_model"),
    embeddedAt: timestamp("embedded_at", {
      precision: 6,
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true })
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => [
    primaryKey({
      columns: [table.locationId, table.mediaId],
      name: "character_location_references_pkey",
    }),
    index("character_location_references_location_id_sort_order_idx").using(
      "btree",
      table.locationId.asc().nullsLast(),
      table.sortOrder.asc().nullsLast(),
    ),
  ],
);

export const characterLocations = opod.table(
  "character_locations",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    characterId: uuid("character_id").references(() => characters.id, {
      name: "character_locations_character_id_fkey",
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    locationKey: text("location_key").notNull(),
    displayName: text("display_name").notNull(),
    description: text().notNull(),
    visualPrompt: text("visual_prompt").notNull(),
    negativePrompt: text("negative_prompt").default("").notNull(),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true })
      .notNull()
      .$onUpdateFn(() => new Date()),
    deletedAt: timestamp("deleted_at", { precision: 6, withTimezone: true }),
    referenceNegativePrompt: text("reference_negative_prompt")
      .default("")
      .notNull(),
  },
  (table) => [
    index("character_locations_character_id_deleted_at_created_at_idx").using(
      "btree",
      table.characterId.asc().nullsLast(),
      table.deletedAt.asc().nullsLast(),
      table.createdAt.asc().nullsLast(),
    ),
    uniqueIndex("character_locations_character_id_location_key_key").using(
      "btree",
      table.characterId.asc().nullsLast(),
      table.locationKey.asc().nullsLast(),
    ),
    uniqueIndex("character_locations_global_location_key_key")
      .using("btree", table.locationKey.asc().nullsLast())
      .where(sql`(character_id IS NULL)`),
  ],
);

export const characterMemories = opod.table(
  "character_canon_memories",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, {
        name: "character_canon_memories_character_id_fkey",
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    content: text("canon_text").notNull(),
    embedding: vector("canon_embedding", { dimensions: 1024 }),
    embeddingModel: text("embedding_model"),
    embeddingSourceSha256: text("embedded_text_sha256"),
    occurredAt: timestamp("event_occurred_at", {
      precision: 6,
      withTimezone: true,
    }),
    sourceRefs: jsonb("source_references"),
    occurredLabel: text("event_time_label"),
    occurredPrecision: text("event_time_precision"),
    embeddedAt: timestamp("embedding_generated_at", {
      precision: 6,
      withTimezone: true,
    }),
    reason: text("authoring_reason").notNull(),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true })
      .notNull()
      .$onUpdateFn(() => new Date()),
    deletedAt: timestamp("deleted_at", { precision: 6, withTimezone: true }),
    type: text("authoring_category").default("fact").notNull(),
    kind: text("temporal_kind"),
    injection: text("context_injection_mode"),
    recallKeys: text("retrieval_keywords")
      .array()
      .default(sql`ARRAY[]::text[]`)
      .notNull(),
  },
  (table) => [
    check(
      "character_canon_memories_routing_check",
      sql`
      (${table.kind} IS NULL AND ${table.injection} IS NULL)
      OR (${table.kind} IS NOT NULL AND ${table.injection} IS NOT NULL
        AND ${table.kind} IN ('fact', 'event')
        AND ${table.injection} IN ('always', 'retrieved')
        AND (${table.kind} <> 'event' OR ${table.injection} = 'retrieved'))
    `,
    ),
    check(
      "character_canon_memories_source_references_check",
      sql`${table.sourceRefs} IS NULL OR jsonb_typeof(${table.sourceRefs}) = 'array'`,
    ),
    check(
      "character_canon_memories_event_time_precision_check",
      sql`${table.occurredPrecision} IS NULL OR ${table.occurredPrecision} IN ('year', 'month', 'day', 'instant', 'approximate')`,
    ),
    check(
      "character_canon_memories_event_time_fields_check",
      sql`(${table.occurredPrecision} IS NULL AND ${table.occurredLabel} IS NULL)
        OR (${table.occurredPrecision} IS NOT NULL AND ${table.occurredLabel} IS NOT NULL
          AND length(trim(${table.occurredLabel})) > 0
          AND ((${table.occurredPrecision} = 'instant' AND ${table.occurredAt} IS NOT NULL)
            OR (${table.occurredPrecision} <> 'instant' AND ${table.occurredAt} IS NULL)))`,
    ),
    index("character_canon_memories_character_deleted_created_idx").using(
      "btree",
      table.characterId.asc().nullsLast(),
      table.deletedAt.asc().nullsLast(),
      table.createdAt.asc().nullsLast(),
    ),
  ],
);

export const characterPersonas = opod.table(
  "character_personas",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, {
        name: "character_personas_character_id_fkey",
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    title: text().notNull(),
    content: text().notNull(),
    schemaVersion: smallint("schema_version").default(1).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true })
      .notNull()
      .$onUpdateFn(() => new Date()),
    deletedAt: timestamp("deleted_at", { precision: 6, withTimezone: true }),
  },
  (table) => [
    index("character_personas_character_id_deleted_at_sort_order_idx").using(
      "btree",
      table.characterId.asc().nullsLast(),
      table.deletedAt.asc().nullsLast(),
      table.sortOrder.asc().nullsLast(),
    ),
  ],
);

// Authored fragments remain attached to their complete, recoverable source.
export const characterPersonaFragments = opod.table(
  "character_persona_fragments",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    personaId: uuid("persona_id")
      .notNull()
      .references(() => characterPersonas.id, {
        name: "character_persona_fragments_persona_id_fkey",
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    ordinal: integer().notNull(),
    content: text().notNull(),
    embedding: vector({ dimensions: 1024 }),
    embeddingModel: text("embedding_model"),
    embeddingSourceSha256: text("embedding_source_sha256"),
    embeddedAt: timestamp("embedded_at", { precision: 6, withTimezone: true }),
    kind: text().notNull(),
    injection: text().notNull(),
    recallKeys: text("recall_keys")
      .array()
      .default(sql`ARRAY[]::text[]`)
      .notNull(),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true })
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("character_persona_fragments_persona_ordinal_idx").on(
      table.personaId,
      table.ordinal,
    ),
    check(
      "character_persona_fragments_ordinal_check",
      sql`${table.ordinal} >= 0`,
    ),
    check(
      "character_persona_fragments_content_check",
      sql`length(${table.content}) > 0`,
    ),
    check(
      "character_persona_fragments_kind_check",
      sql`${table.kind} IN ('identity', 'behavior', 'voice', 'example', 'greeting', 'lore', 'creator_note', 'motivation', 'judgment', 'tension', 'relationship', 'boundary')`,
    ),
    check(
      "character_persona_fragments_injection_check",
      sql`${table.injection} IN ('always', 'start_only', 'retrieved', 'never_prompt')`,
    ),
  ],
);

// Links record provenance, never a command to retrieve the canonical record.
export const characterPersonaCanonLinks = opod.table(
  "character_persona_canon_links",
  {
    fragmentId: uuid("fragment_id")
      .notNull()
      .references(() => characterPersonaFragments.id, {
        name: "character_persona_canon_links_fragment_id_fkey",
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    memoryId: uuid("memory_id")
      .notNull()
      .references(() => characterMemories.id, {
        name: "character_persona_canon_links_memory_id_fkey",
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
  },
  (table) => [
    primaryKey({
      columns: [table.fragmentId, table.memoryId],
      name: "character_persona_canon_links_pkey",
    }),
  ],
);

export const characterPostingPolicies = opod.table(
  "character_posting_policies",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, {
        name: "character_posting_policies_character_id_fkey",
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    enabled: boolean().default(false).notNull(),
    weeklyCadence: integer("weekly_cadence").default(3).notNull(),
    hourStartKst: integer("hour_start_kst").default(18).notNull(),
    hourEndKst: integer("hour_end_kst").default(22).notNull(),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true })
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("character_posting_policies_character_id_key").using(
      "btree",
      table.characterId.asc().nullsLast(),
    ),
  ],
);

export const characterVisualProfileReferences = opod.table(
  "character_visual_profile_references",
  {
    profileId: uuid("profile_id")
      .notNull()
      .references(() => characterVisualProfiles.id, {
        name: "character_visual_profile_references_profile_id_fkey",
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => media.id, {
        name: "character_visual_profile_references_media_id_fkey",
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    sortOrder: integer("sort_order").default(0).notNull(),
    description: text().default("").notNull(),
    embedding: vector({ dimensions: 1024 }),
    embeddingModel: text("embedding_model"),
    embeddedAt: timestamp("embedded_at", {
      precision: 6,
      withTimezone: true,
    }),
    isActive: boolean("is_active").default(true).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.profileId, table.mediaId],
      name: "character_visual_profile_references_pkey",
    }),
  ],
);

export const characterVisualProfiles = opod.table(
  "character_visual_profiles",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, {
        name: "character_visual_profiles_character_id_fkey",
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    appearancePrompt: text("appearance_prompt").default("").notNull(),
    stylePrompt: text("style_prompt").default("").notNull(),
    negativePrompt: text("negative_prompt").default("").notNull(),
    providerConfig: jsonb("provider_config"),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true })
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("character_visual_profiles_character_id_key").using(
      "btree",
      table.characterId.asc().nullsLast(),
    ),
  ],
);

export const characters = opod.table(
  "characters",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    publicId: text("public_id").notNull(),
    displayName: text("display_name").notNull(),
    bio: text().notNull(),
    interests: text()
      .array()
      .default(sql`ARRAY[]::text[]`),
    status: characterStatus().default("active").notNull(),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true })
      .notNull()
      .$onUpdateFn(() => new Date()),
    profileImageCropX: doublePrecision("profile_image_crop_x")
      .default(0.5)
      .notNull(),
    profileImageCropY: doublePrecision("profile_image_crop_y")
      .default(0.5)
      .notNull(),
    profileImageCropZoom: doublePrecision("profile_image_crop_zoom")
      .default(1)
      .notNull(),
    profileImageId: uuid("profile_image_id").references(() => media.id, {
      name: "characters_profile_image_id_fkey",
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    contentLanguage: text("content_language").default("ko").notNull(),
  },
  (table) => [
    index("characters_profile_image_id_idx").using(
      "btree",
      table.profileImageId.asc().nullsLast(),
    ),
    uniqueIndex("characters_public_id_key").using(
      "btree",
      table.publicId.asc().nullsLast(),
    ),
  ],
);

export const consoleLogs = opod.table(
  "console_logs",
  {
    id: bigserial({ mode: "bigint" }).primaryKey(),
    adminId: uuid("admin_id"),
    adminEmail: text("admin_email"),
    actionType: text("action_type").notNull(),
    target: text(),
    summary: text().notNull(),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index("console_logs_action_type_created_at_idx").using(
      "btree",
      table.actionType.asc().nullsLast(),
      table.createdAt.asc().nullsLast(),
    ),
    index("console_logs_created_at_idx").using(
      "btree",
      table.createdAt.asc().nullsLast(),
    ),
  ],
);

export const creditCheckIns = opod.table(
  "credit_check_ins",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        name: "credit_check_ins_user_id_fkey",
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    checkInDate: text("check_in_date").notNull(),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("credit_check_ins_user_id_check_in_date_key").using(
      "btree",
      table.userId.asc().nullsLast(),
      table.checkInDate.asc().nullsLast(),
    ),
  ],
);

export const creditLedger = opod.table(
  "credit_ledger",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        name: "credit_ledger_user_id_fkey",
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    type: creditLedgerType().notNull(),
    creditKind: creditKind("credit_kind"),
    purchaseId: uuid("purchase_id").references(() => creditPurchases.id, {
      name: "credit_ledger_purchase_id_fkey",
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    promotionCode: text("promotion_code"),
    amount: integer().notNull(),
    expiresAt: timestamp("expires_at", { precision: 6, withTimezone: true }),
    reason: text().notNull(),
    externalReference: text("external_reference"),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("credit_ledger_external_reference_key").using(
      "btree",
      table.externalReference.asc().nullsLast(),
    ),
    index("credit_ledger_purchase_id_idx").using(
      "btree",
      table.purchaseId.asc().nullsLast(),
    ),
    index("credit_ledger_user_id_created_at_idx").using(
      "btree",
      table.userId.asc().nullsLast(),
      table.createdAt.asc().nullsLast(),
    ),
    index("credit_ledger_user_id_type_credit_kind_expires_at_idx").using(
      "btree",
      table.userId.asc().nullsLast(),
      table.type.asc().nullsLast(),
      table.creditKind.asc().nullsLast(),
      table.expiresAt.asc().nullsLast(),
    ),
  ],
);

export const creditProducts = opod.table(
  "credit_products",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    code: text().notNull(),
    name: text().notNull(),
    creditAmount: integer("credit_amount").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    displayOrder: integer("display_order").default(0).notNull(),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true })
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("credit_products_code_key").using(
      "btree",
      table.code.asc().nullsLast(),
    ),
    index("credit_products_is_active_display_order_idx").using(
      "btree",
      table.isActive.asc().nullsLast(),
      table.displayOrder.asc().nullsLast(),
    ),
  ],
);

export const creditPurchases = opod.table(
  "credit_purchases",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        name: "credit_purchases_user_id_fkey",
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    status: creditPurchaseStatus().default("pending").notNull(),
    creditAmount: integer("credit_amount").notNull(),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true })
      .notNull()
      .$onUpdateFn(() => new Date()),
    fulfilledAt: timestamp("fulfilled_at", {
      precision: 6,
      withTimezone: true,
    }),
    idempotencyKey: text("idempotency_key").notNull(),
    productId: text("product_id").notNull(),
    creditProductId: uuid("credit_product_id")
      .notNull()
      .references(() => creditProducts.id, {
        name: "credit_purchases_credit_product_id_fkey",
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
  },
  (table) => [
    index("credit_purchases_credit_product_id_created_at_idx").using(
      "btree",
      table.creditProductId.asc().nullsLast(),
      table.createdAt.asc().nullsLast(),
    ),
    index("credit_purchases_status_created_at_idx").using(
      "btree",
      table.status.asc().nullsLast(),
      table.createdAt.asc().nullsLast(),
    ),
    index("credit_purchases_user_id_created_at_idx").using(
      "btree",
      table.userId.asc().nullsLast(),
      table.createdAt.asc().nullsLast(),
    ),
    uniqueIndex("credit_purchases_user_id_idempotency_key_key").using(
      "btree",
      table.userId.asc().nullsLast(),
      table.idempotencyKey.asc().nullsLast(),
    ),
  ],
);

export const creditRefund = opod.table(
  "credit_refund",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    purchaseId: uuid("purchase_id")
      .notNull()
      .references(() => creditPurchases.id, {
        name: "credit_refund_purchase_id_fkey",
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    status: creditRefundState().default("reserved").notNull(),
    reason: text().default("user_request").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    creditAmount: integer("credit_amount").notNull(),
    promotionAmount: integer("promotion_amount").default(0).notNull(),
    lockedAmount: integer("locked_amount").notNull(),
    recoveryAmount: integer("recovery_amount").notNull(),
    debtAmount: integer("debt_amount").default(0).notNull(),
    grossAmount: integer("gross_amount").notNull(),
    feeAmount: integer("fee_amount").notNull(),
    refundAmount: integer("refund_amount").notNull(),
    currency: text().notNull(),
    providerRefundId: text("provider_refund_id"),
    providerTransactionId: text("provider_transaction_id"),
    completedAt: timestamp("completed_at", {
      precision: 6,
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true })
      .notNull()
      .$onUpdateFn(() => new Date()),
    provider: text().notNull(),
    freePromotionAmount: integer("free_promotion_amount").default(0).notNull(),
  },
  (table) => [
    uniqueIndex("credit_refund_provider_provider_refund_id_key").using(
      "btree",
      table.provider.asc().nullsLast(),
      table.providerRefundId.asc().nullsLast(),
    ),
    uniqueIndex("credit_refund_purchase_id_idempotency_key_key").using(
      "btree",
      table.purchaseId.asc().nullsLast(),
      table.idempotencyKey.asc().nullsLast(),
    ),
    index("credit_refund_purchase_id_status_idx").using(
      "btree",
      table.purchaseId.asc().nullsLast(),
      table.status.asc().nullsLast(),
    ),
    index("credit_refund_status_created_at_idx").using(
      "btree",
      table.status.asc().nullsLast(),
      table.createdAt.asc().nullsLast(),
    ),
  ],
);

export const creditReservations = opod.table(
  "credit_reservations",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        name: "credit_reservations_user_id_fkey",
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    actionType: text("action_type").notNull(),
    amount: integer().notNull(),
    status: creditReservationStatus().default("reserved").notNull(),
    reference: text().notNull(),
    expiresAt: timestamp("expires_at", { precision: 6, withTimezone: true }),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true })
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("credit_reservations_reference_key").using(
      "btree",
      table.reference.asc().nullsLast(),
    ),
    index("credit_reservations_user_id_status_expires_at_idx").using(
      "btree",
      table.userId.asc().nullsLast(),
      table.status.asc().nullsLast(),
      table.expiresAt.asc().nullsLast(),
    ),
  ],
);

export const creditUsage = opod.table(
  "credit_usage",
  {
    usageLedgerId: uuid("usage_ledger_id")
      .notNull()
      .references(() => creditLedger.id, {
        name: "credit_usage_usage_ledger_id_fkey",
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    grantLedgerId: uuid("grant_ledger_id")
      .notNull()
      .references(() => creditLedger.id, {
        name: "credit_usage_grant_ledger_id_fkey",
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    amount: integer().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.usageLedgerId, table.grantLedgerId],
      name: "credit_usage_pkey",
    }),
    index("credit_usage_grant_ledger_id_idx").using(
      "btree",
      table.grantLedgerId.asc().nullsLast(),
    ),
  ],
);

export const draftEvaluations = opod.table(
  "draft_evaluations",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => postDrafts.id, {
        name: "draft_evaluations_draft_id_fkey",
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    kind: draftEvaluationKind().notNull(),
    attempt: integer().default(1).notNull(),
    status: draftEvaluationStatus().default("pending").notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", {
      precision: 6,
      withTimezone: true,
    }),
    evaluatorName: text("evaluator_name"),
    rubricVersion: text("rubric_version").notNull(),
    contentLanguage: text("content_language").default("ko").notNull(),
    overallScore: doublePrecision("overall_score"),
    scoresJson: jsonb("scores_json"),
    issuesJson: jsonb("issues_json"),
    suggestionsJson: jsonb("suggestions_json"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    completedAt: timestamp("completed_at", {
      precision: 6,
      withTimezone: true,
    }),
  },
  (table) => [
    uniqueIndex("draft_evaluations_draft_id_kind_attempt_key").using(
      "btree",
      table.draftId.asc().nullsLast(),
      table.kind.asc().nullsLast(),
      table.attempt.asc().nullsLast(),
    ),
    index("draft_evaluations_kind_created_at_idx").using(
      "btree",
      table.kind.asc().nullsLast(),
      table.createdAt.asc().nullsLast(),
    ),
    index("draft_evaluations_status_lease_expires_at_idx").using(
      "btree",
      table.status.asc().nullsLast(),
      table.leaseExpiresAt.asc().nullsLast(),
    ),
  ],
);

export const evaluationReports = opod.table(
  "evaluation_reports",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    periodStart: timestamp("period_start", {
      precision: 6,
      withTimezone: true,
    }).notNull(),
    periodEnd: timestamp("period_end", {
      precision: 6,
      withTimezone: true,
    }).notNull(),
    rubricVersion: text("rubric_version").notNull(),
    summaryJson: jsonb("summary_json").notNull(),
    failurePatternsJson: jsonb("failure_patterns_json"),
    promptSuggestionsJson: jsonb("prompt_suggestions_json"),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index("evaluation_reports_created_at_idx").using(
      "btree",
      table.createdAt.asc().nullsLast(),
    ),
  ],
);

export const faqs = opod.table(
  "faqs",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    category: text().notNull(),
    question: text().notNull(),
    answer: text().notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    isPublished: boolean("is_published").default(false).notNull(),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true })
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => [
    index("faqs_is_published_category_sort_order_idx").using(
      "btree",
      table.isPublished.asc().nullsLast(),
      table.category.asc().nullsLast(),
      table.sortOrder.asc().nullsLast(),
    ),
  ],
);

export const generationJobOutputs = opod.table(
  "generation_job_outputs",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    jobId: uuid("job_id")
      .notNull()
      .references(() => generationJobs.id, {
        name: "generation_job_outputs_job_id_fkey",
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => media.id, {
        name: "generation_job_outputs_media_id_fkey",
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    candidateIndex: integer("candidate_index").notNull(),
    selected: boolean().default(false).notNull(),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    filterPreset: text("filter_preset"),
  },
  (table) => [
    uniqueIndex("generation_job_outputs_job_id_candidate_index_key").using(
      "btree",
      table.jobId.asc().nullsLast(),
      table.candidateIndex.asc().nullsLast(),
    ),
    index("generation_job_outputs_media_id_idx").using(
      "btree",
      table.mediaId.asc().nullsLast(),
    ),
    check(
      "generation_job_outputs_filter_preset_check",
      sql`((filter_preset IS NULL) OR (filter_preset = ANY (ARRAY['none'::text, 'film'::text, 'mono-film'::text])))`,
    ),
  ],
);

export const generationJobs = opod.table(
  "generation_jobs",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, {
        name: "generation_jobs_character_id_fkey",
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    mediaType: mediaType("media_type").notNull(),
    prompt: text().notNull(),
    inputPrompt: text("input_prompt"),
    candidateCount: integer("candidate_count"),
    status: generationJobStatus().default("queued").notNull(),
    outputMediaId: uuid("output_media_id").references(() => media.id, {
      name: "generation_jobs_output_media_id_fkey",
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    provider: text(),
    paramsJson: jsonb("params_json"),
    providerRequestId: text("provider_request_id"),
    leaseExpiresAt: timestamp("lease_expires_at", {
      precision: 6,
      withTimezone: true,
    }),
    attemptCount: integer("attempt_count").default(0).notNull(),
    originJobId: uuid("origin_job_id"),
    errorMessage: text("error_message"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 4 }),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true })
      .notNull()
      .$onUpdateFn(() => new Date()),
    draftId: uuid("draft_id").references(() => postDrafts.id, {
      name: "generation_jobs_draft_id_fkey",
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    sortOrder: integer("sort_order").default(0).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.originJobId],
      foreignColumns: [table.id],
      name: "generation_jobs_origin_job_id_fkey",
    })
      .onUpdate("cascade")
      .onDelete("set null"),
    index("generation_jobs_draft_id_idx").using(
      "btree",
      table.draftId.asc().nullsLast(),
    ),
    index("generation_jobs_status_created_at_idx").using(
      "btree",
      table.status.asc().nullsLast(),
      table.createdAt.asc().nullsLast(),
    ),
    index("generation_jobs_status_lease_expires_at_idx").using(
      "btree",
      table.status.asc().nullsLast(),
      table.leaseExpiresAt.asc().nullsLast(),
    ),
  ],
);

export const hashtags = opod.table(
  "hashtags",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    name: text().notNull(),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true })
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("hashtags_name_key").using(
      "btree",
      table.name.asc().nullsLast(),
    ),
  ],
);

export const inquiries = opod.table(
  "inquiries",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        name: "inquiries_user_id_fkey",
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    category: text().notNull(),
    body: text().notNull(),
    status: inquiryStatus().default("submitted").notNull(),
    answerBody: text("answer_body"),
    answeredAt: timestamp("answered_at", { precision: 6, withTimezone: true }),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true })
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => [
    index("inquiries_status_created_at_idx").using(
      "btree",
      table.status.asc().nullsLast(),
      table.createdAt.asc().nullsLast(),
    ),
    index("inquiries_user_id_created_at_idx").using(
      "btree",
      table.userId.asc().nullsLast(),
      table.createdAt.asc().nullsLast(),
    ),
  ],
);

export const llmLogMedia = opod.table(
  "llm_log_media",
  {
    llmLogId: bigint("llm_log_id", { mode: "bigint" })
      .notNull()
      .references(() => llmLogs.id, {
        name: "llm_log_media_llm_log_id_fkey",
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => media.id, {
        name: "llm_log_media_media_id_fkey",
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    role: llmLogMediaRole().notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.llmLogId, table.role, table.mediaId],
      name: "llm_log_media_pkey",
    }),
    index("llm_log_media_media_id_idx").using(
      "btree",
      table.mediaId.asc().nullsLast(),
    ),
  ],
);

export const llmLogs = opod.table(
  "llm_logs",
  {
    id: bigserial({ mode: "bigint" }).primaryKey(),
    type: text().notNull(),
    provider: text().notNull(),
    model: text().notNull(),
    status: llmLogStatus().default("running").notNull(),
    endpoint: text(),
    isStreaming: boolean("is_streaming").default(false).notNull(),
    requestId: text("request_id"),
    providerRequestId: text("provider_request_id"),
    userId: text("user_id"),
    characterId: text("character_id"),
    generationJobId: uuid("generation_job_id").references(
      () => generationJobs.id,
      {
        name: "llm_logs_generation_job_id_fkey",
        onDelete: "set null",
        onUpdate: "cascade",
      },
    ),
    systemPromptJson: jsonb("system_prompt_json"),
    userPromptJson: jsonb("user_prompt_json"),
    requestJson: jsonb("request_json").notNull(),
    responseJson: jsonb("response_json"),
    metadataJson: jsonb("metadata_json"),
    redactedPaths: text("redacted_paths")
      .array()
      .default(sql`ARRAY[]::text[]`)
      .notNull(),
    httpStatus: integer("http_status"),
    errorType: text("error_type"),
    errorMessage: text("error_message"),
    durationMs: integer("duration_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    completedAt: timestamp("completed_at", {
      precision: 6,
      withTimezone: true,
    }),
    responseModel: text("response_model"),
    usageJson: jsonb("usage_json"),
    finishReason: text("finish_reason"),
    timeToFirstTokenMs: integer("time_to_first_token_ms"),
    cachedInputTokens: integer("cached_input_tokens"),
    cacheWriteTokens: integer("cache_write_tokens"),
    reasoningTokens: integer("reasoning_tokens"),
    cost: numeric({ precision: 20, scale: 10 }),
    upstreamCost: numeric("upstream_cost", { precision: 20, scale: 10 }),
  },
  (table) => [
    index("llm_logs_character_id_created_at_idx").using(
      "btree",
      table.characterId.asc().nullsLast(),
      table.createdAt.asc().nullsLast(),
    ),
    index("llm_logs_created_at_idx").using(
      "btree",
      table.createdAt.asc().nullsLast(),
    ),
    index("llm_logs_generation_job_id_idx").using(
      "btree",
      table.generationJobId.asc().nullsLast(),
    ),
    index("llm_logs_provider_request_id_idx").using(
      "btree",
      table.providerRequestId.asc().nullsLast(),
    ),
    index("llm_logs_request_id_idx").using(
      "btree",
      table.requestId.asc().nullsLast(),
    ),
    index("llm_logs_status_created_at_idx").using(
      "btree",
      table.status.asc().nullsLast(),
      table.createdAt.asc().nullsLast(),
    ),
    index("llm_logs_type_created_at_idx").using(
      "btree",
      table.type.asc().nullsLast(),
      table.createdAt.asc().nullsLast(),
    ),
    index("llm_logs_user_id_created_at_idx").using(
      "btree",
      table.userId.asc().nullsLast(),
      table.createdAt.asc().nullsLast(),
    ),
  ],
);

export const media = opod.table(
  "media",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    mediaType: mediaType("media_type").notNull(),
    url: text().notNull(),
    storageKey: text("storage_key"),
    contentType: text("content_type"),
    byteSize: integer("byte_size"),
    width: integer(),
    height: integer(),
    durationSeconds: integer("duration_seconds"),
    isAiGenerated: boolean("is_ai_generated").default(false).notNull(),
    uploadedAt: timestamp("uploaded_at", { precision: 6, withTimezone: true }),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("media_storage_key_key").using(
      "btree",
      table.storageKey.asc().nullsLast(),
    ),
  ],
);

export const messageConversations = opod.table(
  "chat_conversations",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        name: "chat_conversations_user_id_fkey",
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, {
        name: "chat_conversations_character_id_fkey",
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    lastReadAt: timestamp("user_last_read_at", {
      precision: 6,
      withTimezone: true,
    }),
    lastMessageAt: timestamp("latest_message_at", {
      precision: 6,
      withTimezone: true,
    })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("chat_conversations_user_id_character_id_key").using(
      "btree",
      table.userId.asc().nullsLast(),
      table.characterId.asc().nullsLast(),
    ),
  ],
);

export const messageReplyJobs = opod.table(
  "chat_reply_generation_jobs",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => messageConversations.id, {
        name: "chat_reply_generation_jobs_conversation_id_fkey",
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    turnId: uuid("trigger_message_id").notNull(),
    status: messageReplyJobStatus("generation_status")
      .default("queued")
      .notNull(),
    reservationReference: text("credit_reservation_reference"),
    readyAt: timestamp("next_attempt_at", {
      precision: 6,
      withTimezone: true,
    })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    leaseExpiresAt: timestamp("processing_lease_expires_at", {
      precision: 6,
      withTimezone: true,
    }),
    startedAt: timestamp("first_attempt_started_at", {
      precision: 6,
      withTimezone: true,
    }),
    deadlineAt: timestamp("processing_deadline_at", {
      precision: 6,
      withTimezone: true,
    }),
    completedAt: timestamp("completed_at", {
      precision: 6,
      withTimezone: true,
    }),
    failedAt: timestamp("failed_at", { precision: 6, withTimezone: true }),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true })
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => [
    index("chat_reply_generation_jobs_conversation_status_idx").using(
      "btree",
      table.conversationId.asc().nullsLast(),
      table.status.asc().nullsLast(),
    ),
    index("chat_reply_generation_jobs_status_lease_idx").using(
      "btree",
      table.status.asc().nullsLast(),
      table.leaseExpiresAt.asc().nullsLast(),
    ),
    index("chat_reply_generation_jobs_status_next_attempt_idx").using(
      "btree",
      table.status.asc().nullsLast(),
      table.readyAt.asc().nullsLast(),
    ),
    uniqueIndex("chat_reply_generation_jobs_trigger_message_id_key").using(
      "btree",
      table.turnId.asc().nullsLast(),
    ),
  ],
);

export const messages = opod.table(
  "chat_messages",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => messageConversations.id, {
        name: "chat_messages_conversation_id_fkey",
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    senderType: messageSenderType("sender_role").notNull(),
    body: text("message_text").notNull(),
    createdAt: timestamp("sent_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    replyJobId: uuid("reply_generation_job_id").references(
      () => messageReplyJobs.id,
      {
        name: "chat_messages_reply_generation_job_id_fkey",
        onDelete: "set null",
        onUpdate: "cascade",
      },
    ),
  },
  (table) => [
    index("chat_messages_conversation_sent_at_idx").using(
      "btree",
      table.conversationId.asc().nullsLast(),
      table.createdAt.asc().nullsLast(),
    ),
    index("chat_messages_reply_generation_job_id_idx").using(
      "btree",
      table.replyJobId.asc().nullsLast(),
    ),
  ],
);

export const notices = opod.table(
  "notices",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    title: text().notNull(),
    body: text().notNull(),
    isPinned: boolean("is_pinned").default(false).notNull(),
    publishedAt: timestamp("published_at", {
      precision: 6,
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true })
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => [
    index("notices_is_pinned_published_at_idx").using(
      "btree",
      table.isPinned.asc().nullsLast(),
      table.publishedAt.asc().nullsLast(),
    ),
  ],
);

export const notifications = opod.table(
  "notifications",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        name: "notifications_user_id_fkey",
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    type: text().notNull(),
    title: text().notNull(),
    body: text(),
    targetType: text("target_type"),
    targetId: uuid("target_id"),
    readAt: timestamp("read_at", { precision: 6, withTimezone: true }),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index("notifications_user_id_created_at_idx").using(
      "btree",
      table.userId.asc().nullsLast(),
      table.createdAt.asc().nullsLast(),
    ),
    index("notifications_user_id_read_at_created_at_idx").using(
      "btree",
      table.userId.asc().nullsLast(),
      table.readAt.asc().nullsLast(),
      table.createdAt.asc().nullsLast(),
    ),
  ],
);

export const paymentLedger = opod.table(
  "payment_ledger",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, {
        name: "payment_ledger_payment_id_fkey",
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    type: paymentLedgerType().notNull(),
    direction: paymentDirection().notNull(),
    amount: integer(),
    currency: text(),
    providerTransactionId: text("provider_transaction_id"),
    providerEventId: text("provider_event_id"),
    adminId: uuid("admin_id").references(() => admins.id, {
      name: "payment_ledger_admin_id_fkey",
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    reason: text(),
    details: jsonb(),
    occurredAt: timestamp("occurred_at", {
      precision: 6,
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index("payment_ledger_admin_id_occurred_at_idx").using(
      "btree",
      table.adminId.asc().nullsLast(),
      table.occurredAt.asc().nullsLast(),
    ),
    index("payment_ledger_payment_id_occurred_at_idx").using(
      "btree",
      table.paymentId.asc().nullsLast(),
      table.occurredAt.asc().nullsLast(),
    ),
    index("payment_ledger_provider_transaction_id_idx").using(
      "btree",
      table.providerTransactionId.asc().nullsLast(),
    ),
    index("payment_ledger_type_occurred_at_idx").using(
      "btree",
      table.type.asc().nullsLast(),
      table.occurredAt.asc().nullsLast(),
    ),
  ],
);

export const paymentProductMappings = opod.table(
  "payment_product_mappings",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    creditProductId: uuid("credit_product_id")
      .notNull()
      .references(() => creditProducts.id, {
        name: "payment_product_mappings_credit_product_id_fkey",
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    channel: paymentChannel().notNull(),
    provider: text().notNull(),
    environment: text().notNull(),
    providerProductId: text("provider_product_id").notNull(),
    priceAmount: integer("price_amount"),
    currency: text(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true })
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => [
    index(
      "payment_product_mappings_channel_provider_environment_is_ac_idx",
    ).using(
      "btree",
      table.channel.asc().nullsLast(),
      table.provider.asc().nullsLast(),
      table.environment.asc().nullsLast(),
      table.isActive.asc().nullsLast(),
    ),
    uniqueIndex(
      "payment_product_mappings_credit_product_id_channel_provider_key",
    ).using(
      "btree",
      table.creditProductId.asc().nullsLast(),
      table.channel.asc().nullsLast(),
      table.provider.asc().nullsLast(),
      table.environment.asc().nullsLast(),
    ),
    uniqueIndex(
      "payment_product_mappings_provider_environment_provider_prod_key",
    ).using(
      "btree",
      table.provider.asc().nullsLast(),
      table.environment.asc().nullsLast(),
      table.providerProductId.asc().nullsLast(),
    ),
  ],
);

export const paymentProviderEvents = opod.table(
  "payment_provider_events",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    paymentId: uuid("payment_id").references(() => payments.id, {
      name: "payment_provider_events_payment_id_fkey",
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    provider: text().notNull(),
    externalEventId: text("external_event_id").notNull(),
    eventType: text("event_type").notNull(),
    status: paymentProviderEventStatus().default("processing").notNull(),
    attempts: integer().default(1).notNull(),
    lastErrorCode: text("last_error_code"),
    processedAt: timestamp("processed_at", {
      precision: 6,
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true })
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("payment_provider_events_provider_external_event_id_key").using(
      "btree",
      table.provider.asc().nullsLast(),
      table.externalEventId.asc().nullsLast(),
    ),
    index("payment_provider_events_status_updated_at_idx").using(
      "btree",
      table.status.asc().nullsLast(),
      table.updatedAt.asc().nullsLast(),
    ),
  ],
);

export const payments = opod.table(
  "payments",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    purchaseId: uuid("purchase_id")
      .notNull()
      .references(() => creditPurchases.id, {
        name: "payments_purchase_id_fkey",
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    channel: paymentChannel().notNull(),
    provider: text().notNull(),
    status: paymentStatus().default("pending").notNull(),
    amount: integer(),
    currency: text(),
    providerCheckoutId: text("provider_checkout_id"),
    providerCheckoutUrl: text("provider_checkout_url"),
    providerTransactionId: text("provider_transaction_id"),
    providerTransactionKey: text("provider_transaction_key"),
    providerProductId: text("provider_product_id").notNull(),
    providerEnvironment: text("provider_environment"),
    paidAt: timestamp("paid_at", { precision: 6, withTimezone: true }),
    refundedAt: timestamp("refunded_at", { precision: 6, withTimezone: true }),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true })
      .notNull()
      .$onUpdateFn(() => new Date()),
    netAmount: integer("net_amount"),
    taxAmount: integer("tax_amount"),
  },
  (table) => [
    uniqueIndex("payments_provider_provider_checkout_id_key").using(
      "btree",
      table.provider.asc().nullsLast(),
      table.providerCheckoutId.asc().nullsLast(),
    ),
    index("payments_provider_provider_transaction_id_idx").using(
      "btree",
      table.provider.asc().nullsLast(),
      table.providerTransactionId.asc().nullsLast(),
    ),
    uniqueIndex("payments_provider_provider_transaction_key_key").using(
      "btree",
      table.provider.asc().nullsLast(),
      table.providerTransactionKey.asc().nullsLast(),
    ),
    index("payments_provider_status_created_at_idx").using(
      "btree",
      table.provider.asc().nullsLast(),
      table.status.asc().nullsLast(),
      table.createdAt.asc().nullsLast(),
    ),
    uniqueIndex("payments_purchase_id_key").using(
      "btree",
      table.purchaseId.asc().nullsLast(),
    ),
    index("payments_status_updated_at_idx").using(
      "btree",
      table.status.asc().nullsLast(),
      table.updatedAt.asc().nullsLast(),
    ),
  ],
);

export const postComments = opod.table(
  "post_comments",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, {
        name: "post_comments_post_id_fkey",
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    characterId: uuid("character_id").references(() => characters.id, {
      name: "post_comments_character_id_fkey",
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    userId: uuid("user_id").references(() => users.id, {
      name: "post_comments_user_id_fkey",
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    body: text().notNull(),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index("post_comments_character_id_created_at_idx").using(
      "btree",
      table.characterId.asc().nullsLast(),
      table.createdAt.asc().nullsLast(),
    ),
    index("post_comments_post_id_created_at_idx").using(
      "btree",
      table.postId.asc().nullsLast(),
      table.createdAt.asc().nullsLast(),
    ),
    index("post_comments_user_id_created_at_idx").using(
      "btree",
      table.userId.asc().nullsLast(),
      table.createdAt.asc().nullsLast(),
    ),
  ],
);

export const postDrafts = opod.table(
  "post_drafts",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, {
        name: "post_drafts_character_id_fkey",
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    draftType: postDraftType("draft_type").default("post").notNull(),
    contentType: postContentType("content_type").default("feed").notNull(),
    caption: text().default("").notNull(),
    hashtags: text()
      .array()
      .default(sql`ARRAY[]::text[]`),
    conceptJson: jsonb("concept_json"),
    status: postDraftStatus().default("planned").notNull(),
    errorMessage: text("error_message"),
    leaseExpiresAt: timestamp("lease_expires_at", {
      precision: 6,
      withTimezone: true,
    }),
    attemptCount: integer("attempt_count").default(0).notNull(),
    scheduledAt: timestamp("scheduled_at", {
      precision: 6,
      withTimezone: true,
    }),
    publishedPostId: uuid("published_post_id").references(() => posts.id, {
      name: "post_drafts_published_post_id_fkey",
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    publishedStoryId: uuid("published_story_id").references(() => stories.id, {
      name: "post_drafts_published_story_id_fkey",
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true })
      .notNull()
      .$onUpdateFn(() => new Date()),
    locationId: uuid("location_id").references(() => characterLocations.id, {
      name: "post_drafts_location_id_fkey",
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
  },
  (table) => [
    index("post_drafts_character_id_created_at_idx").using(
      "btree",
      table.characterId.asc().nullsLast(),
      table.createdAt.asc().nullsLast(),
    ),
    index("post_drafts_location_id_created_at_idx").using(
      "btree",
      table.locationId.asc().nullsLast(),
      table.createdAt.asc().nullsLast(),
    ),
    index("post_drafts_status_lease_expires_at_idx").using(
      "btree",
      table.status.asc().nullsLast(),
      table.leaseExpiresAt.asc().nullsLast(),
    ),
    index("post_drafts_status_scheduled_at_idx").using(
      "btree",
      table.status.asc().nullsLast(),
      table.scheduledAt.asc().nullsLast(),
    ),
  ],
);

export const postHashtags = opod.table(
  "post_hashtags",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, {
        name: "post_hashtags_post_id_fkey",
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    hashtagId: uuid("hashtag_id")
      .notNull()
      .references(() => hashtags.id, {
        name: "post_hashtags_hashtag_id_fkey",
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
  },
  (table) => [
    primaryKey({
      columns: [table.postId, table.hashtagId],
      name: "post_hashtags_pkey",
    }),
    index("post_hashtags_hashtag_id_idx").using(
      "btree",
      table.hashtagId.asc().nullsLast(),
    ),
  ],
);

export const postMedia = opod.table(
  "post_media",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, {
        name: "post_media_post_id_fkey",
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => media.id, {
        name: "post_media_media_id_fkey",
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    sortOrder: integer("sort_order").default(0).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.postId, table.mediaId],
      name: "post_media_pkey",
    }),
  ],
);

export const postReactions = opod.table(
  "post_reactions",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, {
        name: "post_reactions_post_id_fkey",
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    characterId: uuid("character_id").references(() => characters.id, {
      name: "post_reactions_character_id_fkey",
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    userId: uuid("user_id").references(() => users.id, {
      name: "post_reactions_user_id_fkey",
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    reactionType: text("reaction_type").notNull(),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index("post_reactions_character_id_created_at_idx").using(
      "btree",
      table.characterId.asc().nullsLast(),
      table.createdAt.asc().nullsLast(),
    ),
    index("post_reactions_post_id_created_at_idx").using(
      "btree",
      table.postId.asc().nullsLast(),
      table.createdAt.asc().nullsLast(),
    ),
    uniqueIndex("post_reactions_post_id_user_id_reaction_type_key").using(
      "btree",
      table.postId.asc().nullsLast(),
      table.userId.asc().nullsLast(),
      table.reactionType.asc().nullsLast(),
    ),
    index("post_reactions_user_id_created_at_idx").using(
      "btree",
      table.userId.asc().nullsLast(),
      table.createdAt.asc().nullsLast(),
    ),
  ],
);

export const posts = opod.table("posts", {
  id: uuid()
    .primaryKey()
    .$defaultFn(() => createUuidV7()),
  characterId: uuid("character_id")
    .notNull()
    .references(() => characters.id, {
      name: "posts_character_id_fkey",
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
  contentType: postContentType("content_type").default("feed").notNull(),
  content: text().default("").notNull(),
  createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

export const reports = opod.table(
  "reports",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    reporterUserId: uuid("reporter_user_id")
      .notNull()
      .references(() => users.id, {
        name: "reports_reporter_user_id_fkey",
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    targetType: reportTargetType("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    reason: text().notNull(),
    details: text(),
    resolution: text(),
    status: reportStatus().default("submitted").notNull(),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true })
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => [
    index("reports_status_created_at_idx").using(
      "btree",
      table.status.asc().nullsLast(),
      table.createdAt.asc().nullsLast(),
    ),
    index("reports_target_type_target_id_idx").using(
      "btree",
      table.targetType.asc().nullsLast(),
      table.targetId.asc().nullsLast(),
    ),
  ],
);

export const serviceLogs = opod.table(
  "service_logs",
  {
    id: bigserial({ mode: "bigint" }).primaryKey(),
    source: text().notNull(),
    level: text().default("info").notNull(),
    eventType: text("event_type").notNull(),
    message: text().notNull(),
    contextJson: jsonb("context_json"),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index("service_logs_created_at_idx").using(
      "btree",
      table.createdAt.asc().nullsLast(),
    ),
    index("service_logs_event_type_created_at_idx").using(
      "btree",
      table.eventType.asc().nullsLast(),
      table.createdAt.asc().nullsLast(),
    ),
  ],
);

export const stories = opod.table(
  "stories",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, {
        name: "stories_character_id_fkey",
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => media.id, {
        name: "stories_media_id_fkey",
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    caption: text().default("").notNull(),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    expiresAt: timestamp("expires_at", {
      precision: 6,
      withTimezone: true,
    }).notNull(),
  },
  (table) => [
    index("stories_character_id_expires_at_created_at_idx").using(
      "btree",
      table.characterId.asc().nullsLast(),
      table.expiresAt.asc().nullsLast(),
      table.createdAt.asc().nullsLast(),
    ),
    index("stories_expires_at_created_at_idx").using(
      "btree",
      table.expiresAt.asc().nullsLast(),
      table.createdAt.asc().nullsLast(),
    ),
  ],
);

export const termsDocuments = opod.table(
  "terms_documents",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    type: consentType().notNull(),
    version: text().notNull(),
    title: text().notNull(),
    body: text().notNull(),
    effectiveAt: timestamp("effective_at", {
      precision: 6,
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true })
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => [
    index("terms_documents_type_effective_at_idx").using(
      "btree",
      table.type.asc().nullsLast(),
      table.effectiveAt.asc().nullsLast(),
    ),
    uniqueIndex("terms_documents_type_version_key").using(
      "btree",
      table.type.asc().nullsLast(),
      table.version.asc().nullsLast(),
    ),
  ],
);

export const unsettledCreditDebts = opod.table(
  "unsettled_credit_debts",
  {
    identityHash: text("identity_hash").primaryKey(),
    paidDebt: integer("paid_debt").notNull(),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true })
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  () => [check("unsettled_credit_debts_paid_debt_check", sql`(paid_debt > 0)`)],
);

export const userAccounts = opod.table(
  "user_accounts",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        name: "user_accounts_user_id_fkey",
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    provider: text().notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    email: text(),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("user_accounts_provider_provider_account_id_key").using(
      "btree",
      table.provider.asc().nullsLast(),
      table.providerAccountId.asc().nullsLast(),
    ),
    index("user_accounts_user_id_idx").using(
      "btree",
      table.userId.asc().nullsLast(),
    ),
    uniqueIndex("user_accounts_user_id_provider_key").using(
      "btree",
      table.userId.asc().nullsLast(),
      table.provider.asc().nullsLast(),
    ),
  ],
);

export const userCharacterFollows = opod.table(
  "user_character_follows",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        name: "user_character_follows_user_id_fkey",
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, {
        name: "user_character_follows_character_id_fkey",
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    notifiedUpToAt: timestamp("notified_up_to_at", {
      precision: 6,
      withTimezone: true,
    })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.characterId],
      name: "user_character_follows_pkey",
    }),
  ],
);

export const userConsents = opod.table(
  "user_consents",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        name: "user_consents_user_id_fkey",
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    type: consentType().notNull(),
    version: text().notNull(),
    agreed: boolean().notNull(),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index("user_consents_user_id_type_created_at_idx").using(
      "btree",
      table.userId.asc().nullsLast(),
      table.type.asc().nullsLast(),
      table.createdAt.asc().nullsLast(),
    ),
  ],
);

export const userEvents = opod.table(
  "user_events",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        name: "user_events_user_id_fkey",
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    eventType: text("event_type").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    metadata: jsonb(),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index("user_events_target_type_target_id_idx").using(
      "btree",
      table.targetType.asc().nullsLast(),
      table.targetId.asc().nullsLast(),
    ),
    index("user_events_user_id_created_at_idx").using(
      "btree",
      table.userId.asc().nullsLast(),
      table.createdAt.asc().nullsLast(),
    ),
  ],
);

export const userHashtagPreferences = opod.table(
  "user_hashtag_preferences",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        name: "user_hashtag_preferences_user_id_fkey",
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    hashtagId: uuid("hashtag_id")
      .notNull()
      .references(() => hashtags.id, {
        name: "user_hashtag_preferences_hashtag_id_fkey",
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    score: doublePrecision().default(0).notNull(),
    updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true })
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.hashtagId],
      name: "user_hashtag_preferences_pkey",
    }),
    index("user_hashtag_preferences_hashtag_id_idx").using(
      "btree",
      table.hashtagId.asc().nullsLast(),
    ),
  ],
);

export const userRefreshTokens = opod.table(
  "user_refresh_tokens",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        name: "user_refresh_tokens_user_id_fkey",
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    tokenHash: text("token_hash").notNull(),
    revokedAt: timestamp("revoked_at", { precision: 6, withTimezone: true }),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("user_refresh_tokens_token_hash_key").using(
      "btree",
      table.tokenHash.asc().nullsLast(),
    ),
    index("user_refresh_tokens_user_id_created_at_idx").using(
      "btree",
      table.userId.asc().nullsLast(),
      table.createdAt.asc().nullsLast(),
    ),
  ],
);

export const userWithdrawals = opod.table("user_withdrawals", {
  id: uuid()
    .primaryKey()
    .$defaultFn(() => createUuidV7()),
  userId: uuid("user_id").notNull(),
  reasonCategory: text("reason_category"),
  reasonText: text("reason_text"),
  createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

export const users = opod.table(
  "users",
  {
    id: uuid()
      .primaryKey()
      .$defaultFn(() => createUuidV7()),
    email: text(),
    passwordHash: text("password_hash"),
    passwordSalt: text("password_salt"),
    displayName: text("display_name").notNull(),
    bio: text().default("").notNull(),
    profileImageUrl: text("profile_image_url"),
    createdAt: timestamp("created_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { precision: 6, withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull()
      .$onUpdateFn(() => new Date()),
    deletedAt: timestamp("deleted_at", { precision: 6, withTimezone: true }),
    adultVerifiedAt: timestamp("adult_verified_at", {
      precision: 6,
      withTimezone: true,
    }),
    adultIdentityHash: text("adult_identity_hash"),
    debtIdentityHash: text("debt_identity_hash"),
  },
  (table) => [
    uniqueIndex("users_adult_identity_hash_key").using(
      "btree",
      table.adultIdentityHash.asc().nullsLast(),
    ),
    uniqueIndex("users_debt_identity_hash_key").using(
      "btree",
      table.debtIdentityHash.asc().nullsLast(),
    ),
    uniqueIndex("users_email_key").using(
      "btree",
      table.email.asc().nullsLast(),
    ),
  ],
);
