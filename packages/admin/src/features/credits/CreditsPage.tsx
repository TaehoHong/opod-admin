import { Badge, Button, Group, Table, Text, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useState } from "react";
import { useCursorList } from "../../shared/api/useCursorList";
import { DataPage, LoadMore } from "../../shared/ui/DataPage";
import { CreditGrantModal } from "./CreditGrantModal";
import { fetchCreditLedger } from "./api";

export function CreditsPage() {
  const [userId, setUserId] = useState("");
  const [grantOpen, setGrantOpen] = useState(false);
  const form = useForm({ mode: "uncontrolled", initialValues: { userId: "" } });

  const ledger = useCursorList(["credits", userId], (cursor) =>
    fetchCreditLedger({ ...(userId ? { userId } : {}), cursor }),
  );

  return (
    <>
      <DataPage
        title="크레딧 원장"
        isPending={ledger.isPending}
        error={ledger.error}
        isEmpty={ledger.items.length === 0}
        actions={
          <Group gap="xs">
            <form
              onSubmit={form.onSubmit((values) =>
                setUserId(values.userId.trim()),
              )}
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
            <Button onClick={() => setGrantOpen(true)}>크레딧 지급</Button>
          </Group>
        }
      >
        <Table.ScrollContainer minWidth={760}>
          <Table striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>구분</Table.Th>
                <Table.Th>수량</Table.Th>
                <Table.Th>종류</Table.Th>
                <Table.Th>사유</Table.Th>
                <Table.Th>사용자</Table.Th>
                <Table.Th>일시</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {ledger.items.map((entry) => (
                <Table.Tr key={entry.id}>
                  <Table.Td>
                    <Badge color={entry.entryType === "grant" ? "teal" : "ink"}>
                      {entry.entryType === "grant" ? "지급" : "차감"}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{entry.amount}</Table.Td>
                  <Table.Td>{entry.creditKind ?? "—"}</Table.Td>
                  <Table.Td maw={280}>
                    <Text lineClamp={2}>{entry.reason}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {entry.userId}
                    </Text>
                  </Table.Td>
                  <Table.Td>{entry.createdAt.slice(0, 10)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        <LoadMore
          hasNextPage={ledger.hasNextPage}
          isFetching={ledger.isFetchingNextPage}
          onLoadMore={() => void ledger.fetchNextPage()}
        />
      </DataPage>
      <CreditGrantModal
        opened={grantOpen}
        onClose={() => setGrantOpen(false)}
      />
    </>
  );
}
