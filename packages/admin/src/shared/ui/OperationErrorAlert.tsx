import { Alert, Spoiler, Stack, Text } from "@mantine/core";

export type OperationFailure = {
  code?: string;
  problem: string;
  cause: string;
  nextAction: string;
  technicalDetail?: string;
};

export function operationFailure(
  error: Error,
  problem = "요청을 처리하지 못했습니다.",
): OperationFailure {
  return {
    problem,
    cause: error.message || "서버가 오류 이유를 반환하지 않았습니다.",
    nextAction: "입력과 현재 상태를 확인한 뒤 다시 시도하세요.",
    technicalDetail: error.message,
  };
}

export function OperationErrorAlert({
  failure,
  mt,
}: {
  failure: OperationFailure;
  mt?: string | number;
}) {
  return (
    <Alert color="red" role="alert" title={failure.problem} mt={mt}>
      <Stack gap={6}>
        <Text size="sm">
          <b>발생 이유</b> · {failure.cause}
        </Text>
        <Text size="sm">
          <b>다음 행동</b> · {failure.nextAction}
        </Text>
        {failure.technicalDetail ? (
          <Spoiler
            maxHeight={0}
            showLabel="기술 상세 보기"
            hideLabel="기술 상세 닫기"
          >
            <Text size="xs" c="dimmed" style={{ whiteSpace: "pre-wrap" }}>
              {failure.code ? `오류 코드 · ${failure.code}\n` : ""}
              {failure.technicalDetail}
            </Text>
          </Spoiler>
        ) : null}
      </Stack>
    </Alert>
  );
}
