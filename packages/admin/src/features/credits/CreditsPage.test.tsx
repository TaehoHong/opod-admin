import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { AppProviders } from "../../app/providers";
import { server } from "../../test/server";
import { CreditsPage } from "./CreditsPage";
import type { CreditGrant } from "./api";

describe("credit management", () => {
  it("grants credits to a selected user and refreshes an empty ledger", async () => {
    const requests: unknown[] = [];
    let ledgerRequests = 0;
    let entries: Array<Record<string, unknown>> = [];

    server.use(
      http.get("/api/admin/v1/users", () =>
        HttpResponse.json({
          items: [
            {
              id: "user-1",
              displayName: "테스트 사용자",
              email: "user@example.com",
              followCount: 0,
              creditBalance: 0,
              createdAt: "2026-07-31T00:00:00.000Z",
            },
          ],
        }),
      ),
      http.get("/api/admin/v1/credits/ledger", () => {
        ledgerRequests += 1;
        return HttpResponse.json({ items: entries });
      }),
      http.post("/api/admin/v1/credits/grants", async ({ request }) => {
        const body = (await request.json()) as CreditGrant;
        requests.push(body);
        const created = {
          id: "credit-1",
          entryType: "grant",
          createdAt: "2026-07-31T01:00:00.000Z",
          ...body,
        };
        entries = [created];
        return HttpResponse.json(created, { status: 201 });
      }),
    );

    render(
      <AppProviders>
        <CreditsPage />
      </AppProviders>,
    );

    await screen.findByText("표시할 항목이 없습니다.");
    await userEvent.click(screen.getByRole("button", { name: "크레딧 지급" }));
    const userSelect = await screen.findByRole("combobox", { name: "사용자" });
    await userEvent.type(userSelect, "테스트 사용자");
    await userEvent.click(
      await screen.findByText("테스트 사용자 (user@example.com)"),
    );
    await userEvent.type(screen.getByLabelText("금액"), "500");
    await userEvent.type(screen.getByLabelText("사유"), "  운영 보상  ");
    await userEvent.type(
      screen.getByLabelText("외부 참조 (선택)"),
      "  support-123  ",
    );
    await userEvent.click(screen.getByRole("button", { name: "지급" }));

    await waitFor(() =>
      expect(requests).toEqual([
        {
          userId: "user-1",
          amount: 500,
          reason: "운영 보상",
          externalReference: "support-123",
        },
      ]),
    );
    expect(await screen.findByText("운영 보상")).toBeInTheDocument();
    expect(ledgerRequests).toBeGreaterThan(1);
  });

  it("cannot dismiss and repeat a credit grant while the request is pending", async () => {
    let requestCount = 0;
    let finishGrant: (() => void) | undefined;

    server.use(
      http.get("/api/admin/v1/users", () =>
        HttpResponse.json({
          items: [
            {
              id: "user-1",
              displayName: "테스트 사용자",
              email: "user@example.com",
              followCount: 0,
              creditBalance: 0,
              createdAt: "2026-07-31T00:00:00.000Z",
            },
          ],
        }),
      ),
      http.get("/api/admin/v1/credits/ledger", () =>
        HttpResponse.json({ items: [] }),
      ),
      http.post("/api/admin/v1/credits/grants", async () => {
        requestCount += 1;
        await new Promise<void>((resolve) => {
          finishGrant = resolve;
        });
        return HttpResponse.json(
          {
            id: "credit-1",
            userId: "user-1",
            entryType: "grant",
            amount: 500,
            reason: "운영 보상",
            createdAt: "2026-07-31T01:00:00.000Z",
          },
          { status: 201 },
        );
      }),
    );

    render(
      <AppProviders>
        <CreditsPage />
      </AppProviders>,
    );

    await screen.findByText("표시할 항목이 없습니다.");
    await userEvent.click(screen.getByRole("button", { name: "크레딧 지급" }));
    const userSelect = await screen.findByRole("combobox", { name: "사용자" });
    await userEvent.type(userSelect, "테스트 사용자");
    await userEvent.click(
      await screen.findByText("테스트 사용자 (user@example.com)"),
    );
    await userEvent.type(screen.getByLabelText("금액"), "500");
    await userEvent.type(screen.getByLabelText("사유"), "운영 보상");
    await userEvent.click(screen.getByRole("button", { name: "지급" }));

    await waitFor(() => expect(requestCount).toBe(1));
    const dialog = screen.getByRole("dialog", { name: "크레딧 지급" });
    expect(within(dialog).getByRole("button", { name: "취소" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "지급" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    expect(
      screen.getByRole("dialog", { name: "크레딧 지급" }),
    ).toBeInTheDocument();
    expect(requestCount).toBe(1);

    finishGrant?.();
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "크레딧 지급" }),
      ).not.toBeInTheDocument(),
    );
  });
});
