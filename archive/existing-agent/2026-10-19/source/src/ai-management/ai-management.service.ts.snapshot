import { createHash, randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AiModelService, validateAiModel } from "../ai-models/ai-model.service";
import { PostAgentPromptService } from "../post-agent-prompts/post-agent-prompt.service";
import { GenerationSettingsService } from "../settings/generation-settings.service";
import {
  AI_FEATURES,
  AiConnection,
  AiManagementConfig,
  AiProvider,
  aiApiBase,
  aiChatUrl,
  selectionFrom,
  validateAiApiUrl,
} from "../settings/ai-management";
import { isRecord } from "../shared/utils/value-utils";

export type ConnectionInput = {
  type: "llm" | "image";
  provider: AiProvider;
  apiUrl: string;
  apiKey?: string | null;
};

@Injectable()
export class AiManagementService {
  constructor(
    private readonly settings: GenerationSettingsService,
    private readonly models: AiModelService,
    private readonly prompts: PostAgentPromptService,
  ) {}

  private async current(): Promise<AiManagementConfig> {
    const stored = await this.settings.getAiManagement();
    if (stored) return stored;
    const [planner, chat, configs, natural] = await Promise.all([
      this.settings.resolvePlannerSettings(),
      this.settings.resolveChatSettings(),
      this.prompts.all(),
      this.settings.getNaturalAgentBundle(),
    ]);
    const connections: AiConnection[] = [
      {
        id: "llm-1",
        type: "llm",
        provider: "openai-compatible",
        apiUrl: aiApiBase(planner.apiUrl ?? ""),
        legacyKey: "planner",
        models: [],
      },
    ];
    const separateChat =
      chat.apiUrl &&
      (aiApiBase(chat.apiUrl) !== aiApiBase(planner.apiUrl ?? "") ||
        chat.apiKey !== planner.apiKey);
    if (separateChat)
      connections.push({
        id: "llm-2",
        type: "llm",
        provider: "openai-compatible",
        apiUrl: aiApiBase(chat.apiUrl!),
        legacyKey: "chat",
        models: [],
      });
    const defaults = {
      openai: "https://api.openai.com/v1",
      spicyapi: "https://api.spicyapi.ai/api/v1",
      fal: "https://queue.fal.run",
      "opod-flux": "",
    };
    for (const provider of [
      "openai",
      "spicyapi",
      "fal",
      "opod-flux",
    ] as const) {
      const resolved = await this.settings.resolveProviderSettings(
        undefined,
        provider,
      );
      connections.push({
        id: `image-${provider}`,
        type: "image",
        provider,
        apiUrl:
          provider === "opod-flux"
            ? (resolved.opodFluxApiBaseUrl ?? "")
            : defaults[provider],
        legacyKey: provider,
        models: [],
      });
    }
    const config: AiManagementConfig = {
      version: 1,
      revision: "",
      connections,
      bindings: {},
      changes: [],
    };
    const addModel = (
      connectionId: string,
      name: string | null | undefined,
      id?: string | null,
    ) => {
      if (!name) return undefined;
      const connection = connections.find((c) => c.id === connectionId);
      if (!connection) return undefined;
      let item = connection.models.find((m) => m.model === name);
      if (!item) {
        item = {
          id:
            id ??
            `legacy-${createHash("sha256").update(`${connectionId}:${name}`).digest("hex").slice(0, 20)}`,
          model: name,
        };
        connection.models.push(item);
      }
      return { connectionId, modelId: item.id };
    };
    let cursor: string | undefined;
    do {
      const page = await this.models.list({ limit: 50, cursor });
      for (const item of page.items)
        addModel(
          item.type === "llm" ? "llm-1" : `image-${item.provider}`,
          item.model,
          item.id,
        );
      cursor = page.nextCursor;
    } while (cursor);
    for (const item of configs.items) {
      const connectionId =
        item.stage === "generation"
          ? `image-${item.provider ?? "fal"}`
          : "llm-1";
      if (!connections.some((c) => c.id === connectionId)) continue;
      const binding = addModel(
        connectionId,
        item.effectiveModel ??
          (item.stage === "generation" ? null : planner.model),
      );
      if (binding) config.bindings[`existing.${item.stage}`] = binding;
    }
    for (const feature of AI_FEATURES.filter((f) =>
      f.id.startsWith("natural."),
    )) {
      const stage = feature.id.slice("natural.".length);
      const image = stage === "generation";
      const selected = image
        ? natural?.generation
        : ["naturalness", "requirements"].includes(stage)
          ? natural?.reviewModel
          : natural?.planningModel;
      const provider =
        selected?.provider ??
        (image
          ? (await this.settings.resolveProviderSettings()).provider
          : "openai-compatible");
      const name =
        selected && "effectiveModel" in selected
          ? selected.effectiveModel
          : selected && "model" in selected
            ? selected.model
            : image
              ? (await this.settings.resolveProviderSettings()).editModel
              : planner.model;
      const binding = addModel(image ? `image-${provider}` : "llm-1", name);
      if (binding) config.bindings[feature.id] = binding;
    }
    const chatBinding = addModel(separateChat ? "llm-2" : "llm-1", chat.model);
    if (chatBinding) config.bindings["chat.response"] = chatBinding;
    return config;
  }

