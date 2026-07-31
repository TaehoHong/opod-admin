import { lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./AppLayout";

// 화면은 라우트 단위로 잘라서 받는다. 전부 한 번에 묶으면 초기 번들이 커지고,
// 운영자는 보통 한두 화면만 쓴다. feature가 named export를 쓰므로 default로
// 감싸 준다.
const HomePage = lazy(() =>
  import("../features/home/HomePage").then((m) => ({ default: m.HomePage })),
);
const CharactersPage = lazy(() =>
  import("../features/characters/CharactersPage").then((m) => ({
    default: m.CharactersPage,
  })),
);
const PostsPage = lazy(() =>
  import("../features/posts/PostsPage").then((m) => ({ default: m.PostsPage })),
);
const MediaPage = lazy(() =>
  import("../features/media/MediaPage").then((m) => ({ default: m.MediaPage })),
);
const DraftsPage = lazy(() =>
  import("../features/drafts/DraftsPage").then((m) => ({
    default: m.DraftsPage,
  })),
);
const GenerationPage = lazy(() =>
  import("../features/generation/GenerationPage").then((m) => ({
    default: m.GenerationPage,
  })),
);
const LlmLogsPage = lazy(() =>
  import("../features/llm-logs/LlmLogsPage").then((m) => ({
    default: m.LlmLogsPage,
  })),
);
const LogsPage = lazy(() =>
  import("../features/logs/LogsPage").then((m) => ({ default: m.LogsPage })),
);
const UsersPage = lazy(() =>
  import("../features/users/UsersPage").then((m) => ({ default: m.UsersPage })),
);
const CreditsPage = lazy(() =>
  import("../features/credits/CreditsPage").then((m) => ({
    default: m.CreditsPage,
  })),
);
const PaymentsPage = lazy(() =>
  import("../features/payments/PaymentsPage").then((m) => ({
    default: m.PaymentsPage,
  })),
);
const ModerationPage = lazy(() =>
  import("../features/moderation/ModerationPage").then((m) => ({
    default: m.ModerationPage,
  })),
);
const EventsPage = lazy(() =>
  import("../features/events/EventsPage").then((m) => ({
    default: m.EventsPage,
  })),
);
const AnalyticsPage = lazy(() =>
  import("../features/analytics/AnalyticsPage").then((m) => ({
    default: m.AnalyticsPage,
  })),
);
const SettingsPage = lazy(() =>
  import("../features/settings/SettingsPage").then((m) => ({
    default: m.SettingsPage,
  })),
);

// 네비게이션 항목과 화면을 한 배열이 소유한다. 따로 두면 화면 없는 nav 항목이
// 생길 수 있다.
export const NAV_ITEMS = [
  { id: "home", label: "홈", Page: HomePage },
  { id: "characters", label: "캐릭터", Page: CharactersPage },
  { id: "posts", label: "게시글", Page: PostsPage },
  { id: "media", label: "미디어", Page: MediaPage },
  { id: "drafts", label: "초안", Page: DraftsPage },
  { id: "generation", label: "생성", Page: GenerationPage },
  { id: "llm-logs", label: "LLM 로그", Page: LlmLogsPage },
  { id: "logs", label: "로그", Page: LogsPage },
  { id: "users", label: "사용자", Page: UsersPage },
  { id: "credits", label: "크레딧", Page: CreditsPage },
  { id: "payments", label: "결제", Page: PaymentsPage },
  { id: "moderation", label: "신고", Page: ModerationPage },
  { id: "events", label: "이벤트", Page: EventsPage },
  { id: "analytics", label: "분석", Page: AnalyticsPage },
  { id: "settings", label: "설정", Page: SettingsPage },
] as const;

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/home" replace />} />
        {NAV_ITEMS.map(({ id, Page }) => (
          <Route key={id} path={id} element={<Page />} />
        ))}
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Route>
    </Routes>
  );
}
