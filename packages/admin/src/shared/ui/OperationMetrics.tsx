import { Card, Stack } from "@mantine/core";
import type { ReactNode } from "react";
import classes from "./OperationMetrics.module.css";

export function OperationMetrics({ children }: { children: ReactNode }) {
  return <div className={classes.grid}>{children}</div>;
}

export function OperationMetric({
  label,
  value,
  note,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
}) {
  return (
    <Card className={classes.card} padding="md" component="section">
      <Stack gap={5}>
        <div className={classes.label}>{label}</div>
        <div className={classes.value}>{value}</div>
        {note ? <div className={classes.note}>{note}</div> : null}
      </Stack>
    </Card>
  );
}
