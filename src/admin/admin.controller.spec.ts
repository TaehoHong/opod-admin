import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { AdminJwtGuard } from "./auth/admin-jwt.guard";

describe("AdminController reads", () => {
  let app: INestApplication;
  const listPosts = jest.fn();
  const getPost = jest.fn();
  const listPostComments = jest.fn();
  const listPostReactions = jest.fn();
  const listStories = jest.fn();
  const getStory = jest.fn();
  const listGenerationJobs = jest.fn();
  const getGenerationJob = jest.fn();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        {
          provide: AdminService,
          useValue: {
            listPosts,
            getPost,
            listPostComments,
            listPostReactions,
            listStories,
            getStory,
            listGenerationJobs,
            getGenerationJob,
          },
        },
      ],
    })
      .overrideGuard(AdminJwtGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    listPosts.mockReset();
    getPost.mockReset();
    listPostComments.mockReset();
    listPostReactions.mockReset();
    listStories.mockReset();
    getStory.mockReset();
    listGenerationJobs.mockReset();
    getGenerationJob.mockReset();
  });

  afterAll(async () => {
    await app.close();
  });

  it("forwards post list filters and parsed pagination", async () => {
    listPosts.mockResolvedValue({ items: [] });

    await request(app.getHttpServer())
      .get("/api/posts")
      .query({ characterId: "ai-1", contentType: "feed", limit: "7" })
      .expect(200)
      .expect({ items: [] });

    expect(listPosts).toHaveBeenCalledWith({
      characterId: "ai-1",
      contentType: "feed",
      limit: 7,
    });
  });

  it("forwards the post detail ID", async () => {
    getPost.mockResolvedValue({ id: "post-1" });

    await request(app.getHttpServer())
      .get("/api/posts/post-1")
      .expect(200)
      .expect({ id: "post-1" });

    expect(getPost).toHaveBeenCalledWith("post-1");
  });

  it("forwards the post comment path, author filter, and pagination", async () => {
    listPostComments.mockResolvedValue({ items: [] });

    await request(app.getHttpServer())
      .get("/api/posts/post-1/comments")
      .query({ characterId: "ai-1", limit: "6" })
      .expect(200)
      .expect({ items: [] });

    expect(listPostComments).toHaveBeenCalledWith({
      postId: "post-1",
      characterId: "ai-1",
      limit: 6,
    });
  });

  it("forwards the post reaction path, filters, and pagination", async () => {
    listPostReactions.mockResolvedValue({ items: [] });

    await request(app.getHttpServer())
      .get("/api/posts/post-1/reactions")
      .query({ characterId: "ai-1", reactionType: "like", limit: "8" })
      .expect(200)
      .expect({ items: [] });

    expect(listPostReactions).toHaveBeenCalledWith({
      postId: "post-1",
      characterId: "ai-1",
      reactionType: "like",
      limit: 8,
    });
  });

  it("forwards story filters and pagination", async () => {
    listStories.mockResolvedValue({ items: [] });

    await request(app.getHttpServer())
      .get("/api/stories")
      .query({ characterId: "ai-1", limit: "5" })
      .expect(200)
      .expect({ items: [] });

    expect(listStories).toHaveBeenCalledWith({
      characterId: "ai-1",
      limit: 5,
    });
  });

  it("forwards the story detail ID", async () => {
    getStory.mockResolvedValue({ id: "story-1" });

    await request(app.getHttpServer())
      .get("/api/stories/story-1")
      .expect(200)
      .expect({ id: "story-1" });

    expect(getStory).toHaveBeenCalledWith("story-1");
  });

  it("forwards generation job list filters and pagination", async () => {
    listGenerationJobs.mockResolvedValue({ items: [] });

    await request(app.getHttpServer())
      .get("/api/generation/jobs")
      .query({
        characterId: "ai-1",
        status: "queued",
        mediaType: "image",
        limit: "9",
      })
      .expect(200)
      .expect({ items: [] });

    expect(listGenerationJobs).toHaveBeenCalledWith({
      characterId: "ai-1",
      status: "queued",
      mediaType: "image",
      limit: 9,
    });
  });

  it("forwards the generation job detail ID", async () => {
    getGenerationJob.mockResolvedValue({ id: "job-1" });

    await request(app.getHttpServer())
      .get("/api/generation/jobs/job-1")
      .expect(200)
      .expect({ id: "job-1" });

    expect(getGenerationJob).toHaveBeenCalledWith("job-1");
  });
});
