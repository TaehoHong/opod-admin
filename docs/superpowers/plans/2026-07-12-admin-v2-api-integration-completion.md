# Admin v2 API Integration Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the interrupted Admin console v2 work so the existing screens fully use the new character, post, generation-job, user, and hashtag analytics API contracts.

**Architecture:** Preserve the framework-free hash-routed SPA and its delegated event handling. Add only small pure helpers for state and request decisions that need focused Node tests, then use those helpers inside the existing renderers and click handler.

**Tech Stack:** Vanilla JavaScript ES modules, Node.js test runner, NestJS build, Prettier, existing Broadsheet HTML/CSS.

## Global Constraints

- Preserve the previous Claude session's uncommitted `packages/admin/main.js` work.
- Do not add routes, dependencies, backend changes, story UI, or payment-table expansion.
- Reuse `itemsFromPage()`, `generationActionRequest()`, `submitViaSpec()`, and existing dialogs.
- Write each behavior test first and confirm that it fails for the intended missing behavior before production changes.
- Keep all UI output escaped through the existing `escapeHtml()` and `attr()` helpers.

---

### Task 1: Complete post selection state and navigation

**Files:**
- Modify: `packages/admin/test/main.test.mjs`
- Modify: `packages/admin/main.js`

**Interfaces:**
- Consumes: the existing `ui.selPostId`, delegated `handleClick()`, and `renderApp()`.
- Produces: `postSelectionAfterAction(action, currentPostId, selectedPostId)` returning the selected post ID or `null`.

- [ ] **Step 1: Add the failing state-transition test**

Add `postSelectionAfterAction` to the import list and add:

```js
test("post selection actions open, close, and reset post detail", () => {
  assert.equal(
    postSelectionAfterAction("select-post", null, "post-1"),
    "post-1",
  );
  assert.equal(postSelectionAfterAction("back-posts", "post-1"), null);
  assert.equal(
    postSelectionAfterAction("sidebar-navigation", "post-1"),
    null,
  );
  assert.equal(
    postSelectionAfterAction("unrelated", "post-1", "post-2"),
    "post-1",
  );
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm run admin:check -- --test-name-pattern="post selection actions"`

Expected: FAIL because `postSelectionAfterAction` is not exported.

- [ ] **Step 3: Add the minimal state helper**

Add near the existing route/state helpers:

```js
export function postSelectionAfterAction(
  action,
  currentPostId,
  selectedPostId = "",
) {
  if (action === "select-post") return selectedPostId || null;
  if (action === "back-posts" || action === "sidebar-navigation") return null;
  return currentPostId;
}
```

Use it in `handleClick()`:

```js
if (navBtn) {
  ui.selMediaId = ui.selUserId = ui.selPayId = null;
  ui.selPostId = postSelectionAfterAction(
    "sidebar-navigation",
    ui.selPostId,
  );
  location.hash = navBtn.dataset.route;
  return;
}

if (act === "select-post" || act === "back-posts") {
  ui.selPostId = postSelectionAfterAction(
    act,
    ui.selPostId,
    el.dataset.id,
  );
  renderApp();
  return;
}
```

- [ ] **Step 4: Run the focused test and full Admin UI suite**

Run: `npm run admin:check -- --test-name-pattern="post selection actions"`

Expected: PASS.

Run: `npm run admin:check`

Expected: all Admin UI tests PASS.

- [ ] **Step 5: Review the post list/detail behavior**

Confirm `renderPosts()` reads `ui.selPostId`, post rows use
`data-act="select-post"`, both detail back buttons use
`data-act="back-posts"`, and inner comment/reaction buttons remain the closest
delegated action.

### Task 2: Connect generation run and retry buttons

**Files:**
- Modify: `packages/admin/test/main.test.mjs`
- Modify: `packages/admin/main.js`

**Interfaces:**
- Consumes: `generationActionRequest(jobId, action, body)`.
- Produces: `generationClickRequest(clickAction, jobId)` returning a request spec or `null`.

- [ ] **Step 1: Add the failing click-to-request test**

Add `generationClickRequest` to the import list and add:

```js
test("generation click actions map to runnable job endpoints", () => {
  assert.deepEqual(generationClickRequest("job-run", "job-1"), {
    path: "/api/generation/jobs/job-1/run",
    options: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    },
  });
  assert.deepEqual(generationClickRequest("job-retry", "job-2"), {
    path: "/api/generation/jobs/job-2/retry",
    options: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    },
  });
  assert.equal(generationClickRequest("job-complete", "job-3"), null);
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm run admin:check -- --test-name-pattern="generation click actions"`

Expected: FAIL because `generationClickRequest` is not exported.

- [ ] **Step 3: Add the minimal request mapping**

Add beside `generationActionRequest()`:

```js
export function generationClickRequest(clickAction, jobId) {
  if (clickAction === "job-run") {
    return generationActionRequest(jobId, "run");
  }
  if (clickAction === "job-retry") {
    return generationActionRequest(jobId, "retry");
  }
  return null;
}
```

Connect it in `handleClick()` before unrelated action branches:

```js
const generationRequest = generationClickRequest(act, el.dataset.id);
if (generationRequest) {
  event.stopPropagation();
  const result = await submitViaSpec(
    generationRequest,
    act === "job-run"
      ? "생성 작업을 실행했습니다."
      : "생성 작업을 재시도 큐에 등록했습니다.",
  );
  if (result.ok) renderApp();
  return;
}
```

- [ ] **Step 4: Run focused and full Admin UI tests**

Run: `npm run admin:check -- --test-name-pattern="generation click actions"`

Expected: PASS.

Run: `npm run admin:check`

Expected: all Admin UI tests PASS.

- [ ] **Step 5: Review lifecycle coverage**

Confirm queued rows expose `job-run`, running rows open the existing
`complete-job` dialog, completed rows expose `job-retry`, and each successful
mutation refreshes the table.

### Task 3: Use authoritative user counts and balance

**Files:**
- Modify: `packages/admin/test/main.test.mjs`
- Modify: `packages/admin/main.js`

**Interfaces:**
- Consumes: `followCount` from user list/detail responses and `creditBalance` from the detail response.
- Produces: `adminUserStats(user)` returning normalized numeric display values.

- [ ] **Step 1: Add the failing response-mapping test**

Add `adminUserStats` to the import list and add:

```js
test("adminUserStats uses authoritative user count and balance fields", () => {
  assert.deepEqual(
    adminUserStats({ followCount: 7, creditBalance: 108 }),
    { followCount: 7, creditBalance: 108 },
  );
  assert.deepEqual(adminUserStats({}), {
    followCount: 0,
    creditBalance: 0,
  });
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm run admin:check -- --test-name-pattern="adminUserStats"`

Expected: FAIL because `adminUserStats` is not exported.

- [ ] **Step 3: Add the minimal mapping helper**

Add near other response helpers:

```js
export function adminUserStats(user) {
  return {
    followCount: Number(user?.followCount) || 0,
    creditBalance: Number(user?.creditBalance) || 0,
  };
}
```

- [ ] **Step 4: Update the user list and detail rendering**

In `renderUsers()`, add a right-aligned `팔로우` column using
`adminUserStats(u).followCount`, and update empty-row column spans.

In `renderUserDetail()`, remove the paginated-ledger `reduce()` balance and use:

```js
const { followCount, creditBalance } = adminUserStats(u);
```

Render both `팔로우` and `크레딧 잔액` in the stat row. Keep the ledger table
for recent history only.

- [ ] **Step 5: Run focused and full Admin UI tests**

Run: `npm run admin:check -- --test-name-pattern="adminUserStats"`

Expected: PASS.

Run: `npm run admin:check`

Expected: all Admin UI tests PASS.

### Task 4: Replace the obsolete hashtag notice with API data

**Files:**
- Modify: `packages/admin/test/main.test.mjs`
- Modify: `packages/admin/main.js`

**Interfaces:**
- Produces: `analyticsRequests()` returning the exact metrics and top-hashtag endpoints.
- Consumes: `{ items: Array<{ hashtag: string, postCount: number }> }` from the hashtag endpoint.

- [ ] **Step 1: Add the failing analytics request test**

Add `analyticsRequests` to the import list and add:

```js
test("analyticsRequests includes metrics and top hashtags", () => {
  assert.deepEqual(analyticsRequests(), [
    "/api/analytics",
    "/api/analytics/hashtags?limit=10",
  ]);
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm run admin:check -- --test-name-pattern="analyticsRequests"`

