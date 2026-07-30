import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { loadAppConfig } from "./domain/config/app-config";

async function bootstrap() {
  // composition root — 여기서 한 번 읽고 검증한 뒤 나머지 코드는
  // AppConfigService를 주입받는다 (docs/02-development-rules.md:135-137).
  const config = loadAppConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    ...(config.tls
      ? {
          httpsOptions: {
            cert: readFileSync(config.tls.certPath),
            key: readFileSync(config.tls.keyPath),
          },
        }
      : {}),
  });

  // 전역 보안 헤더. CSP 세부값은 React 전환 시 실제 asset에 맞춘다
  // (docs/06-architecture.md "Authentication and Web Security") — 현재 정적
  // SPA는 inline style 속성을 쓰므로 기본 CSP를 켜면 화면이 깨진다.
  app.use(helmet({ contentSecurityPolicy: false }));

  const adminUiRoot = join(process.cwd(), "packages/admin");
  app.useStaticAssets(adminUiRoot);
  app.use(
    (
      request: { method: string; path: string },
      response: { sendFile(path: string): void },
      next: () => void,
    ) => {
      const adminUiPath =
        /^\/(?:home|characters|posts|media|drafts|generation|logs|llm-logs|users|credits|payments|moderation|events|analytics|settings)(?:\/[^/]+){0,2}\/?$/;
      if (request.method === "GET" && adminUiPath.test(request.path)) {
        response.sendFile(join(adminUiRoot, "index.html"));
        return;
      }
      next();
    },
  );

  await app.listen(config.port);
}

void bootstrap();
