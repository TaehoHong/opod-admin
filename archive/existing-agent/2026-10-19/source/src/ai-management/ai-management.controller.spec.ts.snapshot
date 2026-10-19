import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AdminAuthService } from "../auth/admin-auth.service";
import { AdminCsrfGuard } from "../auth/admin-csrf.guard";
import { ADMIN_SESSION_COOKIE } from "../auth/admin-session";
import { AiManagementController } from "./ai-management.controller";
import { AiManagementService } from "./ai-management.service";

describe("AI management HTTP boundary", () => {
  let app: INestApplication;
  let revision: string | null;
  const path = "/api/admin/v1/ai-management";
  const headers = {
    cookie: `${ADMIN_SESSION_COOKIE}=test-session`,
    "x-opod-admin": "1",
  };
  beforeAll(async () => {
    const service = new AiManagementService(
      {
        getAiManagement: async () => ({
          version: 1,
          revision,
          connections: [
            {
              id: "llm",
              type: "llm",
              provider: "openai-compatible",
              apiUrl: "https://api.test/v1",
              apiKey: "private-1234",
              models: [{ id: "1", model: "test-model" }],
            },
          ],
          bindings: {},
          changes: [],
        }),
        aiConnectionKey: async () => "private-1234",
        saveAiManagement: async (value: { revision: string }) => {
          revision = value.revision;
        },
      } as never,
      {} as never,
      {} as never,
    );
    const module = await Test.createTestingModule({
      controllers: [AiManagementController],
      providers: [
        { provide: AiManagementService, useValue: service },
        {
          provide: AdminAuthService,
          useValue: {
            authenticateAdminToken: async () => ({
              id: "admin",
              email: "admin@test",
            }),
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalGuards(new AdminCsrfGuard());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });
  beforeEach(() => {
    revision = "r1";
  });
  afterAll(async () => {
    await app?.close();
  });

  it("protects reads with the admin cookie and mutations with CSRF", async () => {
    await request(app.getHttpServer()).get(path).expect(401);
    const view = await request(app.getHttpServer())
      .get(path)
      .set(headers)
      .expect(200);
    expect(JSON.stringify(view.body)).not.toContain("private-1234");
    await request(app.getHttpServer())
      .put(`${path}/features/natural.caption`)
      .set("cookie", headers.cookie)
      .send({ expectedRevision: "r1", connectionId: "llm", modelId: "1" })
      .expect(403);
  });

  it("validates required revision and API type and returns a conflict for stale updates", async () => {
    await request(app.getHttpServer())
      .post(`${path}/connections`)
      .set(headers)
      .send({
        expectedRevision: "r1",
        type: "llm",
        provider: "spicyapi",
        apiUrl: "https://api.test",
      })
      .expect(400);
    await request(app.getHttpServer())
      .put(`${path}/features/natural.caption`)
      .set(headers)
      .send({ connectionId: "llm", modelId: "1" })
      .expect(400);
    await request(app.getHttpServer())
      .put(`${path}/features/natural.caption`)
      .set(headers)
      .send({ expectedRevision: "stale", connectionId: "llm", modelId: "1" })
      .expect(409);
    const saved = await request(app.getHttpServer())
      .put(`${path}/features/natural.caption`)
      .set(headers)
      .send({ expectedRevision: "r1", connectionId: "llm", modelId: "1" })
      .expect(200);
    expect(
      saved.body.features.find(
        (f: { id: string }) => f.id === "natural.caption",
      ).selection.model,
    ).toBe("test-model");
    expect(saved.body.revision).not.toBe("r1");
  });
});
