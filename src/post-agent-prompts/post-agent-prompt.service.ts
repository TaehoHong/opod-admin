import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { isDeepStrictEqual } from "node:util";
import { plannerSchemaWithStatusFirst } from "../../prompts/strict-schema";
import {
  POST_AGENT_CONTRACTS,
  POST_AGENT_STAGES,
  PostAgentStage,
} from "../../prompts/post-agent-contracts";
import { AiModelService, validateAiModel } from "../ai-models/ai-model.service";
import { aiConfigId } from "../ai-models/ai-model-id";
import { decodeCursor, PageInput, pageFromRows } from "../shared/utils/page";
import {
  PostAgentPromptRepository,
  PostAgentPromptRow,
} from "./post-agent-prompt.repository";
export type PostAgentPromptInput = {
  aiModelId: string;
  model: string | null;
  systemPrompt: string | null;
  outputSchema: unknown;
  expectedRevision: number;
};
export function postAgentStage(value: string): PostAgentStage {
  if (!POST_AGENT_STAGES.includes(value as PostAgentStage))
    throw new BadRequestException("Invalid post agent stage");
  return value as PostAgentStage;
}
@Injectable()
export class PostAgentPromptService {
  constructor(
    private readonly prompts: PostAgentPromptRepository,
    private readonly models: AiModelService,
  ) {}
  async current(stage: PostAgentStage) {
    const row = await this.prompts.current(stage);
    return row
      ? this.view(row)
      : {
          id: null,
          stage,
          revision: 0,
          aiModelId: null,
          model: null,
          provider: null,
          effectiveModel: null,
          createdAt: null,
          ...POST_AGENT_CONTRACTS[stage],
          systemPrompt: null,
        };
  }
  async execution(stage: PostAgentStage) {
    const selected = await this.current(stage);
    if (!selected.id) return null;
    this.validateContent(stage, selected.systemPrompt, selected.outputSchema);
    if (stage === "post_plan" || stage === "image_plan") {
      return {
        ...selected,
        outputSchema: plannerSchemaWithStatusFirst(
          selected.outputSchema as Record<string, unknown>,
        ),
      };
    }
    return selected;
  }
  async all() {
    return {
      items: await Promise.all(
        POST_AGENT_STAGES.map((stage) => this.current(stage)),
      ),
    };
  }
  async history(stage: PostAgentStage, page: PageInput) {
    const cursor = decodeCursor(page.cursor);
    const rows = await this.prompts.list(
      stage,
      cursor ? aiConfigId(cursor) : undefined,
      page.limit,
    );
    return pageFromRows(
      await Promise.all(rows.map((row) => this.view(row))),
      page.limit,
    );
  }
  async getVersion(stage: PostAgentStage, id: string) {
    const row = await this.prompts.find(aiConfigId(id));
    if (!row || row.stage !== stage)
      throw new NotFoundException("Prompt version not found");
    return this.view(row);
  }
  async save(stage: PostAgentStage, input: PostAgentPromptInput) {
    const target = await this.models.get(input.aiModelId);
    const type = stage === "generation" ? "image" : "llm";
    if (target.type !== type)
      throw new BadRequestException("Model type does not match this stage");
    if (
      input.model !== null &&
      (typeof input.model !== "string" || !input.model.trim())
    )
      throw new BadRequestException("Model override must be nonempty or null");
    const model = input.model?.trim() ?? null;
    validateAiModel(type, target.provider, model ?? target.model);
    this.validateContent(stage, input.systemPrompt, input.outputSchema);
    const row = await this.prompts.append(stage, input.expectedRevision, {
      aiModelId: aiConfigId(input.aiModelId),
      model,
      systemPrompt: input.systemPrompt?.trim() ?? null,
      outputSchema: input.outputSchema,
    });
    if (!row)
      throw new ConflictException(
        "설정이 변경되었습니다. 입력을 보관한 뒤 최신 버전을 불러오세요.",
      );
    return this.view(row);
  }
  async restore(stage: PostAgentStage, id: string, expectedRevision: number) {
    const version = await this.getVersion(stage, id);
    return this.save(stage, {
      expectedRevision,
      aiModelId: version.aiModelId,
      model: version.model,
      systemPrompt: version.systemPrompt,
      outputSchema: version.outputSchema,
    });
  }
  private validateContent(
    stage: PostAgentStage,
    prompt: string | null,
    schema: unknown,
  ) {
    if (stage === "generation") {
      if (prompt !== null || schema !== null)
        throw new BadRequestException(
          "Image generation uses no system prompt or output schema",
        );
    } else if (
      !prompt?.trim() ||
      prompt.length > 50000 ||
      !isDeepStrictEqual(schema, POST_AGENT_CONTRACTS[stage].outputSchema)
    ) {
      throw new BadRequestException(
        "시스템 지침과 현재 단계의 출력 규격을 확인하세요.",
      );
    }
  }
  private async view(row: PostAgentPromptRow) {
    const target = await this.models.get(String(row.aiModelId));
    validateAiModel(
      row.stage === "generation" ? "image" : "llm",
      target.provider,
      row.model ?? target.model,
    );
    if (target.type !== (row.stage === "generation" ? "image" : "llm"))
      throw new BadRequestException("Stored model type does not match stage");
    return {
      ...row,
      id: String(row.id),
      aiModelId: String(row.aiModelId),
      provider: target.provider,
      effectiveModel: row.model ?? target.model,
      createdAt: row.createdAt.toISOString(),
      label: POST_AGENT_CONTRACTS[row.stage].label,
    };
  }
}
export type PostAgentPromptView = Awaited<
  ReturnType<PostAgentPromptService["current"]>
>;
