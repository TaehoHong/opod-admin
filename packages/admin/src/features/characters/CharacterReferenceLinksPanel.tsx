import {
  Anchor,
  Badge,
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
import { useEffect, useState } from "react";
import { ArrowSquareOut } from "@phosphor-icons/react";
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
import { Link } from "react-router-dom";
import classes from "./CharacterReferenceLinksPanel.module.css";

export function CharacterReferenceLinksPanel({
  characterId,
  title = "모티브·참조 링크",
  headingOrder = 5,
  onBusyChange,
}: {
  characterId: string;
  title?: string;
  headingOrder?: 2 | 5;
  onBusyChange?: (busy: boolean) => void;
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
  useEffect(() => {
    onBusyChange?.(editing !== null || remove.isPending);
    return () => onBusyChange?.(false);
  }, [editing, remove.isPending, onBusyChange]);
  const saved = async () => {
    setEditing(null);
    await invalidate();
  };

  return (
    <Paper p="lg" component="section" aria-label={title}>
      <Stack gap="sm">
        <Group justify="space-between">
          <Group gap="xs">
            <Title order={headingOrder} size={headingOrder === 2 ? "h4" : "h5"}>
              {title}
            </Title>
            {links.data ? (
              <Badge color="ink" variant="light">
                {links.data.length}개
              </Badge>
            ) : null}
          </Group>
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
        {editing === "new" ? (
          <ReferenceLinkForm
            characterId={characterId}
            onSaved={saved}
            onCancel={() => setEditing(null)}
          />
        ) : null}
        {links.isPending ? (
          <Loader size="sm" aria-label="참조 링크 불러오는 중" />
        ) : null}
        {links.error ? (
          <Stack gap="sm">
            <OperationErrorAlert
              failure={operationFailure(
                links.error,
                "참조 링크를 불러오지 못했습니다.",
              )}
            />
            <Button
              variant="default"
              loading={links.isFetching}
              onClick={() => void links.refetch()}
            >
              다시 시도
            </Button>
          </Stack>
        ) : null}
        {links.data?.length === 0 ? (
          <Text size="sm" c="dimmed">
            등록된 참조 링크가 없습니다.
          </Text>
        ) : null}
        {links.data?.length ? (
          <ul className={classes.links}>
            {links.data.map((link) => (
              <li
                key={link.id}
                className={classes.row}
                data-editing={editing === link.id || undefined}
                aria-label={`참조 링크 ${link.url}`}
              >
                {editing === link.id ? (
                  <ReferenceLinkForm
                    characterId={characterId}
                    link={link}
                    onSaved={saved}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <>
                    {previewUrl(link.url) ? (
                      <Anchor
                        href={previewUrl(link.url)!}
                        target="_blank"
                        rel="noopener noreferrer"
                        size="sm"
                        c="ink.8"
                        className={classes.link}
                        aria-label={`${link.url} 새 탭에서 열기`}
                      >
                        <span className={classes.url}>{link.url}</span>
                        <ArrowSquareOut
                          size={16}
                          aria-hidden
                          className={classes.icon}
                        />
                      </Anchor>
                    ) : (
                      <Text size="sm" className={classes.url}>
                        {link.url}
                      </Text>
                    )}
                    <Group gap="xs">
                      <Button
                        size="xs"
                        variant="default"
                        disabled={editing !== null || remove.isPending}
                        component={Link}
                        to={`/sns-references?account=${encodeURIComponent(link.id)}`}
                      >
                        수집 미디어
                      </Button>
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
                        loading={
                          remove.isPending && remove.variables === link.id
                        }
                        onClick={() => remove.mutate(link.id)}
                      >
                        삭제
                      </Button>
                    </Group>
                  </>
                )}
              </li>
            ))}
          </ul>
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
          autoFocus
          label="참조 URL"
          placeholder="https://www.instagram.com/account/"
          description="Instagram 계정 프로필 링크를 입력하세요. 삭제하면 이 캐릭터의 연결만 해제됩니다."
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
