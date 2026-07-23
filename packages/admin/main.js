// OPOD Admin 콘솔 v2 — Broadsheet-styled admin SPA.
//
// Two layers live in this file:
//   1. A pure request/payload helper layer (exported, unit-tested) that maps
//      UI intent onto the real `/api/*` admin backend.
//   2. A state-driven rendering layer that paints the Broadsheet console and
//      wires it to those helpers. The rendering layer degrades gracefully for
//      resources the backend does not expose a list endpoint for (posts,
//      generation jobs) rather than inventing data.

const hasDocument = typeof document !== "undefined";
const $ = (sel) => (hasDocument ? document.querySelector(sel) : undefined);

const appShell = $("#appShell");
const loginRoot = $("#loginRoot");
const mainPanel = $("#mainPanel");
const sidebarNav = $("#sidebarNav");
const dialogRoot = $("#dialogRoot");
const toastRoot = $("#toastRoot");
const identityName = $("#identityName");
const identityEmail = $("#identityEmail");
const identityAvatar = $("#identityAvatar");
const logoutButton = $("#logoutButton");

const adminTokenStorageKey = "opodAdminToken";
const adminEmailStorageKey = "opodAdminEmail";
const pendingForms = new WeakSet();

// ─────────────────────────────────────────────────────────────────────────
// Navigation + routing helpers (unit-tested contract)
// ─────────────────────────────────────────────────────────────────────────

export const navItems = [
  { id: "home", label: "대시보드" },
  { id: "characters", label: "캐릭터" },
  { id: "posts", label: "게시물" },
  { id: "media", label: "미디어" },
  { id: "drafts", label: "초안 검수" },
  { id: "generation", label: "생성 작업" },
  { id: "logs", label: "액션 로그" },
  { id: "users", label: "사용자" },
  { id: "credits", label: "크레딧" },
  { id: "payments", label: "결제 정산" },
  { id: "moderation", label: "신고 처리" },
  { id: "events", label: "이벤트 · 선호" },
  { id: "analytics", label: "분석" },
  { id: "settings", label: "설정" },
];

const DEFAULT_ROUTE = "home";

function parseRouteUrl(input = "/") {
  const raw = String(input ?? "/");
  const url = new URL(
    raw.startsWith("#") ? `/${raw}` : raw,
    "http://admin.local",
  );
  const legacy = raw.startsWith("#") || (url.pathname === "/" && url.hash);
  const source = legacy ? (raw.startsWith("#") ? raw : url.hash) : url.pathname;
  const [path, query = ""] = source.replace(/^#/, "").split("?");
  const segments = path
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return "";
      }
    });
  return { segments, params: new URLSearchParams(query), legacy };
}

export function adminRouteState(input = "/") {
  const { segments, params, legacy } = parseRouteUrl(input);
  const requestedRoute = segments[0] || DEFAULT_ROUTE;
  const route = navItems.some((item) => item.id === requestedRoute)
    ? requestedRoute
    : DEFAULT_ROUTE;
  let detailId = segments[1] ?? "";
  if (legacy && route === "characters") {
    detailId = String(params.get("characterId") ?? "").trim();
  } else if (legacy && route === "generation") {
    detailId = String(params.get("jobId") ?? "").trim();
  }
  return detailId ? { route, detailId } : { route };
}

export function currentRouteFromUrl(url = "/", token = "") {
  const route = adminRouteState(url).route;
  const hasToken = Boolean(String(token ?? "").trim());
  if (!hasToken) {
    return "login";
  }
  if (route === "login") {
    return DEFAULT_ROUTE;
  }
  return navItems.some((item) => item.id === route) ? route : DEFAULT_ROUTE;
}

export function endpoint(path, params = {}) {
  const url = new URL(path, "http://admin.local");
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      url.searchParams.set(key, String(value).trim());
    }
  }
  return `${url.pathname}${url.search}`;
}

export function navBadgeRequests() {
  return [
    {
      key: "drafts",
      path: endpoint("/api/drafts", { status: "needs_review", limit: 50 }),
    },
    {
      key: "media",
      path: endpoint("/api/media", { uploaded: "false", limit: 50 }),
    },
    {
      key: "generation",
      path: endpoint("/api/generation/jobs", { status: "failed", limit: 50 }),
    },
    {
      key: "moderation",
      path: endpoint("/api/moderation/reports", {
        status: "submitted",
        limit: 50,
      }),
    },
    {
      key: "payments",
      path: endpoint("/api/payments/reconciliation", { status: "mismatch" }),
    },
  ];
}

export function analyticsDateRange(period = "7일", now = new Date()) {
  const days = period === "30일" ? 30 : 7;
  const to = new Date(now);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - days);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function analyticsRequests(period = "7일", now = new Date()) {
  const range = analyticsDateRange(period, now);
  return [
    endpoint("/api/analytics", range),
    "/api/analytics/hashtags?limit=10",
  ];
}

const CHARACTER_TABS = [
  "profile",
  "personas",
  "memory",
  "posts",
  "activity",
  "visual",
  "automation",
];

export function characterRouteState(hash = "/characters") {
  const { segments, params, legacy } = parseRouteUrl(hash);
  const characterId = legacy
    ? String(params.get("characterId") ?? "").trim()
    : segments[1] === "new"
      ? ""
      : (segments[1] ?? "");
  const mode = (
    legacy ? params.get("mode") === "create" : segments[1] === "new"
  )
    ? "create"
    : characterId
      ? "detail"
      : "list";
  const requestedTab = String(
    legacy ? (params.get("tab") ?? "profile") : (segments[2] ?? "profile"),
  ).trim();
  const tab = CHARACTER_TABS.includes(requestedTab) ? requestedTab : "profile";

  return {
    route: "characters",
    mode,
    characterId,
    tab,
  };
}

export function generationRouteState(hash = "/generation") {
  const { segments, params, legacy } = parseRouteUrl(hash);
  const jobId = String(
    legacy ? (params.get("jobId") ?? "") : (segments[1] ?? ""),
  ).trim();
  return {
    jobId: jobId === "new" ? "" : jobId,
  };
}

export function generationWorkflowStep(job = {}) {
  if (job.status === "queued" || job.status === "running") {
    return "generating";
  }
  if (job.status === "completed") {
    return job.outputMediaId ? "complete" : "select";
  }
  if (job.status === "failed") {
    return "failed";
  }
  return "prompt";
}

export function generationCandidateSelection(jobId, mediaId) {
  return {
    generationSelectedJobId: String(jobId ?? ""),
    generationSelectedMediaId: String(mediaId ?? ""),
  };
}

export function generationCommitRenderState(
  state,
  job,
  context,
  scheduleRefresh,
) {
  const routeState = generationRouteState(context.hash);
  if (
    context.expectedToken !== context.currentToken ||
    context.route !== "generation" ||
    routeState.jobId !== job.id
  ) {
    return false;
  }
  if (state.generationSelectedJobId !== job.id) {
    state.generationSelectedJobId = job.id;
    state.generationSelectedMediaId = "";
  }
  if (job.status === "queued" || job.status === "running") {
    scheduleRefresh(job.id);
  }
  return true;
}

export function generationReplacePollTimer(state, jobId, runtime) {
  runtime.clearTimer(state.generationPollTimer);
  state.generationPollTimer = 0;
  const routeState = generationRouteState(runtime.currentHash());
  if (runtime.currentRoute() !== "generation" || routeState.jobId !== jobId) {
    return false;
  }
  state.generationPollTimer = runtime.setTimer(() => {
    const nextState = generationRouteState(runtime.currentHash());
    if (runtime.currentRoute() === "generation" && nextState.jobId === jobId) {
      runtime.refresh();
    }
  }, 2000);
  return true;
}

const generationStepLabels = [
  "요청 입력",
  "프롬프트 확인",
  "후보 생성",
  "후보 선택",
];

function generationStepIndex(job) {
  const step = generationWorkflowStep(job);
  if (step === "prompt") return 1;
  if (step === "generating" || step === "failed") return 2;
  return 3;
}

function generationCharacterLabel(characters, characterId) {
  const character = (Array.isArray(characters) ? characters : []).find(
    (item) => item.id === characterId,
  );
  return character?.displayName || character?.publicId || characterId || "—";
}

function generationCandidate(candidate, selectedMediaId, final = false) {
  const source = httpMediaUrl(candidate?.url);
  const selected = candidate?.mediaId === selectedMediaId;
  const preview = source
    ? `<img src="${attr(source)}" alt="후보 ${escapeHtml(Number(candidate?.candidateIndex ?? 0) + 1)}">`
    : `<span>미리보기 없음</span>`;
  if (final) {
    return `<div class="generation-candidate${selected ? " generation-candidate-selected" : ""}">${preview}</div>`;
  }
  return `<button class="generation-candidate${selected ? " generation-candidate-selected" : ""}" type="button" data-act="image-select" data-job-id="${attr(
    candidate?.jobId,
  )}" data-media-id="${attr(candidate?.mediaId)}" aria-pressed="${selected}">${preview}<strong>후보 ${escapeHtml(Number(candidate?.candidateIndex ?? 0) + 1)}</strong></button>`;
}

function generationHistory(history) {
  const rounds = Array.isArray(history) ? history : [];
  if (rounds.length === 0) return "";
  return `<details class="generation-history">
    <summary>이전 생성 회차 (${rounds.length})</summary>
    ${rounds
      .map((round, index) => {
        const outputs = Array.isArray(round.outputs) ? round.outputs : [];
        return `<div class="generation-workflow-card">
          <strong>${escapeHtml(index + 1)}회차 · ${escapeHtml(
            generationWorkflowLabel(round),
          )}</strong>
          <p>${escapeHtml(round.prompt || "—")}</p>
          <dl><dt>후보 수</dt><dd>${escapeHtml(round.candidateCount ?? outputs.length ?? "—")}</dd><dt>선택 결과</dt><dd>${escapeHtml(round.outputMediaId || "—")}</dd><dt>비용</dt><dd>${round.costUsd != null ? `$${escapeHtml(round.costUsd)}` : "—"}</dd><dt>오류</dt><dd>${escapeHtml(round.errorMessage || "—")}</dd></dl>
          <div class="generation-candidate-grid">${outputs
            .map((candidate) =>
              generationCandidate(candidate, round.outputMediaId, true),
            )
            .join("")}</div>
        </div>`;
      })
      .join("")}
  </details>`;
}

function generationWorkflowLabel(job) {
  if (job?.status === "draft") return "프롬프트 확인";
  if (job?.status === "queued") return "생성 대기";
  if (job?.status === "running") return "생성 중";
  if (job?.status === "failed") return "생성 실패";
  return job?.outputMediaId ? "확정 완료" : "후보 선택";
}

export function generationWorkflowPanel(
  job,
  history = [],
  characters = [],
  settings = null,
  selectedMediaId = "",
) {
  const step = generationWorkflowStep(job);
  const currentIndex = generationStepIndex(job);
  const outputs = (Array.isArray(job?.outputs) ? job.outputs : []).map(
    (candidate) => ({ ...candidate, jobId: job.id }),
  );
  const context = job?.generationContext ?? {};
  const route = context.route === "edit" ? "edit" : "t2i";
  const provider =
    settings?.resolved?.[route === "edit" ? "editProvider" : "t2iProvider"];
  let card;

  if (step === "prompt") {
    card = `<form class="generation-workflow-card" data-action="image-draft-update" data-job-id="${attr(job.id)}">
      <h3>최종 프롬프트 확인</h3>
      <div class="field"><label>캐릭터</label><input class="input" value="${attr(
        generationCharacterLabel(characters, job.characterId),
      )}" readonly></div>
      <div class="field"><label>원본 요청</label><textarea class="input" rows="3" readonly>${escapeHtml(job.inputPrompt || job.prompt)}</textarea></div>
      ${
        job.expandedScene
          ? `<div class="field"><label>LLM 확장 장면 (${escapeHtml(job.plannerName || "planner")})</label><textarea class="input" rows="3" readonly>${escapeHtml(job.expandedScene)}</textarea></div>`
          : ""
      }
      <div class="field"><label>최종 프롬프트</label><textarea class="input" name="prompt" rows="6" required>${escapeHtml(job.prompt)}</textarea></div>
      <div class="field"><label>후보 수</label><input class="input" name="candidateCount" type="number" min="1" max="4" step="1" value="${attr(job.candidateCount ?? 1)}" data-generation-candidate-count required></div>
      <p>장면 확장: ${escapeHtml(job.plannerName || "LLM 미설정 — 원문 사용")} · negative prompt: ${escapeHtml(context.negativePrompt || "없음")} · 레퍼런스 ${escapeHtml(context.referenceImageCount ?? 0)}장 · 비율 ${escapeHtml(job.aspectRatio || "프로필 기본")} · ${escapeHtml(route)}${provider ? ` · ${escapeHtml(provider)}` : ""}</p>
      <p>확정 전에는 비용이 발생하지 않습니다.</p>
      <div><button class="btn btn-secondary" type="submit">프롬프트 저장</button> <button class="btn btn-primary" type="submit" data-submit-action="image-confirm" data-generation-count-button>이미지 ${escapeHtml(job.candidateCount ?? 1)}장 생성</button></div>
    </form>`;
  } else if (step === "generating") {
    card = `<div class="generation-workflow-card"><h3>${job.status === "queued" ? "생성 대기" : "생성 중"}</h3><p>${job.status === "queued" ? "작업이 실행 순서를 기다리고 있습니다." : "이미지 후보를 생성하고 있습니다."}</p><p>${escapeHtml(job.provider || provider || "프로바이더 준비 중")}</p></div>`;
  } else if (step === "failed") {
    card = `<div class="generation-workflow-card"><h3>생성 실패</h3><p>${escapeHtml(job.errorMessage || "이미지 생성에 실패했습니다.")}</p><form data-action="image-regenerate" data-job-id="${attr(job.id)}"><button class="btn btn-primary" type="submit">프롬프트 수정 후 새 회차</button></form></div>`;
  } else {
    const finalMediaId = job.outputMediaId || selectedMediaId;
    card = `<div class="generation-workflow-card"><h3>${job.outputMediaId ? "확정 완료" : "후보 선택"}</h3>
      <div class="generation-candidate-grid">${outputs
        .map((candidate) =>
          generationCandidate(
            candidate,
            finalMediaId,
            Boolean(job.outputMediaId),
          ),
        )
        .join("")}</div>
      ${
        job.outputMediaId
          ? `<form data-action="image-regenerate" data-job-id="${attr(job.id)}"><button class="btn btn-secondary" type="submit">프롬프트 수정 후 새 회차</button></form>`
          : `<form data-action="image-select-confirm" data-job-id="${attr(job.id)}"><input type="hidden" name="mediaId" value="${attr(selectedMediaId)}"><button class="btn btn-primary" type="submit"${selectedMediaId ? "" : " disabled"}>최종 확정</button></form>`
      }
    </div>`;
  }

  return `<div class="generation-stepper">${generationStepLabels
    .map(
      (label, index) =>
        `<div class="generation-step${index === currentIndex ? " generation-step-current" : ""}" aria-current="${index === currentIndex ? "step" : "false"}"><span>${index + 1}</span>${escapeHtml(label)}</div>`,
    )
    .join("")}</div>${card}${generationHistory(history)}`;
}

export function routeHref(route, detailId = "") {
  if (route === "home") return "/";
  const base = navItems.some((item) => item.id === route) ? `/${route}` : "/";
  return detailId ? `${base}/${encodeURIComponent(detailId)}` : base;
}

export function characterHref(input = {}) {
  if (input.mode === "create") {
    return "/characters/new";
  }
  if (!input.characterId) return "/characters";
  const detail = routeHref("characters", input.characterId);
  return input.tab && input.tab !== "profile"
    ? `${detail}/${encodeURIComponent(input.tab)}`
    : detail;
}

export function characterPersonasPanel(characterId, personas = []) {
  const items = Array.isArray(personas) ? personas : [];
  const rows = items.length
    ? items
        .map(
          (persona) => `
            <form data-action="persona-update" data-character-id="${attr(
              characterId,
            )}" data-persona-id="${attr(persona.id)}" style="display:flex;flex-direction:column;gap:12px;padding:18px 0;border-bottom:1px solid var(--color-divider)">
              <div style="display:grid;grid-template-columns:minmax(0,1fr) 120px;gap:12px">
                <div class="field"><label>제목</label><input class="input" name="title" value="${attr(
                  persona.title,
                )}" required></div>
                <div class="field"><label>정렬 순서</label><input class="input" name="sortOrder" type="number" step="1" value="${attr(
                  persona.sortOrder ?? "",
                )}" required></div>
              </div>
              <div class="field"><label>내용</label><textarea class="input" name="content" rows="5" required>${escapeHtml(
                persona.content,
              )}</textarea></div>
              <div style="display:flex;gap:8px">
                <button class="btn btn-primary" type="submit">저장</button>
                <button class="btn btn-ghost" type="button" data-act="persona-delete" data-character-id="${attr(
                  characterId,
                )}" data-persona-id="${attr(persona.id)}">삭제</button>
              </div>
            </form>`,
        )
        .join("")
    : noticeBlock(
        "등록된 페르소나가 없습니다 — 위에서 첫 페르소나를 추가하세요.",
      );

  return `<div style="max-width:760px">
    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:12px"><strong>페르소나</strong><span class="count-note">${items.length}건</span></div>
    <form data-action="persona-create" data-character-id="${attr(
      characterId,
    )}" style="display:flex;flex-direction:column;gap:12px;padding:18px;background:var(--color-surface);border-radius:var(--radius-md);margin-bottom:24px">
      <div style="display:grid;grid-template-columns:minmax(0,1fr) 120px;gap:12px">
        <div class="field"><label>새 페르소나 제목</label><input class="input" name="title" required></div>
        <div class="field"><label>정렬 순서 (선택)</label><input class="input" name="sortOrder" type="number" step="1"></div>
      </div>
      <div class="field"><label>내용</label><textarea class="input" name="content" rows="5" required></textarea></div>
      <div><button class="btn btn-secondary" type="submit">페르소나 추가</button></div>
    </form>
    <div>${rows}</div>
  </div>`;
}

export function characterMemoriesPanel(characterId, memories = []) {
  const items = Array.isArray(memories) ? memories : [];
  const rows = items.length
    ? items
        .map(
          (memory) => `
            <form data-action="memory-update" data-character-id="${attr(
              characterId,
            )}" data-memory-id="${attr(memory.id)}" style="display:flex;flex-direction:column;gap:12px;padding:18px 0;border-bottom:1px solid var(--color-divider)">
              <div class="field"><label>내용</label><textarea class="input" name="content" rows="4" required>${escapeHtml(
                memory.content,
              )}</textarea></div>
              <div class="field"><label>사유</label><input class="input" name="reason" value="${attr(
                memory.reason,
              )}" required></div>
              <div style="display:flex;align-items:center;gap:8px">
                <button class="btn btn-primary" type="submit">저장</button>
                <button class="btn btn-ghost" type="button" data-act="memory-delete" data-character-id="${attr(
                  characterId,
                )}" data-memory-id="${attr(memory.id)}">삭제</button>
                <span class="count-note" style="margin-left:auto">${escapeHtml(
                  fmtDate(memory.createdAt),
                )}</span>
              </div>
            </form>`,
        )
        .join("")
    : noticeBlock("등록된 메모리가 없습니다 — 위에서 첫 메모리를 추가하세요.");

  return `<div style="max-width:760px">
    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:12px"><strong>메모리</strong><span class="count-note">${items.length}건</span></div>
    <form data-action="memory-create" data-character-id="${attr(
      characterId,
    )}" style="display:flex;flex-direction:column;gap:12px;padding:18px;background:var(--color-surface);border-radius:var(--radius-md);margin-bottom:24px">
      <div class="field"><label>새 메모리 내용</label><textarea class="input" name="content" rows="4" required></textarea></div>
      <div class="field"><label>사유</label><input class="input" name="reason" required></div>
      <div><button class="btn btn-secondary" type="submit">메모리 추가</button></div>
    </form>
    <div>${rows}</div>
  </div>`;
}

export function dialogContextFromDataset(dataset = {}) {
  return {
    actor: dataset.actor,
    char: dataset.char,
    user: dataset.user,
    postId: dataset.postId,
    jobId: dataset.jobId,
  };
}

export function itemsFromPage(value) {
  if (Array.isArray(value)) {
    return value;
  }
  return Array.isArray(value?.items) ? value.items : [];
}

export function adminUserStats(user) {
  return {
    followCount: Number(user?.followCount) || 0,
    creditBalance: Number(user?.creditBalance) || 0,
  };
}

export function generationActionRequest(jobId, action, body = {}) {
  return {
    path: `/api/generation/jobs/${jobId}/${action}`,
    options: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  };
}

export function imageWorkflowRequest(action, jobId, value) {
  if (action === "create") {
    return jsonRequest("/api/generation/image-jobs/draft", "POST", value);
  }
  if (action === "update") {
    return jsonRequest(`/api/generation/jobs/${jobId}/draft`, "PATCH", value);
  }
  if (action === "confirm") {
    return jsonRequest(`/api/generation/jobs/${jobId}/confirm`, "POST", {});
  }
  if (action === "select") {
    return jsonRequest(`/api/generation/jobs/${jobId}/select-output`, "POST", {
      mediaId: value,
    });
  }
  if (action === "regenerate") {
    return jsonRequest(`/api/generation/jobs/${jobId}/regenerate`, "POST", {});
  }
  return null;
}

export async function generationConfirmDraft(jobId, form, requestFn) {
  const updateSpec = imageWorkflowRequest(
    "update",
    jobId,
    imageDraftUpdatePayload(form),
  );
  const updated = await requestFn(updateSpec.path, updateSpec.options);
  if (!updated.ok) return { stage: "update", result: updated };

  const confirmSpec = imageWorkflowRequest("confirm", jobId);
  const confirmed = await requestFn(confirmSpec.path, confirmSpec.options);
  return { stage: "confirm", result: confirmed };
}

// 워커 수동 실행 — jobId를 주면 해당 queued 잡, 없으면 다음 queued 잡.
// WORKER_ENABLED와 무관하게 동작한다 (자동 루프만 env로 제어).
export function workerRunRequest(jobId) {
  const id = String(jobId ?? "").trim();
  return {
    path: "/api/generation/worker/run",
    options: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(id ? { jobId: id } : {}),
    },
  };
}

// 프로바이더 설정 저장 페이로드.
// - API 키: 비워두면 필드 생략(기존 값 유지) — 삭제는 별도 버튼(null 전송).
// - 모델: 항상 전송, 빈 값은 null(삭제 → env 폴백 복귀).
export function generationSettingsPayload(form) {
  const payload = {};
  const apiKey = String(form.get("falApiKey") ?? "").trim();
  if (apiKey) {
    payload.falApiKey = apiKey;
  }
  const model = String(form.get("falImageModel") ?? "").trim();
  payload.falImageModel = model || null;
  const t2iModel = String(form.get("falImageT2iModel") ?? "").trim();
  payload.falImageT2iModel = t2iModel || null;
  const llmApiKey = String(form.get("llmApiKey") ?? "").trim();
  if (llmApiKey) {
    payload.llmApiKey = llmApiKey;
  }
  const llmApiUrl = String(form.get("llmApiUrl") ?? "").trim();
  payload.llmApiUrl = llmApiUrl || null;
  const llmModel = String(form.get("llmModel") ?? "").trim();
  payload.llmModel = llmModel || null;
  // 채팅 LLM 오버라이드 — 키는 채웠을 때만, 나머지는 빈값=재상속(null).
  const agentLlmApiKey = String(form.get("agentLlmApiKey") ?? "").trim();
  if (agentLlmApiKey) {
    payload.agentLlmApiKey = agentLlmApiKey;
  }
  if (form.has("agentLlmApiUrl")) {
    const value = String(form.get("agentLlmApiUrl") ?? "").trim();
    payload.agentLlmApiUrl = value || null;
  }
  if (form.has("agentLlmModel")) {
    const value = String(form.get("agentLlmModel") ?? "").trim();
    payload.agentLlmModel = value || null;
  }
  if (form.has("agentEmbeddingModel")) {
    const value = String(form.get("agentEmbeddingModel") ?? "").trim();
    payload.agentEmbeddingModel = value || null;
  }
  return payload;
}

// 연결 테스트 페이로드 — 채워진 입력만 담는다. 생략 필드는 서버가 현재
// 실효 설정(DB > env)으로 채워 검증한다.
export function settingsTestPayload(act, form) {
  if (act === "settings-test-image") {
    const falApiKey = String(form.get("falApiKey") ?? "").trim();
    return { target: "image", ...(falApiKey ? { falApiKey } : {}) };
  }
  // 채팅 테스트는 채팅 섹션의 입력을 공통 llm* 테스트 필드로 매핑한다 —
  // 서버가 chat 실효 설정(오버라이드+상속) 위에 덮어 검증한다.
  const chat = act === "settings-test-chat";
  const payload = { target: chat ? "chat" : "planner" };
  const fields = chat
    ? {
        llmApiKey: "agentLlmApiKey",
        llmApiUrl: "agentLlmApiUrl",
        llmModel: "agentLlmModel",
      }
    : { llmApiKey: "llmApiKey", llmApiUrl: "llmApiUrl", llmModel: "llmModel" };
  for (const [testField, formField] of Object.entries(fields)) {
    const value = String(form.get(formField) ?? "").trim();
    if (value) payload[testField] = value;
  }
  return payload;
}

export function generationClickRequest(clickAction, jobId) {
  if (clickAction === "job-run") {
    // 수동 실행은 워커 경로를 쓴다 — 레거시 /run은 프로바이더 호출 없이
    // 상태만 바꾸는 껍데기라 UI에서는 더 이상 쓰지 않는다.
    return workerRunRequest(jobId);
  }
  if (clickAction === "job-retry") {
    return generationActionRequest(jobId, "retry");
  }
  return null;
}

const simpleClickActions = {
  "settings-clear-key": {
    path: "/api/settings/generation",
    method: "PUT",
    body: { falApiKey: null },
    successMessage: "API 키를 삭제했습니다.",
  },
  "settings-clear-llm-key": {
    path: "/api/settings/generation",
    method: "PUT",
    body: { llmApiKey: null },
    successMessage: "LLM API 키를 삭제했습니다.",
  },
  "settings-clear-agent-key": {
    path: "/api/settings/generation",
    method: "PUT",
    body: { agentLlmApiKey: null },
    successMessage:
      "채팅 LLM 키를 삭제했습니다. 기획 LLM 키를 다시 사용합니다.",
  },
  "media-confirm-upload": {
    path: ({ id }) => `/api/media/${id}/confirm-upload`,
    successMessage: "업로드를 확정했습니다. 게시물에 연결할 수 있습니다.",
  },
  "draft-approve": {
    path: ({ id }) => `/api/drafts/${id}/approve`,
    successMessage: "초안을 승인했습니다. 예정 시각에 게시됩니다.",
  },
  "draft-reject": {
    path: ({ id }) => `/api/drafts/${id}/reject`,
    successMessage: "초안을 반려했습니다.",
  },
  "draft-plan-now": {
    path: ({ id }) => `/api/drafts/${id}/plan`,
    successMessage: "기획을 실행했습니다. 결과를 확인하세요.",
  },
  "draft-build-prompts": {
    path: ({ id }) => `/api/drafts/${id}/build-prompts`,
    successMessage:
      "프롬프트를 빌드했습니다. 각 컷에서 확인·수정 후 실행하세요.",
  },
  "draft-aggregate-now": {
    path: ({ id }) => `/api/drafts/${id}/aggregate`,
    successMessage: "생성 결과를 집계했습니다. 검수 단계를 확인하세요.",
  },
  "draft-publish-now": {
    path: ({ id }) => `/api/drafts/${id}/publish`,
    successMessage: "초안을 게시했습니다.",
  },
};

