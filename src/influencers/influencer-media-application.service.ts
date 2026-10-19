import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import { GenerationSettingsService } from "../settings/generation-settings.service";
import { LlmLogService } from "../llm-logs/llm-log.service";
import { ReferenceEmbeddingClient } from "../shared/ai/reference-embedding";
import { parseBigintId } from "../shared/utils/bigint-id";
import { decodeCursor, pageFromRows } from "../shared/utils/page";
import { InfluencerService } from "./influencer.service";
import { InfluencerMediaService } from "./influencer-media.service";
import {
  InfluencerMediaStore,
  inspectReferenceImage,
} from "./influencer-media-store";
import {
  compositionText,
  normalizedAnalysis,
  RegisterInfluencerMedia,
} from "./influencer-input";
import { InfluencerMediaRow } from "./influencer-media.repository";
@Injectable()
export class InfluencerMediaApplicationService {
  constructor(
    private readonly influencers: InfluencerService,
    private readonly media: InfluencerMediaService,
    private readonly store: InfluencerMediaStore,
    private readonly settings: GenerationSettingsService,
    private readonly logs: LlmLogService,
  ) {}
  async register(input: RegisterInfluencerMedia, bytes: Buffer) {
    const influencer = await this.influencers.require(input.influencerId);
    const image = await inspectReferenceImage(bytes);
    const identity = {
      influencerId: influencer.id,
      postId: input.postId,
      slideIndex: input.slideIndex,
    };
    const existing = await this.media.find(identity);
    if (
      existing &&
      (existing.sha256 !== image.sha256 ||
        existing.assetType !== input.assetType)
    )
      throw new ConflictException("media_identity_conflict");
    const key =
      existing?.mediaKey ??
      `pod/reference-library/instagram/v3/accounts/${influencer.id}/posts/${input.postId}/${String(input.slideIndex).padStart(2, "0")}-${image.sha256}.${image.extension}`;
    await this.store.save(key, bytes, image.sha256, image.contentType);
    const saved = await this.media.register({
      ...identity,
      postUrl: input.postUrl,
      sourceCaption: input.sourceCaption,
      assetType: input.assetType,
      mediaKey: key,
      sha256: image.sha256,
      ...(input.analysis
        ? {
            analysis: normalizedAnalysis(input.analysis.content),
            analysisModel: input.analysis.model.trim(),
            analysisVersion: input.analysis.version.trim(),
          }
        : {}),
    });
    const result = {
      id: String(saved.row.id),
      created: saved.created,
      sourceCaption: saved.row.sourceCaption,
      mediaKey: saved.row.mediaKey,
      sha256: saved.row.sha256,
      analysisStatus: saved.row.analysis ? "saved" : "missing",
    };
    if (!input.analysis)
      return {
        ...result,
        embedding: {
          status: "not_requested",
          model: saved.row.embeddingModel,
          error: null,
        },
      };
    return { ...result, embedding: await this.embed(saved.row) };
  }
  private async embed(row: InfluencerMediaRow) {
    const resolved = await this.settings.resolveChatSettings();
    const model = resolved.embeddingModel?.trim();
    const apiUrl = resolved.embeddingApiUrl?.trim();
    if (!model || !apiUrl)
      return {
        status: "failed",
        model: null,
        error: {
          code: "embedding_not_configured",
          message: "서버 임베딩 모델이 설정되지 않았습니다.",
        },
      };
    if (row.embedding && row.embeddingModel === model)
      return { status: "ready", model, error: null };
    const current = await this.media.prepareEmbedding(row, model);
    if (current.embedding && current.embeddingModel === model)
      return { status: "ready", model, error: null };
    try {
      const client = new ReferenceEmbeddingClient(
        { apiUrl, apiKey: resolved.embeddingApiKey, model },
        this.logs,
      );
      const [vector] = await client.embed([compositionText(row.analysis!)], {
        metadata: {
          purpose: "influencer_media_embedding",
          influencerMediaId: String(row.id),
          analysisVersion: row.analysisVersion,
        },
      });
      await this.media.saveEmbedding(row, model, vector);
      return { status: "ready", model, error: null };
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      return {
        status: "failed",
        model,
        error: {
          code: "embedding_failed",
          message:
            "분석은 저장됐지만 임베딩 생성에 실패했습니다. 같은 요청으로 재시도할 수 있습니다.",
        },
      };
    }
  }
  async list(query: {
    influencerId?: string;
    postId?: string;
    slideIndex?: string;
    work?: string;
    cursor?: string;
    limit?: string;
  }) {
    const limit = query.limit === undefined ? 30 : Number(query.limit);
    const slideIndex =
      query.slideIndex === undefined ? undefined : Number(query.slideIndex);
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      (slideIndex !== undefined &&
        (!Number.isInteger(slideIndex) ||
          slideIndex < 1 ||
          slideIndex > 100)) ||
      (query.work && !["analysis", "embedding"].includes(query.work))
    )
      throw new BadRequestException("Invalid media filters");
    const after = decodeCursor(query.cursor);
    const model =
      query.work === "embedding"
        ? (await this.settings.resolveChatSettings()).embeddingModel?.trim()
        : undefined;
    const rows = await this.media.list({
      influencerId: query.influencerId
        ? parseBigintId(query.influencerId, "Invalid influencer ID")
        : undefined,
      postId: query.postId,
      slideIndex,
      work: query.work,
      after: after ? parseBigintId(after, "Invalid cursor") : undefined,
      limit: limit + 1,
      model,
    });
    const page = pageFromRows(
      rows.map((row) => ({
        postId: row.postId,
        postUrl: row.postUrl,
        sourceCaption: row.sourceCaption,
        slideIndex: row.slideIndex,
        assetType: row.assetType,
        mediaKey: row.mediaKey,
        sha256: row.sha256,
        embeddingModel: row.embeddingModel,
        createdAt: row.createdAt,
        id: String(row.id),
        influencerId: String(row.influencerId),
        analysis: row.analysis
          ? {
              model: row.analysisModel,
              version: row.analysisVersion,
              content: row.analysis,
            }
          : null,
      })),
      limit,
    );
    return {
      items: await Promise.all(
        page.items.map(async (row) => ({
          ...row,
          imageUrl: await this.store.url(row.mediaKey),
        })),
      ),
      nextCursor: page.nextCursor ?? null,
    };
  }
}
