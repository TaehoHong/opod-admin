import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AppProviders } from "../../app/providers";
import { server } from "../../test/server";
import { LlmLogsPage } from "./LlmLogsPage";
import type { LlmLogDetail, LlmLogListItem } from "./api";

const listItem: LlmLogListItem = {
  id: "101",
  type: "agent.chat",
  provider: "openai-compatible",
  model: "requested-model",
  displayModel: "response-model",
  responseModel: "response-model",
  status: "succeeded",
  isStreaming: true,
  requestId: "request-1",
  providerRequestId: "provider-1",
  userId: "user-1",
  characterId: null,
  generationJobId: null,
  httpStatus: 200,
  errorType: null,
  durationMs: 2_500,
  inputTokens: 100,
  outputTokens: 40,
  totalTokens: 140,
  finishReason: "stop",
  timeToFirstTokenMs: 500,
  cachedInputTokens: 25,
  cacheWriteTokens: 5,
  reasoningTokens: 10,
  cost: "0.0012",
  upstreamCost: "0.0010",
  createdAt: "2026-08-24T01:02:03.000Z",
  completedAt: "2026-08-24T01:02:05.500Z",
  mediaCount: 0,
};

const detail: LlmLogDetail = {
  ...listItem,
  endpoint: "https://provider.test/v1/chat/completions",
  systemPromptJson: null,
  userPromptJson: [{ role: "user", content: "hello" }],
  requestJson: { model: "requested-model" },
  responseJson: { model: "response-model" },
  usageJson: { prompt_tokens_details: { cached_tokens: 25 } },
  metadataJson: null,
  redactedPaths: [],
  errorMessage: null,
  media: [],
};

function renderPage(path = "/llm-logs") {
  render(
    <AppProviders>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="llm-logs" element={<LlmLogsPage />} />
          <Route path="llm-logs/:logId" element={<LlmLogsPage />} />
        </Routes>
      </MemoryRouter>
    </AppProviders>,
  );
}

describe("LLM log observability", () => {
  it("keeps the list compact and shows request/response metrics in detail", async () => {
    server.use(
      http.get("/api/admin/v1/llm-logs", () =>
        HttpResponse.json({ items: [listItem] }),
      ),
      http.get("/api/admin/v1/llm-logs/:id", () => HttpResponse.json(detail)),
    );

    renderPage();

    const row = (await screen.findByText("response-model")).closest("tr");
    expect(row).not.toBeNull();
    expect(within(row!).queryByText("requested-model")).not.toBeInTheDocument();
    expect(
      within(row!).getByText("입력 100 · 출력 40 · 캐시 25 (25.0%)"),
    ).toBeInTheDocument();
    expect(
      within(row!).getByText("2,500 ms · TTFT 500 ms · 20.0 tok/s"),
    ).toBeInTheDocument();
    expect(within(row!).getByText("0.0012")).toBeInTheDocument();

    await userEvent.click(row!);

    expect(await screen.findByText("요청 모델")).toBeInTheDocument();
    expect(screen.getAllByText("requested-model").length).toBeGreaterThan(0);
    expect(screen.getByText("응답 모델")).toBeInTheDocument();
    expect(screen.getAllByText("response-model").length).toBeGreaterThan(0);
    expect(screen.getByText("캐시 (읽기/쓰기)")).toBeInTheDocument();
    expect(screen.getByText("25 / 5")).toBeInTheDocument();
    expect(screen.getByText("생성 속도")).toBeInTheDocument();
    expect(screen.getByText("20.0 tok/s")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "목록으로" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("loads a direct detail URL without relying on the list and preserves filters on return", async () => {
    server.use(
      http.get("/api/admin/v1/llm-logs", () =>
        HttpResponse.json({ items: [] }),
      ),
      http.get("/api/admin/v1/llm-logs/:id", () => HttpResponse.json(detail)),
    );
    renderPage("/llm-logs/101?status=failed&model=test-model");
    expect(await screen.findByText("요청 모델")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "목록으로" })).toHaveAttribute(
      "href",
      "/llm-logs?status=failed&model=test-model",
    );
    await userEvent.click(screen.getByRole("link", { name: "목록으로" }));
    expect(
      await screen.findByText("조건에 맞는 호출이 없습니다."),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "model" })).toHaveValue(
      "test-model",
    );
  });

  it("keeps a back path when a detail no longer exists", async () => {
    server.use(
      http.get("/api/admin/v1/llm-logs/:id", () =>
        HttpResponse.json({ message: "LLM log not found" }, { status: 404 }),
      ),
    );
    renderPage("/llm-logs/999");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "LLM log not found",
    );
    expect(screen.getByRole("link", { name: "목록으로" })).toHaveAttribute(
      "href",
      "/llm-logs",
    );
  });
});
