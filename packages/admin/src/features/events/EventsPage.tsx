import { Badge, Button, Group, Table, Text, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useState } from "react";
import { useCursorList } from "../../shared/api/useCursorList";
import { DataPage, LoadMore } from "../../shared/ui/DataPage";
import { fetchEvents } from "./api";

export function EventsPage() {
  const [filter, setFilter] = useState<{ userId?: string }>({});
  const form = useForm({ mode: "uncontrolled", initialValues: { userId: "" } });

  const events = useCursorList(["events", filter.userId ?? ""], (cursor) =>
    fetchEvents({ ...filter, cursor }),
  );

  return (
    <DataPage
      title="이벤트"
      isPending={events.isPending}
      error={events.error}
      isEmpty={events.items.length === 0}
      actions={
        <form
          onSubmit={form.onSubmit((values) => {
            const userId = values.userId.trim();
            setFilter(userId ? { userId } : {});
          })}
        >
          <Group gap="xs">
            <TextInput
              aria-label="사용자 ID"
              placeholder="사용자 ID"
              key={form.key("userId")}
              {...form.getInputProps("userId")}
            />
            <Button type="submit" variant="default">
              조회
            </Button>
          </Group>
        </form>
      }
    >
      <Table.ScrollContainer minWidth={760}>
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>이벤트</Table.Th>
              <Table.Th>대상</Table.Th>
              <Table.Th>사용자</Table.Th>
              <Table.Th>일시</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {events.items.map((event) => (
              <Table.Tr key={event.id}>
                <Table.Td>
                  <Badge variant="light">{event.eventType}</Badge>
                </Table.Td>
                <Table.Td>
                  <Text>{event.targetType}</Text>
                  <Text size="xs" c="dimmed">
                    {event.targetId}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="xs" c="dimmed">
                    {event.userId}
                  </Text>
                </Table.Td>
                <Table.Td>{event.createdAt.slice(0, 10)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <LoadMore
        hasNextPage={events.hasNextPage}
        isFetching={events.isFetchingNextPage}
        onLoadMore={() => void events.fetchNextPage()}
      />
    </DataPage>
  );
}
