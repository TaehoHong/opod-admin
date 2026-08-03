import { Button, Group, Select, Stack, Textarea } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MutationAlert } from "../../shared/ui/MutationAlert";
import { updateReport, type ReportListItem, type ReportStatus } from "./api";

const STATUS_OPTIONS = [
  { value: "reviewing", label: "검토 중" },
  { value: "resolved", label: "처리 완료" },
  { value: "rejected", label: "반려" },
];

// 처리 결과는 신고 목록에서 바로 바꾼다. 대상과 영향이 보이는 행 안에서
// 수행하도록 두었다 (docs/04-design-rules.md:69).
export function ReportResolveForm({ report }: { report: ReportListItem }) {
  const queryClient = useQueryClient();
  const form = useForm({
    mode: "uncontrolled",
    initialValues: {
      status: report.status === "submitted" ? "reviewing" : report.status,
      resolution: report.resolution ?? "",
    },
    validate: {
      // 종결 처리는 사유를 남겨야 감사 가능하다.
      resolution: (value, values) =>
        values.status !== "reviewing" && value.trim().length === 0
          ? "처리 사유를 입력해 주세요"
          : null,
    },
  });

  const resolve = useMutation({
    mutationFn: (values: { status: string; resolution: string }) =>
      updateReport({
        reportId: report.id,
        status: values.status as ReportStatus,
        ...(values.resolution.trim()
          ? { resolution: values.resolution.trim() }
          : {}),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["reports"] }),
  });

  return (
    <form onSubmit={form.onSubmit((values) => resolve.mutate(values))}>
      <Stack gap="xs">
        <Group gap="xs" align="flex-start" wrap="nowrap">
          <Select
            aria-label="처리 상태"
            data={STATUS_OPTIONS}
            allowDeselect={false}
            w={130}
            key={form.key("status")}
            {...form.getInputProps("status")}
          />
          <Textarea
            aria-label="처리 사유"
            placeholder="처리 사유"
            autosize
            minRows={1}
            w={240}
            key={form.key("resolution")}
            {...form.getInputProps("resolution")}
          />
          {/* pending 동안 재실행을 막는다 (docs/04-design-rules.md:68). */}
          <Button type="submit" loading={resolve.isPending}>
            저장
          </Button>
        </Group>
        <MutationAlert
          mutation={resolve}
          success="신고를 처리했습니다."
          errorTitle="처리하지 못했습니다"
        />
      </Stack>
    </form>
  );
}
