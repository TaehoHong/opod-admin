import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { AdminJwtGuard } from "./auth/admin-jwt.guard";

describe("AdminController post reads", () => {
  let app: INestApplication;
  const listPosts = jest.fn();
  const getPost = jest.fn();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        {
          provide: AdminService,
          useValue: { listPosts, getPost },
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
});
