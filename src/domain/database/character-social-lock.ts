import { sql } from "drizzle-orm";

type SqlExecutor = {
  execute(query: unknown): Promise<unknown>;
};

export function lockCharacterSocial(
  executor: SqlExecutor,
  characterId: string,
): Promise<unknown> {
  return executor.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`character_social:${characterId}`}, 0))`,
  );
}
