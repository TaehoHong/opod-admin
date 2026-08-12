import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  assertableMediaFields,
  type AssertableMedia,
} from "../admin/media/media.service";
import { PrismaService } from "../domain/database/prisma.service";

// entity repository — PrismaService는 이 계층에서만 쓴다
// (docs/02-development-rules.md "Module and Repository Rules").

const profileInclude = {
  referenceMedia: {
    orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }],
    include: { media: { select: { url: true } } },
  },
} satisfies Prisma.CharacterVisualProfileInclude;

export type VisualProfileRow = Prisma.CharacterVisualProfileGetPayload<{
  include: typeof profileInclude;
}>;

export type UncaptionedReference = {
  profileId: string;
  mediaId: string;
  media: { url: string; storageKey: string | null; contentType: string | null };
};

export type VisualProfilePrompts = {
  appearancePrompt: string;
  stylePrompt: string;
  negativePrompt: string;
  providerConfig?: Prisma.InputJsonValue;
};

@Injectable()
export class VisualProfileRepository {
  constructor(private readonly prisma: PrismaService) {}

  characterExists(characterId: string): Promise<boolean> {
    return this.prisma.character
      .findUnique({ where: { id: characterId }, select: { id: true } })
      .then((row) => row !== null);
  }

  findUploadedMedia(mediaId: string): Promise<AssertableMedia | null> {
    return this.prisma.media.findUnique({
      where: { id: mediaId },
      select: assertableMediaFields,
    });
  }

  findProfile(characterId: string): Promise<VisualProfileRow | null> {
    return this.prisma.characterVisualProfile.findUnique({
      where: { characterId },
      include: profileInclude,
    });
  }

  upsertProfile(
    characterId: string,
    data: VisualProfilePrompts,
  ): Promise<VisualProfileRow> {
    return this.prisma.characterVisualProfile.upsert({
      where: { characterId },
      create: { characterId, ...data },
      update: data,
      include: profileInclude,
    });
  }

  // 캡션이 비어 있고 업로드가 끝난 레퍼런스만 — 캡셔닝 대상이다.
  findUncaptionedReferences(
    characterId: string,
  ): Promise<UncaptionedReference[]> {
    return this.prisma.characterVisualProfileReference.findMany({
      where: {
        profile: { characterId },
        isActive: true,
        description: "",
        media: { uploadedAt: { not: null } },
      },
      orderBy: { sortOrder: "asc" },
      select: {
        profileId: true,
        mediaId: true,
        media: { select: { url: true, storageKey: true, contentType: true } },
      },
    });
  }

  async setReferenceDescription(
    profileId: string,
    mediaId: string,
    description: string,
  ): Promise<void> {
    await this.prisma.characterVisualProfileReference.update({
      where: { profileId_mediaId: { profileId, mediaId } },
      data: { description },
    });
  }

  // 활성 레퍼런스 세트 동기화는 한 트랜잭션이어야 한다. 선택 해제된 관계는
  // 삭제하지 않고 비활성화해 캡션과 정렬을 보존한다.
  replaceReferences(
    characterId: string,
    mediaIds: string[],
  ): Promise<VisualProfileRow> {
    return this.prisma.$transaction(async (tx) => {
      const upserted = await tx.characterVisualProfile.upsert({
        where: { characterId },
        create: { characterId },
        update: {},
        select: { id: true },
      });
      await tx.characterVisualProfileReference.updateMany({
        where: {
          profileId: upserted.id,
          isActive: true,
          ...(mediaIds.length > 0 ? { mediaId: { notIn: mediaIds } } : {}),
        },
        data: { isActive: false },
      });
      for (const [index, mediaId] of mediaIds.entries()) {
        const sortOrder = (index + 1) * 10;
        await tx.characterVisualProfileReference.upsert({
          where: { profileId_mediaId: { profileId: upserted.id, mediaId } },
          create: {
            profileId: upserted.id,
            mediaId,
            sortOrder,
            isActive: true,
          },
          update: { sortOrder, isActive: true },
        });
      }
      // 방금 upsert한 행이라 반드시 있다 — 없으면 트랜잭션이 깨진 것이므로
      // null을 흘려보내지 않고 여기서 실패시킨다.
      return tx.characterVisualProfile.findUniqueOrThrow({
        where: { id: upserted.id },
        include: profileInclude,
      });
    });
  }

  async createTestGenerationJob(input: {
    characterId: string;
    prompt: string;
  }): Promise<{ id: string; status: string }> {
    return this.prisma.generationJob.create({
      data: {
        characterId: input.characterId,
        mediaType: "image",
        prompt: input.prompt,
      },
      select: { id: true, status: true },
    });
  }

  async recordActionLog(input: {
    characterId: string;
    actionType: string;
    targetTable: string;
    targetId: string;
    reason: string;
  }): Promise<void> {
    await this.prisma.characterActionLog.create({ data: input });
  }
}
