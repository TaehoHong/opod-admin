import {
  UNION_ENVELOPE_KEY,
  isRootUnionSchema,
} from "../../prompts/strict-schema";
import {
  LlmLogContext,
  LlmLogService,
  LlmLogType,
} from "../domain/llm-logs/llm-log.service";
import { contentFromChatCompletion } from "./content-planner";

const HTTP_TIMEOUT_MS = 60_000;

export type StrictJsonAgentConfig = {
  apiUrl: string;
  apiKey: string;
  model: string;
};

export type StrictJsonAgentRequest = {
  logType: LlmLogType;
  schemaName: string;
  schema: Record<string, unknown>;
  systemPrompt: string;
  input: unknown;
  userContent?: unknown;
  context?: LlmLogContext;
};

type TokenField = "max_tokens" | "max_completion_tokens";

// 최신 OpenAI 모델(o-시리즈·gpt-5 계열)은 max_tokens를 거부하고
// max_completion_tokens를 요구한다. 반대로 많은 OpenAI 호환 서버는 새 이름을
// 모른다. 어느 쪽인지는 (엔드포인트, 모델) 조합이 정하므로 한 번 알아낸 답을
// 프로세스 안에서 기억한다 — 기억하지 않으면 **모든 호출이 두 번 나간다**
// (첫 호출이 400, 재시도가 200). 이미지가 붙는 호출은 base64를 두 번 올린다.
// 2026-08-16 개발 서버 관측: 7일간 187건 중 36건이 이 낭비였다.
const preferredTokenField = new Map<string, TokenField>();

export function rememberedTokenField(config: {
  apiUrl: string;
  model: string;
}): TokenField {
  return preferredTokenField.get(tokenFieldKey(config)) ?? "max_tokens";
}

function tokenFieldKey(config: { apiUrl: string; model: string }): string {
  return `${config.apiUrl}\u0000${config.model}`;
}

// 테스트·설정 변경 시 초기화용.
export function resetTokenFieldMemory(): void {
  preferredTokenField.clear();
}

// OpenAI-compatible native structured output transport. Agent-specific meaning
// remains in each parser; this owner only handles request/log/response plumbing.
export class StrictJsonAgentClient {
  constructor(
    private readonly config: StrictJsonAgentConfig,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly llmLogs?: LlmLogService,
  ) {}

  async run(
    request: StrictJsonAgentRequest,
  ): Promise<{ value: unknown; producerLogId: string | null }> {
    const execute = async (tokenField: TokenField) => {
      const requestJson = {
        model: this.config.model,
        messages: [
          { role: "system", content: request.systemPrompt },
          {
            role: "user",
            content: request.userContent ?? JSON.stringify(request.input),
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: request.schemaName,
            strict: true,
            schema: request.schema,
          },
        },
        [tokenField]: 8_000,
      };
      const call = () =>
        this.fetchFn(this.config.apiUrl, {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.config.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(requestJson),
          signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
        });
      if (!this.llmLogs) {
        return { response: await call(), producerLogId: null };
      }
      const logged = await this.llmLogs.runJsonFetchWithLog({
        type: request.logType,
        provider: "openai-compatible",
        model: this.config.model,
        endpoint: this.config.apiUrl,
        requestJson,
        context: request.context,
        execute: call,
      });
      return { response: logged.response, producerLogId: logged.logId };
    };

    const first = rememberedTokenField(this.config);
    let result = await execute(first);
    if (!result.response.ok) {
      const detail = await result.response.text().catch(() => "");
      // 프로바이더가 "이 파라미터 대신 저 파라미터"라고 말하면 반대쪽으로 한 번
      // 재시도하고, 그 답을 기억한다. 양방향이어야 한다 — 기억이 max_completion_
      // tokens인데 모델을 옛 호환 서버로 바꾸면 반대 방향 400이 난다.
      const other: TokenField =
        first === "max_tokens" ? "max_completion_tokens" : "max_tokens";
      const aboutTokenField =
        detail.includes("max_completion_tokens") ||
        detail.includes("max_tokens");
      if (result.response.status === 400 && aboutTokenField) {
        result = await execute(other);
        if (result.response.ok) {
          preferredTokenField.set(tokenFieldKey(this.config), other);
        }
      } else {
        throw new Error(
          `structured agent failed (${result.response.status}): ${detail.slice(0, 300)}`,
        );
      }
    }
    if (!result.response.ok) {
      const detail = await result.response.text().catch(() => "");
      throw new Error(
        `structured agent failed (${result.response.status}): ${detail.slice(0, 300)}`,
      );
    }
    const content = contentFromChatCompletion(await result.response.json());
    if (!content) throw new Error("structured agent returned no content");
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("structured agent returned invalid JSON content");
    }
    return {
      value: unwrapUnionEnvelope(parsed, request.schema),
      producerLogId: result.producerLogId,
    };
  }
}

// 판별 union 스키마는 프로바이더 제약 때문에 루트 object 한 겹으로 감싸 보낸다
// (prompts/strict-schema.ts). 감싼 사실이 Agent 파서로 새지 않게 여기서 벗긴다.
function unwrapUnionEnvelope(value: unknown, schema: unknown): unknown {
  if (!isRootUnionSchema(schema)) return value;
  if (
    typeof value !== "object" ||
    value === null ||
    !(UNION_ENVELOPE_KEY in value)
  ) {
    throw new Error("structured agent returned no union result");
  }
  return (value as Record<string, unknown>)[UNION_ENVELOPE_KEY];
}
