import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../domain/database/database.module";
import { AdminAuthController } from "./admin-auth.controller";
import { AdminAuthService } from "./admin-auth.service";
import { AdminRepository } from "./admin.repository";
import { AdminJwtGuard } from "./admin-jwt.guard";

@Module({
  imports: [DatabaseModule],
  controllers: [AdminAuthController],
  providers: [AdminAuthService, AdminJwtGuard, AdminRepository],
  exports: [AdminAuthService, AdminJwtGuard],
})
export class AdminAuthModule {}
