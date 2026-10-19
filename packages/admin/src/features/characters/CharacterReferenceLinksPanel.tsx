import {
  Anchor,
  Button,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { previewUrl } from "../../shared/media/previewUrl";
import { MutationAlert } from "../../shared/ui/MutationAlert";
import {
  OperationErrorAlert,
  operationFailure,
} from "../../shared/ui/OperationErrorAlert";
import {
  deleteCharacterReferenceLink,
  fetchCharacterReferenceLinks,
  saveCharacterReferenceLink,
  type CharacterReferenceLink,
} from "./api";

export function CharacterReferenceLinksPanel({
  characterId,
}: {
  characterId: string;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const queryKey = ["character", characterId, "reference-links"];
  const links = useQuery({
    queryKey,
    queryFn: () => fetchCharacterReferenceLinks(characterId),
  });
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey }),
      queryClient.invalidateQueries({
        queryKey: ["character-reference-directory"],
      }),
    ]);
  const remove = useMutation({
    mutationFn: (id: string) => deleteCharacterReferenceLink(characterId, id),
    onSuccess: invalidate,
  });
  const saved = async () => {
    setEditing(null);
    await invalidate();
  };

  return (
    <Paper p="md" component="section">
      <Stack gap="sm">
        <Group justify="space-between">
          <Title order={5}>모티브·참조 링크</Title>
          <Button
            variant="default"
            disabled={editing !== null || remove.isPending || !links.data}
            onClick={() => setEditing("new")}
          >
            링크 추가
          </Button>
        </Group>
        <Text size="sm" c="dimmed">
          모티브 SNS와 캐릭터 제작에 참고한 주소를 관리합니다.
        </Text>
        {links.isPending ? (
          <Loader size="sm" aria-label="참조 링크 불러오는 중" />
        ) : null}
        {links.error ? (
          <OperationErrorAlert
            failure={operationFailure(
              links.error,
              "참조 링크를 불러오지 못했습니다.",
            )}
          />
        ) : null}
        {links.data?.length === 0 ? (
          <Text size="sm" c="dimmed">
            등록된 참조 링크가 없습니다.
          </Text>
        ) : null}
        {links.data?.map((link) =>
          editing === link.id ? (
            <ReferenceLinkForm
              key={link.id}
              characterId={characterId}
              link={link}
              onSaved={saved}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <Stack key={link.id} gap="xs">
              {previewUrl(link.url) ? (
                <Anchor
                  href={previewUrl(link.url)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  size="sm"
                  c="ink.8"
                  lineClamp={2}
                  aria-label={`${link.url} 새 탭에서 열기`}
                >
                  {link.url}
                </Anchor>
              ) : (
                <Text size="sm">{link.url}</Text>
              )}
              <Group gap="xs">
                <Button
                  size="xs"
                  variant="default"
                  disabled={editing !== null || remove.isPending}
                  onClick={() => setEditing(link.id)}
                >
                  수정
                </Button>
                <Button
                  size="xs"
                  variant="subtle"
                  color="red"
                  disabled={editing !== null || remove.isPending}
                  loading={remove.isPending && remove.variables === link.id}
                  onClick={() => remove.mutate(link.id)}
                >
                  삭제
                </Button>
              </Group>
            </Stack>
          ),
        )}
        {editing === "new" ? (
          <ReferenceLinkForm
            characterId={characterId}
            onSaved={saved}
            onCancel={() => setEditing(null)}
          />
        ) : null}
        <MutationAlert
          mutation={remove}
          success="참조 링크를 삭제했습니다."
          errorTitle="참조 링크를 삭제하지 못했습니다."
        />
      </Stack>
    </Paper>
  );
}

function ReferenceLinkForm({
  characterId,
  link,
  onSaved,
  onCancel,
}: {
  characterId: string;
  link?: CharacterReferenceLink;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const form = useForm({
    mode: "uncontrolled",
    initialValues: { url: link?.url ?? "" },
    validate: {
      url: (value) =>
        previewUrl(value.trim())
          ? null
          : "HTTP 또는 HTTPS 주소를 입력해 주세요.",
    },
  });
  const save = useMutation({
    mutationFn: (values: typeof form.values) =>
      saveCharacterReferenceLink(characterId, values.url.trim(), link?.id),
    onSuccess: onSaved,
  });
  return (
    <form onSubmit={form.onSubmit((values) => save.mutate(values))}>
      <Stack gap="sm">
        <TextInput
          label="참조 URL"
          placeholder="https://www.instagram.com/account/"
          key={form.key("url")}
          {...form.getInputProps("url")}
        />
        <MutationAlert
          mutation={save}
          success="참조 링크를 저장했습니다."
          errorTitle="참조 링크를 저장하지 못했습니다."
        />
        <Group gap="xs">
          <Button type="submit" loading={save.isPending}>
            저장
          </Button>
          <Button
            variant="default"
            disabled={save.isPending}
            onClick={onCancel}
          >
            취소
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