  private connection(config: AiManagementConfig, id: string) {
    const item = config.connections.find((c) => c.id === id && !c.archived);
    if (!item) throw new NotFoundException("API 연결을 찾을 수 없습니다.");
    return item;
  }

  private async view(config: AiManagementConfig) {
    return {
      revision: config.revision || null,
      connections: await Promise.all(
        config.connections
          .filter((c) => !c.archived)
          .map(async (c) => {
            const key = await this.settings.aiConnectionKey(c);
            return {
              id: c.id,
              type: c.type,
              provider: c.provider,
              apiUrl: c.apiUrl,
              apiKey: {
                set: !!key,
                ...(key && key.length > 4 ? { last4: key.slice(-4) } : {}),
              },
              models: c.models.filter((m) => !m.archived),
              configured: !!c.apiUrl && (!!key || c.provider === "opod-flux"),
            };
          }),
      ),
      features: AI_FEATURES.map((feature) => ({
        ...feature,
        selection: selectionFrom(config, feature.id),
      })),
      changes: config.changes,
    };
  }

  get() {
    return this.current().then((config) => this.view(config));
  }

  private async change(
    expected: string | null,
    actor: string,
    summary: string,
    apply: (config: AiManagementConfig) => Promise<void> | void,
  ) {
    const config = await this.current();
    if ((config.revision || null) !== expected)
      throw new ConflictException(
        "다른 관리자가 설정을 변경했습니다. 최신 설정을 확인하세요.",
      );
    await apply(config);
    config.revision = randomUUID();
    config.changes = [
      { at: new Date().toISOString(), actor, summary },
      ...config.changes,
    ].slice(0, 30);
    await this.settings.saveAiManagement(config, expected);
    return this.view(config);
  }

  private validateConnection(input: ConnectionInput) {
    if (
      input.type === "llm"
        ? input.provider !== "openai-compatible"
        : !["openai", "spicyapi", "fal", "opod-flux"].includes(input.provider)
    )
      throw new BadRequestException("API 유형과 공급자가 맞지 않습니다.");
    return validateAiApiUrl(input.apiUrl, input.type);
  }

