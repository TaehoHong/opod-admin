import { Table } from "@mantine/core";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import classes from "./LogDetails.module.css";

export function LogRow({ to, children }: { to: string; children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <Table.Tr
      className={classes.row}
      onClick={(event) => {
        if (
          (event.target as HTMLElement).closest("a, button") ||
          window.getSelection()?.toString()
        )
          return;
        void navigate(to);
      }}
    >
      {children}
    </Table.Tr>
  );
}
