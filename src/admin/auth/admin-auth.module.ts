import { Module } from "@nestjs/common";
import { PrismaModule } from "../../domain/database/prisma.module";
import { AdminAuthController } from "./admin-auth.controller";
import { AdminAuthService } from "./admin-auth.service";
import { AdminRepository } from "./admin.repository";
import { AdminJwtGuard } from "./admin-jwt.guard";

@Module({
  imports: [PrismaModule],
  controllers: [AdminAuthController],
  providers: [AdminAuthService, AdminJwtGuard, AdminRepository],
  exports: [AdminAuthService, AdminJwtGuard],
})
export class AdminAuthModule {}
