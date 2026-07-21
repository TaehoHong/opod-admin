import { Body, Controller, Get, Post, Put, Req, UseGuards } from "@nestjs/common";
import { PrismaService } from "../../domain/database/prisma.service";
import {
  GenerationSettings,
  GenerationSettingsService,
  settingsChangeEntries,
} from "../../domain/settings/generation-settings.service";
import {
  startOfKstDay,
  workerConfigFromEnv,
} from "../../worker/generation-worker.service";
import { AdminJwtGuard, AdminRequest } from "../auth/admin-jwt.guard";
import { TestGenerationSettingsDto } from "./dto/test-generation-settings.dto";
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

  // 저장 전 연결 검증 — 폼 입력을 실효 설정 위에 덮어 실제 호출. 읽기 전용.
  @Post("generation/test")
  testGenerationSettings(@Body() body: TestGenerationSettingsDto) {
    return this.settings.testConnection(body);
  }

  // 설정 변경 감사 이력 (console_logs) — 최근 것부터.
  @Get("generation/changes")
  async listGenerationSettingChanges() {
    const rows = await this.prisma.consoleLog.findMany({
      where: { actionType: { in: ["SETTINGS_SET", "SETTINGS_CLEAR"] } },
      orderBy: { id: "desc" },
      take: 20,
    });
    return {
      items: rows.map((row) => ({
        id: String(row.id),
        adminEmail: row.adminEmail,
        actionType: row.actionType,
        target: row.target,
        summary: row.summary,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  @Put("generation")
  async updateGenerationSettings(
    @Body() body: UpdateGenerationSettingsDto,
    @Req() request: AdminRequest,
  ) {
    const before = await this.settings.getSettings();
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

    // 감사 로그 — 실제 달라진 필드만, 키는 last4 요약만 (console_logs).
    const changes = settingsChangeEntries(before, saved, body);
    if (changes.length > 0) {
      await this.prisma.consoleLog.createMany({
        data: changes.map((change) => ({
          adminId: request.admin?.id ?? null,
          adminEmail: request.admin?.email ?? null,
          actionType: change.actionType,
          target: change.target,
          summary: change.summary,
        })),
      });
    }
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