export function simpleClickAction(action, dataset) {
  const spec = simpleClickActions[action];
  if (!spec) return null;
  const path = typeof spec.path === "function" ? spec.path(dataset) : spec.path;
  return {
    request: jsonRequest(path, spec.method ?? "POST", spec.body ?? {}),
    successMessage: spec.successMessage,
  };
}

export function mediaUploadStartPayload(formData) {
  const payload = {
    mediaType: String(formData.get("mediaType") ?? "image"),
    contentType: String(formData.get("contentType") ?? "").trim(),
    fileName: String(formData.get("fileName") ?? "").trim(),
  };
  for (const key of ["byteSize", "width", "height"]) {
    const value = Number(formData.get(key));
    if (Number.isFinite(value) && value > 0) payload[key] = value;
  }
  return payload;
}

export function paymentDetailRequest(paymentId) {
  return `/api/payments/${paymentId}`;
}

export function adminRequestOptions(options = {}, token = "") {
  const value = String(token ?? "").trim();
  if (!value) {
    return options;
  }
  return {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      authorization: `Bearer ${value}`,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Payload builders (unit-tested contract)
// ─────────────────────────────────────────────────────────────────────────

export function adminLoginPayload(form) {
  return {
    email: String(form.get("email") ?? "").trim(),
    password: String(form.get("password") ?? "").trim(),
  };
}

export function adminAccountPayload(form) {
  return {
    email: String(form.get("email") ?? "").trim(),
    password: String(form.get("password") ?? "").trim(),
  };
}

export function characterCreatePayload(form) {
  return {
    publicId: String(form.get("publicId") ?? "").trim(),
    displayName: String(form.get("displayName") ?? "").trim(),
    bio: String(form.get("bio") ?? "").trim(),
    interests: splitCsv(form.get("interests")),
  };
}

export function characterUpdatePayload(form) {
  return {
    displayName: String(form.get("displayName") ?? "").trim(),
    bio: String(form.get("bio") ?? "").trim(),
    interests: splitCsv(form.get("interests")),
  };
}

export function characterStatusPayload(form) {
  return {
    status: String(form.get("status") ?? "").trim(),
    reason: String(form.get("reason") ?? "").trim(),
  };
}

export function memoryPayload(form) {
  return {
    content: String(form.get("content") ?? "").trim(),
    reason: String(form.get("reason") ?? "").trim(),
  };
}

export function personaPayload(form) {
  const payload = {
    title: String(form.get("title") ?? "").trim(),
    content: String(form.get("content") ?? "").trim(),
  };
  const sortOrder = String(form.get("sortOrder") ?? "").trim();
  if (sortOrder !== "") {
    payload.sortOrder = Number(sortOrder);
  }
  return payload;
}

export function personaBulkPayload(form) {
  return { items: parseBulkItems(form.get("items")) };
}

export function personaReorderPayload(form) {
  return { personaIds: parseBulkItems(form.get("personaIds")) };
}

export function memoryBulkPayload(form) {
  return { items: parseBulkItems(form.get("items")) };
}

export function reportUpdatePayload(form) {
  return {
    status: String(form.get("status") ?? "").trim(),
    resolution: String(form.get("resolution") ?? "").trim(),
  };
}

export function creditGrantPayload(form) {
  return {
    userId: fieldValue(form, "userId"),
    amount: Number(form.get("amount")),
    reason: fieldValue(form, "reason"),
  };
}

export function generationCreatePayload(form) {
  return {
    characterId: fieldValue(form, "characterId"),
    mediaType: fieldValue(form, "mediaType"),
    prompt: fieldValue(form, "prompt"),
  };
}

export function imageDraftPayload(form) {
  const aspectRatio = fieldValue(form, "aspectRatio");
  return {
    characterId: fieldValue(form, "characterId"),
    inputPrompt: fieldValue(form, "inputPrompt"),
    candidateCount: imageCandidateCount(form.get("candidateCount")),
    ...(aspectRatio ? { aspectRatio } : {}),
  };
}

export function imageDraftUpdatePayload(form) {
  return {
    prompt: fieldValue(form, "prompt"),
    candidateCount: imageCandidateCount(form.get("candidateCount")),
  };
}

function imageCandidateCount(value) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > 4) {
    throw new Error("candidateCount must be an integer between 1 and 4");
  }
  return count;
}

export function generationActionBody(action, form) {
  if (action === "run") {
    const provider = fieldValue(form, "provider");
    return provider === "local" ? { provider } : {};
  }
  if (action === "retry") {
    const reason = fieldValue(form, "reason");
    return reason ? { reason } : {};
  }
  if (action === "complete") {
    const mediaId = fieldValue(form, "mediaId");
    if (mediaId) return { mediaId };
    const url = fieldValue(form, "url");
    return url ? { url } : {};
  }
  return {};
}

export async function formActionRequest(action, form, dataset = {}) {
  const characterId =
    fieldValue(dataset, "characterId") || fieldValue(form, "characterId");
  if (action === "admin-login") {
    return jsonRequest("/api/admin/login", "POST", adminLoginPayload(form));
  }
  if (action === "admin-create") {
    return jsonRequest(
      "/api/admin/accounts",
      "POST",
      adminAccountPayload(form),
    );
  }
  if (action === "character-create") {
    return jsonRequest("/api/characters", "POST", characterCreatePayload(form));
  }
  if (action === "character-update") {
    return jsonRequest(
      `/api/characters/${characterId}`,
      "PATCH",
      characterUpdatePayload(form),
    );
  }
  if (action === "character-status") {
    return jsonRequest(
      `/api/characters/${characterId}/status`,
      "PATCH",
      characterStatusPayload(form),
    );
  }
  if (action === "character-delete") {
    return jsonRequest(`/api/characters/${characterId}`, "DELETE", {
      reason: requiredField(form, "reason"),
    });
  }
  if (action === "persona-create") {
    return jsonRequest(
      `/api/characters/${characterId}/personas`,
      "POST",
      personaPayload(form),
    );
  }
  if (action === "persona-update") {
    return jsonRequest(
      `/api/characters/${characterId}/personas/${fieldValue(
        dataset,
        "personaId",
      )}`,
      "PATCH",
      personaPayload(form),
    );
  }
  if (action === "persona-reorder") {
    return jsonRequest(
      `/api/characters/${characterId}/personas/order`,
      "PUT",
      personaReorderPayload(form),
    );
  }
  if (action === "persona-delete") {
    return jsonRequest(
      `/api/characters/${characterId}/personas/${fieldValue(
        dataset,
        "personaId",
      )}`,
      "DELETE",
      {},
    );
  }
  if (action === "persona-bulk-create") {
    return jsonRequest(
      `/api/characters/${characterId}/personas/bulk`,
      "POST",
      personaBulkPayload(form),
    );
  }
  if (action === "memory-create") {
    return jsonRequest(
      `/api/characters/${characterId}/memory`,
      "POST",
      memoryPayload(form),
    );
  }
  if (action === "memory-bulk-create") {
    return jsonRequest(
      `/api/characters/${characterId}/memory/bulk`,
      "POST",
      memoryBulkPayload(form),
    );
  }
  if (action === "memory-update") {
    return jsonRequest(
      `/api/characters/${characterId}/memory/${fieldValue(
        dataset,
        "memoryId",
      )}`,
      "PATCH",
      memoryPayload(form),
    );
  }
  if (action === "memory-delete") {
    return jsonRequest(
      `/api/characters/${characterId}/memory/${fieldValue(
        dataset,
        "memoryId",
      )}`,
      "DELETE",
      {},
    );
  }
  if (action === "credit-grant") {
    return jsonRequest("/api/credits/grants", "POST", creditGrantPayload(form));
  }
  if (action === "story-create") {
    return jsonRequest("/api/stories", "POST", await storyPayload(form));
  }
  if (action === "generation-create") {
    return jsonRequest(
      "/api/generation/jobs",
      "POST",
      generationCreatePayload(form),
    );
  }
  if (action === "generation-action") {
    const jobId = fieldValue(form, "jobId");
    const jobAction = fieldValue(form, "action");
    return generationActionRequest(
      jobId,
      jobAction,
      generationActionBody(jobAction, form),
    );
  }
  if (action === "report-update") {
    return jsonRequest(
      `/api/moderation/reports/${fieldValue(form, "reportId")}`,
      "PATCH",
      reportUpdatePayload(form),
    );
  }
  throw new Error(`Unsupported form action: ${action}`);
}

const CHARACTER_RESOURCE_FORM_MESSAGES = {
  "persona-create": "페르소나를 추가했습니다.",
  "persona-update": "페르소나를 저장했습니다.",
  "memory-create": "메모리를 추가했습니다.",
  "memory-update": "메모리를 저장했습니다.",
};

export async function characterResourceFormRequest(action, form, dataset = {}) {
  const successMessage = CHARACTER_RESOURCE_FORM_MESSAGES[action];
  if (!successMessage) return null;
  return {
    request: await formActionRequest(action, form, dataset),
    successMessage,
  };
}

const CHARACTER_DELETE_META = {
  "persona-delete": {
    label: "페르소나",
    successMessage: "페르소나를 삭제했습니다.",
  },
  "memory-delete": {
    label: "메모리",
    successMessage: "메모리를 삭제했습니다.",
  },
};

export async function characterDeleteRequest(action, dataset, confirmDelete) {
  const meta = CHARACTER_DELETE_META[action];
  if (!meta) return null;
  if (!confirmDelete(`${meta.label}를 삭제하시겠습니까?`)) return null;
  return {
    request: await formActionRequest(action, new FormData(), dataset),
    successMessage: meta.successMessage,
  };
}

export async function generationFormActionRequest(action, form) {
  if (action !== "generation-action") return null;
  return formActionRequest(action, form);
}

export function parseResponseBody(text, response = { status: 0 }) {
  if (!text) {
    return { status: response.status };
  }
  try {
    return JSON.parse(text);
  } catch {
    return {
      error: text,
      status: response.status,
    };
  }
}

export function mediaTypeForFile(file) {
  const contentType = String(file?.type ?? "").toLowerCase();
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  throw new Error(
    `${String(file?.name ?? "file")} must be an image or video file`,
  );
}

export function appendPostMediaFiles(current, incoming) {
  const added = Array.from(incoming ?? []);
  added.forEach(mediaTypeForFile);
  return [...current, ...added];
}

export function removePostMediaFile(current, index) {
  return current.filter((_, currentIndex) => currentIndex !== Number(index));
}

export function dialogSessionAllows(session, action) {
  if (!session) return false;
  return (
    session.type !== "new-post" ||
    !session.submissionLocked ||
    action === "submit-success"
  );
}

export async function postPayload(
  form,
  requestFn = request,
  putObject = fetch,
  files = [],
) {
  const actorId = requiredField(form, "actorId");
  const contentType = fieldValue(form, "contentType") || "feed";
  const content = requiredField(form, "content");
  const reason = requiredField(form, "reason");
  const hashtags = splitCsv(form.get("hashtags"));
  const selected = Array.from(files);
  if (selected.length === 0) {
    throw new Error("At least one image or video file is required");
  }

  const media = [];
  for (const file of selected) {
    try {
      media.push({
        mediaId: await uploadMedia(
          file,
          mediaTypeForFile(file),
          requestFn,
          putObject,
          contentStoragePrefix(contentType, actorId),
        ),
      });
    } catch (error) {
      throw new Error(
        `${file.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    actorType: "character",
    actorId,
    contentType,
    content,
    reason,
    hashtags,
    media,
  };
}

export async function submitNewPost(
  form,
  files,
  requestFn = request,
  putObject = fetch,
  submitFn = submitViaSpec,
) {
  const body = await postPayload(form, requestFn, putObject, files);
  return submitFn(
    jsonRequest("/api/posts", "POST", body),
    "게시물을 생성했습니다.",
  );
}

export async function storyPayload(
  form,
  requestFn = request,
  putObject = fetch,
) {
  const characterId = requiredField(form, "characterId");
  const mediaType = requiredField(form, "mediaType");
  const file = selectedFile(form);

  return {
    characterId,
    caption: fieldValue(form, "caption"),
    reason: requiredField(form, "reason"),
    media: file
      ? {
          mediaId: await uploadMedia(
            file,
            mediaType,
            requestFn,
            putObject,
            contentStoragePrefix("story", characterId),
          ),
        }
      : { mediaType, url: requiredMediaUrl(form) },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Low-level form/value helpers (shared by the builders above)
// ─────────────────────────────────────────────────────────────────────────

function parseBulkItems(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    throw new Error("items is required");
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("items must be valid JSON");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("items must be a non-empty JSON array");
  }
  return parsed;
}

function splitCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function fieldValue(form, name) {
  return String(form.get?.(name) ?? form[name] ?? "").trim();
}

function requiredField(form, name) {
  const value = fieldValue(form, name);
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function jsonRequest(path, method, body) {
  return {
    path,
    options: {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  };
}

function selectedFile(form) {
  const file = form.get("mediaFile");
  return typeof File !== "undefined" && file instanceof File && file.name
    ? file
    : undefined;
}

async function uploadMedia(
  file,
  mediaType,
  requestFn,
  putObject,
  storagePrefix = "",
) {
  const contentType = file.type || `${mediaType}/octet-stream`;
  const upload = await requestFn("/api/media/uploads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mediaType,
      contentType,
      fileName: file.name,
      ...(file.size > 0 ? { byteSize: file.size } : {}),
      ...(storagePrefix ? { storagePrefix } : {}),
    }),
  });

  if (!upload.ok) {
    throw new Error(errorMessage(upload.body, "S3 upload URL request failed"));
  }

  const uploaded = await putObject(upload.body.uploadUrl, {
    method: upload.body.method,
    headers: upload.body.headers,
    body: file,
  });
  if (!uploaded.ok) {
    throw new Error(
      errorMessage(uploaded.body, uploaded.statusText || "S3 upload failed"),
    );
  }

  const mediaId = upload.body.media.id;
  const confirmed = await requestFn(`/api/media/${mediaId}/confirm-upload`, {
    method: "POST",
  });
  if (!confirmed.ok) {
    throw new Error(
      errorMessage(confirmed.body, "Media upload confirm failed"),
    );
  }

  return mediaId;
}

function requiredMediaUrl(form) {
  const url = String(form.get("mediaUrl") ?? "").trim();
  if (!url) {
    throw new Error("Media URL or file is required");
  }
  return url;
}

function contentStoragePrefix(contentType, characterId) {
  if (contentType === "feed") {
    return `pod/feed/character/${characterId}`;
  }
  if (contentType === "reel") {
    return `pod/reels/character/${characterId}`;
  }
  if (contentType === "story") {
    return `pod/stories/character/${characterId}`;
  }
  throw new Error("contentType must be feed or reel");
}

function errorMessage(body, fallback) {
  if (typeof body?.message === "string") {
    return body.message;
  }
  if (Array.isArray(body?.message)) {
    return body.message.join(", ");
  }
  return typeof body?.error === "string" ? body.error : fallback;
}

// ═════════════════════════════════════════════════════════════════════════
// Rendering layer
// ═════════════════════════════════════════════════════════════════════════

const ui = {
  filters: {
    charStatus: "전체",
    jobStatus: "전체",
    draftStatus: "needs_review",
    payStatus: "전체",
    reportStatus: "전체",
    analyticsPeriod: "7일",
    mediaType: "전체",
    mediaUp: "전체",
  },
  selUserId: null,
  selPostId: null,
  selMediaId: null,
  selPayId: null,
  selDraftId: null,
  ledgerUserId: "",
  eventUserId: "",
  cache: {
    charNames: new Map(),
    userLabels: new Map(),
  },
  badges: { drafts: 0, moderation: 0, payments: 0 },
  toastTimer: 0,
  generationCreating: false,
  generationPollTimer: 0,
  draftPollTimer: 0,
  generationSelectedJobId: "",
  generationSelectedMediaId: "",
  filterCompareControl: null,
};

// — request / auth —

const LOG_PREFIX = "[opod-admin]";

async function request(path, options) {
  const method = options?.method ?? "GET";
  const startedAt = Date.now();
  try {
    const response = await fetch(
      path,
      adminRequestOptions(options, readAdminToken()),
    );
    const text = await response.text();
    const result = {
      ok: response.ok,
      status: response.status,
      body: parseResponseBody(text, response),
    };
    const elapsed = Date.now() - startedAt;
    if (result.ok) {
      console.info(
        `${LOG_PREFIX} ${method} ${path} → ${result.status} (${elapsed}ms)`,
      );
      // Full response bodies stay at debug so the console isn't flooded
      // unless verbose logging is enabled in devtools.
      console.debug(`${LOG_PREFIX} response`, path, result.body);
    } else {
      console.error(
        `${LOG_PREFIX} ${method} ${path} → ${result.status} (${elapsed}ms)`,
        result.body,
      );
    }
    if (response.status === 401 && currentRoute() !== "login") {
      clearAdminAuth();
      renderApp();
    }
    return result;
  } catch (error) {
    console.error(
      `${LOG_PREFIX} ${method} ${path} → network error (${
        Date.now() - startedAt
      }ms)`,
      error,
    );
    return { ok: false, status: 0, body: { error: error.message } };
  }
}

function readAdminToken() {
  return hasDocument
    ? (window.sessionStorage.getItem(adminTokenStorageKey) ?? "")
    : "";
}

function readAdminEmail() {
  return hasDocument
    ? (window.sessionStorage.getItem(adminEmailStorageKey) ?? "")
    : "";
}

function writeAdminAuth(body) {
  const token = String(body?.token ?? "").trim();
  if (token) {
    window.sessionStorage.setItem(adminTokenStorageKey, token);
    window.sessionStorage.setItem(
      adminEmailStorageKey,
      String(body?.admin?.email ?? ""),
    );
  } else {
    clearAdminAuth();
  }
}

function clearAdminAuth() {
  window.sessionStorage.removeItem(adminTokenStorageKey);
  window.sessionStorage.removeItem(adminEmailStorageKey);
}

function currentUrl() {
  return `${location.pathname}${location.search}${location.hash}`;
}

function currentRoute() {
  return currentRouteFromUrl(currentUrl(), readAdminToken());
}

function navigateTo(path, { replace = false } = {}) {
  const current = `${location.pathname}${location.search}`;
  if (current !== path || location.hash) {
    history[replace ? "replaceState" : "pushState"]({}, "", path);
  }
  closeLightbox();
  if (dialogState) closeDialog();
  renderApp();
}

// — formatting / classification helpers —

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function attr(value) {
  return escapeHtml(value);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(
    d.getHours(),
  )}:${pad2(d.getMinutes())}`;
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function initialOf(text) {
  const t = String(text ?? "").trim();
  return t ? t[0].toUpperCase() : "·";
}

function statusTag(status) {
  return status === "active"
    ? '<span class="tag tag-accent">활성</span>'
    : '<span class="tag tag-neutral">비활성</span>';
}

function providerStatusClass(s) {
  if (s === "paid") return "tag-accent";
  if (s === "pending") return "tag-neutral";
  return "tag-accent-2"; // failed / canceled / refunded
}

function ledgerStatusClass(s) {
  if (s === "granted") return "tag-accent";
  if (s === "missing_grant") return "tag-accent-2";
  return "tag-neutral";
}

function reportStatusMeta(s) {
  const map = {
    submitted: ["tag-accent-2", "접수됨"],
    reviewing: ["tag-neutral", "검토 중"],
    resolved: ["tag-accent", "처리 완료"],
    rejected: ["tag-neutral", "기각"],
  };
  return map[s] ?? ["tag-neutral", s];
}

function logTagClass(t) {
  const type = String(t ?? "");
  if (type.startsWith("POST") || type.startsWith("COMMENT"))
    return "tag-accent";
  if (type.includes("STATUS") || type.includes("DELETE")) return "tag-accent-2";
  return "tag-neutral";
}

function analyticsLabel(name) {
  const map = {
    "events.count": "이벤트",
    "messages.count": "메시지",
    "credits.granted": "지급 크레딧",
    "credits.debited": "사용 크레딧",
    "generation_jobs.count": "생성 작업",
  };
  return map[name] ?? name;
}

function charName(id) {
  return ui.cache.charNames.get(id) ?? (id ? `${id.slice(0, 8)}…` : "—");
}

function userLabel(id) {
  return ui.cache.userLabels.get(id) ?? (id ? `${id.slice(0, 8)}…` : "—");
}

function mediaLabel(media) {
  const arr = Array.isArray(media) ? media : [];
  if (!arr.length) return "없음";
  const type = arr[0].mediaType || "media";
  return arr.length > 1 ? `${type} ×${arr.length}` : type;
}

function hashtagsText(tags) {
  const arr = Array.isArray(tags) ? tags : [];
  return arr.length ? arr.map((t) => `#${t}`).join(" ") : "—";
}

function httpMediaUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : "";
  } catch {
    return "";
  }
}

export function postMediaGallery(media) {
  const items = Array.isArray(media) ? media : [];
  if (items.length === 0) return "";
  return `<div class="post-media-gallery">${items
    .map((item) => {
      const source = httpMediaUrl(item.url);
      const preview = source
        ? item.mediaType === "video"
          ? `<video src="${attr(source)}" controls preload="metadata"></video>`
          : `<img src="${attr(source)}" alt="">`
        : `<div class="post-media-unavailable">미리보기 없음</div>`;
      return `<figure class="post-media-item">${preview}<figcaption><span class="tag tag-neutral">${escapeHtml(
        item.mediaType,
      )}</span><span class="post-media-url">${escapeHtml(
        item.url,
      )}</span></figcaption></figure>`;
    })
    .join("")}</div>`;
}

function postTypeMeta(ct) {
  if (ct === "reel") return ["tag-neutral", "reel"];
  if (ct === "story") return ["tag-accent-2", "story"];
  return ["tag-accent", "feed"];
}

function jobStatusMeta(s) {
  const map = {
    queued: ["tag-neutral", "queued"],
    running: ["tag-accent", "running"],
    completed: ["tag-accent", "completed"],
    failed: ["tag-accent-2", "failed"],
  };
  return map[s] ?? ["tag-neutral", s];
}

function draftStatusMeta(s) {
  const map = {
    planned: ["tag-neutral", "기획 대기"],
    generating: ["tag-accent", "생성 중"],
    needs_review: ["tag-accent-2", "검수 필요"],
    regenerating: ["tag-accent", "재생성 중"],
    approved: ["tag-accent", "승인됨"],
    rejected: ["tag-neutral", "반려"],
    published: ["tag-accent", "게시됨"],
    failed: ["tag-accent-2", "실패"],
  };
  return map[s] ?? ["tag-neutral", s];
}

// — small view partials —

function segControl(scope, options, current) {
  return `<span class="seg">${options
    .map((opt) => {
      const active = opt.value === current ? " active" : "";
      return `<button type="button" class="seg-opt${active}" data-act="set-seg" data-scope="${attr(
        scope,
      )}" data-val="${attr(opt.value)}">${escapeHtml(opt.label)}</button>`;
    })
    .join("")}</span>`;
}

function sectionHead(title, sub, actionHtml = "") {
  return `<div class="section-head"><div><h2>${escapeHtml(
    title,
  )}</h2><p class="section-sub">${escapeHtml(sub)}</p></div>${actionHtml}</div>`;
}

function noticeBlock(html) {
  return `<div class="notice">${html}</div>`;
}

function spinner() {
  return `<div class="spin">불러오는 중…</div>`;
}

// — user/character option loading (for selects) —

async function loadUserOptions() {
  const res = await request(endpoint("/api/users", { limit: 50 }));
  const users = itemsFromPage(res.body);
  for (const u of users) {
    ui.cache.userLabels.set(u.id, u.email || u.displayName || u.id);
  }
  return users;
}

async function loadCharacterOptions() {
  const res = await request(endpoint("/api/characters", { limit: 50 }));
  const chars = itemsFromPage(res.body);
  for (const c of chars) {
    ui.cache.charNames.set(c.id, c.displayName || c.publicId || c.id);
  }
  return chars;
}

function optionList(items, valueKey, labelFn, selected) {
  return items
    .map((it) => {
      const v = it[valueKey];
      const sel = v === selected ? " selected" : "";
      return `<option value="${attr(v)}"${sel}>${escapeHtml(labelFn(it))}</option>`;
    })
    .join("");
}

// ═════════════════════════════════════════════════════════════════════════
// Section renderers
// ═════════════════════════════════════════════════════════════════════════

async function renderSection(route, renderEpoch) {
  if (route === "home") return renderHome();
  if (route === "characters") return renderCharacters();
  if (route === "posts") return renderPosts();
  if (route === "media") return renderMedia();
  if (route === "drafts") return renderDrafts();
  if (route === "generation") return renderGeneration(renderEpoch);
  if (route === "users") return renderUsers();
  if (route === "credits") return renderCredits();
  if (route === "payments") return renderPayments();
  if (route === "moderation") return renderModeration();
  if (route === "events") return renderEvents();
  if (route === "logs") return renderLogs();
  if (route === "analytics") return renderAnalytics();
  if (route === "settings") return renderSettings();
  return renderHome();
}

// ── 대시보드 ──────────────────────────────────────────────────────────────

// 처리 대기 카드 — navBadgeRequests()의 key와 1:1로 대응한다.
const HOME_TODOS = [
  { key: "drafts", label: "검수 필요 초안", desc: "컷 확인 후 승인 또는 반려" },
  { key: "moderation", label: "미처리 신고", desc: "검토 후 조치 또는 기각" },
  {
    key: "payments",
    label: "정산 불일치",
    desc: "provider ↔ 원장 상태 불일치",
  },
  { key: "generation", label: "실패한 생성 작업", desc: "재시도 필요" },
  { key: "media", label: "미확정 업로드", desc: "업로드 확정 대기" },
];

// 목록 API에는 총계가 없어 첫 페이지 기준으로 센다 — 다음 페이지가 있으면 "N+".
function pageCountLabel(body) {
  const count = itemsFromPage(body).length;
  return body?.nextCursor ? `${count}+` : String(count);
}

async function renderHome() {
  const badgeSpecs = navBadgeRequests();
  const [
    charsRes,
    postsRes,
    usersRes,
    queuedRes,
    runningRes,
    logsRes,
    ...badgeRes
  ] = await Promise.all([
    request(endpoint("/api/characters", { limit: 50 })),
    request(endpoint("/api/posts", { limit: 50 })),
    request(endpoint("/api/users", { limit: 50 })),
    request(endpoint("/api/generation/jobs", { status: "queued", limit: 50 })),
    request(endpoint("/api/generation/jobs", { status: "running", limit: 50 })),
    request("/api/character-action-logs"),
    ...badgeSpecs.map((spec) => request(spec.path)),
  ]);

  const chars = itemsFromPage(charsRes.body);
  for (const c of chars) {
    ui.cache.charNames.set(c.id, c.displayName || c.publicId || c.id);
  }
  const counts = {};
  badgeSpecs.forEach((spec, index) => {
    const count = itemsFromPage(badgeRes[index].body).length;
    counts[spec.key] = count;
    ui.badges[spec.key] = count;
    applyBadge(spec.key, count);
  });

  const todos = HOME_TODOS.filter((t) => counts[t.key] > 0);
  const todoHtml = todos.length
    ? `<div class="todo-cards">${todos
        .map(
          (
            t,
          ) => `<button type="button" class="todo-card" data-act="go-route" data-route="${attr(
            t.key,
          )}">
            <span class="todo-count">${counts[t.key]}</span>
            <span class="todo-copy">
              <span class="todo-label">${escapeHtml(t.label)} <span class="arrow">→</span></span>
              <span class="todo-desc">${escapeHtml(t.desc)}</span>
            </span>
          </button>`,
        )
        .join("")}</div>`
    : `<p style="margin:0 0 44px;font-size:14px;color:var(--color-neutral-700)">처리 대기 항목이 없습니다. 모든 큐가 비어 있습니다.</p>`;

  const activeChars = chars.filter((c) => c.status === "active").length;
  const inProgress =
    itemsFromPage(queuedRes.body).length +
    itemsFromPage(runningRes.body).length;
  const stats = [
    {
      label: "활성 캐릭터",
      value: String(activeChars),
      note: `전체 ${pageCountLabel(charsRes.body)}명`,
    },
    {
      label: "게시물",
      value: pageCountLabel(postsRes.body),
      note: "캐릭터 명의",
    },
    {
      label: "사용자",
      value: pageCountLabel(usersRes.body),
      note: "사람 계정",
    },
    {
      label: "진행 중 작업",
      value: String(inProgress),
      note: "queued + running",
    },
  ];
  const statsHtml = stats
    .map(
      (m) => `<div>
        <div class="stat-label" style="margin-bottom:8px">${escapeHtml(m.label)}</div>
        <span class="stat-value">${escapeHtml(m.value)}</span>
        <div style="font-size:12px;color:var(--color-neutral-700);margin-top:4px">${escapeHtml(
          m.note,
        )}</div>
      </div>`,
    )
    .join("");

  const logs = itemsFromPage(logsRes.body).slice(0, 6);
  const logRows = logs.length
    ? logs
        .map(
          (
            l,
          ) => `<div style="padding:9px 0;border-bottom:1px solid var(--color-divider);display:flex;align-items:baseline;gap:10px">
            <span class="tag ${logTagClass(l.actionType)}" style="flex:none">${escapeHtml(
              l.actionType,
            )}</span>
            <span style="font-weight:600;flex:none">${escapeHtml(
              charName(l.characterId),
            )}</span>
            <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(
              l.reason ?? "",
            )}</span>
            <span style="color:var(--color-neutral-500);font-size:11px;flex:none;margin-left:auto">${fmtDateTime(
              l.createdAt,
            )}</span>
          </div>`,
        )
        .join("")
    : `<div style="padding:9px 0;color:var(--color-neutral-600)">기록된 액션이 없습니다.</div>`;

  const todayLabel = new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "full",
  }).format(new Date());

  return `
    <div style="margin-bottom:30px">
      <h2 style="font-size:32px;margin:0 0 4px">오늘의 운영 데스크</h2>
      <p style="margin:0;font-size:13.5px;color:var(--color-neutral-700)">${escapeHtml(
        todayLabel,
      )} — 처리 대기 항목을 먼저 확인하세요</p>
    </div>
    ${todoHtml}
    <div class="home-stats">${statsHtml}</div>
    <div style="max-width:640px">
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:2px">
        <span class="kicker">최근 액션 로그</span>
        <button type="button" class="btn btn-ghost" style="color:var(--color-accent)" data-act="go-route" data-route="logs">전체 보기 →</button>
      </div>
      <div style="font-size:13px;line-height:1.5">${logRows}</div>
    </div>`;
}

// ── 미디어 ────────────────────────────────────────────────────────────────

function mediaFileName(media) {
  try {
    const path = new URL(media.url, "http://media.local").pathname;
    const name = decodeURIComponent(path.split("/").pop() ?? "");
    return name || media.id;
  } catch {
    return media.id;
  }
}

function mediaSizeLabel(media) {
  return media.byteSize ? `${(media.byteSize / 1048576).toFixed(1)} MB` : "—";
}

function mediaDimsLabel(media) {
  const dims =
    media.width && media.height ? `${media.width}×${media.height}` : "";
  const duration = media.durationSeconds ? `${media.durationSeconds}s` : "";
  return [dims, duration].filter(Boolean).join(" · ") || "—";
}

async function renderMedia() {
  if (ui.selMediaId) return renderMediaDetail(ui.selMediaId);

  const typeFilter = ui.filters.mediaType;
  const upFilter = ui.filters.mediaUp;
  const res = await request(
    endpoint("/api/media", {
      mediaType: typeFilter === "전체" ? "" : typeFilter,
      uploaded:
        upFilter === "전체" ? "" : upFilter === "확정" ? "true" : "false",
      limit: 50,
    }),
  );
  const media = itemsFromPage(res.body);

  const rows = media.length
    ? media
        .map((m) => {
          const pending = !m.uploadedAt;
          return `<tr class="clickable" data-act="select-media" data-id="${attr(m.id)}">
            <td style="font-weight:600">${escapeHtml(mediaFileName(m))}</td>
            <td>${escapeHtml(m.mediaType)}</td>
            <td>${escapeHtml(mediaSizeLabel(m))}</td>
            <td style="color:var(--color-neutral-700)">${escapeHtml(mediaDimsLabel(m))}</td>
            <td style="white-space:nowrap;color:var(--color-neutral-600);font-size:12.5px">${fmtDateTime(
              m.createdAt,
            )}</td>
            <td><span class="tag ${pending ? "tag-accent-2" : "tag-accent"}">${
              pending ? "pending" : `확정 ${fmtDateTime(m.uploadedAt)}`
            }</span></td>
            <td style="white-space:nowrap">${
              pending
                ? `<button class="btn btn-ghost" data-act="media-confirm-upload" data-id="${attr(
                    m.id,
                  )}">업로드 확정</button>`
                : ""
            }</td>
          </tr>`;
        })
        .join("")
    : `<tr class="empty-row"><td colspan="7">조건에 맞는 미디어가 없습니다.</td></tr>`;

  return `
    ${sectionHead(
      "미디어",
      "S3 presigned 업로드 시작 → 업로드 확정 → 게시물·생성 결과에 연결",
      `<button class="btn btn-primary" data-act="open-dialog" data-dialog="media-upload">업로드 시작</button>`,
    )}
    <div class="toolbar">
      ${segControl(
        "mediaType",
        [
          { value: "전체", label: "전체" },
          { value: "image", label: "image" },
          { value: "video", label: "video" },
        ],
        typeFilter,
      )}
      ${segControl(
        "mediaUp",
        [
          { value: "전체", label: "전체" },
          { value: "확정", label: "확정" },
          { value: "pending", label: "pending" },
        ],
        upFilter,
      )}
      <span class="count-note">${media.length}건</span>
    </div>
    <table class="table">
      <thead><tr><th>파일</th><th>타입</th><th>크기</th><th>해상도</th><th>생성</th><th>업로드 상태</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

