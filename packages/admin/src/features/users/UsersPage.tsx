import { Button, Group, Table, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useState } from "react";
import { useCursorList } from "../../shared/api/useCursorList";
import { DataPage, LoadMore } from "../../shared/ui/DataPage";
import { fetchUsers } from "./api";

export function UsersPage() {
  const [search, setSearch] = useState("");
  // 검색은 제출 시점에만 반영하면 되므로 uncontrolled 기본 모드를 쓴다
  // (docs/04-design-rules.md:72-73).
  const form = useForm({ mode: "uncontrolled", initialValues: { q: "" } });

  const users = useCursorList(["users", search], (cursor) =>
    fetchUsers({ ...(search ? { q: search } : {}), cursor }),
  );

  return (
    <DataPage
      title="사용자"
      isPending={users.isPending}
      error={users.error}
      isEmpty={users.items.length === 0}
      emptyLabel="조건에 맞는 사용자가 없습니다."
      actions={
        <form onSubmit={form.onSubmit((values) => setSearch(values.q.trim()))}>
          <Group gap="xs">
            <TextInput
              aria-label="사용자 검색"
              placeholder="이름 또는 이메일"
              key={form.key("q")}
              {...form.getInputProps("q")}
            />
            <Button type="submit" variant="default">
              검색
            </Button>
          </Group>
        </form>
      }
    >
      <Table.ScrollContainer minWidth={640}>
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>이름</Table.Th>
              <Table.Th>이메일</Table.Th>
              <Table.Th>팔로잉</Table.Th>
              <Table.Th>크레딧</Table.Th>
              <Table.Th>가입일</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {users.items.map((user) => (
              <Table.Tr key={user.id}>
                <Table.Td>{user.displayName}</Table.Td>
                <Table.Td>{user.email ?? "—"}</Table.Td>
                <Table.Td>{user.followCount}</Table.Td>
                <Table.Td>{user.creditBalance}</Table.Td>
                <Table.Td>{user.createdAt.slice(0, 10)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <LoadMore
        hasNextPage={users.hasNextPage}
        isFetching={users.isFetchingNextPage}
        onLoadMore={() => void users.fetchNextPage()}
      />
    </DataPage>
  );
}
