import { PostWorkspaceRepository } from "./post-workspace.repository";
import { PostWorkspaceService } from "./post-workspace.service";

const draft = {
  id: "draft-1",
  characterId: "character-1",
  contentType: "feed",
  caption: "서린의 새 게시물",
  status: "generating",
  scheduledAt: null,
  publishedPostId: null,
  conceptJson: { source: "manual", mode: "manual", plan: { shots: [{}] } },
  createdAt: new Date("2026-08-10T01:00:00.000Z"),
  updatedAt: new Date("2026-08-10T03:00:00.000Z"),
  publishedPost: null,
  jobs: [
    {
      id: "job-1",
      sortOrder: 0,
      status: "draft",
      prompt: "portrait prompt",
      updatedAt: new Date("2026-08-10T03:00:00.000Z"),
      outputs: [],
    },
  ],
  evaluations: [],
};

const post = {
  id: "post-1",
  characterId: "character-2",
  contentType: "feed",
  content: "직접 작성한 게시물",
  createdAt: new Date("2026-08-10T02:00:00.000Z"),
  postMedia: [],
};

describe("PostWorkspaceService", () => {
  const repository = {
    findDrafts: jest.fn(),
    findStandalonePosts: jest.fn(),
    findDraft: jest.fn(),
    findStandalonePost: jest.fn(),
  } as unknown as jest.Mocked<PostWorkspaceRepository>;
  const service = new PostWorkspaceService(repository);

  beforeEach(() => jest.clearAllMocks());

  it("merges lifecycle work by recent change and derives the current manual stage", async () => {
    repository.findDrafts.mockResolvedValue([draft] as never);
    repository.findStandalonePosts.mockResolvedValue([post] as never);

    const page = await service.list({ filter: "all", limit: 20 });

    expect(page.items).toEqual([
      expect.objectContaining({
        id: "draft-1",
        kind: "draft",
        currentStage: "evaluation",
        stageIndex: 4,
        operationalStatus: "needs_action",
        executionMode: "manual",
      }),
      expect.objectContaining({
        id: "post-1",
        kind: "post",
        currentStage: "memory",
        stageIndex: 8,
        operationalStatus: "completed",
      }),
    ]);
  });

  it("keeps draft-backed published posts out of the standalone post query contract", async () => {
    repository.findDrafts.mockResolvedValue([]);
    repository.findStandalonePosts.mockResolvedValue([]);

    await service.list({ filter: "published", limit: 20 });

    expect(repository.findStandalonePosts).toHaveBeenCalledWith(
      expect.objectContaining({ onlyStandalone: true }),
    );
  });

  it("filters the operations queue by the derived representative status", async () => {
    repository.findDrafts.mockResolvedValue([draft] as never);
    repository.findStandalonePosts.mockResolvedValue([post] as never);

    const page = await service.list({ filter: "needs_action", limit: 20 });

    expect(page.items.map((item) => item.id)).toEqual(["draft-1"]);
  });
});
