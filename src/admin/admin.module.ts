import { Module } from "@nestjs/common";
import { PrismaModule } from "../domain/database/prisma.module";
import { AdminApiKeyGuard } from "./admin-api-key.guard";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { GenerationService } from "./generation/generation.service";
import { MediaService } from "./media/media.service";

@Module({
  imports: [PrismaModule],
  controllers: [AdminController],
  providers: [AdminApiKeyGuard, AdminService, GenerationService, MediaService],
})
export class AdminModule {}
