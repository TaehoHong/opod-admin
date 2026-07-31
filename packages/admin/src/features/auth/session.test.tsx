import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { App } from "../../app/App";
import { AppProviders } from "../../app/providers";
import { server } from "../../test/server";

// 세션은 HttpOnly cookie라 클라이언트가 읽을 수 없다. 따라서 화면 접근 판정은
// 전적으로 /auth/me 응답에 달려 있고, 요청에 고정 헤더가 빠지면 서버가 403을
// 주어 콘솔 전체가 잠긴다. 두 계약을 함께 확인한다.
describe("admin session", () => {
  it("shows the login form until the server confirms a session", async () => {
    const seenHeaders: string[] = [];
    const seenCredentials: RequestCredentials[] = [];
    let signedIn = false;

    server.use(
      http.get("/api/admin/v1/auth/me", ({ request }) => {
        seenHeaders.push(request.headers.get("x-opod-admin") ?? "");
        seenCredentials.push(request.credentials);
        return signedIn
          ? HttpResponse.json({ admin: { id: "admin-1", email: "a@b.test" } })
          : new HttpResponse(null, { status: 401 });
      }),
      http.post("/api/admin/v1/auth/login", ({ request }) => {
        seenHeaders.push(request.headers.get("x-opod-admin") ?? "");
        seenCredentials.push(request.credentials);
        signedIn = true;
        return HttpResponse.json({
          admin: { id: "admin-1", email: "a@b.test" },
        });
      }),
      http.get("/api/admin/v1/characters", () =>
        HttpResponse.json({ items: [] }),
      ),
    );

    render(
      <AppProviders>
        <App />
      </AppProviders>,
    );

    await screen.findByLabelText("이메일");

    await userEvent.type(screen.getByLabelText("이메일"), "a@b.test");
    await userEvent.type(screen.getByLabelText("비밀번호"), "password-1");
    await userEvent.click(screen.getByRole("button", { name: "로그인" }));

    // 로그인 성공 후에는 앱 셸이 보이고 로그인 폼은 사라진다.
    await screen.findByRole("button", { name: "로그아웃" });
    expect(screen.queryByLabelText("비밀번호")).not.toBeInTheDocument();
    expect(seenHeaders.every((value) => value === "1")).toBe(true);
    expect(seenCredentials.every((value) => value === "same-origin")).toBe(
      true,
    );
  });
});
