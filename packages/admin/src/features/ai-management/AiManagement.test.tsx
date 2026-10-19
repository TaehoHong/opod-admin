import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { MantineProvider } from "@mantine/core";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "../../app/providers";
import { theme } from "../../app/theme";
import { server } from "../../test/server";
import { AiConnectionsPage } from "./AiConnectionsPage";
import { FeatureModelsPage } from "./FeatureModelsPage";
import type { AiConfig } from "./api";

Element.prototype.scrollIntoView = () => {};

function fixture(): AiConfig {
  return {
    revision: "r1",
    changes: [],
    connections: [
      {
        id: "llm",
        type: "llm",
        provider: "openai-compatible",
        apiUrl: "https://llm.test/v1",
        configured: true,
        apiKey: { set: true, last4: "1234" },
        models: [
          { id: "1", model: "plan-model" },
          { id: "2", model: "caption-model" },
        ],
      },
      {
        id: "image",
        type: "image",
        provider: "spicyapi",
        apiUrl: "https://image.test/api/v1",
        configured: true,
        apiKey: { set: true, last4: "5678" },
        models: [{ id: "3", model: "image-model" }],
      },
    ],
    features: [
      {
        id: "natural.post_plan",
        group: "새 Agent",
        label: "게시물 기획",
        description: "게시물 구성",
        type: "llm",
        selection: {
          connectionId: "llm",
          modelId: "1",
          provider: "openai-compatible",
          model: "plan-model",
        },
      },
      {
        id: "natural.caption",
        group: "새 Agent",
        label: "캡션",
        description: "캡션 작성",
        type: "llm",
        selection: {
          connectionId: "llm",
          modelId: "1",
          provider: "openai-compatible",
          model: "plan-model",
        },
      },
    ],
  };
}
function show(page: React.ReactNode, path = "/") {
  render(
    <MantineProvider theme={theme} env="test">
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={[path]}>{page}</MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("AI settings screens", () => {
  it("keeps API details in a popup, registers models there, and separates LLM/image catalogs", async () => {
    let config = fixture();
    let submitted: unknown;
    server.use(
      http.get("/api/admin/v1/ai-management", () => HttpResponse.json(config)),
      http.post(
        "/api/admin/v1/ai-management/connections/llm/models",
        async ({ request }) => {
          submitted = await request.json();
          config = {
            ...config,
            revision: "r2",
            connections: config.connections.map((c) =>
              c.id === "llm"
                ? {
                    ...c,
                    models: [...c.models, { id: "4", model: "new-model" }],
                  }
                : c,
            ),
          };
          return HttpResponse.json(config);
        },
      ),
    );
    show(<AiConnectionsPage />);
    await screen.findByText("https://llm.test/v1");
    expect(screen.queryByLabelText("API 주소")).not.toBeInTheDocument();
    expect(
      screen.queryByText("https://image.test/api/v1"),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "https://llm.test/v1 설정" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "API · 모델 설정",
    });
    expect(within(dialog).getByLabelText("인증 키 교체")).toHaveValue("");
    await userEvent.type(
      within(dialog).getByRole("combobox", { name: "모델 ID" }),
      "new-model",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "모델 등록" }),
    );
    await within(dialog).findByText("new-model");
    expect(submitted).toEqual({ model: "new-model", expectedRevision: "r1" });
    await userEvent.click(within(dialog).getByRole("button", { name: "닫기" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /이미지 API 1개/ }),
    );
    await screen.findByText("https://image.test/api/v1");
    expect(screen.queryByText("https://llm.test/v1")).not.toBeInTheDocument();
  });

  it("applies only the selected feature and offers only models on its API without a change comparison card", async () => {
    let config = fixture();
    let submitted: unknown;
    server.use(
      http.get("/api/admin/v1/ai-management", () => HttpResponse.json(config)),
      http.put(
        "/api/admin/v1/ai-management/features/natural.caption",
        async ({ request }) => {
          submitted = await request.json();
          config = {
            ...config,
            revision: "r2",
            features: config.features.map((f) =>
              f.id === "natural.caption"
                ? {
                    ...f,
                    selection: {
                      connectionId: "llm",
                      modelId: "2",
                      model: "caption-model",
                      provider: "openai-compatible",
                    },
                  }
                : f,
            ),
          };
          return HttpResponse.json(config);
        },
      ),
    );
    show(<FeatureModelsPage />, "/model-assignments?feature=natural.caption");
    await screen.findByRole("heading", { name: "캡션" });
    expect(screen.queryByText("적용 범위")).not.toBeInTheDocument();
    expect(screen.queryByText("변경 확인")).not.toBeInTheDocument();
    await userEvent.clear(screen.getByRole("combobox", { name: "모델" }));
    await userEvent.type(
      screen.getByRole("combobox", { name: "모델" }),
      "caption",
    );
    expect(
      screen.queryByRole("option", { name: "image-model" }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      await screen.findByRole("option", { name: "caption-model" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "변경사항 적용" }),
    );
    await screen.findByRole("status");
    expect(submitted).toEqual({
      connectionId: "llm",
      modelId: "2",
      expectedRevision: "r1",
    });
    await userEvent.click(screen.getByRole("button", { name: "게시물 기획" }));
    expect(screen.getByRole("combobox", { name: "모델" })).toHaveValue(
      "plan-model",
    );
    expect(
      screen.getByRole("button", { name: "변경사항 적용" }),
    ).toBeDisabled();
  });

  it("preserves a selection when a concurrent save fails and refreshes the revision for retry", async () => {
    let config = fixture();
    let writes = 0;
    let retry: unknown;
    server.use(
      http.get("/api/admin/v1/ai-management", () => HttpResponse.json(config)),
      http.put(
        "/api/admin/v1/ai-management/features/natural.caption",
        async ({ request }) => {
          writes++;
          if (writes === 1) {
            config = { ...config, revision: "r2" };
            return HttpResponse.json(
              { message: "다른 관리자가 설정을 변경했습니다." },
              { status: 409 },
            );
          }
          retry = await request.json();
          return HttpResponse.json(config);
        },
      ),
    );
    show(<FeatureModelsPage />, "/model-assignments?feature=natural.caption");
    await screen.findByRole("heading", { name: "캡션" });
    await userEvent.clear(screen.getByRole("combobox", { name: "모델" }));
    await userEvent.type(
      screen.getByRole("combobox", { name: "모델" }),
      "caption",
    );
    await userEvent.click(
      await screen.findByRole("option", { name: "caption-model" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "변경사항 적용" }),
    );
    await screen.findByRole("alert");
    expect(screen.getByRole("combobox", { name: "모델" })).toHaveValue(
      "caption-model",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "변경사항 적용" }),
    );
    await waitFor(() =>
      expect(retry).toEqual({
        connectionId: "llm",
        modelId: "2",
        expectedRevision: "r2",
      }),
    );
  });
});
