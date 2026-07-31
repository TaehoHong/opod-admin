import { Badge, Paper, Stack, Table, Text, Title } from "@mantine/core";
import type { SettingsChangeLog } from "./api";

// 설정 변경 감사 이력 (console_logs) — 읽기 전용.
export function SettingsChangesTable({
  changes,
}: {
  changes: SettingsChangeLog[];
}) {
  return (
    <Paper p="md" component="section">
      <Stack gap="sm">
        <Title order={6}>최근 설정 변경</Title>
        {changes.length === 0 ? (
          <Text c="dimmed">변경 이력이 없습니다.</Text>
        ) : (
          <Table.ScrollContainer minWidth={720}>
            <Table striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>시각</Table.Th>
                  <Table.Th>관리자</Table.Th>
                  <Table.Th>항목</Table.Th>
                  <Table.Th>유형</Table.Th>
                  <Table.Th>값</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {changes.map((change) => (
                  <Table.Tr key={change.id}>
                    <Table.Td>
                      {change.createdAt.replace("T", " ").slice(0, 16)}
                    </Table.Td>
                    <Table.Td>{change.adminEmail ?? "—"}</Table.Td>
                    <Table.Td>{change.target ?? "—"}</Table.Td>
                    <Table.Td>
                      {change.actionType === "SETTINGS_CLEAR" ? (
                        <Badge color="ink" variant="light">
                          삭제
                        </Badge>
                      ) : (
                        <Badge color="accent">저장</Badge>
                      )}
                    </Table.Td>
                    <Table.Td>{change.summary ?? ""}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Stack>
    </Paper>
  );
}
