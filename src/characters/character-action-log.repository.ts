import { Injectable } from "@nestjs/common";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { DatabaseService } from "../domain/database/database.service";
import { DatabaseTransactionContext } from "../domain/database/database-transaction-context";
import { characterActionLogs } from "../domain/database/schema";

@Injectable()
export class CharacterActionLogRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly transactions: DatabaseTransactionContext,
  ) {}

  async record(input: {
    characterId: string;
    actionType: string;
    targetTable: string;
    targetId: string;
    reason: string;
  }): Promise<void> {
    await this.transactions
      .currentOr(this.database.client)
      .insert(characterActionLogs)
      .values(input);
  }

  async list(input: { characterId?: string; cursor?: bigint; limit: number }) {
    const client = this.transactions.currentOr(this.database.client);
    const [cursor] =
      input.cursor !== undefined
        ? await client
            .select({
              id: characterActionLogs.id,
              createdAt: characterActionLogs.createdAt,
            })
            .from(characterActionLogs)
            .where(eq(characterActionLogs.id, input.cursor))
            .limit(1)
        : [];
    return client
      .select()
      .from(characterActionLogs)
      .where(
        and(
          input.characterId
            ? eq(characterActionLogs.characterId, input.characterId)
            : undefined,
          cursor
            ? or(
                lt(characterActionLogs.createdAt, cursor.createdAt),
                and(
                  eq(characterActionLogs.createdAt, cursor.createdAt),
                  lt(characterActionLogs.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(
        desc(characterActionLogs.createdAt),
        desc(characterActionLogs.id),
      )
      .limit(input.limit + 1);
  }
}