Expected: FAIL because `analyticsRequests` is not exported.

- [ ] **Step 3: Add the request helper**

Add near `dashboardRequests()`:

```js
export function analyticsRequests() {
  return ["/api/analytics", "/api/analytics/hashtags?limit=10"];
}
```

- [ ] **Step 4: Render top hashtags beside the metric cards**

In `renderAnalytics()`, load both requests concurrently:

```js
const [metricsPath, hashtagsPath] = analyticsRequests();
const [metricsRes, hashtagsRes] = await Promise.all([
  request(metricsPath),
  request(hashtagsPath),
]);
```

Keep the existing CMYK metric cards. Replace the unavailable notice with a
compact table headed `상위 해시태그`, with rank, `#hashtag`, and right-aligned
`postCount`. Render an existing-style empty state when no items are returned.

- [ ] **Step 5: Run focused and full Admin UI tests**

Run: `npm run admin:check -- --test-name-pattern="analyticsRequests"`

Expected: PASS.

Run: `npm run admin:check`

Expected: all Admin UI tests PASS.

### Task 5: Reconcile the inherited partial implementation

**Files:**
- Modify: `packages/admin/main.js`
- Test: `packages/admin/test/main.test.mjs`

**Interfaces:**
- Consumes: all helpers and handlers completed in Tasks 1-4.
- Produces: one coherent Admin v2 UI with no stale “API unavailable” copy for the APIs in scope.

- [ ] **Step 1: Audit the changed sections for stale assumptions**

Run:

```bash
rg -n "목록 조회 API가 아직|전역 상위 해시태그 집계 API는 아직|API 준비 중" packages/admin/main.js
```

Expected: no matches for posts, generation jobs, or top hashtags.

- [ ] **Step 2: Check API paths and UI action pairs**

Run:

```bash
rg -n "GET /api/posts|GET /api/generation/jobs|analytics/hashtags|select-post|back-posts|job-run|job-retry" packages/admin/main.js
```

Expected: every rendered action token has a matching handler and every API
caption matches the request path used by its renderer.

- [ ] **Step 3: Run the full Admin UI check**

Run: `npm run admin:check`

Expected: all Admin UI tests PASS with no warnings or errors.

- [ ] **Step 4: Review the final diff**

Run: `git diff --check`

Expected: no whitespace errors.

Run: `git diff -- packages/admin/main.js packages/admin/test/main.test.mjs`

Expected: every changed line traces to the approved API/UI integration scope.

### Task 6: Format, build, and verify the changed screens

**Files:**
- Modify mechanically if required: `packages/admin/main.js`
- Modify mechanically if required: `packages/admin/test/main.test.mjs`

**Interfaces:**
- Consumes: the completed Admin UI.
- Produces: fresh automated and browser verification evidence.

- [ ] **Step 1: Format the changed Admin UI files**

Run:

```bash
npx prettier --write packages/admin/main.js packages/admin/test/main.test.mjs
```

Expected: both files are formatted without errors.

- [ ] **Step 2: Run all relevant automated verification**

Run: `npm run admin:check`

Expected: all Admin UI tests PASS.

Run: `npm run format`

Expected: Prettier reports all matched files use code style.

Run: `npm run build`

Expected: Nest build exits 0.

- [ ] **Step 3: Perform an authenticated stubbed-browser pass**

Serve `packages/admin` over HTTP, inject an admin token and deterministic
responses for characters, posts, comments, reactions, generation jobs, users,
analytics, and top hashtags, then verify:

- Post list opens detail and returns to list.
- Comment and reaction buttons open the existing dialogs.
- Generation run and retry issue the expected POST requests and refresh.
- User list/detail show follow count and authoritative balance.
- Analytics shows CMYK metrics and top hashtag rows.
- No browser console errors occur.

- [ ] **Step 4: Stop the temporary server and inspect final status**

Run: `git status --short`

Expected: only the approved Admin UI implementation and test files remain
modified after the already committed design and plan documents.

- [ ] **Step 5: Commit the completed implementation**

```bash
git add packages/admin/main.js packages/admin/test/main.test.mjs
git commit -m "feat: complete admin v2 API integrations"
```
