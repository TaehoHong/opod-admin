import { Module } from "@nestjs/common";
import { CharactersModule } from "../characters/characters.module";
import { PrismaModule } from "../domain/database/prisma.module";
import { AdminAuthModule } from "./auth/admin-auth.module";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { GenerationService } from "./generation/generation.service";
import { MediaService } from "./media/media.service";

@Module({
  imports: [PrismaModule, AdminAuthModule, CharactersModule],
  controllers: [AdminController],
  providers: [AdminService, GenerationService, MediaService],
})
export class AdminModule {}