async function renderMediaDetail(id) {
  const res = await request(`/api/media/${id}`);
  if (!res.ok) {
    ui.selMediaId = null;
    return noticeBlock("미디어를 찾을 수 없습니다.");
  }
  const m = res.body;
  const pending = !m.uploadedAt;

  return `
    <button class="btn btn-ghost" style="margin:0 0 18px -5px" data-act="back-media-list">← 미디어 목록</button>
    <div style="max-width:640px">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:8px">
        <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;min-width:0">
          <h2 style="font-size:28px;margin:0;word-break:break-all">${escapeHtml(
            mediaFileName(m),
          )}</h2>
          <span class="tag ${pending ? "tag-accent-2" : "tag-accent"}">${
            pending ? "pending" : "확정"
          }</span>
        </div>
        ${
          pending
            ? `<button class="btn btn-primary" style="flex:none" data-act="media-confirm-upload" data-id="${attr(
                m.id,
              )}">업로드 확정</button>`
            : ""
        }
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px 32px;font-size:13.5px;margin-top:24px">
        <div><div class="stat-label">타입</div>${escapeHtml(m.mediaType)}</div>
        <div><div class="stat-label">크기</div>${escapeHtml(mediaSizeLabel(m))}</div>
        <div><div class="stat-label">해상도</div>${escapeHtml(mediaDimsLabel(m))}</div>
        <div><div class="stat-label">업로드 시작</div>${fmtDateTime(m.createdAt)}</div>
        <div style="grid-column:1/-1"><div class="stat-label">업로드 확정</div>${
          pending ? "미확정 — pending" : `${fmtDateTime(m.uploadedAt)} 확정됨`
        }</div>
        <div style="grid-column:1/-1;min-width:0"><div class="stat-label">URL</div><span style="word-break:break-all;color:var(--color-neutral-700)">${escapeHtml(
          m.url ?? "—",
        )}</span></div>
      </div>
      ${
        pending
          ? `<p style="margin:26px 0 0;font-size:13px;line-height:1.55;color:var(--color-accent-2-700)">presigned PUT URL 발급 후 아직 확정되지 않은 pending 상태입니다. 클라이언트 업로드 완료를 확인한 뒤 '업로드 확정'을 누르면 게시물에 연결할 수 있게 됩니다.</p>`
          : ""
      }
    </div>`;
}

// ── 캐릭터 ────────────────────────────────────────────────────────────────

async function renderCharacters() {
  const state = characterRouteState(currentUrl());
  if (state.mode === "detail" && state.characterId) {
    return renderCharacterDetail(state.characterId, state.tab);
  }
  return renderCharacterList();
}

async function renderCharacterList() {
  const filter = ui.filters.charStatus;
  const res = await request(endpoint("/api/characters", { limit: 50 }));
  const allChars = itemsFromPage(res.body);
  const chars = allChars.filter((character) => {
    if (filter === "활성") return character.status === "active";
    if (filter === "비활성") return character.status === "inactive";
    return true;
  });
  for (const c of allChars) {
    ui.cache.charNames.set(c.id, c.displayName || c.publicId || c.id);
  }

  const rows = chars.length
    ? chars
        .map((c) => {
          const haystack =
            `${c.publicId ?? ""} ${c.displayName ?? ""}`.toLowerCase();
          return `<tr class="clickable char-row" data-search="${attr(
            haystack,
          )}" data-act="go-char" data-id="${attr(c.id)}">
            <td style="font-weight:600">${escapeHtml(c.publicId)}</td>
            <td>${escapeHtml(c.displayName)}</td>
            <td style="color:var(--color-neutral-700);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(
              c.bio,
            )}</td>
            <td style="color:var(--color-neutral-700);font-style:italic">${escapeHtml(
              (c.interests ?? []).join(", "),
            )}</td>
            <td style="text-align:right;font-variant-numeric:tabular-nums">${c.postCount ?? 0}</td>
            <td style="text-align:right;font-variant-numeric:tabular-nums">${c.followerCount ?? 0}</td>
            <td>${statusTag(c.status)}</td>
          </tr>`;
        })
        .join("")
    : `<tr class="empty-row"><td colspan="7">조건에 맞는 캐릭터가 없습니다.</td></tr>`;

  return `
    ${sectionHead(
      "캐릭터",
      `활성 ${allChars.filter((character) => character.status === "active").length} · 비활성 ${allChars.filter((character) => character.status === "inactive").length} — AI 캐릭터의 생성, 프로필 수정, 상태 전환, 기억 관리`,
      `<button class="btn btn-primary" data-act="open-dialog" data-dialog="new-char">새 캐릭터</button>`,
    )}
    <div class="toolbar">
      ${segControl(
        "charStatus",
        [
          { value: "전체", label: "전체" },
          { value: "활성", label: "활성" },
          { value: "비활성", label: "비활성" },
        ],
        filter,
      )}
      <input class="input" style="max-width:260px" placeholder="publicId, 이름 검색" data-filter-input=".char-row" />
      <span class="count-note">${chars.length}건</span>
    </div>
    <table class="table">
      <thead><tr><th>공개 ID</th><th>표시 이름</th><th>Bio</th><th>관심사</th><th style="text-align:right">게시물</th><th style="text-align:right">팔로워</th><th>상태</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

async function renderCharacterDetail(id, tab) {
  const [detailRes, logsRes, jobsRes] = await Promise.all([
    request(`/api/characters/${id}`),
    request("/api/character-action-logs"),
    request(endpoint("/api/generation/jobs", { characterId: id, limit: 50 })),
  ]);
  const c = detailRes.body;
  if (!detailRes.ok || !c?.id) {
    return `<button class="btn btn-ghost" style="margin:0 0 18px -5px" data-act="go-char-list">← 캐릭터 목록</button>
      ${noticeBlock("캐릭터를 찾을 수 없습니다.")}`;
  }
  ui.cache.charNames.set(c.id, c.displayName || c.publicId || c.id);
  const personas = Array.isArray(c.personas) ? c.personas : [];
  const memories = Array.isArray(c.memories) ? c.memories : [];
  const logs = itemsFromPage(logsRes.body).filter((l) => l.characterId === id);
  const jobs = itemsFromPage(jobsRes.body);
  const stats = [
    ["게시물", c.postCount ?? 0],
    ["팔로워", c.followerCount ?? 0],
    ["기억", memories.length],
    ["생성 작업", jobs.length],
  ];

  const header = `
    <button class="btn btn-ghost" style="margin:0 0 18px -5px" data-act="go-char-list">← 캐릭터 목록</button>
    <div style="display:flex;align-items:flex-start;gap:22px;margin-bottom:26px">
      <span class="avatar" style="width:68px;height:68px;font-size:30px">${initialOf(
        c.displayName,
      )}</span>
      <div style="min-width:0;flex:1">
        <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap">
          <h2 style="font-size:36px;margin:0;line-height:1.05">${escapeHtml(
            c.displayName,
          )}</h2>
          <span style="font-size:14px;color:var(--color-neutral-600)">@${escapeHtml(
            c.publicId,
          )}</span>
          ${statusTag(c.status)}
        </div>
        <p style="margin:8px 0 12px;font-size:15.5px;font-style:italic;color:var(--color-neutral-700);line-height:1.4">${escapeHtml(
          c.bio,
        )}</p>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${(c.interests ?? [])
            .map(
              (t) => `<span class="tag tag-outline">#${escapeHtml(t)}</span>`,
            )
            .join("")}
        </div>
      </div>
      <button class="btn btn-secondary" style="flex:none" data-act="toggle-char-status" data-id="${attr(
        c.id,
      )}" data-current="${attr(c.status)}">${
        c.status === "active" ? "비활성화" : "활성화"
      }</button>
    </div>
    <div style="display:flex;gap:56px;margin:0 0 36px;padding-left:90px">
      ${stats
        .map(
          ([label, value]) =>
            `<div><div class="stat-label">${escapeHtml(
              label,
            )}</div><span class="stat-value">${value}</span></div>`,
        )
        .join("")}
    </div>
    <div class="tabs-row">
      ${[
        ["profile", "프로필"],
        ["personas", "페르소나"],
        ["memory", "메모리"],
        ["posts", "게시물"],
        ["activity", "활동"],
        ["visual", "비주얼"],
        ["automation", "자동화"],
      ]
        .map(
          ([key, label]) =>
            `<button class="tab-link${
              tab === key ? " active" : ""
            }" data-act="char-tab" data-id="${attr(c.id)}" data-tab="${key}">${label}</button>`,
        )
        .join("")}
    </div>`;

  let body = "";
  if (tab === "profile") {
    body = `
      <div style="max-width:560px">
        <div style="display:flex;align-items:baseline;gap:10px;margin:0 0 10px"><span style="font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;font-weight:600">프로필 수정</span><span style="font-size:11px;color:var(--color-neutral-500)">PATCH /api/characters/:id</span></div>
        <form data-action="char-profile" data-character-id="${attr(
          c.id,
        )}" style="display:flex;flex-direction:column;gap:12px">
          <div class="field"><label>표시 이름</label><input class="input" name="displayName" value="${attr(
            c.displayName,
          )}" required></div>
          <div class="field"><label>Bio</label><input class="input" name="bio" value="${attr(
            c.bio,
          )}" required></div>
          <div class="field"><label>관심사 (쉼표 구분)</label><input class="input" name="interests" value="${attr(
            (c.interests ?? []).join(", "),
          )}"></div>
          <div><button class="btn btn-primary" type="submit">저장</button></div>
        </form>
      </div>`;
  } else if (tab === "personas") {
    body = characterPersonasPanel(c.id, personas);
  } else if (tab === "memory") {
    body = characterMemoriesPanel(c.id, memories);
  } else if (tab === "posts") {
    const postsRes = await request(
      endpoint("/api/posts", { characterId: id, limit: 50 }),
    );
    const posts = itemsFromPage(postsRes.body);
    const rows = posts.length
      ? posts
          .map((p) => {
            const [tc, tl] = postTypeMeta(p.contentType);
            return `<tr>
              <td><span class="tag ${tc}">${tl}</span></td>
              <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${attr(
                p.content,
              )}">${escapeHtml(p.content)}</td>
              <td style="color:var(--color-accent-700)">${escapeHtml(
                hashtagsText(p.hashtags),
              )}</td>
              <td><span class="tag tag-neutral">${escapeHtml(
                mediaLabel(p.media),
              )}</span></td>
              <td style="text-align:right;font-variant-numeric:tabular-nums">${p.commentCount ?? 0}</td>
              <td style="text-align:right;font-variant-numeric:tabular-nums">${p.reactionCount ?? 0}</td>
              <td style="color:var(--color-neutral-600);font-size:12.5px">${fmtDateTime(
                p.createdAt,
              )}</td>
            </tr>`;
          })
          .join("")
      : `<tr class="empty-row"><td colspan="7">게시물이 없습니다.</td></tr>`;
    body = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px">
        <span class="count-note">${posts.length}건 · GET /api/posts?characterId=</span>
        <button class="btn btn-primary" data-act="open-dialog" data-dialog="new-post" data-actor="${attr(
          id,
        )}">새 게시물</button>
      </div>
      <table class="table">
        <thead><tr><th>타입</th><th>본문</th><th>해시태그</th><th>미디어</th><th style="text-align:right">댓글</th><th style="text-align:right">반응</th><th>작성</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  } else if (tab === "visual") {
    const profileRes = await request(`/api/characters/${id}/visual-profile`);
    const vp = profileRes.ok ? (profileRes.body ?? {}) : {};
    const references = Array.isArray(vp.referenceMedia)
      ? vp.referenceMedia
      : [];
    const refMediaIds = references.map((r) => r.mediaId);
    const missingCaptions = references.filter((r) => !r.description).length;
    const testJobs = jobs.filter((j) => j.mediaType === "image").slice(0, 6);
    body = `
      <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:56px">
        <div>
          <div style="display:flex;align-items:baseline;gap:10px;margin:0 0 10px"><span style="font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;font-weight:600">비주얼 프로필</span><span style="font-size:11px;color:var(--color-neutral-500)">PUT /api/characters/:id/visual-profile</span></div>
          <form data-action="visual-profile-save" data-character-id="${attr(
            c.id,
          )}" style="display:flex;flex-direction:column;gap:12px">
            <div class="field"><label>외모 프롬프트</label><textarea class="input" name="appearancePrompt" rows="3" placeholder="얼굴 · 헤어 · 체형 · 패션 톤 (항상 프롬프트 앞에 주입)">${escapeHtml(
              vp.appearancePrompt ?? "",
            )}</textarea></div>
            <div class="field"><label>스타일 프롬프트</label><textarea class="input" name="stylePrompt" rows="3" placeholder="화풍 — 예: film photography, Kodak Portra, grain">${escapeHtml(
              vp.stylePrompt ?? "",
            )}</textarea></div>
            <div class="field"><label>네거티브 프롬프트</label><textarea class="input" name="negativePrompt" rows="2" placeholder="blurry, deformed hands, text">${escapeHtml(
              vp.negativePrompt ?? "",
            )}</textarea></div>
            <div><button class="btn btn-primary" type="submit">저장</button></div>
          </form>
          <div style="display:flex;align-items:baseline;gap:10px;margin:30px 0 10px"><span style="font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;font-weight:600">테스트 생성</span><span style="font-size:11px;color:var(--color-neutral-500)">POST /api/characters/:id/visual-profile/test-generation</span></div>
          <form data-action="visual-test-gen" data-character-id="${attr(
            c.id,
          )}" style="display:flex;gap:8px">
            <input class="input" name="scene" placeholder="장면 설명 — 예: 노을 지는 애월 해변 산책">
            <button class="btn btn-secondary" type="submit" style="flex:none">생성 큐 등록</button>
          </form>
          <p style="margin:8px 0 0;font-size:12px;color:var(--color-neutral-500)">외모 + 장면 + 스타일 프롬프트가 합쳐져 이미지 생성 잡으로 등록됩니다. 결과는 아래 최근 생성에 표시됩니다.</p>
        </div>
        <div>
          <div style="display:flex;align-items:baseline;gap:10px;margin:0 0 10px;flex-wrap:wrap"><span style="font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;font-weight:600">레퍼런스 이미지</span><span style="font-size:11px;color:var(--color-neutral-500)">${references.length}/5 · PUT /api/characters/:id/visual-profile/references</span><span style="flex:1;min-width:0"></span>${
            references.length
              ? `${
                  missingCaptions
                    ? `<span style="font-size:11px;color:var(--color-neutral-500)">캡션 없음 ${missingCaptions}장</span>`
                    : ""
                }<button class="btn btn-secondary" type="button" style="flex:none" data-act="visual-profile-caption" data-id="${attr(
                  c.id,
                )}">캡션 생성</button>`
              : ""
          }</div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            ${
              references.length
                ? references
                    .map(
                      (r) => `<div style="position:relative;width:96px">
                        <img src="${attr(r.url)}" alt="reference" style="width:96px;height:96px;object-fit:cover;border:1px solid var(--color-divider)">
                        <button class="btn btn-ghost" style="position:absolute;top:2px;right:2px;padding:0 6px;background:rgba(255,255,255,.85)" title="제거" data-act="visual-ref-remove" data-id="${attr(
                          c.id,
                        )}" data-media="${attr(r.mediaId)}" data-media-ids="${attr(
                          refMediaIds.join(","),
                        )}">×</button>
                        ${
                          r.description
                            ? `<div title="${attr(
                                r.description,
                              )}" style="margin-top:4px;font-size:12px;color:var(--color-neutral-500);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${escapeHtml(
                                r.description,
                              )}</div>`
                            : `<div style="margin-top:4px;font-size:12px;color:var(--color-neutral-500);font-style:italic">캡션 없음 — 기획 선별에서 제외됨</div>`
                        }
                      </div>`,
                    )
                    .join("")
                : `<div style="padding:8px 0;color:var(--color-neutral-600);font-style:italic">레퍼런스가 없습니다 — 테스트 생성으로 만든 이미지를 승격하거나 파일을 업로드하세요.</div>`
            }
          </div>
          <form data-action="visual-ref-add" data-character-id="${attr(
            c.id,
          )}" data-media-ids="${attr(refMediaIds.join(","))}" style="display:flex;gap:8px;margin-top:12px">
            <input class="input" type="file" name="referenceFile" accept="image/*" required>
            <button class="btn btn-secondary" type="submit" style="flex:none">업로드 추가</button>
          </form>
          <div style="display:flex;align-items:baseline;gap:10px;margin:30px 0 10px"><span style="font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;font-weight:600">최근 생성</span><span style="font-size:11px;color:var(--color-neutral-500)">GET /api/generation/jobs?characterId=</span></div>
          <div style="font-size:13px">
            ${
              testJobs.length
                ? testJobs
                    .map((j) => {
                      const [sc, sl] = jobStatusMeta(j.status);
                      const thumb = j.outputMedia?.url
                        ? `<img src="${attr(j.outputMedia.url)}" alt="output" style="width:44px;height:44px;object-fit:cover;border:1px solid var(--color-divider);flex:none">`
                        : "";
                      const promote =
                        j.status === "completed" && j.outputMedia?.url
                          ? `<button class="btn btn-ghost" style="flex:none;padding:0 8px" title="레퍼런스로 승격" data-act="visual-ref-promote" data-id="${attr(
                              c.id,
                            )}" data-job="${attr(j.id)}" data-media-ids="${attr(
                              refMediaIds.join(","),
                            )}">승격</button>`
                          : "";
                      return `<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--color-divider)">${thumb}<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${attr(
                        j.prompt,
                      )}">${escapeHtml(j.prompt)}</span><span class="tag ${sc}" style="flex:none">${escapeHtml(
                        sl,
                      )}</span>${promote}</div>`;
                    })
                    .join("")
                : `<div style="padding:8px 0;color:var(--color-neutral-600);font-style:italic">생성 이력이 없습니다.</div>`
            }
          </div>
        </div>
      </div>`;
  } else if (tab === "automation") {
    const [policyRes, draftsRes] = await Promise.all([
      request(`/api/characters/${id}/posting-policy`),
      request(endpoint("/api/drafts", { characterId: id, limit: 10 })),
    ]);
    const policy = policyRes.ok ? (policyRes.body ?? {}) : {};
    const drafts = itemsFromPage(draftsRes.body);
    body = `
      <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:56px">
        <div>
          <div style="display:flex;align-items:baseline;gap:10px;margin:0 0 10px"><span style="font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;font-weight:600">포스팅 정책</span><span style="font-size:11px;color:var(--color-neutral-500)">PUT /api/characters/:id/posting-policy</span></div>
          <form data-action="policy-save" data-character-id="${attr(
            c.id,
          )}" style="display:flex;flex-direction:column;gap:12px">
            <label style="display:flex;align-items:center;gap:8px;font-size:14px">
              <input type="checkbox" name="enabled" ${policy.enabled ? "checked" : ""}>
              자동 포스팅 활성화 (스케줄러가 초안을 자동 기획)
            </label>
            <div class="field"><label>주당 게시 횟수 (1~21)</label><input class="input" type="number" name="weeklyCadence" min="1" max="21" value="${attr(
              String(policy.weeklyCadence ?? 3),
            )}"></div>
            <div style="display:flex;gap:12px">
              <div class="field" style="flex:1"><label>게시 시간창 시작 (KST 시)</label><input class="input" type="number" name="hourStartKst" min="0" max="23" value="${attr(
                String(policy.hourStartKst ?? 18),
              )}"></div>
              <div class="field" style="flex:1"><label>종료 (KST 시)</label><input class="input" type="number" name="hourEndKst" min="0" max="23" value="${attr(
                String(policy.hourEndKst ?? 22),
              )}"></div>
            </div>
            <div><button class="btn btn-primary" type="submit">저장</button></div>
          </form>
          <div style="display:flex;align-items:baseline;gap:10px;margin:30px 0 10px"><span style="font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;font-weight:600">수동 초안 기획</span><span style="font-size:11px;color:var(--color-neutral-500)">POST /api/drafts</span></div>
          <form data-action="draft-create" data-character-id="${attr(
            c.id,
          )}" style="display:flex;gap:8px">
            <input class="input" name="sceneHint" placeholder="장면 힌트 (선택) — 예: 비 오는 날 창가 카페">
            <button class="btn btn-secondary" type="submit" style="flex:none">기획 큐 등록</button>
          </form>
          <p style="margin:8px 0 0;font-size:12px;color:var(--color-neutral-500)">워커가 페르소나·메모리·최근 게시물을 반영해 캡션과 컷을 기획하고, 이미지 생성 후 초안 검수 큐에 올립니다.</p>
        </div>
        <div>
          <div style="display:flex;align-items:baseline;gap:10px;margin:0 0 10px"><span style="font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;font-weight:600">최근 초안</span><span style="font-size:11px;color:var(--color-neutral-500)">${drafts.length}건 · GET /api/drafts?characterId=</span></div>
          <div style="font-size:13px">
            ${
              drafts.length
                ? drafts
                    .map((d) => {
                      const [dc, dl] = draftStatusMeta(d.status);
                      return `<div style="display:flex;align-items:baseline;gap:12px;padding:10px 0;border-bottom:1px solid var(--color-divider);cursor:pointer" data-act="go-draft" data-id="${attr(
                        d.id,
                      )}">
                        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(
                          d.caption || "(기획 전)",
                        )}</span>
                        <span class="tag ${dc}" style="flex:none">${escapeHtml(dl)}</span>
                        <span style="color:var(--color-neutral-500);font-size:11px;flex:none">${
                          d.scheduledAt ? fmtDateTime(d.scheduledAt) : "즉시"
                        }</span>
                      </div>`;
                    })
                    .join("")
                : `<div style="padding:10px 0;color:var(--color-neutral-600);font-style:italic">초안이 없습니다 — 왼쪽에서 기획을 등록하거나 자동 포스팅을 켜세요.</div>`
            }
          </div>
        </div>
      </div>`;
  } else {
    // activity
    const logRows = logs.length
      ? logs
          .map(
            (l) =>
              `<div style="padding:10px 0;border-bottom:1px solid var(--color-divider);display:flex;flex-direction:column;gap:5px"><div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px"><span class="tag ${logTagClass(
                l.actionType,
              )}">${escapeHtml(
                l.actionType,
              )}</span><span style="color:var(--color-neutral-500);font-size:11px;flex:none">${fmtDateTime(
                l.createdAt,
              )}</span></div><span>${escapeHtml(l.reason ?? "")}</span></div>`,
          )
          .join("")
      : `<div style="padding:10px 0;color:var(--color-neutral-600);font-style:italic">기록된 액션이 없습니다.</div>`;
    body = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:56px">
        <div>
          <div style="display:flex;align-items:baseline;gap:10px;margin:0 0 8px"><span style="font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;font-weight:600">최근 액션 로그</span><span style="font-size:11px;color:var(--color-neutral-500)">GET /api/character-action-logs</span></div>
          <div style="font-size:13px;line-height:1.5">${logRows}</div>
        </div>
        <div>
          <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin:0 0 8px"><span style="font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;font-weight:600">생성 작업</span><span style="font-size:11px;color:var(--color-neutral-500)">${
            jobs.length
          }건 · GET /api/generation/jobs</span></div>
          <div style="font-size:13px">
            ${
              jobs.length
                ? jobs
                    .map((j) => {
                      const [sc, sl] = jobStatusMeta(j.status);
                      return `<div style="display:flex;align-items:baseline;gap:12px;padding:10px 0;border-bottom:1px solid var(--color-divider)"><span style="flex:1;min-width:0">${escapeHtml(
                        j.prompt,
                      )}</span><span style="color:var(--color-neutral-500);font-size:11px;flex:none">${escapeHtml(
                        j.mediaType,
                      )}</span><span class="tag ${sc}" style="flex:none">${escapeHtml(
                        sl,
                      )}</span></div>`;
                    })
                    .join("")
                : `<div style="padding:10px 0;color:var(--color-neutral-600);font-style:italic">생성 작업이 없습니다.</div>`
            }
          </div>
          <div style="margin-top:14px"><button class="btn btn-secondary" data-act="open-dialog" data-dialog="new-job" data-char="${attr(
            c.id,
          )}">큐 등록</button></div>
        </div>
      </div>`;
  }

  return `<div>${header}${body}</div>`;
}

