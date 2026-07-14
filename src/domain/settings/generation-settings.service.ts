import { Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import {
  PlannerProviderSettings,
  resolveContentPlanner,
} from "../../worker/content-planner";
import {
  GenerationProviderSettings,
  resolveImageGenerationProviders,
} from "../../worker/image-generation.provider";

// admin_settings 키. 프로바이더 설정이 늘면 네임스페이스만 추가한다.
// generation.* = 이미지 생성(fal), planner.* = 기획 LLM(OpenAI-compatible).
export const GENERATION_SETTING_KEYS = {
  falApiKey: "generation.falApiKey",
  falImageModel: "generation.falImageModel",
  falImageT2iModel: "generation.falImageT2iModel",
  llmApiUrl: "planner.llmApiUrl",
  llmApiKey: "planner.llmApiKey",
  llmModel: "planner.llmModel",
} as const;

type GenerationSettingField = keyof typeof GENERATION_SETTING_KEYS;

type Source = "db" | "env" | "none";

// DB(admin_settings)에 저장된 값만. 미설정 필드는 undefined.
export type GenerationSettings = Partial<
  Record<GenerationSettingField, string>
>;

// undefined = 유지, null·빈 문자열 = 삭제(env 폴백으로 복귀), 값 = 저장.
export type GenerationSettingsUpdate = Partial<
  Record<GenerationSettingField, string | null>
>;

export type ResolvedProviderSettings = GenerationProviderSettings & {
  sources: {
    apiKey: Source;
    editModel: Source;
    t2iModel: Source;
  };
};

export type ResolvedPlannerSettings = PlannerProviderSettings & {
  sources: {
    apiUrl: Source;
    apiKey: Source;
    model: Source;
  };
};

type SettingsEnv = Record<string, string | undefined>;

const ENV_KEYS: Record<GenerationSettingField, string> = {
  falApiKey: "FAL_API_KEY",
  falImageModel: "FAL_IMAGE_MODEL",
  falImageT2iModel: "FAL_IMAGE_T2I_MODEL",
  llmApiUrl: "LLM_API_URL",
  llmApiKey: "LLM_API_KEY",
  llmModel: "LLM_MODEL",
};

@Injectable()
export class GenerationSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings(): Promise<GenerationSettings> {
    const rows = await this.prisma.adminSetting.findMany({
      where: { key: { in: Object.values(GENERATION_SETTING_KEYS) } },
      select: { key: true, value: true },
    });
    const byKey = new Map(rows.map((row) => [row.key, row.value]));
    const settings: GenerationSettings = {};
    for (const field of Object.keys(
      GENERATION_SETTING_KEYS,
    ) as GenerationSettingField[]) {
      const value = byKey.get(GENERATION_SETTING_KEYS[field]);
      if (value !== undefined && value !== "") {
        settings[field] = value;
      }
    }
    return settings;
  }

  async updateSettings(
    update: GenerationSettingsUpdate,
  ): Promise<GenerationSettings> {
    for (const field of Object.keys(
      GENERATION_SETTING_KEYS,
    ) as GenerationSettingField[]) {
      if (!(field in update)) {
        continue; // 필드 누락 = 유지
      }
      const key = GENERATION_SETTING_KEYS[field];
      const raw = update[field];
      const value = typeof raw === "string" ? raw.trim() : "";
      if (!value) {
        await this.prisma.adminSetting.deleteMany({ where: { key } });
        continue;
      }
      await this.prisma.adminSetting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      });
    }
    return this.getSettings();
  }

  // DB 설정이 env보다 우선한다. env는 로컬 개발/부트스트랩 폴백.
  async resolveProviderSettings(
    env: SettingsEnv = process.env,
  ): Promise<ResolvedProviderSettings> {
    const db = await this.getSettings();
    const apiKey = pick(db, env, "falApiKey");
    const editModel = pick(db, env, "falImageModel");
    const t2iModel = pick(db, env, "falImageT2iModel");
    return {
      apiKey: apiKey.value,
      editModel: editModel.value,
      t2iModel: t2iModel.value,
      sources: {
        apiKey: apiKey.source,
        editModel: editModel.source,
        t2iModel: t2iModel.source,
      },
    };
  }

  // 기획 LLM 설정 — 동일한 DB > env 우선순위.
  async resolvePlannerSettings(
    env: SettingsEnv = process.env,
  ): Promise<ResolvedPlannerSettings> {
    const db = await this.getSettings();
    const apiUrl = pick(db, env, "llmApiUrl");
    const apiKey = pick(db, env, "llmApiKey");
    const model = pick(db, env, "llmModel");
    return {
      apiUrl: apiUrl.value,
      apiKey: apiKey.value,
      model: model.value,
      sources: {
        apiUrl: apiUrl.source,
        apiKey: apiKey.source,
        model: model.source,
      },
    };
  }

  // 현재 설정으로 실제 라우팅될 프로바이더/플래너 이름 (UI 상태 표시용).
  async resolveProviderNames(
    env: SettingsEnv = process.env,
  ): Promise<{ t2i: string; edit: string; planner: string }> {
    const [resolved, plannerResolved] = await Promise.all([
      this.resolveProviderSettings(env),
      this.resolvePlannerSettings(env),
    ]);
    const providers = resolveImageGenerationProviders(resolved);
    return {
      t2i: providers.t2i.name,
      edit: providers.edit.name,
      planner: resolveContentPlanner(plannerResolved).name,
    };
  }
}

function pick(
  db: GenerationSettings,
  env: SettingsEnv,
  field: GenerationSettingField,
): { value: string | undefined; source: Source } {
  const dbValue = db[field]?.trim();
  if (dbValue) {
    return { value: dbValue, source: "db" };
  }
  const envValue = env[ENV_KEYS[field]]?.trim();
  if (envValue) {
    return { value: envValue, source: "env" };
  }
  return { value: undefined, source: "none" };
}
