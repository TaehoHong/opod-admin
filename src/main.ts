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
  app.useStaticAssets(join(process.cwd(), "packages/admin"));

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
