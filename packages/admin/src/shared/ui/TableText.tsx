import { Text } from "@mantine/core";
import classes from "./TableText.module.css";

export function TableText({
  children,
  lines = 2,
}: {
  children: string;
  lines?: number;
}) {
  return (
    <Text className={classes.root} lineClamp={lines} title={children}>
      {children}
    </Text>
  );
}
