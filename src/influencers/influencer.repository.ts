import { Injectable } from "@nestjs/common";
import { asc, eq, gt, inArray } from "drizzle-orm";
import { DatabaseService } from "../core/database/database.service";
import { influencers } from "../core/database/schema";
@Injectable()
export class InfluencerRepository {
  constructor(private readonly db: DatabaseService) {}
  async register(value: { platform: string; username: string; url: string }) {
    const [row] = await this.db.client
      .insert(influencers)
      .values(value)
      .onConflictDoUpdate({
        target: [influencers.platform, influencers.username],
        set: { url: value.url },
      })
      .returning();
    return row;
  }
  async get(id: bigint) {
    const [row] = await this.db.client
      .select()
      .from(influencers)
      .where(eq(influencers.id, id));
    return row;
  }
  byIds(ids: bigint[]) {
    return ids.length
      ? this.db.client
          .select()
          .from(influencers)
          .where(inArray(influencers.id, ids))
      : Promise.resolve([]);
  }
  list(after: bigint | undefined, limit: number) {
    return this.db.client
      .select()
      .from(influencers)
      .where(after ? gt(influencers.id, after) : undefined)
      .orderBy(asc(influencers.id))
      .limit(limit);
  }
}
