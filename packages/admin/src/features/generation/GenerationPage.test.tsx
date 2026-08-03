import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { renderPage } from "../../test/renderPage";
import { server } from "../../test/server";
import { GenerationPage } from "./GenerationPage";

// Mantine Select scrolls the active option; jsdom does not implement it.
if (!window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = () => {};
}

describe("generation job management", () => {
  it("queues a job with the selected character and refreshes an empty list", async () => {
    const requests: unknown[] = [];
    let listRequests = 0;
    let jobs: Array<Record<string, unknown>> = [];

    server.use(
      http.get("/api/admin/v1/characters", () =>
        HttpResponse.json({
          items: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              publicId: "test-character",
              displayName: "테스트 캐릭터",
            },
          ],
        }),
      ),
      http.get("/api/admin/v1/generation/jobs", () => {
        listRequests += 1;
        return HttpResponse.json({ items: jobs });
      }),
      http.get("/api/admin/v1/settings/generation", () =>
        HttpResponse.json({
          resolved: {
            t2iProvider: "test-t2i",
            editProvider: "test-edit",
            plannerProvider: "test-planner",
          },
        }),
      ),
      http.post("/api/admin/v1/generation/jobs", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        requests.push(body);
        const created = {
          id: "22222222-2222-4222-8222-222222222222",
          status: "queued",
          attemptCount: 0,
          createdAt: "2026-07-31T01:00:00.000Z",
          updatedAt: "2026-07-31T01:00:00.000Z",
          ...body,
        };
        jobs = [created];
        return HttpResponse.json(created, { status: 201 });
      }),
    );

    renderPage(<GenerationPage />, {
      path: "/generation",
      routes: ["generation", "generation/:jobId"],
    });

    await screen.findByText("조건에 맞는 작업이 없습니다.");
    await userEvent.click(
      screen.getByRole("button", { name: "생성 작업 큐 등록" }),
    );

    const characterSelect = await screen.findByRole("combobox", {
      name: "캐릭터",
    });
    await userEvent.type(characterSelect, "테스트 캐릭터");
    await userEvent.click(await screen.findByText("테스트 캐릭터"));

    await userEvent.click(
      screen.getByRole("combobox", { name: "미디어 타입" }),
    );
    await userEvent.click(await screen.findByText("video"));
    await userEvent.type(
      screen.getByRole("textbox", { name: "프롬프트" }),
      "  파도 위를 달리는 장면  ",
    );
    await userEvent.click(screen.getByRole("button", { name: "큐 등록" }));

    await waitFor(() =>
      expect(requests).toEqual([
        {
          characterId: "11111111-1111-4111-8111-111111111111",
          mediaType: "video",
          prompt: "파도 위를 달리는 장면",
        },
      ]),
    );
    expect(
      await screen.findByText("파도 위를 달리는 장면"),
    ).toBeInTheDocument();
    expect(listRequests).toBeGreaterThan(1);
  });

  it("completes a running video job with an output URL and refreshes it", async () => {
    const requests: unknown[] = [];
    let listRequests = 0;
    let jobs = [
      {
        id: "33333333-3333-4333-8333-333333333333",
        characterId: "11111111-1111-4111-8111-111111111111",
        mediaType: "video",
        prompt: "완료할 영상",
        status: "running",
        attemptCount: 1,
        createdAt: "2026-07-31T01:00:00.000Z",
        updatedAt: "2026-07-31T01:00:00.000Z",
      },
    ];

    server.use(
      http.get("/api/admin/v1/generation/jobs", () => {
        listRequests += 1;
        return HttpResponse.json({ items: jobs });
      }),
      http.get("/api/admin/v1/settings/generation", () =>
        HttpResponse.json({
          resolved: {
            t2iProvider: null,
            editProvider: null,
            plannerProvider: "test-planner",
          },
        }),
      ),
      http.post(
        "/api/admin/v1/generation/jobs/33333333-3333-4333-8333-333333333333/complete",
        async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>;
          requests.push(body);
          jobs = [{ ...jobs[0], status: "completed", ...body }];
          return HttpResponse.json(jobs[0]);
        },
      ),
    );

    renderPage(<GenerationPage />, {
      path: "/generation",
      routes: ["generation", "generation/:jobId"],
    });

    await screen.findByText("완료할 영상");
    await userEvent.click(screen.getByRole("button", { name: "완료 처리" }));
    const dialog = await screen.findByRole("dialog", {
      name: "생성 작업 완료 처리",
    });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "완료 처리" }),
    );
    expect(
      await within(dialog).findByText(
        "미디어 ID 또는 출력 URL을 입력해 주세요",
      ),
    ).toBeInTheDocument();
    expect(requests).toEqual([]);

    await userEvent.type(
      within(dialog).getByRole("textbox", { name: "출력 URL" }),
      "https://cdn.example.com/output.mp4",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "완료 처리" }),
    );

    await waitFor(() =>
      expect(requests).toEqual([{ url: "https://cdn.example.com/output.mp4" }]),
    );
    expect(await screen.findByText("완료")).toBeInTheDocument();
    expect(listRequests).toBeGreaterThan(1);
  });

  it("shows the server error when a queued job cannot run", async () => {
    server.use(
      http.get("/api/admin/v1/generation/jobs", () =>
        HttpResponse.json({
          items: [
            {
              id: "44444444-4444-4444-8444-444444444444",
              characterId: "11111111-1111-4111-8111-111111111111",
              mediaType: "video",
              prompt: "실행할 영상",
              status: "queued",
              attemptCount: 0,
              createdAt: "2026-07-31T01:00:00.000Z",
              updatedAt: "2026-07-31T01:00:00.000Z",
            },
          ],
        }),
      ),
      http.get("/api/admin/v1/settings/generation", () =>
        HttpResponse.json({
          resolved: {
            t2iProvider: null,
            editProvider: null,
            plannerProvider: "test-planner",
          },
        }),
      ),
      http.post("/api/admin/v1/generation/worker/run", () =>
        HttpResponse.json({ message: "worker unavailable" }, { status: 503 }),
      ),
    );

    renderPage(<GenerationPage />, {
      path: "/generation",
      routes: ["generation", "generation/:jobId"],
    });

    await screen.findByText("실행할 영상");
    await userEvent.click(screen.getByRole("button", { name: "실행" }));

    expect(await screen.findByText("worker unavailable")).toBeInTheDocument();
  });
});
