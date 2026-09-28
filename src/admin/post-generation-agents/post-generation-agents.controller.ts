import { GenerationSettingsService } from "../../domain/settings/generation-settings.service";
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AdminJwtGuard } from "../auth/admin-jwt.guard";
import { AiModelService } from "../../domain/ai-models/ai-model.service";
import {
  PostAgentPromptService,
  postAgentStage,
} from "../../domain/post-agent-prompts/post-agent-prompt.service";
import { parsePageQuery } from "../../domain/database/page";
import {
  CreateAiModelDto,
  PromptRevisionDto,
  SavePostAgentPromptDto,
} from "./post-generation-agents.dto";
@UseGuards(AdminJwtGuard)
@Controller("api/admin/v1/post-generation-agents")
export class PostGenerationAgentsController {
  constructor(
    private readonly prompts: PostAgentPromptService,
    private readonly models: AiModelService,
    private readonly settings: GenerationSettingsService,
  ) {}
  @Get() async current() {
    const [result, planner, image] = await Promise.all([
      this.prompts.all(),
      this.settings.resolvePlannerSettings(),
      this.settings.resolveProviderSettings(),
    ]);
    return {
      items: result.items.map((item) =>
        item.id
          ? item
          : {
              ...item,
              provider:
                item.stage === "generation"
                  ? image.provider
                  : "openai-compatible",
              effectiveModel:
                (item.stage === "generation"
                  ? (image.editModel ?? image.t2iModel)
                  : planner.model) ?? null,
            },
      ),
    };
  }
  @Get("models") modelsList(
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.models.list(parsePageQuery(cursor, limit));
  }
  @Post("models") createModel(@Body() body: CreateAiModelDto) {
    return this.models.create(body);
  }
  @Get(":stage/versions") history(
    @Param("stage") stage: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.prompts.history(
      postAgentStage(stage),
      parsePageQuery(cursor, limit),
    );
  }
  @Post(":stage/versions") save(
    @Param("stage") stage: string,
    @Body() body: SavePostAgentPromptDto,
  ) {
    return this.prompts.save(postAgentStage(stage), body);
  }
  @Post(":stage/versions/:id/restore") restore(
    @Param("stage") stage: string,
    @Param("id") id: string,
    @Body() body: PromptRevisionDto,
  ) {
    return this.prompts.restore(
      postAgentStage(stage),
      id,
      body.expectedRevision,
    );
  }
  @Post(":stage/reset") reset(
    @Param("stage") stage: string,
    @Body() body: PromptRevisionDto,
  ) {
    return this.prompts.reset(postAgentStage(stage), body.expectedRevision);
  }
}
