import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { AppProviders, createQueryClient } from "../../app/providers";
import { server } from "../../test/server";
import { StageExecutionRecords } from "./StageExecutionRecords";

const detail = {
  id: "log-a",
  status: "succeeded",
  requestJson: { original: "persisted request" },
  responseJson: { original: "persisted response" },
  systemPromptJson: null,
  userPromptJson: null,
  redactedPaths: ["request.authorization"],
  media: [],
};

describe("stage execution originals", () => {
  it("opens persisted input/output from the exact request and stage", async () => {
    server.use(
      http.get("/api/admin/v1/llm-logs", ({ request }) => {
        const query = new URL(request.url).searchParams;
        if (
          query.get("requestId") !== "draft-a" ||
          query.get("type") !== "post.plan"
        )
          return new HttpResponse(null, { status: 400 });
        return HttpResponse.json({ items: [{ id: "log-a" }] });
      }),
      http.get("/api/admin/v1/llm-logs/log-a", () => HttpResponse.json(detail)),
    );
    render(
      <AppProviders>
        <StageExecutionRecords requestId="draft-a" type="post.plan" />
      </AppProviders>,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "입력 원본" }),
    );
    await waitFor(() =>
      expect(screen.getByText(/persisted request/)).toBeVisible(),
    );
    expect(screen.getAllByText(/request.authorization/)[0]).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "출력 원본" }));
    await waitFor(() =>
      expect(screen.getByText(/persisted response/)).toBeVisible(),
    );
  });

  it("never queries without an exact scope", async () => {
    const client = createQueryClient();
    render(
      <AppProviders queryClient={client}>
        <StageExecutionRecords requestId="draft-only" />
      </AppProviders>,
    );
    expect(screen.getByText("실행 기록이 없습니다.")).toBeVisible();
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });

  it("limits image history to its job and lets operators inspect older attempts", async () => {
    server.use(
      http.get("/api/admin/v1/llm-logs", ({ request }) => {
        const query = new URL(request.url).searchParams;
        if (
          query.get("generationJobId") !== "job-a" ||
          query.get("type") !== "admin.image.generate" ||
          query.has("requestId")
        )
          return new HttpResponse(null, { status: 400 });
        return HttpResponse.json(
          query.has("cursor")
            ? {
                items: [
                  {
                    id: "older",
                    status: "failed",
                    createdAt: "2026-10-18T00:00:00Z",
                  },
                ],
              }
            : {
                items: [
                  {
                    id: "latest",
                    status: "running",
                    createdAt: "2026-10-19T00:00:00Z",
                  },
                ],
                nextCursor: "older-page",
              },
        );
      }),
      http.get("/api/admin/v1/llm-logs/:id", ({ params }) =>
        HttpResponse.json({
          ...detail,
          responseJson: null,
          status: params.id === "latest" ? "running" : "failed",
        }),
      ),
    );
    render(
      <AppProviders>
        <StageExecutionRecords generationJobId="job-a" type="ignored" />
      </AppProviders>,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "출력 원본" }),
    );
    await waitFor(() =>
      expect(
        screen.getByText("실행 중입니다. 출력 원본이 아직 없습니다."),
      ).toBeVisible(),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "이전 실행 더 보기" }),
    );
    await userEvent.selectOptions(
      await screen.findByLabelText("실행 기록"),
      "older",
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "출력 원본" }),
    );
    await waitFor(() =>
      expect(screen.getByText("저장된 원본이 없습니다.")).toBeVisible(),
    );
  });

  it("reveals the persisted response when a running execution completes without navigation", async () => {
    let completed = false;
    server.use(
      http.get("/api/admin/v1/llm-logs/running", () =>
        HttpResponse.json({
          ...detail,
          status: completed ? "succeeded" : "running",
          responseJson: completed
            ? { original: "completed persisted response" }
            : null,
        }),
      ),
    );
    render(
      <AppProviders>
        <StageExecutionRecords producerLogId="running" />
      </AppProviders>,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "출력 원본" }),
    );
    await waitFor(() =>
      expect(
        screen.getByText("실행 중입니다. 출력 원본이 아직 없습니다."),
      ).toBeVisible(),
    );
    completed = true;
    await waitFor(
      () =>
        expect(screen.getByText(/completed persisted response/)).toBeVisible(),
      { timeout: 4000 },
    );
  });

  it("isolates switched scopes while an old response is pending and supports retry", async () => {
    let release!: () => void;
    let failed = true;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get("/api/admin/v1/llm-logs/old", async () => {
        await pending;
        return HttpResponse.json({ ...detail, requestJson: "old original" });
      }),
      http.get("/api/admin/v1/llm-logs/new", () =>
        failed
          ? new HttpResponse(null, { status: 500 })
          : HttpResponse.json({ ...detail, requestJson: "new original" }),
      ),
    );
    const client = createQueryClient();
    const view = render(
      <AppProviders queryClient={client}>
        <StageExecutionRecords producerLogId="old" />
      </AppProviders>,
    );
    await waitFor(() => expect(client.isFetching()).toBe(1));
    view.rerender(
      <AppProviders queryClient={client}>
        <StageExecutionRecords producerLogId="new" />
      </AppProviders>,
    );
    expect(
      await screen.findByText("실행 기록을 불러오지 못했습니다."),
    ).toBeVisible();
    release();
    failed = false;
    await userEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await userEvent.click(
      await screen.findByRole("button", { name: "입력 원본" }),
    );
    await waitFor(() => expect(screen.getByText("new original")).toBeVisible());
    expect(screen.queryByText("old original")).not.toBeInTheDocument();
  });
  it("opens every exact selection attempt without searching unrelated logs", async () => {
    const requested: string[] = [];
    server.use(
      http.get("/api/admin/v1/llm-logs/:id", ({ params }) => {
        requested.push(String(params.id));
        return HttpResponse.json({ ...detail, id: params.id });
      }),
    );
    render(
      <AppProviders>
        <StageExecutionRecords producerLogIds={["attempt-1", "attempt-2"]} />
      </AppProviders>,
    );
    await screen.findByRole("button", { name: "입력 원본" });
    expect(requested).toEqual(["attempt-2"]);
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "실행 기록" }),
      "attempt-1",
    );
    await waitFor(() => expect(requested).toEqual(["attempt-2", "attempt-1"]));
  });
});
