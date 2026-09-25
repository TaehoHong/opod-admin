import { Injectable } from "@nestjs/common";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { DatabaseService } from "../domain/database/database.service";
import { DatabaseTransactionContext } from "../domain/database/database-transaction-context";
import { postReactions } from "../domain/database/schema";

export type PostReactionRecord = typeof postReactions.$inferSelect;

@Injectable()
export class PostReactionRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly transactions: DatabaseTransactionContext,
  ) {}

  hasCursor(
    cursorId: string,
    filters: { postId: string; characterId?: string; reactionType?: string },
  ) {
    return this.client()
      .select({ id: postReactions.id })
      .from(postReactions)
      .where(and(eq(postReactions.id, cursorId), this.condition(filters)))
      .limit(1)
      .then((rows) => rows.length > 0);
  }

  async list(input: {
    filters: { postId: string; characterId?: string; reactionType?: string };
    cursorId?: string;
    limit: number;
  }) {
    const [cursor] = input.cursorId
      ? await this.client()
          .select({ id: postReactions.id, createdAt: postReactions.createdAt })
          .from(postReactions)
          .where(eq(postReactions.id, input.cursorId))
          .limit(1)
      : [];
    return this.client()
      .select()
      .from(postReactions)
      .where(
        and(
          this.condition(input.filters),
          cursor
            ? or(
                lt(postReactions.createdAt, cursor.createdAt),
                and(
                  eq(postReactions.createdAt, cursor.createdAt),
                  lt(postReactions.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(postReactions.createdAt), desc(postReactions.id))
      .limit(input.limit + 1);
  }

  async create(input: {
    postId: string;
    characterId: string;
    reactionType: string;
  }) {
    const client = this.client();
    const [created] = await client
      .insert(postReactions)
      .values(input)
      .onConflictDoNothing()
      .returning();
    if (created) return { reaction: created, created: true };
    const [existing] = await client
      .select()
      .from(postReactions)
      .where(this.condition(input))
      .limit(1);
    if (!existing) throw new Error("reaction conflict did not resolve");
    return { reaction: existing, created: false };
  }

  private client() {
    return this.transactions.currentOr(this.database.client);
  }

  private condition(filters: {
    postId: string;
    characterId?: string;
    reactionType?: string;
  }) {
    return and(
      eq(postReactions.postId, filters.postId),
      filters.characterId
        ? eq(postReactions.characterId, filters.characterId)
        : undefined,
      filters.reactionType
        ? eq(postReactions.reactionType, filters.reactionType)
        : undefined,
    );
  }
}
