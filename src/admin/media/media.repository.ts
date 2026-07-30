import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../domain/database/prisma.service";

// entity repository — PrismaService는 이 계층에서만 쓴다
// (docs/02-development-rules.md "Module and Repository Rules").

export type MediaRow = Prisma.MediaGetPayload<object>;

export type MediaSource = {
  mediaType: string;
  url: string;
  storageKey: string | null;
};

@Injectable()
export class MediaRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.MediaUncheckedCreateInput): Promise<MediaRow> {
    return this.prisma.media.create({ data });
  }

  async exists(mediaId: string): Promise<boolean> {
    const row = await this.prisma.media.findUnique({
      where: { id: mediaId },
      select: { id: true },
    });
    return row !== null;
  }

  markUploaded(mediaId: string, uploadedAt: Date): Promise<MediaRow> {
    return this.prisma.media.update({
      where: { id: mediaId },
      data: { uploadedAt },
    });
  }

  findSource(mediaId: string): Promise<MediaSource | null> {
    return this.prisma.media.findUnique({
      where: { id: mediaId },
      select: { mediaType: true, url: true, storageKey: true },
    });
  }
}
