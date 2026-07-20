import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  decodeCursor,
  Page,
  PageInput,
  pageFromRows,
} from "../../domain/database/page";
import { PrismaService } from "../../domain/database/prisma.service";
import { parseFinishPreset } from "../../worker/film-finish";

type DraftStatus =
  | "planned"
  | "generating"
  | "needs_review"
  | "regenerating"
  | "approved"
  | "rejected"
  | "published"
  | "failed";

const DRAFT_STATUSES: DraftStatus[] = [
  "planned",
  "generating",
  "needs_review",
  "regenerating",
  "approved",
  "rejected",
  "published",
  "failed",
];

// 검수에서 캡션/일정을 고칠 수 있는 상태. planned/generating은 플래너가 덮어쓴다.
const EDITABLE_STATUSES: DraftStatus[] = ["needs_review", "approved"];

const CAPTION_MAX_LENGTH = 2000;
const HASHTAG_MAX = 5;

type DraftShotOutput = {
  mediaId: string;
  url: string;
  candidateIndex: number;
  selected: boolean;
};

type DraftShot = {
  sortOrder: number;
  jobId: string;
  status: string;
  prompt: string;
  // 기획이 만든 장면 원문 (paramsJson._shot.scene) — 프롬프트 추적용.
  scene?: string;
  // 기획 LLM이 이 샷에 고른 레퍼런스 (URL은 표시용으로 해석).
  references?: { mediaId: string; url: string }[];
  candidateCount?: number;
  provider?: string;
  costUsd?: string;
  errorMessage?: string;
  outputs: DraftShotOutput[];
};

type AdminDraft = {
  id: string;
  characterId: string;
  draftType: string;
  contentType: string;
  caption: string;
  hashtags: string[];
  status: DraftStatus;
  attemptCount: number;
  errorMessage?: string;
  scheduledAt?: string;
  publishedPostId?: string;
  conceptJson?: unknown;
  shots?: DraftShot[];
  createdAt: string;
  updatedAt: string;
};

type PrismaDraftRow = Prisma.PostDraftGetPayload<Prisma.PostDraftDefaultArgs>;

const draftJobFields = {
  id: true,
  sortOrder: true,
  status: true,
  prompt: true,
  paramsJson: true,
  candidateCount: true,
  provider: true,
  costUsd: true,
  errorMessage: true,
  createdAt: true,
  outputs: {
    orderBy: { candidateIndex: "asc" as const },
    select: {
      mediaId: true,
      candidateIndex: true,
      selected: true,
      media: { select: { url: true } },
    },
  },
} as const;

type PrismaDraftJob = Prisma.GenerationJobGetPayload<{
  select: typeof draftJobFields;
}>;

// paramsJson._shot — 기획이 남긴 샷 메타데이터(장면 원문, 선별 레퍼런스).
function shotMeta(paramsJson: unknown): {
  scene?: string;
  referenceMediaIds: string[];
} {
  if (typeof paramsJson !== "object" || paramsJson === null) {
    return { referenceMediaIds: [] };
  }
  const shot = (paramsJson as Record<string, unknown>)._shot;
  if (typeof shot !== "object" || shot === null) {
    return { referenceMediaIds: [] };
  }
  const record = shot as Record<string, unknown>;
  const scene =
    typeof record.scene === "string" && record.scene ? record.scene : undefined;
  const ids = Array.isArray(record.referenceMediaIds)
    ? record.referenceMediaIds.filter(
        (id): id is string => typeof id === "string",
      )
    : [];
  return { ...(scene ? { scene } : {}), referenceMediaIds: ids };
}

@Injectable()
export class DraftsService {
  constructor(private readonly prisma: PrismaService) {}

