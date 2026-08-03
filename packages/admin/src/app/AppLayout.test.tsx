import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AppProviders, createQueryClient } from "./providers";
import { AppLayout } from "./AppLayout";

describe("admin application shell", () => {
  it("identifies the current destination and supports keyboard and mobile navigation", async () => {
    const queryClient = createQueryClient();
    queryClient.setQueryDefaults(["session"], { staleTime: Infinity });
    queryClient.setQueryDefaults(["pending-counts"], { staleTime: Infinity });
    queryClient.setQueryData(["session"], { email: "admin@example.com" });
    queryClient.setQueryData(["pending-counts"], {
      drafts: { count: 0, hasMore: false },
      media: { count: 0, hasMore: false },
      generation: { count: 0, hasMore: false },
      moderation: { count: 0, hasMore: false },
      payments: { count: 0, hasMore: false },
    });

    render(
      <AppProviders queryClient={queryClient}>
        <MemoryRouter initialEntries={["/posts"]}>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="posts" element={<div>게시글 화면</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AppProviders>,
    );

    expect(screen.getByRole("link", { name: "게시글" })).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(screen.getByRole("link", { name: "본문 바로가기" })).toHaveAttribute(
      "href",
      "#main-content",
    );
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");

    await userEvent.click(screen.getByRole("button", { name: "메뉴 열기" }));
    expect(screen.getByRole("button", { name: "메뉴 닫기" })).toBeVisible();

    await userEvent.click(screen.getByRole("link", { name: "게시글" }));
    expect(screen.getByRole("button", { name: "메뉴 열기" })).toBeVisible();
  });
});
