import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AiModelsModule } from "../ai-models/ai-models.module";
import { PostAgentPromptRepository } from "./post-agent-prompt.repository";
import { PostAgentPromptService } from "./post-agent-prompt.service";
@Module({
  imports: [DatabaseModule, AiModelsModule],
  providers: [PostAgentPromptRepository, PostAgentPromptService],
  exports: [PostAgentPromptService],
})
export class PostAgentPromptsModule {}
