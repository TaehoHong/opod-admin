import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  PostWorkspaceRepository,
  PostWorkDraft,
  StandalonePost,
} from "./post-workspace.repository";

export const POST_WORK_FILTERS = [
  "all",
  "needs_action",
  "agent",
  "publish_waiting",
  "published",
  "failed",
] as const;

export type PostWorkFilter = (typeof POST_WORK_FILTERS)[number];
export type PostWorkStage =
  | "brief"
  | "plan"
  | "prompt"
  | "evaluation"
  | "generation"
  | "review"
  | "publish"
  | "memory";
export type OperationalStatus =
  "failed" | "needs_action" | "publish_waiting" | "agent_running" | "completed";

export type PostWorkItem = {
  id: string;
  kind: "draft" | "post";
  draftId?: string;
  postId?: string;
  characterId: string;
  contentType: string;
  caption: string;
  thumbnailUrl?: string;
  currentStage: PostWorkStage;
  stageIndex: number;
  operationalStatus: OperationalStatus;
  statusDetail: string;
  executionMode: "manual" | "auto";
  source: "manual" | "scheduler" | "direct" | "unknown";
  scheduledAt?: string;
  createdAt: string;
  updatedAt: string;
};

type WorkCursor = Pick<PostWorkItem, "id" | "kind" | "updatedAt">;

const STAGES: PostWorkStage[] = [
  "brief",
  "plan",
  "prompt",
  "evaluation",
  "generation",
  "review",
  "publish",
  "memory",
];

@Injectable()
export class PostWorkspaceService {
  constructor(private readonly repository: PostWorkspaceRepository) {}

  async list(input: {
    filter?: string;
    cursor?: string;
    limit: number;
  }): Promise<{ items: PostWorkItem[]; nextCursor?: string }> {
    const filter = parseFilter(input.filter);
    const cursor = parseCursor(input.cursor);
    const take = Math.min(input.limit * (filter === "all" ? 2 : 4) + 1, 401);
    const before = cursor ? new Date(cursor.updatedAt) : undefined;

    const [drafts, posts] = await Promise.all([
      this.repository.findDrafts({
        where: draftWhere(filter),
        ...(before ? { before } : {}),
        take,
      }),
      filter === "all" || filter === "published"
        ? this.repository.findStandalonePosts({
            onlyStandalone: true,
            ...(before ? { before } : {}),
            take,
          })
        : Promise.resolve([]),
    ]);

    const merged = [
      ...drafts.map(toDraftWorkItem),
      ...posts.map(toStandalonePostWorkItem),
    ]
      .filter((item) => matchesFilter(item, filter))
      .sort(compareWorkItems)
      .filter((item) => !cursor || compareWorkItems(item, cursor) > 0);

    const items = merged.slice(0, input.limit);
    const last = items.at(-1);
    return {
      items,
      ...(merged.length > input.limit && last
        ? { nextCursor: encodeCursor(last) }
        : {}),
    };
  }

  async get(id: string): Promise<PostWorkItem> {
    const draft = await this.repository.findDraft(id);
    if (draft) return toDraftWorkItem(draft);
    const post = await this.repository.findStandalonePost(id);
    if (post) return toStandalonePostWorkItem(post);
    throw new NotFoundException("Post work item not found");
  }
}

function parseFilter(value?: string): PostWorkFilter {
  const filter = value?.trim() || "all";
  if (!POST_WORK_FILTERS.includes(filter as PostWorkFilter)) {
    throw new BadRequestException(
      `Post work filter must be one of ${POST_WORK_FILTERS.join(", ")}`,
    );
  }
  return filter as PostWorkFilter;
}

function draftWhere(filter: PostWorkFilter): Prisma.PostDraftWhereInput {
  if (filter === "published") return { status: "published" };
  if (filter === "publish_waiting") return { status: "approved" };
  if (filter === "failed") return { status: "failed" };
  if (filter === "agent") {
    return { status: { in: ["planned", "generating", "regenerating"] } };
  }
  if (filter === "needs_action") {
    return {
      status: {
        in: ["planned", "generating", "needs_review", "regenerating"],
      },
    };
  }
  return {};
}

function matchesFilter(item: PostWorkItem, filter: PostWorkFilter): boolean {
  if (filter === "all") return true;
  if (filter === "needs_action") {
    return item.operationalStatus === "needs_action";
  }
  if (filter === "agent") return item.operationalStatus === "agent_running";
  if (filter === "publish_waiting") {
    return item.operationalStatus === "publish_waiting";
  }
  if (filter === "published") return item.currentStage === "memory";
  return item.operationalStatus === "failed";
}

function toDraftWorkItem(draft: PostWorkDraft): PostWorkItem {
  const concept = record(draft.conceptJson);
  const mode = concept.mode === "manual" ? "manual" : "auto";
  const source = sourceOf(concept.source);
  const latestJobs = latestJobsPerShot(draft);
  const currentStage = stageForDraft(draft, latestJobs);
  const operational = statusForDraft(draft, latestJobs, currentStage, mode);
  const publishedThumbnail =
    draft.publishedPost?.postMedia[0]?.media.url ?? undefined;
  const generatedThumbnail = latestJobs
    .flatMap((job) => job.outputs)
    .sort((left, right) => Number(right.selected) - Number(left.selected))[0]
    ?.media.url;

  return {
    id: draft.id,
    kind: "draft",
    draftId: draft.id,
    ...(draft.publishedPostId ? { postId: draft.publishedPostId } : {}),
    characterId: draft.characterId,
    contentType: draft.contentType,
    caption: draft.caption,
    ...(publishedThumbnail || generatedThumbnail
      ? { thumbnailUrl: publishedThumbnail ?? generatedThumbnail }
      : {}),
    currentStage,
    stageIndex: STAGES.indexOf(currentStage) + 1,
    operationalStatus: operational.status,
    statusDetail: operational.detail,
    executionMode: mode,
    source,
    ...(draft.scheduledAt
      ? { scheduledAt: draft.scheduledAt.toISOString() }
      : {}),
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  };
}

