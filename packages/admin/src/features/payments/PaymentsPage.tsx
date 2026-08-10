import { Badge, Button, SegmentedControl, Table } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useDetailSelection } from "../../shared/routing/useDetailSelection";
import { DataPage } from "../../shared/ui/DataPage";
import { UserName } from "../../shared/ui/EntityName";
import { TableText } from "../../shared/ui/TableText";
import { PaymentDetailPanel } from "./PaymentDetailPanel";
import {
  LEDGER_STATUS_COLOR,
  LEDGER_STATUS_LABEL,
  PROVIDER_STATUS_COLOR,
  PROVIDER_STATUS_LABEL,
} from "./labels";
import { fetchPaymentReconciliation } from "./api";

const STATUS_FILTER = [
  { value: "", label: "전체" },
  { value: "mismatch", label: "불일치" },
  { value: "pending", label: "대기" },
  { value: "resolved", label: "정상" },
];

export function PaymentsPage() {
  const [status, setStatus] = useState("");
  const { selectedId, toggle, close } = useDetailSelection(
    "paymentId",
    "/payments",
  );

  const reconciliation = useQuery({
    queryKey: ["payments", "reconciliation", status],
    queryFn: () => fetchPaymentReconciliation(status ? { status } : {}),
  });

  const items = reconciliation.data?.items ?? [];
  const selected = items.find((item) => item.paymentId === selectedId);

  return (
    <DataPage
      title="결제 정산"
      isPending={reconciliation.isPending}
      error={reconciliation.error}
      isEmpty={items.length === 0}
      emptyLabel="조건에 맞는 결제가 없습니다."
      actions={
        <SegmentedControl
          aria-label="정산 상태"
          data={STATUS_FILTER}
          value={status}
          onChange={(value) => {
            setStatus(value);
            close();
          }}
        />
      }
    >
      <Table.ScrollContainer minWidth={880}>
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>사용자</Table.Th>
              <Table.Th>결제 수단</Table.Th>
              <Table.Th>결제 상태</Table.Th>
              <Table.Th>원장 반영</Table.Th>
              <Table.Th>불일치 사유</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((item) => (
              <Table.Tr key={item.paymentId}>
                <Table.Td>
                  <UserName id={item.userId} />
                </Table.Td>
                <Table.Td>{item.provider ?? "—"}</Table.Td>
                <Table.Td>
                  <Badge color={PROVIDER_STATUS_COLOR[item.providerStatus]}>
                    {PROVIDER_STATUS_LABEL[item.providerStatus]}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Badge
                    variant="light"
                    color={LEDGER_STATUS_COLOR[item.ledgerStatus]}
                  >
                    {LEDGER_STATUS_LABEL[item.ledgerStatus]}
                  </Badge>
                </Table.Td>
                <Table.Td maw={280}>
                  <TableText>{item.reason ?? "—"}</TableText>
                </Table.Td>
                <Table.Td>
                  {/* 행 클릭 대신 버튼을 둬서 keyboard로도 열 수 있게 한다
                      (docs/04-design-rules.md:81). */}
                  <Button
                    variant="subtle"
                    size="compact-sm"
                    onClick={() => toggle(item.paymentId)}
                  >
                    {selectedId === item.paymentId ? "닫기" : "상세"}
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {selected ? <PaymentDetailPanel row={selected} /> : null}
    </DataPage>
  );
}
