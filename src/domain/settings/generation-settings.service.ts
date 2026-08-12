import { Injectable, Optional } from "@nestjs/common";
import { LLM_LOG_TYPE, LlmLogService } from "../llm-logs/llm-log.service";
import { GenerationSettingsRepository } from "./generation-settings.repository";
import {
  PlannerProviderSettings,
  contentFromChatCompletion,
  resolveContentPlanner,
} from "../../worker/content-planner";
import {
  GenerationProviderSettings,
  ImageGenerationConfigError,
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
  // 평가 워커 LLM — 미설정 필드는 planner.*를 상속 (chat과 같은 규칙).
  // 플래너와 다른 모델을 지정해 자기 평가 편향을 줄일 수 있다.
  evaluatorLlmApiUrl: "evaluator.llmApiUrl",
  evaluatorLlmApiKey: "evaluator.llmApiKey",
  evaluatorLlmModel: "evaluator.llmModel",
  // 워커 자동 루프 on/off. 워커가 tick마다 재해석하므로 프로세스 재시작 없이
  // 설정 화면에서 켜고 끈다. worker.enabled는 생성 워커와 draft 워커를 함께
  // 게이트한다 (env WORKER_ENABLED와 같은 범위).
  workerEnabled: "worker.enabled",
  evaluationWorkerEnabled: "evaluator.workerEnabled",
  pipelineV3Enabled: "pipeline.v3Enabled",
  // 생성 이미지 종횡비. 게시 포맷마다 다르므로 캐릭터가 아니라 여기서 정한다 —
  // 비주얼 프로필에 넣으면 같은 캐릭터의 피드와 스토리가 같은 비율로 나온다.
  // 미설정이면 아래 DEFAULT_ASPECT_RATIOS를 쓴다 (env 폴백 없음).
  aspectRatioFeed: "generation.aspectRatioFeed",
  aspectRatioStory: "generation.aspectRatioStory",
  aspectRatioReel: "generation.aspectRatioReel",
} as const;

// 게시 포맷. 초안의 draftType·contentType에서 유도한다.
export type AspectRatioFormat = "feed" | "story" | "reel";

// 설정하지 않았을 때 쓰는 값. 피드는 인스타그램 세로 표준, 스토리·릴은 전체화면.
export const DEFAULT_ASPECT_RATIOS: Record<AspectRatioFormat, string> = {
  feed: "4:5",
  story: "9:16",
  reel: "9:16",
};

// "가로:세로" 형태만 허용한다. 프로바이더에 그대로 전달되는 값이라 형식이
// 어긋나면 생성 요청 자체가 422로 죽는다.
export const ASPECT_RATIO_PATTERN = /^\d{1,2}:\d{1,2}$/;

export type ResolvedAspectRatio = {
  value: string;
  // "default" = 저장된 값이 없어 코드 기본값을 쓰는 중.
  source: "db" | "default";
};

export type ResolvedAspectRatios = Record<
  AspectRatioFormat,
  ResolvedAspectRatio
>;

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
  target: "image" | "planner" | "chat" | "evaluator";
  falApiKey?: string;
  llmApiUrl?: string;
  llmApiKey?: string;
  llmModel?: string;
};

export type ConnectionTestResult = { ok: boolean; message: string };

const CONNECTION_TEST_TIMEOUT_MS = 10_000;

// 연결 테스트 핑에서 쓰는 토큰 상한 파라미터 이름 (프로바이더마다 다르다).
type TokenLimitParam = "max_tokens" | "max_completion_tokens";

// env 폴백이 있는 필드만 여기 둔다. 빠진 필드는 DB 전용이다.
const ENV_KEYS: Partial<Record<GenerationSettingField, string>> = {
  falApiKey: "FAL_API_KEY",
  falImageModel: "FAL_IMAGE_MODEL",
  falImageT2iModel: "FAL_IMAGE_T2I_MODEL",
  llmApiUrl: "LLM_API_URL",
  llmApiKey: "LLM_API_KEY",
  llmModel: "LLM_MODEL",
  // agent.*와 evaluator.*는 env 폴백이 없다 — DB 아니면 planner 상속이다.
  // 평가 LLM 키를 .env로 관리하지 않기로 했다(2026-08-10).
  // 워커 토글만 기존 배포 호환을 위해 env를 초기 기본값으로 남긴다.
  workerEnabled: "WORKER_ENABLED",
  evaluationWorkerEnabled: "EVALUATION_WORKER_ENABLED",
  pipelineV3Enabled: "POST_PIPELINE_V3_ENABLED",
};

