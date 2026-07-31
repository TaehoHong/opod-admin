import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { CreditGrantModal } from "../credits/CreditGrantModal";
import { fetchCreditLedger } from "../credits/api";
import { fetchUser, fetchUserEvents } from "./api";
import { useState } from "react";

export function UserDetailModal({
  userId,
  onClose,
}: {
  userId: string;
  onClose: () => void;
}) {
  const [grantOpen, setGrantOpen] = useState(false);
  const user = useQuery({
    queryKey: ["users", "detail", userId],
    queryFn: () => fetchUser(userId),
  });
  const ledger = useQuery({
    queryKey: ["credits", "user", userId],
    queryFn: () => fetchCreditLedger({ userId }),
  });
  const events = useQuery({
    queryKey: ["user-events", userId],
    queryFn: () => fetchUserEvents({ userId, limit: "20" }),
  });

  return (
    <>
      <Modal
        opened
        onClose={onClose}
        title={user.data?.displayName ?? "사용자 상세"}
        size="xl"
      >
        {user.isPending ? (
          <Loader aria-label="사용자 상세 불러오는 중" />
        ) : user.error ? (
          <Alert color="red" role="alert" title="사용자를 불러오지 못했습니다">
            {user.error.message}
          </Alert>
        ) : user.data ? (
          <Stack gap="lg">
            <Group justify="space-between" align="flex-start">
              <Stack gap={2}>
                <Title order={3}>{user.data.displayName}</Title>
                <Text size="sm" c="dimmed">
                  {user.data.email ?? "이메일 없음"}
                </Text>
              </Stack>
              <Button onClick={() => setGrantOpen(true)}>크레딧 지급</Button>
            </Group>
            <SimpleGrid cols={{ base: 2, sm: 4 }}>
              <Stat label="가입일" value={user.data.createdAt.slice(0, 10)} />
              <Stat label="팔로잉" value={user.data.followCount} />
              <Stat label="크레딧 잔액" value={user.data.creditBalance} />
              <Stat
                label="원장 항목"
                value={ledger.data ? `${ledger.data.items.length}건` : "—"}
              />
            </SimpleGrid>
            <Stack gap="xs">
              <Title order={5}>크레딧 원장</Title>
              {ledger.isPending ? (
                <Loader size="sm" aria-label="크레딧 원장 불러오는 중" />
              ) : ledger.error ? (
                <Alert color="red" role="alert">
                  {ledger.error.message}
                </Alert>
              ) : ledger.data?.items.length === 0 ? (
                <Text size="sm" c="dimmed">
                  크레딧 내역이 없습니다.
                </Text>
              ) : (
                <Table.ScrollContainer minWidth={720}>
                  <Table striped>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>구분</Table.Th>
                        <Table.Th>금액</Table.Th>
                        <Table.Th>사유</Table.Th>
                        <Table.Th>외부 참조</Table.Th>
                        <Table.Th>시각</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {ledger.data?.items.map((entry) => (
                        <Table.Tr key={entry.id}>
                          <Table.Td>
                            <Badge
                              color={
                                entry.entryType === "grant"
                                  ? "teal"
                                  : "attention"
                              }
                            >
                              {entry.entryType}
                            </Badge>
                          </Table.Td>
                          <Table.Td>
                            {entry.amount > 0 ? "+" : ""}
                            {entry.amount.toLocaleString()}
                          </Table.Td>
                          <Table.Td>{entry.reason}</Table.Td>
                          <Table.Td>{entry.externalReference ?? "—"}</Table.Td>
                          <Table.Td>{formatDateTime(entry.createdAt)}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              )}
            </Stack>
            <Stack gap="xs">
              <Title order={5}>최근 이벤트</Title>
              {events.isPending ? (
                <Loader size="sm" aria-label="최근 이벤트 불러오는 중" />
              ) : events.error ? (
                <Alert color="red" role="alert">
                  {events.error.message}
                </Alert>
              ) : events.data?.items.length === 0 ? (
                <Text size="sm" c="dimmed">
                  이벤트가 없습니다.
                </Text>
              ) : (
                events.data?.items.map((event) => (
                  <Paper key={event.id} p="xs" withBorder>
                    <Group justify="space-between" align="flex-start">
                      <Stack gap={2}>
                        <Badge variant="light" w="fit-content">
                          {event.eventType}
                        </Badge>
                        <Text size="sm">
                          {event.targetType} · {shortId(event.targetId)}
                        </Text>
                      </Stack>
                      <Text size="xs" c="dimmed">
                        {formatDateTime(event.createdAt)}
                      </Text>
                    </Group>
                  </Paper>
                ))
              )}
            </Stack>
          </Stack>
        ) : null}
      </Modal>
      <CreditGrantModal
        opened={grantOpen}
        initialUserId={userId}
        initialUser={user.data}
        onClose={() => setGrantOpen(false)}
      />
    </>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Paper p="sm" withBorder>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={600}>{value}</Text>
    </Paper>
  );
}

function shortId(value: string) {
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}

function formatDateTime(value: string) {
  return value.replace("T", " ").slice(0, 16);
}
