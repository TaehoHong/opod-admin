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
  // 캐릭터 채팅 LLM (opod-agent가 읽음) — 미설정 필드는 planner.*를 상속.
  agentLlmApiUrl: "agent.llmApiUrl",
  agentLlmApiKey: "agent.llmApiKey",
  agentLlmModel: "agent.llmModel",
  agentEmbeddingModel: "agent.embeddingModel",
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

// 연결 테스트 — 폼의 미저장 입력을 실효 설정 위에 덮어 검증한다.
export type ConnectionTestInput = {
  target: "image" | "planner" | "chat";
  falApiKey?: string;
  llmApiUrl?: string;
  llmApiKey?: string;
  llmModel?: string;
};

export type ConnectionTestResult = { ok: boolean; message: string };

const CONNECTION_TEST_TIMEOUT_MS = 10_000;

const ENV_KEYS: Record<GenerationSettingField, string> = {
  falApiKey: "FAL_API_KEY",
  falImageModel: "FAL_IMAGE_MODEL",
  falImageT2iModel: "FAL_IMAGE_T2I_MODEL",
  llmApiUrl: "LLM_API_URL",
  llmApiKey: "LLM_API_KEY",
  llmModel: "LLM_MODEL",
  // agent.*는 admin 프로세스 env에 대응물이 없다 — DB 아니면 상속.
  agentLlmApiUrl: "AGENT_LLM_API_URL",
  agentLlmApiKey: "AGENT_LLM_API_KEY",
  agentLlmModel: "AGENT_LLM_MODEL",
  agentEmbeddingModel: "AGENT_EMBEDDING_MODEL",
};

const CHAT_DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

// 채팅 LLM 실효 설정 — agent.* 오버라이드(DB) 우선, 없으면 planner 상속.
export type ResolvedChatSettings = {
  apiUrl?: string;
  apiKey?: string;
  model?: string;
  embeddingModel: string;
  overridden: {
    apiUrl: boolean;
    apiKey: boolean;
    model: boolean;
    embeddingModel: boolean;
  };
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

  // 채팅 LLM 실효 설정 — 필드 단위로 agent.* 오버라이드, 미설정은 planner
  // 실효값(DB > env) 상속. opod-agent도 같은 규칙으로 읽는다.
  async resolveChatSettings(
    env: SettingsEnv = process.env,
  ): Promise<ResolvedChatSettings> {
    const db = await this.getSettings();
    const planner = await this.resolvePlannerSettings(env);
    return {
      apiUrl: db.agentLlmApiUrl ?? planner.apiUrl,
      apiKey: db.agentLlmApiKey ?? planner.apiKey,
      model: db.agentLlmModel ?? planner.model,
      embeddingModel: db.agentEmbeddingModel ?? CHAT_DEFAULT_EMBEDDING_MODEL,
      overridden: {
        apiUrl: db.agentLlmApiUrl !== undefined,
        apiKey: db.agentLlmApiKey !== undefined,
        model: db.agentLlmModel !== undefined,
        embeddingModel: db.agentEmbeddingModel !== undefined,
      },
    };
  }

  // 저장 전 연결 검증 — 폼 입력값을 현재 실효 설정(DB > env) 위에 덮어
  // "저장하면 적용될 조합"으로 프로바이더를 실제 호출해본다. 읽기 전용.
  async testConnection(
    input: ConnectionTestInput,
    env: SettingsEnv = process.env,
    fetchFn: typeof fetch = fetch,
  ): Promise<ConnectionTestResult> {
    try {
      if (input.target === "image") {
        const resolved = await this.resolveProviderSettings(env);
        const apiKey = input.falApiKey?.trim() || resolved.apiKey;
        if (!apiKey) {
          return { ok: false, message: "적용될 fal API 키가 없습니다" };
        }
        // 잡 제출은 과금되므로, 존재하지 않는 요청의 상태 조회로 인증만
        // 판별한다: 401/403 = 키 무효, 404 등 = 키 유효.
        const response = await fetchFn(
          "https://queue.fal.run/fal-ai/nano-banana/requests/00000000-0000-0000-0000-000000000000/status",
          {
            headers: { authorization: `Key ${apiKey}` },
            signal: AbortSignal.timeout(CONNECTION_TEST_TIMEOUT_MS),
          },
        );
        if (response.status === 401 || response.status === 403) {
          return { ok: false, message: `fal 키 인증 실패 (${response.status})` };
        }
        return { ok: true, message: "fal 키 인증 확인" };
      }

      const resolved =
        input.target === "chat"
          ? await this.resolveChatSettings(env)
          : await this.resolvePlannerSettings(env);
      const apiUrl = input.llmApiUrl?.trim() || resolved.apiUrl;
      const apiKey = input.llmApiKey?.trim() || resolved.apiKey;
      const model = input.llmModel?.trim() || resolved.model;
      if (!apiUrl || !apiKey || !model) {
        return {
          ok: false,
          message: "URL·키·모델이 모두 있어야 테스트할 수 있습니다",
        };
      }
      // 최소 완성 호출 한 번으로 URL·키·모델을 함께 검증한다.
      const response = await fetchFn(apiUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(CONNECTION_TEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 200);
        return {
          ok: false,
          message: `LLM 응답 ${response.status}${detail ? `: ${detail}` : ""}`,
        };
      }
      return { ok: true, message: `LLM 연결 확인 (${model})` };
    } catch (error) {
      return {
        ok: false,
        message: `연결 실패: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
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

// 감사 로그용 diff — 실제로 달라진 필드만 { key, changeType, summary }로.
// 키 필드는 last4 요약만 남긴다 (원문 금지).
export function settingsChangeEntries(
  before: GenerationSettings,
  after: GenerationSettings,
  update: GenerationSettingsUpdate,
): { target: string; actionType: "SETTINGS_SET" | "SETTINGS_CLEAR"; summary: string }[] {
  const SECRET_FIELDS: GenerationSettingField[] = [
    "falApiKey",
    "llmApiKey",
    "agentLlmApiKey",
  ];
  const entries: {
    target: string;
    actionType: "SETTINGS_SET" | "SETTINGS_CLEAR";
    summary: string;
  }[] = [];
  for (const field of Object.keys(
    GENERATION_SETTING_KEYS,
  ) as GenerationSettingField[]) {
    if (!(field in update)) continue;
    const prev = before[field];
    const next = after[field];
    if (prev === next) continue;
    const target = GENERATION_SETTING_KEYS[field];
    if (next === undefined) {
      entries.push({
        target,
        actionType: "SETTINGS_CLEAR",
        summary: "삭제 (env 폴백 복귀)",
      });
      continue;
    }
    entries.push({
      target,
      actionType: "SETTINGS_SET",
      summary: SECRET_FIELDS.includes(field) ? `····${next.slice(-4)}` : next,
    });
  }
  return entries;
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
