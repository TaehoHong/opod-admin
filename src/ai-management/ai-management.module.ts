import { Module } from "@nestjs/common";
import { AdminAuthModule } from "../auth/admin-auth.module";
import { AiModelsModule } from "../ai-models/ai-models.module";
import { PostAgentPromptsModule } from "../post-agent-prompts/post-agent-prompts.module";
import { SettingsModule } from "../settings/settings.module";
import { AiManagementController } from "./ai-management.controller";
import { AiManagementService } from "./ai-management.service";

@Module({
  imports: [
    AdminAuthModule,
    SettingsModule,
    AiModelsModule,
    PostAgentPromptsModule,
  ],
  providers: [AiManagementService],
  controllers: [AiManagementController],
})
export class AiManagementModule {}