  saveConnection(
    id: string | null,
    input: ConnectionInput,
    revision: string | null,
    actor: string,
  ) {
    const apiUrl = this.validateConnection(input);
    return this.change(
      revision,
      actor,
      `${id ? "API 수정" : "API 등록"}: ${apiUrl}`,
      (config) => {
        const connection = id
          ? this.connection(config, id)
          : ({
              id: randomUUID(),
              type: input.type,
              provider: input.provider,
              apiUrl,
              models: [],
            } as AiConnection);
        if (
          connection.type !== input.type ||
          connection.provider !== input.provider
        )
          throw new BadRequestException(
            "등록한 API의 유형과 공급자는 바꿀 수 없습니다.",
          );
        connection.apiUrl = apiUrl;
        if (input.apiKey === null) delete connection.apiKey;
        else if (input.apiKey?.trim()) connection.apiKey = input.apiKey.trim();
        if (!id) config.connections.push(connection);
      },
    );
  }

  removeConnection(id: string, revision: string | null, actor: string) {
    return this.change(revision, actor, "미사용 API 제거", (config) => {
      const connection = this.connection(config, id);
      if (Object.values(config.bindings).some((b) => b.connectionId === id))
        throw new ConflictException(
          "사용 중인 API입니다. 기능별 모델 설정에서 다른 API로 변경하세요.",
        );
      // Submitted jobs retain their connection identity, including after removal from the catalog.
      connection.archived = true;
    });
  }

  addModel(id: string, name: string, revision: string | null, actor: string) {
    return this.change(
      revision,
      actor,
      `모델 등록: ${name.trim()}`,
      async (config) => {
        const connection = this.connection(config, id);
        validateAiModel(connection.type, connection.provider, name.trim());
        if (
          connection.models.some((m) => !m.archived && m.model === name.trim())
        )
          throw new ConflictException("이미 등록한 모델입니다.");
        const created = await this.models.create({
          type: connection.type,
          provider: connection.provider,
          model: name.trim(),
        });
        connection.models.push({ id: created.id, model: created.model });
      },
    );
  }

  removeModel(
    id: string,
    modelId: string,
    revision: string | null,
    actor: string,
  ) {
    return this.change(revision, actor, "미사용 모델 제거", (config) => {
      const connection = this.connection(config, id),
        item = connection.models.find((m) => m.id === modelId && !m.archived);
      if (!item) throw new NotFoundException("모델을 찾을 수 없습니다.");
      if (
        Object.values(config.bindings).some(
          (b) => b.connectionId === id && b.modelId === modelId,
        )
      )
        throw new ConflictException(
          "사용 중인 모델입니다. 기능별 모델 설정을 먼저 변경하세요.",
        );
      item.archived = true;
    });
  }

  assign(
    featureId: string,
    connectionId: string,
    modelId: string,
    revision: string | null,
    actor: string,
  ) {
    return this.change(
      revision,
      actor,
      `기능 모델 변경: ${featureId}`,
      async (config) => {
        const feature = AI_FEATURES.find((f) => f.id === featureId),
          connection = this.connection(config, connectionId);
        if (!feature || feature.type !== connection.type)
          throw new BadRequestException("기능에 맞는 API 유형을 선택하세요.");
        const model = connection.models.find(
          (m) => m.id === modelId && !m.archived,
        );
        if (!model)
          throw new BadRequestException("이 API에 등록된 모델을 선택하세요.");
        if (
          !connection.apiUrl ||
          (!(await this.settings.aiConnectionKey(connection)) &&
            connection.provider !== "opod-flux")
        )
          throw new BadRequestException(
            "API 주소와 인증 키를 먼저 설정하세요.",
          );
        if (
          featureId === "chat.response" &&
          !(await this.settings.aiConnectionKey(connection, true))
        )
          throw new BadRequestException(
            "채팅에 사용하려면 API 설정에서 인증 키를 저장하세요. 채팅은 DB에 저장한 인증 키만 사용합니다.",
          );
        config.bindings[featureId] = { connectionId, modelId };
      },
    );
  }