// ── 게시물 ────────────────────────────────────────────────────────────────

async function renderPosts() {
  if (ui.selPostId) {
    return renderPostDetail(ui.selPostId);
  }
  await loadCharacterOptions();
  const res = await request(endpoint("/api/posts", { limit: 50 }));
  const posts = itemsFromPage(res.body);

  const rows = posts.length
    ? posts
        .map((p) => {
          return `<tr class="clickable" data-act="select-post" data-id="${attr(
            p.id,
          )}">
            <td style="font-weight:600">${escapeHtml(charName(p.characterId))}</td>
            <td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${attr(
              p.content,
            )}">${escapeHtml(p.content)}</td>
            <td style="color:var(--color-accent-700)">${escapeHtml(
              hashtagsText(p.hashtags),
            )}</td>
            <td><span class="tag tag-neutral">${escapeHtml(
              mediaLabel(p.media),
            )}</span></td>
            <td style="text-align:right;font-variant-numeric:tabular-nums">${p.commentCount ?? 0}</td>
            <td style="text-align:right;font-variant-numeric:tabular-nums">${p.reactionCount ?? 0}</td>
            <td style="color:var(--color-neutral-600);font-size:12.5px">${fmtDateTime(
              p.createdAt,
            )}</td>
            <td style="white-space:nowrap"><button class="btn btn-ghost" data-act="open-dialog" data-dialog="comment" data-post-id="${attr(
              p.id,
            )}">댓글</button> <button class="btn btn-ghost" data-act="open-dialog" data-dialog="reaction" data-post-id="${attr(
              p.id,
            )}">반응</button></td>
          </tr>`;
        })
        .join("")
    : `<tr class="empty-row"><td colspan="8">게시물이 없습니다.</td></tr>`;

  return `
    ${sectionHead(
      "게시물",
      "캐릭터 명의의 게시물 생성과, 캐릭터 명의 댓글·반응 부여",
      `<button class="btn btn-primary" data-act="open-dialog" data-dialog="new-post">새 게시물</button>`,
    )}
    <table class="table">
      <thead><tr><th>작성 캐릭터</th><th>본문</th><th>해시태그</th><th>미디어</th><th style="text-align:right">댓글</th><th style="text-align:right">반응</th><th>작성</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

async function renderPostDetail(id) {
  const [postRes, commentsRes, reactionsRes, logsRes] = await Promise.all([
    request(`/api/posts/${id}`),
    request(endpoint(`/api/posts/${id}/comments`, { limit: 50 })),
    request(endpoint(`/api/posts/${id}/reactions`, { limit: 50 })),
    request("/api/character-action-logs"),
  ]);
  const p = postRes.body;
  if (!postRes.ok || !p?.id) {
    return `<button class="btn btn-ghost" style="margin:0 0 18px -5px" data-act="back-posts">← 게시물 목록</button>${noticeBlock(
      "게시물을 찾을 수 없습니다.",
    )}`;
  }
  await loadCharacterOptions();
  const comments = itemsFromPage(commentsRes.body);
  const reactions = itemsFromPage(reactionsRes.body);
  const logs = itemsFromPage(logsRes.body).filter((l) => l.targetId === id);
  const [tc, tl] = postTypeMeta(p.contentType);
  const stats = [
    ["미디어", mediaLabel(p.media)],
    ["댓글", comments.length],
    ["반응", reactions.length],
  ];
  const logRows = logs.length
    ? logs
        .map(
          (l) =>
            `<div style="padding:10px 0;border-bottom:1px solid var(--color-divider);display:flex;flex-direction:column;gap:5px"><div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px"><span class="tag ${logTagClass(
              l.actionType,
            )}">${escapeHtml(
              l.actionType,
            )}</span><span style="color:var(--color-neutral-500);font-size:11px;flex:none">${fmtDateTime(
              l.createdAt,
            )}</span></div><span>${escapeHtml(l.reason ?? "")}</span></div>`,
        )
        .join("")
    : `<div style="padding:10px 0;color:var(--color-neutral-600);font-style:italic">관련 로그가 없습니다.</div>`;

  return `
    <button class="btn btn-ghost" style="margin:0 0 18px -5px" data-act="back-posts">← 게시물 목록</button>
    <div style="max-width:760px">
      <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:12px">
        <h2 style="font-size:30px;margin:0">${escapeHtml(charName(p.characterId))}</h2>
        <span class="tag ${tc}">${tl}</span>
        <span style="font-size:13px;color:var(--color-neutral-600)">${fmtDateTime(
          p.createdAt,
        )}</span>
      </div>
      <p style="font-size:19px;line-height:1.55;margin:0 0 14px">${escapeHtml(
        p.content,
      )}</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:28px">
        ${(p.hashtags ?? [])
          .map((t) => `<span class="tag tag-outline">#${escapeHtml(t)}</span>`)
          .join("")}
      </div>
      ${postMediaGallery(p.media)}
      <div style="display:flex;gap:48px;margin-bottom:30px;font-size:14px">
        ${stats
          .map(
            ([label, value]) =>
              `<div><div class="stat-label">${escapeHtml(
                label,
              )}</div><span class="stat-value" style="font-size:18px">${escapeHtml(
                value,
              )}</span></div>`,
          )
          .join("")}
      </div>
      <div style="display:flex;gap:8px;margin-bottom:40px">
        <button class="btn btn-secondary" data-act="open-dialog" data-dialog="comment" data-post-id="${attr(
          p.id,
        )}">캐릭터 댓글 달기</button>
        <button class="btn btn-secondary" data-act="open-dialog" data-dialog="reaction" data-post-id="${attr(
          p.id,
        )}">캐릭터 반응 추가</button>
      </div>
      <div style="display:flex;align-items:baseline;gap:10px;margin:0 0 4px"><span style="font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;font-weight:600">관련 액션 로그</span><span style="font-size:11px;color:var(--color-neutral-500)">GET /api/character-action-logs</span></div>
      <div style="font-size:13px;line-height:1.5;max-width:560px">${logRows}</div>
    </div>`;
}

// ── 생성 작업 ──────────────────────────────────────────────────────────────

// 설정 카드 — fal 키/모델 관리 + 적용 상태. 값 원문은 서버가 마스킹해 준다.
// 설정 라우트 본문 — 프로바이더 설정 + 워커 카드 (생성 작업에서 이동).
export function settingsView(settings, queuedCount, changes = []) {
  return `${sectionHead(
    "설정",
    "프로바이더·워커 전역 설정 — 저장 즉시 다음 잡/기획부터 적용됩니다",
  )}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start">
      ${generationSettingsCard(settings)}
      ${generationWorkerCard(settings, queuedCount)}
    </div>
    ${settingsChangesCard(changes)}`;
}

// 설정 변경 이력 (console_logs) — 읽기 전용.
function settingsChangesCard(changes) {
  const rows = changes.length
    ? changes
        .map(
          (change) => `<tr>
            <td style="color:var(--color-neutral-600);font-size:12.5px;white-space:nowrap">${fmtDateTime(change.createdAt)}</td>
            <td>${escapeHtml(change.adminEmail ?? "—")}</td>
            <td style="font-size:12.5px">${escapeHtml(change.target ?? "—")}</td>
            <td><span class="tag ${change.actionType === "SETTINGS_CLEAR" ? "tag-neutral" : "tag-accent"}">${change.actionType === "SETTINGS_CLEAR" ? "삭제" : "저장"}</span></td>
            <td style="font-size:12.5px">${escapeHtml(change.summary ?? "")}</td>
          </tr>`,
        )
        .join("")
    : `<tr class="empty-row"><td colspan="5">변경 이력이 없습니다.</td></tr>`;
  return `<div class="card" style="margin-top:20px">
    <h6 style="margin:0 0 10px;color:var(--color-neutral-600)">최근 설정 변경</h6>
    <table class="table"><thead><tr><th>시각</th><th>관리자</th><th>항목</th><th>유형</th><th>값</th></tr></thead>
    <tbody>${rows}</tbody></table>
  </div>`;
}

// 생성 작업 화면의 읽기 전용 프로바이더 요약 — 상태 가시성은 유지하되
// 변경은 설정 라우트로 보낸다.
export function generationProvidersSummary(settings) {
  const resolved = settings?.resolved;
  if (!resolved) return "";
  return `<div class="card" style="margin-bottom:20px;padding:10px 16px;flex-direction:row;flex-wrap:wrap;gap:6px 18px;align-items:center;font-size:13px">
    <span class="stat-label" style="margin:0">적용 중</span>
    <span>edit <strong>${escapeHtml(resolved.editProvider ?? "—")}</strong></span>
    <span>t2i <strong>${escapeHtml(resolved.t2iProvider ?? "—")}</strong></span>
    <span>기획 <strong>${escapeHtml(resolved.plannerProvider ?? "—")}</strong></span>
    <a href="/settings" data-act="go-route" data-route="settings" style="margin-left:auto;font-size:12.5px">설정에서 변경 →</a>
  </div>`;
}

async function renderSettings() {
  const [settingsRes, queuedRes, changesRes] = await Promise.all([
    request("/api/settings/generation"),
    request(endpoint("/api/generation/jobs", { status: "queued", limit: 50 })),
    request("/api/settings/generation/changes"),
  ]);
  const settings = settingsRes.ok ? settingsRes.body : null;
  const queuedCount = itemsFromPage(queuedRes.body).length;
  const changes = changesRes.ok ? (changesRes.body?.items ?? []) : [];
  return settingsView(settings, queuedCount, changes);
}

function generationSettingsCard(settings) {
  if (!settings) {
    return `<div class="card">${noticeBlock(
      "프로바이더 설정을 불러오지 못했습니다.",
    )}</div>`;
  }
  const key = settings.falApiKey ?? { set: false };
  const sources = settings.resolved?.sources ?? {};
  const llmKey = settings.llmApiKey ?? { set: false };
  const plannerSources = settings.resolved?.plannerSources ?? {};
  const chat = settings.chat ?? {
    overrides: {
      apiKey: { set: false },
      apiUrl: null,
      model: null,
      embeddingModel: null,
    },
    effective: {
      apiKeyLast4: null,
      apiUrl: null,
      model: null,
      embeddingModel: "",
      overridden: {},
    },
  };
  const llmKeyStatus = llmKey.set
    ? `<span class="tag tag-accent">저장됨 ····${escapeHtml(llmKey.last4 ?? "")}</span>
       <button class="btn btn-ghost" type="button" style="color:var(--color-accent-2-700)" data-act="settings-clear-llm-key">키 삭제</button>`
    : plannerSources.apiKey === "env"
      ? '<span class="tag tag-neutral">env 키 사용 중</span>'
      : '<span class="tag tag-accent-2">키 없음 — 로컬 플래너</span>';
  const keyStatus = key.set
    ? `<span class="tag tag-accent">저장됨 ····${escapeHtml(key.last4 ?? "")}</span>
       <button class="btn btn-ghost" type="button" style="color:var(--color-accent-2-700)" data-act="settings-clear-key">키 삭제</button>`
    : sources.apiKey === "env"
      ? '<span class="tag tag-neutral">env 키 사용 중</span>'
      : '<span class="tag tag-accent-2">키 없음 — 로컬 플레이스홀더</span>';
  // 채팅 키: 오버라이드가 있으면 그 값(삭제 버튼 포함), 없으면 상속된
  // 기획 키의 실효값을 그대로 보여준다 (별도 "상속" 문구 없이 값이 보이게).
  const chatKeyStatus = chat.overrides.apiKey.set
    ? `<span class="tag tag-accent">저장됨 ····${escapeHtml(chat.overrides.apiKey.last4 ?? "")}</span>
       <button class="btn btn-ghost" type="button" style="color:var(--color-accent-2-700)" data-act="settings-clear-agent-key">키 삭제</button>`
    : chat.effective.apiKeyLast4
      ? `<span class="tag tag-neutral">····${escapeHtml(chat.effective.apiKeyLast4)}</span>`
      : '<span class="tag tag-accent-2">키 없음</span>';
  // env 폴백 활성 필드는 라벨 옆 상시 태그로 표시 — placeholder는 값을
  // 입력하면 사라져 "env에 뭐가 적용 중인지"를 잃기 때문.
  const envTag = (source) =>
    source === "env"
      ? ' <span class="tag tag-neutral" style="margin-left:6px">env 값 사용 중</span>'
      : "";
  // 컴팩트 행: 라벨 | 컨트롤. 필드마다 큰 블록을 쌓지 않는다.
  const row = (label, controlHtml) =>
    `<div style="display:grid;grid-template-columns:150px 1fr;gap:4px 10px;align-items:center">
      <label style="margin:0;font-size:12.5px;color:var(--color-neutral-600)">${label}</label>
      <div style="display:flex;align-items:center;gap:8px;min-width:0">${controlHtml}</div>
    </div>`;
  const textInput = (name, value, placeholder) =>
    `<input class="input" style="padding:6px 10px;font-size:13px" name="${name}" value="${attr(value ?? "")}" placeholder="${attr(placeholder ?? "")}">`;
  const secretInput = (name, placeholder) =>
    `<input class="input" style="padding:6px 10px;font-size:13px" name="${name}" type="password" autocomplete="off" placeholder="${attr(placeholder)}">`;
  const sectionHeadRow = (title, testAct) =>
    `<div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px">
      <h6 style="margin:0;color:var(--color-neutral-600)">${title}</h6>
      <button class="btn btn-ghost" type="button" data-act="${testAct}">연결 테스트</button>
    </div>`;
  const divider =
    '<div style="border-top:1px solid var(--color-divider)"></div>';
  return `
    <form class="card" data-action="generation-settings" style="gap:10px">
      ${sectionHeadRow("이미지 생성 (fal.ai)", "settings-test-image")}
      ${row("fal.ai API 키", `${keyStatus} ${secretInput("falApiKey", key.set ? "변경할 때만 입력" : "fal.ai 대시보드에서 발급한 키")}`)}
      ${row(`edit 모델 (레퍼런스 컨디셔닝)${envTag(sources.editModel)}`, textInput("falImageModel", settings.falImageModel, "fal-ai/nano-banana/edit"))}
      ${row(`t2i 모델 (콜드스타트)${envTag(sources.t2iModel)}`, textInput("falImageT2iModel", settings.falImageT2iModel, "fal-ai/nano-banana"))}
      ${divider}
      ${sectionHeadRow("기획 LLM (OpenAI-compatible)", "settings-test-llm")}
      ${row("LLM API 키", `${llmKeyStatus} ${secretInput("llmApiKey", llmKey.set ? "변경할 때만 입력" : "sk-...")}`)}
      ${row(`API URL${envTag(plannerSources.apiUrl)}`, textInput("llmApiUrl", settings.llmApiUrl, "https://api.openai.com/v1/chat/completions"))}
      ${row(`모델${envTag(plannerSources.model)}`, textInput("llmModel", settings.llmModel, "gpt-5-mini"))}
      ${divider}
      ${sectionHeadRow("캐릭터 채팅 LLM (opod-agent)", "settings-test-chat")}
      ${row("API 키", `${chatKeyStatus} ${secretInput("agentLlmApiKey", "채팅 전용 키로 바꿀 때만 입력")}`)}
      ${row("API URL", textInput("agentLlmApiUrl", chat.overrides.apiUrl, chat.effective.apiUrl ?? "https://api.openai.com/v1/chat/completions"))}
      ${row("모델", textInput("agentLlmModel", chat.overrides.model, chat.effective.model ?? "모델명"))}
      ${row("임베딩 모델", textInput("agentEmbeddingModel", chat.overrides.embeddingModel, chat.effective.embeddingModel))}
      <p style="margin:0;font-size:12px;color:var(--color-neutral-600)">DB 설정이 env보다 우선하며 다음 잡/기획/대화부터 즉시 적용됩니다. <strong>모델·URL은 비우고 저장하면 상위 값(상속/env)으로 복귀</strong>하지만, <strong>API 키는 비워도 유지</strong>되고 삭제는 "키 삭제" 버튼으로만 합니다. 채팅 LLM은 비워둔 필드가 기획 LLM 값을 그대로 쓰며(입력칸의 회색 값), 바꾸고 싶은 필드만 채우면 됩니다.</p>
      <div><button class="btn btn-primary" type="submit">저장</button></div>
    </form>`;
}

// 워커 상태 카드 — 적용 프로바이더/예산/오늘 지출 + 수동 실행.
function generationWorkerCard(settings, queuedCount) {
  if (!settings) {
    return "";
  }
  const worker = settings.worker ?? {};
  const resolved = settings.resolved ?? {};
  const budgetLabel =
    worker.dailyBudgetUsd != null
      ? `$${Number(worker.todaySpendUsd ?? 0).toFixed(2)} / $${Number(
          worker.dailyBudgetUsd,
        ).toFixed(2)}`
      : `$${Number(worker.todaySpendUsd ?? 0).toFixed(2)} (예산 미설정)`;
  return `
    <div class="card" style="gap:12px">
      <h6 style="margin:0;color:var(--color-neutral-600)">생성 워커</h6>
      <div style="display:grid;grid-template-columns:auto 1fr;gap:8px 14px;font-size:13.5px;align-items:baseline">
        <span class="stat-label" style="margin:0">자동 루프</span>
        <span>${
          worker.enabled
            ? '<span class="tag tag-accent">켜짐</span>'
            : '<span class="tag tag-neutral">꺼짐 (WORKER_ENABLED)</span>'
        }</span>
        <span class="stat-label" style="margin:0">t2i</span>
        <span style="word-break:break-all">${escapeHtml(resolved.t2iProvider ?? "—")}</span>
        <span class="stat-label" style="margin:0">edit</span>
        <span style="word-break:break-all">${escapeHtml(resolved.editProvider ?? "—")}</span>
        <span class="stat-label" style="margin:0">기획 LLM</span>
        <span style="word-break:break-all">${escapeHtml(resolved.plannerProvider ?? "—")}</span>
        <span class="stat-label" style="margin:0">오늘 지출</span>
        <span>${escapeHtml(budgetLabel)} <span style="color:var(--color-neutral-500);font-size:12px">(잡당 추정 $${Number(
          worker.jobCostEstimateUsd ?? 0,
        ).toFixed(2)})</span></span>
      </div>
      <p style="margin:0;font-size:12px;color:var(--color-neutral-600)">수동 실행은 자동 루프가 꺼져 있어도 동작합니다. 대기 중인 다음 작업 하나를 즉시 처리합니다.</p>
      <div><button class="btn btn-secondary" type="button" data-act="worker-run">대기 작업 실행${
        queuedCount > 0 ? ` (${queuedCount}건 대기)` : ""
      }</button></div>
    </div>`;
}

export function generationRequestPanel(characters) {
  return `${sectionHead(
    "새 이미지 생성",
    "요청을 입력한 뒤 서버가 구성한 최종 프롬프트를 확인합니다.",
    '<button class="btn btn-ghost" type="button" data-act="generation-back">목록으로</button>',
  )}
  <div class="generation-stepper">${generationStepLabels
    .map(
      (label, index) =>
        `<div class="generation-step${index === 0 ? " generation-step-current" : ""}" aria-current="${index === 0 ? "step" : "false"}"><span>${index + 1}</span>${escapeHtml(label)}</div>`,
    )
    .join("")}</div>
  <form class="generation-workflow-card" data-action="image-draft-create">
    <h3>요청 입력</h3>
    <div class="field"><label>캐릭터</label><select class="input" name="characterId" required><option value="">선택하세요</option>${optionList(
      characters,
      "id",
      (character) =>
        character.displayName || character.publicId || character.id,
      "",
    )}</select></div>
    <div class="field"><label>이미지 요청</label><textarea class="input" name="inputPrompt" rows="6" required></textarea></div>
    <div class="field"><label>용도 (비율)</label><select class="input" name="aspectRatio" required><option value="4:3" selected>게시글 (4:3)</option><option value="16:9">스토리 (16:9)</option></select></div>
    <div class="field"><label>후보 수</label><input class="input" name="candidateCount" type="number" min="1" max="4" step="1" value="3" required></div>
    <div><button class="btn btn-primary" type="submit">최종 프롬프트 확인</button></div>
  </form>`;
}

function scheduleGenerationRefresh(jobId) {
  return generationReplacePollTimer(ui, jobId, {
    clearTimer: clearTimeout,
    setTimer: setTimeout,
    currentRoute,
    currentHash: currentUrl,
    refresh: renderApp,
  });
}

async function renderGeneration(renderEpoch) {
  const routeState = generationRouteState(currentUrl());
  const characters = await loadCharacterOptions();
  if (ui.generationCreating && !routeState.jobId) {
    return generationRequestPanel(characters);
  }
  if (routeState.jobId) {
    const [jobRes, settingsRes] = await Promise.all([
      request(`/api/generation/jobs/${routeState.jobId}`),
      request("/api/settings/generation"),
    ]);
    if (!jobRes.ok || !jobRes.body?.id) {
      return `${sectionHead(
        "이미지 생성",
        "작업을 불러오지 못했습니다.",
        '<button class="btn btn-ghost" type="button" data-act="generation-back">목록으로</button>',
      )}${noticeBlock(
        escapeHtml(errorMessage(jobRes.body, "생성 작업을 찾을 수 없습니다.")),
      )}`;
    }

    const job = jobRes.body;
    const history = [];
    const seen = new Set([job.id]);
    let originJobId = job.originJobId;
    while (originJobId && !seen.has(originJobId)) {
      seen.add(originJobId);
      const ancestorRes = await request(`/api/generation/jobs/${originJobId}`);
      if (!ancestorRes.ok || !ancestorRes.body?.id) break;
      history.push(ancestorRes.body);
      originJobId = ancestorRes.body.originJobId;
    }
    history.reverse();

    generationCommitRenderState(
      ui,
      job,
      {
        expectedToken: renderEpoch,
        currentToken: renderToken,
        route: currentRoute(),
        hash: currentUrl(),
      },
      scheduleGenerationRefresh,
    );

    return `${sectionHead(
      "이미지 생성",
      `${generationCharacterLabel(characters, job.characterId)} · ${generationWorkflowLabel(job)}`,
      '<button class="btn btn-ghost" type="button" data-act="generation-back">목록으로</button>',
    )}${generationWorkflowPanel(
      job,
      history,
      characters,
      settingsRes.ok ? settingsRes.body : null,
      ui.generationSelectedMediaId,
    )}`;
  }

  const statusParam =
    ui.filters.jobStatus === "전체" ? "" : ui.filters.jobStatus;
  const [res, settingsRes] = await Promise.all([
    request(
      endpoint("/api/generation/jobs", { status: statusParam, limit: 50 }),
    ),
    request("/api/settings/generation"),
  ]);
  const jobs = itemsFromPage(res.body);
  const settings = settingsRes.ok ? settingsRes.body : null;

  const rows = jobs.length
    ? jobs
        .map((j) => {
          const [sc, rawStatusLabel] = jobStatusMeta(j.status);
          const statusLabel =
            j.mediaType === "image"
              ? generationWorkflowLabel(j)
              : rawStatusLabel;
          const actions = [];
          if (j.mediaType === "image") {
            actions.push(
              `<button class="btn btn-ghost" data-act="generation-open" data-job-id="${attr(
                j.id,
              )}">열기</button>`,
            );
          } else if (j.status === "queued") {
            actions.push(
              `<button class="btn btn-ghost" data-act="job-run" data-id="${attr(
                j.id,
              )}">실행</button>`,
            );
          }
          if (j.mediaType !== "image" && j.status === "running") {
            actions.push(
              `<button class="btn btn-ghost" data-act="open-dialog" data-dialog="complete-job" data-job-id="${attr(
                j.id,
              )}">완료 처리</button>`,
            );
          }
          if (j.mediaType !== "image" && j.status === "failed") {
            actions.push(
              `<button class="btn btn-ghost" style="color:var(--color-accent-2-700)" data-act="job-retry" data-id="${attr(
                j.id,
              )}">재시도</button>`,
            );
          }
          if (j.draftId) {
            actions.push(
              `<button class="btn btn-ghost" data-act="go-draft" data-id="${attr(
                j.draftId,
              )}">초안 보기</button>`,
            );
          }
          return `<tr>
            <td style="font-weight:600">${escapeHtml(charName(j.characterId))}</td>
            <td>${escapeHtml(j.mediaType)}</td>
            <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${attr(
              j.prompt,
            )}">${escapeHtml(j.prompt)}</td>
            <td><span class="tag ${sc}">${escapeHtml(statusLabel)}</span></td>
            <td style="color:var(--color-neutral-600);font-size:12.5px">${fmtDateTime(
              j.createdAt,
            )}</td>
            <td style="white-space:nowrap">${actions.join(" ")}</td>
          </tr>`;
        })
        .join("")
    : `<tr class="empty-row"><td colspan="6">조건에 맞는 작업이 없습니다.</td></tr>`;

  return `
    ${sectionHead(
      "생성 작업",
      "이미지·영상 생성 job 큐 — 등록 → 실행 → 완료, 실패 시 재시도 복제",
      '<button class="btn btn-primary" data-act="generation-create">새 이미지 생성</button>',
    )}
    ${generationProvidersSummary(settings)}
    <div class="toolbar">
      ${segControl(
        "jobStatus",
        [
          { value: "전체", label: "전체" },
          { value: "draft", label: "draft" },
          { value: "queued", label: "queued" },
          { value: "running", label: "running" },
          { value: "completed", label: "completed" },
          { value: "failed", label: "failed" },
        ],
        ui.filters.jobStatus,
      )}
      <span class="count-note">${jobs.length}건</span>
    </div>
    <table class="table">
      <thead><tr><th>캐릭터</th><th>타입</th><th>프롬프트</th><th>상태</th><th>생성</th><th style="width:200px"></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ── 초안 검수 ──────────────────────────────────────────────────────────────

async function renderDrafts() {
  if (ui.selDraftId) {
    return renderDraftDetail(ui.selDraftId);
  }
  const characters = await loadCharacterOptions();
  const statusParam =
    ui.filters.draftStatus === "전체" ? "" : ui.filters.draftStatus;
  const res = await request(
    endpoint("/api/drafts", { status: statusParam, limit: 50 }),
  );
  const drafts = itemsFromPage(res.body);

  const rows = drafts.length
    ? drafts
        .map((d) => {
          const [sc, sl] = draftStatusMeta(d.status);
          return `<tr style="cursor:pointer" data-act="select-draft" data-id="${attr(
            d.id,
          )}">
            <td style="font-weight:600">${escapeHtml(charName(d.characterId))}</td>
            <td style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${attr(
              d.caption,
            )}">${escapeHtml(d.caption || "(기획 전)")}</td>
            <td><span class="tag ${sc}">${escapeHtml(sl)}</span></td>
            <td style="color:var(--color-neutral-600);font-size:12.5px">${
              d.scheduledAt ? fmtDateTime(d.scheduledAt) : "즉시"
            }</td>
            <td style="color:var(--color-neutral-600);font-size:12.5px">${fmtDateTime(
              d.createdAt,
            )}</td>
          </tr>`;
        })
        .join("")
    : `<tr class="empty-row"><td colspan="5">조건에 맞는 초안이 없습니다.</td></tr>`;

  return `
    ${sectionHead(
      "초안 검수",
      "포스트 초안 파이프라인 — 기획 → 생성 → 검수 → 승인 → 게시. 수동 초안은 단계마다 버튼으로 진행합니다.",
    )}
    <form data-action="draft-create" style="display:flex;gap:10px;align-items:flex-end;margin:0 0 20px;padding:16px;background:var(--color-neutral-100)">
      <div class="field" style="width:220px;margin:0"><label>캐릭터</label><select class="input" name="characterId" required><option value="">선택하세요</option>${optionList(
        characters,
        "id",
        (character) =>
          character.displayName || character.publicId || character.id,
        "",
      )}</select></div>
      <div class="field" style="flex:1;margin:0"><label>장면 힌트 (선택)</label><input class="input" name="sceneHint" placeholder="예: 비 오는 날 창가 카페에서 필름 카메라를 닦는 장면"></div>
      <div class="field" style="width:230px;margin:0"><label>진행 방식</label><select class="input" name="mode"><option value="manual">수동 — 단계별 버튼으로 진행</option><option value="auto">자동 — 워커가 끝까지 진행</option></select></div>
      <button class="btn btn-primary" type="submit" style="flex:none">초안 만들기</button>
    </form>
    <div class="toolbar">
      ${segControl(
        "draftStatus",
        [
          { value: "planned", label: "기획 대기" },
          { value: "needs_review", label: "검수 필요" },
          { value: "generating", label: "생성 중" },
          { value: "approved", label: "승인됨" },
          { value: "published", label: "게시됨" },
          { value: "failed", label: "실패" },
          { value: "전체", label: "전체" },
        ],
        ui.filters.draftStatus,
      )}
      <span class="count-note">${drafts.length}건 · GET /api/drafts</span>
    </div>
    <table class="table">
      <thead><tr><th>캐릭터</th><th>캡션</th><th>상태</th><th>게시 예정</th><th>생성</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// 진행 방식 태그 — 수동/자동 구분.
