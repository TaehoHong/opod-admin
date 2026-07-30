import { Center, Loader } from "@mantine/core";
import { BrowserRouter } from "react-router-dom";
import { LoginPage } from "../features/auth/LoginPage";
import { useSession } from "../features/auth/useSession";
import { AppRoutes } from "./routes";

// 세션 판정은 서버(/auth/me)가 한다. 확인 전에는 로그인 화면을 깜빡이지
// 않도록 로딩 상태를 유지한다.
function AuthenticatedApp() {
  const session = useSession();

  if (session.isPending) {
    return (
      <Center h="100vh">
        <Loader aria-label="세션을 확인하는 중" />
      </Center>
    );
  }
  if (!session.data) {
    return <LoginPage />;
  }
  return <AppRoutes />;
}

export function App() {
  return (
    <BrowserRouter>
      <AuthenticatedApp />
    </BrowserRouter>
  );
}
