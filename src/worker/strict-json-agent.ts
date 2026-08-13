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
    const execute = async (
      tokenField: "max_tokens" | "max_completion_tokens",
    ) => {
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

    let result = await execute("max_tokens");
    if (!result.response.ok) {
      const detail = await result.response.text().catch(() => "");
      if (
        result.response.status === 400 &&
        detail.includes("max_completion_tokens")
      ) {
        result = await execute("max_completion_tokens");
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