function draftModeMeta(mode) {
  return mode === "manual"
    ? ["tag-accent-2", "수동 진행"]
    : ["tag-neutral", "자동 진행"];
}

// 타임라인 단계 번호 원형: done=채움, current=강조 테두리, failed=경고, future=흐리게.
const DRAFT_STAGE_TONES = {
  done: "background:var(--color-accent-700);color:var(--color-bg);border:2px solid var(--color-accent-700);font-weight:600",
  current:
    "background:var(--color-bg);color:var(--color-accent-700);border:2px solid var(--color-accent-700);font-weight:700",
  failed:
    "background:var(--color-accent-2-700);color:var(--color-bg);border:2px solid var(--color-accent-2-700);font-weight:600",
  future:
    "background:transparent;color:var(--color-neutral-500);border:1px solid var(--color-divider)",
};

function draftStageCircle(num, tone) {
  return `<div style="flex:none;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;${
    DRAFT_STAGE_TONES[tone] ?? DRAFT_STAGE_TONES.future
  }">${num}</div>`;
}

function draftStage({
  num,
  tone,
  label,
  statusMeta,
  actionHtml = "",
  bodyHtml = "",
  last = false,
}) {
  const [tc, tl] = statusMeta;
  return `<div style="display:flex;gap:16px;padding:20px 0${
    last ? "" : ";border-bottom:1px solid var(--color-divider)"
  }">
    ${draftStageCircle(num, tone)}
    <div style="flex:1;min-width:0">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:${
        bodyHtml ? "12px" : "0"
      }">
        <span style="font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;font-weight:600">${escapeHtml(
          label,
        )}</span>
        <span class="tag ${tc}">${escapeHtml(tl)}</span>
        <span style="flex:1"></span>
        ${actionHtml}
      </div>
      ${bodyHtml}
    </div>
  </div>`;
}

function draftMetaRow(label, valueHtml) {
  return `<div style="display:flex;gap:12px;font-size:13px;padding:3px 0">
    <span style="flex:none;width:88px;color:var(--color-neutral-500)">${escapeHtml(
      label,
    )}</span>
    <span style="flex:1;min-width:0">${valueHtml}</span>
  </div>`;
}

function draftListBlock(label, items) {
  const list = (Array.isArray(items) ? items : []).filter(Boolean);
  if (!list.length) {
    return `<div style="margin-top:8px;color:var(--color-neutral-500);font-size:12px">${escapeHtml(
      label,
    )}: —</div>`;
  }
  return `<div style="margin-top:8px">
    <div style="color:var(--color-neutral-500);font-size:11px;text-transform:uppercase;letter-spacing:.08em">${escapeHtml(
      label,
    )}</div>
    <ul style="margin:2px 0 0;padding-left:16px">${list
      .map((it) => `<li style="padding:1px 0">${escapeHtml(it)}</li>`)
      .join("")}</ul>
  </div>`;
}

// ② 기획 완료 본문: 입력 스냅샷 요약/상세 + 출력(캡션·해시태그·컷 장면).
function draftPlanBody(plan, planInput, plannerName) {
  const shots = Array.isArray(plan?.shots) ? plan.shots : [];
  const inputSummary = planInput
    ? `페르소나 ${(planInput.personas ?? []).length} · 메모리 ${
        (planInput.memories ?? []).length
      } · 최근 캡션 ${(planInput.recentCaptions ?? []).length} · 장면 힌트 ${
        planInput.sceneHint ? "있음" : "없음"
      }`
    : "입력 스냅샷 없음";
  const inputDetails = planInput
    ? `<details style="margin-top:6px"><summary style="cursor:pointer;font-size:12px;color:var(--color-neutral-600)">입력 상세 보기</summary>
        <div style="margin-top:6px">
          ${draftListBlock(
            "페르소나",
            (planInput.personas ?? []).map((p) => p?.title),
          )}
          ${draftListBlock("메모리", planInput.memories ?? [])}
          ${draftListBlock("최근 캡션", planInput.recentCaptions ?? [])}
        </div>
      </details>`
    : "";
  const hashtags = (plan?.hashtags ?? [])
    .map(
      (t) =>
        `<span class="tag tag-accent" style="margin:0 4px 4px 0">#${escapeHtml(
          t,
        )}</span>`,
    )
    .join("");
  const sceneList = shots.length
    ? `<ol style="margin:6px 0 0;padding-left:18px;font-size:13px">${shots
        .map(
          (s) => `<li style="padding:2px 0">${escapeHtml(s?.scene || "")}</li>`,
        )
        .join("")}</ol>`
    : "";
  return `<div>
    <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--color-neutral-500);margin-bottom:4px">입력</div>
    <div style="font-size:13px">${escapeHtml(inputSummary)}</div>
    ${inputDetails}
    <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--color-neutral-500);margin:14px 0 4px">출력</div>
    <div style="font-size:14px;margin-bottom:6px">“${escapeHtml(
      plan?.caption || "",
    )}”</div>
    <div style="display:flex;flex-wrap:wrap;margin-bottom:2px">${hashtags}</div>
    ${sceneList}
    ${
      plannerName
        ? `<p class="count-note" style="margin:8px 0 0">플래너: ${escapeHtml(
            plannerName,
          )}</p>`
        : ""
    }
  </div>`;
}

// 구버전 초안 전체 필터 — 후보별 값이 없는 기존 데이터의 fallback.
function draftFinishPreset(d) {
  const concept = d?.conceptJson;
  const value =
    concept && typeof concept === "object" ? concept.finish : undefined;
  return value === "film" || value === "mono-film" ? value : "none";
}

function draftOutputFilterPreset(d, output) {
  const value = output?.filterPreset;
  return value === "none" || value === "film" || value === "mono-film"
    ? value
    : draftFinishPreset(d);
}

// ③ 컷 서브카드 — draft(수동 대기)는 생성 실행 폼, completed는 후보 그리드 등.
function draftShotCard(d, shot) {
  const [jc, jl] = jobStatusMeta(shot.status);
  const canRegen = d.status === "needs_review" || d.status === "failed";
  const regenBtn = canRegen
    ? `<div style="margin-top:8px"><button class="btn btn-ghost" data-act="draft-regen" data-draft="${attr(
        d.id,
      )}" data-job="${attr(shot.jobId)}">재생성</button></div>`
    : "";
  const header = `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
    <span style="font-weight:600">컷 ${shot.sortOrder + 1}</span>
    <span class="tag ${jc}">${escapeHtml(jl)}</span>
    ${
      shot.provider
        ? `<span style="font-size:12px;color:var(--color-neutral-500)">${escapeHtml(
            shot.provider,
          )}</span>`
        : ""
    }
    ${
      shot.costUsd != null
        ? `<span style="font-size:12px;color:var(--color-neutral-500)">$${escapeHtml(
            shot.costUsd,
          )}</span>`
        : ""
    }
  </div>`;
  const sceneRow = shot.scene
    ? `<div style="font-size:12.5px;color:var(--color-neutral-700);margin-bottom:8px"><span style="color:var(--color-neutral-500)">장면 · </span>${escapeHtml(
        shot.scene,
      )}</div>`
    : "";
  // 기획 LLM이 이 컷에 고른 레퍼런스(있을 때만). 없으면 전체 레퍼런스 폴백 — 표시 없음.
  const shotReferences = Array.isArray(shot.references) ? shot.references : [];
  const referencesRow = shotReferences.length
    ? `<div style="margin-bottom:8px">
        <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--color-neutral-500);margin-bottom:4px">선별 레퍼런스 ${
          shotReferences.length
        }장 — 기획 LLM이 장면에 맞게 골랐습니다</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${shotReferences
          .map(
            (r) =>
              `<img src="${attr(r.url)}" alt="reference" data-act="zoom-image" data-url="${attr(
                r.url,
              )}" style="width:52px;height:52px;object-fit:cover;border:1px solid var(--color-divider);cursor:zoom-in">`,
          )
          .join("")}</div>
      </div>`
    : "";
  let bodyHtml;
  if (shot.status === "draft") {
    bodyHtml = `<form data-action="draft-shot-generate" data-draft-id="${attr(
      d.id,
    )}" data-job-id="${attr(
      shot.jobId,
    )}" style="display:flex;flex-direction:column;gap:8px">
      <div class="field" style="margin:0"><label>최종 프롬프트</label><textarea class="input" name="prompt" rows="4">${escapeHtml(
        shot.prompt,
      )}</textarea></div>
      <p class="count-note" style="margin:0">${
        shot.prompt
          ? "실행 전 프롬프트를 수정할 수 있습니다."
          : "프롬프트가 비어 있습니다 — 상단 '프롬프트 빌드'를 먼저 실행하거나 직접 입력하세요."
      }</p>
      <div class="field" style="width:150px;margin:0"><label>후보 수</label><input class="input" type="number" name="candidateCount" min="1" max="4" value="${attr(
        shot.candidateCount ?? 2,
      )}"></div>
      <div><button class="btn btn-primary" type="submit">이미지 생성 실행</button></div>
    </form>`;
  } else if (shot.status === "queued" || shot.status === "running") {
    bodyHtml = `<p class="count-note" style="margin:0">이미지를 생성하는 중입니다…${
      shot.provider ? ` · ${escapeHtml(shot.provider)}` : ""
    }</p>`;
  } else if (shot.status === "failed") {
    bodyHtml = `<div style="font-size:12.5px;color:var(--color-accent-2-700)">${escapeHtml(
      shot.errorMessage || "생성에 실패했습니다.",
    )}</div>${regenBtn}`;
  } else {
    const outputs = Array.isArray(shot.outputs) ? shot.outputs : [];
    // 이미지 클릭 = 확대(라이트박스), 선택 = 이미지 아래 별도 컨트롤.
    const candidates = outputs.length
      ? outputs
          .map((o) => {
            const filterPreset = draftOutputFilterPreset(d, o);
            const filterEditable =
              d.status !== "published" && d.status !== "rejected";
            const selectControl = o.selected
              ? `<span class="tag tag-accent candidate-selected">✓ 게시 이미지</span>`
              : `<button class="btn btn-ghost" type="button" style="padding:5px 0" data-act="draft-pick-output" data-draft="${attr(
                  d.id,
                )}" data-job="${attr(shot.jobId)}" data-media="${attr(
                  o.mediaId,
                )}">이 이미지 선택</button>`;
            const filterButtons = [
              ["none", "원본"],
              ["film", "필름"],
              ["mono-film", "흑백"],
            ]
              .map(
                ([value, label]) =>
                  `<button type="button" data-act="draft-filter-set" data-filter="${value}" aria-pressed="${
                    filterPreset === value
                  }"${filterEditable ? "" : " disabled"}>${label}</button>`,
              )
              .join("");
            return `<article class="candidate" data-filter-media="${attr(
              o.mediaId,
            )}" data-filter-job="${attr(shot.jobId)}" data-filter-draft="${attr(
              d.id,
            )}" data-filter-preset="${attr(filterPreset)}">
              <img class="candidate-thumb${o.selected ? " is-selected" : ""}"
                src="${attr(o.url)}" alt="컷 ${escapeHtml(
                  shot.sortOrder + 1,
                )} 후보 ${escapeHtml(o.candidateIndex + 1)}"
                data-act="zoom-image" data-url="${attr(o.url)}"
                data-filter-media="${attr(o.mediaId)}" data-orig-url="${attr(
                  o.url,
                )}" data-filter-preset="${attr(filterPreset)}">
              ${selectControl}
              <div class="candidate-filter">
                <span class="candidate-filter-label">필터</span>
                <div class="candidate-filter-options" role="group" aria-label="이미지 필터">
                  ${filterButtons}
                </div>
                <button class="candidate-filter-compare" type="button" data-act="draft-filter-compare" aria-pressed="false"${
                  filterPreset === "none" ? " disabled" : ""
                }>누르고 원본 비교</button>
                <span class="candidate-filter-status" aria-live="polite"></span>
              </div>
            </article>`;
          })
          .join("")
      : `<div style="padding:6px 0;color:var(--color-neutral-600);font-style:italic">아직 후보가 없습니다.</div>`;
    bodyHtml = `<div class="candidate-grid">${candidates}</div>${regenBtn}`;
  }
  return `<div style="background:var(--color-neutral-100);padding:14px;margin-bottom:12px;border-radius:4px">
    ${header}
    ${sceneRow}
    ${referencesRow}
    ${bodyHtml}
  </div>`;
}

// 단계 타임라인 마크업 (순수 함수, 네트워크 비의존 — 테스트 대상).
// d = GET /api/drafts/:id 응답, characterName = 표시용 캐릭터명.
export function draftDetailMarkup(d, characterName, opts = {}) {
  const [sc, sl] = draftStatusMeta(d.status);
  const concept =
    d.conceptJson && typeof d.conceptJson === "object" ? d.conceptJson : {};
  const mode = concept.mode === "manual" ? "manual" : "auto";
  const [mc, ml] = draftModeMeta(mode);
  const source = concept.source;
  const sourceLabel =
    source === "manual" ? "운영자" : source === "scheduler" ? "스케줄러" : "—";
  const plan =
    concept.plan && typeof concept.plan === "object" ? concept.plan : null;
  const planInput =
    concept.planInput && typeof concept.planInput === "object"
      ? concept.planInput
      : null;
  const shots = Array.isArray(d.shots) ? d.shots : [];
  const planShots = Array.isArray(plan?.shots) ? plan.shots : [];

  // ── ① 초안 생성 (항상 완료) ──
  const stage1 = draftStage({
    num: 1,
    tone: "done",
    label: "① 초안 생성",
    statusMeta: ["tag-accent", "완료"],
    bodyHtml: `<div>
      ${draftMetaRow("장면 힌트", escapeHtml(concept.sceneHint || "—"))}
      ${draftMetaRow(
        "진행 방식",
        mode === "manual"
          ? "수동 — 단계별 버튼으로 진행"
          : "자동 — 워커가 끝까지 진행",
      )}
      ${draftMetaRow("출처", escapeHtml(sourceLabel))}
      ${draftMetaRow(
        "게시 예정",
        d.scheduledAt ? escapeHtml(fmtDateTime(d.scheduledAt)) : "승인 즉시",
      )}
    </div>`,
  });

  // ── ② 기획 · LLM ──
  let stage2;
  if (plan) {
    stage2 = draftStage({
      num: 2,
      tone: "done",
      label: "② 기획 · LLM",
      statusMeta: ["tag-accent", "완료"],
      bodyHtml: draftPlanBody(plan, planInput, concept.plannerName),
    });
  } else if (d.status === "planned") {
    stage2 = draftStage({
      num: 2,
      tone: "current",
      label: "② 기획 · LLM",
      statusMeta: ["tag-neutral", "대기"],
      actionHtml: `<button class="btn btn-primary" data-act="draft-plan-now" data-id="${attr(
        d.id,
      )}">지금 기획 실행</button>`,
      bodyHtml: `<p class="count-note" style="margin:0">페르소나·메모리·최근 게시물을 입력으로 LLM이 캡션과 컷 장면을 기획합니다.</p>`,
    });
  } else if (d.status === "generating") {
    stage2 = draftStage({
      num: 2,
      tone: "current",
      label: "② 기획 · LLM",
      statusMeta: ["tag-accent", "실행 중"],
      bodyHtml: `<p class="count-note" style="margin:0">기획(LLM)을 실행하는 중입니다…</p>`,
    });
  } else if (d.status === "failed") {
    stage2 = draftStage({
      num: 2,
      tone: "failed",
      label: "② 기획 · LLM",
      statusMeta: ["tag-accent-2", "실패"],
      bodyHtml: `<p class="count-note" style="margin:0">기획에 실패했습니다. ${escapeHtml(
        d.errorMessage || "",
      )}</p>`,
    });
  } else {
    stage2 = draftStage({
      num: 2,
      tone: "future",
      label: "② 기획 · LLM",
      statusMeta: ["tag-neutral", "대기"],
      bodyHtml: `<p class="count-note" style="margin:0">페르소나·메모리·최근 게시물을 입력으로 LLM이 캡션과 컷 장면을 기획합니다.</p>`,
    });
  }

  // ── ③ 이미지 생성 ──
  const shotCount = shots.length || planShots.length;
  const completedCount = shots.filter((s) => s.status === "completed").length;
  const hasActiveShot = shots.some((s) =>
    ["draft", "queued", "running"].includes(s.status),
  );
  const hasFailedShot = shots.some((s) => s.status === "failed");
  let stage3Tone;
  let stage3Status;
  if (shots.length && shots.every((s) => s.status === "completed")) {
    stage3Tone = "done";
    stage3Status = ["tag-accent", "완료"];
  } else if (shots.length === 0) {
    stage3Tone = plan ? "current" : "future";
    stage3Status = ["tag-neutral", "대기"];
  } else if (hasFailedShot && !hasActiveShot) {
    stage3Tone = "failed";
    stage3Status = ["tag-accent-2", `${completedCount}/${shotCount}`];
  } else {
    stage3Tone = "current";
    stage3Status = ["tag-accent", `${completedCount}/${shotCount} 완료`];
  }
  // 수동 모드: draft 상태 컷이 남아 있으면 프롬프트 빌드(재빌드) 버튼 노출.
  // 빌드 = 기획된 한국어 장면을 이미지 모델용 프롬프트로 변환하는 별도 스텝.
  const draftShots = shots.filter((s) => s.status === "draft");
  const buildAction =
    mode === "manual" && draftShots.length
      ? `<button class="btn btn-secondary" data-act="draft-build-prompts" data-id="${attr(
          d.id,
        )}">${
          draftShots.some((s) => !s.prompt)
            ? "프롬프트 빌드"
            : "프롬프트 다시 빌드"
        }</button>`
      : "";
  const stage3Action = buildAction;
  const builderNote = concept.builderName
    ? `<p class="count-note" style="margin:0 0 8px">빌더: ${escapeHtml(
        concept.builderName,
      )}</p>`
    : "";
  const stage3 = draftStage({
    num: 3,
    tone: stage3Tone,
    label: `③ 이미지 생성 — 컷 ${shotCount || "?"}`,
    statusMeta: stage3Status,
    actionHtml: stage3Action,
    bodyHtml: shots.length
      ? builderNote + shots.map((shot) => draftShotCard(d, shot)).join("")
      : `<p class="count-note" style="margin:0">기획이 완료되면 컷이 생성됩니다.</p>`,
  });

  // ── ④ 검수 · 승인 ──
  const reviewable = d.status === "needs_review";
  const editable = d.status === "needs_review" || d.status === "approved";
  const scheduledLocal = d.scheduledAt
    ? new Date(d.scheduledAt).toISOString().slice(0, 16)
    : "";
  let stage4Tone;
  let stage4Status;
  let stage4Action = "";
  const selectedShotCount = shots.filter((shot) =>
    (shot.outputs ?? []).some((output) => output.selected),
  ).length;
  const selectionComplete =
    shots.length > 0 && selectedShotCount === shots.length;
  if (reviewable) {
    stage4Tone = "current";
    stage4Status = ["tag-accent-2", "검수 필요"];
    stage4Action = `<button class="btn btn-primary" data-act="draft-approve" data-id="${attr(
      d.id,
    )}"${selectionComplete ? "" : ' disabled title="컷마다 게시 이미지를 선택하세요"'}>승인</button>
      <button class="btn btn-secondary" data-act="draft-reject" data-id="${attr(
        d.id,
      )}">반려</button>`;
  } else if (d.status === "approved" || d.status === "published") {
    stage4Tone = "done";
    stage4Status = ["tag-accent", "승인됨"];
  } else if (d.status === "rejected") {
    stage4Tone = "failed";
    stage4Status = ["tag-neutral", "반려됨"];
  } else if (
    (d.status === "generating" || d.status === "regenerating") &&
    shots.length > 0 &&
    shots.every((s) => s.status === "completed")
  ) {
    // 컷은 전부 완료됐지만 집계 전 — 워커 폴링을 기다리지 않고 버튼으로
    // 검수 단계로 넘길 수 있다 (수동 = 자동의 스텝 실행 모드).
    stage4Tone = "current";
    stage4Status = ["tag-accent-2", "집계 대기"];
    stage4Action = `<button class="btn btn-primary" data-act="draft-aggregate-now" data-id="${attr(
      d.id,
    )}">검수로 보내기</button>`;
  } else {
    stage4Tone = "future";
    stage4Status = ["tag-neutral", "대기"];
  }
  const selectionNote =
    reviewable && !selectionComplete
      ? `<p class="count-note review-readiness">게시 이미지 ${selectedShotCount}/${shots.length} 선택 · 컷마다 한 장을 선택하면 승인할 수 있습니다.</p>`
      : "";
  const stage4Body = editable
    ? `${selectionNote}<form data-action="draft-edit" data-draft-id="${attr(
        d.id,
      )}" style="display:flex;flex-direction:column;gap:12px">
        <div class="field" style="margin:0"><label>캡션</label><textarea class="input" name="caption" rows="3">${escapeHtml(
          d.caption,
        )}</textarea></div>
        <div class="field" style="margin:0"><label>해시태그 (쉼표 구분)</label><input class="input" name="hashtags" value="${attr(
          (d.hashtags ?? []).join(", "),
        )}"></div>
        <div class="field" style="margin:0"><label>게시 예정 (비우면 승인 즉시)</label><input class="input" type="datetime-local" name="scheduledAt" value="${attr(
          scheduledLocal,
        )}"></div>
        <div><button class="btn btn-secondary" type="submit">저장</button></div>
      </form>`
    : `<div>
        <div style="font-size:14px;margin-bottom:6px">${
          d.caption
            ? `“${escapeHtml(d.caption)}”`
            : `<span style="color:var(--color-neutral-500)">캡션 없음</span>`
        }</div>
        <div style="display:flex;flex-wrap:wrap">${(d.hashtags ?? [])
          .map(
            (t) =>
              `<span class="tag tag-neutral" style="margin:0 4px 4px 0">#${escapeHtml(
                t,
              )}</span>`,
          )
          .join("")}</div>
      </div>`;
  const stage4 = draftStage({
    num: 4,
    tone: stage4Tone,
    label: "④ 검수 · 승인",
    statusMeta: stage4Status,
    actionHtml: stage4Action,
    bodyHtml: stage4Body,
  });

  // ── ⑤ 게시 ──
  let stage5;
  if (d.status === "published") {
    stage5 = draftStage({
      num: 5,
      tone: "done",
      label: "⑤ 게시",
      statusMeta: ["tag-accent", "게시됨"],
      bodyHtml: `<div style="font-size:13px">게시됨 · post ${escapeHtml(
        d.publishedPostId || "—",
      )}</div>
        <p class="count-note" style="margin:6px 0 0">게시 시 캐릭터 메모리에 자동 역반영되었습니다.</p>`,
      last: true,
    });
  } else if (d.status === "approved") {
    stage5 = draftStage({
      num: 5,
      tone: "current",
      label: "⑤ 게시",
      statusMeta: ["tag-neutral", "게시 대기"],
      actionHtml: `<button class="btn btn-primary" data-act="draft-publish-now" data-id="${attr(
        d.id,
      )}">지금 게시</button>`,
      bodyHtml: `<p class="count-note" style="margin:0">예정 시각(${
        d.scheduledAt ? escapeHtml(fmtDateTime(d.scheduledAt)) : "승인 즉시"
      })과 무관하게 즉시 게시합니다.</p>`,
      last: true,
    });
  } else if (d.status === "rejected") {
    stage5 = draftStage({
      num: 5,
      tone: "failed",
      label: "⑤ 게시",
      statusMeta: ["tag-neutral", "반려됨"],
      bodyHtml: `<p class="count-note" style="margin:0">반려된 초안은 게시되지 않습니다.</p>`,
      last: true,
    });
  } else {
    stage5 = draftStage({
      num: 5,
      tone: "future",
      label: "⑤ 게시",
      statusMeta: ["tag-neutral", "대기"],
      bodyHtml: `<p class="count-note" style="margin:0">승인 후 게시할 수 있습니다.</p>`,
      last: true,
    });
  }

  return `
    <button class="btn btn-ghost" style="margin:0 0 18px -5px" data-act="back-drafts">← 초안 목록</button>
    <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:6px">
      <h2 style="font-size:28px;margin:0">${escapeHtml(characterName)}의 초안</h2>
      <span class="tag ${sc}">${escapeHtml(sl)}</span>
      <span class="tag ${mc}">${escapeHtml(ml)}</span>
    </div>
    <div style="font-size:12px;color:var(--color-neutral-500);margin-bottom:8px">시도 ${escapeHtml(
      d.attemptCount,
    )} · ${escapeHtml(d.contentType)} · 생성 ${escapeHtml(
      fmtDateTime(d.createdAt),
    )}</div>
    ${d.errorMessage ? noticeBlock(`오류: ${escapeHtml(d.errorMessage)}`) : ""}
    <div style="margin-top:14px;border-top:1px solid var(--color-divider)">
      ${stage1}${stage2}${stage3}${stage4}${stage5}
    </div>
    ${
      d.conceptJson
        ? `<details style="margin-top:22px"><summary style="cursor:pointer;font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;font-weight:600;color:var(--color-neutral-600)">원본 데이터 (conceptJson)</summary><pre style="margin-top:10px;padding:14px;background:var(--color-neutral-100);font-size:12px;overflow-x:auto;white-space:pre-wrap">${escapeHtml(
            JSON.stringify(d.conceptJson, null, 2),
          )}</pre></details>`
        : ""
    }
  `;
}

