import {
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  Paper,
  PasswordInput,
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

export function GenerationSettingsForm({
  settings,
}: {
  settings: GenerationSettingsView;
}) {
  const queryClient = useQueryClient();
  const [testResult, setTestResult] = useState<
    (ConnectionTestResult & { target: ConnectionTestTarget }) | null
  >(null);

  const form = useForm<SettingsFormValues>({
    mode: "uncontrolled",
    initialValues: {
      falApiKey: "",
      falImageModel: settings.falImageModel ?? "",
      falImageT2iModel: settings.falImageT2iModel ?? "",
      llmApiKey: "",
      llmApiUrl: settings.llmApiUrl ?? "",
      llmModel: settings.llmModel ?? "",
      agentLlmApiKey: "",
      agentLlmApiUrl: settings.chat.overrides.apiUrl ?? "",
      agentLlmModel: settings.chat.overrides.model ?? "",
      agentEmbeddingModel: settings.chat.overrides.embeddingModel ?? "",
    },
    validate: {
      llmApiUrl: httpUrlOrEmpty,
      agentLlmApiUrl: httpUrlOrEmpty,
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
          {sectionHeader("이미지 생성 (fal.ai)", "image")}
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
          <TextInput
            label="edit 모델 (레퍼런스 컨디셔닝)"
            placeholder="fal-ai/nano-banana/edit"
            description={sourceNote(settings.resolved.sources.editModel)}
            key={form.key("falImageModel")}
            {...form.getInputProps("falImageModel")}
          />
          <TextInput
            label="t2i 모델 (콜드스타트)"
            placeholder="fal-ai/nano-banana"
            description={sourceNote(settings.resolved.sources.t2iModel)}
            key={form.key("falImageT2iModel")}
            {...form.getInputProps("falImageT2iModel")}
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
            {settings.chat.overrides.apiKey.set ? (
              <Badge color="accent">
                전용 키 ····{settings.chat.overrides.apiKey.last4}
              </Badge>
            ) : settings.chat.effective.apiKeyLast4 ? (
              <Badge color="ink" variant="light">
                기획 키 상속 ····{settings.chat.effective.apiKeyLast4}
              </Badge>
            ) : (
              <Badge color="attention">키 없음</Badge>
            )}
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
            DB 설정이 env보다 우선하며 다음 잡·기획·대화부터 적용됩니다. 모델과
            URL은 비우고 저장하면 상위 값으로 복귀하지만, API 키는 비워도
            유지되고 삭제는 키 삭제 버튼으로만 합니다.
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
