import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { AppProviders } from "../../app/providers";
import { server } from "../../test/server";
import { SettingsPage } from "./SettingsPage";
import type { GenerationSettingsView } from "./api";

// 워커 토글이 화면에서 DB로 이어지는 경로. 여기가 끊기면 운영자가 스위치를
// 내려도 워커가 계속 돌아 이미지·평가 비용이 샌다.
function settingsView(
  overrides: Partial<GenerationSettingsView["worker"]> = {},
): GenerationSettingsView {
  return {
    imageProvider: "fal",
    falApiKey: { set: false },
    falImageModel: null,
    falImageT2iModel: null,
    opodFluxApiBaseUrl: null,
    opodFluxApiKey: { set: false },
    llmApiUrl: null,
    llmApiKey: { set: false },
    llmModel: null,
    chat: {
      overrides: {
        apiUrl: null,
        apiKey: { set: false },
        model: null,
        embeddingModel: null,
      },
      effective: {
        apiUrl: null,
        apiKeyLast4: null,
        model: null,
        embeddingModel: "text-embedding-3-small",
        overridden: {
          apiUrl: false,
          apiKey: false,
          model: false,
          embeddingModel: false,
        },
      },
    },
    resolved: {
      t2iProvider: null,
      editProvider: null,
      plannerProvider: "unconfigured",
      sources: {
        provider: "none",
        apiKey: "none",
        editModel: "none",
        t2iModel: "none",
        opodFluxApiBaseUrl: "none",
        opodFluxApiKey: "none",
      },
      plannerSources: { apiUrl: "none", apiKey: "none", model: "none" },
    },
    aspectRatios: {
      overrides: { feed: null, story: null, reel: null },
      effective: {
        feed: { value: "4:5", source: "default" },
        story: { value: "9:16", source: "default" },
        reel: { value: "9:16", source: "default" },
      },
    },
    pipelineV3: { enabled: false, source: "none" },
    worker: {
      enabled: false,
      enabledSource: "none",
      dailyBudgetUsd: null,
      jobCostEstimateUsd: 0.2,
      todaySpendUsd: 0,
      ...overrides,
    },
  };
}

// 저장 후 재조회가 새 상태를 돌려줘야 하므로 현재 view를 매번 읽는다.
function stubReads(view: () => GenerationSettingsView) {
  return [
    http.get("/api/admin/v1/settings/generation", () =>
      HttpResponse.json(view()),
    ),
    http.get("/api/admin/v1/settings/generation/changes", () =>
      HttpResponse.json({ items: [] }),
    ),
    http.get("/api/admin/v1/generation/jobs", () =>
      HttpResponse.json({ items: [] }),
    ),
  ];
}

describe("settings worker card", () => {
  it("activates V3 only through the settings endpoint and reflects the pinned rollout state", async () => {
    let view = settingsView();
    const saved: unknown[] = [];

    server.use(
      ...stubReads(() => view),
      http.put("/api/admin/v1/settings/generation", async ({ request }) => {
        saved.push(await request.json());
        view = { ...view, pipelineV3: { enabled: true, source: "db" } };
        return HttpResponse.json(view);
      }),
    );

    render(
      <AppProviders>
        <SettingsPage />
      </AppProviders>,
    );

    const rollout = await screen.findByRole("switch", {
      name: "게시글 생성 Agent V3 신규 초안 적용",
    });
    await userEvent.click(rollout);

    await waitFor(() => expect(saved).toEqual([{ pipelineV3Enabled: true }]));
    await waitFor(() => expect(rollout).toBeChecked());
  });
});
