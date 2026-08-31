import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../../domain/database/database.service";
import { media } from "../../domain/database/schema";

// entity repository — DatabaseService는 이 계층에서만 쓴다
// (docs/02-development-rules.md "Module and Repository Rules").

export type MediaRow = typeof media.$inferSelect;

export type MediaSource = {
  mediaType: string;
  url: string;
  storageKey: string | null;
};

@Injectable()
export class MediaRepository {
  constructor(private readonly database: DatabaseService) {}

  async create(data: typeof media.$inferInsert): Promise<MediaRow> {
    const [row] = await this.database.client
      .insert(media)
      .values(data)
      .returning();
    return row;
  }

  async exists(mediaId: string): Promise<boolean> {
    const [row] = await this.database.client
      .select({ id: media.id })
      .from(media)
      .where(eq(media.id, mediaId))
      .limit(1);
    return row !== null;
  }

  async markUploaded(mediaId: string, uploadedAt: Date): Promise<MediaRow> {
    const [row] = await this.database.client
      .update(media)
      .set({ uploadedAt })
      .where(eq(media.id, mediaId))
      .returning();
    return row;
  }

  findSource(mediaId: string): Promise<MediaSource | null> {
    return this.database.client
      .select({
        mediaType: media.mediaType,
        url: media.url,
        storageKey: media.storageKey,
      })
      .from(media)
      .where(eq(media.id, mediaId))
      .limit(1)
      .then(([row]) => row ?? null);
  }
}
