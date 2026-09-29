import { Injectable } from "@nestjs/common";
import { desc, eq, lt } from "drizzle-orm";
import { DatabaseService } from "../core/database/database.service";
import { aiModels } from "../core/database/schema";
@Injectable()
export class AiModelRepository {
  constructor(private readonly database: DatabaseService) {}
  async find(id: bigint) {
    const [row] = await this.database.client
      .select()
      .from(aiModels)
      .where(eq(aiModels.id, id))
      .limit(1);
    return row ?? null;
  }
  list(cursor: bigint | undefined, limit: number) {
    return this.database.client
      .select()
      .from(aiModels)
      .where(cursor === undefined ? undefined : lt(aiModels.id, cursor))
      .orderBy(desc(aiModels.id))
      .limit(limit + 1);
  }
  async create(input: {
    type: "llm" | "image";
    provider: string;
    model: string;
  }) {
    const [row] = await this.database.client
      .insert(aiModels)
      .values(input)
      .returning();
    return row;
  }
}
