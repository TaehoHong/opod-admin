import {
  Article,
  Brain,
  ChartLineUp,
  Coins,
  CreditCard,
  GearSix,
  House,
  Heartbeat,
  ImageSquare,
  MapPin,
  Scroll,
  ShieldCheck,
  SignOut,
  Sparkle,
  Users,
  UsersThree,
} from "@phosphor-icons/react";
import {
  AppShell,
  Badge,
  Burger,
  Button,
  Group,
  Loader,
  NavLink,
  Text,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { Suspense } from "react";
import {
  Link,
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
import classes from "./AppLayout.module.css";
import { NAV_GROUPS, NAV_ITEMS } from "./routes";

const NAV_ICONS = {
  home: House,
  characters: UsersThree,
  locations: MapPin,
  posts: Article,
  media: ImageSquare,
  generation: Sparkle,
  users: Users,
  credits: Coins,
  payments: CreditCard,
  moderation: ShieldCheck,
  "llm-logs": Brain,
  logs: Scroll,
  events: Heartbeat,
  analytics: ChartLineUp,
  settings: GearSix,
} as const;

export function AppLayout() {
  const [opened, { close, toggle }] = useDisclosure();
  const location = useLocation();
  const session = useSession();
  const logoutMutation = useLogout();
  const pending = usePendingCounts();
  const currentItem = NAV_ITEMS.find(
    (item) =>
      location.pathname === `/${item.id}` ||
      location.pathname.startsWith(`/${item.id}/`),
  );

  return (
    <AppShell
      className={classes.shell}
      header={{ height: { base: 64, md: 68 } }}
      navbar={{
        width: 272,
        breakpoint: "md",
        collapsed: { mobile: !opened },
      }}
      padding={0}
    >
      <a className="skip-link" href="#main-content">
        본문 바로가기
      </a>
      <AppShell.Header className={classes.header}>
        <div className={classes.brandCell}>
          <Link className={classes.brand} to="/home" onClick={close}>
            <span className={classes.brandMark} aria-hidden>
              OP
            </span>
            <span>
              <span className={classes.brandName}>OPOD Admin</span>
              <span className={classes.brandMeta}>Operations console</span>
            </span>
          </Link>
          <Burger
            opened={opened}
            onClick={toggle}
            aria-label={opened ? "메뉴 닫기" : "메뉴 열기"}
            hiddenFrom="md"
            color="white"
            size="sm"
          />
        </div>
        <Group
          className={classes.topbar}
          h="100%"
          justify="space-between"
          wrap="nowrap"
        >
          <Text className={classes.routeLabel}>
            {currentItem?.label ?? "홈"}
          </Text>
          <Group className={classes.account} gap="sm" wrap="nowrap">
            <span className={classes.avatar} aria-hidden>
              {session.data?.email?.slice(0, 1).toUpperCase() ?? "A"}
            </span>
            <Text size="sm" c="ink.6" lineClamp={1}>
              {session.data?.email}
            </Text>
            <Button
              variant="subtle"
              color="ink"
              size="compact-sm"
              leftSection={<SignOut size={15} aria-hidden />}
              onClick={() => logoutMutation.mutate()}
              loading={logoutMutation.isPending}
            >
              로그아웃
            </Button>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar className={classes.navbar}>
        <nav className={classes.nav} aria-label="주요 메뉴">
          {NAV_GROUPS.map((group) => (
            <section className={classes.navGroup} key={group.id}>
              <p className={classes.navGroupLabel}>{group.label}</p>
              {NAV_ITEMS.filter((item) => item.group === group.id).map(
                (item) => {
                  const active =
                    location.pathname === `/${item.id}` ||
                    location.pathname.startsWith(`/${item.id}/`);
                  const queue = pending.data[item.id as PendingQueue];
                  const Icon = NAV_ICONS[item.id];
                  return (
                    <NavLink
                      classNames={{
                        root: classes.navLink,
                        label: classes.navLabel,
                      }}
                      key={item.id}
                      component={RouterNavLink}
                      to={`/${item.id}`}
                      label={item.label}
                      leftSection={
                        <Icon
                          size={18}
                          weight={active ? "fill" : "regular"}
                          aria-hidden
                        />
                      }
                      active={active}
                      onClick={close}
                      rightSection={
                        queue && queue.count > 0 ? (
                          <Badge size="sm" color="attention" variant="filled">
                            {pendingCountLabel(queue)}
                          </Badge>
                        ) : null
                      }
                    />
                  );
                },
              )}
            </section>
          ))}
          <div className={classes.navFooter}>
            운영 상태와 콘텐츠 흐름을 한곳에서 관리합니다.
          </div>
        </nav>
      </AppShell.Navbar>
      <AppShell.Main className={classes.main} id="main-content" tabIndex={-1}>
        <div className={classes.content}>
          <Suspense
            fallback={
              <div className={classes.routeLoader} role="status">
                <Loader aria-label="화면 불러오는 중" />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </div>
      </AppShell.Main>
    </AppShell>
  );
}
