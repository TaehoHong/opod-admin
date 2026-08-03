import {
  Alert,
  Badge,
  Group,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { UserName } from "../../shared/ui/EntityName";
import { fetchPayment, type PaymentReconciliationItem } from "./api";
import { LEDGER_STATUS_LABEL, PROVIDER_STATUS_LABEL } from "./labels";

// 결제는 대상과 영향을 함께 보여준다 (docs/04-design-rules.md:69).
// 목록의 정산 판정과 결제 원본을 한 화면에서 대조할 수 있게 둔다.
export function PaymentDetailPanel({
  row,
}: {
  row: PaymentReconciliationItem;
}) {
  const payment = useQuery({
    queryKey: ["payments", "detail", row.paymentId],
    queryFn: () => fetchPayment(row.paymentId),
  });

  return (
    <Paper p="md" maw={640}>
      <Stack gap="sm">
        <Group gap="sm" align="baseline">
          <Title order={5}>결제 상세</Title>
          <Badge color={row.ledgerStatus === "granted" ? "teal" : "attention"}>
            {LEDGER_STATUS_LABEL[row.ledgerStatus]}
          </Badge>
        </Group>

        {payment.isPending ? (
          <Loader aria-label="결제 상세 불러오는 중" />
        ) : null}
        {payment.error ? (
          <Alert color="red" role="alert" title="불러오지 못했습니다">
            {payment.error.message}
          </Alert>
        ) : null}

        {payment.data ? (
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
            <Field label="결제 상태">
              {PROVIDER_STATUS_LABEL[payment.data.status] ??
                payment.data.status}
            </Field>
            <Field label="결제 수단">{payment.data.provider}</Field>
            <Field label="결제 금액">
              {payment.data.paidAmount.toLocaleString()} {payment.data.currency}
            </Field>
            <Field label="지급 크레딧">
              {payment.data.creditAmount.toLocaleString()}
            </Field>
            <Field label="결제 시각">
              {payment.data.createdAt.replace("T", " ").slice(0, 16)}
            </Field>
            <Field label="최종 변경">
              {payment.data.updatedAt.replace("T", " ").slice(0, 16)}
            </Field>
            <Field label="사용자">
              <UserName id={payment.data.userId} size="sm" />
            </Field>
            <Field label="결제 ID">
              <Text size="xs" c="dimmed">
                {payment.data.id}
              </Text>
            </Field>
          </SimpleGrid>
        ) : null}

        {/* 진단 정보는 기본 화면에 펼쳐두지 않는다
            (docs/04-design-rules.md:12). 불일치가 있을 때만 보인다. */}
        {row.reason ? (
          <Alert color="attention" title="정산 불일치">
            <Stack gap={4}>
              <Text size="sm">{row.reason}</Text>
              {row.issueCodes?.length ? (
                <Text size="xs" c="dimmed">
                  {row.issueCodes.join(", ")}
                </Text>
              ) : null}
            </Stack>
          </Alert>
        ) : null}
      </Stack>
    </Paper>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Stack gap={2}>
      <Text size="xs" c="dimmed" tt="uppercase">
        {label}
      </Text>
      <Text size="sm">{children}</Text>
    </Stack>
  );
}
