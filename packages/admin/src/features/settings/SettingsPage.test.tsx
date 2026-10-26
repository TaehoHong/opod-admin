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
        embeddingApiUrl: null,
        embeddingApiKey: { set: false },
        embeddingModel: null,
      },
      effective: {
        apiUrl: null,
        apiKeyLast4: null,
        model: null,
        embeddingApiUrl: null,
        embeddingApiKeyLast4: null,
        embeddingModel: null,
        overridden: {
          apiUrl: false,
          apiKey: false,
          model: false,
          embeddingApiUrl: false,
          embeddingApiKey: false,
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
    scheduledPublication: { enabled: true, source: "none" },
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

it("loads, edits and clears the DB Qwen common negative through the settings form", async () => {
  const user = userEvent.setup();
  let view = {
    ...settingsView(),
    imageProvider: "spicyapi" as const,
    qwenImageNegativePrompt: "watermark, waxy skin" as string | null,
  };
  const saved: Record<string, unknown>[] = [];
  server.use(
    ...stubReads(() => view),
    http.put("/api/admin/v1/settings/generation", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      saved.push(body);
      view = {
        ...view,
        qwenImageNegativePrompt: body.qwenImageNegativePrompt as string | null,
      };
      return HttpResponse.json(view);
    }),
  );
  render(
    <AppProviders>
      <SettingsPage />
    </AppProviders>,
  );
  const input = await screen.findByRole("textbox", {
    name: "Qwen 공통 네거티브 프롬프트",
  });
  expect(input).toHaveValue("watermark, waxy skin");
  await user.clear(input);
  await user.type(input, "watermark, malformed hands");
  await user.click(screen.getByRole("button", { name: "변경사항 저장" }));
  await waitFor(() =>
    expect(saved[0]?.qwenImageNegativePrompt).toBe(
      "watermark, malformed hands",
    ),
  );
  await screen.findByText("설정을 저장했습니다.");
  await user.clear(
    screen.getByRole("textbox", { name: "Qwen 공통 네거티브 프롬프트" }),
  );
  await user.click(screen.getByRole("button", { name: "변경사항 저장" }));
  await waitFor(() => expect(saved[1]?.qwenImageNegativePrompt).toBeNull());
});

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

it("shows the configured Sunburst model and keeps the saved image key on save", async () => {
  const view = {
    ...settingsView(),
    imageProvider: "openai" as const,
    openaiImageModel: "gpt-image-2.5-sunburst",
    openaiApiKey: { set: true, last4: "1234" },
  };
  const saved: unknown[] = [];
  server.use(
    ...stubReads(() => view),
    http.put("/api/admin/v1/settings/generation", async ({ request }) => {
      saved.push(await request.json());
      return HttpResponse.json(view);
    }),
  );
  render(
    <AppProviders>
      <SettingsPage />
    </AppProviders>,
  );
  expect(
    await screen.findByRole("combobox", { name: "이미지 모델" }),
  ).toHaveValue("GPT Image 2.5 Sunburst");
  expect(screen.queryByLabelText("fal.ai API 키")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "변경사항 저장" }));
  await waitFor(() => expect(saved).toHaveLength(1));
  expect(saved[0]).toMatchObject({
    imageProvider: "openai",
    openaiImageModel: "gpt-image-2.5-sunburst",
  });
  expect(saved[0]).not.toHaveProperty("openaiApiKey");
});

it("defaults SpicyAPI to Qwen Image 3.0 Pro and keeps the saved key on save", async () => {
  const view = {
    ...settingsView(),
    imageProvider: "spicyapi" as const,
    spicyImageModel: null,
    spicyApiKey: { set: true, last4: "9876" },
  };
  const saved: unknown[] = [];
  server.use(
    ...stubReads(() => view),
    http.put("/api/admin/v1/settings/generation", async ({ request }) => {
      saved.push(await request.json());
      return HttpResponse.json(view);
    }),
  );
  render(
    <AppProviders>
      <SettingsPage />
    </AppProviders>,
  );
  expect(
    await screen.findByRole("combobox", { name: "이미지 모델" }),
  ).toHaveValue("Qwen Image 3.0 Pro");
  expect(screen.getByLabelText("SpicyAPI 키")).toBeInTheDocument();
  expect(screen.queryByLabelText("fal.ai API 키")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "변경사항 저장" }));
  await waitFor(() => expect(saved).toHaveLength(1));
  expect(saved[0]).toMatchObject({
    imageProvider: "spicyapi",
    spicyImageModel: "alibaba/qwen-image-3.0-pro/edit",
  });
  expect(saved[0]).not.toHaveProperty("spicyApiKey");
});

it("persists scheduled publication independently of generation and reflects it after reload", async () => {
  let view = settingsView();
  const saved: unknown[] = [];
  server.use(
    ...stubReads(() => view),
    http.put("/api/admin/v1/settings/generation", async ({ request }) => {
      const body = (await request.json()) as {
        scheduledPublishEnabled: boolean;
      };
      saved.push(body);
      view = {
        ...view,
        scheduledPublication: {
          enabled: body.scheduledPublishEnabled,
          source: "db",
        },
      };
      return HttpResponse.json(view);
    }),
  );
  const page = render(
    <AppProviders>
      <SettingsPage />
    </AppProviders>,
  );
  const publication = await screen.findByRole("switch", {
    name: "예약 게시 자동 실행",
  });
  expect(publication).toBeChecked();
  expect(
    screen.getByRole("switch", { name: "생성 자동 실행" }),
  ).not.toBeChecked();
  await userEvent.click(publication);
  await waitFor(() =>
    expect(saved).toEqual([{ scheduledPublishEnabled: false }]),
  );
  await waitFor(() => expect(publication).not.toBeChecked());
  page.unmount();
  render(
    <AppProviders>
      <SettingsPage />
    </AppProviders>,
  );
  const reloaded = await screen.findByRole("switch", {
    name: "예약 게시 자동 실행",
  });
  expect(reloaded).not.toBeChecked();
  await userEvent.click(reloaded);
  await waitFor(() =>
    expect(saved).toEqual([
      { scheduledPublishEnabled: false },
      { scheduledPublishEnabled: true },
    ]),
  );
  await waitFor(() => expect(reloaded).toBeChecked());
  expect(
    screen.getByRole("switch", { name: "생성 자동 실행" }),
  ).not.toBeChecked();
});
