import { Injectable } from "@nestjs/common";
import { eq, inArray } from "drizzle-orm";
import { DatabaseService } from "../database/database.service";
import { adminSettings } from "../database/schema";

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

  async deleteByKey(key: string): Promise<void> {
    await this.database.client
      .delete(adminSettings)
      .where(eq(adminSettings.key, key));
  }
}
