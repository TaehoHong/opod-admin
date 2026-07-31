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

  // 전역 보안 헤더 (docs/06-architecture.md "Authentication and Web Security").
  // CSP는 실제로 서빙하는 asset에 맞춘다.
  //
  // - script-src 'self': 번들은 외부 파일이고 inline script나 eval을 쓰지
  //   않는다. 여기가 CSP의 실질적인 이득이다.
  // - style-src에 'unsafe-inline': Mantine이 런타임에 CSS 변수 <style>을
  //   주입하고 inline style 속성을 쓴다. nonce로 좁히려면 HTML을 서버에서
  //   렌더해야 하는데 지금은 정적 파일 그대로 내보낸다.
  // - img-src에 https:: 미디어는 S3/CDN에 있고 DB에 저장된 URL의 호스트가
  //   과거 데이터까지 포함해 하나로 고정돼 있지 않다. 특정 origin으로 좁히면
  //   조용히 안 보이는 이미지가 생긴다.
  // - upgrade-insecure-requests는 끈다. TLS는 선택이고 로컬은 http로 띄운다.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'"],
          "style-src": ["'self'", "'unsafe-inline'"],
          "img-src": ["'self'", "data:", "https:"],
          "font-src": ["'self'", "data:"],
          "connect-src": ["'self'"],
          "form-action": ["'self'"],
          "frame-ancestors": ["'none'"],
          "object-src": ["'none'"],
          "base-uri": ["'self'"],
          "upgrade-insecure-requests": null,
        },
      },
    }),
  );

  // 관리 콘솔은 React build 산출물 하나만 서빙한다. root build와 Docker build가
  // admin:build를 선행하므로 운영 artifact에는 이 entry가 항상 포함된다.
  const adminUiRoot = join(process.cwd(), "packages/admin/dist");
  const shellEntry = join(adminUiRoot, "index.html");

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
        response.sendFile(shellEntry);
        return;
      }
      next();
    },
  );

  await app.listen(config.port);
}

void bootstrap();
