# Admin UI Sidebar Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dependency-free sidebar Admin console with all major operations tabs and a deeper AI character management workspace.

**Architecture:** Keep the static admin package: `index.html` owns the shell, `styles.css` owns the visual system, and `main.js` owns state, routing, API calls, payload builders, and DOM rendering. Do not add a framework or backend endpoints in this pass; render action forms when the backend has actions but no list endpoint.

**Tech Stack:** Plain HTML, CSS, JavaScript modules, `fetch`, Node `node:test`, existing admin proxy.

---

## Scope Check

This is one subsystem: `packages/admin` UI. The plan exposes every requested navigation tab, but backend-free areas remain action panels using existing endpoints. Generation jobs do not get a list view because the backend has no list endpoint.

## File Structure

- Modify: `packages/admin/index.html`
  - Replace the current grid of forms with a sidebar shell, header, route title, main panel, and collapsible diagnostics panel.
- Modify: `packages/admin/styles.css`
  - Add dashboard/admin-console layout styles, tables, lists, tabs, forms, status badges, and responsive sidebar behavior.
- Modify: `packages/admin/main.js`
  - Keep one module. Add small pure helpers, hash routing, per-tab renderers, API loading, and action forms.
- Modify: `packages/admin/test/main.test.mjs`
  - Add focused tests for pure helpers and payload/action request builders.
- Modify: `packages/admin/test/smoke.test.mjs`
  - Assert the served shell contains the sidebar and main panel.

## Task 1: Pure Helpers And Tests

**Files:**
- Modify: `packages/admin/main.js`
- Modify: `packages/admin/test/main.test.mjs`

- [ ] **Step 1: Write failing tests for navigation, endpoints, and payload helpers**

Add these imports to `packages/admin/test/main.test.mjs`:

```js
import {
  characterStatusPayload,
  characterUpdatePayload,
  dashboardRequests,
  endpoint,
  navItems,
  reportUpdatePayload,
  userDetailRequests,
} from "../main.js";
```

Add these tests after the existing `postPayload` test:

```js
test("navItems exposes the sidebar tabs in order", () => {
  assert.deepEqual(
    navItems.map((item) => item.id),
    [
      "dashboard",
      "users",
      "characters",
      "media",
      "generation",
      "moderation",
      "payments",
      "analytics",
      "settings",
    ],
  );
});

test("endpoint appends defined query params only", () => {
  assert.equal(
    endpoint("/api/users", { q: "mina", cursor: "", limit: 25 }),
    "/api/users?q=mina&limit=25",
  );
});

test("dashboardRequests uses existing admin endpoints", () => {
  assert.deepEqual(dashboardRequests(), [
    { key: "analytics", path: "/api/analytics" },
    { key: "logs", path: "/api/character-action-logs" },
    { key: "reports", path: "/api/moderation/reports?status=submitted&limit=10" },
    { key: "payments", path: "/api/payments/reconciliation?status=mismatch" },
  ]);
});

test("userDetailRequests targets the selected user", () => {
  assert.deepEqual(userDetailRequests("user-1"), [
    { key: "user", path: "/api/users/user-1" },
    { key: "events", path: "/api/events?userId=user-1&limit=20" },
    { key: "hashtags", path: "/api/hashtag-preferences?userId=user-1" },
    { key: "credits", path: "/api/credits/ledger?userId=user-1&limit=20" },
  ]);
});

test("characterUpdatePayload trims editable fields", () => {
  const form = new FormData();
  form.set("displayName", " Mina ");
  form.set("bio", " City walks ");
  form.set("interests", " art, travel ,, ");

  assert.deepEqual(characterUpdatePayload(form), {
    displayName: "Mina",
    bio: "City walks",
    interests: ["art", "travel"],
  });
});

test("characterStatusPayload requires status and reason fields", () => {
  const form = new FormData();
  form.set("status", "inactive");
  form.set("reason", " policy review ");

  assert.deepEqual(characterStatusPayload(form), {
    status: "inactive",
    reason: "policy review",
  });
});

test("reportUpdatePayload trims resolution", () => {
  const form = new FormData();
  form.set("status", "resolved");
  form.set("resolution", " handled by operator ");

  assert.deepEqual(reportUpdatePayload(form), {
    status: "resolved",
    resolution: "handled by operator",
  });
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run:

```bash
npm run admin:check
```

Expected: FAIL with an ESM import error such as `does not provide an export named 'characterStatusPayload'`.

- [ ] **Step 3: Add the minimal helper exports**

In `packages/admin/main.js`, add this block after the DOM constants:

```js
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
    { key: "credits", path: endpoint("/api/credits/ledger", { userId, limit: 20 }) },
  ];
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