const CHAT_DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

// 평가 LLM 실효 설정 — evaluator.* 오버라이드(DB 전용), 없으면 planner 상속.
export type ResolvedEvaluatorSettings = PlannerProviderSettings & {
  overridden: { apiUrl: boolean; apiKey: boolean; model: boolean };
};

// 워커 자동 루프 상태. source는 화면이 "env 기본값을 쓰는 중"을 알리는 데 쓴다.
export type ResolvedWorkerToggle = { enabled: boolean; source: Source };

export type ResolvedWorkerToggles = {
  generation: ResolvedWorkerToggle;
  evaluation: ResolvedWorkerToggle;
};

export type ResolvedPipelineV3 = ResolvedWorkerToggle;

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
  constructor(
    private readonly repository: GenerationSettingsRepository,
    @Optional() private readonly llmLogs?: LlmLogService,
  ) {}

  async getSettings(): Promise<GenerationSettings> {
    const rows = await this.repository.findByKeys(
      Object.values(GENERATION_SETTING_KEYS),
    );
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
        await this.repository.deleteByKey(key);
        continue;
      }
      await this.repository.upsertValue(key, value);
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

  // 평가 워커 LLM 실효 설정 — 필드 단위로 evaluator.*(DB 전용) 오버라이드,
  // 미설정은 planner 실효값 상속 (resolveChatSettings와 같은 규칙).
  async resolveEvaluatorSettings(
    env: SettingsEnv = process.env,
  ): Promise<ResolvedEvaluatorSettings> {
    const db = await this.getSettings();
    const planner = await this.resolvePlannerSettings(env);
    return {
      apiUrl: db.evaluatorLlmApiUrl ?? planner.apiUrl,
      apiKey: db.evaluatorLlmApiKey ?? planner.apiKey,
      model: db.evaluatorLlmModel ?? planner.model,
      overridden: {
        apiUrl: db.evaluatorLlmApiUrl !== undefined,
        apiKey: db.evaluatorLlmApiKey !== undefined,
        model: db.evaluatorLlmModel !== undefined,
      },
    };
  }

  // 워커 자동 루프 on/off — 워커가 tick마다 호출한다. DB에 값이 없을 때만
  // env를 초기 기본값으로 쓰므로, UI에서 한 번 저장하면 env는 무시된다.
  async resolveWorkerToggles(
    env: SettingsEnv = process.env,
  ): Promise<ResolvedWorkerToggles> {
    const db = await this.getSettings();
    return {
      generation: toggle(pick(db, env, "workerEnabled")),
      evaluation: toggle(pick(db, env, "evaluationWorkerEnabled")),
    };
  }

  async resolvePipelineV3(
    env: SettingsEnv = process.env,
  ): Promise<ResolvedPipelineV3> {
    const db = await this.getSettings();
    return toggle(pick(db, env, "pipelineV3Enabled"));
  }

  async testPipelineV3Capability(
    env: SettingsEnv = process.env,
    fetchFn: typeof fetch = fetch,
  ): Promise<ConnectionTestResult> {
    try {
      const resolved = await this.resolvePlannerSettings(env);
      const apiUrl = resolved.apiUrl?.trim();
      const apiKey = resolved.apiKey?.trim();
      const model = resolved.model?.trim();
      if (!apiUrl || !apiKey || !model) {
        return {
          ok: false,
          message: "V3에는 기획 LLM URL·키·모델이 모두 필요합니다",
        };
      }
      const probe = async (tokenLimitParam: TokenLimitParam) => {
        const requestJson = {
          model,
          messages: [
            {
              role: "user",
              content: 'Return exactly {"ok":true}.',
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "opod_pipeline_v3_probe",
              strict: true,
              schema: {
                type: "object",
                properties: { ok: { type: "boolean", const: true } },
                required: ["ok"],
                additionalProperties: false,
              },
            },
          },
          [tokenLimitParam]: 64,
        };
        const execute = () =>
          fetchFn(apiUrl, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(requestJson),
            signal: AbortSignal.timeout(CONNECTION_TEST_TIMEOUT_MS),
          });
        const response = this.llmLogs
          ? await this.llmLogs.runJsonFetch({
              type: LLM_LOG_TYPE.connectionTest,
              provider: "openai-compatible",
              model,
              endpoint: apiUrl,
              requestJson,
              context: { metadata: { target: "pipeline-v3" } },
              execute,
            })
          : await execute();
        const detail = response.ok
          ? ""
          : (await response.text().catch(() => "")).slice(0, 200);
        return { response, detail };
      };
      let { response, detail } = await probe("max_tokens");
      if (response.status === 400 && detail.includes("max_completion_tokens")) {
        ({ response, detail } = await probe("max_completion_tokens"));
      }
      if (!response.ok) {
        return {
          ok: false,
          message: `V3 strict JSON schema 미지원 (${response.status})${
            detail ? `: ${detail}` : ""
          }`,
        };
      }
      const content = contentFromChatCompletion(await response.json());
      let parsed: unknown;
      try {
        parsed = content ? JSON.parse(content) : null;
      } catch {
        parsed = null;
      }
      if (!isStrictProbeResult(parsed)) {
        return {
          ok: false,
          message: "V3 strict JSON schema 응답이 계약과 일치하지 않습니다",
        };
      }
      return {
        ok: true,
        message: `V3 strict JSON schema 지원 확인 (${model})`,
      };
    } catch (error) {
      return {
        ok: false,
        message: `V3 capability 확인 실패: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  // 포맷별 실효 종횡비. 워커가 잡마다 호출하므로 설정 변경이 재시작 없이 먹는다.
  async resolveAspectRatios(): Promise<ResolvedAspectRatios> {
    const db = await this.getSettings();
    const resolve = (
      field: "aspectRatioFeed" | "aspectRatioStory" | "aspectRatioReel",
      format: AspectRatioFormat,
    ): ResolvedAspectRatio => {
      const stored = db[field]?.trim();
      // 저장돼 있어도 형식이 깨졌으면 기본값으로 떨어진다. 잘못된 값을 그대로
      // 보내 생성 전체를 실패시키는 것보다 낫다.
      return stored && ASPECT_RATIO_PATTERN.test(stored)
        ? { value: stored, source: "db" }
        : { value: DEFAULT_ASPECT_RATIOS[format], source: "default" };
    };
    return {
      feed: resolve("aspectRatioFeed", "feed"),
      story: resolve("aspectRatioStory", "story"),
      reel: resolve("aspectRatioReel", "reel"),
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
        const endpoint =
          "https://queue.fal.run/fal-ai/nano-banana/requests/00000000-0000-0000-0000-000000000000/status";
        const execute = () =>
          fetchFn(endpoint, {
            headers: { authorization: `Key ${apiKey}` },
            signal: AbortSignal.timeout(CONNECTION_TEST_TIMEOUT_MS),
          });
        const response = this.llmLogs
          ? await this.llmLogs.runJsonFetch({
              type: LLM_LOG_TYPE.connectionTest,
              provider: "fal",
              model: "fal-ai/nano-banana",
              endpoint,
              requestJson: {
                request_id: "00000000-0000-0000-0000-000000000000",
                operation: "status",
              },
              context: { metadata: { target: "image" } },
              execute,
              isSuccessful: (response) =>
                response.status !== 401 && response.status !== 403,
            })
          : await execute();
        if (response.status === 401 || response.status === 403) {
          return {
            ok: false,
            message: `fal 키 인증 실패 (${response.status})`,
          };
        }
        return { ok: true, message: "fal 키 인증 확인" };
      }

      const resolved =
        input.target === "chat"
          ? await this.resolveChatSettings(env)
          : input.target === "evaluator"
            ? await this.resolveEvaluatorSettings(env)
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
      const ping = async (tokenLimitParam: TokenLimitParam, tokenLimit = 1) => {
        const requestJson = {
          model,
          messages: [{ role: "user", content: "ping" }],
          [tokenLimitParam]: tokenLimit,
        };
        const execute = () =>
          fetchFn(apiUrl, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(requestJson),
            signal: AbortSignal.timeout(CONNECTION_TEST_TIMEOUT_MS),
          });
        const response = this.llmLogs
          ? await this.llmLogs.runJsonFetch({
              type: LLM_LOG_TYPE.connectionTest,
              provider: "openai-compatible",
              model,
              endpoint: apiUrl,
              requestJson,
              context: { metadata: { target: input.target } },
              execute,
            })
          : await execute();
        const detail = response.ok
          ? ""
          : (await response.text().catch(() => "")).slice(0, 200);
        return { response, detail };
      };

      // 최신 OpenAI 모델(o-시리즈·gpt-5 등)은 max_tokens를 거부하고
      // max_completion_tokens를 요구한다. 반대로 다수의 OpenAI 호환
      // 서버는 max_completion_tokens를 모르므로, 호환성이 넓은 쪽을
      // 먼저 보내고 그 파라미터가 거부될 때만 새 이름으로 재시도한다.
      let tokenLimitParam: TokenLimitParam = "max_tokens";
      let { response, detail } = await ping(tokenLimitParam);
      if (response.status === 400 && detail.includes("max_completion_tokens")) {
        tokenLimitParam = "max_completion_tokens";
        ({ response, detail } = await ping(tokenLimitParam));
      }
      if (
        response.status === 400 &&
        detail.includes("model output limit was reached")
      ) {
        ({ response, detail } = await ping(tokenLimitParam, 256));
      }
      if (!response.ok) {
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
  // 이미지 설정이 없으면 생성은 실패하지만 설정 화면 자체는 떠야 하므로
  // 여기서는 예외 대신 null을 돌려준다 (UI가 "—"로 표시한다).
  async resolveProviderNames(
    env: SettingsEnv = process.env,
  ): Promise<{ t2i: string | null; edit: string | null; planner: string }> {
    const [resolved, plannerResolved] = await Promise.all([
      this.resolveProviderSettings(env),
      this.resolvePlannerSettings(env),
    ]);
    const planner = resolveContentPlanner(plannerResolved).name;
    try {
      const providers = resolveImageGenerationProviders(resolved);
      return {
        t2i: providers.t2i.name,
        edit: providers.edit.name,
        planner,
      };
    } catch (error) {
      if (error instanceof ImageGenerationConfigError) {
        return { t2i: null, edit: null, planner };
      }
      throw error;
    }
  }
}

// 감사 로그용 diff — 실제로 달라진 필드만 { key, changeType, summary }로.
// 키 필드는 last4 요약만 남긴다 (원문 금지).
export function settingsChangeEntries(
  before: GenerationSettings,
  after: GenerationSettings,
  update: GenerationSettingsUpdate,
): {
  target: string;
  actionType: "SETTINGS_SET" | "SETTINGS_CLEAR";
  summary: string;
}[] {
  const SECRET_FIELDS: GenerationSettingField[] = [
    "falApiKey",
    "llmApiKey",
    "agentLlmApiKey",
    "evaluatorLlmApiKey",
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

// 저장 형식은 문자열이므로 app-config의 env 파서와 같은 규칙으로 읽는다.
// 값이 없으면(none) 꺼짐 — 새 배포가 아무것도 자동으로 돌리지 않는 쪽이 안전하다.
function toggle(picked: {
  value: string | undefined;
  source: Source;
}): ResolvedWorkerToggle {
  return {
    enabled: picked.value === "true" || picked.value === "1",
    source: picked.source,
  };
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
  const envKey = ENV_KEYS[field];
  const envValue = envKey ? env[envKey]?.trim() : undefined;
  if (envValue) {
    return { value: envValue, source: "env" };
  }
  return { value: undefined, source: "none" };
}

function isStrictProbeResult(value: unknown): value is { ok: true } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    (value as { ok?: unknown }).ok === true
  );
}
