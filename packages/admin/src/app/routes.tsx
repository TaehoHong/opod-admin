import { Navigate, Route, Routes } from "react-router-dom";
import { CharactersPage } from "../features/characters/CharactersPage";
import { AppLayout } from "./AppLayout";
import { PendingMigrationPage } from "./PendingMigrationPage";

// 기존 정적 SPA의 라우트 집합. 아직 옮기지 않은 화면은 전환 중임을 명시적으로
// 알리고, 옮긴 화면부터 차례로 실제 컴포넌트로 바꾼다.
export const NAV_ITEMS = [
  { id: "home", label: "홈" },
  { id: "characters", label: "캐릭터" },
  { id: "posts", label: "게시글" },
  { id: "media", label: "미디어" },
  { id: "drafts", label: "초안" },
  { id: "generation", label: "생성" },
  { id: "llm-logs", label: "LLM 로그" },
  { id: "logs", label: "로그" },
  { id: "users", label: "사용자" },
  { id: "credits", label: "크레딧" },
  { id: "payments", label: "결제" },
  { id: "moderation", label: "신고" },
  { id: "events", label: "이벤트" },
  { id: "analytics", label: "분석" },
  { id: "settings", label: "설정" },
] as const;

const MIGRATED = new Set(["characters"]);

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/home" replace />} />
        <Route path="characters" element={<CharactersPage />} />
        {NAV_ITEMS.filter((item) => !MIGRATED.has(item.id)).map((item) => (
          <Route
            key={item.id}
            path={item.id}
            element={<PendingMigrationPage label={item.label} />}
          />
        ))}
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Route>
    </Routes>
  );
}