export function reportUpdatePayload(form) {
  return {
    status: String(form.get("status") ?? "").trim(),
    resolution: String(form.get("resolution") ?? "").trim(),
  };
}
```

- [ ] **Step 4: Run the tests and verify pass**

Run:

```bash
npm run admin:check
```

Expected: PASS for all `packages/admin` node tests.

- [ ] **Step 5: Commit helper work**

Run:

```bash
git add packages/admin/main.js packages/admin/test/main.test.mjs
git commit -m "Add admin UI helper coverage"
```

## Task 2: Sidebar Shell

**Files:**
- Modify: `packages/admin/index.html`
- Modify: `packages/admin/styles.css`
- Modify: `packages/admin/main.js`
- Modify: `packages/admin/test/smoke.test.mjs`

- [ ] **Step 1: Write the shell smoke assertion**

In `packages/admin/test/smoke.test.mjs`, change the shell test body to store the HTML and assert the new landmarks:

```js
  const html = await response.text();
  assert.match(html, /AI SNS Admin/);
  assert.match(html, /id="sidebarNav"/);
  assert.match(html, /id="mainPanel"/);
  assert.match(html, /data-route="characters"/);
```

- [ ] **Step 2: Run the smoke test and verify failure**

Run:

```bash
npm --workspace @ai-sns/admin run check
```

Expected: FAIL because `sidebarNav`, `mainPanel`, and `data-route="characters"` are not in `index.html`.

- [ ] **Step 3: Replace the body shell**

In `packages/admin/index.html`, replace everything inside `<body>` with:

```html
    <div class="admin-shell">
      <aside class="sidebar" aria-label="Admin navigation">
        <div class="brand">
          <p class="eyebrow">AI SNS</p>
          <h1>Admin</h1>
        </div>
        <nav id="sidebarNav" class="sidebar-nav">
          <button type="button" data-route="dashboard">대시보드</button>
          <button type="button" data-route="users">사용자</button>
          <button type="button" data-route="characters">AI 캐릭터</button>
          <button type="button" data-route="media">콘텐츠 / 미디어</button>
          <button type="button" data-route="generation">생성 작업</button>
          <button type="button" data-route="moderation">신고 / 모더레이션</button>
          <button type="button" data-route="payments">결제 / 정산</button>
          <button type="button" data-route="analytics">분석 / 로그</button>
          <button type="button" data-route="settings">설정</button>
        </nav>
        <div class="sidebar-status" aria-live="polite">
          <span class="status-dot" id="statusDot"></span>
          <span id="statusText">대기 중</span>
        </div>
      </aside>

      <main class="admin-main">
        <header class="workspace-header">
          <div>
            <p class="eyebrow" id="routeEyebrow">운영 콘솔</p>
            <h2 id="routeTitle">대시보드</h2>
          </div>
          <button id="healthButton" type="button">상태 확인</button>
        </header>

        <section id="mainPanel" class="workspace" aria-live="polite"></section>

        <details class="diagnostics">
          <summary>API 응답</summary>
          <pre id="output">{}</pre>
        </details>
      </main>
    </div>

    <script type="module" src="./main.js"></script>
```

- [ ] **Step 4: Add shell styles**

Replace the layout-specific CSS in `packages/admin/styles.css` with these sections, keeping the `:root`, `*`, `body`, `button,input,select,textarea`, `h1,h2`, `status-dot`, `pre`, and media query structure:

```css
.admin-shell {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  min-height: 100vh;
}

