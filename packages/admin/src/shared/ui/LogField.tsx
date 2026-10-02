import { Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";
import classes from "./LogDetails.module.css";

export function LogField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Stack component="dl" gap="xs" className={classes.field}>
      <Text component="dt" size="sm" c="dimmed">
        {label}
      </Text>
      <Text component="dd" size="sm">
        {children}
      </Text>
    </Stack>
  );
}

export function logDateTime(value?: string) {
  return value
    ? new Date(value).toLocaleString("ko-KR", {
        timeZone: "Asia/Seoul",
        hour12: false,
      })
    : "—";
}
