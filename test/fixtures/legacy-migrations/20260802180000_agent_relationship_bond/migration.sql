-- Bond: the (user, character) relationship progression read by opod-agent.
--
-- Two axes on purpose. `bond_xp` is a lifetime accumulator that never
-- decreases; `warmth` is contact temperature and decays with wall-clock time.
-- Existing rows backfill to a fresh relationship (0 XP, neutral warmth) rather
-- than being granted history they never earned.
--
-- `last_decay_at` defaults to now() so a pre-existing row is treated as warm
-- *as of this migration*, not as if it had been decaying since the epoch.
--
-- `bond_level` is derived from `bond_xp` but stored anyway: this service reads
-- it for GET /characters/:id/relationship, and a column is the only way it can
-- do that without a second copy of the Agent's level curve drifting here.
ALTER TABLE "opod"."agent_relationship_state" ADD COLUMN     "bond_xp" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "bond_level" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "warmth" DOUBLE PRECISION NOT NULL DEFAULT 20,
ADD COLUMN     "last_decay_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "daily_bond_date" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "daily_bond_xp" INTEGER NOT NULL DEFAULT 0;
