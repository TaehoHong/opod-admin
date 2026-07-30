import { Alert, Stack, Title } from "@mantine/core";

// 전환이 끝나지 않은 화면. 조용히 빈 화면을 보여주는 대신 상태를 밝힌다.
export function PendingMigrationPage({ label }: { label: string }) {
  return (
    <Stack>
      <Title order={3}>{label}</Title>
      <Alert color="yellow">
        이 화면은 아직 React로 옮기지 않았습니다. 기존 관리자 콘솔을 사용해
        주세요.
      </Alert>
    </Stack>
  );
}