.sidebar {
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: 20px;
  min-width: 0;
  padding: 22px 14px;
  color: #cbd5e1;
  background: #111827;
}

.brand h1 {
  color: #ffffff;
}

.sidebar-nav {
  display: grid;
  gap: 6px;
  align-content: start;
}

.sidebar-nav button {
  justify-content: flex-start;
  width: 100%;
  color: #cbd5e1;
  background: transparent;
  text-align: left;
}

.sidebar-nav button:hover,
.sidebar-nav button.active {
  color: #ffffff;
  background: #146c94;
}

.sidebar-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid #334155;
  color: #cbd5e1;
}

.admin-main {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  min-width: 0;
  min-height: 100vh;
}

.workspace-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px clamp(18px, 3vw, 32px);
  background: #ffffff;
  border-bottom: 1px solid var(--line);
}

.workspace {
  min-width: 0;
  padding: 18px clamp(18px, 3vw, 32px);
  overflow: auto;
}

.dashboard-grid,
.two-column,
.three-column {
  display: grid;
  gap: 14px;
}

.dashboard-grid {
  grid-template-columns: repeat(4, minmax(160px, 1fr));
}

.two-column {
  grid-template-columns: minmax(280px, 0.9fr) minmax(360px, 1.4fr);
}

.three-column {
  grid-template-columns: 300px minmax(420px, 1fr) 320px;
}

.panel {
  display: grid;
  gap: 14px;
  min-width: 0;
  padding: 16px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
}

.list {
  display: grid;
  gap: 8px;
}

.list-item {
  display: grid;
  gap: 4px;
  padding: 10px;
  background: #ffffff;
  border: 1px solid var(--line);
  border-radius: 7px;
}

.list-item.selected {
  border-color: #9bc7dd;
  background: #eef7fb;
}

.muted {
  color: var(--muted);
}

.badge {
  display: inline-flex;
  width: fit-content;
  padding: 2px 7px;
  color: #0f5132;
  background: #e7f7ee;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.badge.warn {
  color: #7a4200;
  background: #fff3d6;
}

.diagnostics {
  margin: 0 clamp(18px, 3vw, 32px) 18px;
}
```

Update the existing media query to:

```css
@media (max-width: 960px) {
  .admin-shell {
    grid-template-columns: 1fr;
  }

  .sidebar {
    grid-template-rows: auto auto;
  }

  .sidebar-status {
    display: none;
  }

  .dashboard-grid,
  .two-column,
  .three-column {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 5: Add sidebar route binding**

In `packages/admin/main.js`, add DOM constants:

```js
const mainPanel = hasDocument ? document.querySelector("#mainPanel") : undefined;
const routeTitle = hasDocument ? document.querySelector("#routeTitle") : undefined;
const routeEyebrow = hasDocument
  ? document.querySelector("#routeEyebrow")
  : undefined;
const sidebarNav = hasDocument ? document.querySelector("#sidebarNav") : undefined;
```

Replace the current `if (hasDocument) { ... }` block with:

```js
if (hasDocument) {
  document
    .querySelector("#healthButton")
    .addEventListener("click", checkHealth);
  sidebarNav.addEventListener("click", (event) => {
    const button = event.target.closest("[data-route]");
    if (button) {
      location.hash = button.dataset.route;
    }
  });
  window.addEventListener("hashchange", renderCurrentRoute);
  renderCurrentRoute();
}
```

Add these functions near the top-level UI functions:

```js
function currentRoute() {
  const route = location.hash.replace(/^#/, "");
  return navItems.some((item) => item.id === route) ? route : "dashboard";
}

function setActiveRoute(route) {
  const item = navItems.find((candidate) => candidate.id === route);
  routeTitle.textContent = item?.label ?? "대시보드";
  routeEyebrow.textContent = "운영 콘솔";
  for (const button of sidebarNav.querySelectorAll("[data-route]")) {
    button.classList.toggle("active", button.dataset.route === route);
  }
}

async function renderCurrentRoute() {
  const route = currentRoute();
  setActiveRoute(route);
  mainPanel.innerHTML = `<section class="panel"><p class="muted">불러오는 중</p></section>`;
  mainPanel.innerHTML = await routeHtml(route);
}

async function routeHtml(route) {
  if (route === "dashboard") {
    return `<section class="panel"><h3>대시보드</h3><p class="muted">운영 요약을 불러옵니다.</p></section>`;
  }
  return `<section class="panel"><h3>${escapeHtml(
    navItems.find((item) => item.id === route)?.label ?? route,
  )}</h3><p class="muted">이 탭은 다음 작업에서 연결합니다.</p></section>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
```

- [ ] **Step 6: Run tests and verify pass**

Run:

```bash
npm --workspace @ai-sns/admin run check
```

Expected: PASS.

- [ ] **Step 7: Commit shell work**

Run:

```bash
git add packages/admin/index.html packages/admin/styles.css packages/admin/main.js packages/admin/test/smoke.test.mjs
git commit -m "Add admin sidebar shell"
```

## Task 3: Dashboard And Secondary Tabs

**Files:**
- Modify: `packages/admin/main.js`
- Modify: `packages/admin/test/main.test.mjs`

- [ ] **Step 1: Add tests for page item helpers and action request builders**

Add these imports:

```js
import {
  generationActionRequest,
  itemsFromPage,
  paymentDetailRequest,
} from "../main.js";
```

Add these tests:

```js
test("itemsFromPage accepts page objects and arrays", () => {
  assert.deepEqual(itemsFromPage({ items: [{ id: "one" }] }), [{ id: "one" }]);
  assert.deepEqual(itemsFromPage([{ id: "two" }]), [{ id: "two" }]);
  assert.deepEqual(itemsFromPage(null), []);
});

test("generationActionRequest builds existing job action endpoints", () => {
  assert.deepEqual(generationActionRequest("job-1", "retry", { reason: "bad" }), {
    path: "/api/generation/jobs/job-1/retry",
    options: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "bad" }),
    },
  });
});

