import { Injectable } from "@nestjs/common";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { DatabaseService } from "../core/database/database.service";
import { postAgentPrompts } from "../core/database/schema";
import { PostAgentStage } from "../../prompts/post-agent-defaults";
export type PostAgentPromptRow = typeof postAgentPrompts.$inferSelect;
@Injectable()
export class PostAgentPromptRepository {
  constructor(private readonly database: DatabaseService) {}
  async current(stage: PostAgentStage) {
    const [row] = await this.database.client
      .select()
      .from(postAgentPrompts)
      .where(eq(postAgentPrompts.stage, stage))
      .orderBy(desc(postAgentPrompts.revision))
      .limit(1);
    return row ?? null;
  }
  async find(id: bigint) {
    const [row] = await this.database.client
      .select()
      .from(postAgentPrompts)
      .where(eq(postAgentPrompts.id, id))
      .limit(1);
    return row ?? null;
  }
  list(stage: PostAgentStage, cursor: bigint | undefined, limit: number) {
    return this.database.client
      .select()
      .from(postAgentPrompts)
      .where(
        and(
          eq(postAgentPrompts.stage, stage),
          cursor === undefined ? undefined : lt(postAgentPrompts.id, cursor),
        ),
      )
      .orderBy(desc(postAgentPrompts.id))
      .limit(limit + 1);
  }
  append(
    stage: PostAgentStage,
    expectedRevision: number,
    input: Pick<
      PostAgentPromptRow,
      "aiModelId" | "model" | "systemPrompt" | "outputSchema"
    >,
  ) {
    return this.database.client.transaction(async (tx) => {
      // Serializes even the first revision, where no row exists to lock yet.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`post_agent:${stage}`}, 0))`,
      );
      const [current] = await tx
        .select()
        .from(postAgentPrompts)
        .where(eq(postAgentPrompts.stage, stage))
        .orderBy(desc(postAgentPrompts.revision))
        .limit(1);
      if ((current?.revision ?? 0) !== expectedRevision) return null;
      const [row] = await tx
        .insert(postAgentPrompts)
        .values({ ...input, stage, revision: expectedRevision + 1 })
        .returning();
      return row;
    });
  }
}
