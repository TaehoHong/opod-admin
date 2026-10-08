import { BadRequestException } from "@nestjs/common";
import { NATURAL_AGENT_STARTERS } from "../../prompts/natural-post-agent";
import {
  NATURAL_STAGES,
  naturalSchemas,
  NaturalAgentBundle,
} from "../post-production/natural-post-agent";
import { canonicalJsonHash } from "../post-production/post-pipeline-v3";
import { isRecord } from "../shared/utils/value-utils";
import { GenerationSettingsService } from "../settings/generation-settings.service";
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
import { AiModelService } from "../ai-models/ai-model.service";
import {
  PostAgentPromptService,
  postAgentStage,
} from "../post-agent-prompts/post-agent-prompt.service";
import { parsePageQuery } from "../shared/utils/page";
import {
  CreateAiModelDto,
  SaveNaturalAgentDto,
  PromptRevisionDto,
  SavePostAgentPromptDto,
} from "./dto/post-generation-agents.dto";
@UseGuards(AdminJwtGuard)
@Controller("api/admin/v1/post-generation-agents")
export class PostGenerationAgentsController {
  constructor(
    private readonly prompts: PostAgentPromptService,
    private readonly models: AiModelService,
    private readonly settings: GenerationSettingsService,
  ) {}
  @Get() async current() {
    const [result, image] = await Promise.all([
      this.prompts.all(),
      this.settings.resolveProviderSettings(),
    ]);
    return {
      items: result.items.map((item) =>
        item.id || item.stage !== "generation"
          ? item
          : {
              ...item,
              provider: image.provider,
              effectiveModel: image.editModel ?? image.t2iModel ?? null,
            },
      ),
    };
  }
  @Get("natural/config") async naturalConfig() {
    return {
      current: await this.settings.getNaturalAgentBundle(),
      starters: NATURAL_AGENT_STARTERS,
    };
  }
  @Post("natural/config") async saveNaturalConfig(
    @Body() body: SaveNaturalAgentDto,
  ) {
    if (
      !isRecord(body.prompts) ||
      Object.keys(body.prompts).length !== NATURAL_STAGES.length ||
      NATURAL_STAGES.some(
        (stage) =>
          typeof (body.prompts as Record<string, unknown>)[stage] !== "string",
      )
    )
      throw new BadRequestException("새 Agent의 모든 단계 지침을 입력하세요.");
    const [planning, review, generation] = await Promise.all([
      this.models.get(body.planningAiModelId),
      this.models.get(body.reviewAiModelId),
      this.prompts.execution("generation"),
    ]);
    if (planning.type !== "llm" || review.type !== "llm" || !generation?.id)
      throw new BadRequestException(
        "기획·검수 LLM과 이미지 생성 모델을 먼저 설정하세요.",
      );
    const content = {
      version: 1 as const,
      schedulerDefault: body.schedulerDefault,
      planningModel: {
        aiModelId: planning.id,
        provider: planning.provider,
        model: planning.model,
      },
      reviewModel: {
        aiModelId: review.id,
        provider: review.provider,
        model: review.model,
      },
      generation: {
        id: generation.id,
        revision: generation.revision,
        aiModelId: generation.aiModelId!,
        provider: generation.provider!,
        effectiveModel: generation.effectiveModel!,
      },
      prompts: body.prompts as NaturalAgentBundle["prompts"],
      schemas: naturalSchemas(),
    };
    return this.settings.saveNaturalAgentBundle(
      { ...content, revision: canonicalJsonHash(content) },
      body.expectedRevision,
    );
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
}
