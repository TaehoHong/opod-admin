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
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CharacterSelect } from "../../shared/ui/CharacterSelect";
import { DataPage } from "../../shared/ui/DataPage";
import { createDraft } from "../drafts/api";

export function PostBriefCreatePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const form = useForm({
    mode: "uncontrolled",
    initialValues: {
      characterId: params.get("characterId") ?? "",
      contentType: "feed",
      sceneHint: "",
      scheduledAt: "",
    },
    validate: {
      characterId: (value) => (value ? null : "캐릭터를 선택해 주세요"),
    },
  });
  const create = useMutation({
    mutationFn: (values: typeof form.values) =>
      createDraft({
        characterId: values.characterId,
        contentType: values.contentType as "feed" | "reel",
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
          <Textarea
            label="장면·주제 요청"
            description="선택 · Agent가 기획할 때 참고합니다."
            minRows={4}
            placeholder="예: 비 오는 날 창가 카페에서 필름 카메라를 닦는 장면"
            key={form.key("sceneHint")}
            {...form.getInputProps("sceneHint")}
          />
          <TextInput
            label="게시 일정"
            description="비우면 승인 후 즉시 게시합니다."
            type="datetime-local"
            w={280}
            key={form.key("scheduledAt")}
            {...form.getInputProps("scheduledAt")}
          />
          <Alert color="blue">
            게시물 만들기에서 시작한 작업은 단계마다 직접 확인하고 실행합니다.
          </Alert>
          {create.isError ? (
            <Alert color="red" role="alert" title="저장하지 못했습니다">
              {create.error.message}
            </Alert>
          ) : null}
          <Group>
            <Button type="submit" loading={create.isPending}>
              저장하고 기획으로
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
