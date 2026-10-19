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
import { CaretRight, MagnifyingGlass } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { DataPage } from "../../shared/ui/DataPage";
import { fetchCharacterReferenceDirectory } from "./api";
import classes from "./CharacterSnsPage.module.css";

export function CharacterSnsPage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
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
      title="캐릭터 연결 관리"
      isPending={directory.isPending}
      error={directory.error}
      actions={
        <Group gap="xs">
          <Button
            component={Link}
            to="/sns-references/library"
            variant="default"
          >
            미디어 라이브러리
          </Button>
          {directory.error ? (
            <Button variant="default" onClick={() => void directory.refetch()}>
              다시 시도
            </Button>
          ) : null}
        </Group>
      }
      filters={
        <Paper p="md" component="section" aria-label="캐릭터 검색 조건">
          <ReferenceFilters
            key={`${search}/${registration}`}
            search={search}
            registration={registration}
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
        </Paper>
      }
    >
      <Paper p="md" component="section" aria-label="캐릭터 목록">
        <Stack gap="md">
          <Text size="sm" c="ink.6">
            {directory.data?.items.length ?? 0}명 표시
          </Text>
          <Table.ScrollContainer minWidth={280}>
            <Table highlightOnHover aria-label="캐릭터별 SNS 레퍼런스">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>캐릭터</Table.Th>
                  <Table.Th>레퍼런스</Table.Th>
                  <Table.Th aria-label="상세 보기" />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {directory.data?.items.map((character) => {
                  const to = `/sns-references/${encodeURIComponent(character.id)}${location.search}`;
                  return (
                    <Table.Tr
                      key={character.id}
                      className={classes.row}
                      onClick={() => navigate(to, { state: location.state })}
                    >
                      <Table.Td>
                        <Anchor
                          component={Link}
                          to={to}
                          state={location.state}
                          onClick={(event) => event.stopPropagation()}
                          c="ink.9"
                          fw={650}
                          className={classes.name}
                          aria-label={`${character.displayName}의 SNS 레퍼런스 보기`}
                        >
                          {character.displayName}
                        </Anchor>
                        <Text size="xs" c="ink.6" className={classes.handle}>
                          @{character.publicId}
                        </Text>
                      </Table.Td>
                      <Table.Td className={classes.count}>
                        <Badge
                          variant="light"
                          color={
                            character.referenceLinks.length ? "teal" : "gray"
                          }
                        >
                          {character.referenceLinks.length}개
                        </Badge>
                      </Table.Td>
                      <Table.Td className={classes.chevron}>
                        <CaretRight size={18} aria-hidden />
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
                {directory.data?.items.length === 0 ? (
                  <Table.Tr>
                    <Table.Td colSpan={3}>
                      <Text py="lg" c="ink.6" role="status">
                        조건에 맞는 캐릭터가 없습니다.
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ) : null}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          <Group
            justify="space-between"
            gap="xs"
            aria-label="캐릭터 페이지 이동"
          >
            <Button
              size="xs"
              variant="subtle"
              color="ink"
              disabled={!cursor || directory.isFetching}
              onClick={() => goTo("", [])}
            >
              처음
            </Button>
            <Group gap="xs">
              <Button
                size="xs"
                variant="default"
                disabled={!cursor || directory.isFetching}
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
                disabled={!directory.data?.nextCursor || directory.isFetching}
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
        leftSection={<MagnifyingGlass size={16} aria-hidden />}
        key={form.key("search")}
        {...form.getInputProps("search")}
      />
      <Select
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