test("paymentDetailRequest targets payment detail endpoint", () => {
  assert.equal(paymentDetailRequest("pay-1"), "/api/payments/pay-1");
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm run admin:check
```

Expected: FAIL with missing exports.

- [ ] **Step 3: Add helper implementations**

Add this block to `packages/admin/main.js` near the existing helper exports:

```js
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
```

- [ ] **Step 4: Add request loaders**

Add these functions to `packages/admin/main.js`:

```js
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
      ${listPanel("운영 큐", [
        ...itemsFromPage(data.reports.body).map((item) => ({
          title: `신고 ${item.id}`,
          subtitle: `${item.targetType} · ${item.status}`,
        })),
        ...itemsFromPage(data.payments.body).map((item) => ({
          title: `결제 ${item.paymentId}`,
          subtitle: `${item.providerStatus} / ${item.ledgerStatus}`,
        })),
      ], simpleRow)}
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
  return metrics.length ? metrics.map((item) => `${item.name}: ${item.value}`).join(" / ") : "0";
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
```

- [ ] **Step 5: Add secondary tab renderers**

Add these functions to `packages/admin/main.js`:

```js
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
        subtitle: media.uploadedAt ? `uploaded ${media.uploadedAt}` : "업로드 대기",
      }),
    )}
    <section class="panel"><h3>게시물 작성</h3>${postFormHtml()}</section>
  </div>`;
}

async function moderationHtml() {
  const result = await request(endpoint("/api/moderation/reports", { limit: 25 }));
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
  return `<div class="two-column">
    ${listPanel("지표", data.analytics.body?.metrics ?? [], (metric) =>
      simpleRow({ title: metric.name, subtitle: String(metric.value) }),
    )}
    ${listPanel("액션 로그", itemsFromPage(data.logs.body), logRow)}
  </div>`;
}

function settingsHtml() {
  return `<section class="panel"><h3>설정</h3><p class="muted">현재 버전은 운영 상태 확인만 제공합니다. 권한 관리는 백엔드 역할 모델이 생긴 뒤 추가합니다.</p></section>`;
}
```

Replace `routeHtml(route)` with:

```js
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
```

- [ ] **Step 6: Add small form HTML helpers used by secondary tabs**

