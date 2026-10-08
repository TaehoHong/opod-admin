import { Injectable } from "@nestjs/common";
import { eq, inArray, sql } from "drizzle-orm";
import { DatabaseService } from "../core/database/database.service";
import { adminSettings } from "../core/database/schema";

export type GenerationSettingRow = {
  key: string;
  value: string;
};

@Injectable()
export class GenerationSettingsRepository {
  constructor(private readonly database: DatabaseService) {}

  findByKeys(keys: string[]): Promise<GenerationSettingRow[]> {
    if (keys.length === 0) return Promise.resolve([]);
    return this.database.client
      .select({ key: adminSettings.key, value: adminSettings.value })
      .from(adminSettings)
      .where(inArray(adminSettings.key, keys));
  }

  async upsertValue(key: string, value: string): Promise<void> {
    await this.database.client
      .insert(adminSettings)
      .values({ key, value })
      .onConflictDoUpdate({ target: adminSettings.key, set: { value } });
  }

  async compareAndSetValue(
    key: string,
    expected: string | null,
    value: string,
  ): Promise<boolean> {
    return this.database.client.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
      );
      const [current] = await tx
        .select({ value: adminSettings.value })
        .from(adminSettings)
        .where(eq(adminSettings.key, key));
      if ((current?.value ?? null) !== expected) return false;
      await tx
        .insert(adminSettings)
        .values({ key, value })
        .onConflictDoUpdate({ target: adminSettings.key, set: { value } });
      return true;
    });
  }

  async deleteByKey(key: string): Promise<void> {
    await this.database.client
      .delete(adminSettings)
      .where(eq(adminSettings.key, key));
  }
}
