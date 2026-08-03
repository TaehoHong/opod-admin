import { Alert } from "@mantine/core";

// 실행한 일이 됐는지 안 됐는지를 화면마다 다르게 알리면 운영자가 매번 결과를
// 다시 확인해야 한다. 성공은 role="status", 실패는 role="alert"로 같은 자리에
// 같은 모양으로 알린다 (docs/04-design-rules.md "Interaction").
export function MutationAlert({
  mutation,
  success,
  errorTitle,
}: {
  mutation: { isError: boolean; isSuccess: boolean; error: Error | null };
  success: string;
  errorTitle?: string;
}) {
  if (mutation.isError) {
    return (
      <Alert
        color="red"
        role="alert"
        {...(errorTitle ? { title: errorTitle } : {})}
      >
        {mutation.error?.message}
      </Alert>
    );
  }
  return mutation.isSuccess ? (
    <Alert color="teal" role="status">
      {success}
    </Alert>
  ) : null;
}
