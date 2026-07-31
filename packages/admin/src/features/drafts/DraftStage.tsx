import { Badge, Box, Group, Stack, Text, ThemeIcon } from "@mantine/core";
import type { ReactNode } from "react";

// 파이프라인 단계는 완료·진행 중·실패·대기를 한눈에 구분해야 한다
// (docs/04-design-rules.md:66-67). 번호 원형의 채움 정도로 진행을 표현하되
// 상태 문구를 항상 함께 둔다.
export type StageTone = "done" | "current" | "failed" | "future";

const TONE_PROPS: Record<StageTone, { variant: string; color: string }> = {
  done: { variant: "filled", color: "accent" },
  current: { variant: "outline", color: "accent" },
  failed: { variant: "filled", color: "red" },
  future: { variant: "default", color: "gray" },
};

const STATUS_COLOR: Record<StageTone, string> = {
  done: "teal",
  current: "accent",
  failed: "red",
  future: "gray",
};

export function DraftStage({
  step,
  tone,
  label,
  status,
  action,
  children,
  last = false,
}: {
  step: number;
  tone: StageTone;
  label: string;
  status: string;
  action?: ReactNode;
  children: ReactNode;
  last?: boolean;
}) {
  const toneProps = TONE_PROPS[tone];
  return (
    <Box
      py="md"
      style={
        last
          ? undefined
          : { borderBottom: "1px solid var(--mantine-color-default-border)" }
      }
    >
      <Group align="flex-start" wrap="nowrap" gap="md">
        <ThemeIcon
          radius="xl"
          size={32}
          variant={toneProps.variant}
          color={toneProps.color}
        >
          {step}
        </ThemeIcon>
        <Stack gap="xs" flex={1} miw={0}>
          <Group justify="space-between" align="center" wrap="wrap" gap="xs">
            <Group gap="xs" align="center">
              <Text fw={600}>{label}</Text>
              <Badge
                variant={tone === "future" ? "light" : "filled"}
                color={STATUS_COLOR[tone]}
              >
                {status}
              </Badge>
            </Group>
            {action ? <Group gap="xs">{action}</Group> : null}
          </Group>
          {children}
        </Stack>
      </Group>
    </Box>
  );
}

export function StageNote({ children }: { children: ReactNode }) {
  return (
    <Text size="sm" c="dimmed">
      {children}
    </Text>
  );
}

export function MetaRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Group gap="sm" align="baseline" wrap="nowrap">
      <Text
        size="xs"
        c="dimmed"
        tt="uppercase"
        w={80}
        style={{ flexShrink: 0 }}
      >
        {label}
      </Text>
      <Text size="sm">{children}</Text>
    </Group>
  );
}
