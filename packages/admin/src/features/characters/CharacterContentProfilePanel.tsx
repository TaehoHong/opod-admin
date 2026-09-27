import {
  Alert,
  Button,
  Group,
  Loader,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchContentProfile,
  updateContentProfile,
  type CharacterContentProfile,
} from "./api";

export function CharacterContentProfilePanel({
  characterId,
}: {
  characterId: string;
}) {
  const query = useQuery({
    queryKey: ["character", characterId, "content-profile"],
    queryFn: () => fetchContentProfile(characterId),
  });
  if (query.isPending)
    return <Loader aria-label="게시물 제작 설정 불러오는 중" />;
  if (query.error)
    return (
      <Alert
        color="red"
        role="alert"
        title="게시물 제작 설정을 불러오지 못했습니다"
      >
        <Stack>
          <Text>{query.error.message}</Text>
          <Button variant="default" onClick={() => void query.refetch()}>
            다시 시도
          </Button>
        </Stack>
      </Alert>
    );
  return (
    <ContentProfileForm
      key={characterId}
      characterId={characterId}
      profile={query.data}
    />
  );
}

function ContentProfileForm({
  characterId,
  profile,
}: {
  characterId: string;
  profile: CharacterContentProfile;
}) {
  const cache = useQueryClient();
  const form = useForm({
    mode: "uncontrolled",
    initialValues: profile,
    validate: (values) =>
      Object.fromEntries(
        Object.entries(values)
          .filter(([, value]) => value.length > 10000)
          .map(([key]) => [key, "10,000자 이내로 입력하세요."]),
      ),
  });
  const save = useMutation({
    mutationFn: (values: CharacterContentProfile) =>
      updateContentProfile(characterId, values),
    onSuccess: (saved) => {
      cache.setQueryData(["character", characterId, "content-profile"], saved);
      form.setValues(saved);
      form.resetDirty(saved);
    },
  });
  return (
    <form onSubmit={form.onSubmit((values) => save.mutate(values))}>
      <Stack>
        <Text size="sm" c="dimmed">
          게시물 생성에만 사용합니다. 채팅에는 적용되지 않습니다. 비워 둔 항목은
          별도 지침 없이 생성합니다.
        </Text>
        <Textarea
          label="계정 컨셉"
          description="계정의 중심 방향과 자연스러운 일상 변주를 적어주세요. 소재를 일일이 나열할 필요는 없습니다."
          autosize
          minRows={3}
          maxLength={10000}
          key={form.key("accountConcept")}
          {...form.getInputProps("accountConcept")}
          disabled={save.isPending}
        />
        <Textarea
          label="사진 스타일"
          description="촬영 방식, 구도, 분위기 등"
          autosize
          minRows={3}
          maxLength={10000}
          key={form.key("imageStyle")}
          {...form.getInputProps("imageStyle")}
          disabled={save.isPending}
        />
        <Textarea
          label="캡션 스타일"
          description="게시글의 길이, 표현 방식, 이모지와 해시태그 사용 등"
          autosize
          minRows={3}
          maxLength={10000}
          key={form.key("captionStyle")}
          {...form.getInputProps("captionStyle")}
          disabled={save.isPending}
        />
        <Textarea
          label="제작 제한"
          description="게시물 제작에서 지켜야 할 기준과 피할 표현"
          autosize
          minRows={3}
          maxLength={10000}
          key={form.key("constraints")}
          {...form.getInputProps("constraints")}
          disabled={save.isPending}
        />
        {save.error ? (
          <Alert role="alert" color="red" title="저장하지 못했습니다">
            {save.error.message}
          </Alert>
        ) : null}
        <Group>
          <Button type="submit" loading={save.isPending}>
            저장
          </Button>
          {save.isSuccess && !form.isDirty() ? (
            <Text role="status" size="sm" c="teal">
              저장했습니다.
            </Text>
          ) : null}
        </Group>
      </Stack>
    </form>
  );
}
