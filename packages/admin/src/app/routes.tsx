import { lazy } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
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
const CharacterManagerPage = lazy(() =>
  import("../features/characters/CharacterManagerPage").then((m) => ({
    default: m.CharacterManagerPage,
  })),
);
const LocationsPage = lazy(() =>
  import("../features/locations/LocationsPage").then((m) => ({
    default: m.LocationsPage,
  })),
);
const LocationManagerPage = lazy(() =>
  import("../features/locations/LocationManagerPage").then((m) => ({
    default: m.LocationManagerPage,
  })),
);
const PostsPage = lazy(() =>
  import("../features/posts/PostsPage").then((m) => ({ default: m.PostsPage })),
);
const MediaPage = lazy(() =>
  import("../features/media/MediaPage").then((m) => ({ default: m.MediaPage })),
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
//
// detail이 있는 화면은 선택 상태를 URL에 둔다. 운영자는 특정 초안·사용자·결제를
// 두고 대화하므로 링크로 주고받을 수 있어야 하고, 새로고침과 뒤로가기가 보던
// 자리를 지켜야 한다. detail 값은 상세 경로 뒤에 붙는 path parameter 이름이다.
export const NAV_ITEMS = [
  { id: "home", label: "홈", Page: HomePage },
  { id: "characters", label: "캐릭터", Page: CharactersPage },
  { id: "locations", label: "장소", Page: LocationsPage },
  { id: "posts", label: "게시물", Page: PostsPage },
  { id: "media", label: "미디어", Page: MediaPage },
  { id: "generation", label: "이미지 생성", Page: GenerationPage },
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

// 캐릭터와 장소는 상세가 별도 페이지 컴포넌트라 아래에서 따로 건다.
const DETAIL_ROUTES: { id: string; paths: string[] }[] = [
  { id: "posts", paths: ["new/brief", ":workId", ":workId/:stage"] },
  { id: "media", paths: [":mediaId"] },
  { id: "generation", paths: [":jobId"] },
  { id: "llm-logs", paths: [":logId"] },
  { id: "users", paths: [":userId"] },
  { id: "payments", paths: [":paymentId"] },
];

export function AppRoutes() {
  const detailPaths = new Map(
    DETAIL_ROUTES.map(({ id, paths }) => [id, paths]),
  );

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/home" replace />} />
        {NAV_ITEMS.map(({ id, Page }) => (
          <Route key={id} path={id}>
            <Route index element={<Page />} />
            {(detailPaths.get(id) ?? []).map((path) => (
              <Route key={path} path={path} element={<Page />} />
            ))}
          </Route>
        ))}
        <Route
          path="characters/:characterId"
          element={<CharacterManagerPage />}
        />
        <Route path="locations/:locationId" element={<LocationManagerPage />} />
        <Route path="drafts" element={<Navigate to="/posts" replace />} />
        <Route path="drafts/:draftId" element={<LegacyDraftRedirect />} />
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Route>
    </Routes>
  );
}

function LegacyDraftRedirect() {
  const { draftId } = useParams();
  return (
    <Navigate to={`/posts/${encodeURIComponent(draftId ?? "")}`} replace />
  );
}
