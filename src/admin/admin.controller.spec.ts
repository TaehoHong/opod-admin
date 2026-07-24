import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { GenerationWorkerService } from "../worker/generation-worker.service";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { AdminJwtGuard } from "./auth/admin-jwt.guard";
import { GenerationService } from "./generation/generation.service";
import { MediaService } from "./media/media.service";

const CHARACTER_ID = "11111111-1111-4111-8111-111111111111";
const JOB_ID = "22222222-2222-4222-8222-222222222222";
const MEDIA_ID = "33333333-3333-4333-8333-333333333333";
const PURCHASE_ID = "44444444-4444-4444-8444-444444444444";

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
  const listTopHashtags = jest.fn();
  const runJobNow = jest.fn();
  const createImageGenerationDraft = jest.fn();
  const updateImageGenerationDraft = jest.fn();
  const confirmImageGenerationDraft = jest.fn();
  const selectGenerationOutput = jest.fn();
  const regenerateImageJob = jest.fn();
  const reconcilePayment = jest.fn();

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
            listTopHashtags,
            createImageGenerationDraft,
            regenerateImageJob,
            reconcilePayment,
          },
        },
        {
          provide: GenerationService,
          useValue: {
            listJobs: listGenerationJobs,
            getJob: getGenerationJob,
            updateImageDraft: updateImageGenerationDraft,
            confirmImageDraft: confirmImageGenerationDraft,
            selectOutput: selectGenerationOutput,
          },
        },
        {
          provide: MediaService,
          useValue: { startUpload: jest.fn(), confirmUpload: jest.fn() },
        },
        {
          provide: GenerationWorkerService,
          useValue: { runJobNow },
        },
      ],
    })
      .overrideGuard(AdminJwtGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest().admin = {
            id: "admin-1",
            email: "admin@opod.com",
          };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
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
    listTopHashtags.mockReset();
    runJobNow.mockReset();
    createImageGenerationDraft.mockReset();
    updateImageGenerationDraft.mockReset();
    confirmImageGenerationDraft.mockReset();
    selectGenerationOutput.mockReset();
    regenerateImageJob.mockReset();
    reconcilePayment.mockReset();
  });

  afterAll(async () => {
    await app.close();
  });

  it("forwards a payment reconciliation action with the authenticated admin", async () => {
    reconcilePayment.mockResolvedValue({ repaired: true });

    await request(app.getHttpServer())
      .post("/api/payments/reconciliation/actions")
      .send({
        purchaseId: PURCHASE_ID,
        action: "grant_missing_purchase",
        reference: "repair-1",
        reason: "approved correction",
      })
      .expect(201)
      .expect({ repaired: true });

    expect(reconcilePayment).toHaveBeenCalledWith({
      purchaseId: PURCHASE_ID,
      action: "grant_missing_purchase",
      reference: "repair-1",
      reason: "approved correction",
      adminId: "admin-1",
    });
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
        characterId: CHARACTER_ID,
        status: "queued",
        mediaType: "image",
        limit: "9",
      })
      .expect(200)
      .expect({ items: [] });

    expect(listGenerationJobs).toHaveBeenCalledWith({
      characterId: CHARACTER_ID,
      status: "queued",
      mediaType: "image",
      limit: 9,
    });
  });

  it("rejects a malformed generation character filter", async () => {
    await request(app.getHttpServer())
      .get("/api/generation/jobs")
      .query({ characterId: "not-a-uuid" })
      .expect(400);

    expect(listGenerationJobs).not.toHaveBeenCalled();
  });

  it("forwards the generation job detail ID", async () => {
    getGenerationJob.mockResolvedValue({ id: JOB_ID });

    await request(app.getHttpServer())
      .get(`/api/generation/jobs/${JOB_ID}`)
      .expect(200)
      .expect({ id: JOB_ID });

    expect(getGenerationJob).toHaveBeenCalledWith(JOB_ID);
  });

  it("creates an image generation draft", async () => {
    createImageGenerationDraft.mockResolvedValue({ id: JOB_ID });

    await request(app.getHttpServer())
      .post("/api/generation/image-jobs/draft")
      .send({
        characterId: CHARACTER_ID,
        inputPrompt: "portrait",
        candidateCount: 3,
      })
      .expect(201)
      .expect({ id: JOB_ID });

    expect(createImageGenerationDraft).toHaveBeenCalledWith({
      characterId: CHARACTER_ID,
      inputPrompt: "portrait",
      candidateCount: 3,
    });
  });

  it("updates an image generation draft", async () => {
    updateImageGenerationDraft.mockResolvedValue({ id: JOB_ID });

    await request(app.getHttpServer())
      .patch(`/api/generation/jobs/${JOB_ID}/draft`)
      .send({ prompt: "edited", candidateCount: 2 })
      .expect(200)
      .expect({ id: JOB_ID });

    expect(updateImageGenerationDraft).toHaveBeenCalledWith(JOB_ID, {
      prompt: "edited",
      candidateCount: 2,
    });
  });

  it("confirms an image generation draft", async () => {
    confirmImageGenerationDraft.mockResolvedValue({ id: JOB_ID });

    await request(app.getHttpServer())
      .post(`/api/generation/jobs/${JOB_ID}/confirm`)
      .expect(201)
      .expect({ id: JOB_ID });

    expect(confirmImageGenerationDraft).toHaveBeenCalledWith(JOB_ID);
  });

  it("selects a generation output", async () => {
    selectGenerationOutput.mockResolvedValue({ id: JOB_ID });

    await request(app.getHttpServer())
      .post(`/api/generation/jobs/${JOB_ID}/select-output`)
      .send({ mediaId: MEDIA_ID })
      .expect(201)
      .expect({ id: JOB_ID });

    expect(selectGenerationOutput).toHaveBeenCalledWith(JOB_ID, MEDIA_ID);
  });

  it("regenerates an image generation job", async () => {
    regenerateImageJob.mockResolvedValue({ id: JOB_ID });

    await request(app.getHttpServer())
      .post(`/api/generation/jobs/${JOB_ID}/regenerate`)
      .expect(201)
      .expect({ id: JOB_ID });

    expect(regenerateImageJob).toHaveBeenCalledWith(JOB_ID);
  });

  it.each([
    { characterId: "", inputPrompt: "portrait", candidateCount: 3 },
    { characterId: "not-a-uuid", inputPrompt: "portrait", candidateCount: 3 },
    { characterId: CHARACTER_ID, inputPrompt: "", candidateCount: 3 },
    { characterId: CHARACTER_ID, inputPrompt: "portrait", candidateCount: 1.5 },
    { characterId: CHARACTER_ID, inputPrompt: "portrait", candidateCount: 0 },
    { characterId: CHARACTER_ID, inputPrompt: "portrait", candidateCount: 5 },
  ])("rejects invalid image draft creation input %#", async (body) => {
    await request(app.getHttpServer())
      .post("/api/generation/image-jobs/draft")
      .send(body)
      .expect(400);

    expect(createImageGenerationDraft).not.toHaveBeenCalled();
  });

  it.each([
    { prompt: "", candidateCount: 2 },
    { prompt: "edited", candidateCount: 1.5 },
    { prompt: "edited", candidateCount: 0 },
    { prompt: "edited", candidateCount: 5 },
  ])("rejects invalid image draft update input %#", async (body) => {
    await request(app.getHttpServer())
      .patch(`/api/generation/jobs/${JOB_ID}/draft`)
      .send(body)
      .expect(400);

    expect(updateImageGenerationDraft).not.toHaveBeenCalled();
  });

  it.each([{}, { mediaId: "" }, { mediaId: "not-a-uuid" }])(
    "rejects invalid output selection input %#",
    async (body) => {
      await request(app.getHttpServer())
        .post(`/api/generation/jobs/${JOB_ID}/select-output`)
        .send(body)
        .expect(400);

      expect(selectGenerationOutput).not.toHaveBeenCalled();
    },
  );

  it("rejects malformed IDs on every generation job route", async () => {
    const invalidId = "not-a-uuid";

    await request(app.getHttpServer())
      .get(`/api/generation/jobs/${invalidId}`)
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/generation/jobs/${invalidId}/draft`)
      .send({ prompt: "edited", candidateCount: 2 })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/generation/jobs/${invalidId}/confirm`)
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/generation/jobs/${invalidId}/select-output`)
      .send({ mediaId: MEDIA_ID })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/generation/jobs/${invalidId}/regenerate`)
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/generation/jobs/${invalidId}/start`)
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/generation/jobs/${invalidId}/run`)
      .send({})
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/generation/jobs/${invalidId}/retry`)
      .send({})
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/generation/jobs/${invalidId}/complete`)
      .send({ url: "https://cdn.local/generated.png" })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/generation/jobs/${invalidId}/fail`)
      .send({})
      .expect(400);
  });

  it("uses the default top hashtag limit", async () => {
    listTopHashtags.mockResolvedValue({ items: [] });

    await request(app.getHttpServer())
      .get("/api/analytics/hashtags")
      .expect(200)
      .expect({ items: [] });

    expect(listTopHashtags).toHaveBeenCalledWith({ limit: 10 });
  });

  it("forwards an explicit top hashtag limit", async () => {
    listTopHashtags.mockResolvedValue({ items: [] });

    await request(app.getHttpServer())
      .get("/api/analytics/hashtags")
      .query({ limit: "7" })
      .expect(200)
      .expect({ items: [] });

    expect(listTopHashtags).toHaveBeenCalledWith({ limit: 7 });
  });

  it("runs the next queued generation job via the worker", async () => {
    runJobNow.mockResolvedValue({ jobId: "job-1" });

    await request(app.getHttpServer())
      .post("/api/generation/worker/run")
      .send({})
      .expect(201)
      .expect({ jobId: "job-1" });

    expect(runJobNow).toHaveBeenCalledWith(undefined);
  });

  it("runs a specific queued generation job via the worker", async () => {
    runJobNow.mockResolvedValue({
      jobId: "0190d8d1-463b-7e36-a9ef-0242ac120002",
    });

    await request(app.getHttpServer())
      .post("/api/generation/worker/run")
      .send({ jobId: "0190d8d1-463b-7e36-a9ef-0242ac120002" })
      .expect(201);

    expect(runJobNow).toHaveBeenCalledWith(
      "0190d8d1-463b-7e36-a9ef-0242ac120002",
    );
  });

  it("rejects a manual run for a job that is not queued", async () => {
    runJobNow.mockResolvedValue({ jobId: null });

    await request(app.getHttpServer())
      .post("/api/generation/worker/run")
      .send({ jobId: "0190d8d1-463b-7e36-a9ef-0242ac120002" })
      .expect(400);
  });

  it("rejects a malformed manual run jobId", async () => {
    await request(app.getHttpServer())
      .post("/api/generation/worker/run")
      .send({ jobId: "not-a-uuid" })
      .expect(400);

    expect(runJobNow).not.toHaveBeenCalled();
  });
});
