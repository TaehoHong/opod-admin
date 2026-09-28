import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { IMAGE_MODEL_POLICIES } from "../../../prompts/image-model-policies";
import { decodeCursor, PageInput, pageFromRows } from "../database/page";
import { AiModelRepository } from "./ai-model.repository";
import { aiConfigId } from "./ai-model-id";
export type AiModelSelection = {
  id: string;
  type: "llm" | "image";
  provider: string;
  model: string;
  createdAt: string;
};
export function validateAiModel(
  type: "llm" | "image",
  provider: string,
  model: string,
) {
  if (
    !model.trim() ||
    model.length > 512 ||
    !provider.trim() ||
    provider.length > 100
  )
    throw new BadRequestException("Provider and model are required");
  if (type === "llm") {
    if (provider !== "openai-compatible")
      throw new BadRequestException("Unsupported LLM provider");
    return;
  }
  const supported =
    Object.prototype.hasOwnProperty.call(IMAGE_MODEL_POLICIES, model) &&
    ((provider === "openai" && model === "gpt-image-2.5-sunburst") ||
      (provider === "fal" && model.startsWith("fal-ai/")) ||
      (provider === "opod-flux" &&
        model === "black-forest-labs/FLUX.1-Kontext-dev"));
  if (!supported)
    throw new BadRequestException(
      "Unsupported image provider/model combination",
    );
}
@Injectable()
export class AiModelService {
  constructor(private readonly models: AiModelRepository) {}
  async get(id: string): Promise<AiModelSelection> {
    const row = await this.models.find(aiConfigId(id));
    if (!row) throw new NotFoundException("AI model not found");
    return {
      ...row,
      id: String(row.id),
      createdAt: row.createdAt.toISOString(),
    };
  }
  async list(page: PageInput) {
    const cursor = decodeCursor(page.cursor);
    const rows = await this.models.list(
      cursor ? aiConfigId(cursor) : undefined,
      page.limit,
    );
    return pageFromRows(
      rows.map((row) => ({
        ...row,
        id: String(row.id),
        createdAt: row.createdAt.toISOString(),
      })),
      page.limit,
    );
  }
  async create(input: {
    type: "llm" | "image";
    provider: string;
    model: string;
  }) {
    const normalized = {
      ...input,
      provider: input.provider.trim(),
      model: input.model.trim(),
    };
    validateAiModel(normalized.type, normalized.provider, normalized.model);
    const row = await this.models.create(normalized);
    return {
      ...row,
      id: String(row.id),
      createdAt: row.createdAt.toISOString(),
    };
  }
}
