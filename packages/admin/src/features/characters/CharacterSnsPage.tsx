import {
  Anchor,
  Badge,
  Button,
  Group,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { ArrowSquareOut, MagnifyingGlass } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { previewUrl } from "../../shared/media/previewUrl";
import { DataPage } from "../../shared/ui/DataPage";
import {
  fetchCharacterReferenceDirectory,
  type CharacterReferenceDirectoryItem,
} from "./api";
import classes from "./CharacterSnsPage.module.css";

export function CharacterSnsPage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const search = params.get("search") ?? "";
  const registration = params.get("registration") ?? "all";
  const cursor = params.get("cursor") ?? "";
  const previousCursors: string[] = location.state?.previousCursors ?? [];
  const directory = useQuery({
    queryKey: ["character-reference-directory", search, registration, cursor],
    queryFn: () =>
      fetchCharacterReferenceDirectory({ search, registration, cursor }),
  });
  const goTo = (nextCursor: string, previous: string[]) => {
    const next = new URLSearchParams(params);
    if (nextCursor) next.set("cursor", nextCursor);
    else next.delete("cursor");
    setParams(next, { state: { previousCursors: previous } });
  };

  return (
    <DataPage
      title="SNS 레퍼런스"
      isPending={directory.isPending}
      error={directory.error}
      isEmpty={directory.data?.items.length === 0}
      emptyLabel="조건에 맞는 캐릭터가 없습니다."
      actions={
        <Stack gap="xs">
          <ReferenceFilters
            key={`${search}/${registration}`}
            search={search}
            registration={registration}
            onChange={(nextSearch, nextRegistration) => {
              const next = new URLSearchParams();
              if (nextSearch) next.set("search", nextSearch);
              if (nextRegistration !== "all")
                next.set("registration", nextRegistration);
              setParams(next, { state: { previousCursors: [] } });
            }}
          />
          {directory.error ? (
            <Button
              variant="default"
              loading={directory.isFetching}
              onClick={() => void directory.refetch()}
            >
              다시 시도
            </Button>
          ) : null}
          {cursor ? (
            <Button variant="subtle" color="ink" onClick={() => goTo("", [])}>
              첫 페이지로
            </Button>
          ) : null}
        </Stack>
      }
    >
      <Text size="sm" c="ink.6">
        이름·핸들로 검색하거나 등록 상태를 선택하세요. 한 페이지에 최대 20명을
        표시합니다.
      </Text>
      <Paper className={classes.surface}>
        <Table.ScrollContainer minWidth={720}>
          <Table aria-label="캐릭터별 SNS 레퍼런스" verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>캐릭터</Table.Th>
                <Table.Th>등록 상태</Table.Th>
                <Table.Th>SNS 링크</Table.Th>
                <Table.Th>관리</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {directory.data?.items.map((character) => (
                <Table.Tr key={character.id}>
                  <Table.Td className={classes.character}>
                    <Text fw={650}>{character.displayName}</Text>
                    <Text size="sm" c="ink.6" className={classes.url}>
                      @{character.publicId}
                    </Text>
                  </Table.Td>
                  <Table.Td className={classes.status}>
                    <Badge
                      variant="light"
                      color={character.referenceLinks.length ? "teal" : "gray"}
                    >
                      {character.referenceLinks.length
                        ? `${character.referenceLinks.length}개 등록`
                        : "미등록"}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <ReferenceLinks character={character} />
                  </Table.Td>
                  <Table.Td>
                    <Button
                      component={Link}
                      to={`/characters/${encodeURIComponent(character.id)}?section=profile`}
                      variant="default"
                      size="sm"
                      aria-label={`${character.displayName} 링크 관리`}
                    >
                      링크 관리
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      <Group justify="space-between" aria-label="페이지 이동">
        <Text size="sm" c="ink.6">
          현재 페이지 {directory.data?.items.length ?? 0}명
        </Text>
        <Group gap="xs">
          <Button
            variant="default"
            disabled={!cursor || directory.isFetching}
            onClick={() =>
              goTo(previousCursors.at(-1) ?? "", previousCursors.slice(0, -1))
            }
          >
            이전
          </Button>
          <Button
            variant="default"
            disabled={!directory.data?.nextCursor || directory.isFetching}
            onClick={() =>
              goTo(directory.data!.nextCursor!, [...previousCursors, cursor])
            }
          >
            다음
          </Button>
        </Group>
      </Group>
    </DataPage>
  );
}

function ReferenceFilters({
  search,
  registration,
  onChange,
}: {
  search: string;
  registration: string;
  onChange: (search: string, registration: string) => void;
}) {
  const form = useForm({ mode: "uncontrolled", initialValues: { search } });
  return (
    <form
      onSubmit={form.onSubmit((values) =>
        onChange(values.search.trim(), registration),
      )}
      className={classes.filters}
    >
      <TextInput
        className={classes.search}
        label="캐릭터 검색"
        placeholder="이름 또는 핸들"
        maxLength={100}
        leftSection={<MagnifyingGlass size={16} aria-hidden />}
        key={form.key("search")}
        {...form.getInputProps("search")}
      />
      <Select
        className={classes.registration}
        label="등록 상태"
        value={registration}
        allowDeselect={false}
        data={[
          { value: "all", label: "전체" },
          { value: "registered", label: "등록" },
          { value: "missing", label: "미등록" },
        ]}
        onChange={(value) =>
          onChange(form.getValues().search.trim(), value ?? "all")
        }
      />
      <Button type="submit" variant="default">
        검색
      </Button>
    </form>
  );
}

function ReferenceLinks({
  character,
}: {
  character: CharacterReferenceDirectoryItem;
}) {
  const link = (
    reference: CharacterReferenceDirectoryItem["referenceLinks"][number],
  ) => {
    const href = previewUrl(reference.url);
    return href ? (
      <Anchor
        key={reference.id}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        c="ink.8"
        size="sm"
        className={classes.link}
        aria-label={`${character.displayName} 참조 SNS ${reference.url} 새 탭에서 열기`}
      >
        <span className={classes.url}>{reference.url}</span>
        <ArrowSquareOut size={16} aria-hidden className={classes.icon} />
      </Anchor>
    ) : (
      <Text key={reference.id} size="sm" className={classes.url}>
        {reference.url}
      </Text>
    );
  };
  if (!character.referenceLinks.length)
    return (
      <Text size="sm" c="ink.6">
        등록된 링크 없음
      </Text>
    );
  return (
    <Stack gap="xs">
      {link(character.referenceLinks[0])}
      {character.referenceLinks.length > 1 ? (
        <details>
          <summary className={classes.summary}>
            추가 링크 {character.referenceLinks.length - 1}개 보기
          </summary>
          <Stack gap="xs">{character.referenceLinks.slice(1).map(link)}</Stack>
        </details>
      ) : null}
    </Stack>
  );
}
