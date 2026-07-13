import { Module } from "@nestjs/common";
import { AdminAuthModule } from "../admin/auth/admin-auth.module";
import { PrismaModule } from "../domain/database/prisma.module";
import { CharactersController } from "./characters.controller";
import { CharactersService } from "./characters.service";
import { PostingPolicyService } from "./posting-policy.service";
import { VisualProfileService } from "./visual-profile.service";

@Module({
  imports: [PrismaModule, AdminAuthModule],
  controllers: [CharactersController],
  providers: [CharactersService, PostingPolicyService, VisualProfileService],
})
export class CharactersModule {}
