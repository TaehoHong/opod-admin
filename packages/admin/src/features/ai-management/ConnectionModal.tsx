import {
  Alert,
  Autocomplete,
  Badge,
  Button,
  Divider,
  Group,
  Modal,
  PasswordInput,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  addModel,
  discoverModels,
  PROVIDERS,
  removeConnection,
  removeModel,
  saveConnection,
  testConnection,
  useAiChange,
  type AiConfig,
  type AiKind,
  type AiProvider,
} from "./api";
import classes from "./AiManagement.module.css";

export function ConnectionModal({
  config,
  connectionId,
  kind: initialKind,
  onClose,
  onCreated,
}: {
  config: AiConfig;
  connectionId: string | null;
  kind: AiKind;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const connection = config.connections.find((c) => c.id === connectionId);
  const kind = connection?.type ?? initialKind;
  const change = useAiChange();
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [discard, setDiscard] = useState(false);
  const form = useForm({
    mode: "uncontrolled",
    initialValues: {
      type: connection?.type ?? kind,
      provider:
        connection?.provider ??
        ((kind === "llm" ? "openai-compatible" : "openai") as AiProvider),
      apiUrl: connection?.apiUrl ?? "",
      apiKey: "",
    },
    validate: {
      apiUrl: (value) => {
        try {
          const url = new URL(value);
          return ["http:", "https:"].includes(url.protocol) &&
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash
            ? null
            : "인증 정보·쿼리 없는 API 주소를 입력하세요.";
        } catch {
          return "http:// 또는 https://로 시작하는 주소를 입력하세요.";
        }
      },
    },
  });
  const modelForm = useForm({
    mode: "uncontrolled",
    initialValues: { model: "" },
    validate: {
      model: (value) => (value.trim() ? null : "모델 ID를 입력하세요."),
    },
  });
  const probe = useMutation({
    mutationFn: (modelId?: string) =>
      testConnection(connectionId!, {
        apiUrl: form.getValues().apiUrl,
        ...(form.getValues().apiKey ? { apiKey: form.getValues().apiKey } : {}),
        ...(modelId ? { modelId } : {}),
      }),
  });
  const discovery = useMutation({
    mutationFn: () =>
      discoverModels(connectionId!, {
        apiUrl: form.getValues().apiUrl,
        ...(form.getValues().apiKey ? { apiKey: form.getValues().apiKey } : {}),
      }),
  });
  const pending = change.isPending || probe.isPending || discovery.isPending;
  const used = (modelId?: string) =>
    config.features.some(
      (f) =>
        f.selection?.connectionId === connectionId &&
        (!modelId || f.selection.modelId === modelId),
    );
  const close = () => {
    if (form.isDirty() || modelForm.isDirty()) setDiscard(true);
    else onClose();
  };
  const error = change.error ?? probe.error ?? discovery.error;
  return (
    <Modal
      opened
      onClose={close}
      title={connectionId ? "API · 모델 설정" : "API 연결 추가"}
      size="lg"
      centered
      closeOnClickOutside={!pending}
      closeOnEscape={!pending}
      withCloseButton={!pending}
      closeButtonProps={{ "aria-label": "API 설정 닫기" }}
    >
      <Stack gap="lg">
        {connectionId && !connection ? (
          <Alert color="red">
            API를 찾을 수 없습니다. 목록으로 돌아가 다시 선택하세요.
          </Alert>
        ) : (
          <>
            <form
              onSubmit={form.onSubmit((values) => {
                setNotice("");
                change.mutate(
                  () =>
                    saveConnection(
                      connectionId,
                      {
                        ...values,
                        ...(values.apiKey
                          ? { apiKey: values.apiKey }
                          : { apiKey: undefined }),
                      },
                      config.revision,
                    ),
                  {
                    onSuccess: (updated) => {
                      if (!connectionId) {
                        onCreated(
                          updated.connections.find(
                            (c) =>
                              !config.connections.some(
                                (old) => old.id === c.id,
                              ),
                          )!.id,
                        );
                        return;
                      }
                      form.setFieldValue("apiKey", "");
                      form.resetDirty({ ...values, apiKey: "" });
                      setNotice("API 설정을 저장했습니다.");
                      probe.reset();
                    },
                  },
                );
              })}
            >
              <Stack gap="md">
                <Text size="sm" c="dimmed">
                  {kind === "llm" ? "LLM" : "이미지"} API의 접속 정보와 등록
                  모델을 관리합니다.
                </Text>
                <Select
                  label="공급자 · 호출 방식"
                  data={(kind === "llm"
                    ? ["openai-compatible"]
                    : ["openai", "spicyapi", "fal", "opod-flux"]
                  ).map((p) => ({
                    value: p,
                    label: PROVIDERS[p as AiProvider],
                  }))}
                  allowDeselect={false}
                  disabled={!!connection || pending}
                  key={form.key("provider")}
                  {...form.getInputProps("provider")}
                />
                <TextInput
                  label="API 주소"
                  data-autofocus
                  placeholder="https://api.example.com/v1"
                  description={
                    kind === "llm"
                      ? "기본 주소를 입력하세요. /chat/completions는 자동으로 연결합니다."
                      : "공급자 API의 HTTPS 기본 주소를 입력하세요."
                  }
                  required
                  maxLength={1000}
                  disabled={pending}
                  key={form.key("apiUrl")}
                  {...form.getInputProps("apiUrl")}
                />
                <PasswordInput
                  label={connection?.apiKey.set ? "인증 키 교체" : "인증 키"}
                  description={
                    connection?.apiKey.set
                      ? `현재 •••• ${connection.apiKey.last4 ?? ""} · 비우면 기존 키를 유지합니다.`
                      : "인증을 사용하지 않는 OPOD Flux는 비워 둘 수 있습니다."
                  }
                  placeholder={
                    connection?.apiKey.set ? "교체할 때만 입력" : "인증 키 입력"
                  }
                  autoComplete="new-password"
                  visibilityToggleButtonProps={{
                    "aria-label": "인증 키 표시 전환",
                  }}
                  maxLength={500}
                  disabled={pending}
                  key={form.key("apiKey")}
                  {...form.getInputProps("apiKey")}
                />
                <Group justify="space-between">
                  {connection ? (
                    <Button
                      variant="default"
                      onClick={() => {
                        if (!form.validate().hasErrors) probe.mutate(undefined);
                      }}
                      disabled={pending}
                      loading={probe.isPending}
                    >
                      연결 테스트
                    </Button>
                  ) : (
                    <Text size="xs" c="dimmed">
                      연결을 추가한 후 모델을 등록할 수 있습니다.
                    </Text>
                  )}
                  <Button
                    type="submit"
                    loading={change.isPending}
                    disabled={pending || (!!connection && !form.isDirty())}
                  >
                    {connection ? "변경사항 저장" : "연결 추가"}
                  </Button>
                </Group>
              </Stack>
            </form>
            {error ? (
              <Alert
                color="red"
                role="alert"
                title="요청을 완료하지 못했습니다"
              >
                {error.message}
              </Alert>
            ) : null}
            {notice ? (
              <Alert color="teal" role="status">
                {notice}
              </Alert>
            ) : null}
            {probe.data ? (
              <Alert
                color={probe.data.ok ? "teal" : "red"}
                role="status"
                title={
                  probe.data.scope === "model"
                    ? "모델 호출 확인"
                    : "API 연결 확인"
                }
              >
                {probe.data.message}
                <Text size="xs" mt="xs">
                  {new Date(probe.data.checkedAt).toLocaleString("ko-KR")}
                </Text>
              </Alert>
            ) : null}
            {connection ? (
              <>
                <Divider />
                <Group justify="space-between">
                  <Title order={3} size="h5">
                    등록 모델 · {connection.models.length}
                  </Title>
                  {kind === "llm" ? (
                    <Button
                      size="xs"
                      variant="default"
                      loading={discovery.isPending}
                      disabled={pending}
                      onClick={() => discovery.mutate()}
                    >
                      API에서 목록 조회
                    </Button>
                  ) : null}
                </Group>
                {discovery.isSuccess ? (
                  <Text size="xs" c="dimmed" role="status">
                    모델 {discovery.data.items.length}개를 조회했습니다.
                    아래에서 모델 ID를 선택해 등록하세요. 목록 조회는 호출
                    성공을 보증하지 않습니다.
                  </Text>
                ) : null}
                <form
                  onSubmit={modelForm.onSubmit(({ model }) =>
                    change.mutate(
                      () => addModel(connection.id, model, config.revision),
                      {
                        onSuccess: () => {
                          modelForm.reset();
                          setNotice("모델을 등록했습니다.");
                        },
                      },
                    ),
                  )}
                >
                  <Group align="end" wrap="nowrap">
                    <Autocomplete
                      flex={1}
                      label="모델 ID"
                      placeholder="API의 정확한 모델 ID"
                      maxLength={512}
                      limit={30}
                      data={
                        discovery.data?.items.filter(
                          (name) =>
                            !connection.models.some((m) => m.model === name),
                        ) ?? []
                      }
                      disabled={pending}
                      key={modelForm.key("model")}
                      {...modelForm.getInputProps("model")}
                    />
                    <Button type="submit" variant="default" disabled={pending}>
                      모델 등록
                    </Button>
                  </Group>
                </form>
                <Stack
                  gap={0}
                  component="ul"
                  p={0}
                  m={0}
                  aria-label="등록 모델 목록"
                >
                  {connection.models.map((model) => (
                    <Group
                      key={model.id}
                      component="li"
                      justify="space-between"
                      wrap="nowrap"
                      className={classes.modelRow}
                    >
                      <div>
                        <Text size="sm" className={classes.code}>
                          {model.model}
                        </Text>
                        {used(model.id) ? (
                          <Badge size="xs" variant="light" color="ink">
                            사용 중
                          </Badge>
                        ) : null}
                      </div>
                      <Group gap="xs" wrap="nowrap">
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          disabled={pending}
                          aria-label={`${model.model} ${kind === "llm" ? "호출 확인" : "접속 확인"}`}
                          onClick={() => probe.mutate(model.id)}
                        >
                          {kind === "llm" ? "호출 확인" : "접속 확인"}
                        </Button>
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          color="red"
                          disabled={pending || used(model.id)}
                          aria-label={`${model.model} 제거`}
                          onClick={() => setConfirm(model.id)}
                        >
                          제거
                        </Button>
                      </Group>
                    </Group>
                  ))}
                  {!connection.models.length ? (
                    <Text size="sm" c="dimmed">
                      등록된 모델이 없습니다.
                    </Text>
                  ) : null}
                </Stack>
                <Text size="xs" c="dimmed">
                  사용 중인 API·모델은{" "}
                  <Link to="/model-assignments">기능별 모델 설정</Link>에서
                  변경한 뒤 제거할 수 있습니다.
                  {kind === "image"
                    ? " 접속 확인은 이미지를 생성하지 않습니다."
                    : " 호출 확인은 소량의 토큰을 사용합니다."}
                </Text>
                {confirm ? (
                  <Alert
                    color="orange"
                    title={
                      confirm === "connection"
                        ? "API와 등록 모델을 목록에서 제거할까요?"
                        : "이 모델을 목록에서 제거할까요?"
                    }
                  >
                    <Group mt="sm">
                      <Button
                        color="red"
                        size="xs"
                        disabled={pending}
                        onClick={() =>
                          change.mutate(
                            () =>
                              confirm === "connection"
                                ? removeConnection(
                                    connection.id,
                                    config.revision,
                                  )
                                : removeModel(
                                    connection.id,
                                    confirm,
                                    config.revision,
                                  ),
                            {
                              onSuccess: () => {
                                setConfirm(null);
                                if (confirm === "connection") onClose();
                                else setNotice("모델을 제거했습니다.");
                              },
                            },
                          )
                        }
                      >
                        제거
                      </Button>
                      <Button
                        variant="default"
                        size="xs"
                        disabled={pending}
                        onClick={() => setConfirm(null)}
                      >
                        취소
                      </Button>
                    </Group>
                  </Alert>
                ) : null}
                <Group justify="space-between">
                  <Button
                    variant="subtle"
                    color="red"
                    disabled={pending || used()}
                    onClick={() => setConfirm("connection")}
                  >
                    API 제거
                  </Button>
                  <Button variant="default" onClick={close} disabled={pending}>
                    닫기
                  </Button>
                </Group>
              </>
            ) : null}
          </>
        )}
        {discard ? (
          <Alert color="orange" title="저장하지 않은 입력이 있습니다.">
            <Group mt="sm">
              <Button
                variant="default"
                size="xs"
                onClick={() => setDiscard(false)}
              >
                계속 편집
              </Button>
              <Button color="red" size="xs" onClick={onClose}>
                입력 버리고 닫기
              </Button>
            </Group>
          </Alert>
        ) : null}
      </Stack>
    </Modal>
  );
}