// 실시간 추적 — 터미널 상태가 아니면 3초 간격으로 폴링해, 워커·다른 탭·수동
// 실행이 만든 상태 변화를 즉시 반영한다. 렌더 파괴를 막는 두 가지 가드:
// (1) 파이프라인에 영향 주는 필드가 실제로 바뀌었을 때만 다시 그린다,
// (2) 운영자가 폼 입력 중이면 다시 그리지 않고 다음 틱으로 미룬다.
const DRAFT_POLL_TERMINAL = new Set(["published", "rejected"]);
const DRAFT_POLL_INTERVAL_MS = 3000;

// 리렌더 필요 여부 판정용 스냅샷 — 화면에 보이는 파이프라인 상태의 요약.
export function draftDetailSnapshot(d) {
  const shots = Array.isArray(d.shots) ? d.shots : [];
  return JSON.stringify({
    status: d.status,
    updatedAt: d.updatedAt,
    error: d.errorMessage ?? null,
    caption: d.caption,
    hashtags: d.hashtags ?? [],
    scheduledAt: d.scheduledAt ?? null,
    publishedPostId: d.publishedPostId ?? null,
    shots: shots.map((s) => [
      s.jobId,
      s.status,
      // 프롬프트 빌드(build-prompts)가 채운 프롬프트도 리렌더를 태운다.
      s.prompt ?? null,
      s.errorMessage ?? null,
      (s.outputs ?? []).map((o) => [o.mediaId, o.selected]),
    ]),
  });
}

// 운영자가 타임라인 안에서 입력 중인가 (프롬프트 수정 등).
function isEditingDraftDetail() {
  const active = document.activeElement;
  return (
    !!active &&
    /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) &&
    !!active.closest("#mainPanel")
  );
}

function scheduleDraftRefresh(d) {
  clearTimeout(ui.draftPollTimer);
  ui.draftPollTimer = 0;
  if (DRAFT_POLL_TERMINAL.has(d.status)) return;
  const snapshot = draftDetailSnapshot(d);
  ui.draftPollTimer = setTimeout(async () => {
    if (currentRoute() !== "drafts" || ui.selDraftId !== d.id) return;
    const res = await request(`/api/drafts/${d.id}`);
    if (currentRoute() !== "drafts" || ui.selDraftId !== d.id) return;
    const next = res.ok && res.body?.id ? res.body : null;
    if (
      next &&
      draftDetailSnapshot(next) !== snapshot &&
      !isEditingDraftDetail()
    ) {
      renderApp(); // 다시 그리면 renderDraftDetail이 폴링을 재설정한다.
      return;
    }
    // 변화 없음/입력 중/일시적 오류 — 기존 스냅샷 기준으로 계속 감시한다.
    scheduleDraftRefresh(d);
  }, DRAFT_POLL_INTERVAL_MS);
}

async function renderDraftDetail(id) {
  const res = await request(`/api/drafts/${id}`);
  const d = res.body;
  if (!res.ok || !d?.id) {
    return `<button class="btn btn-ghost" style="margin:0 0 18px -5px" data-act="back-drafts">← 초안 목록</button>
      ${noticeBlock("초안을 찾을 수 없습니다.")}`;
  }
  await loadCharacterOptions();
  const html = draftDetailMarkup(d, charName(d.characterId));
  // 반환 직전에 폴링 타이머를 (재)설정한다.
  scheduleDraftRefresh(d);
  return html;
}

// ── 이미지 필터 미리보기 ────────────────────────────────────────────────
// 후보별 필터 이미지를 서버 후보정본(blob)으로 바꿔치기한다. 결정적 연산이라
// 미디어·프리셋당 한 번만 받아 object URL로 캐시한다. 저장 데이터는
// 건드리지 않는다 — 게시 시 워커가 같은 연산으로 마감본을 만든다.

const filmPreviewCache = new Map(); // "preset:mediaId" → object URL
const filmPreviewPending = new Map(); // "preset:mediaId" → Promise<object URL | "">

async function filmPreviewObjectUrl(mediaId, preset) {
  if (!mediaId || !preset || preset === "none") return "";
  const key = `${preset}:${mediaId}`;
  if (filmPreviewCache.has(key)) return filmPreviewCache.get(key);
  if (!filmPreviewPending.has(key)) {
    const pending = (async () => {
      try {
        const response = await fetch(
          `/api/media/${mediaId}/film-finish?preset=${encodeURIComponent(preset)}`,
          adminRequestOptions({}, readAdminToken()),
        );
        if (!response.ok) {
          throw new Error(`finish request failed (${response.status})`);
        }
        const url = URL.createObjectURL(await response.blob());
        filmPreviewCache.set(key, url);
        return url;
      } catch (error) {
        console.error(`${LOG_PREFIX} finish preview failed:`, error);
        return "";
      } finally {
        filmPreviewPending.delete(key);
      }
    })();
    filmPreviewPending.set(key, pending);
  }
  return filmPreviewPending.get(key);
}

async function applyCandidateFilter(img) {
  const preset = img.dataset.filterPreset || "none";
  const orig = img.dataset.origUrl || "";
  if (preset === "none") {
    if (orig) {
      img.src = orig;
      img.dataset.url = orig;
    }
    img.dataset.filteredUrl = "";
    img.style.opacity = "";
    return true;
  }
  img.style.opacity = "0.45";
  const url = await filmPreviewObjectUrl(img.dataset.filterMedia, preset);
  img.style.opacity = "";
  if (!url || !img.isConnected || img.dataset.filterPreset !== preset) {
    return false;
  }
  img.src = url;
  img.dataset.url = url;
  img.dataset.filteredUrl = url;
  return true;
}

// 렌더 직후 후보별 저장 필터를 적용한다. 라이트박스도 같은 판을 사용한다.
async function applyDraftFilters() {
  if (!hasDocument) return;
  const imgs = Array.from(document.querySelectorAll("img[data-filter-media]"));
  if (!imgs.length) return;
  await Promise.all(imgs.map((img) => applyCandidateFilter(img)));
}

function filterCompareControl(event) {
  return event.target.closest?.("[data-act='draft-filter-compare']");
}

function showCandidateOriginal(control, show) {
  if (!control || control.disabled) return;
  const img = control
    .closest("[data-filter-media]")
    ?.querySelector("img[data-filter-media]");
  if (!img) return;
  control.setAttribute("aria-pressed", String(show));
  if (show) {
    const orig = img.dataset.origUrl || "";
    if (orig) {
      img.src = orig;
      img.dataset.url = orig;
    }
    return;
  }
  const filtered = img.dataset.filteredUrl || "";
  if (filtered) {
    img.src = filtered;
    img.dataset.url = filtered;
  } else {
    void applyCandidateFilter(img);
  }
}

function handleFilterCompareStart(event) {
  const control = filterCompareControl(event);
  if (!control) return;
  event.preventDefault();
  ui.filterCompareControl = control;
  showCandidateOriginal(control, true);
}

function handleFilterCompareEnd(event) {
  const control = filterCompareControl(event) || ui.filterCompareControl;
  if (!control) return;
  showCandidateOriginal(control, false);
  ui.filterCompareControl = null;
}

function handleFilterCompareKeyDown(event) {
  if (event.key !== " " && event.key !== "Enter") return;
  handleFilterCompareStart(event);
}

function handleFilterCompareKeyUp(event) {
  if (event.key !== " " && event.key !== "Enter") return;
  handleFilterCompareEnd(event);
}

// ── 사용자 ────────────────────────────────────────────────────────────────

async function renderUsers() {
  if (ui.selUserId) {
    return renderUserDetail(ui.selUserId);
  }
  const res = await request(endpoint("/api/users", { limit: 50 }));
  const users = itemsFromPage(res.body);
  for (const u of users) {
    ui.cache.userLabels.set(u.id, u.email || u.displayName || u.id);
  }
  const rows = users.length
    ? users
        .map((u) => {
          const haystack =
            `${u.email ?? ""} ${u.displayName ?? ""}`.toLowerCase();
          const { followCount, creditBalance } = adminUserStats(u);
          return `<tr class="clickable user-row" data-search="${attr(
            haystack,
          )}" data-act="select-user" data-id="${attr(u.id)}">
            <td style="font-weight:600">${escapeHtml(u.email ?? "—")}</td>
            <td>${escapeHtml(u.displayName ?? "—")}</td>
            <td style="color:var(--color-neutral-600);font-size:12.5px">${fmtDate(
              u.createdAt,
            )}</td>
            <td style="text-align:right;font-variant-numeric:tabular-nums">${followCount}</td>
            <td style="text-align:right;font-variant-numeric:tabular-nums">${creditBalance.toLocaleString()}</td>
          </tr>`;
        })
        .join("")
    : `<tr class="empty-row"><td colspan="5">조건에 맞는 사용자가 없습니다.</td></tr>`;

  return `
    ${sectionHead(
      "사용자",
      "사람 사용자 조회 — 크레딧 지급과 운영 지원 시 ID 확인",
    )}
    <div class="toolbar">
      <input class="input" style="max-width:300px" placeholder="이메일, 닉네임 검색" data-filter-input=".user-row" />
      <span class="count-note">${users.length}건</span>
    </div>
    <table class="table">
      <thead><tr><th>이메일</th><th>닉네임</th><th>가입</th><th style="text-align:right">팔로우</th><th style="text-align:right">크레딧 잔액</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

async function renderUserDetail(id) {
  const [userRes, ledgerRes, eventsRes] = await Promise.all([
    request(`/api/users/${id}`),
    request(endpoint("/api/credits/ledger", { userId: id, limit: 30 })),
    request(endpoint("/api/events", { userId: id, limit: 20 })),
  ]);
  const u = userRes.body;
  if (!userRes.ok || !u?.id) {
    return `<button class="btn btn-ghost" style="margin:0 0 14px -5px" data-act="back-users">← 사용자 목록</button>${noticeBlock(
      "사용자를 찾을 수 없습니다.",
    )}`;
  }
  ui.cache.userLabels.set(u.id, u.email || u.displayName || u.id);
  const ledger = itemsFromPage(ledgerRes.body);
  const events = itemsFromPage(eventsRes.body);
  const { followCount, creditBalance } = adminUserStats(u);

  const ledgerRows = ledger.length
    ? ledger
        .map(
          (e) =>
            `<tr><td><span class="tag ${
              e.entryType === "grant" ? "tag-accent" : "tag-accent-2"
            }">${escapeHtml(
              e.entryType,
            )}</span></td><td style="font-weight:600;text-align:right;font-variant-numeric:tabular-nums">${
              e.amount > 0 ? "+" : ""
            }${escapeHtml(e.amount)}</td><td>${escapeHtml(
              e.reason,
            )}</td><td style="color:var(--color-neutral-600)">${escapeHtml(
              e.externalReference ?? "",
            )}</td><td style="color:var(--color-neutral-600);font-size:12.5px">${fmtDateTime(
              e.createdAt,
            )}</td></tr>`,
        )
        .join("")
    : `<tr class="empty-row"><td colspan="5">크레딧 내역이 없습니다.</td></tr>`;

  const eventRows = events.length
    ? events
        .map(
          (ev) =>
            `<div style="display:flex;justify-content:space-between;align-items:baseline;padding:9px 0;border-bottom:1px solid var(--color-divider);gap:12px"><span><span class="tag tag-neutral" style="margin-right:8px">${escapeHtml(
              ev.eventType,
            )}</span>${escapeHtml(ev.targetType ?? "")} · ${escapeHtml(
              ev.targetId ?? "",
            )}</span><span style="color:var(--color-neutral-500);font-size:11px;flex:none">${fmtDateTime(
              ev.createdAt,
            )}</span></div>`,
        )
        .join("")
    : `<div style="padding:9px 0;color:var(--color-neutral-600);font-style:italic">이벤트가 없습니다.</div>`;

  return `
    <button class="btn btn-ghost" style="margin:0 0 14px -5px" data-act="back-users">← 사용자 목록</button>
    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:22px">
      <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap">
        <h2 style="font-size:30px;margin:0">${escapeHtml(u.displayName ?? "—")}</h2>
        <span style="font-size:13px;color:var(--color-neutral-600)">${escapeHtml(
          u.email ?? "이메일 없음",
        )}</span>
      </div>
      <button class="btn btn-primary" data-act="open-dialog" data-dialog="grant" data-user="${attr(
        u.id,
      )}">크레딧 지급</button>
    </div>
    <div style="display:flex;gap:48px;margin-bottom:28px;font-size:13.5px">
      <div><div class="stat-label">가입</div>${fmtDate(u.createdAt)}</div>
      <div><div class="stat-label">팔로우</div><span class="stat-value" style="font-size:18px">${followCount}</span></div>
      <div><div class="stat-label">크레딧 잔액</div><span class="stat-value" style="font-size:18px">${creditBalance}</span></div>
      <div><div class="stat-label">원장 항목</div>${ledger.length}건</div>
    </div>
    <h6 style="color:var(--color-neutral-600)">크레딧 원장 — GET /api/credits/ledger?userId=</h6>
    <table class="table" style="margin-bottom:34px">
      <thead><tr><th>구분</th><th style="text-align:right">금액</th><th>사유</th><th>외부 참조</th><th>시각</th></tr></thead>
      <tbody>${ledgerRows}</tbody>
    </table>
    <h6 style="color:var(--color-neutral-600)">최근 이벤트 — GET /api/events?userId=</h6>
    <div style="font-size:14px;max-width:620px">${eventRows}</div>`;
}

// ── 크레딧 ────────────────────────────────────────────────────────────────

async function renderCredits() {
  const users = await loadUserOptions();
  const ledgerUserId = ui.ledgerUserId;
  const res = await request(
    endpoint("/api/credits/ledger", { userId: ledgerUserId, limit: 30 }),
  );
  const ledger = itemsFromPage(res.body);
  const ledgerRows = ledger.length
    ? ledger
        .map(
          (e) =>
            `<tr><td>${escapeHtml(userLabel(e.userId))}</td><td><span class="tag ${
              e.entryType === "grant" ? "tag-accent" : "tag-accent-2"
            }">${escapeHtml(
              e.entryType,
            )}</span></td><td style="font-weight:600;text-align:right;font-variant-numeric:tabular-nums">${
              e.amount > 0 ? "+" : ""
            }${escapeHtml(e.amount)}</td><td>${escapeHtml(
              e.reason,
            )}</td><td style="color:var(--color-neutral-600);font-size:12.5px">${fmtDateTime(
              e.createdAt,
            )}</td></tr>`,
        )
        .join("")
    : `<tr class="empty-row"><td colspan="5">표시할 원장 내역이 없습니다.</td></tr>`;

  const userOpts = optionList(
    users,
    "id",
    (u) => u.email || u.displayName || u.id,
    ledgerUserId,
  );

  return `
    ${sectionHead("크레딧", "운영 지급(grant)과 전체 원장 조회")}
    <div style="display:grid;grid-template-columns:320px 1fr;gap:48px;align-items:start">
      <form data-action="credit-grant-full" style="display:flex;flex-direction:column;gap:12px">
        <h6 style="color:var(--color-neutral-600);margin:0">크레딧 지급 — POST /api/credits/grants</h6>
        <div class="field"><label>사용자</label>
          <select class="input" name="userId">${optionList(
            users,
            "id",
            (u) => u.email || u.displayName || u.id,
            ledgerUserId,
          )}</select>
        </div>
        <div class="field"><label>금액</label><input class="input" name="amount" type="number" min="1" step="1" required placeholder="100">
          <div style="display:flex;gap:6px;margin-top:6px">
            <button class="btn btn-ghost" type="button" data-act="preset-amount" data-amt="100">+100</button>
            <button class="btn btn-ghost" type="button" data-act="preset-amount" data-amt="500">+500</button>
            <button class="btn btn-ghost" type="button" data-act="preset-amount" data-amt="1000">+1,000</button>
          </div>
        </div>
        <div class="field"><label>사유</label><input class="input" name="reason" required placeholder="admin grant"></div>
        <div class="field"><label>외부 참조 (선택)</label><input class="input" name="externalReference" placeholder="manual-001"></div>
        <div><button class="btn btn-primary" type="submit">지급</button></div>
      </form>
      <div>
        <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px;gap:12px">
          <h6 style="color:var(--color-neutral-600);margin:0">원장</h6>
          <select class="input" style="max-width:220px;min-height:32px" data-select="ledger-user"><option value="">전체 사용자</option>${userOpts}</select>
        </div>
        <table class="table">
          <thead><tr><th>사용자</th><th>구분</th><th style="text-align:right">금액</th><th>사유</th><th>시각</th></tr></thead>
          <tbody>${ledgerRows}</tbody>
        </table>
      </div>
    </div>`;
}

// ── 결제 정산 ──────────────────────────────────────────────────────────────

async function renderPayments() {
  const statusParam =
    ui.filters.payStatus === "전체" ? "" : ui.filters.payStatus;
  const res = await request(
    endpoint("/api/payments/reconciliation", { status: statusParam }),
  );
  const rows = itemsFromPage(res.body);
  await ensureUserLabels(rows.map((p) => p.userId));

  const body = rows.length
    ? rows
        .map((p) => {
          const flagged = Boolean(p.reason);
          return `<tr class="clickable" style="${
            flagged ? "box-shadow:inset 3px 0 0 var(--color-accent-2)" : ""
          }" data-act="select-payment" data-id="${attr(p.paymentId)}">
            <td style="font-weight:600">${escapeHtml(
              String(p.paymentId).slice(0, 8),
            )}</td>
            <td>${escapeHtml(userLabel(p.userId))}</td>
            <td>${escapeHtml(p.provider)}</td>
            <td><span class="tag ${providerStatusClass(
              p.providerStatus,
            )}">${escapeHtml(p.providerStatus)}</span></td>
            <td><span class="tag ${ledgerStatusClass(
              p.ledgerStatus,
            )}">${escapeHtml(p.ledgerStatus)}</span></td>
            <td style="color:var(--color-neutral-700);font-size:13px">${escapeHtml(
              p.reason ?? "",
            )}</td>
          </tr>`;
        })
        .join("")
    : `<tr class="empty-row"><td colspan="6">조건에 맞는 결제가 없습니다.</td></tr>`;
  let detail = "";
  if (ui.selPayId) {
    const detailRes = await request(paymentDetailRequest(ui.selPayId));
    const payment = detailRes.body;
    if (detailRes.ok && payment?.id) {
      await ensureUserLabels([payment.userId]);
      detail = `
        <div style="margin-top:32px;max-width:560px">
          <h6 style="color:var(--color-neutral-600)">결제 상세 — GET /api/payments/:id</h6>
          <div style="display:flex;align-items:baseline;gap:12px;margin:6px 0 14px">
            <h3 style="font-size:22px;margin:0">${escapeHtml(String(payment.id).slice(0, 12))}</h3>
            <span class="tag ${providerStatusClass(payment.status)}">${escapeHtml(payment.status)}</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px 32px;font-size:13.5px">
            <div><div class="stat-label">사용자</div>${escapeHtml(userLabel(payment.userId))}</div>
            <div><div class="stat-label">금액</div>${escapeHtml(payment.paidAmount)} ${escapeHtml(payment.currency ?? "")}</div>
            <div><div class="stat-label">지급 크레딧</div>${escapeHtml(payment.creditAmount)}</div>
            <div><div class="stat-label">결제 시각</div>${fmtDateTime(payment.createdAt)}</div>
            <div style="grid-column:1/-1"><div class="stat-label">원장 반영</div>${escapeHtml(rows.find((row) => row.paymentId === payment.id)?.ledgerStatus ?? "—")}</div>
          </div>
        </div>`;
    }
  }

  return `
    ${sectionHead(
      "결제 정산",
      "결제 provider 상태와 크레딧 원장 반영 상태 비교 — 불일치를 먼저 처리",
    )}
    <div class="toolbar">
      ${segControl(
        "payStatus",
        [
          { value: "전체", label: "전체" },
          { value: "mismatch", label: "mismatch" },
          { value: "pending", label: "pending" },
          { value: "resolved", label: "resolved" },
        ],
        ui.filters.payStatus,
      )}
    </div>
    <table class="table">
      <thead><tr><th>결제 ID</th><th>사용자</th><th>Provider</th><th>Provider 상태</th><th>원장 상태</th><th>비고</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
    ${detail}`;
}

// ── 신고 처리 ──────────────────────────────────────────────────────────────

async function renderModeration() {
  const statusParam =
    ui.filters.reportStatus === "전체" ? "" : ui.filters.reportStatus;
  const res = await request(
    endpoint("/api/moderation/reports", { status: statusParam, limit: 50 }),
  );
  const reports = itemsFromPage(res.body);
  await ensureUserLabels(reports.map((r) => r.reporterUserId));

  const rows = reports.length
    ? reports
        .map((r) => {
          const [cls, label] = reportStatusMeta(r.status);
          const open = r.status === "submitted" || r.status === "reviewing";
          return `<tr>
            <td style="font-weight:600">${escapeHtml(r.targetType)} · ${escapeHtml(
              String(r.targetId).slice(0, 8),
            )}</td>
            <td>${escapeHtml(userLabel(r.reporterUserId))}</td>
            <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${attr(
              r.reason,
            )}">${escapeHtml(r.reason)}</td>
            <td style="color:var(--color-neutral-600);font-size:12.5px">${fmtDateTime(
              r.createdAt,
            )}</td>
            <td><span class="tag ${cls}">${escapeHtml(label)}</span></td>
            <td style="white-space:nowrap">${
              open
                ? `<button class="btn btn-ghost" data-act="report-action" data-id="${attr(
                    r.id,
                  )}" data-status="resolved">조치 완료</button>
                   <button class="btn btn-ghost" style="color:var(--color-accent-2-700)" data-act="report-action" data-id="${attr(
                     r.id,
                   )}" data-status="rejected">기각</button>`
                : ""
            }</td>
          </tr>`;
        })
        .join("")
    : `<tr class="empty-row"><td colspan="6">조건에 맞는 신고가 없습니다.</td></tr>`;

  return `
    ${sectionHead(
      "신고 처리",
      "사용자 신고 검토 — 미처리 건을 확인하고 조치 또는 기각",
    )}
    <div class="toolbar">
      ${segControl(
        "reportStatus",
        [
          { value: "전체", label: "전체" },
          { value: "submitted", label: "접수됨" },
          { value: "reviewing", label: "검토 중" },
          { value: "resolved", label: "완료" },
          { value: "rejected", label: "기각" },
        ],
        ui.filters.reportStatus,
      )}
    </div>
    <table class="table">
      <thead><tr><th>대상</th><th>신고자</th><th>사유</th><th>접수</th><th>상태</th><th style="width:180px"></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ── 이벤트 · 선호 ─────────────────────────────────────────────────────────

