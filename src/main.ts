import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { setupAdminSwagger } from "./admin/swagger";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    httpsOptions: getHttpsOptions(),
  });

  setupAdminSwagger(app);
  const adminUiRoot = join(process.cwd(), "packages/admin");
  app.useStaticAssets(adminUiRoot);
  app.use(
    (
      request: { method: string; path: string },
      response: { sendFile(path: string): void },
      next: () => void,
    ) => {
      const adminUiPath =
        /^\/(?:home|characters|posts|media|drafts|generation|logs|users|credits|payments|moderation|events|analytics|settings)(?:\/[^/]+){0,2}\/?$/;
      if (request.method === "GET" && adminUiPath.test(request.path)) {
        response.sendFile(join(adminUiRoot, "index.html"));
        return;
      }
      next();
    },
  );

  await app.listen(process.env.ADMIN_API_PORT ?? process.env.PORT ?? 7100);
}

function getHttpsOptions() {
  const certPath = process.env.ADMIN_TLS_CERT_PATH;
  const keyPath = process.env.ADMIN_TLS_KEY_PATH;

  if (!certPath || !keyPath) {
    return undefined;
  }

  return {
    cert: readFileSync(certPath),
    key: readFileSync(keyPath),
  };
}

void bootstrap();
