const hasDocument = typeof document !== "undefined";
const output = hasDocument ? document.querySelector("#output") : undefined;
const statusDot = hasDocument
  ? document.querySelector("#statusDot")
  : undefined;
const statusText = hasDocument
  ? document.querySelector("#statusText")
  : undefined;
const mainPanel = hasDocument
  ? document.querySelector("#mainPanel")
  : undefined;
const routeTitle = hasDocument
  ? document.querySelector("#routeTitle")
  : undefined;
const routeEyebrow = hasDocument
  ? document.querySelector("#routeEyebrow")
  : undefined;
const sidebarNav = hasDocument
  ? document.querySelector("#sidebarNav")
  : undefined;
const adminAuthBox = hasDocument
  ? document.querySelector("#adminAuthBox")
  : undefined;
const adminAuthEmail = hasDocument
  ? document.querySelector("#adminAuthEmail")
  : undefined;
const logoutButton = hasDocument
  ? document.querySelector("#logoutButton")
  : undefined;
const adminTokenStorageKey = "opodAdminToken";
const adminEmailStorageKey = "opodAdminEmail";
const pendingForms = new WeakSet();

export const navItems = [
  { id: "dashboard", label: "대시보드" },
  { id: "users", label: "사용자" },
  { id: "characters", label: "AI 캐릭터" },
  { id: "media", label: "콘텐츠 / 미디어" },
  { id: "generation", label: "생성 작업" },
  { id: "moderation", label: "신고 / 모더레이션" },
  { id: "payments", label: "결제 / 정산" },
  { id: "analytics", label: "분석 / 로그" },
  { id: "settings", label: "설정" },
];