function toStandalonePostWorkItem(post: StandalonePost): PostWorkItem {
  return {
    id: post.id,
    kind: "post",
    postId: post.id,
    characterId: post.characterId,
    contentType: post.contentType,
    caption: post.content,
    ...(post.postMedia[0]?.media.url
      ? { thumbnailUrl: post.postMedia[0].media.url }
      : {}),
    currentStage: "memory",
    stageIndex: 8,
    operationalStatus: "completed",
    statusDetail: "게시 완료",
    executionMode: "manual",
    source: "direct",
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.createdAt.toISOString(),
  };
}

function latestJobsPerShot(draft: PostWorkDraft) {
  const jobs = new Map<number, PostWorkDraft["jobs"][number]>();
  for (const job of draft.jobs) {
    if (!jobs.has(job.sortOrder)) jobs.set(job.sortOrder, job);
  }
  return [...jobs.values()].sort(
    (left, right) => left.sortOrder - right.sortOrder,
  );
}

function stageForDraft(
  draft: PostWorkDraft,
  jobs: PostWorkDraft["jobs"],
): PostWorkStage {
  if (draft.status === "published") return "memory";
  if (draft.status === "approved") return "publish";
  if (draft.status === "needs_review" || draft.status === "rejected") {
    return "review";
  }
  const concept = record(draft.conceptJson);
  if (!record(concept.plan)) return "plan";
  if (jobs.length === 0) return "prompt";
  if (jobs.some((job) => job.status === "queued" || job.status === "running")) {
    return "generation";
  }
  if (
    jobs.some((job) => job.status === "completed" || job.status === "failed")
  ) {
    return jobs.every((job) => job.status === "completed")
      ? "review"
      : "generation";
  }
  return jobs.every((job) => job.prompt.trim().length > 0)
    ? "evaluation"
    : "prompt";
}

function statusForDraft(
  draft: PostWorkDraft,
  jobs: PostWorkDraft["jobs"],
  stage: PostWorkStage,
  mode: "manual" | "auto",
): { status: OperationalStatus; detail: string } {
  if (
    draft.status === "failed" ||
    (jobs.some((job) => job.status === "failed") &&
      !jobs.some((job) => job.status === "queued" || job.status === "running"))
  ) {
    return { status: "failed", detail: "실패 확인 필요" };
  }
  if (draft.status === "needs_review") {
    return { status: "needs_action", detail: "검수 필요" };
  }
  if (draft.status === "approved") {
    return { status: "publish_waiting", detail: "게시 대기" };
  }
  if (draft.status === "published") {
    return { status: "completed", detail: "게시 완료" };
  }
  if (draft.status === "rejected") {
    return { status: "completed", detail: "반려됨" };
  }
  if (
    jobs.some((job) => job.status === "queued" || job.status === "running") ||
    mode === "auto"
  ) {
    return { status: "agent_running", detail: "Agent 진행 중" };
  }
  const detail: Record<PostWorkStage, string> = {
    brief: "브리프 작성 필요",
    plan: "기획 실행 필요",
    prompt: "프롬프트 생성 필요",
    evaluation: "평가 확인 후 생성",
    generation: "이미지 생성 필요",
    review: "검수 필요",
    publish: "게시 필요",
    memory: "완료",
  };
  return { status: "needs_action", detail: detail[stage] };
}

function sourceOf(value: unknown): PostWorkItem["source"] {
  if (value === "manual") return "manual";
  if (value === "scheduler") return "scheduler";
  return "unknown";
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function compareWorkItems(
  left: Pick<PostWorkItem, "updatedAt" | "kind" | "id">,
  right: Pick<PostWorkItem, "updatedAt" | "kind" | "id">,
) {
  const time = right.updatedAt.localeCompare(left.updatedAt);
  if (time !== 0) return time;
  const kind = right.kind.localeCompare(left.kind);
  return kind !== 0 ? kind : right.id.localeCompare(left.id);
}

function encodeCursor(item: WorkCursor): string {
  return Buffer.from(JSON.stringify(item), "utf8").toString("base64url");
}

function parseCursor(value?: string): WorkCursor | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<WorkCursor>;
    if (
      typeof parsed.id !== "string" ||
      (parsed.kind !== "draft" && parsed.kind !== "post") ||
      typeof parsed.updatedAt !== "string" ||
      Number.isNaN(new Date(parsed.updatedAt).getTime())
    ) {
      throw new Error("invalid cursor shape");
    }
    return { id: parsed.id, kind: parsed.kind, updatedAt: parsed.updatedAt };
  } catch {
    throw new BadRequestException("Invalid post work cursor");
  }
}
