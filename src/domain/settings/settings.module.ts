import { Module } from "@nestjs/common";
import { PrismaModule } from "../database/prisma.module";
import { GenerationSettingsService } from "./generation-settings.service";

// admin_settings 키-값 저장소 접근. 워커와 admin HTTP 양쪽에서 쓰이므로
// domain 계층에 둔다 (워커 → admin 역참조 금지 규칙, D1).
@Module({
  imports: [PrismaModule],
  providers: [GenerationSettingsService],
  exports: [GenerationSettingsService],
})
export class SettingsModule {}
