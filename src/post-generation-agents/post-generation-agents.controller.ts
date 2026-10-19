import {
  REFERENCE_SELECTION_SYSTEM_PROMPT,
  REFERENCE_SELECTION_JSON_SCHEMA,
} from "../../prompts/reference-selection";
import {
  REFERENCE_IMAGE_PROMPT_SYSTEM_PROMPT,
  REFERENCE_IMAGE_PROMPT_JSON_SCHEMA,
} from "../../prompts/reference-image-prompt";
import {
  REFERENCE_CAPTION_SYSTEM_PROMPT,
  REFERENCE_CAPTION_JSON_SCHEMA,
} from "../../prompts/reference-caption";
import {
  REFERENCE_AGENT_STAGES,
  ReferenceAgentStage,
  ReferenceAgentStageConfig,
  ReferenceAgentGenerationConfig,
} from "../post-production/reference-agent-config";
import { BadRequestException } from "@nestjs/common";
import { NATURAL_AGENT_STARTERS } from "../../prompts/natural-post-agent";
import { STRUCTURED_PLANNING_PROMPTS } from "../../prompts/structured-planning";
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
  SaveReferenceAgentDto,
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
  @Get("reference/config") async referenceConfig() {
    return {
      current: await this.settings.getReferenceAgentSettings(),
      starters: {
        reference_select: {
          systemPrompt: REFERENCE_SELECTION_SYSTEM_PROMPT,
          outputSchema: REFERENCE_SELECTION_JSON_SCHEMA,
        },
        image_prompt: {
          systemPrompt: REFERENCE_IMAGE_PROMPT_SYSTEM_PROMPT,
          outputSchema: REFERENCE_IMAGE_PROMPT_JSON_SCHEMA,
        },
        caption: {
          systemPrompt: REFERENCE_CAPTION_SYSTEM_PROMPT,
          outputSchema: REFERENCE_CAPTION_JSON_SCHEMA,
        },
      },
    };
  }
  @Post("reference/config") async saveReferenceConfig(
    @Body() body: SaveReferenceAgentDto,
  ) {
    if (body.stages === undefined && body.generationAiModelId !== undefined)
      throw new BadRequestException(
        "이미지 모델은 단계 설정과 함께 저장하세요.",
      );
    if (body.stages === undefined)
      return this.settings.saveReferenceAgentSettings(
        body.maxAttempts,
        body.expectedRevision,
      );
    const input = body.stages;
    if (
      !isRecord(input) ||
      Object.keys(input).length !== REFERENCE_AGENT_STAGES.length ||
      REFERENCE_AGENT_STAGES.some((stage) => {
        const value = input[stage];
        return (
          !isRecord(value) ||
          typeof value.aiModelId !== "string" ||
          !/^[1-9][0-9]*$/.test(value.aiModelId) ||
          typeof value.systemPrompt !== "string" ||
          !value.systemPrompt.trim() ||
          value.systemPrompt.length > 50000
        );
      })
    )
      throw new BadRequestException(
        "레퍼런스 Agent의 모든 단계 지침과 모델을 입력하세요.",
      );
    let generation: ReferenceAgentGenerationConfig;
    if (body.generationAiModelId !== undefined) {
      const model = await this.models.get(body.generationAiModelId);
      if (model.type !== "image")
        throw new BadRequestException("이미지 생성 모델을 선택하세요.");
      generation = {
        source: "model",
        aiModelId: model.id,
        provider: model.provider,
        effectiveModel: model.model,
      };
    } else {
      const shared = await this.prompts.execution("generation");
      if (
        !shared?.id ||
        !shared.aiModelId ||
        !shared.provider ||
        !shared.effectiveModel
      )
        throw new BadRequestException("이미지 생성 모델을 선택하세요.");
      generation = {
        id: shared.id,
        revision: shared.revision,
        aiModelId: shared.aiModelId,
        provider: shared.provider,
        effectiveModel: shared.effectiveModel,
      };
    }
    const schemas = {
      reference_select: REFERENCE_SELECTION_JSON_SCHEMA,
      image_prompt: REFERENCE_IMAGE_PROMPT_JSON_SCHEMA,
      caption: REFERENCE_CAPTION_JSON_SCHEMA,
    };
    const entries = await Promise.all(
      REFERENCE_AGENT_STAGES.map(async (stage) => {
        const value = input[stage] as {
          aiModelId: string;
          systemPrompt: string;
        };
        const model = await this.models.get(value.aiModelId);
        if (model.type !== "llm")
          throw new BadRequestException(
            "레퍼런스 Agent 단계 모델은 LLM을 선택하세요.",
          );
        return [
          stage,
          {
            aiModelId: model.id,
            provider: model.provider,
            model: model.model,
            systemPrompt: value.systemPrompt,
            outputSchema: schemas[stage],
          },
        ] as const;
      }),
    );
    return this.settings.saveReferenceAgentSettings(
      body.maxAttempts,
      body.expectedRevision,
      {
        stages: Object.fromEntries(entries) as Record<
          ReferenceAgentStage,
          ReferenceAgentStageConfig
        >,
        generation,
      },
    );
  }
  @Get("natural/config") async naturalConfig() {
    return {
      current: await this.settings.getNaturalAgentBundle(),
      starters: NATURAL_AGENT_STARTERS,
      structuredPlanningPrompts: STRUCTURED_PLANNING_PROMPTS,
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
    if (!generation?.id)
      throw new BadRequestException("이미지 생성 모델을 먼저 저장하세요.");
    if (planning.type !== "llm")
      throw new BadRequestException("기획·캡션 모델은 LLM을 선택하세요.");
    if (review.type !== "llm")
      throw new BadRequestException("사진 검수 모델은 LLM을 선택하세요.");
    const content = {
      version: 1 as const,
      ...(body.planningContract
        ? { planningContract: body.planningContract }
        : {}),
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
      schemas: naturalSchemas(body.planningContract),
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
    this.requireWritableStage(stage);
    return this.prompts.save(postAgentStage(stage), body);
  }
  @Post(":stage/versions/:id/restore") restore(
    @Param("stage") stage: string,
    @Param("id") id: string,
    @Body() body: PromptRevisionDto,
  ) {
    this.requireWritableStage(stage);
    return this.prompts.restore(
      postAgentStage(stage),
      id,
      body.expectedRevision,
    );
  }
  private requireWritableStage(stage: string): void {
    postAgentStage(stage);
    if (stage !== "generation")
      throw new BadRequestException(
        "기존 Agent 설정은 보관되어 읽기만 가능합니다.",
      );
  }
}