  private async candidate(
    id: string,
    input: { apiUrl?: string; apiKey?: string },
  ) {
    const config = await this.current(),
      connection = this.connection(config, id);
    const apiUrl = validateAiApiUrl(
      input.apiUrl ?? connection.apiUrl,
      connection.type,
    );
    const apiKey =
      input.apiKey?.trim() || (await this.settings.aiConnectionKey(connection));
    if (!apiKey && connection.provider !== "opod-flux")
      throw new BadRequestException("인증 키를 설정하세요.");
    return { connection, apiUrl, apiKey };
  }

  async discover(id: string, input: { apiUrl?: string; apiKey?: string }) {
    const { connection, apiUrl, apiKey } = await this.candidate(id, input);
    if (connection.type !== "llm")
      throw new BadRequestException(
        "이 API는 모델 목록 조회를 지원하지 않습니다. 모델 ID를 직접 등록하세요.",
      );
    try {
      const response = await fetch(`${aiApiBase(apiUrl)}/models`, {
        headers: { authorization: `Bearer ${apiKey}` },
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error();
      const body: unknown = await response.json();
      if (!isRecord(body) || !Array.isArray(body.data)) throw new Error();
      return {
        items: body.data
          .filter(isRecord)
          .map((m) => m.id)
          .filter(
            (id): id is string => typeof id === "string" && id.length <= 512,
          )
          .slice(0, 500),
      };
    } catch {
      throw new BadRequestException(
        "모델 목록을 불러오지 못했습니다. 주소·인증을 확인하거나 모델 ID를 직접 등록하세요.",
      );
    }
  }

  async test(
    id: string,
    input: { apiUrl?: string; apiKey?: string; modelId?: string },
  ) {
    const { connection, apiUrl, apiKey } = await this.candidate(id, input);
    const model = input.modelId
      ? connection.models.find((m) => m.id === input.modelId && !m.archived)
      : undefined;
    if (input.modelId && !model)
      throw new NotFoundException("모델을 찾을 수 없습니다.");
    if (connection.type === "llm" && model) {
      const result = await this.settings.testConnection({
        target: "planner",
        llmApiUrl: aiChatUrl(apiUrl),
        llmApiKey: apiKey,
        llmModel: model.model,
      });
      return {
        ok: result.ok,
        message: result.ok
          ? "모델 호출을 확인했습니다."
          : "모델 호출에 실패했습니다. API 주소·인증 키·모델 ID와 서버 상태를 확인하세요.",
        scope: "model" as const,
        checkedAt: new Date().toISOString(),
      };
    }
    let endpoint = `${apiUrl}/models`,
      authorization = `Bearer ${apiKey}`;
    if (connection.provider === "spicyapi")
      endpoint = `${apiUrl}/models/${model?.model ?? connection.models.find((m) => !m.archived)?.model ?? "alibaba/qwen-image-3.0-pro/edit"}`;
    if (connection.provider === "opod-flux")
      endpoint = `${apiUrl}/generations/gen_connection_test`;
    if (connection.provider === "fal") {
      endpoint = `${apiUrl}/fal-ai/nano-banana/requests/00000000-0000-0000-0000-000000000000/status`;
      authorization = `Key ${apiKey}`;
    }
    try {
      const response = await fetch(endpoint, {
        headers: apiKey ? { authorization } : {},
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      const ok =
        response.ok ||
        (["opod-flux", "fal"].includes(connection.provider) &&
          response.status === 404);
      return {
        ok,
        message: ok
          ? "API 접속·인증을 확인했습니다. 이미지 생성 성공을 보증하는 검사는 아닙니다."
          : `API 연결 확인 실패 (HTTP ${response.status}). 주소와 인증 키를 확인하세요.`,
        scope: "connection" as const,
        checkedAt: new Date().toISOString(),
      };
    } catch {
      return {
        ok: false,
        message: "API에 접속하지 못했습니다. 주소와 서버 상태를 확인하세요.",
        scope: "connection" as const,
        checkedAt: new Date().toISOString(),
      };
    }
  }
}
