# Admin Character Persona and Memory CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show every character persona and memory in dedicated Admin detail tabs and provide individual create, update, and confirmed delete controls for both resource types.

**Architecture:** Keep the dependency-free, hash-routed Admin SPA and the existing character detail response. Add pure HTML panel helpers plus small request-selection helpers that are directly unit tested, then connect them to the existing delegated submit and click handlers; all mutations continue to use the existing backend CRUD endpoints and rerender from server state after success.

**Tech Stack:** Plain ES modules/HTML/CSS, browser `FormData`, Node test runner, NestJS build tooling.

## Global Constraints

- Character detail tabs are `Profile`, `Personas`, `Memory`, `Posts`, `Activity`, `Visual`, and `Automation`.
- Profile edits only display name, bio, and interests.
- Every active persona and memory returned by character detail is rendered.
- Persona title/content and memory content/reason are required.
- Persona sort order is optional on create and editable on existing entries.
- Deletes require explicit confirmation and remain soft deletes through the existing API.
- Successful mutations rerender the active tab; failed mutations retain the current view and show the existing toast.
- No backend, Prisma, schema, bulk-operation, drag-and-drop, or restore changes.
- Tests are written and observed failing before each production change.

---

## File Map

- `packages/admin/main.js`: accept the two new tab keys, render dedicated CRUD panels, and connect create/update/delete interactions.
- `packages/admin/test/main.test.mjs`: protect tab routing, complete escaped list rendering, resource form selection, and delete cancellation/confirmation.

---

### Task 1: Add dedicated tabs and render every resource

**Files:**
- Modify: `packages/admin/test/main.test.mjs:3-51,621-657`
- Modify: `packages/admin/main.js:152-190,1221-1360`

**Interfaces:**
- Produces: `characterPersonasPanel(characterId, personas): string`.
- Produces: `characterMemoriesPanel(characterId, memories): string`.
- Extends: `characterRouteState(hash).tab` with `personas` and `memory`.
- Consumes: persona and memory arrays already returned by `GET /api/characters/:id`.

- [ ] **Step 1: Write failing route and rendering tests**

Import `characterPersonasPanel` and `characterMemoriesPanel` from
`../main.js`. Change the route test so both new tabs are valid and an unknown
tab still falls back:

```js
assert.equal(
  characterRouteState("#characters?characterId=char-1&tab=personas").tab,
  "personas",
);
assert.equal(
  characterRouteState("#characters?characterId=char-1&tab=memory").tab,
  "memory",
);
assert.equal(
  characterRouteState("#characters?characterId=char-1&tab=unknown").tab,
  "profile",
);
```

Add focused panel tests:

```js
test("characterPersonasPanel renders every editable persona safely", () => {
  const html = characterPersonasPanel("char-1", [
    { id: "persona-1", title: "Core <voice>", content: "Warm & concise", sortOrder: 10 },
    { id: "persona-2", title: "World", content: "Lives in Seoul", sortOrder: 20 },
  ]);

  assert.equal((html.match(/data-action="persona-update"/g) ?? []).length, 2);
  assert.match(html, /data-action="persona-create"/);
  assert.match(html, /data-persona-id="persona-1"/);
  assert.match(html, /data-persona-id="persona-2"/);
  assert.match(html, /Core &lt;voice&gt;/);
  assert.match(html, /Warm &amp; concise/);
  assert.doesNotMatch(html, /Core <voice>/);
});

test("characterPersonasPanel shows an empty state", () => {
  assert.match(characterPersonasPanel("char-1", []), /등록된 페르소나가 없습니다/);
});

test("characterMemoriesPanel renders every editable memory safely", () => {
  const html = characterMemoriesPanel("char-1", [
    { id: "memory-1", content: "Likes <film>", reason: "Operator & import", createdAt: "2026-07-13T00:00:00.000Z" },
    { id: "memory-2", content: "Lives in Seoul", reason: "Profile", createdAt: "2026-07-12T00:00:00.000Z" },
  ]);

  assert.equal((html.match(/data-action="memory-update"/g) ?? []).length, 2);
  assert.match(html, /data-action="memory-create"/);
  assert.match(html, /data-memory-id="memory-1"/);
  assert.match(html, /data-memory-id="memory-2"/);
  assert.match(html, /Likes &lt;film&gt;/);
  assert.match(html, /Operator &amp; import/);
  assert.doesNotMatch(html, /Likes <film>/);
});

test("characterMemoriesPanel shows an empty state", () => {
  assert.match(characterMemoriesPanel("char-1", []), /등록된 메모리가 없습니다/);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
node --test --test-name-pattern="character(RouteState|PersonasPanel|MemoriesPanel)" packages/admin/test/main.test.mjs
```

Expected: FAIL because the two panel exports do not exist and `memory` still
falls back to `profile`.

- [ ] **Step 3: Implement the panel helpers and tab routing**

Extend `CHARACTER_TABS`:

```js
const CHARACTER_TABS = [
  "profile",
  "personas",
  "memory",
  "posts",
  "activity",
  "visual",
  "automation",
];
```

Add these exported helpers near the character route helpers:

```js
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
    : noticeBlock(
        "등록된 메모리가 없습니다 — 위에서 첫 메모리를 추가하세요.",
      );

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
```

In `renderCharacterDetail()`:

- Add `["personas", "페르소나"]` and `["memory", "메모리"]` immediately
  after Profile in the tab array.
- Remove `primaryPersona`.
- Reduce the Profile body to the existing display-name, bio, and interests
  form with no persona dataset/textarea and no memory column/quick-add form.
- Add these branches before Posts:

```js
} else if (tab === "personas") {
  body = characterPersonasPanel(c.id, personas);
} else if (tab === "memory") {
  body = characterMemoriesPanel(c.id, memories);
} else if (tab === "posts") {
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
node --test --test-name-pattern="character(RouteState|PersonasPanel|MemoriesPanel)" packages/admin/test/main.test.mjs
```

Expected: all matching tests PASS.

- [ ] **Step 5: Commit the dedicated tab rendering**

```bash
git add packages/admin/main.js packages/admin/test/main.test.mjs
git commit -m "feat: show character persona and memory tabs"
```

---

### Task 2: Connect persona and memory create/update forms

**Files:**
- Modify: `packages/admin/test/main.test.mjs:3-51,687-728,1011-1208`
- Modify: `packages/admin/main.js:383-523,2820-2965`

**Interfaces:**
- Consumes: existing `formActionRequest(action, form, dataset)` CRUD mappings.
- Produces: `characterResourceFormRequest(action, form, dataset): Promise<{ request, successMessage } | null>`.
- Connects: panel forms named `persona-create`, `persona-update`, `memory-create`, and `memory-update` to the delegated submit handler.

- [ ] **Step 1: Write a failing resource-form selection test**

Import `characterResourceFormRequest` and add:

```js
test("characterResourceFormRequest selects persona and memory mutations", async () => {
  const persona = new FormData();
  persona.set("title", " Core ");
  persona.set("content", " Warm ");
  const personaSubmission = await characterResourceFormRequest(
    "persona-create",
    persona,
    { characterId: "char-1" },
  );
  assert.equal(personaSubmission.successMessage, "페르소나를 추가했습니다.");
  assert.equal(personaSubmission.request.path, "/api/characters/char-1/personas");

  const memory = new FormData();
  memory.set("content", " City night ");
  memory.set("reason", " Operator ");
  const memorySubmission = await characterResourceFormRequest(
    "memory-update",
    memory,
    { characterId: "char-1", memoryId: "memory-1" },
  );
  assert.equal(memorySubmission.successMessage, "메모리를 저장했습니다.");
  assert.equal(memorySubmission.request.path, "/api/characters/char-1/memory/memory-1");
  assert.equal(
    await characterResourceFormRequest("admin-login", new FormData()),
    null,
  );
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test --test-name-pattern="characterResourceFormRequest" packages/admin/test/main.test.mjs
```

Expected: FAIL because `characterResourceFormRequest` is not exported.

- [ ] **Step 3: Implement minimal form selection and submission**

Add near `formActionRequest()`:

```js
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
```

At the start of the character section in `dispatchSubmit()` add:

```js
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
```

Simplify `char-profile` so it only PATCHes the character fields, shows the
existing success/error toast, and rerenders only on success. Delete the
persona upsert block and delete the obsolete `memory-add` dispatch branch.

- [ ] **Step 4: Run the focused and full Admin tests**

Run:

```bash
node --test --test-name-pattern="characterResourceFormRequest|formActionRequest|personaPayload|memoryPayload" packages/admin/test/main.test.mjs
npm run admin:check
```

Expected: all focused and Admin UI tests PASS.

- [ ] **Step 5: Commit create/update wiring**

```bash
git add packages/admin/main.js packages/admin/test/main.test.mjs
git commit -m "feat: edit character personas and memories"
```

---

### Task 3: Add confirmed persona and memory deletion

**Files:**
- Modify: `packages/admin/test/main.test.mjs:3-51,1011-1208`
- Modify: `packages/admin/main.js:383-523,3170-3260`

**Interfaces:**
- Produces: `characterDeleteRequest(action, dataset, confirmDelete): Promise<{ request, successMessage } | null>`.
- Consumes: `formActionRequest()` persona/memory delete mappings and an injected browser confirmation function.
- Connects: `data-act="persona-delete"` and `data-act="memory-delete"` buttons to confirmed soft-delete requests.

- [ ] **Step 1: Write a failing delete confirmation test**

Import `characterDeleteRequest` and add:

```js
test("characterDeleteRequest cancels or builds the selected soft delete", async () => {
  let prompt = "";
  assert.equal(
    await characterDeleteRequest(
      "persona-delete",
      { characterId: "char-1", personaId: "persona-1" },
      (message) => {
        prompt = message;
        return false;
      },
    ),
    null,
  );
  assert.match(prompt, /페르소나.*삭제/);

  const submission = await characterDeleteRequest(
    "memory-delete",
    { characterId: "char-1", memoryId: "memory-1" },
    () => true,
  );
  assert.equal(submission.successMessage, "메모리를 삭제했습니다.");
  assert.equal(submission.request.path, "/api/characters/char-1/memory/memory-1");
  assert.equal(submission.request.options.method, "DELETE");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test --test-name-pattern="characterDeleteRequest" packages/admin/test/main.test.mjs
```

Expected: FAIL because `characterDeleteRequest` is not exported.

- [ ] **Step 3: Implement confirmed request selection**

Add near the resource form helper:

```js
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
```

In `handleClick()`, before normal character navigation actions, add:

```js
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
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
node --test --test-name-pattern="characterDeleteRequest|character(PersonasPanel|MemoriesPanel)|formActionRequest" packages/admin/test/main.test.mjs
```

Expected: all matching tests PASS.

- [ ] **Step 5: Run complete verification**

Run:

```bash
npm run admin:check
npm run format
npm run build
git diff --check
```

Expected: Admin UI tests PASS, Prettier reports all matched files use its code
style, Nest builds successfully, and Git reports no whitespace errors.

- [ ] **Step 6: Commit the completed CRUD interaction**

```bash
git add packages/admin/main.js packages/admin/test/main.test.mjs docs/superpowers/plans/2026-07-13-admin-character-persona-memory-crud.md
git commit -m "feat: manage character personas and memories"
```
