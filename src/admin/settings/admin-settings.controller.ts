import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AppConfigService } from "../../domain/config/app-config.service";
import {
  GenerationSettings,
  GenerationSettingsService,
  settingsChangeEntries,
} from "../../domain/settings/generation-settings.service";
import { startOfKstDay } from "../../worker/generation-worker.service";
import { AdminJwtGuard, AdminRequest } from "../auth/admin-jwt.guard";
import { TestGenerationSettingsDto } from "./dto/test-generation-settings.dto";
import { SettingsAuditRepository } from "./settings-audit.repository";
import { UpdateGenerationSettingsDto } from "./dto/update-generation-settings.dto";

// 생성 프로바이더 설정 조회/저장. API 키 원문은 절대 응답에 싣지 않는다 —
// 저장 여부 + 마지막 4자리만 노출한다.
@UseGuards(AdminJwtGuard)
@Controller("api/admin/v1/settings")
export class AdminSettingsController {
  constructor(
    private readonly settings: GenerationSettingsService,
    private readonly audit: SettingsAuditRepository,
    private readonly config: AppConfigService,
  ) {}

  @Get("generation")
  async getGenerationSettings() {
    return this.buildView(await this.settings.getSettings());
  }

  // 저장 전 연결 검증 — 폼 입력을 실효 설정 위에 덮어 실제 호출. 읽기 전용.
  @Post("generation/test")
  testGenerationSettings(@Body() body: TestGenerationSettingsDto) {
    return this.settings.testConnection(body);
  }

  // 설정 변경 감사 이력 (console_logs) — 최근 것부터.
  @Get("generation/changes")
  async listGenerationSettingChanges() {
    return { items: await this.audit.listRecentChanges() };
  }

  @Put("generation")
  async updateGenerationSettings(
    @Body() body: UpdateGenerationSettingsDto,
    @Req() request: AdminRequest,
  ) {
    const before = await this.settings.getSettings();
    // 토글은 API에서 boolean, 저장은 문자열이다. 감사 로그도 이 정규화된
    // update를 그대로 봐야 "무엇이 바뀌었는지"가 저장값과 일치한다.
    const update = {
      ...("falApiKey" in body ? { falApiKey: body.falApiKey ?? null } : {}),
      ...("falImageModel" in body
        ? { falImageModel: body.falImageModel ?? null }
        : {}),
      ...("falImageT2iModel" in body
        ? { falImageT2iModel: body.falImageT2iModel ?? null }
        : {}),
      ...("llmApiUrl" in body ? { llmApiUrl: body.llmApiUrl ?? null } : {}),
      ...("llmApiKey" in body ? { llmApiKey: body.llmApiKey ?? null } : {}),
      ...("llmModel" in body ? { llmModel: body.llmModel ?? null } : {}),
      ...("agentLlmApiUrl" in body
        ? { agentLlmApiUrl: body.agentLlmApiUrl ?? null }
        : {}),
      ...("agentLlmApiKey" in body
        ? { agentLlmApiKey: body.agentLlmApiKey ?? null }
        : {}),
      ...("agentLlmModel" in body
        ? { agentLlmModel: body.agentLlmModel ?? null }
        : {}),
      ...("agentEmbeddingModel" in body
        ? { agentEmbeddingModel: body.agentEmbeddingModel ?? null }
        : {}),
      ...("evaluatorLlmApiUrl" in body
        ? { evaluatorLlmApiUrl: body.evaluatorLlmApiUrl ?? null }
        : {}),
      ...("evaluatorLlmApiKey" in body
        ? { evaluatorLlmApiKey: body.evaluatorLlmApiKey ?? null }
        : {}),
      ...("evaluatorLlmModel" in body
        ? { evaluatorLlmModel: body.evaluatorLlmModel ?? null }
        : {}),
      ...("workerEnabled" in body
        ? { workerEnabled: toStoredFlag(body.workerEnabled) }
        : {}),
      ...("evaluationWorkerEnabled" in body
        ? {
            evaluationWorkerEnabled: toStoredFlag(body.evaluationWorkerEnabled),
          }
        : {}),
      ...("aspectRatioFeed" in body
        ? { aspectRatioFeed: body.aspectRatioFeed ?? null }
        : {}),
      ...("aspectRatioStory" in body
        ? { aspectRatioStory: body.aspectRatioStory ?? null }
        : {}),
      ...("aspectRatioReel" in body
        ? { aspectRatioReel: body.aspectRatioReel ?? null }
        : {}),
    };
    const saved = await this.settings.updateSettings(update);

    // 감사 로그 — 실제 달라진 필드만, 키는 last4 요약만 (console_logs).
    const changes = settingsChangeEntries(before, saved, update);
    await this.audit.recordChanges(
      changes.map((change) => ({
        adminId: request.admin?.id ?? null,
        adminEmail: request.admin?.email ?? null,
        actionType: change.actionType,
        target: change.target,
        summary: change.summary,
      })),
    );
    return this.buildView(saved);
  }

