import { useState } from "react";
import { fetchNaturalAgent } from "../post-generation-agents/api";
import {
  Alert,
  Button,
  Group,
  Select,
  Stack,
  TextInput,
  Textarea,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CharacterSelect } from "../../shared/ui/CharacterSelect";
import { DataPage } from "../../shared/ui/DataPage";
import {
  OperationErrorAlert,
  operationFailure,
} from "../../shared/ui/OperationErrorAlert";
import { createDraft } from "../drafts/api";

export function PostBriefCreatePage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState("manual");
  const natural = useQuery({
    queryKey: ["natural-post-agent"],
    queryFn: fetchNaturalAgent,
  });
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const form = useForm({
    mode: "uncontrolled",
    initialValues: {
      characterId: params.get("characterId") ?? "",
      contentType: "feed",
      postGenerationAgent: "existing",
      mode: "manual",
      sceneHint: "",
      scheduledAt: "",
    },
    onValuesChange: (values) => setMode(values.mode),
    validate: {
      characterId: (value) => (value ? null : "캐릭터를 선택해 주세요"),
      sceneHint: (value) =>
        value.length <= 2000
          ? null
          : "장면·주제 요청은 2,000자 이하여야 합니다",
    },
  });
  const create = useMutation({
    mutationFn: (values: typeof form.values) =>
      createDraft({
        characterId: values.characterId,
        contentType: values.contentType as "feed" | "reel",
        postGenerationAgent: values.postGenerationAgent as
          "existing" | "natural-v1",
        mode: values.mode as "manual" | "auto",
        ...(values.sceneHint.trim()
          ? { sceneHint: values.sceneHint.trim() }
          : {}),
        ...(values.scheduledAt
          ? { scheduledAt: new Date(values.scheduledAt).toISOString() }
          : {}),
      }),
    onSuccess: (draft) => {
      void queryClient.invalidateQueries({ queryKey: ["post-work-items"] });
      void queryClient.invalidateQueries({ queryKey: ["pending-counts"] });
      void navigate(`/posts/${encodeURIComponent(draft.id)}/plan`);
    },
  });

  return (
    <DataPage title="새 게시물 · ① 브리프" isPending={false}>
      <form onSubmit={form.onSubmit((values) => create.mutate(values))}>
        <Stack maw={720}>
          <CharacterSelect
            label="캐릭터"
            key={form.key("characterId")}
            {...form.getInputProps("characterId")}
          />
          <Select
            label="콘텐츠 형식"
            data={[
              { value: "feed", label: "피드" },
              { value: "reel", label: "릴" },
            ]}
            allowDeselect={false}
            key={form.key("contentType")}
            {...form.getInputProps("contentType")}
          />
          <Select
            label="게시물 생성 Agent"
            description={
              natural.isPending
                ? "새 Agent 설정을 확인하는 중입니다."
                : natural.data?.current
                  ? "Agent와 진행 방식을 각각 선택하세요."
                  : "새 Agent를 사용하려면 Agent 관리에서 설정을 먼저 저장하세요."
            }
            data={[
              { value: "existing", label: "기존 Agent" },
              {
                value: "natural-v1",
                label: "새 Agent · 자연스러운 사진",
                disabled: !natural.data?.current,
              },
            ]}
            allowDeselect={false}
            key={form.key("postGenerationAgent")}
            {...form.getInputProps("postGenerationAgent")}
          />
          <Select
            label="진행 방식"
            description="두 Agent 모두 자동·수동으로 진행할 수 있습니다."
            data={[
              { value: "manual", label: "수동 · 단계별 실행" },
              { value: "auto", label: "자동 · 연속 진행" },
            ]}
            allowDeselect={false}
            key={form.key("mode")}
            {...form.getInputProps("mode")}
          />
          {natural.error ? (
            <OperationErrorAlert
              failure={operationFailure(
                natural.error,
                "새 Agent 설정을 확인하지 못했습니다.",
              )}
            />
          ) : null}
          <Textarea
            label="장면·주제 요청"
            description="선택 · Agent가 기획할 때 참고합니다."
            minRows={4}
            maxLength={2000}
            placeholder="예: 비 오는 날 창가 카페에서 필름 카메라를 닦는 장면"
            key={form.key("sceneHint")}
            {...form.getInputProps("sceneHint")}
          />
          <TextInput
            label="게시 일정"
            description={
              mode === "auto"
                ? "비우면 제작 완료 후 자동 게시합니다."
                : "단계별로 실행하고 마지막에 직접 게시합니다."
            }
            type="datetime-local"
            w={280}
            key={form.key("scheduledAt")}
            {...form.getInputProps("scheduledAt")}
          />
          <Alert color="blue">
            {mode === "auto"
              ? "기획부터 게시까지 자동 진행합니다. 입력 보완·검수 불합격은 보류하며, 자동 워커가 켜져 있어야 실행됩니다."
              : "각 단계가 끝나면 대기합니다. 다음 단계는 직접 실행할 때만 진행합니다."}
          </Alert>
          {create.isError ? (
            <OperationErrorAlert
              failure={operationFailure(
                create.error,
                "브리프를 저장하지 못했습니다.",
              )}
            />
          ) : null}
          <Group>
            <Button type="submit" loading={create.isPending}>
              {mode === "auto" ? "자동 제작 시작" : "저장하고 기획으로"}
            </Button>
            <Button
              variant="default"
              disabled={create.isPending}
              onClick={() => void navigate("/posts")}
            >
              취소
            </Button>
          </Group>
        </Stack>
      </form>
    </DataPage>
  );
}
