import {
  AppShell,
  Badge,
  Burger,
  Button,
  Group,
  NavLink,
  Text,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { NavLink as RouterNavLink, Outlet } from "react-router-dom";
import { useLogout, useSession } from "../features/auth/useSession";
import {
  pendingCountLabel,
  usePendingCounts,
  type PendingQueue,
} from "../shared/api/usePendingCounts";
import { NAV_ITEMS } from "./routes";

export function AppLayout() {
  const [opened, { toggle }] = useDisclosure();
  const session = useSession();
  const logoutMutation = useLogout();
  const pending = usePendingCounts();

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 220, breakpoint: "sm", collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            <Burger
              opened={opened}
              onClick={toggle}
              hiddenFrom="sm"
              size="sm"
            />
            <Title order={4}>OPOD Admin</Title>
          </Group>
          <Group>
            <Text size="sm" c="dimmed">
              {session.data?.email}
            </Text>
            <Button
              variant="subtle"
              size="compact-sm"
              onClick={() => logoutMutation.mutate()}
              loading={logoutMutation.isPending}
            >
              로그아웃
            </Button>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs">
        {NAV_ITEMS.map((item) => {
          // 처리 대기가 있는 화면만 배지를 단다 — 0을 붙이면 신호가 흐려진다.
          const queue = pending.data?.[item.id as PendingQueue];
          return (
            <NavLink
              key={item.id}
              component={RouterNavLink}
              to={`/${item.id}`}
              label={item.label}
              rightSection={
                queue && queue.count > 0 ? (
                  <Badge size="sm" color="attention">
                    {pendingCountLabel(queue)}
                  </Badge>
                ) : null
              }
            />
          );
        })}
      </AppShell.Navbar>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
