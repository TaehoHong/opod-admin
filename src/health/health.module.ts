import { Module } from "@nestjs/common";
import { PrismaModule } from "../domain/database/prisma.module";
import { HealthController } from "./health.controller";
import { HealthRepository } from "./health.repository";
import { HealthService } from "./health.service";

@Module({
  imports: [PrismaModule],
  controllers: [HealthController],
  providers: [HealthService, HealthRepository],
})
export class HealthModule {}