  private async buildView(saved: GenerationSettings) {
    const [
      resolved,
      plannerResolved,
      chat,
      evaluator,
      toggles,
      names,
      todaySpend,
      aspectRatios,
    ] = await Promise.all([
      this.settings.resolveProviderSettings(),
      this.settings.resolvePlannerSettings(),
      this.settings.resolveChatSettings(),
      this.settings.resolveEvaluatorSettings(),
      this.settings.resolveWorkerToggles(),
      this.settings.resolveProviderNames(),
      this.audit.sumGenerationCostSince(startOfKstDay()),
      this.settings.resolveAspectRatios(),
    ]);
    const worker = this.config.worker;
    return {
      falApiKey: saved.falApiKey
        ? { set: true, last4: saved.falApiKey.slice(-4) }
        : { set: false },
      falImageModel: saved.falImageModel ?? null,
      falImageT2iModel: saved.falImageT2iModel ?? null,
      llmApiUrl: saved.llmApiUrl ?? null,
      llmApiKey: saved.llmApiKey
        ? { set: true, last4: saved.llmApiKey.slice(-4) }
        : { set: false },
      llmModel: saved.llmModel ?? null,
      // 채팅 LLM — 오버라이드 원본값 + 실효값(상속 반영, 키는 last4만).
      // UI는 실효값을 그대로 보여주고, 채워진 필드만 오버라이드로 저장한다.
      chat: {
        overrides: {
          apiUrl: saved.agentLlmApiUrl ?? null,
          apiKey: saved.agentLlmApiKey
            ? { set: true, last4: saved.agentLlmApiKey.slice(-4) }
            : { set: false },
          model: saved.agentLlmModel ?? null,
          embeddingModel: saved.agentEmbeddingModel ?? null,
        },
        effective: {
          apiUrl: chat.apiUrl ?? null,
          apiKeyLast4: chat.apiKey ? chat.apiKey.slice(-4) : null,
          model: chat.model ?? null,
          embeddingModel: chat.embeddingModel,
          overridden: chat.overridden,
        },
      },
      // 평가 LLM — 채팅 LLM과 같은 구조. env 폴백이 없어 상속 아니면 DB다.
      evaluator: {
        overrides: {
          apiUrl: saved.evaluatorLlmApiUrl ?? null,
          apiKey: saved.evaluatorLlmApiKey
            ? { set: true, last4: saved.evaluatorLlmApiKey.slice(-4) }
            : { set: false },
          model: saved.evaluatorLlmModel ?? null,
        },
        effective: {
          apiUrl: evaluator.apiUrl ?? null,
          apiKeyLast4: evaluator.apiKey ? evaluator.apiKey.slice(-4) : null,
          model: evaluator.model ?? null,
          overridden: evaluator.overridden,
        },
      },
      resolved: {
        t2iProvider: names.t2i,
        editProvider: names.edit,
        plannerProvider: names.planner,
        sources: resolved.sources,
        plannerSources: plannerResolved.sources,
      },
      // 포맷별 종횡비. overrides는 저장된 원본(미저장은 null), effective는
      // 워커가 실제로 쓰는 값이다. source가 "default"면 아직 저장한 적이 없다.
      aspectRatios: {
        overrides: {
          feed: saved.aspectRatioFeed ?? null,
          story: saved.aspectRatioStory ?? null,
          reel: saved.aspectRatioReel ?? null,
        },
        effective: aspectRatios,
      },
      // 자동 루프 on/off는 DB 소유다. source가 "env"면 아직 UI에서 한 번도
      // 저장하지 않아 env 기본값을 쓰는 중이라는 뜻이다.
      worker: {
        enabled: toggles.generation.enabled,
        enabledSource: toggles.generation.source,
        dailyBudgetUsd: worker.dailyBudgetUsd ?? null,
        jobCostEstimateUsd: worker.jobCostEstimateUsd,
        todaySpendUsd: Number(todaySpend ?? 0),
        evaluation: {
          enabled: toggles.evaluation.enabled,
          enabledSource: toggles.evaluation.source,
        },
      },
    };
  }
}

// 토글 저장 형식 — null은 삭제(env 기본값 복귀), boolean은 "true"/"false".
function toStoredFlag(value: boolean | null | undefined): string | null {
  return value === null || value === undefined ? null : String(value);
}
