import { Body, Controller, Get, Put, UseGuards } from "@nestjs/common";
import { PrismaService } from "../../domain/database/prisma.service";
import {
  GenerationSettings,
  GenerationSettingsService,
} from "../../domain/settings/generation-settings.service";
import {
  startOfKstDay,
  workerConfigFromEnv,
} from "../../worker/generation-worker.service";
import { AdminJwtGuard } from "../auth/admin-jwt.guard";
import { UpdateGenerationSettingsDto } from "./dto/update-generation-settings.dto";

// 생성 프로바이더 설정 조회/저장. API 키 원문은 절대 응답에 싣지 않는다 —
// 저장 여부 + 마지막 4자리만 노출한다.
@UseGuards(AdminJwtGuard)
@Controller("api/settings")
export class AdminSettingsController {
  constructor(
    private readonly settings: GenerationSettingsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get("generation")
  async getGenerationSettings() {
    return this.buildView(await this.settings.getSettings());
  }

  @Put("generation")
  async updateGenerationSettings(@Body() body: UpdateGenerationSettingsDto) {
    const saved = await this.settings.updateSettings({
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
    });
    return this.buildView(saved);
  }

  private async buildView(saved: GenerationSettings) {
    const [resolved, plannerResolved, names, todaySpend] = await Promise.all([
      this.settings.resolveProviderSettings(),
      this.settings.resolvePlannerSettings(),
      this.settings.resolveProviderNames(),
      this.prisma.generationJob.aggregate({
        _sum: { costUsd: true },
        where: { updatedAt: { gte: startOfKstDay() }, costUsd: { not: null } },
      }),
    ]);
    const worker = workerConfigFromEnv();
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
      resolved: {
        t2iProvider: names.t2i,
        editProvider: names.edit,
        plannerProvider: names.planner,
        sources: resolved.sources,
        plannerSources: plannerResolved.sources,
      },
      worker: {
        enabled: worker.enabled,
        dailyBudgetUsd: worker.dailyBudgetUsd ?? null,
        jobCostEstimateUsd: worker.jobCostEstimateUsd,
        todaySpendUsd: Number(todaySpend._sum.costUsd ?? 0),
      },
    };
  }
}
