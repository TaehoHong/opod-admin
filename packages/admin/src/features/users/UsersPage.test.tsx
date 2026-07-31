import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { AppProviders } from "../../app/providers";
import { server } from "../../test/server";
import { UsersPage } from "./UsersPage";

const user = {
  id: "user-1",
  displayName: "민지",
  email: "minji@example.com",
  followCount: 4,
  creditBalance: 120,
  createdAt: "2026-07-01T00:00:00.000Z",
};

describe("user detail", () => {
  it("shows the selected user's stats, credit ledger, events, and preselects a credit grant", async () => {
    server.use(
      http.get("/api/admin/v1/users", ({ request }) => {
        const isGrantOptions =
          new URL(request.url).searchParams.get("limit") === "50";
        return HttpResponse.json({ items: isGrantOptions ? [] : [user] });
      }),
      http.get("/api/admin/v1/users/:id", () =>
        HttpResponse.json({
          ...user,
          socialAccounts: [
            {
              provider: "google",
              email: "minji@gmail.com",
              linkedAt: "2026-07-01T02:00:00.000Z",
            },
          ],
        }),
      ),
      http.get("/api/admin/v1/credits/ledger", ({ request }) => {
        expect(new URL(request.url).searchParams.get("userId")).toBe(user.id);
        return HttpResponse.json({
          items: [
            {
              id: "credit-1",
              userId: user.id,
              entryType: "grant",
              amount: 120,
              reason: "가입 보상",
              externalReference: "welcome-2026",
              createdAt: "2026-07-01T01:00:00.000Z",
            },
          ],
        });
      }),
      http.get("/api/admin/v1/events", ({ request }) => {
        expect(new URL(request.url).searchParams.get("userId")).toBe(user.id);
        return HttpResponse.json({
          items: [
            {
              id: "event-1",
              userId: user.id,
              eventType: "post_viewed",
              targetType: "post",
              targetId: "post-123456789",
              createdAt: "2026-07-02T01:00:00.000Z",
            },
          ],
        });
      }),
    );

    render(
      <AppProviders>
        <UsersPage />
      </AppProviders>,
    );

    const row = (await screen.findByText("minji@example.com")).closest("tr");
    expect(row).not.toBeNull();
    await userEvent.click(within(row!).getByRole("button", { name: "상세" }));

    expect(await screen.findByText("가입 보상")).toBeInTheDocument();
    expect(screen.getByText("google")).toBeInTheDocument();
    expect(screen.getByText("minji@gmail.com")).toBeInTheDocument();
    expect(screen.getByText("welcome-2026")).toBeInTheDocument();
    expect(screen.getByText("post_viewed")).toBeInTheDocument();
    expect(screen.getByText("post · post-123…")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "크레딧 지급" }));
    expect(await screen.findByRole("combobox", { name: "사용자" })).toHaveValue(
      "민지 (minji@example.com)",
    );
  });
});
