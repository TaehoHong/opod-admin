import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { assertUploadedMedia } from "../admin/media/media.service";
import { PrismaService } from "../domain/database/prisma.service";
import { ReferenceCaptioner } from "../worker/reference-captioner";

const PROMPT_MAX_LENGTH = 4000;
const REFERENCE_MAX_COUNT = 5;
const TEST_SCENE_MAX_LENGTH = 1000;

type VisualProfileReference = {
  mediaId: string;
  url: string;
  sortOrder: number;
  // 비전 LLM 캡션 — 기획 LLM의 샷별 레퍼런스 선별에 쓰인다. 빈 값 = 캡셔닝 전.
  description: string;
};

type CaptionReferencesResult = {
  captioned: number;
  failed: { mediaId: string; error: string }[];
  // 이번 호출 이후에도 캡션이 비어 있는 레퍼런스 수.
  pending: number;
};

type VisualProfile = {
  characterId: string;
  appearancePrompt: string;
  stylePrompt: string;
  negativePrompt: string;
  providerConfig?: unknown;
  referenceMedia: VisualProfileReference[];
  updatedAt?: string;
};

type PrismaVisualProfile = {
  id: string;
  characterId: string;
  appearancePrompt: string;
  stylePrompt: string;
  negativePrompt: string;
  providerConfig: unknown;
  updatedAt: Date;
  referenceMedia: {
    mediaId: string;
    sortOrder: number;
    description: string;
    media: { url: string };
  }[];
};

const profileInclude = {
  referenceMedia: {
    orderBy: { sortOrder: "asc" },
    include: { media: { select: { url: true } } },
  },
} as const;

// 캐릭터 비주얼 프로필: 외모/화풍/네거티브 프롬프트 + 레퍼런스 이미지.
// 워커가 생성 요청을 만들 때 이 프로필을 주입한다 (docs/media-generation-pipeline.md D4).
@Injectable()
export class VisualProfileService {
  constructor(
    private readonly prisma: PrismaService,
    // 레퍼런스 캡셔닝용 비전 LLM — 기획 LLM(planner.*) 설정을 재사용하며
    // 호출 시마다 재해석한다. null이면 LLM 미설정.
    private readonly resolveCaptioner: () => Promise<ReferenceCaptioner | null> = async () =>
      null,
  ) {}