Add these functions to `packages/admin/main.js`:

```js
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
    <label>상태<select name="status"><option value="submitted">submitted</option><option value="reviewing">reviewing</option><option value="resolved">resolved</option><option value="dismissed">dismissed</option></select></label>
    <label>처리 내용<textarea name="resolution" rows="3"></textarea></label>
    <button type="submit">저장</button>
  </form>`;
}
```

- [ ] **Step 7: Run tests and verify pass**

Run:

```bash
npm run admin:check
```

Expected: PASS.

- [ ] **Step 8: Commit secondary tabs**

Run:

```bash
git add packages/admin/main.js packages/admin/test/main.test.mjs
git commit -m "Add admin secondary tab renderers"
```

## Task 4: AI Character Workspace

**Files:**
- Modify: `packages/admin/main.js`
- Modify: `packages/admin/test/main.test.mjs`

- [ ] **Step 1: Add tests for character workspace requests**

Add these imports:

```js
import {
  characterCreatePayload,
  characterDetailRequests,
  memoryPayload,
} from "../main.js";
```

Add these tests:

```js
test("characterDetailRequests fetches memory and logs for selected character", () => {
  assert.deepEqual(characterDetailRequests("char-1"), [
    { key: "memory", path: "/api/characters/char-1/memory" },
    { key: "logs", path: "/api/character-action-logs" },
  ]);
});

test("characterCreatePayload builds character create body", () => {
  const form = new FormData();
  form.set("publicId", "mina_ai");
  form.set("displayName", "Mina");
  form.set("bio", "City walks");
  form.set("interests", "art, travel");

  assert.deepEqual(characterCreatePayload(form), {
    publicId: "mina_ai",
    displayName: "Mina",
    bio: "City walks",
    interests: ["art", "travel"],
  });
});

