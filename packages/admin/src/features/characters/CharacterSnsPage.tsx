import {
  Badge,
  Button,
  Group,
  Loader,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { ArrowLeft, MagnifyingGlass } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { DataPage } from "../../shared/ui/DataPage";
import {
  OperationErrorAlert,
  operationFailure,
} from "../../shared/ui/OperationErrorAlert";
import { CharacterReferenceLinksPanel } from "./CharacterReferenceLinksPanel";
import { fetchCharacter, fetchCharacterReferenceDirectory } from "./api";
import classes from "./CharacterSnsPage.module.css";

export function CharacterSnsPage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const search = params.get("search") ?? "";
  const registration = params.get("registration") ?? "all";
  const cursor = params.get("cursor") ?? "";
  const previousCursors: string[] = location.state?.previousCursors ?? [];
  const directory = useQuery({
    queryKey: ["character-reference-directory", search, registration, cursor],
    queryFn: () =>
      fetchCharacterReferenceDirectory({ search, registration, cursor }),
  });
  const explicitSelection = params.get("character");
  const selectedId = explicitSelection ?? undefined;
  const selectedFromPage = directory.data?.items.find(
    (c) => c.id === selectedId,
  );
  const selectedQuery = useQuery({
    queryKey: ["character", selectedId],
    queryFn: () => fetchCharacter(selectedId!),
    enabled: Boolean(selectedId) && !directory.isPending && !selectedFromPage,
  });
  const selected = selectedFromPage ?? selectedQuery.data;
  const select = (id: string | null) => {
    if (busy) return;
    const next = new URLSearchParams(params);
    if (id) next.set("character", id);
    else next.delete("character");
    setParams(next, { state: location.state });
  };
  const goTo = (nextCursor: string, previous: string[]) => {
    const next = new URLSearchParams(params);
    if (nextCursor) next.set("cursor", nextCursor);
    else next.delete("cursor");
    setParams(next, { state: { previousCursors: previous } });
  };

  return (
    <DataPage title="SNS 레퍼런스" isPending={false}>
      <div
        className={classes.workspace}
        data-selected={Boolean(explicitSelection)}
      >
        <Paper
          component="section"
          aria-label="캐릭터 목록"
          p="md"
          className={classes.sidebar}
        >
          <Stack gap="md">
            <Group justify="space-between">
              <Title order={2} size="h4">
                캐릭터
              </Title>
              <Text size="sm" c="ink.6">
                {directory.data?.items.length ?? 0}명 표시
              </Text>
            </Group>
            <ReferenceFilters
              key={`${search}/${registration}`}
              search={search}
              registration={registration}
              disabled={busy}
              onChange={(nextSearch, nextRegistration) => {
                const next = new URLSearchParams(params);
                next.delete("cursor");
                if (nextSearch) next.set("search", nextSearch);
                else next.delete("search");
                if (nextRegistration !== "all")
                  next.set("registration", nextRegistration);
                else next.delete("registration");
                setParams(next, { state: { previousCursors: [] } });
              }}
            />
            {busy ? (
              <Text size="sm" c="ink.6" role="status">
                링크 편집을 저장하거나 취소한 뒤 캐릭터를 바꿀 수 있습니다.
              </Text>
            ) : null}
            {directory.isPending ? (
              <Group role="status" gap="xs">
                <Loader size="sm" aria-hidden />
                <Text size="sm">캐릭터 불러오는 중…</Text>
              </Group>
            ) : null}
            {directory.error ? (
              <Stack gap="sm">
                <OperationErrorAlert
                  failure={operationFailure(
                    directory.error,
                    "캐릭터를 불러오지 못했습니다.",
                  )}
                />
                <Button
                  variant="default"
                  onClick={() => void directory.refetch()}
                  loading={directory.isFetching}
                >
                  다시 시도
                </Button>
              </Stack>
            ) : null}
            {!directory.isPending &&
            !directory.error &&
            directory.data?.items.length === 0 ? (
              <Text size="sm" c="ink.6" role="status">
                조건에 맞는 캐릭터가 없습니다.
              </Text>
            ) : null}
            {directory.data?.items.length ? (
              <nav aria-label="캐릭터 선택" className={classes.characterList}>
                {directory.data.items.map((character) => (
                  <UnstyledButton
                    key={character.id}
                    className={classes.character}
                    aria-label={`${character.displayName} 선택`}
                    aria-pressed={selectedId === character.id}
                    aria-controls="character-reference-detail"
                    disabled={busy}
                    onClick={() => select(character.id)}
                  >
                    <span className={classes.identity}>
                      <Text component="span" size="sm" fw={650}>
                        {character.displayName}
                      </Text>
                      <Text component="span" size="xs" c="ink.6">
                        @{character.publicId}
                      </Text>
                    </span>
                    <Badge
                      variant="light"
                      color={character.referenceLinks.length ? "teal" : "gray"}
                    >
                      레퍼런스 {character.referenceLinks.length}개
                    </Badge>
                  </UnstyledButton>
                ))}
              </nav>
            ) : null}
            <Group
              justify="space-between"
              gap="xs"
              aria-label="캐릭터 페이지 이동"
            >
              <Button
                size="xs"
                variant="subtle"
                color="ink"
                disabled={busy || !cursor || directory.isFetching}
                onClick={() => goTo("", [])}
              >
                처음
              </Button>
              <Group gap="xs">
                <Button
                  size="xs"
                  variant="default"
                  disabled={busy || !cursor || directory.isFetching}
                  onClick={() =>
                    goTo(
                      previousCursors.at(-1) ?? "",
                      previousCursors.slice(0, -1),
                    )
                  }
                >
                  이전
                </Button>
                <Button
                  size="xs"
                  variant="default"
                  disabled={
                    busy || !directory.data?.nextCursor || directory.isFetching
                  }
                  onClick={() =>
                    goTo(directory.data!.nextCursor!, [
                      ...previousCursors,
                      cursor,
                    ])
                  }
                >
                  다음
                </Button>
              </Group>
            </Group>
          </Stack>
        </Paper>
        <Stack
          gap="md"
          id="character-reference-detail"
          className={classes.detail}
        >
          {explicitSelection ? (
            <Button
              className={classes.back}
              variant="default"
              leftSection={<ArrowLeft size={16} aria-hidden />}
              disabled={busy}
              onClick={() => select(null)}
            >
              캐릭터 목록
            </Button>
          ) : null}
          {selected ? (
            <CharacterReferenceLinksPanel
              key={selected.id}
              characterId={selected.id}
              title={`${selected.displayName}의 SNS 레퍼런스`}
              headingOrder={2}
              onBusyChange={setBusy}
            />
          ) : selectedId && selectedQuery.isPending ? (
            <Paper p="lg" role="status">
              <Group gap="sm">
                <Loader size="sm" aria-hidden />
                <Text>선택한 캐릭터 불러오는 중…</Text>
              </Group>
            </Paper>
          ) : selectedQuery.error ? (
            <Paper p="lg">
              <Stack>
                <OperationErrorAlert
                  failure={operationFailure(
                    selectedQuery.error,
                    "선택한 캐릭터를 불러오지 못했습니다.",
                  )}
                />
                <Button
                  variant="default"
                  onClick={() => void selectedQuery.refetch()}
                >
                  다시 시도
                </Button>
              </Stack>
            </Paper>
          ) : (
            <Paper p="xl">
              <Stack gap="sm">
                <Title order={2} size="h4">
                  캐릭터를 선택하세요
                </Title>
                <Text c="ink.6" size="sm">
                  캐릭터를 선택하면 연결된 SNS 레퍼런스를 모두 보고 관리할 수
                  있습니다.
                </Text>
              </Stack>
            </Paper>
          )}
        </Stack>
      </div>
    </DataPage>
  );
}

function ReferenceFilters({
  search,
  registration,
  disabled,
  onChange,
}: {
  search: string;
  registration: string;
  disabled: boolean;
  onChange: (search: string, registration: string) => void;
}) {
  const form = useForm({ mode: "uncontrolled", initialValues: { search } });
  return (
    <form
      className={classes.filters}
      onSubmit={form.onSubmit((values) =>
        onChange(values.search.trim(), registration),
      )}
    >
      <TextInput
        className={classes.search}
        label="캐릭터 검색"
        placeholder="이름 또는 핸들"
        maxLength={100}
        disabled={disabled}
        leftSection={<MagnifyingGlass size={16} aria-hidden />}
        key={form.key("search")}
        {...form.getInputProps("search")}
      />
      <Select
        label="등록 상태"
        value={registration}
        disabled={disabled}
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
      <Button type="submit" variant="default" disabled={disabled}>
        검색
      </Button>
    </form>
  );
}