  async listDrafts(
    input: { status?: string; characterId?: string } & PageInput,
  ): Promise<Page<AdminDraft>> {
    const status = this.parseOptionalStatus(input.status);
    const characterId = input.characterId?.trim();
    const where = {
      ...(status ? { status } : {}),
      ...(characterId ? { characterId } : {}),
    };
    const cursorId = decodeCursor(input.cursor);
    if (
      cursorId &&
      !(await this.prisma.postDraft.findFirst({
        where: { id: cursorId, ...where },
        select: { id: true },
      }))
    ) {
      throw new BadRequestException("Invalid cursor");
    }

    const drafts = await this.prisma.postDraft.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });
    return pageFromRows(
      drafts.map((draft) => this.toDraft(draft as PrismaDraftRow)),
      input.limit,
    );
  }

  async getDraft(draftId: string): Promise<AdminDraft> {
    const draft = await this.prisma.postDraft.findUnique({
      where: { id: draftId },
    });
    if (!draft) {
      throw new BadRequestException("Draft not found");
    }
    const jobs = await this.prisma.generationJob.findMany({
      where: { draftId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: draftJobFields,
    });

    // 컷별 최신 잡만 노출한다 (재생성 이력은 최신이 대체).
    const latestPerShot = new Map<number, PrismaDraftJob>();
    for (const job of jobs) {
      if (!latestPerShot.has(job.sortOrder)) {
        latestPerShot.set(job.sortOrder, job);
      }
    }
    // 샷별 선별 레퍼런스의 표시용 URL을 한 번에 해석한다.
    const latestJobs = [...latestPerShot.values()];
    const referenceIds = [
      ...new Set(
        latestJobs.flatMap((job) => shotMeta(job.paramsJson).referenceMediaIds),
      ),
    ];
    const referenceUrls = new Map(
      referenceIds.length > 0
        ? (
            await this.prisma.media.findMany({
              where: { id: { in: referenceIds } },
              select: { id: true, url: true },
            })
          ).map((media) => [media.id, media.url] as const)
        : [],
    );

    const shots = [...latestPerShot.entries()]
      .sort(([a], [b]) => a - b)
      .map(([sortOrder, job]) => {
        const meta = shotMeta(job.paramsJson);
        const references = meta.referenceMediaIds
          .filter((mediaId) => referenceUrls.has(mediaId))
          .map((mediaId) => ({
            mediaId,
            url: referenceUrls.get(mediaId) as string,
          }));
        return {
          sortOrder,
          jobId: job.id,
          status: job.status,
          prompt: job.prompt,
          ...(meta.scene ? { scene: meta.scene } : {}),
          ...(references.length > 0 ? { references } : {}),
          ...(job.candidateCount != null
            ? { candidateCount: job.candidateCount }
            : {}),
          ...(job.provider ? { provider: job.provider } : {}),
          ...(job.costUsd != null ? { costUsd: job.costUsd.toString() } : {}),
          ...(job.errorMessage ? { errorMessage: job.errorMessage } : {}),
          outputs: job.outputs.map((output) => ({
            mediaId: output.mediaId,
            url: output.media.url,
            candidateIndex: output.candidateIndex,
            selected: output.selected,
          })),
        };
      });

    return { ...this.toDraft(draft as PrismaDraftRow), shots };
  }

  // 운영자 초안 생성. mode='manual'이면 어떤 단계도 자동으로 넘어가지 않는다 —
  // 기획은 POST :id/plan, 컷 생성은 :id/jobs/:jobId/generate, 게시는 :id/publish
  // 버튼으로만 진행된다. mode='auto'(기본)는 기존처럼 워커가 끝까지 진행한다.
  async createDraft(input: {
    characterId: string;
    sceneHint?: string;
    scheduledAt?: string;
    contentType?: string;
    mode?: string;
  }): Promise<AdminDraft> {
    const character = await this.prisma.character.findUnique({
      where: { id: input.characterId },
      select: { id: true },
    });
    if (!character) {
      throw new BadRequestException("Character not found");
    }
    const contentType = input.contentType?.trim() || "feed";
    if (contentType !== "feed" && contentType !== "reel") {
      throw new BadRequestException("Draft content type must be feed or reel");
    }
    const mode = input.mode?.trim() || "auto";
    if (mode !== "manual" && mode !== "auto") {
      throw new BadRequestException("Draft mode must be manual or auto");
    }
    const scheduledAt = this.parseOptionalDate(input.scheduledAt);
    const sceneHint = input.sceneHint?.trim();

    const draft = await this.prisma.postDraft.create({
      data: {
        characterId: input.characterId,
        contentType: contentType as never,
        conceptJson: {
          source: "manual",
          mode,
          ...(sceneHint ? { sceneHint } : {}),
        },
        ...(scheduledAt ? { scheduledAt } : {}),
      },
    });
    await this.recordActionLog(
      input.characterId,
      draft.id,
      "DRAFT_CREATED",
      `manual draft created (mode: ${mode}${sceneHint ? `, hint: ${sceneHint.slice(0, 100)}` : ""})`,
    );
    return this.toDraft(draft as PrismaDraftRow);
  }

  async updateDraft(input: {
    draftId: string;
    caption?: string;
    hashtags?: string[];
    scheduledAt?: string | null;
    finish?: string | null;
  }): Promise<AdminDraft> {
    const data: Record<string, unknown> = {};
    if (input.caption !== undefined) {
      const caption = input.caption.trim();
      if (!caption) {
        throw new BadRequestException("Draft caption is required");
      }
      if (caption.length > CAPTION_MAX_LENGTH) {
        throw new BadRequestException(
          `Draft caption must be at most ${CAPTION_MAX_LENGTH} characters`,
        );
      }
      data.caption = caption;
    }
    if (input.hashtags !== undefined) {
      data.hashtags = this.cleanHashtags(input.hashtags);
    }
    if (input.scheduledAt !== undefined) {
      data.scheduledAt =
        input.scheduledAt === null
          ? null
          : this.parseOptionalDate(input.scheduledAt);
    }
    if (input.finish !== undefined) {
      // 게시 마감 프리셋 — conceptJson 메타에 저장한다 (게시글 단위 선택).
      // null/"none"은 프리셋 해제(원본 게시). 다른 키는 보존한다.
      const clear = input.finish === null || input.finish === "none";
      const preset = clear ? null : parseFinishPreset(input.finish);
      if (!clear && !preset) {
        throw new BadRequestException("Unknown finish preset");
      }
      const existing = await this.prisma.postDraft.findUnique({
        where: { id: input.draftId },
        select: { conceptJson: true },
      });
      if (!existing) {
        throw new BadRequestException("Draft not found");
      }
      const concept =
        existing.conceptJson &&
        typeof existing.conceptJson === "object" &&
        !Array.isArray(existing.conceptJson)
          ? { ...(existing.conceptJson as Record<string, unknown>) }
          : {};
      if (preset) {
        concept.finish = preset;
      } else {
        delete concept.finish;
      }
      data.conceptJson = concept;
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException("Nothing to update");
    }

    const transitioned = await this.prisma.postDraft.updateMany({
      where: { id: input.draftId, status: { in: EDITABLE_STATUSES } },
      data: data as never,
    });
    if (transitioned.count === 0) {
      await this.assertDraftExists(input.draftId);
      throw new BadRequestException(
        "Only needs_review or approved drafts can be edited",
      );
    }
    return this.getDraft(input.draftId);
  }

  async approveDraft(draftId: string): Promise<AdminDraft> {
    const transitioned = await this.prisma.postDraft.updateMany({
      where: { id: draftId, status: "needs_review" },
      data: { status: "approved", errorMessage: null },
    });
    if (transitioned.count === 0) {
      await this.assertDraftExists(draftId);
      throw new BadRequestException("Only needs_review drafts can be approved");
    }
    const draft = await this.getDraft(draftId);
    await this.recordActionLog(
      draft.characterId,
      draftId,
      "DRAFT_APPROVED",
      draft.scheduledAt
        ? `draft approved; publish at ${draft.scheduledAt}`
        : "draft approved; publish immediately",
    );
    return draft;
  }

  async rejectDraft(input: {
    draftId: string;
    reason?: string;
  }): Promise<AdminDraft> {
    const transitioned = await this.prisma.postDraft.updateMany({
      where: { id: input.draftId, status: "needs_review" },
      data: { status: "rejected" },
    });
    if (transitioned.count === 0) {
      await this.assertDraftExists(input.draftId);
      throw new BadRequestException("Only needs_review drafts can be rejected");
    }
    const draft = await this.getDraft(input.draftId);
    await this.recordActionLog(
      draft.characterId,
      input.draftId,
      "DRAFT_REJECTED",
      input.reason?.trim() || "draft rejected",
    );
    return draft;
  }

  // 수동 진행 컷 실행 준비 — draft 상태 컷의 프롬프트/후보 수를 반영하고
  // queued로 전환한다. 실제 실행(runJobNow)은 컨트롤러가 이어서 호출한다.
  async queueShot(input: {
    draftId: string;
    jobId: string;
    prompt?: string;
    candidateCount?: number;
  }): Promise<void> {
    const prompt = input.prompt?.trim();
    if (input.prompt !== undefined && !prompt) {
      throw new BadRequestException("Shot prompt cannot be empty");
    }
    // 프롬프트 빌드 전(빈 프롬프트) 컷은 생성 실행을 막는다 — 운영자가
    // 직접 프롬프트를 넘긴 경우는 예외.
    if (!prompt) {
      const existing = await this.prisma.generationJob.findFirst({
        where: { id: input.jobId, draftId: input.draftId, status: "draft" },
        select: { prompt: true },
      });
      if (existing && !existing.prompt.trim()) {
        throw new BadRequestException(
          "Shot prompt is empty — run prompt build first or provide a prompt",
        );
      }
    }
    const transitioned = await this.prisma.generationJob.updateMany({
      where: { id: input.jobId, draftId: input.draftId, status: "draft" },
      data: {
        status: "queued",
        ...(prompt ? { prompt } : {}),
        ...(input.candidateCount != null
          ? { candidateCount: input.candidateCount }
          : {}),
      },
    });
    if (transitioned.count === 0) {
      await this.assertDraftExists(input.draftId);
      throw new BadRequestException(
        "Only draft-state shots of this draft can start generation",
      );
    }
    const job = await this.prisma.generationJob.findUnique({
      where: { id: input.jobId },
      select: { characterId: true, sortOrder: true },
    });
    if (job) {
      await this.recordActionLog(
        job.characterId,
        input.draftId,
        "DRAFT_SHOT_GENERATION_STARTED",
        `shot ${job.sortOrder} generation started manually`,
      );
    }
  }

  // 컷 재생성: 같은 (draftId, sortOrder)로 새 잡을 만들고 draft를 regenerating으로.
  async regenerateShot(input: {
    draftId: string;
    jobId: string;
    prompt?: string;
  }): Promise<AdminDraft> {
    const job = await this.prisma.generationJob.findFirst({
      where: { id: input.jobId, draftId: input.draftId },
      select: {
        id: true,
        characterId: true,
        sortOrder: true,
        prompt: true,
        provider: true,
      },
    });
    if (!job) {
      throw new BadRequestException("Draft shot job not found");
    }
    const prompt = input.prompt?.trim() || job.prompt;

    const transitioned = await this.prisma.postDraft.updateMany({
      where: { id: input.draftId, status: { in: ["needs_review", "failed"] } },
      data: { status: "regenerating", errorMessage: null },
    });
    if (transitioned.count === 0) {
      await this.assertDraftExists(input.draftId);
      throw new BadRequestException(
        "Only needs_review or failed drafts can regenerate shots",
      );
    }
    await this.prisma.generationJob.create({
      data: {
        characterId: job.characterId,
        mediaType: "image",
        prompt,
        draftId: input.draftId,
        sortOrder: job.sortOrder,
        originJobId: job.id,
        ...(job.provider ? { provider: job.provider } : {}),
      },
    });
    await this.recordActionLog(
      job.characterId,
      input.draftId,
      "DRAFT_SHOT_REGENERATED",
      `shot ${job.sortOrder} regeneration queued`,
    );
    return this.getDraft(input.draftId);
  }

  // best-of-N 후보 선택 교체.
  async selectShotOutput(input: {
    draftId: string;
    jobId: string;
    mediaId: string;
  }): Promise<AdminDraft> {
    const job = await this.prisma.generationJob.findFirst({
      where: { id: input.jobId, draftId: input.draftId, status: "completed" },
      select: {
        id: true,
        outputs: { select: { mediaId: true } },
      },
    });
    if (!job) {
      throw new BadRequestException("Completed draft shot job not found");
    }
    if (!job.outputs.some((output) => output.mediaId === input.mediaId)) {
      throw new BadRequestException(
        "Media is not a candidate output of this job",
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.generationJobOutput.updateMany({
        where: { jobId: input.jobId },
        data: { selected: false },
      });
      await tx.generationJobOutput.updateMany({
        where: { jobId: input.jobId, mediaId: input.mediaId },
        data: { selected: true },
      });
      await tx.generationJob.update({
        where: { id: input.jobId },
        data: { outputMediaId: input.mediaId },
      });
    });
    return this.getDraft(input.draftId);
  }

  private async assertDraftExists(draftId: string): Promise<void> {
    const draft = await this.prisma.postDraft.findUnique({
      where: { id: draftId },
      select: { id: true },
    });
    if (!draft) {
      throw new BadRequestException("Draft not found");
    }
  }

  private parseOptionalStatus(status?: string): DraftStatus | undefined {
    const value = status?.trim();
    if (!value) {
      return undefined;
    }
    if ((DRAFT_STATUSES as string[]).includes(value)) {
      return value as DraftStatus;
    }
    throw new BadRequestException(
      `Draft status must be one of ${DRAFT_STATUSES.join(", ")}`,
    );
  }

  private parseOptionalDate(value?: string): Date | undefined {
    const text = value?.trim();
    if (!text) {
      return undefined;
    }
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException("Invalid scheduledAt datetime");
    }
    return date;
  }

  private cleanHashtags(values: string[]): string[] {
    if (!Array.isArray(values)) {
      throw new BadRequestException("hashtags must be an array");
    }
    const cleaned: string[] = [];
    for (const value of values) {
      if (typeof value !== "string") {
        continue;
      }
      const tag = value.trim().replace(/^#+/, "").trim();
      if (tag && !cleaned.includes(tag)) {
        cleaned.push(tag);
      }
      if (cleaned.length >= HASHTAG_MAX) {
        break;
      }
    }
    return cleaned;
  }

  private async recordActionLog(
    characterId: string,
    draftId: string,
    actionType: string,
    reason: string,
  ): Promise<void> {
    await this.prisma.characterActionLog.create({
      data: {
        characterId,
        actionType,
        targetTable: "post_drafts",
        targetId: draftId,
        reason,
      },
    });
  }

  private toDraft(draft: PrismaDraftRow): AdminDraft {
    return {
      id: draft.id,
      characterId: draft.characterId,
      draftType: draft.draftType,
      contentType: draft.contentType,
      caption: draft.caption,
      hashtags: draft.hashtags,
      status: draft.status,
      attemptCount: draft.attemptCount,
      ...(draft.errorMessage ? { errorMessage: draft.errorMessage } : {}),
      ...(draft.scheduledAt
        ? { scheduledAt: draft.scheduledAt.toISOString() }
        : {}),
      ...(draft.publishedPostId
        ? { publishedPostId: draft.publishedPostId }
        : {}),
      ...(draft.conceptJson != null ? { conceptJson: draft.conceptJson } : {}),
      createdAt: draft.createdAt.toISOString(),
      updatedAt: draft.updatedAt.toISOString(),
    };
  }
}
