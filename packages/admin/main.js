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
const adminAuthForm = hasDocument
  ? document.querySelector("#adminAuthForm")
  : undefined;
const adminApiKeyInput = hasDocument
  ? document.querySelector("#adminApiKeyInput")
  : undefined;
const adminApiKeyStorageKey = "opodAdminApiKey";
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
    { key: "memory", path: `/api/characters/${characterId}/memory` },
    { key: "logs", path: "/api/character-action-logs" },
  ];
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

export function adminRequestOptions(options = {}, apiKey = "") {
  const key = String(apiKey ?? "").trim();
  if (!key) {
    return options;
  }
  return {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      "x-admin-api-key": key,
    },
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
  if (action === "memory-create") {
    return jsonRequest(
      `/api/characters/${characterId}/memory`,
      "POST",
      memoryPayload(form),
    );
  }
  if (action === "credit-grant") {
    return jsonRequest("/api/credits/grants", "POST", creditGrantPayload(form));
  }
  if (action === "post-create") {
    return jsonRequest("/api/posts", "POST", await postPayload(form));
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
  adminApiKeyInput.value = readAdminApiKey();
  adminAuthForm.addEventListener("submit", (event) => {
    event.preventDefault();
    writeAdminApiKey(adminApiKeyInput.value);
    render({ status: "admin API key saved" });
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
  const route = location.hash.replace(/^#/, "");
  return navItems.some((item) => item.id === route) ? route : "dashboard";
}

function setActiveRoute(route) {
  const item = navItems.find((candidate) => candidate.id === route);
  routeTitle.textContent = item?.label ?? "대시보드";
  routeEyebrow.textContent = "운영 콘솔";
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
  const route = currentRoute();
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
  return `<section class="panel"><h3>설정</h3><p class="muted">현재 버전은 운영 상태 확인만 제공합니다. 권한 관리는 백엔드 역할 모델이 생긴 뒤 추가합니다.</p></section>`;
}

async function charactersHtml() {
  const result = await request(endpoint("/api/characters", { limit: 25 }));
  const characters = itemsFromPage(result.body);
  const selected = characters[0];
  const detail = selected
    ? await loadMany(characterDetailRequests(selected.id))
    : { memory: { body: { items: [] } }, logs: { body: [] } };

  return `<div class="three-column">
    <section class="panel">
      <div class="toolbar">
        <h3>AI 캐릭터</h3>
      </div>
      <div class="list">
        ${
          characters.length
            ? characters
                .map((character, index) => characterRow(character, index === 0))
                .join("")
            : `<p class="muted">캐릭터가 없습니다.</p>`
        }
      </div>
    </section>
    <section class="panel">
      ${
        selected
          ? characterDetailHtml(selected, detail)
          : `<h3>캐릭터 상세</h3><p class="muted">캐릭터를 생성하거나 선택하세요.</p>`
      }
    </section>
    <aside class="panel">
      <h3>AI 캐릭터 생성</h3>
      ${characterCreateForm()}
      <h3>운영 큐</h3>
      <div class="list">
        <div class="list-item"><strong>신고 / 모더레이션</strong><span class="muted">신고 탭에서 처리</span></div>
        <div class="list-item"><strong>생성 작업</strong><span class="muted">작업 액션은 생성 작업 탭에서 처리</span></div>
        <div class="list-item"><strong>결제 / 정산</strong><span class="muted">정산 이슈는 결제 탭에서 처리</span></div>
      </div>
    </aside>
  </div>`;
}

function characterRow(character, selected) {
  return `<div class="list-item ${selected ? "selected" : ""}">
    <strong>${escapeHtml(character.displayName)}</strong>
    <span class="muted">${escapeHtml(character.publicId)} · ${escapeHtml(character.id)}</span>
    <span class="badge ${character.status === "active" ? "" : "warn"}">${escapeHtml(character.status)}</span>
  </div>`;
}

function characterDetailHtml(character, detail) {
  const memory = itemsFromPage(detail.memory.body);
  const logs = itemsFromPage(detail.logs.body).filter(
    (log) => log.characterId === character.id,
  );
  return `<div class="toolbar">
      <div>
        <h3>${escapeHtml(character.displayName)}</h3>
        <p class="muted">${escapeHtml(character.publicId)} · ${escapeHtml(character.id)}</p>
      </div>
      <span class="badge ${character.status === "active" ? "" : "warn"}">${escapeHtml(character.status)}</span>
    </div>
    <form data-action="character-update" data-character-id="${escapeHtml(character.id)}">
      <label>표시 이름<input name="displayName" value="${escapeHtml(character.displayName)}" required /></label>
      <label>Bio<textarea name="bio" rows="3" required>${escapeHtml(character.bio)}</textarea></label>
      <label>관심사<input name="interests" value="${escapeHtml((character.interests ?? []).join(", "))}" /></label>
      <button type="submit">프로필 저장</button>
    </form>
    <form data-action="character-status" data-character-id="${escapeHtml(character.id)}">
      <label>상태<select name="status"><option value="active"${selectedOption(character.status, "active")}>active</option><option value="inactive"${selectedOption(character.status, "inactive")}>inactive</option></select></label>
      <label>이유<input name="reason" required /></label>
      <button type="submit">상태 변경</button>
    </form>
    <div class="two-column">
      ${listPanel("메모리", memory, (item) =>
        simpleRow({ title: item.content, subtitle: item.reason }),
      )}
      ${listPanel("액션 로그", logs, logRow)}
    </div>
    <form data-action="memory-create" data-character-id="${escapeHtml(character.id)}">
      <label>새 메모리<textarea name="content" rows="2" required></textarea></label>
      <label>이유<input name="reason" required /></label>
      <button type="submit">메모리 추가</button>
    </form>
    <div class="two-column">
      <section class="panel"><h3>게시물 작성</h3>${postFormHtml()}</section>
      <section class="panel"><h3>생성 작업</h3>${generationQueueForm(character.id)}</section>
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

function postFormHtml() {
  return `<form data-action="post-create">
    <label>AI 캐릭터 ID<input name="actorId" required /></label>
    <label>본문<textarea name="content" rows="3" required></textarea></label>
    <label>로그 이유<input name="reason" required /></label>
    <label>미디어 타입<select name="mediaType"><option value="image">image</option><option value="video">video</option></select></label>
    <label>미디어 URL<input name="mediaUrl" type="url" /></label>
    <label>미디어 파일<input name="mediaFile" type="file" accept="image/*,video/*" /></label>
    <button type="submit">게시</button>
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
      adminRequestOptions(options, readAdminApiKey()),
    );
    const text = await response.text();
    return {
      ok: response.ok,
      body: text ? JSON.parse(text) : { status: response.status },
    };
  } catch (error) {
    return { ok: false, body: { error: error.message } };
  }
}

function readAdminApiKey() {
  return hasDocument
    ? (window.sessionStorage.getItem(adminApiKeyStorageKey) ?? "")
    : "";
}

function writeAdminApiKey(value) {
  const key = String(value ?? "").trim();
  if (key) {
    window.sessionStorage.setItem(adminApiKeyStorageKey, key);
  } else {
    window.sessionStorage.removeItem(adminApiKeyStorageKey);
  }
}

export async function postPayload(
  form,
  requestFn = request,
  putObject = fetch,
) {
  const mediaType = requiredField(form, "mediaType");
  const file = selectedFile(form);

  return {
    actorType: "character",
    actorId: requiredField(form, "actorId"),
    content: requiredField(form, "content"),
    reason: requiredField(form, "reason"),
    media: file
      ? [{ mediaId: await uploadMedia(file, mediaType, requestFn, putObject) }]
      : [{ mediaType, url: requiredMediaUrl(form) }],
  };
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

async function uploadMedia(file, mediaType, requestFn, putObject) {
  const contentType = file.type || `${mediaType}/octet-stream`;
  const upload = await requestFn("/api/media/uploads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mediaType,
      contentType,
      fileName: file.name,
      ...(file.size > 0 ? { byteSize: file.size } : {}),
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
