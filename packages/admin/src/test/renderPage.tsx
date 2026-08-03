import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppProviders } from "../app/providers";

// 화면이 선택 상태를 URL에 두므로 테스트도 라우터 안에서 렌더해야 실제와 같은
// 경로로 동작한다. routes를 주면 그 패턴들이 같은 화면을 렌더하므로 상세 링크
// 이동까지 그대로 검증할 수 있다.
export function renderPage(
  element: ReactElement,
  options: { path?: string; routes?: string[] } = {},
) {
  const routes = options.routes ?? ["*"];
  return render(
    <AppProviders>
      <MemoryRouter initialEntries={[options.path ?? "/"]}>
        <Routes>
          {routes.map((route) => (
            <Route key={route} path={route} element={element} />
          ))}
        </Routes>
      </MemoryRouter>
    </AppProviders>,
  );
}
