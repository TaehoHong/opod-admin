import {
  Alert,
  Badge,
  Button,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { CaretRight } from "@phosphor-icons/react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DataPage } from "../../shared/ui/DataPage";
import { ChangeHistory } from "./ChangeHistory";
import {
  assignModel,
  PROVIDERS,
  useAiChange,
  useAiConfig,
  type Binding,
} from "./api";
import classes from "./AiManagement.module.css";

export function FeatureModelsPage() {
  const query = useAiConfig();
  const change = useAiChange();
  const [params, setParams] = useSearchParams();
  const [drafts, setDrafts] = useState<Record<string, Binding>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const config = query.data;
  const feature =
    config?.features.find((f) => f.id === params.get("feature")) ??
    config?.features[0];
  const draft = feature
    ? (drafts[feature.id] ??
      feature.selection ?? { connectionId: "", modelId: "" })
    : { connectionId: "", modelId: "" };
  const currentConnection = config?.connections.find(
    (c) => c.id === feature?.selection?.connectionId,
  );
  const connection = config?.connections.find(
    (c) => c.id === draft.connectionId,
  );
  const model = connection?.models.find((m) => m.id === draft.modelId);
  const dirty =
    feature &&
    (draft.connectionId !== (feature.selection?.connectionId ?? "") ||
      draft.modelId !== (feature.selection?.modelId ?? ""));
  const setDraft = (binding: Binding) => {
    if (feature) setDrafts((prev) => ({ ...prev, [feature.id]: binding }));
    setSaved(null);
    change.reset();
  };
  return (
    <DataPage
      title="기능별 모델 설정"
      isPending={query.isPending}
      error={query.error}
    >
      {config && feature ? (
        <>
          <Text c="dimmed">
            각 기능에서 사용할 API와 모델을 독립적으로 선택합니다.
          </Text>
          <div className={classes.features}>
            <nav aria-label="기능 목록" className={classes.navigation}>
              {[...new Set(config.features.map((f) => f.group))].map(
                (group) => (
                  <div key={group} role="group" aria-label={group}>
                    <Text className={classes.sectionLabel}>{group}</Text>
                    {config.features
                      .filter((f) => f.group === group)
                      .map((f) => (
                        <UnstyledButton
                          key={f.id}
                          className={classes.featureItem}
                          aria-current={
                            feature.id === f.id ? "true" : undefined
                          }
                          disabled={change.isPending}
                          onClick={() => {
                            setParams({ feature: f.id });
                            change.reset();
                          }}
                        >
                          <Text size="sm" fw={feature.id === f.id ? 700 : 500}>
                            {f.label}
                          </Text>
                          <CaretRight size={14} aria-hidden />
                        </UnstyledButton>
                      ))}
                  </div>
                ),
              )}
            </nav>
            <Paper
              withBorder
              className={classes.editor}
              component="section"
              aria-label="선택한 기능의 모델 설정"
            >
              <Stack gap="xl">
                <div>
                  <Text size="xs" fw={700} c="dimmed" mb="xs">
                    {feature.group}
                  </Text>
                  <Title order={2} size="h3">
                    {feature.label}
                  </Title>
                  <Text c="dimmed" size="sm" mt="xs">
                    {feature.description}
                  </Text>
                </div>
                <Stack gap="sm">
                  <Title order={3} size="h5">
                    현재 사용 중
                  </Title>
                  <div className={classes.current}>
                    <Badge variant="light" color="ink" mb="xs">
                      {feature.type === "llm" ? "LLM" : "이미지"}
                    </Badge>
                    <Text fw={700} className={classes.code}>
                      {feature.selection?.model ?? "미설정"}
                    </Text>
                    <Text size="sm" c="dimmed" mt="xs">
                      {currentConnection
                        ? PROVIDERS[currentConnection.provider]
                        : "API와 모델을 선택하세요."}
                    </Text>
                    {currentConnection ? (
                      <Text size="xs" c="dimmed" className={classes.code}>
                        {currentConnection.apiUrl || "API 주소 미설정"}
                      </Text>
                    ) : null}
                  </div>
                </Stack>
                <Stack gap="md">
                  <Group justify="space-between">
                    <Title order={3} size="h5">
                      API · 모델 선택
                    </Title>
                    <Button
                      component={Link}
                      variant="subtle"
                      size="compact-sm"
                      to={
                        draft.connectionId
                          ? `/ai-management?type=${feature.type}&connection=${encodeURIComponent(draft.connectionId)}`
                          : `/ai-management?type=${feature.type}`
                      }
                    >
                      API 관리 ↗
                    </Button>
                  </Group>
                  <Select
                    label="API 연결"
                    placeholder="API를 선택하세요"
                    searchable
                    allowDeselect={false}
                    value={draft.connectionId || null}
                    disabled={change.isPending}
                    data={config.connections
                      .filter((c) => c.type === feature.type)
                      .map((c) => ({
                        value: c.id,
                        label: `${c.apiUrl || "API 주소 미설정"} · ${PROVIDERS[c.provider]}`,
                      }))}
                    onChange={(value) =>
                      setDraft({ connectionId: value ?? "", modelId: "" })
                    }
                  />
                  <Select
                    label="모델"
                    placeholder={
                      connection?.models.length
                        ? "모델을 선택하세요"
                        : "등록 모델 없음"
                    }
                    description={`선택한 API에 등록된 ${feature.type === "llm" ? "LLM" : "이미지"} 모델만 표시합니다.`}
                    searchable
                    allowDeselect={false}
                    value={draft.modelId || null}
                    disabled={change.isPending || !connection?.models.length}
                    data={
                      connection?.models.map((m) => ({
                        value: m.id,
                        label: m.model,
                      })) ?? []
                    }
                    onChange={(value) =>
                      setDraft({ ...draft, modelId: value ?? "" })
                    }
                  />
                  {connection && !connection.configured ? (
                    <Alert color="orange">
                      API 주소와 인증 키를 먼저 설정하세요. API 관리에서 설정할
                      수 있습니다.
                    </Alert>
                  ) : null}
                </Stack>
                {change.error ? (
                  <Alert color="red" role="alert" title="변경하지 못했습니다">
                    {change.error.message}
                  </Alert>
                ) : null}
                {saved === feature.id ? (
                  <Alert color="teal" role="status">
                    저장했습니다. 새 작업부터 이 기능에 적용됩니다.
                  </Alert>
                ) : null}
                <Group justify="space-between" className={classes.apply}>
                  <Text size="xs" c="dimmed">
                    {dirty
                      ? "새 작업부터 이 기능에 적용됩니다."
                      : "변경사항이 없습니다."}
                  </Text>
                  <Button
                    disabled={!dirty || !connection?.configured || !model}
                    loading={change.isPending}
                    onClick={() =>
                      change.mutate(
                        () => assignModel(feature.id, draft, config.revision),
                        {
                          onSuccess: () => {
                            setDrafts((prev) => {
                              const next = { ...prev };
                              delete next[feature.id];
                              return next;
                            });
                            setSaved(feature.id);
                          },
                        },
                      )
                    }
                  >
                    변경사항 적용
                  </Button>
                </Group>
                <ChangeHistory changes={config.changes} />
              </Stack>
            </Paper>
          </div>
        </>
      ) : null}
    </DataPage>
  );
}
