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
    falApiKey: { set: false },
    falImageModel: null,
    falImageT2iModel: null,
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
    evaluator: {
      overrides: { apiUrl: null, apiKey: { set: false }, model: null },
      effective: {
        apiUrl: null,
        apiKeyLast4: null,
        model: null,
        overridden: { apiUrl: false, apiKey: false, model: false },
      },
    },
    resolved: {
      t2iProvider: null,
      editProvider: null,
      plannerProvider: "unconfigured",
      sources: { apiKey: "none", editModel: "none", t2iModel: "none" },
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
    worker: {
      enabled: false,
      enabledSource: "none",
      dailyBudgetUsd: null,
      jobCostEstimateUsd: 0.2,
      todaySpendUsd: 0,
      evaluation: { enabled: false, enabledSource: "env" },
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
  it("saves the evaluation worker switch as a boolean and reflects the new state", async () => {
    let view = settingsView();
    const saved: unknown[] = [];

    server.use(
      ...stubReads(() => view),
      http.put("/api/admin/v1/settings/generation", async ({ request }) => {
        const body = await request.json();
        saved.push(body);
        view = settingsView({
          evaluation: { enabled: true, enabledSource: "db" },
        });
        return HttpResponse.json(view);
      }),
    );

    render(
      <AppProviders>
        <SettingsPage />
      </AppProviders>,
    );

    const evaluationSwitch = await screen.findByRole("switch", {
      name: "평가 워커 자동 루프",
    });
    expect(evaluationSwitch).not.toBeChecked();
    // DB에 저장된 적이 없으면 env 기본값을 쓰는 중임을 알려야 한다.
    expect(screen.getByText("env 기본값")).toBeInTheDocument();

    await userEvent.click(evaluationSwitch);

    await waitFor(() =>
      expect(saved).toEqual([{ evaluationWorkerEnabled: true }]),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("switch", { name: "평가 워커 자동 루프" }),
      ).toBeChecked(),
    );
    expect(screen.queryByText("env 기본값")).not.toBeInTheDocument();
  });

  it("runs a pending evaluation manually and reports what actually ran", async () => {
    server.use(
      ...stubReads(() => settingsView()),
      http.post("/api/admin/v1/evaluations/worker/run", () =>
        HttpResponse.json({ evaluated: ["plan"] }),
      ),
    );

    render(
      <AppProviders>
        <SettingsPage />
      </AppProviders>,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "대기 평가 실행" }),
    );

    expect(
      await screen.findByText("기획 평가를 실행했습니다."),
    ).toBeInTheDocument();
  });

  it("tells the operator when nothing was pending instead of implying success", async () => {
    server.use(
      ...stubReads(() => settingsView()),
      http.post("/api/admin/v1/evaluations/worker/run", () =>
        HttpResponse.json({ evaluated: [] }),
      ),
    );

    render(
      <AppProviders>
        <SettingsPage />
      </AppProviders>,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "대기 평가 실행" }),
    );

    expect(
      await screen.findByText("대기 중인 평가가 없습니다."),
    ).toBeInTheDocument();
  });
});