export function currentRouteFromHash(hash = "#dashboard", token = "") {
  const route = String(hash ?? "")
    .replace(/^#/, "")
    .split("?")[0];
  const hasToken = Boolean(String(token ?? "").trim());
  if (!hasToken) {
    return "login";
  }
  if (route === "login") {
    return "dashboard";
  }
  return navItems.some((item) => item.id === route) ? route : "dashboard";
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

export function dashboardRequests() {
  return [
    { key: "analytics", path: "/api/analytics" },
    { key: "logs", path: "/api/character-action-logs" },
    {
      key: "reports",
      path: endpoint("/api/moderation/reports", {
        status: "submitted",
        limit: 10,
      }),
    },
    {
      key: "payments",
      path: endpoint("/api/payments/reconciliation", { status: "mismatch" }),
    },
  ];
}

export function userDetailRequests(userId) {
  return [
    { key: "user", path: `/api/users/${userId}` },
    { key: "events", path: endpoint("/api/events", { userId, limit: 20 }) },
    { key: "hashtags", path: endpoint("/api/hashtag-preferences", { userId }) },
    {
      key: "credits",
      path: endpoint("/api/credits/ledger", { userId, limit: 20 }),
    },
  ];
}

export function characterDetailRequests(characterId) {
  return [
    { key: "character", path: `/api/characters/${characterId}` },
    { key: "personas", path: `/api/characters/${characterId}/personas` },
    { key: "memory", path: `/api/characters/${characterId}/memory` },
    { key: "logs", path: "/api/character-action-logs" },
  ];
}

export function characterRouteState(hash = "#characters") {
  const [routePart, query = ""] = String(hash ?? "")
    .replace(/^#/, "")
    .split("?");
  const params = new URLSearchParams(query);
  const characterId = String(params.get("characterId") ?? "").trim();
  const mode =
    params.get("mode") === "create"
      ? "create"
      : characterId
        ? "detail"
        : "list";
  const requestedTab = String(params.get("tab") ?? "profile").trim();
  const tab = ["profile", "persona", "memory", "logs"].includes(requestedTab)
    ? requestedTab
    : "profile";

  return {
    route: routePart || "characters",
    mode,
    characterId,
    tab,
  };
}

export function characterHref(input = {}) {
  const params = new URLSearchParams();
  if (input.mode === "create") {
    params.set("mode", "create");
  } else if (input.characterId) {
    params.set("characterId", String(input.characterId));
    if (input.tab && input.tab !== "profile") {
      params.set("tab", String(input.tab));
    }
  }

  const query = params.toString();
  return query ? `#characters?${query}` : "#characters";
}

export function itemsFromPage(value) {
  if (Array.isArray(value)) {
    return value;
  }
  return Array.isArray(value?.items) ? value.items : [];
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

export function selectedOption(value, expected) {
  return value === expected ? " selected" : "";
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
  if (action === "post-create") {
    return jsonRequest("/api/posts", "POST", await postPayload(form));
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

if (hasDocument) {
  updateSessionUi();
  logoutButton.addEventListener("click", () => {
    clearAdminAuth();
    updateSessionUi();
    location.hash = "login";
  });
  document
    .querySelector("#healthButton")
    .addEventListener("click", checkHealth);
  sidebarNav.addEventListener("click", (event) => {
    const button = event.target.closest("[data-route]");
    if (button) {
      location.hash = button.dataset.route;
    }
  });
  mainPanel.addEventListener("submit", handleFormSubmit);
  window.addEventListener("hashchange", renderCurrentRoute);
  renderCurrentRoute();
}

function currentRoute() {
  return currentRouteFromHash(location.hash, readAdminToken());
}

function setActiveRoute(route) {
  const item = navItems.find((candidate) => candidate.id === route);
  routeTitle.textContent =
    route === "login" ? "로그인" : (item?.label ?? "대시보드");
  routeEyebrow.textContent = route === "login" ? "Admin" : "운영 콘솔";
  for (const button of sidebarNav.querySelectorAll("[data-route]")) {
    const isActive = button.dataset.route === route;
    button.classList.toggle("active", isActive);
    if (isActive) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  }
}

async function renderCurrentRoute() {
  const redirect = authRedirectRoute();
  if (redirect) {
    location.hash = redirect;
    return;
  }
  const route = currentRoute();
  updateSessionUi();
  setActiveRoute(route);
  mainPanel.innerHTML = `<section class="panel"><p class="muted">불러오는 중</p></section>`;
  mainPanel.innerHTML = await routeHtml(route);
}

async function handleFormSubmit(event) {
  const form = event.target?.matches?.("form[data-action]")
    ? event.target
    : undefined;
  if (!form) return;
  event.preventDefault();
  if (pendingForms.has(form)) return;
  const formData = new FormData(form);
  pendingForms.add(form);
  setFormSubmitting(form, true);

  try {
    const requestSpec = await formActionRequest(
      form.dataset.action,
      formData,
      form.dataset,
    );
    const result = await request(requestSpec.path, requestSpec.options);
    render(result.body);
    if (result.ok) {
      if (form.dataset.action === "admin-login" && result.body?.token) {
        writeAdminAuth(result.body);
        updateSessionUi();
        location.hash = "dashboard";
        return;
      }
      if (form.dataset.action === "character-create" && result.body?.id) {
        location.hash = characterHref({ characterId: result.body.id });
        return;
      }
      await renderCurrentRoute();
    }
  } catch (error) {
    render({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    pendingForms.delete(form);
    setFormSubmitting(form, false);
  }
}

async function loadMany(requests) {
  const entries = await Promise.all(
    requests.map(async ({ key, path }) => [key, await request(path)]),
  );
  return Object.fromEntries(entries);
}

async function loadDashboardHtml() {
  const data = await loadMany(dashboardRequests());
  return `
    <div class="dashboard-grid">
      ${metricCard("이벤트/메시지", analyticsText(data.analytics.body))}
      ${metricCard("최근 액션", `${itemsFromPage(data.logs.body).length}건`)}
      ${metricCard("대기 신고", `${itemsFromPage(data.reports.body).length}건`)}
      ${metricCard("정산 이슈", `${itemsFromPage(data.payments.body).length}건`)}
    </div>
    <div class="two-column" style="margin-top:14px">
      ${listPanel("최근 캐릭터 액션", itemsFromPage(data.logs.body), logRow)}
      ${listPanel(
        "운영 큐",
        [
          ...itemsFromPage(data.reports.body).map((item) => ({
            title: `신고 ${item.id}`,
            subtitle: `${item.targetType} · ${item.status}`,
          })),
          ...itemsFromPage(data.payments.body).map((item) => ({
            title: `결제 ${item.paymentId}`,
            subtitle: `${item.providerStatus} / ${item.ledgerStatus}`,
          })),
        ],
        simpleRow,
      )}
    </div>
  `;
}

function metricCard(label, value) {
  return `<section class="panel"><span class="muted">${escapeHtml(
    label,
  )}</span><strong style="font-size:24px">${escapeHtml(value)}</strong></section>`;
}

function analyticsText(body) {
  const metrics = Array.isArray(body?.metrics) ? body.metrics : [];
  return metrics.length
    ? metrics.map((item) => `${item.name}: ${item.value}`).join(" / ")
    : "0";
}

function listPanel(title, items, row) {
  return `<section class="panel"><h3>${escapeHtml(title)}</h3><div class="list">${
    items.length
      ? items.map(row).join("")
      : `<p class="muted">표시할 항목이 없습니다.</p>`
  }</div></section>`;
}

function simpleRow(item) {
  return `<div class="list-item"><strong>${escapeHtml(
    item.title ?? item.id,
  )}</strong><span class="muted">${escapeHtml(item.subtitle ?? "")}</span></div>`;
}

function logRow(item) {
  return simpleRow({
    title: item.actionType,
    subtitle: `${item.characterId ?? ""} · ${item.reason ?? ""}`,
  });
}

async function usersHtml() {
  const result = await request(endpoint("/api/users", { limit: 25 }));
  return `
    <div class="two-column">
      ${listPanel("사용자", itemsFromPage(result.body), (user) =>
        simpleRow({
          title: user.displayName,
          subtitle: `${user.email ?? "email 없음"} · ${user.id}`,
        }),
      )}
      <section class="panel">
        <h3>사용자 상세</h3>
        <p class="muted">사용자를 선택하면 이벤트, 해시태그, 크레딧 원장을 조회합니다.</p>
        ${creditGrantForm()}
      </section>
    </div>`;
}

async function mediaHtml() {
  const result = await request(endpoint("/api/media", { limit: 25 }));
  return `<div class="two-column">
    ${listPanel("미디어", itemsFromPage(result.body), (media) =>
      simpleRow({
        title: `${media.mediaType} · ${media.id}`,
        subtitle: media.uploadedAt
          ? `uploaded ${media.uploadedAt}`
          : "업로드 대기",
      }),
    )}
    <section class="panel"><h3>게시물 작성</h3>${postFormHtml()}</section>
  </div>`;
}

async function moderationHtml() {
  const result = await request(
    endpoint("/api/moderation/reports", { limit: 25 }),
  );
  return `<div class="two-column">
    ${listPanel("신고", itemsFromPage(result.body), (report) =>
      simpleRow({
        title: `${report.targetType} · ${report.status}`,
        subtitle: `${report.reason} · ${report.id}`,
      }),
    )}
    <section class="panel"><h3>신고 처리</h3>${reportFormHtml()}</section>
  </div>`;
}

async function paymentsHtml() {
  const result = await request("/api/payments/reconciliation");
  return `<div class="two-column">
    ${listPanel("결제 / 정산", itemsFromPage(result.body), (payment) =>
      simpleRow({
        title: payment.paymentId,
        subtitle: `${payment.providerStatus} / ${payment.ledgerStatus}`,
      }),
    )}
    <section class="panel"><h3>결제 상세</h3><p class="muted">결제 ID로 상세를 조회합니다.</p></section>
  </div>`;
}

async function analyticsHtml() {
  const data = await loadMany([
    { key: "analytics", path: "/api/analytics" },
    { key: "logs", path: "/api/character-action-logs" },
  ]);
  const metrics = Array.isArray(data.analytics.body?.metrics)
    ? data.analytics.body.metrics
    : [];
  return `<div class="two-column">
    ${listPanel("지표", metrics, (metric) =>
      simpleRow({ title: metric.name, subtitle: String(metric.value) }),
    )}
    ${listPanel("액션 로그", itemsFromPage(data.logs.body), logRow)}
  </div>`;
}

function settingsHtml() {
  return `<div class="two-column">
    <section class="panel">
      <h3>관리자 계정 생성</h3>
      <form data-action="admin-create">
        <label>이메일<input name="email" type="email" autocomplete="off" required /></label>
        <label>비밀번호<input name="password" type="password" autocomplete="new-password" required /></label>
        <button type="submit">관리자 생성</button>
      </form>
    </section>
    <section class="panel">
      <h3>세션</h3>
      <p class="muted">${escapeHtml(readAdminEmail() || "로그인 정보 없음")}</p>
    </section>
  </div>`;
}

function loginHtml() {
  return `<section class="panel login-panel">
    <h3>Admin 로그인</h3>
    <form data-action="admin-login">
      <label>이메일<input name="email" type="email" value="admin@opod.com" autocomplete="username" required /></label>
      <label>비밀번호<input name="password" type="password" autocomplete="current-password" required /></label>
      <button type="submit">로그인</button>
    </form>
  </section>`;
}

async function charactersHtml() {
  const state = characterRouteState(
    hasDocument ? location.hash : "#characters",
  );
  if (state.mode === "create") {
    return characterCreatePageHtml();
  }
  if (state.mode === "detail" && state.characterId) {
    return characterDetailPageHtml(state);
  }
  return characterListPageHtml();
}

async function characterListPageHtml() {
  const result = await request(endpoint("/api/characters", { limit: 25 }));
  const characters = itemsFromPage(result.body);

  return `<section class="panel">
      <div class="toolbar">
        <h3>AI 캐릭터 목록</h3>
        <a class="action-link" href="${characterHref({ mode: "create" })}">새 캐릭터</a>
      </div>
      ${
        characters.length
          ? `<div class="list character-list">${characters
              .map(characterRow)
              .join("")}</div>`
          : `<div class="empty-state"><strong>AI 캐릭터가 없습니다.</strong><a class="action-link" href="${characterHref({ mode: "create" })}">AI 캐릭터 생성</a></div>`
      }
    </section>`;
}

function characterCreatePageHtml() {
  return `<section class="panel">
    <div class="toolbar">
      <h3>AI 캐릭터 생성</h3>
      <a class="text-link" href="${characterHref()}">목록</a>
    </div>
    ${characterCreateForm()}
  </section>`;
}

async function characterDetailPageHtml(state) {
  const detail = await loadMany(characterDetailRequests(state.characterId));
  const character = detail.character?.body;
  if (!character?.id) {
    return `<section class="panel">
      <div class="toolbar">
        <h3>캐릭터 상세</h3>
        <a class="text-link" href="${characterHref()}">목록</a>
      </div>
      <p class="muted">캐릭터를 찾을 수 없습니다.</p>
    </section>`;
  }
  return characterDetailHtml(character, detail, state.tab);
}

function characterRow(character) {
  return `<a class="list-item character-list-item" href="${escapeHtml(
    characterHref({ characterId: character.id }),
  )}">
    <strong>${escapeHtml(character.displayName)}</strong>
    <span class="muted">${escapeHtml(character.publicId)} · ${escapeHtml(character.id)}</span>
    <span class="badge ${character.status === "active" ? "" : "warn"}">${escapeHtml(character.status)}</span>
  </a>`;
}

function characterDetailHtml(character, detail, activeTab = "profile") {
  const personas = itemsFromPage(detail.personas.body);
  const memory = itemsFromPage(detail.memory.body);
  const logs = itemsFromPage(detail.logs.body).filter(
    (log) => log.characterId === character.id,
  );
  return `<div class="detail-stack">
    <section class="panel">
      <div class="toolbar">
        <div>
          <h3>${escapeHtml(character.displayName)}</h3>
          <p class="muted">${escapeHtml(character.publicId)} · ${escapeHtml(character.id)}</p>
        </div>
        <div class="toolbar-actions">
          <span class="badge ${character.status === "active" ? "" : "warn"}">${escapeHtml(character.status)}</span>
          <a class="text-link" href="${characterHref()}">목록</a>
        </div>
      </div>
      ${characterTabsHtml(character.id, activeTab)}
    </section>
    ${characterTabHtml(character, personas, memory, logs, activeTab)}
  </div>`;
}

function characterTabsHtml(characterId, activeTab) {
  return `<nav class="tabs" aria-label="캐릭터 상세 탭">
    ${[
      ["profile", "프로필"],
      ["content", "콘텐츠"],
      ["persona", "페르소나"],
      ["memory", "메모리"],
      ["logs", "로그"],
    ]
      .map(
        ([tab, label]) =>
          `<a class="tab ${activeTab === tab ? "active" : ""}" href="${escapeHtml(
            characterHref({ characterId, tab }),
          )}">${label}</a>`,
      )
      .join("")}
  </nav>`;
}

function characterTabHtml(character, personas, memory, logs, activeTab) {
  if (activeTab === "content") {
    return `<div class="two-column">
      <section class="panel"><h3>피드 / 릴스 업로드</h3>${postFormHtml(character.id)}</section>
      <section class="panel"><h3>스토리 업로드</h3>${storyFormHtml(character.id)}</section>
    </div>`;
  }
  if (activeTab === "persona") {
    return `<div class="two-column">
      ${listPanel("페르소나", personas, (item) =>
        personaRow(character.id, item),
      )}
      <section class="panel">
        <h3>페르소나 추가</h3>
        <form data-action="persona-create" data-character-id="${escapeHtml(character.id)}">
          <label>제목<input name="title" maxlength="200" required /></label>
          <label>내용<textarea name="content" rows="3" maxlength="8000" required></textarea></label>
          <button type="submit">페르소나 추가</button>
        </form>
      </section>
      <section class="panel">
        <h3>페르소나 일괄 추가</h3>
        <form data-action="persona-bulk-create" data-character-id="${escapeHtml(character.id)}">
          <label>JSON 배열<textarea name="items" rows="6" placeholder='[{"title":"제목","content":"내용"}]' required></textarea></label>
          <p class="muted">배열 순서대로 정렬 번호가 자동 부여됩니다.</p>
          <button type="submit">일괄 추가</button>
        </form>
      </section>
      <section class="panel">
        <h3>순서 일괄 변경</h3>
        <form data-action="persona-reorder" data-character-id="${escapeHtml(character.id)}">
          <label>페르소나 ID 배열<textarea name="personaIds" rows="6" required>${escapeHtml(
            JSON.stringify(
              personas.map((item) => item.id),
              null,
              2,
            ),
          )}</textarea></label>
          <p class="muted">현재 순서로 채워져 있습니다. 줄 순서를 바꿔 저장하면 10, 20, 30… 으로 다시 매겨집니다. 활성 페르소나 전체가 정확히 한 번씩 포함되어야 합니다.</p>
          ${listPanel(
            "ID 참조",
            personas,
            (item) => `<div class="list-item">
              <strong>#${escapeHtml(String(item.sortOrder ?? ""))} ${escapeHtml(item.title)}</strong>
              <span class="muted">${escapeHtml(item.id)}</span>
            </div>`,
          )}
          <button type="submit">순서 저장</button>
        </form>
      </section>
    </div>`;
  }
  if (activeTab === "memory") {
    return `<div class="two-column">
      ${listPanel("메모리", memory, (item) => memoryRow(character.id, item))}
      <section class="panel">
        <h3>메모리 추가</h3>
        <form data-action="memory-create" data-character-id="${escapeHtml(character.id)}">
          <label>내용<textarea name="content" rows="3" maxlength="8000" required></textarea></label>
          <label>이유<textarea name="reason" rows="2" maxlength="1000" required></textarea></label>
          <button type="submit">메모리 추가</button>
        </form>
      </section>
      <section class="panel">
        <h3>메모리 일괄 추가</h3>
        <form data-action="memory-bulk-create" data-character-id="${escapeHtml(character.id)}">
          <label>JSON 배열<textarea name="items" rows="6" placeholder='[{"content":"내용","reason":"이유"}]' required></textarea></label>
          <button type="submit">일괄 추가</button>
        </form>
      </section>
    </div>`;
  }
  if (activeTab === "logs") {
    return `<div class="two-column">
      ${listPanel("액션 로그", logs, logRow)}
      <section class="panel"><h3>생성 작업</h3>${generationQueueForm(character.id)}</section>
      <section class="panel"><h3>게시물 작성</h3>${postFormHtml()}</section>
    </div>`;
  }
  return `<div class="two-column">
    <section class="panel">
      <h3>프로필</h3>
      <form data-action="character-update" data-character-id="${escapeHtml(character.id)}">
        <label>표시 이름<input name="displayName" value="${escapeHtml(character.displayName)}" required /></label>
        <label>Bio<textarea name="bio" rows="3" required>${escapeHtml(character.bio)}</textarea></label>
        <label>관심사<input name="interests" value="${escapeHtml((character.interests ?? []).join(", "))}" /></label>
        <button type="submit">프로필 저장</button>
      </form>
    </section>
    <section class="panel">
      <h3>상태 관리</h3>
      <form data-action="character-status" data-character-id="${escapeHtml(character.id)}">
        <label>상태<select name="status"><option value="active"${selectedOption(character.status, "active")}>active</option><option value="inactive"${selectedOption(character.status, "inactive")}>inactive</option></select></label>
        <label>이유<input name="reason" required /></label>
        <button type="submit">상태 변경</button>
      </form>
      <form data-action="character-delete" data-character-id="${escapeHtml(character.id)}">
        <label>삭제 이유<input name="reason" required /></label>
        <button type="submit">소프트 삭제</button>
      </form>
    </section>
  </div>`;
}

function personaRow(characterId, persona) {
  return `<div class="list-item">
    <strong>#${escapeHtml(String(persona.sortOrder ?? ""))} ${escapeHtml(persona.title)}</strong>
    <span class="muted">${escapeHtml(persona.content)}</span>
    <form data-action="persona-update" data-character-id="${escapeHtml(characterId)}" data-persona-id="${escapeHtml(persona.id)}">
      <label>제목<input name="title" value="${escapeHtml(persona.title)}" maxlength="200" required /></label>
      <label>내용<textarea name="content" rows="2" maxlength="8000" required>${escapeHtml(persona.content)}</textarea></label>
      <label>순서<input name="sortOrder" type="number" min="0" step="1" value="${escapeHtml(String(persona.sortOrder ?? ""))}" /></label>
      <button type="submit">저장</button>
    </form>
    <form data-action="persona-delete" data-character-id="${escapeHtml(characterId)}" data-persona-id="${escapeHtml(persona.id)}">
      <button type="submit">삭제</button>
    </form>
  </div>`;
}

function memoryRow(characterId, memory) {
  return `<div class="list-item">
    <strong>${escapeHtml(memory.content)}</strong>
    <span class="muted">${escapeHtml(memory.reason)}</span>
    <form data-action="memory-update" data-character-id="${escapeHtml(characterId)}" data-memory-id="${escapeHtml(memory.id)}">
      <label>내용<textarea name="content" rows="2" maxlength="8000" required>${escapeHtml(memory.content)}</textarea></label>
      <label>이유<textarea name="reason" rows="2" maxlength="1000" required>${escapeHtml(memory.reason)}</textarea></label>
      <button type="submit">저장</button>
    </form>
    <form data-action="memory-delete" data-character-id="${escapeHtml(characterId)}" data-memory-id="${escapeHtml(memory.id)}">
      <button type="submit">삭제</button>
    </form>
  </div>`;
}

function characterCreateForm() {
  return `<form data-action="character-create">
    <label>공개 ID<input name="publicId" autocomplete="off" required /></label>
    <label>표시 이름<input name="displayName" autocomplete="off" required /></label>
    <label>Bio<input name="bio" required /></label>
    <label>관심사<input name="interests" /></label>
    <button type="submit">생성</button>
  </form>`;
}

async function routeHtml(route) {
  if (route === "login") return loginHtml();
  if (route === "dashboard") return loadDashboardHtml();
  if (route === "users") return usersHtml();
  if (route === "characters") return charactersHtml();
  if (route === "media") return mediaHtml();
  if (route === "generation") return generationHtml();
  if (route === "moderation") return moderationHtml();
  if (route === "payments") return paymentsHtml();
  if (route === "analytics") return analyticsHtml();
  if (route === "settings") return settingsHtml();
  return settingsHtml();
}

function creditGrantForm() {
  return `<form data-action="credit-grant">
    <label>사용자 ID<input name="userId" required /></label>
    <label>금액<input name="amount" type="number" min="1" step="1" required /></label>
    <label>이유<input name="reason" required /></label>
    <button type="submit">지급</button>
  </form>`;
}

function postFormHtml(characterId = "") {
  return `<form data-action="post-create">
    <label>AI 캐릭터 ID<input name="actorId" value="${escapeHtml(characterId)}" required /></label>
    <label>콘텐츠 타입<select name="contentType"><option value="feed">feed</option><option value="reel">reel</option></select></label>
    <label>본문<textarea name="content" rows="3" required></textarea></label>
    <label>로그 이유<input name="reason" required /></label>
    <label>미디어 타입<select name="mediaType"><option value="image">image</option><option value="video">video</option></select></label>
    <label>미디어 URL<input name="mediaUrl" type="url" /></label>
    <label>미디어 파일<input name="mediaFile" type="file" accept="image/*,video/*" /></label>
    <button type="submit">게시</button>
  </form>`;
}

function storyFormHtml(characterId = "") {
  return `<form data-action="story-create">
    <label>AI 캐릭터 ID<input name="characterId" value="${escapeHtml(characterId)}" required /></label>
    <label>캡션<textarea name="caption" rows="3"></textarea></label>
    <label>로그 이유<input name="reason" required /></label>
    <label>미디어 타입<select name="mediaType"><option value="image">image</option><option value="video">video</option></select></label>
    <label>미디어 URL<input name="mediaUrl" /></label>
    <label>미디어 파일<input name="mediaFile" type="file" accept="image/*,video/*" /></label>
    <p class="muted">스토리는 생성 시점부터 24시간 노출됩니다.</p>
    <button type="submit">스토리 게시</button>
  </form>`;
}

function reportFormHtml() {
  return `<form data-action="report-update">
    <label>신고 ID<input name="reportId" required /></label>
    <label>상태<select name="status" required><option value="">선택</option><option value="reviewing">reviewing</option><option value="resolved">resolved</option><option value="rejected">rejected</option></select></label>
    <label>처리 내용<textarea name="resolution" rows="3"></textarea></label>
    <button type="submit">저장</button>
  </form>`;
}

function generationQueueForm(characterId = "") {
  return `<form data-action="generation-create">
    <label>AI 캐릭터 ID<input name="characterId" value="${escapeHtml(characterId)}" required /></label>
    <label>미디어 타입<select name="mediaType"><option value="image">image</option><option value="video">video</option></select></label>
    <label>프롬프트<textarea name="prompt" rows="4" required></textarea></label>
    <button type="submit">큐 등록</button>
  </form>`;
}

function generationHtml() {
  return `<div class="two-column">
    <section class="panel">
      <h3>생성 작업 등록</h3>
      ${generationQueueForm()}
    </section>
    <section class="panel">
      <h3>작업 액션</h3>
      <form data-action="generation-action">
        <label>작업 ID<input name="jobId" required /></label>
        <label>액션<select name="action" required><option value="">선택</option><option value="start">start</option><option value="run">run</option><option value="retry">retry</option><option value="complete">complete</option></select></label>
        <label>Provider (run)<select name="provider"><option value="">기본</option><option value="local">local</option></select></label>
        <label>Media ID (complete)<input name="mediaId" /></label>
        <label>URL (complete)<input name="url" type="url" /></label>
        <label>이유 (retry)<input name="reason" /></label>
        <button type="submit">실행</button>
      </form>
    </section>
  </div>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function checkHealth() {
  const result = await request("/api/character-action-logs");
  statusDot.classList.toggle("ok", result.ok);
  statusText.textContent = result.ok ? "정상" : "오류";
  render(result.body);
}

async function request(path, options) {
  try {
    const response = await fetch(
      path,
      adminRequestOptions(options, readAdminToken()),
    );
    const text = await response.text();
    const result = {
      ok: response.ok,
      body: parseResponseBody(text, response),
    };
    if (response.status === 401 && currentRoute() !== "login") {
      clearAdminAuth();
      updateSessionUi();
      location.hash = "login";
    }
    return result;
  } catch (error) {
    return { ok: false, body: { error: error.message } };
  }
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

function updateSessionUi() {
  const email = readAdminEmail();
  adminAuthEmail.textContent = email;
  adminAuthBox.hidden = !readAdminToken();
}

function authRedirectRoute() {
  const route = location.hash.replace(/^#/, "").split("?")[0];
  const hasToken = Boolean(readAdminToken());
  if (!hasToken && route !== "login") return "login";
  if (hasToken && route === "login") return "dashboard";
  return "";
}

export async function postPayload(
  form,
  requestFn = request,
  putObject = fetch,
) {
  const actorId = requiredField(form, "actorId");
  const contentType = requiredField(form, "contentType");
  const mediaType = requiredField(form, "mediaType");
  const file = selectedFile(form);

  return {
    actorType: "character",
    actorId,
    contentType,
    content: requiredField(form, "content"),
    reason: requiredField(form, "reason"),
    media: file
      ? [
          {
            mediaId: await uploadMedia(
              file,
              mediaType,
              requestFn,
              putObject,
              contentStoragePrefix(contentType, actorId),
            ),
          },
        ]
      : [{ mediaType, url: requiredMediaUrl(form) }],
  };
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

function setFormSubmitting(form, submitting) {
  for (const control of form.querySelectorAll(
    "button, input, select, textarea",
  )) {
    control.disabled = submitting;
  }
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
    throw new Error("S3 upload failed");
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

function render(value) {
  if (output) {
    output.textContent = JSON.stringify(value, null, 2);
  }
}
