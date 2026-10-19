import { Test } from "@nestjs/testing";
import { ConfigModule } from "../core/config/config.module";
import { AppConfigService } from "../core/config/app-config.service";
import { DatabaseService } from "../core/database/database.service";
import { DraftWorkerService } from "../drafts/draft-worker.service";
import { ReferencePostAgentRunner } from "./reference-post-agent.runner";
import { PostProductionModule } from "./post-production.module";

describe("post production dependency wiring", () => {
  it("constructs both runners and the worker without opening a database or provider connection", async () => {
    const module = await Test.createTestingModule({
      imports: [ConfigModule, PostProductionModule],
    })
      .overrideProvider(AppConfigService)
      .useValue(
        new AppConfigService({
          DATABASE_URL: "postgresql://localhost/unused",
          ADMIN_JWT_SECRET: "test-secret",
        }),
      )
      .overrideProvider(DatabaseService)
      .useValue({
        client: new Proxy(
          {},
          {
            get: () => {
              throw new Error("database access is forbidden in DI smoke test");
            },
          },
        ),
      })
      .compile();
    expect(module.get(ReferencePostAgentRunner)).toBeInstanceOf(
      ReferencePostAgentRunner,
    );
    expect(module.get(DraftWorkerService)).toBeInstanceOf(DraftWorkerService);
    await module.close();
  });
});