async function renderEvents() {
  const users = await loadUserOptions();
  const userId = ui.eventUserId;
  const [evRes, prefRes] = await Promise.all([
    request(endpoint("/api/events", { userId, limit: 30 })),
    request(endpoint("/api/hashtag-preferences", { userId })),
  ]);
  const events = itemsFromPage(evRes.body);
  const prefs = itemsFromPage(prefRes.body);
  const eventRows = events.length
    ? events
        .map(
          (e) =>
            `<tr><td>${escapeHtml(userLabel(e.userId))}</td><td><span class="tag tag-neutral">${escapeHtml(
              e.eventType,
            )}</span></td><td style="color:var(--color-neutral-700)">${escapeHtml(
              e.targetType ?? "",
            )} · ${escapeHtml(
              e.targetId ?? "",
            )}</td><td style="color:var(--color-neutral-600);font-size:12.5px">${fmtDateTime(
              e.createdAt,
            )}</td></tr>`,
        )
        .join("")
    : `<tr class="empty-row"><td colspan="4">선택한 사용자의 이벤트가 없습니다.</td></tr>`;
  const prefRows = prefs.length
    ? prefs
        .map(
          (p) =>
            `<div style="display:flex;justify-content:space-between;align-items:baseline;padding:9px 0;border-bottom:1px solid var(--color-divider)"><span><span style="color:var(--color-neutral-600);font-size:12px;margin-right:8px">${escapeHtml(userLabel(p.userId))}</span><span style="color:var(--color-accent-700)">#${escapeHtml(
              p.hashtag,
            )}</span></span><span style="font-family:var(--font-heading);font-weight:600">${escapeHtml(
              typeof p.score === "number" ? p.score.toFixed(2) : p.score,
            )}</span></div>`,
        )
        .join("")
    : `<div style="padding:9px 0;color:var(--color-neutral-600);font-style:italic">학습된 선호가 없습니다.</div>`;

  return `
    ${sectionHead(
      "이벤트 · 해시태그 선호",
      "추천 피드 랭킹에 쓰이는 사용자 이벤트와 학습된 해시태그 선호 확인",
    )}
    <select class="input" style="max-width:240px;margin-bottom:16px;min-height:34px" data-select="event-user"><option value="">전체 사용자</option>${optionList(
      users,
      "id",
      (u) => u.email || u.displayName || u.id,
      userId,
    )}</select>
    <div style="display:grid;grid-template-columns:1fr 340px;gap:48px;align-items:start">
      <div>
        <h6 style="color:var(--color-neutral-600)">사용자 이벤트 — GET /api/events</h6>
        <table class="table">
          <thead><tr><th>사용자</th><th>이벤트</th><th>대상</th><th>시각</th></tr></thead>
          <tbody>${eventRows}</tbody>
        </table>
      </div>
      <div>
        <h6 style="color:var(--color-neutral-600)">해시태그 선호 — GET /api/hashtag-preferences</h6>
        <div style="font-size:14px">${prefRows}</div>
      </div>
    </div>`;
}

// ── 액션 로그 ──────────────────────────────────────────────────────────────

async function renderLogs() {
  const [logsRes] = await Promise.all([
    request("/api/character-action-logs"),
    ui.cache.charNames.size ? Promise.resolve() : loadCharacterOptions(),
  ]);
  const logs = itemsFromPage(logsRes.body);
  const rows = logs.length
    ? logs
        .map(
          (l) =>
            `<tr>
              <td><span class="tag ${logTagClass(l.actionType)}">${escapeHtml(
                l.actionType,
              )}</span></td>
              <td style="font-weight:600">${escapeHtml(charName(l.characterId))}</td>
              <td style="color:var(--color-neutral-700)">${escapeHtml(
                l.targetTable ?? "",
              )}${l.targetId ? ` · ${escapeHtml(String(l.targetId).slice(0, 8))}` : ""}</td>
              <td style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${attr(
                l.reason,
              )}">${escapeHtml(l.reason)}</td>
              <td style="color:var(--color-neutral-600);font-size:12.5px">${fmtDateTime(
                l.createdAt,
              )}</td>
            </tr>`,
        )
        .join("")
    : `<tr class="empty-row"><td colspan="5">기록된 액션이 없습니다.</td></tr>`;

  return `
    ${sectionHead(
      "액션 로그",
      "캐릭터 생성·게시·생성 job 등 운영/자동화 행동 기록 — 최신 50건",
    )}
    <table class="table">
      <thead><tr><th>액션</th><th>캐릭터</th><th>대상</th><th>사유</th><th>시각</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ── 분석 ──────────────────────────────────────────────────────────────────

async function renderAnalytics() {
  const period = ui.filters.analyticsPeriod;
  const [metricsPath, hashtagsPath] = analyticsRequests(period);
  const [metricsRes, hashtagsRes] = await Promise.all([
    request(metricsPath),
    request(hashtagsPath),
  ]);
  const metrics = Array.isArray(metricsRes.body?.metrics)
    ? metricsRes.body.metrics
    : [];
  const hashtags = itemsFromPage(hashtagsRes.body);
  const metricNotes = {
    "events.count": `${period} 사용자 행동`,
    "messages.count": "1:1 대화 수",
    "credits.granted": "운영·결제 지급",
    "credits.debited": "AI 기능 사용",
    "generation_jobs.count": "이미지·영상 생성",
  };
  const cards = metrics.length
    ? metrics
        .slice(0, 4)
        .map(
          (m) => `
      <div>
        <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--color-neutral-600);margin-bottom:20px">${escapeHtml(
          analyticsLabel(m.name),
        )}</div>
        <span style="display:inline-block;font-family:var(--font-heading);font-weight:600;font-size:52px;font-variant-numeric:tabular-nums">${escapeHtml(
          Number(m.value).toLocaleString(),
        )}</span>
        <div style="font-size:12.5px;color:var(--color-neutral-700);margin-top:10px">${escapeHtml(metricNotes[m.name] ?? period)}</div>
      </div>`,
        )
        .join("")
    : `<p class="text-muted">지표를 불러올 수 없습니다.</p>`;
  const hashtagRows = hashtags.length
    ? hashtags
        .map(
          (
            item,
          ) => `<div style="display:flex;justify-content:space-between;align-items:baseline;padding:9px 0;border-bottom:1px solid var(--color-divider);font-size:14.5px">
            <span style="color:var(--color-accent-700)">#${escapeHtml(
              item.hashtag,
            )}</span>
            <span style="font-family:var(--font-heading);font-weight:600">${escapeHtml(Number(item.postCount ?? 0).toLocaleString())}</span>
          </div>`,
        )
        .join("")
    : `<div style="padding:9px 0;color:var(--color-neutral-600);font-style:italic">집계된 해시태그가 없습니다.</div>`;

  return `
    <div class="section-head" style="margin-bottom:36px">
      <div><h2>분석</h2><p class="section-sub">서비스 핵심 지표 — GET /api/analytics</p></div>
      ${segControl(
        "analyticsPeriod",
        [
          { value: "7일", label: "7일" },
          { value: "30일", label: "30일" },
        ],
        period,
      )}
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:32px;margin-bottom:48px">${cards}</div>
    <div style="max-width:480px">
      <h6 style="color:var(--color-neutral-600)">상위 해시태그</h6>
      ${hashtagRows}
    </div>`;
}

// — helper: fill user label cache for a set of ids —

async function ensureUserLabels(ids) {
  const missing = [
    ...new Set(ids.filter((id) => id && !ui.cache.userLabels.has(id))),
  ];
  if (!missing.length) return;
  // A single list fetch is cheaper than N detail fetches; labels for ids not
  // in the first page simply fall back to a shortened id.
  await loadUserOptions();
}

// ═════════════════════════════════════════════════════════════════════════
// Dialogs
// ═════════════════════════════════════════════════════════════════════════

let dialogState = null;
let postMediaPreviewUrls = [];

function clearPostMediaPreviewUrls() {
  for (const url of postMediaPreviewUrls) URL.revokeObjectURL(url);
  postMediaPreviewUrls = [];
}

export function postMediaSelectionItem(file, index, url) {
  const preview =
    mediaTypeForFile(file) === "image"
      ? `<img src="${attr(url)}" alt="">`
      : `<video src="${attr(url)}" muted></video>`;
  const fileName = String(file?.name ?? "file");
  return `<div class="post-media-selection-item">${preview}<div><strong>${escapeHtml(
    fileName,
  )}</strong><span>${escapeHtml(
    mediaTypeForFile(file),
  )}</span></div><button type="button" class="btn btn-ghost" data-act="remove-post-media" data-index="${index}" aria-label="${attr(
    `${fileName} 제거`,
  )}">제거</button></div>`;
}

function renderPostMediaSelection() {
  const root = dialogRoot?.querySelector("[data-post-media-list]");
  if (!root || dialogState?.type !== "new-post") return;
  clearPostMediaPreviewUrls();
  postMediaPreviewUrls = dialogState.mediaFiles.map((file) =>
    URL.createObjectURL(file),
  );
  root.innerHTML = dialogState.mediaFiles
    .map((file, index) =>
      postMediaSelectionItem(file, index, postMediaPreviewUrls[index]),
    )
    .join("");
}

async function openDialog(type, ctx = {}) {
  dialogState = {
    type,
    ctx,
    ...(type === "new-post" ? { mediaFiles: [], submissionLocked: false } : {}),
  };
  // Some dialogs need character/user option lists.
  if (type === "new-post" || type === "comment" || type === "reaction") {
    ctx.characters = await loadCharacterOptions();
  }
  if (type === "new-job") {
    ctx.characters = await loadCharacterOptions();
  }
  if (type === "grant") {
    ctx.users = await loadUserOptions();
  }
  paintDialog();
  renderPostMediaSelection();
}

function closeDialog(session = dialogState, action = "close") {
  if (
    !session ||
    dialogState !== session ||
    !dialogSessionAllows(session, action)
  ) {
    return false;
  }
  clearPostMediaPreviewUrls();
  dialogState = null;
  if (dialogRoot) dialogRoot.innerHTML = "";
  return true;
}

function paintDialog() {
  if (!dialogRoot || !dialogState) return;
  dialogRoot.innerHTML = `<div class="dialog-backdrop" data-act="dialog-backdrop"><div class="dialog" role="dialog" aria-modal="true">${dialogBody(
    dialogState,
  )}</div></div>`;
  const first = dialogRoot.querySelector("input, textarea, select");
  if (first) setTimeout(() => first.focus(), 40);
}

// 이미지 라이트박스 — 후보/레퍼런스 이미지를 크게 본다. 폼 세션(dialog)과
// 분리된 가벼운 오버레이. 배경/닫기/Esc로 닫는다.
let lightboxUrl = null;

function lightboxRootEl() {
  let el = document.getElementById("lightboxRoot");
  if (!el) {
    el = document.createElement("div");
    el.id = "lightboxRoot";
    document.body.appendChild(el);
  }
  return el;
}

function paintLightbox() {
  const root = lightboxRootEl();
  root.innerHTML = lightboxUrl
    ? `<div class="lightbox-backdrop" data-act="lightbox-backdrop">
        <button class="lightbox-close" type="button" data-act="lightbox-backdrop" aria-label="닫기">×</button>
        <img class="lightbox-img" src="${attr(lightboxUrl)}" alt="확대 이미지">
      </div>`
    : "";
}

function openLightbox(url) {
  lightboxUrl = url;
  paintLightbox();
}

function closeLightbox() {
  if (!lightboxUrl) return false;
  lightboxUrl = null;
  paintLightbox();
  return true;
}

function charSelect(name, characters, selected = "") {
  return `<select class="input" name="${name}">${optionList(
    characters ?? [],
    "id",
    (c) => `${c.displayName || c.publicId} (@${c.publicId})`,
    selected,
  )}</select>`;
}

export function dialogBody({ type, ctx }) {
  if (type === "new-char") {
    return `<div class="dialog-title">새 캐릭터</div>
      <form data-action="dlg-new-char" style="display:flex;flex-direction:column;gap:12px">
        <div class="field"><label>공개 ID</label><input class="input" name="publicId" required placeholder="arin"></div>
        <div class="field"><label>표시 이름</label><input class="input" name="displayName" required></div>
        <div class="field"><label>Bio</label><input class="input" name="bio" required></div>
        <div class="field"><label>관심사 (쉼표 구분)</label><input class="input" name="interests" placeholder="art, travel"></div>
        <div class="field"><label>페르소나</label><textarea class="input" name="persona" placeholder="말투 · 성격 · 세계관 설정" required></textarea></div>
        <div class="field"><label>초기 기억 (선택, 한 줄에 하나씩)</label><textarea class="input" name="memories" placeholder="한강 야경 촬영을 좋아함&#10;필름 현상소 단골"></textarea></div>
        <div class="dialog-actions"><button class="btn btn-secondary" type="button" data-act="close-dialog">취소</button><button class="btn btn-primary" type="submit">생성</button></div>
      </form>`;
  }
  if (type === "new-post") {
    return `<div class="dialog-title">새 게시물</div>
      <form data-action="dlg-new-post" style="display:flex;flex-direction:column;gap:12px">
        <div class="field"><label>작성 캐릭터</label>${charSelect(
          "actorId",
          ctx.characters,
          ctx.actor,
        )}</div>
        <div class="field"><label>본문</label><textarea class="input" name="content" required></textarea></div>
        <div class="field"><label>해시태그 (쉼표 구분)</label><input class="input" name="hashtags" placeholder="film, night"></div>
        <div class="field"><label>로그 이유</label><input class="input" name="reason" required placeholder="film mood board"></div>
        <div class="field">
          <label>미디어</label>
          <input
            class="media-file-input"
            id="postMediaFiles"
            name="mediaFiles"
            type="file"
            accept="image/*,video/*"
            multiple
            data-post-media-input
          >
          <label class="media-dropzone" data-post-media-dropzone for="postMediaFiles">
            <span class="media-dropzone-title">이미지 또는 영상을 드래그하세요</span>
            <span class="media-dropzone-copy">여러 파일 선택 가능 · 클릭해서 찾아보기</span>
          </label>
          <div class="post-media-selection" data-post-media-list></div>
        </div>
        <div class="dialog-actions"><button class="btn btn-secondary" type="button" data-act="close-dialog">취소</button><button class="btn btn-primary" type="submit">게시</button></div>
      </form>`;
  }
  if (type === "comment") {
    return `<div class="dialog-title">캐릭터 명의 댓글</div>
      <div class="dialog-body" style="margin:0">대상 게시물: ${escapeHtml(ctx.postId)}</div>
      <form data-action="dlg-comment" data-post-id="${attr(ctx.postId)}" style="display:flex;flex-direction:column;gap:12px">
        <div class="field"><label>댓글 작성 캐릭터</label>${charSelect(
          "characterId",
          ctx.characters,
        )}</div>
        <div class="field"><label>내용</label><textarea class="input" name="body" required></textarea></div>
        <div class="field"><label>로그 이유</label><input class="input" name="reason"></div>
        <div class="dialog-actions"><button class="btn btn-secondary" type="button" data-act="close-dialog">취소</button><button class="btn btn-primary" type="submit">댓글 생성</button></div>
      </form>`;
  }
  if (type === "reaction") {
    return `<div class="dialog-title">캐릭터 명의 반응</div>
      <div class="dialog-body" style="margin:0">대상 게시물: ${escapeHtml(ctx.postId)}</div>
      <form data-action="dlg-reaction" data-post-id="${attr(ctx.postId)}" style="display:flex;flex-direction:column;gap:12px">
        <div class="field"><label>반응 캐릭터</label>${charSelect(
          "characterId",
          ctx.characters,
        )}</div>
        <div class="field"><label>반응 타입</label><select class="input" name="reactionType"><option value="like">like</option></select></div>
        <div class="field"><label>로그 이유</label><input class="input" name="reason"></div>
        <div class="dialog-actions"><button class="btn btn-secondary" type="button" data-act="close-dialog">취소</button><button class="btn btn-primary" type="submit">반응 생성</button></div>
      </form>`;
  }
  if (type === "new-job") {
    return `<div class="dialog-title">생성 작업 큐 등록</div>
      <form data-action="dlg-new-job" style="display:flex;flex-direction:column;gap:12px">
        <div class="field"><label>캐릭터</label>${charSelect(
          "characterId",
          ctx.characters,
          ctx.char,
        )}</div>
        <div class="field"><label>미디어 타입</label><select class="input" name="mediaType"><option value="image">image</option><option value="video">video</option></select></div>
        <div class="field"><label>프롬프트</label><textarea class="input" name="prompt" required></textarea></div>
        <div class="dialog-actions"><button class="btn btn-secondary" type="button" data-act="close-dialog">취소</button><button class="btn btn-primary" type="submit">큐 등록</button></div>
      </form>`;
  }
  if (type === "media-upload") {
    return `<div class="dialog-title">미디어 업로드 시작</div>
      <div class="dialog-body" style="margin:0">S3 presigned PUT URL을 발급하고 pending media를 만듭니다 (600초 유효).</div>
      <form data-action="dlg-media-upload" style="display:flex;flex-direction:column;gap:12px">
        <div style="display:grid;grid-template-columns:120px 1fr;gap:10px">
          <div class="field"><label>미디어 타입</label><select class="input" name="mediaType"><option value="image">image</option><option value="video">video</option></select></div>
          <div class="field"><label>Content-Type</label><input class="input" name="contentType" required placeholder="image/png"></div>
        </div>
        <div class="field"><label>파일 이름</label><input class="input" name="fileName" required placeholder="photo.png"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
          <div class="field"><label>바이트 (선택)</label><input class="input" name="byteSize" type="number" min="1"></div>
          <div class="field"><label>가로 (선택)</label><input class="input" name="width" type="number" min="1"></div>
          <div class="field"><label>세로 (선택)</label><input class="input" name="height" type="number" min="1"></div>
        </div>
        <div class="dialog-actions"><button class="btn btn-secondary" type="button" data-act="close-dialog">취소</button><button class="btn btn-primary" type="submit">URL 발급</button></div>
      </form>`;
  }
  if (type === "complete-job") {
    return `<div class="dialog-title">생성 작업 완료 처리</div>
      <div class="dialog-body" style="margin:0">출력 미디어 ID 또는 URL 중 하나를 입력하세요.</div>
      <form data-action="generation-action" style="display:flex;flex-direction:column;gap:12px">
        <input type="hidden" name="jobId" value="${attr(ctx.jobId)}">
        <input type="hidden" name="action" value="complete">
        <div class="field"><label>미디어 ID</label><input class="input" name="mediaId" placeholder="기존 media UUID"></div>
        <div class="field"><label>출력 URL</label><input class="input" name="url" type="url" placeholder="https://cdn.example.com/generated.png"></div>
        <div class="dialog-actions"><button class="btn btn-secondary" type="button" data-act="close-dialog">취소</button><button class="btn btn-primary" type="submit">완료 처리</button></div>
      </form>`;
  }
  if (type === "grant") {
    return `<div class="dialog-title">크레딧 지급</div>
      <form data-action="dlg-grant" style="display:flex;flex-direction:column;gap:12px">
        <div class="field"><label>사용자</label><select class="input" name="userId">${optionList(
          ctx.users ?? [],
          "id",
          (u) => u.email || u.displayName || u.id,
          ctx.user,
        )}</select></div>
        <div class="field"><label>금액</label><input class="input" name="amount" type="number" min="1" step="1" required>
          <div style="display:flex;gap:6px;margin-top:6px">
            <button class="btn btn-ghost" type="button" data-act="preset-amount" data-amt="100">+100</button>
            <button class="btn btn-ghost" type="button" data-act="preset-amount" data-amt="500">+500</button>
            <button class="btn btn-ghost" type="button" data-act="preset-amount" data-amt="1000">+1,000</button>
          </div>
        </div>
        <div class="field"><label>사유</label><input class="input" name="reason" required></div>
        <div class="field"><label>외부 참조 (선택)</label><input class="input" name="externalReference"></div>
        <div class="dialog-actions"><button class="btn btn-secondary" type="button" data-act="close-dialog">취소</button><button class="btn btn-primary" type="submit">지급</button></div>
      </form>`;
  }
  return "";
}

// ═════════════════════════════════════════════════════════════════════════
// Toast
// ═════════════════════════════════════════════════════════════════════════

function showToast(msg, api = "", isError = false) {
  // Every UI-visible error also lands in the console for debugging.
  if (isError) console.error(`${LOG_PREFIX} error:`, msg);
  if (!toastRoot) return;
  clearTimeout(ui.toastTimer);
  toastRoot.innerHTML = `<div class="toast${isError ? " toast-error" : ""}">
    <div class="toast-msg">${escapeHtml(msg)}</div>
    ${api ? `<div class="toast-api">${escapeHtml(api)}</div>` : ""}
  </div>`;
  ui.toastTimer = setTimeout(() => {
    toastRoot.innerHTML = "";
  }, 4200);
}

// ═════════════════════════════════════════════════════════════════════════
// Form submission
// ═════════════════════════════════════════════════════════════════════════

async function submitViaSpec(requestSpec, successMsg) {
  const result = await request(requestSpec.path, requestSpec.options);
  if (result.ok) {
    showToast(
      successMsg,
      `${requestSpec.options?.method ?? "GET"} ${requestSpec.path}`,
    );
  } else {
    showToast(errorMessage(result.body, "요청이 실패했습니다."), "", true);
  }
  return result;
}

async function handleFormSubmit(event) {
  const form = event.target?.matches?.("form[data-action]")
    ? event.target
    : undefined;
  if (!form) return;
  event.preventDefault();
  if (pendingForms.has(form)) return;

  const action = event.submitter?.dataset.submitAction ?? form.dataset.action;
  const formData = new FormData(form);
  pendingForms.add(form);
  setFormSubmitting(form, true);

  try {
    await dispatchSubmit(action, form, formData);
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "", true);
  } finally {
    pendingForms.delete(form);
    setFormSubmitting(form, false);
  }
}

