import { BadRequestException, Injectable } from "@nestjs/common";
import {
  decodeCursor,
  Page,
  PageInput,
  pageFromRows,
} from "../../domain/database/page";
import { PrismaService } from "../../domain/database/prisma.service";

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

type PrismaDraftRow = {
  id: string;
  characterId: string;
  draftType: string;
  contentType: string;
  caption: string;
  hashtags: string[];
  status: DraftStatus;
  attemptCount: number;
  errorMessage: string | null;
  scheduledAt: Date | null;
  publishedPostId: string | null;
  conceptJson: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type PrismaDraftJob = {
  id: string;
  sortOrder: number;
  status: string;
  prompt: string;
  errorMessage: string | null;
  createdAt: Date;
  outputs: {
    mediaId: string;
    candidateIndex: number;
    selected: boolean;
    media: { url: string };
  }[];
};

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
    const jobs = (await this.prisma.generationJob.findMany({
      where: { draftId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        sortOrder: true,
        status: true,
        prompt: true,
        errorMessage: true,
        createdAt: true,
        outputs: {
          orderBy: { candidateIndex: "asc" },
          select: {
            mediaId: true,
            candidateIndex: true,
            selected: true,
            media: { select: { url: true } },
          },
        },
      },
    })) as PrismaDraftJob[];

    // 컷별 최신 잡만 노출한다 (재생성 이력은 최신이 대체).
    const latestPerShot = new Map<number, PrismaDraftJob>();
    for (const job of jobs) {
      if (!latestPerShot.has(job.sortOrder)) {
        latestPerShot.set(job.sortOrder, job);
      }
    }
    const shots = [...latestPerShot.entries()]
      .sort(([a], [b]) => a - b)
      .map(([sortOrder, job]) => ({
        sortOrder,
        jobId: job.id,
        status: job.status,
        prompt: job.prompt,
        ...(job.errorMessage ? { errorMessage: job.errorMessage } : {}),
        outputs: job.outputs.map((output) => ({
          mediaId: output.mediaId,
          url: output.media.url,
          candidateIndex: output.candidateIndex,
          selected: output.selected,
        })),
      }));

    return { ...this.toDraft(draft as PrismaDraftRow), shots };
  }

  // 수동 기획 트리거 — planned draft를 만들면 워커가 집어간다.
  async createDraft(input: {
    characterId: string;
    sceneHint?: string;
    scheduledAt?: string;
    contentType?: string;
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
    const scheduledAt = this.parseOptionalDate(input.scheduledAt);
    const sceneHint = input.sceneHint?.trim();

    const draft = await this.prisma.postDraft.create({
      data: {
        characterId: input.characterId,
        contentType: contentType as never,
        conceptJson: {
          source: "manual",
          ...(sceneHint ? { sceneHint } : {}),
        },
        ...(scheduledAt ? { scheduledAt } : {}),
      },
    });
    await this.recordActionLog(
      input.characterId,
      draft.id,
      "DRAFT_CREATED",
      sceneHint
        ? `manual draft created (hint: ${sceneHint.slice(0, 100)})`
        : "manual draft created",
    );
    return this.toDraft(draft as PrismaDraftRow);
  }

  async updateDraft(input: {
    draftId: string;
    caption?: string;
    hashtags?: string[];
    scheduledAt?: string | null;
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
