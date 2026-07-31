import {
  Card,
  Group,
  Progress,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { DataPage } from "../../shared/ui/DataPage";
import { fetchTokenUsage, type TokenBreakdown } from "./api";

const PERIODS = [
  { value: "7", label: "7일" },
  { value: "30", label: "30일" },
  { value: "90", label: "90일" },
];

// 토큰 사용량은 어디에 쓰였는지 비교하는 것이 목적이라 절대값과 비중을 함께
// 보여준다 (docs/00-overview.md "토큰 사용량").
export function TokenUsagePanel() {
  const [days, setDays] = useState("30");
  const usage = useQuery({
    queryKey: ["llm-logs", "usage", days],
    queryFn: () => fetchTokenUsage(Number(days)),
  });

  const summary = usage.data;

  return (
    <DataPage
      title="토큰 사용량"
      isPending={usage.isPending}
      error={usage.error}
      isEmpty={summary?.totals.calls === 0}
      emptyLabel="해당 기간에 기록된 호출이 없습니다."
      actions={
        <SegmentedControl
          aria-label="집계 기간"
          data={PERIODS}
          value={days}
          onChange={setDays}
        />
      }
    >
      {summary ? (
        <>
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
            <TotalCard label="총 토큰" value={summary.totals.totalTokens} />
            <TotalCard label="입력" value={summary.totals.inputTokens} />
            <TotalCard label="출력" value={summary.totals.outputTokens} />
            <TotalCard label="호출" value={summary.totals.calls} />
          </SimpleGrid>

          <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
            <BreakdownTable
              title="provider별"
              rows={summary.byProvider}
              total={summary.totals.totalTokens}
            />
            <BreakdownTable
              title="model별"
              rows={summary.byModel}
              total={summary.totals.totalTokens}
            />
          </SimpleGrid>

          <Stack gap="xs">
            <Title order={5}>일자별 추이</Title>
            <Table.ScrollContainer minWidth={520}>
              <Table striped>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>일자</Table.Th>
                    <Table.Th>호출</Table.Th>
                    <Table.Th>입력</Table.Th>
                    <Table.Th>출력</Table.Th>
                    <Table.Th>합계</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {summary.daily.map((point) => (
                    <Table.Tr key={point.date}>
                      <Table.Td>{point.date}</Table.Td>
                      <Table.Td>{point.calls.toLocaleString()}</Table.Td>
                      <Table.Td>{point.inputTokens.toLocaleString()}</Table.Td>
                      <Table.Td>{point.outputTokens.toLocaleString()}</Table.Td>
                      <Table.Td>{point.totalTokens.toLocaleString()}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Stack>
        </>
      ) : null}
    </DataPage>
  );
}

function TotalCard({ label, value }: { label: string; value: number }) {
  return (
    <Card padding="md">
      <Stack gap={4}>
        <Text size="xs" c="dimmed" tt="uppercase">
          {label}
        </Text>
        <Text fz={28} fw={600} ff="monospace">
          {value.toLocaleString()}
        </Text>
      </Stack>
    </Card>
  );
}

function BreakdownTable({
  title,
  rows,
  total,
}: {
  title: string;
  rows: TokenBreakdown[];
  total: number;
}) {
  return (
    <Stack gap="xs">
      <Title order={5}>{title}</Title>
      {rows.length === 0 ? (
        <Text c="dimmed">집계된 사용량이 없습니다.</Text>
      ) : (
        rows.map((row) => {
          const share = total > 0 ? (row.totalTokens / total) * 100 : 0;
          return (
            <Stack key={row.key} gap={2}>
              <Group justify="space-between" gap="xs">
                <Text size="sm">{row.key}</Text>
                {/* 비중은 막대와 숫자를 함께 둔다 — 색만으로 읽히지 않게
                    (docs/04-design-rules.md:85). */}
                <Text size="sm" c="dimmed">
                  {row.totalTokens.toLocaleString()} · {share.toFixed(1)}% ·{" "}
                  {row.calls.toLocaleString()}회
                </Text>
              </Group>
              <Progress
                value={share}
                size="sm"
                aria-label={`${row.key} 사용 비중`}
              />
            </Stack>
          );
        })
      )}
    </Stack>
  );
}
