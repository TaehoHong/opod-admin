import {
  AppShell,
  Badge,
  Burger,
  Button,
  Group,
  Loader,
  NavLink,
  Text,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { Suspense } from "react";
import {
  NavLink as RouterNavLink,
  Outlet,
  useLocation,
} from "react-router-dom";
import { useLogout, useSession } from "../features/auth/useSession";
import {
  pendingCountLabel,
  usePendingCounts,
  type PendingQueue,
} from "../shared/api/usePendingCounts";
import { NAV_ITEMS } from "./routes";

export function AppLayout() {
  const [opened, { close, toggle }] = useDisclosure();
  const location = useLocation();
  const session = useSession();
  const logoutMutation = useLogout();
  const pending = usePendingCounts();

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 220, breakpoint: "sm", collapsed: { mobile: !opened } }}
      padding="md"
    >
      <a className="skip-link" href="#main-content">
        본문 바로가기
      </a>
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            <Burger
              opened={opened}
              onClick={toggle}
              aria-label={opened ? "메뉴 닫기" : "메뉴 열기"}
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
      <AppShell.Navbar p="xs" aria-label="주요 메뉴">
        {NAV_ITEMS.map((item) => {
          // 처리 대기가 있는 화면만 배지를 단다 — 0을 붙이면 신호가 흐려진다.
          const queue = pending.data?.[item.id as PendingQueue];
          return (
            <NavLink
              key={item.id}
              component={RouterNavLink}
              to={`/${item.id}`}
              label={item.label}
              active={
                location.pathname === `/${item.id}` ||
                location.pathname.startsWith(`/${item.id}/`)
              }
              onClick={close}
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
      <AppShell.Main id="main-content" tabIndex={-1}>
        {/* 화면은 라우트 단위로 늦게 받는다. 받는 동안에도 셸과 네비게이션은
            남아 있어야 이동 중인 상태가 드러난다
            (docs/04-design-rules.md:66). */}
        <Suspense fallback={<Loader aria-label="화면 불러오는 중" />}>
          <Outlet />
        </Suspense>
      </AppShell.Main>
    </AppShell>
  );
}
