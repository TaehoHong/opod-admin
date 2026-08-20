import {
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  Paper,
  PasswordInput,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ClearKeyButton } from "./ClearKeyButton";
import {
  testGenerationSettings,
  updateGenerationSettings,
  type ConnectionTestResult,
  type ConnectionTestTarget,
  type GenerationSettingsUpdate,
  type GenerationSettingsView,
  type SecretStatus,
  type SettingSource,
} from "./api";
import {
  toConnectionTestBody,
  toSettingsUpdate,
  type SettingsFormValues,
} from "./payload";

function httpUrlOrEmpty(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^https?:\/\//.test(trimmed)
    ? null
    : "http:// 또는 https:// 로 시작해야 합니다";
}

function httpsUrlOrEmpty(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^https:\/\//.test(trimmed) ? null : "https:// 로 시작해야 합니다";
}

// 비우면 기본값으로 돌아간다. 형식이 어긋난 값은 프로바이더가 422로 거절하므로
// 저장 전에 막는다.
function aspectRatioOrEmpty(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^\d{1,2}:\d{1,2}$/.test(trimmed)
    ? null
    : "4:5 처럼 가로:세로 형식이어야 합니다";
}

export function GenerationSettingsForm({
  settings,
}: {
  settings: GenerationSettingsView;
}) {
  const queryClient = useQueryClient();
  const [testResult, setTestResult] = useState<
    (ConnectionTestResult & { target: ConnectionTestTarget }) | null
  >(null);
  const [imageProvider, setImageProvider] = useState(settings.imageProvider);

  const form = useForm<SettingsFormValues>({
    mode: "uncontrolled",
    initialValues: {
      imageProvider: settings.imageProvider,
      falApiKey: "",
      falImageModel: settings.falImageModel ?? "",
      falImageT2iModel: settings.falImageT2iModel ?? "",
      opodFluxApiBaseUrl: settings.opodFluxApiBaseUrl ?? "",
      opodFluxApiKey: "",
      llmApiKey: "",
      llmApiUrl: settings.llmApiUrl ?? "",
      llmModel: settings.llmModel ?? "",
      agentLlmApiKey: "",
      agentLlmApiUrl: settings.chat.overrides.apiUrl ?? "",
      agentLlmModel: settings.chat.overrides.model ?? "",
      agentEmbeddingModel: settings.chat.overrides.embeddingModel ?? "",
      aspectRatioFeed: settings.aspectRatios.overrides.feed ?? "",
      aspectRatioStory: settings.aspectRatios.overrides.story ?? "",
      aspectRatioReel: settings.aspectRatios.overrides.reel ?? "",
    },
    validate: {
      opodFluxApiBaseUrl: httpsUrlOrEmpty,
      llmApiUrl: httpUrlOrEmpty,
      agentLlmApiUrl: httpUrlOrEmpty,
      aspectRatioFeed: aspectRatioOrEmpty,
      aspectRatioStory: aspectRatioOrEmpty,
      aspectRatioReel: aspectRatioOrEmpty,
    },
  });

  const save = useMutation({
    mutationFn: (body: GenerationSettingsUpdate) =>
      updateGenerationSettings(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const test = useMutation({
    mutationFn: (target: ConnectionTestTarget) =>
      testGenerationSettings(
        toConnectionTestBody(target, form.getValues()),
      ).then((result) => ({ ...result, target })),
    onSuccess: setTestResult,
    onError: (error: Error, target) =>
      setTestResult({ ok: false, message: error.message, target }),
  });

  const clearKey = (field: keyof GenerationSettingsUpdate) =>
    save.mutate({ [field]: null });

  const sectionHeader = (title: string, target: ConnectionTestTarget) => (
    <Group justify="space-between" align="baseline">
      <Title order={6}>{title}</Title>
      <Button
        variant="subtle"
        size="compact-sm"
        type="button"
        loading={test.isPending && test.variables === target}
        onClick={() => test.mutate(target)}
      >
        연결 테스트
      </Button>
    </Group>
  );

  return (
    <Paper p="md" component="section">
      <form
        onSubmit={form.onSubmit((values) =>
          save.mutate(toSettingsUpdate(values)),
        )}
      >
        <Stack gap="sm">
          {sectionHeader("이미지 생성", "image")}
          <Select
            label="실행 provider"
            data={[
              { value: "opod-flux", label: "opod-flux v1" },
              { value: "fal", label: "fal.ai" },
            ]}
            allowDeselect={false}
            value={imageProvider}
            onChange={(value) => {
              const next = value === "opod-flux" ? "opod-flux" : "fal";
              form.setFieldValue("imageProvider", next);
              setImageProvider(next);
            }}
          />
          {imageProvider === "opod-flux" ? (
            <>
              <TextInput
                label="opod-flux API Base URL"
                placeholder="https://taeho.taildac41e.ts.net:8850/v1"
                description={sourceNote(
                  settings.resolved.sources.opodFluxApiBaseUrl,
                )}
                key={form.key("opodFluxApiBaseUrl")}
                {...form.getInputProps("opodFluxApiBaseUrl")}
              />
              <Group gap="xs" align="flex-end" wrap="nowrap">
                <PasswordInput
                  label="opod-flux API 키"
                  placeholder={
                    settings.opodFluxApiKey.set
                      ? "변경할 때만 입력"
                      : "Bearer API 키 (인증 사용 시)"
                  }
                  autoComplete="off"
                  flex={1}
                  key={form.key("opodFluxApiKey")}
                  {...form.getInputProps("opodFluxApiKey")}
                />
                <SecretStatusBadge
                  status={settings.opodFluxApiKey}
                  envSource={settings.resolved.sources.opodFluxApiKey}
                  missingLabel="키 없음 — 인증 비활성 배포만 가능"
                />
                {settings.opodFluxApiKey.set ? (
                  <ClearKeyButton
                    label="opod-flux API 키 삭제"
                    description="저장된 opod-flux 키를 지우고 env 값으로 되돌립니다."
                    loading={save.isPending}
                    onConfirm={() => clearKey("opodFluxApiKey")}
                  />
                ) : null}
              </Group>
            </>
          ) : (
            <Group gap="xs" align="flex-end" wrap="nowrap">
              <PasswordInput
                label="fal.ai API 키"
                placeholder={
                  settings.falApiKey.set
                    ? "변경할 때만 입력"
                    : "fal.ai 대시보드에서 발급한 키"
                }
                autoComplete="off"
                flex={1}
                key={form.key("falApiKey")}
                {...form.getInputProps("falApiKey")}
              />
              <SecretStatusBadge
                status={settings.falApiKey}
                envSource={settings.resolved.sources.apiKey}
                missingLabel="키 없음 — 이미지 생성 불가"
              />
              {settings.falApiKey.set ? (
                <ClearKeyButton
                  label="fal.ai API 키 삭제"
                  description="저장된 fal.ai 키를 지우고 env 값으로 되돌립니다. env에도 키가 없으면 이미지 생성이 중단됩니다."
                  loading={save.isPending}
                  onConfirm={() => clearKey("falApiKey")}
                />
              ) : null}
            </Group>
          )}
          <TextInput
            label="edit 프롬프트 정책 모델 ID"
            placeholder="black-forest-labs/FLUX.1-Kontext-dev"
            description={sourceNote(settings.resolved.sources.editModel)}
            key={form.key("falImageModel")}
            {...form.getInputProps("falImageModel")}
          />
          <TextInput
            label="t2i 프롬프트 정책 모델 ID"
            placeholder="black-forest-labs/FLUX.1-Kontext-dev"
            description={sourceNote(settings.resolved.sources.t2iModel)}
            key={form.key("falImageT2iModel")}
            {...form.getInputProps("falImageT2iModel")}
          />

          <Divider />
          {/* 연결 테스트 대상이 아니라 sectionHeader를 쓰지 않는다. */}
          <Title order={6}>게시 포맷별 종횡비</Title>
          <TextInput
            label="피드 게시물"
            placeholder={DEFAULT_ASPECT_RATIO_HINT.feed}
            description={ratioNote(settings.aspectRatios.effective.feed)}
            key={form.key("aspectRatioFeed")}
            {...form.getInputProps("aspectRatioFeed")}
          />
          <TextInput
            label="스토리"
            placeholder={DEFAULT_ASPECT_RATIO_HINT.story}
            description={ratioNote(settings.aspectRatios.effective.story)}
            key={form.key("aspectRatioStory")}
            {...form.getInputProps("aspectRatioStory")}
          />
          <TextInput
            label="릴"
            placeholder={DEFAULT_ASPECT_RATIO_HINT.reel}
            description={ratioNote(settings.aspectRatios.effective.reel)}
            key={form.key("aspectRatioReel")}
            {...form.getInputProps("aspectRatioReel")}
          />

          <Divider />
          {sectionHeader("기획 LLM (OpenAI-compatible)", "planner")}
          <Group gap="xs" align="flex-end" wrap="nowrap">
            <PasswordInput
              label="LLM API 키"
              placeholder={
                settings.llmApiKey.set ? "변경할 때만 입력" : "sk-..."
              }
              autoComplete="off"
              flex={1}
              key={form.key("llmApiKey")}
              {...form.getInputProps("llmApiKey")}
            />
            <SecretStatusBadge
              status={settings.llmApiKey}
              envSource={settings.resolved.plannerSources.apiKey}
              missingLabel="키 없음 — 로컬 플래너"
            />
            {settings.llmApiKey.set ? (
              <ClearKeyButton
                label="기획 LLM 키 삭제"
                description="저장된 기획 LLM 키를 지우고 env 값으로 되돌립니다."
                loading={save.isPending}
                onConfirm={() => clearKey("llmApiKey")}
              />
            ) : null}
          </Group>
          <TextInput
            label="API URL"
            placeholder="https://api.openai.com/v1/chat/completions"
            description={sourceNote(settings.resolved.plannerSources.apiUrl)}
            key={form.key("llmApiUrl")}
            {...form.getInputProps("llmApiUrl")}
          />
          <TextInput
            label="모델"
            placeholder="gpt-5-mini"
            description={sourceNote(settings.resolved.plannerSources.model)}
            key={form.key("llmModel")}
            {...form.getInputProps("llmModel")}
          />

          <Divider />
          {sectionHeader("캐릭터 채팅 LLM (opod-agent)", "chat")}
          <Group gap="xs" align="flex-end" wrap="nowrap">
            <PasswordInput
              label="API 키"
              placeholder="채팅 전용 키로 바꿀 때만 입력"
              autoComplete="off"
              flex={1}
              key={form.key("agentLlmApiKey")}
              {...form.getInputProps("agentLlmApiKey")}
            />
            <InheritedKeyBadge
              override={settings.chat.overrides.apiKey}
              effectiveLast4={settings.chat.effective.apiKeyLast4}
            />
            {settings.chat.overrides.apiKey.set ? (
              <ClearKeyButton
                label="채팅 LLM 키 삭제"
                description="채팅 전용 키를 지우고 기획 LLM 키를 다시 사용합니다."
                loading={save.isPending}
                onConfirm={() => clearKey("agentLlmApiKey")}
              />
            ) : null}
          </Group>
          <TextInput
            label="API URL"
            placeholder={
              settings.chat.effective.apiUrl ??
              "https://api.openai.com/v1/chat/completions"
            }
            description="비우면 기획 LLM 값을 상속합니다"
            key={form.key("agentLlmApiUrl")}
            {...form.getInputProps("agentLlmApiUrl")}
          />
          <TextInput
            label="모델"
            placeholder={settings.chat.effective.model ?? "모델명"}
            description="비우면 기획 LLM 값을 상속합니다"
            key={form.key("agentLlmModel")}
            {...form.getInputProps("agentLlmModel")}
          />
          <TextInput
            label="임베딩 모델"
            placeholder={settings.chat.effective.embeddingModel}
            key={form.key("agentEmbeddingModel")}
            {...form.getInputProps("agentEmbeddingModel")}
          />

          <Text size="xs" c="dimmed">
            이미지·기획 설정은 DB 값이 env보다 우선하고, 채팅 LLM은 DB 전용이라
            비운 필드는 기획 LLM을 상속합니다. 저장하면 다음 잡·기획·대화부터
            적용됩니다. 모델과 URL은 비우고 저장하면 상위 값으로 복귀하지만, API
            키는 비워도 유지되고 삭제는 키 삭제 버튼으로만 합니다.
          </Text>

          {testResult ? (
            <Alert
              color={testResult.ok ? "teal" : "red"}
              role="status"
              title={testResult.ok ? "연결 성공" : "연결 실패"}
            >
              {testResult.message}
            </Alert>
          ) : null}
          {save.isError ? (
            <Alert color="red" role="alert" title="저장하지 못했습니다">
              {save.error.message}
            </Alert>
          ) : null}
          {save.isSuccess ? (
            <Alert color="teal" role="status">
              설정을 저장했습니다.
            </Alert>
          ) : null}

          <Group>
            <Button type="submit" loading={save.isPending}>
              저장
            </Button>
          </Group>
        </Stack>
      </form>
    </Paper>
  );
}

// env 폴백이 활성인 필드는 상시로 알린다. placeholder는 입력하면 사라져
// "지금 env의 무엇이 적용 중인지"를 잃기 때문이다.
function sourceNote(source: SettingSource): string | undefined {
  return source === "env" ? "env 값 사용 중" : undefined;
}

// 서버의 DEFAULT_ASPECT_RATIOS와 같은 값. 비웠을 때 무엇이 적용되는지 입력란에
// 미리 보여주려고 둔다.
const DEFAULT_ASPECT_RATIO_HINT = {
  feed: "4:5",
  story: "9:16",
  reel: "9:16",
} as const;

function ratioNote(effective: {
  value: string;
  source: "db" | "default";
}): string {
  return effective.source === "default"
    ? `기본값 ${effective.value} 사용 중 — 비워두면 유지됩니다`
    : `적용 중: ${effective.value}`;
}

// 기획 LLM을 상속하는 섹션(채팅·평가)의 키 상태. 전용 키 > 상속 > 없음 순으로
// 지금 무엇이 쓰이는지 하나만 보여준다.
function InheritedKeyBadge({
  override,
  effectiveLast4,
}: {
  override: SecretStatus;
  effectiveLast4: string | null;
}) {
  if (override.set) {
    return <Badge color="accent">전용 키 ····{override.last4}</Badge>;
  }
  if (effectiveLast4) {
    return (
      <Badge color="ink" variant="light">
        기획 키 상속 ····{effectiveLast4}
      </Badge>
    );
  }
  return <Badge color="attention">키 없음</Badge>;
}

function SecretStatusBadge({
  status,
  envSource,
  missingLabel,
}: {
  status: { set: boolean; last4?: string };
  envSource: SettingSource;
  missingLabel: string;
}) {
  if (status.set) {
    return <Badge color="accent">저장됨 ····{status.last4}</Badge>;
  }
  if (envSource === "env") {
    return (
      <Badge color="ink" variant="light">
        env 키 사용 중
      </Badge>
    );
  }
  return <Badge color="attention">{missingLabel}</Badge>;
}