test("memoryPayload trims content and reason", () => {
  const form = new FormData();
  form.set("content", " city night ");
  form.set("reason", " operator note ");

  assert.deepEqual(memoryPayload(form), {
    content: "city night",
    reason: "operator note",
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm run admin:check
```

Expected: FAIL with missing exports.

- [ ] **Step 3: Add character helper exports**

Add this block to `packages/admin/main.js`:

```js
export function characterDetailRequests(characterId) {
  return [
    { key: "memory", path: `/api/characters/${characterId}/memory` },
    { key: "logs", path: "/api/character-action-logs" },
  ];
}

export function characterCreatePayload(form) {
  return {
    publicId: String(form.get("publicId") ?? "").trim(),
    displayName: String(form.get("displayName") ?? "").trim(),
    bio: String(form.get("bio") ?? "").trim(),
    interests: splitCsv(form.get("interests")),
  };
}

export function memoryPayload(form) {
  return {
    content: String(form.get("content") ?? "").trim(),
    reason: String(form.get("reason") ?? "").trim(),
  };
}
```

Change the existing `characterPayload(form)` to:

```js
function characterPayload(form) {
  return characterCreatePayload(form);
}
```

- [ ] **Step 4: Add character workspace renderer**

Add this function to `packages/admin/main.js`:

```js
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
        <button type="button" data-action-open="character-create">+ 생성</button>
      </div>
      <div class="list">
        ${
          characters.length
            ? characters.map((character, index) => characterRow(character, index === 0)).join("")
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
      <label>상태<select name="status"><option value="active">active</option><option value="inactive">inactive</option></select></label>
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
```

- [ ] **Step 5: Add generation panel helper**

Add this function to `packages/admin/main.js`:

```js
function generationQueueForm(characterId = "") {
  return `<form data-action="generation-create">
    <label>AI 캐릭터 ID<input name="characterId" value="${escapeHtml(characterId)}" required /></label>
    <label>미디어 타입<select name="mediaType"><option value="image">image</option><option value="video">video</option></select></label>
    <label>프롬프트<textarea name="prompt" rows="4" required></textarea></label>
    <button type="submit">큐 등록</button>
  </form>`;
}
```

Replace the old `generationPayload(form)` with:

```js
function generationPayload(form) {
  return {
    characterId: String(form.get("characterId") ?? "").trim(),
    mediaType: String(form.get("mediaType") ?? "").trim(),
    prompt: String(form.get("prompt") ?? "").trim(),
  };
}
```

- [ ] **Step 6: Add generation tab renderer**

Add this function to `packages/admin/main.js`:

```js
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
        <label>액션<select name="action"><option value="start">start</option><option value="run">run</option><option value="retry">retry</option><option value="complete">complete</option></select></label>
        <label>Provider (run)<input name="provider" /></label>
        <label>Media ID (complete)<input name="mediaId" /></label>
        <label>URL (complete)<input name="url" type="url" /></label>
        <label>이유 (retry)<input name="reason" /></label>
        <button type="submit">실행</button>
      </form>
    </section>
  </div>`;
}
```

- [ ] **Step 7: Run tests and verify pass**

Run:

```bash
npm run admin:check
```

Expected: PASS.

- [ ] **Step 8: Commit character workspace**

Run:

```bash
git add packages/admin/main.js packages/admin/test/main.test.mjs
git commit -m "Add AI character admin workspace"
```

## Task 5: Form Actions And Inline Results

**Files:**
- Modify: `packages/admin/main.js`
- Modify: `packages/admin/test/main.test.mjs`

- [ ] **Step 1: Add tests for generation action payload selection**

Add this import:

```js
import { generationActionBody } from "../main.js";
```

Add this test:

```js
test("generationActionBody keeps fields relevant to the selected action", () => {
  const form = new FormData();
  form.set("provider", "openai");
  form.set("mediaId", "media-1");
  form.set("url", "https://cdn.example/image.png");
  form.set("reason", "operator retry");

  assert.deepEqual(generationActionBody("run", form), { provider: "openai" });
  assert.deepEqual(generationActionBody("retry", form), {
    reason: "operator retry",
  });
  assert.deepEqual(generationActionBody("complete", form), {
    mediaId: "media-1",
    url: "https://cdn.example/image.png",
  });
  assert.deepEqual(generationActionBody("start", form), {});
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm run admin:check
```

Expected: FAIL with missing `generationActionBody` export.

- [ ] **Step 3: Add generation action body helper**

Add this function to `packages/admin/main.js`:

```js
export function generationActionBody(action, form) {
  if (action === "run") {
    return compactBody({ provider: form.get("provider") });
  }
  if (action === "retry") {
    return compactBody({ reason: form.get("reason") });
  }
  if (action === "complete") {
    return compactBody({
      mediaId: form.get("mediaId"),
      url: form.get("url"),
    });
  }
  return {};
}

function compactBody(input) {
  return Object.fromEntries(
    Object.entries(input)
      .map(([key, value]) => [key, String(value ?? "").trim()])
      .filter(([, value]) => value),
  );
}
```

- [ ] **Step 4: Replace old form binding with delegated action handling**

Remove these old calls from the `if (hasDocument)` block if they remain:

```js
  bindJsonForm("#characterForm", "/api/characters", characterPayload);
  bindJsonForm("#postForm", "/api/posts", postPayload);
  bindJsonForm("#generationForm", "/api/generation/jobs", generationPayload);
  bindJsonForm("#creditForm", "/api/credits/grants", creditPayload);
```

Add delegated form handling inside the `if (hasDocument)` block:

```js
  mainPanel.addEventListener("submit", submitActionForm);
```

Add this function:

```js
async function submitActionForm(event) {
  const form = event.target.closest("form[data-action]");
  if (!form) return;
  event.preventDefault();

  const button = form.querySelector("button[type='submit']");
  if (button) button.disabled = true;

  let result;
  try {
    result = await runFormAction(form);
  } catch (error) {
    result = { ok: false, body: { error: error.message } };
  } finally {
    if (button) button.disabled = false;
  }

  render(result.body);
  form.insertAdjacentHTML(
    "beforeend",
    `<p class="${result.ok ? "muted" : "error"}">${escapeHtml(
      result.ok ? "완료" : errorMessage(result.body, "요청 실패"),
    )}</p>`,
  );
  if (result.ok) {
    await renderCurrentRoute();
  }
}
```

- [ ] **Step 5: Add action router**

Add this function:

```js
async function runFormAction(form) {
  const action = form.dataset.action;
  const data = new FormData(form);

  if (action === "character-create") {
    return postJson("/api/characters", characterCreatePayload(data));
  }
  if (action === "character-update") {
    return patchJson(
      `/api/characters/${form.dataset.characterId}`,
      characterUpdatePayload(data),
    );
  }
  if (action === "character-status") {
    return patchJson(
      `/api/characters/${form.dataset.characterId}/status`,
      characterStatusPayload(data),
    );
  }
  if (action === "memory-create") {
    return postJson(
      `/api/characters/${form.dataset.characterId}/memory`,
      memoryPayload(data),
    );
  }
  if (action === "post-create") {
    return postJson("/api/posts", await postPayload(data));
  }
  if (action === "generation-create") {
    return postJson("/api/generation/jobs", generationPayload(data));
  }
  if (action === "generation-action") {
    const selected = String(data.get("action") ?? "").trim();
    const { path, options } = generationActionRequest(
      String(data.get("jobId") ?? "").trim(),
      selected,
      generationActionBody(selected, data),
    );
    return request(path, options);
  }
  if (action === "credit-grant") {
    return postJson("/api/credits/grants", creditPayload(data));
  }
  if (action === "report-update") {
    return patchJson(
      `/api/moderation/reports/${String(data.get("reportId") ?? "").trim()}`,
      reportUpdatePayload(data),
    );
  }
  return { ok: false, body: { error: `Unknown action: ${action}` } };
}

function postJson(path, body) {
  return request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patchJson(path, body) {
  return request(path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
```

- [ ] **Step 6: Add error style**

Add this to `packages/admin/styles.css`:

```css
.error {
  margin: 0;
  color: #b42318;
  font-weight: 700;
}
```

- [ ] **Step 7: Run tests and verify pass**

Run:

```bash
npm run admin:check
```

Expected: PASS.

- [ ] **Step 8: Commit actions**

Run:

```bash
git add packages/admin/main.js packages/admin/styles.css packages/admin/test/main.test.mjs
git commit -m "Wire admin sidebar actions"
```

## Task 6: Verification And Manual QA

**Files:**
- Modify only files that fail verification because of this implementation.

- [ ] **Step 1: Run package tests**

Run:

```bash
npm run admin:check
```

Expected: PASS.

- [ ] **Step 2: Run root UI checks**

Run:

```bash
npm --workspace @ai-sns/admin run check
```

Expected: PASS.

- [ ] **Step 3: Start the admin UI**

Run:

```bash
npm run admin:dev
```

Expected: terminal prints an Admin UI localhost URL.

- [ ] **Step 4: Manual browser QA**

Open the printed URL and verify:

- Sidebar tabs switch without a full page reload.
- Dashboard renders metric cards and operation lists, even when API responses are empty.
- AI Characters tab renders the list/detail layout.
- Creating or updating a character shows a short result and refreshes the route.
- Reports, payments, users, media, generation, analytics, and settings tabs all render a panel.
- A failed API call shows an inline error and the diagnostics panel contains the raw response.

- [ ] **Step 5: Stop the dev server**

Stop the `npm run admin:dev` process with `Ctrl-C`.

- [ ] **Step 6: Commit any verification fixes**

If verification required fixes, run:

```bash
git add packages/admin/index.html packages/admin/main.js packages/admin/styles.css packages/admin/test/main.test.mjs packages/admin/test/smoke.test.mjs
git commit -m "Polish admin sidebar console"
```

If no fixes were needed, do not create an empty commit.

## Self-Review

- Spec coverage: Dashboard, Users, AI Characters, Content / Media, Generation Jobs, Reports / Moderation, Payments / Reconciliation, Analytics / Logs, Settings, diagnostics, and existing form actions all map to tasks above.
- Backend boundary: The plan uses existing endpoints only. Generation job list is not invented.
- Red-flag scan: No task asks the implementer to fill unspecified behavior.
- Type consistency: Helper names used in tests match implementation steps.