  // 캡션이 비어 있는 레퍼런스를 순차 캡셔닝한다 (수동 버튼 전용 — 자동 아님).
  // 개별 실패는 건너뛰고 수집한다: 부분 성공도 저장된다.
  async captionReferences(
    characterId: string,
  ): Promise<CaptionReferencesResult> {
    await this.assertCharacter(characterId);
    const captioner = await this.resolveCaptioner();
    if (!captioner) {
      throw new BadRequestException(
        "Planner LLM settings are required for reference captioning",
      );
    }
    const references =
      await this.prisma.characterVisualProfileReference.findMany({
        where: {
          profile: { characterId },
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

    let captioned = 0;
    const failed: { mediaId: string; error: string }[] = [];
    for (const reference of references) {
      try {
        const description = await captioner.caption(reference.media);
        await this.prisma.characterVisualProfileReference.update({
          where: {
            profileId_mediaId: {
              profileId: reference.profileId,
              mediaId: reference.mediaId,
            },
          },
          data: { description },
        });
        captioned += 1;
      } catch (error) {
        failed.push({
          mediaId: reference.mediaId,
          error: (error instanceof Error ? error.message : String(error)).slice(
            0,
            200,
          ),
        });
      }
    }
    if (captioned > 0) {
      await this.recordActionLog(
        characterId,
        "VISUAL_PROFILE_REFERENCES_CAPTIONED",
        `reference captions generated via ${captioner.name} (${captioned} image(s))`,
      );
    }
    return { captioned, failed, pending: failed.length };
  }

  async getProfile(characterId: string): Promise<VisualProfile> {
    await this.assertCharacter(characterId);
    const profile = await this.prisma.characterVisualProfile.findUnique({
      where: { characterId },
      include: profileInclude,
    });
    if (!profile) {
      return {
        characterId,
        appearancePrompt: "",
        stylePrompt: "",
        negativePrompt: "",
        referenceMedia: [],
      };
    }
    return this.toVisualProfile(profile as PrismaVisualProfile);
  }

  async upsertProfile(input: {
    characterId: string;
    appearancePrompt?: string;
    stylePrompt?: string;
    negativePrompt?: string;
    providerConfig?: Prisma.InputJsonValue;
  }): Promise<VisualProfile> {
    await this.assertCharacter(input.characterId);
    const data = {
      appearancePrompt: this.parsePrompt(
        input.appearancePrompt,
        "Appearance prompt",
      ),
      stylePrompt: this.parsePrompt(input.stylePrompt, "Style prompt"),
      negativePrompt: this.parsePrompt(input.negativePrompt, "Negative prompt"),
      ...(input.providerConfig !== undefined
        ? { providerConfig: input.providerConfig }
        : {}),
    };
    const profile = await this.prisma.characterVisualProfile.upsert({
      where: { characterId: input.characterId },
      create: { characterId: input.characterId, ...data },
      update: data,
      include: profileInclude,
    });
    await this.recordActionLog(
      input.characterId,
      "VISUAL_PROFILE_UPDATED",
      "visual profile prompts updated",
    );
    return this.toVisualProfile(profile as PrismaVisualProfile);
  }

  // 레퍼런스 세트를 통째로 교체한다. 순서 = 배열 순서.
  async setReferences(input: {
    characterId: string;
    mediaIds: string[];
  }): Promise<VisualProfile> {
    await this.assertCharacter(input.characterId);
    if (!Array.isArray(input.mediaIds)) {
      throw new BadRequestException("Reference mediaIds are required");
    }
    const mediaIds = [...new Set(input.mediaIds)];
    if (mediaIds.length > REFERENCE_MAX_COUNT) {
      throw new BadRequestException(
        `Reference media must be ${REFERENCE_MAX_COUNT} or fewer`,
      );
    }
    for (const mediaId of mediaIds) {
      await assertUploadedMedia(this.prisma, mediaId, "image");
    }

    const profile = await this.prisma.$transaction(async (tx) => {
      const upserted = await tx.characterVisualProfile.upsert({
        where: { characterId: input.characterId },
        create: { characterId: input.characterId },
        update: {},
        select: { id: true },
      });
      await tx.characterVisualProfileReference.deleteMany({
        where: { profileId: upserted.id },
      });
      if (mediaIds.length > 0) {
        await tx.characterVisualProfileReference.createMany({
          data: mediaIds.map((mediaId, index) => ({
            profileId: upserted.id,
            mediaId,
            sortOrder: (index + 1) * 10,
          })),
        });
      }
      return tx.characterVisualProfile.findUnique({
        where: { id: upserted.id },
        include: profileInclude,
      });
    });
    await this.recordActionLog(
      input.characterId,
      "VISUAL_PROFILE_REFERENCES_SET",
      `visual profile references set (${mediaIds.length})`,
    );
    return this.toVisualProfile(profile as PrismaVisualProfile);
  }

  // 프로필 프롬프트 + 장면 설명을 컴파일해 생성 잡을 큐에 넣는다.
  // 콜드스타트(첫 레퍼런스 확보)와 프로필 튜닝 검증 루프에 쓰인다.
  async enqueueTestGeneration(input: {
    characterId: string;
    scene?: string;
  }): Promise<{ jobId: string; prompt: string; status: string }> {
    await this.assertCharacter(input.characterId);
    const scene = input.scene?.trim() ?? "";
    if (scene.length > TEST_SCENE_MAX_LENGTH) {
      throw new BadRequestException(
        `Test scene must be at most ${TEST_SCENE_MAX_LENGTH} characters`,
      );
    }
    const profile = await this.getProfile(input.characterId);
    const prompt = [profile.appearancePrompt, scene, profile.stylePrompt]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(", ");
    if (!prompt) {
      throw new BadRequestException(
        "Visual profile prompts or a test scene are required",
      );
    }

    const job = await this.prisma.generationJob.create({
      data: {
        characterId: input.characterId,
        mediaType: "image",
        prompt,
      },
      select: { id: true, status: true },
    });
    await this.recordActionLog(
      input.characterId,
      "GENERATION_JOB_ENQUEUED",
      "visual profile test generation queued",
      job.id,
    );
    return { jobId: job.id, prompt, status: job.status };
  }

  private parsePrompt(value: string | undefined, label: string): string {
    const text = value?.trim() ?? "";
    if (text.length > PROMPT_MAX_LENGTH) {
      throw new BadRequestException(
        `${label} must be at most ${PROMPT_MAX_LENGTH} characters`,
      );
    }
    return text;
  }

  private async assertCharacter(characterId: string): Promise<void> {
    const character = await this.prisma.character.findUnique({
      where: { id: characterId },
      select: { id: true },
    });
    if (!character) {
      throw new BadRequestException("Character not found");
    }
  }

  private async recordActionLog(
    characterId: string,
    actionType: string,
    reason: string,
    targetId?: string,
  ): Promise<void> {
    await this.prisma.characterActionLog.create({
      data: {
        characterId,
        actionType,
        targetTable:
          actionType === "GENERATION_JOB_ENQUEUED"
            ? "generation_jobs"
            : "character_visual_profiles",
        targetId: targetId ?? characterId,
        reason,
      },
    });
  }

  private toVisualProfile(profile: PrismaVisualProfile): VisualProfile {
    return {
      characterId: profile.characterId,
      appearancePrompt: profile.appearancePrompt,
      stylePrompt: profile.stylePrompt,
      negativePrompt: profile.negativePrompt,
      ...(profile.providerConfig != null
        ? { providerConfig: profile.providerConfig }
        : {}),
      referenceMedia: profile.referenceMedia.map((reference) => ({
        mediaId: reference.mediaId,
        url: reference.media.url,
        sortOrder: reference.sortOrder,
        description: reference.description,
      })),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }
}