async function dispatchSubmit(action, form, formData) {
  // — login —
  if (action === "admin-login") {
    const result = await request(
      "/api/admin/login",
      jsonRequest("/api/admin/login", "POST", adminLoginPayload(formData))
        .options,
    );
    if (result.ok && result.body?.token) {
      writeAdminAuth(result.body);
      showToast("로그인되었습니다.");
      if (location.pathname === "/login") {
        navigateTo("/", { replace: true });
      } else {
        renderApp();
      }
    } else {
      showToast(errorMessage(result.body, "로그인에 실패했습니다."), "", true);
    }
    return;
  }

  // — new character (create + optional persona + optional memories) —
  if (action === "dlg-new-char") {
    const created = await request(
      "/api/characters",
      jsonRequest("/api/characters", "POST", characterCreatePayload(formData))
        .options,
    );
    if (!created.ok || !created.body?.id) {
      showToast(errorMessage(created.body, "캐릭터 생성 실패"), "", true);
      return;
    }
    const id = created.body.id;
    const persona = String(formData.get("persona") ?? "").trim();
    if (persona) {
      await request(
        `/api/characters/${id}/personas`,
        jsonRequest(`/api/characters/${id}/personas`, "POST", {
          title: "기본 페르소나",
          content: persona,
        }).options,
      );
    }
    const memLines = String(formData.get("memories") ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (memLines.length) {
      await request(
        `/api/characters/${id}/memory/bulk`,
        jsonRequest(`/api/characters/${id}/memory/bulk`, "POST", {
          items: memLines.map((content) => ({ content, reason: "초기 설정" })),
        }).options,
      );
    }
    closeDialog();
    showToast("캐릭터를 생성했습니다.", "POST /api/characters");
    navigateTo(characterHref({ characterId: id }));
    return;
  }

  const characterResourceSubmission = await characterResourceFormRequest(
    action,
    formData,
    form.dataset,
  );
  if (characterResourceSubmission) {
    const result = await submitViaSpec(
      characterResourceSubmission.request,
      characterResourceSubmission.successMessage,
    );
    if (result.ok) renderApp();
    return;
  }

  // — character profile save —
  if (action === "char-profile") {
    const id = form.dataset.characterId;
    const updated = await request(
      `/api/characters/${id}`,
      jsonRequest(
        `/api/characters/${id}`,
        "PATCH",
        characterUpdatePayload(formData),
      ).options,
    );
    if (!updated.ok) {
      showToast(errorMessage(updated.body, "프로필 저장 실패"), "", true);
      return;
    }
    showToast("프로필을 저장했습니다.", `PATCH /api/characters/${id}`);
    renderApp();
    return;
  }

  // — visual profile (prompts / reference upload / test generation) —
  if (action === "visual-profile-save") {
    const id = form.dataset.characterId;
    await submitViaSpec(
      jsonRequest(`/api/characters/${id}/visual-profile`, "PUT", {
        appearancePrompt: String(formData.get("appearancePrompt") ?? "").trim(),
        stylePrompt: String(formData.get("stylePrompt") ?? "").trim(),
        negativePrompt: String(formData.get("negativePrompt") ?? "").trim(),
      }),
      "비주얼 프로필을 저장했습니다.",
    );
    renderApp();
    return;
  }
  if (action === "visual-ref-add") {
    const id = form.dataset.characterId;
    const file = formData.get("referenceFile");
    if (!(typeof File !== "undefined" && file instanceof File && file.name)) {
      throw new Error("레퍼런스 이미지 파일을 선택하세요.");
    }
    const mediaId = await uploadMedia(
      file,
      "image",
      request,
      fetch,
      `pod/reference/character/${id}`,
    );
    const current = String(form.dataset.mediaIds ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    const result = await submitViaSpec(
      jsonRequest(`/api/characters/${id}/visual-profile/references`, "PUT", {
        mediaIds: [...current, mediaId],
      }),
      "레퍼런스를 추가했습니다.",
    );
    if (result.ok) renderApp();
    return;
  }
  if (action === "visual-test-gen") {
    const id = form.dataset.characterId;
    const result = await submitViaSpec(
      jsonRequest(
        `/api/characters/${id}/visual-profile/test-generation`,
        "POST",
        {
          scene: String(formData.get("scene") ?? "").trim(),
        },
      ),
      "테스트 생성 잡을 큐에 등록했습니다.",
    );
    if (result.ok) renderApp();
    return;
  }

  // — draft review edits / manual draft / posting policy —
  if (action === "draft-edit") {
    const id = form.dataset.draftId;
    const scheduledRaw = String(formData.get("scheduledAt") ?? "").trim();
    const result = await submitViaSpec(
      jsonRequest(`/api/drafts/${id}`, "PATCH", {
        caption: String(formData.get("caption") ?? "").trim(),
        hashtags: splitCsv(formData.get("hashtags")),
        scheduledAt: scheduledRaw ? new Date(scheduledRaw).toISOString() : null,
      }),
      "초안을 저장했습니다.",
    );
    if (result.ok) renderApp();
    return;
  }
  if (action === "draft-create") {
    const characterId =
      form.dataset.characterId ||
      String(formData.get("characterId") ?? "").trim();
    const sceneHint = String(formData.get("sceneHint") ?? "").trim();
    const mode = String(formData.get("mode") ?? "manual").trim() || "manual";
    const result = await submitViaSpec(
      jsonRequest("/api/drafts", "POST", {
        characterId,
        ...(sceneHint ? { sceneHint } : {}),
        mode,
      }),
      mode === "manual"
        ? "초안을 만들었습니다. 단계별로 실행하세요."
        : "초안을 만들었습니다. 워커가 곧 기획을 시작합니다.",
    );
    if (result.ok) {
      // 초안 검수에서 만들면 바로 상세(단계 타임라인)로 진입한다.
      if (currentRoute() === "drafts" && result.body?.id) {
        navigateTo(routeHref("drafts", result.body.id));
      } else {
        renderApp();
      }
    }
    return;
  }
  if (action === "draft-shot-generate") {
    const prompt = String(formData.get("prompt") ?? "").trim();
    // 빈 프롬프트 사전 차단 (서버 가드가 최종) — 빌드 또는 직접 입력 유도.
    if (!prompt) {
      showToast(
        "프롬프트가 비어 있습니다 — '프롬프트 빌드'를 먼저 실행하거나 직접 입력하세요.",
        "",
        true,
      );
      return;
    }
    const candidateRaw = String(formData.get("candidateCount") ?? "").trim();
    const candidateCount = candidateRaw ? Number(candidateRaw) : undefined;
    const result = await submitViaSpec(
      jsonRequest(
        `/api/drafts/${form.dataset.draftId}/jobs/${form.dataset.jobId}/generate`,
        "POST",
        {
          ...(prompt ? { prompt } : {}),
          ...(candidateCount != null && !Number.isNaN(candidateCount)
            ? { candidateCount }
            : {}),
        },
      ),
      "컷 생성을 시작했습니다.",
    );
    if (result.ok) renderApp();
    return;
  }
  if (action === "policy-save") {
    const characterId = form.dataset.characterId;
    const result = await submitViaSpec(
      jsonRequest(`/api/characters/${characterId}/posting-policy`, "PUT", {
        enabled: formData.get("enabled") === "on",
        weeklyCadence: Number(formData.get("weeklyCadence") ?? 3),
        hourStartKst: Number(formData.get("hourStartKst") ?? 18),
        hourEndKst: Number(formData.get("hourEndKst") ?? 22),
      }),
      "포스팅 정책을 저장했습니다.",
    );
    if (result.ok) renderApp();
    return;
  }

  // — new post (character-authored, with hashtags) —
  if (action === "dlg-new-post") {
    const session = dialogState;
    if (!dialogSessionAllows(session, "submit-start")) return;
    session.submissionLocked = true;
    try {
      const result = await submitNewPost(formData, session.mediaFiles);
      if (result.ok) closeDialog(session, "submit-success");
    } finally {
      if (dialogState === session) session.submissionLocked = false;
    }
    return;
  }

  // — comment / reaction —
  if (action === "dlg-comment") {
    const postId = form.dataset.postId;
    const result = await submitViaSpec(
      jsonRequest(`/api/posts/${postId}/comments`, "POST", {
        characterId: String(formData.get("characterId") ?? "").trim(),
        body: String(formData.get("body") ?? "").trim(),
        reason: String(formData.get("reason") ?? "").trim() || undefined,
      }),
      "댓글을 생성했습니다.",
    );
    if (result.ok) closeDialog();
    return;
  }
  if (action === "dlg-reaction") {
    const postId = form.dataset.postId;
    const result = await submitViaSpec(
      jsonRequest(`/api/posts/${postId}/reactions`, "POST", {
        characterId: String(formData.get("characterId") ?? "").trim(),
        reactionType: String(formData.get("reactionType") ?? "like"),
        reason: String(formData.get("reason") ?? "").trim() || undefined,
      }),
      "반응을 생성했습니다.",
    );
    if (result.ok) closeDialog();
    return;
  }

  // — provider settings —
  if (action === "image-draft-create") {
    const spec = imageWorkflowRequest(
      "create",
      "",
      imageDraftPayload(formData),
    );
    const result = await submitViaSpec(spec, "최종 프롬프트를 준비했습니다.");
    if (result.ok && result.body?.id) {
      ui.generationCreating = false;
      navigateTo(routeHref("generation", result.body.id));
    }
    return;
  }
  if (action === "image-draft-update") {
    const jobId = form.dataset.jobId;
    const result = await submitViaSpec(
      imageWorkflowRequest("update", jobId, imageDraftUpdatePayload(formData)),
      "최종 프롬프트를 저장했습니다.",
    );
    if (result.ok) renderApp();
    return;
  }
  if (action === "image-confirm") {
    const jobId = form.dataset.jobId;
    const outcome = await generationConfirmDraft(jobId, formData, request);
    if (outcome.result.ok) {
      showToast(
        "최종 프롬프트를 저장하고 이미지 생성을 시작했습니다.",
        `PATCH /api/generation/jobs/${jobId}/draft → POST /api/generation/jobs/${jobId}/confirm`,
      );
      renderApp();
    } else {
      showToast(
        errorMessage(
          outcome.result.body,
          outcome.stage === "update"
            ? "최종 프롬프트 저장 실패"
            : "이미지 생성 시작 실패",
        ),
        "",
        true,
      );
    }
    return;
  }
  if (action === "image-select-confirm") {
    const mediaId = String(formData.get("mediaId") ?? "").trim();
    if (!mediaId) throw new Error("확정할 이미지 후보를 선택하세요.");
    const result = await submitViaSpec(
      imageWorkflowRequest("select", form.dataset.jobId, mediaId),
      "최종 이미지를 확정했습니다.",
    );
    if (result.ok) {
      ui.generationSelectedMediaId = "";
      renderApp();
    }
    return;
  }
  if (action === "image-regenerate") {
    const spec = imageWorkflowRequest("regenerate", form.dataset.jobId);
    const result = await submitViaSpec(spec, "새 생성 회차를 준비했습니다.");
    if (result.ok && result.body?.id) {
      ui.generationSelectedJobId = "";
      ui.generationSelectedMediaId = "";
      navigateTo(routeHref("generation", result.body.id));
    }
    return;
  }

  if (action === "generation-settings") {
    const result = await submitViaSpec(
      jsonRequest(
        "/api/settings/generation",
        "PUT",
        generationSettingsPayload(formData),
      ),
      "프로바이더 설정을 저장했습니다.",
    );
    if (result.ok) renderApp();
    return;
  }

  // — new generation job —
  const generationFormRequest = await generationFormActionRequest(
    action,
    formData,
  );
  if (generationFormRequest) {
    const result = await submitViaSpec(
      generationFormRequest,
      "생성 작업을 완료 처리했습니다.",
    );
    if (result.ok) {
      closeDialog();
      renderApp();
    }
    return;
  }

  if (action === "dlg-new-job") {
    const result = await submitViaSpec(
      jsonRequest(
        "/api/generation/jobs",
        "POST",
        generationCreatePayload(formData),
      ),
      "생성 작업을 큐에 등록했습니다.",
    );
    if (result.ok) closeDialog();
    return;
  }

  // — 미디어 업로드 시작 (presigned URL 발급 → pending media 생성) —
  if (action === "dlg-media-upload") {
    const result = await submitViaSpec(
      jsonRequest(
        "/api/media/uploads",
        "POST",
        mediaUploadStartPayload(formData),
      ),
      "presigned URL을 발급했습니다 — pending 미디어가 생성되었습니다.",
    );
    if (result.ok) {
      closeDialog();
      renderApp();
      void updateNavBadges();
    }
    return;
  }

  // — credit grant (dialog + inline form share this) —
  if (action === "dlg-grant" || action === "credit-grant-full") {
    const body = { ...creditGrantPayload(formData) };
    const extRef = String(formData.get("externalReference") ?? "").trim();
    if (extRef) body.externalReference = extRef;
    const result = await submitViaSpec(
      jsonRequest("/api/credits/grants", "POST", body),
      "크레딧을 지급했습니다.",
    );
    if (result.ok) {
      if (action === "dlg-grant") closeDialog();
      renderApp();
    }
    return;
  }

  throw new Error(`Unsupported form action: ${action}`);
}

function setFormSubmitting(form, submitting) {
  for (const control of form.querySelectorAll(
    "button, input, select, textarea",
  )) {
    control.disabled = submitting;
  }
}

// ═════════════════════════════════════════════════════════════════════════
// Click / change / input delegation
// ═════════════════════════════════════════════════════════════════════════

async function handleClick(event) {
  // sidebar navigation
  const navBtn = event.target.closest?.(".nav-item[data-route]");
  if (navBtn) {
    navigateTo(routeHref(navBtn.dataset.route));
    return;
  }

  const el = event.target.closest?.("[data-act]");
  if (!el) return;
  const act = el.dataset.act;

  if (act === "remove-post-media") {
    if (!dialogSessionAllows(dialogState, act)) return;
    dialogState.mediaFiles = removePostMediaFile(
      dialogState.mediaFiles,
      el.dataset.index,
    );
    renderPostMediaSelection();
    return;
  }
  if (act === "zoom-image") {
    if (el.dataset.url) openLightbox(el.dataset.url);
    return;
  }
  if (act === "lightbox-backdrop") {
    // 이미지 자체 클릭은 닫지 않는다 (버튼/배경만).
    if (event.target === el) closeLightbox();
    return;
  }
  if (act === "dialog-backdrop") {
    if (event.target === el) closeDialog();
    return;
  }
  if (act === "close-dialog") {
    closeDialog();
    return;
  }
  if (act === "open-dialog") {
    const ctx = dialogContextFromDataset(el.dataset);
    await openDialog(el.dataset.dialog, ctx);
    return;
  }
  if (act === "preset-amount") {
    const input = el.closest("form")?.querySelector('input[name="amount"]');
    if (input) input.value = String(el.dataset.amt);
    return;
  }
  if (act === "set-seg") {
    ui.filters[el.dataset.scope] = el.dataset.val;
    renderApp();
    return;
  }
  if (act === "generation-create") {
    ui.generationCreating = true;
    ui.generationSelectedJobId = "";
    ui.generationSelectedMediaId = "";
    navigateTo("/generation/new");
    return;
  }
  if (act === "generation-open") {
    ui.generationCreating = false;
    navigateTo(routeHref("generation", el.dataset.jobId));
    return;
  }
  if (act === "generation-back") {
    ui.generationCreating = false;
    ui.generationSelectedJobId = "";
    ui.generationSelectedMediaId = "";
    navigateTo(routeHref("generation"));
    return;
  }
  if (act === "image-select") {
    Object.assign(
      ui,
      generationCandidateSelection(el.dataset.jobId, el.dataset.mediaId),
    );
    renderApp();
    return;
  }
  if (act === "worker-run") {
    const spec = workerRunRequest();
    const result = await request(spec.path, spec.options);
    if (!result.ok) {
      showToast(
        errorMessage(result.body, "실행 요청이 실패했습니다."),
        "",
        true,
      );
      return;
    }
    showToast(
      result.body?.jobId
        ? "작업 실행을 시작했습니다 — 잠시 후 상태가 갱신됩니다."
        : "대기 중인 작업이 없습니다.",
      `POST ${spec.path}`,
    );
    renderApp();
    return;
  }
  // 연결 테스트 — 폼의 미저장 입력값으로 "저장하면 적용될 조합"을 검증.
  // 저장과 무관한 읽기 전용 호출이라 재렌더하지 않는다.
  if (
    act === "settings-test-image" ||
    act === "settings-test-llm" ||
    act === "settings-test-chat"
  ) {
    const payload = settingsTestPayload(
      act,
      new FormData(el.closest("form") ?? undefined),
    );
    const spec = jsonRequest("/api/settings/generation/test", "POST", payload);
    el.disabled = true;
    try {
      const result = await request(spec.path, spec.options);
      const ok = result.ok && result.body?.ok === true;
      showToast(
        result.body?.message ??
          errorMessage(result.body, "연결 테스트가 실패했습니다."),
        "",
        !ok,
      );
    } finally {
      el.disabled = false;
    }
    return;
  }
  // 키 삭제는 원클릭 파괴 액션이라 확인을 거친다.
  if (
    act.startsWith("settings-clear-") &&
    !window.confirm(
      "저장된 키를 삭제하고 상위 값(상속/env)으로 되돌립니다. 계속할까요?",
    )
  ) {
    return;
  }
  const simpleAction = simpleClickAction(act, el.dataset);
  if (simpleAction) {
    const result = await submitViaSpec(
      simpleAction.request,
      simpleAction.successMessage,
    );
    if (result.ok) {
      renderApp();
      void updateNavBadges();
    }
    return;
  }
  const generationRequest = generationClickRequest(act, el.dataset.id);
  if (generationRequest) {
    event.stopPropagation();
    const result = await submitViaSpec(
      generationRequest,
      act === "job-run"
        ? "작업 실행을 시작했습니다 — 잠시 후 상태가 갱신됩니다."
        : "생성 작업을 재시도 큐에 등록했습니다.",
    );
    if (result.ok) renderApp();
    return;
  }
  if (act === "visual-profile-caption") {
    // 캡션 없는 레퍼런스를 순차 캡셔닝 — 장수에 따라 수십 초 걸릴 수 있어 중복 클릭을 막는다.
    el.disabled = true;
    const result = await request(
      `/api/characters/${el.dataset.id}/visual-profile/captions`,
      { method: "POST" },
    );
    if (!result.ok) {
      el.disabled = false;
      showToast(
        errorMessage(result.body, "캡션 생성이 실패했습니다."),
        "",
        true,
      );
      return;
    }
    const body = result.body ?? {};
    const failed = Array.isArray(body.failed) ? body.failed : [];
    showToast(
      `캡션 ${body.captioned ?? 0}장 생성${
        failed.length ? `, 실패 ${failed.length}장` : ""
      }`,
      `POST /api/characters/${el.dataset.id}/visual-profile/captions`,
    );
    renderApp();
    return;
  }
  if (act === "visual-ref-remove") {
    const remaining = String(el.dataset.mediaIds ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v && v !== el.dataset.media);
    const result = await submitViaSpec(
      jsonRequest(
        `/api/characters/${el.dataset.id}/visual-profile/references`,
        "PUT",
        { mediaIds: remaining },
      ),
      "레퍼런스를 제거했습니다.",
    );
    if (result.ok) renderApp();
    return;
  }
  if (act === "visual-ref-promote") {
    const jobRes = await request(`/api/generation/jobs/${el.dataset.job}`);
    const outputs = Array.isArray(jobRes.body?.outputs)
      ? jobRes.body.outputs
      : [];
    const mediaId =
      outputs.find((o) => o.selected)?.mediaId ?? outputs[0]?.mediaId;
    if (!jobRes.ok || !mediaId) {
      showToast("승격할 출력 미디어를 찾지 못했습니다.", "", true);
      return;
    }
    const current = String(el.dataset.mediaIds ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    if (current.includes(mediaId)) {
      showToast("이미 레퍼런스에 등록된 이미지입니다.", "", true);
      return;
    }
    const result = await submitViaSpec(
      jsonRequest(
        `/api/characters/${el.dataset.id}/visual-profile/references`,
        "PUT",
        { mediaIds: [...current, mediaId] },
      ),
      "레퍼런스로 승격했습니다.",
    );
    if (result.ok) renderApp();
    return;
  }
  if (act === "persona-delete" || act === "memory-delete") {
    const submission = await characterDeleteRequest(
      act,
      el.dataset,
      (message) => window.confirm(message),
    );
    if (!submission) return;
    const result = await submitViaSpec(
      submission.request,
      submission.successMessage,
    );
    if (result.ok) renderApp();
    return;
  }
  if (act === "go-char") {
    navigateTo(characterHref({ characterId: el.dataset.id }));
    return;
  }
  if (act === "go-char-list") {
    navigateTo(characterHref());
    return;
  }
  if (act === "char-tab") {
    navigateTo(
      characterHref({
        characterId: el.dataset.id,
        tab: el.dataset.tab,
      }),
    );
    return;
  }
  if (act === "select-post") {
    navigateTo(routeHref("posts", el.dataset.id));
    return;
  }
  if (act === "back-posts") {
    navigateTo(routeHref("posts"));
    return;
  }
  if (act === "go-route") {
    event.preventDefault();
    // 대시보드 처리 대기 카드 — 해당 섹션으로 이동 (사이드바 이동과 동일 처리).
    navigateTo(routeHref(el.dataset.route));
    return;
  }
  if (act === "select-media") {
    navigateTo(routeHref("media", el.dataset.id));
    return;
  }
  if (act === "back-media-list") {
    navigateTo(routeHref("media"));
    return;
  }
  if (act === "select-draft") {
    navigateTo(routeHref("drafts", el.dataset.id));
    return;
  }
  if (act === "back-drafts") {
    navigateTo(routeHref("drafts"));
    return;
  }
  if (act === "go-draft") {
    navigateTo(routeHref("drafts", el.dataset.id));
    return;
  }
  if (act === "draft-regen") {
    const result = await submitViaSpec(
      jsonRequest(
        `/api/drafts/${el.dataset.draft}/jobs/${el.dataset.job}/regenerate`,
        "POST",
        {},
      ),
      "컷 재생성을 큐에 등록했습니다.",
    );
    if (result.ok) renderApp();
    return;
  }
  if (act === "draft-pick-output") {
    const result = await submitViaSpec(
      jsonRequest(
        `/api/drafts/${el.dataset.draft}/jobs/${el.dataset.job}/select`,
        "POST",
        { mediaId: el.dataset.media },
      ),
      "후보를 선택했습니다.",
    );
    if (result.ok) renderApp();
    return;
  }
  if (act === "draft-filter-set") {
    const card = el.closest("[data-filter-media]");
    const img = card?.querySelector("img[data-filter-media]");
    if (!card || !img) return;
    const previous = card.dataset.filterPreset || "none";
    const next = el.dataset.filter || "none";
    const status = card.querySelector(".candidate-filter-status");
    const filterButtons = Array.from(
      card.querySelectorAll("[data-act='draft-filter-set']"),
    );
    const setUi = (preset) => {
      card.dataset.filterPreset = preset;
      img.dataset.filterPreset = preset;
      card
        .querySelectorAll("[data-act='draft-filter-set']")
        .forEach((button) =>
          button.setAttribute(
            "aria-pressed",
            String(button.dataset.filter === preset),
          ),
        );
      const compare = card.querySelector("[data-act='draft-filter-compare']");
      if (compare) compare.disabled = preset === "none";
    };
    setUi(next);
    filterButtons.forEach((button) => {
      button.disabled = true;
    });
    if (status) status.textContent = "저장 중…";
    const preview = applyCandidateFilter(img);
    const spec = jsonRequest(
      `/api/drafts/${card.dataset.filterDraft}/jobs/${card.dataset.filterJob}/outputs/${card.dataset.filterMedia}/filter`,
      "PATCH",
      { filterPreset: next },
    );
    const result = await request(spec.path, spec.options);
    const previewOk = await preview;
    filterButtons.forEach((button) => {
      button.disabled = false;
    });
    if (result.ok) {
      if (status) {
        status.textContent = previewOk ? "저장됨" : "저장됨 · 미리보기 실패";
      }
    } else {
      setUi(previous);
      void applyCandidateFilter(img);
      if (status) {
        status.textContent = errorMessage(
          result.body,
          "필터 저장에 실패했습니다.",
        );
      }
    }
    return;
  }
  if (act === "draft-filter-compare") {
    return;
  }
  if (act === "select-user") {
    navigateTo(routeHref("users", el.dataset.id));
    return;
  }
  if (act === "back-users") {
    navigateTo(routeHref("users"));
    return;
  }
  if (act === "select-payment") {
    navigateTo(routeHref("payments", el.dataset.id));
    return;
  }
  if (act === "toggle-char-status") {
    const next = el.dataset.current === "active" ? "inactive" : "active";
    const result = await submitViaSpec(
      jsonRequest(`/api/characters/${el.dataset.id}/status`, "PATCH", {
        status: next,
        reason: "운영 콘솔에서 상태 전환",
      }),
      next === "active" ? "활성화했습니다." : "비활성화했습니다.",
    );
    if (result.ok) renderApp();
    return;
  }
  if (act === "report-action") {
    const status = el.dataset.status;
    const result = await submitViaSpec(
      jsonRequest(`/api/moderation/reports/${el.dataset.id}`, "PATCH", {
        status,
        resolution:
          status === "resolved" ? "운영 콘솔에서 조치" : "운영 콘솔에서 기각",
      }),
      status === "resolved" ? "조치 완료 처리했습니다." : "기각했습니다.",
    );
    if (result.ok) renderApp();
    return;
  }
}

function handleChange(event) {
  const fileInput = event.target.closest?.("[data-post-media-input]");
  if (fileInput) {
    if (!dialogSessionAllows(dialogState, "add-post-media")) return;
    try {
      dialogState.mediaFiles = appendPostMediaFiles(
        dialogState.mediaFiles,
        fileInput.files,
      );
      renderPostMediaSelection();
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : String(error),
        "",
        true,
      );
    }
    fileInput.value = "";
    return;
  }

  const el = event.target.closest?.("[data-select]");
  if (!el) return;
  const kind = el.dataset.select;
  if (kind === "ledger-user") {
    ui.ledgerUserId = el.value;
    renderApp();
  } else if (kind === "event-user") {
    ui.eventUserId = el.value;
    renderApp();
  }
}

function mediaDropzoneFor(event) {
  return event.target.closest?.("[data-post-media-dropzone]");
}

function handlePostMediaDragOver(event) {
  const dropzone = mediaDropzoneFor(event);
  if (!dropzone || dialogState?.type !== "new-post") return;
  event.preventDefault();
  if (!dialogSessionAllows(dialogState, "drop-post-media")) return;
  dropzone.classList.add("is-dragging");
}

function handlePostMediaDragLeave(event) {
  const dropzone = mediaDropzoneFor(event);
  if (!dropzone || dropzone.contains(event.relatedTarget)) return;
  dropzone.classList.remove("is-dragging");
}

function handlePostMediaDrop(event) {
  const dropzone = mediaDropzoneFor(event);
  if (!dropzone || dialogState?.type !== "new-post") return;
  event.preventDefault();
  dropzone.classList.remove("is-dragging");
  if (!dialogSessionAllows(dialogState, "drop-post-media")) return;
  try {
    dialogState.mediaFiles = appendPostMediaFiles(
      dialogState.mediaFiles,
      event.dataTransfer?.files,
    );
    renderPostMediaSelection();
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "", true);
  }
}

function handleInput(event) {
  const candidateCount = event.target.closest?.(
    "[data-generation-candidate-count]",
  );
  if (candidateCount) {
    const button = candidateCount.form?.querySelector(
      "[data-generation-count-button]",
    );
    if (button) button.textContent = `이미지 ${candidateCount.value}장 생성`;
  }
  const el = event.target.closest?.("[data-filter-input]");
  if (!el) return;
  const selector = el.dataset.filterInput;
  const needle = el.value.trim().toLowerCase();
  const rows = mainPanel.querySelectorAll(selector);
  let shown = 0;
  for (const row of rows) {
    const match = !needle || (row.dataset.search ?? "").includes(needle);
    row.hidden = !match;
    if (match) shown += 1;
  }
  const note = mainPanel.querySelector(".count-note");
  if (note) note.textContent = `${shown}건`;
}

// ═════════════════════════════════════════════════════════════════════════
// App shell orchestration
// ═════════════════════════════════════════════════════════════════════════

function updateIdentity() {
  const email = readAdminEmail();
  if (identityEmail) identityEmail.textContent = email;
  if (identityName)
    identityName.textContent = email ? email.split("@")[0] : "관리자";
  if (identityAvatar) identityAvatar.textContent = initialOf(email || "관리자");
}

function highlightNav(route) {
  if (!sidebarNav) return;
  for (const btn of sidebarNav.querySelectorAll(".nav-item[data-route]")) {
    btn.classList.toggle("active", btn.dataset.route === route);
  }
}

function loginHtml() {
  return `<div class="login-wrap"><form class="login-card" data-action="admin-login">
    <div>
      <div class="brand-kicker">AI SNS</div>
      <div class="brand-title" style="font-size:26px">OPOD Admin</div>
    </div>
    <div class="field"><label>이메일</label><input class="input" name="email" type="email" value="admin@opod.com" autocomplete="username" required></div>
    <div class="field"><label>비밀번호</label><input class="input" name="password" type="password" autocomplete="current-password" required></div>
    <button class="btn btn-primary" type="submit" style="width:100%">로그인</button>
  </form></div>`;
}

async function updateNavBadges() {
  if (!sidebarNav) return;
  const specs = navBadgeRequests();
  const results = await Promise.all(specs.map((spec) => request(spec.path)));
  specs.forEach((spec, index) => {
    const count = itemsFromPage(results[index].body).length;
    ui.badges[spec.key] = count;
    applyBadge(spec.key, count);
  });
}

function applyBadge(route, count) {
  const btn = sidebarNav?.querySelector(`.nav-item[data-route="${route}"]`);
  if (!btn) return;
  const existing = btn.querySelector(".nav-badge");
  if (existing) existing.remove();
  if (count > 0) {
    const span = document.createElement("span");
    span.className = "nav-badge";
    span.textContent = String(count);
    btn.appendChild(span);
  }
}

let renderToken = 0;

async function renderApp() {
  if (!hasDocument) return;
  const token = ++renderToken;
  clearTimeout(ui.generationPollTimer);
  ui.generationPollTimer = 0;
  clearTimeout(ui.draftPollTimer);
  ui.draftPollTimer = 0;
  const route = currentRoute();
  const routeState = adminRouteState(currentUrl());
  ui.selPostId = route === "posts" ? (routeState.detailId ?? null) : null;
  ui.selMediaId = route === "media" ? (routeState.detailId ?? null) : null;
  ui.selDraftId = route === "drafts" ? (routeState.detailId ?? null) : null;
  ui.selUserId = route === "users" ? (routeState.detailId ?? null) : null;
  ui.selPayId = route === "payments" ? (routeState.detailId ?? null) : null;
  ui.generationCreating =
    route === "generation" && routeState.detailId === "new";

  if (route === "login") {
    appShell.hidden = true;
    loginRoot.innerHTML = loginHtml();
    const email = loginRoot.querySelector('input[name="email"]');
    if (email) setTimeout(() => email.focus(), 40);
    return;
  }

  loginRoot.innerHTML = "";
  appShell.hidden = false;
  updateIdentity();
  highlightNav(route);

  mainPanel.innerHTML = spinner();
  let html;
  try {
    html = await renderSection(route, token);
  } catch (error) {
    console.error(`${LOG_PREFIX} render failed for section "${route}":`, error);
    html = noticeBlock(
      `섹션을 불러오는 중 오류가 발생했습니다: ${escapeHtml(
        error instanceof Error ? error.message : String(error),
      )}`,
    );
  }
  if (token !== renderToken) return; // a newer render superseded this one
  mainPanel.innerHTML = html;
  // 초안 후보별 저장 필터를 렌더된 이미지에 적용한다.
  void applyDraftFilters();
}

// ═════════════════════════════════════════════════════════════════════════
// Boot
// ═════════════════════════════════════════════════════════════════════════

if (hasDocument) {
  // Surface anything that escapes local error handling.
  window.addEventListener("error", (event) => {
    console.error(
      `${LOG_PREFIX} uncaught error:`,
      event.error ?? event.message,
    );
  });
  window.addEventListener("unhandledrejection", (event) => {
    console.error(`${LOG_PREFIX} unhandled rejection:`, event.reason);
  });

  updateIdentity();

  logoutButton?.addEventListener("click", () => {
    clearAdminAuth();
    closeDialog();
    navigateTo("/", { replace: true });
  });

  document.body.addEventListener("click", handleClick);
  document.body.addEventListener("submit", handleFormSubmit);
  document.body.addEventListener("change", handleChange);
  document.body.addEventListener("input", handleInput);
  document.body.addEventListener("dragover", handlePostMediaDragOver);
  document.body.addEventListener("dragleave", handlePostMediaDragLeave);
  document.body.addEventListener("drop", handlePostMediaDrop);
  document.body.addEventListener("pointerdown", handleFilterCompareStart);
  document.body.addEventListener("pointerup", handleFilterCompareEnd);
  document.body.addEventListener("pointercancel", handleFilterCompareEnd);
  document.body.addEventListener("pointerleave", handleFilterCompareEnd, true);
  document.body.addEventListener("keydown", handleFilterCompareKeyDown);
  document.body.addEventListener("keyup", handleFilterCompareKeyUp);

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    // 라이트박스가 열려 있으면 먼저 닫는다 (dialog 위에 뜨는 오버레이).
    if (closeLightbox()) return;
    if (dialogState) closeDialog();
  });

  window.addEventListener("popstate", () => {
    // Navigating dismisses any open modal so it can't linger over a new section.
    closeLightbox();
    if (dialogState) closeDialog();
    renderApp();
  });

  if (location.hash) {
    const legacy = adminRouteState(location.hash);
    const path =
      legacy.route === "characters"
        ? characterHref(characterRouteState(location.hash))
        : routeHref(legacy.route, legacy.detailId);
    history.replaceState({}, "", path);
  }

  // initial paint
  renderApp().then(() => {
    if (readAdminToken()) updateNavBadges();
  });
}
