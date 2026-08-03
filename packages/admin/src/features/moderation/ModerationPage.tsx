import { Badge, Select, Stack, Table, Text } from "@mantine/core";
import { useState } from "react";
import { useCursorList } from "../../shared/api/useCursorList";
import { DataPage, LoadMore } from "../../shared/ui/DataPage";
import { TableText } from "../../shared/ui/TableText";
import { ReportResolveForm } from "./ReportResolveForm";
import { fetchReports, type ReportStatus } from "./api";

const STATUS_FILTER = [
  { value: "", label: "전체" },
  { value: "submitted", label: "접수" },
  { value: "reviewing", label: "검토 중" },
  { value: "resolved", label: "처리 완료" },
  { value: "rejected", label: "반려" },
];

const STATUS_COLOR: Record<ReportStatus, string> = {
  submitted: "attention",
  reviewing: "accent",
  resolved: "teal",
  rejected: "gray",
};

const STATUS_LABEL: Record<ReportStatus, string> = {
  submitted: "접수",
  reviewing: "검토 중",
  resolved: "처리 완료",
  rejected: "반려",
};

export function ModerationPage() {
  const [status, setStatus] = useState("");
  const reports = useCursorList(["reports", status], (cursor) =>
    fetchReports({ ...(status ? { status } : {}), cursor }),
  );

  return (
    <DataPage
      title="신고"
      isPending={reports.isPending}
      error={reports.error}
      isEmpty={reports.items.length === 0}
      emptyLabel="처리할 신고가 없습니다."
      actions={
        <Select
          aria-label="신고 상태"
          data={STATUS_FILTER}
          value={status}
          onChange={(value) => setStatus(value ?? "")}
          allowDeselect={false}
          w={140}
        />
      }
    >
      <Table.ScrollContainer minWidth={880}>
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>대상</Table.Th>
              <Table.Th>사유</Table.Th>
              <Table.Th>상태</Table.Th>
              <Table.Th>접수일</Table.Th>
              <Table.Th>처리</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {reports.items.map((report) => (
              <Table.Tr key={report.id}>
                <Table.Td>
                  <Stack gap={0}>
                    <Text>{report.targetType}</Text>
                    {/* raw ID는 보조 정보로만 둔다 (docs/04-design-rules.md:12). */}
                    <Text size="xs" c="dimmed">
                      {report.targetId}
                    </Text>
                  </Stack>
                </Table.Td>
                <Table.Td maw={280}>
                  <TableText>{report.reason}</TableText>
                </Table.Td>
                <Table.Td>
                  <Badge color={STATUS_COLOR[report.status]}>
                    {STATUS_LABEL[report.status]}
                  </Badge>
                </Table.Td>
                <Table.Td>{report.createdAt.slice(0, 10)}</Table.Td>
                <Table.Td>
                  <ReportResolveForm report={report} />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <LoadMore
        hasNextPage={reports.hasNextPage}
        isFetching={reports.isFetchingNextPage}
        onLoadMore={() => void reports.fetchNextPage()}
      />
    </DataPage>
  );
}
