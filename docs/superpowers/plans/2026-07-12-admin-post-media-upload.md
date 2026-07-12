# Admin Post Media Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the standalone Admin media UI and let operators drag and drop multiple images and videos into post creation, upload them directly to S3, and inspect their public URLs in post detail.

**Architecture:** Keep the existing presigned PUT endpoints and `Media`/`PostMedia` data model. The dependency-free Admin SPA owns file selection and sequential upload orchestration, while `MediaService` persists the signer’s public URL for every storage prefix and the post API connects the confirmed media IDs in selection order.

**Tech Stack:** NestJS 10, Prisma 7, AWS SDK v3, plain ES modules/HTML/CSS, Node test runner, Jest.

## Global Constraints

- The Media navigation item and standalone Media list/detail/upload UI are removed completely.
- One post accepts multiple mixed image and video files; no manual URL or media-type field remains.
- Drop/selection order is authoritative; no reorder UI is added.
- Uploads use the existing presign → direct S3 PUT → confirmation contract.
- The post request is sent only after every selected file is confirmed.
- `Media.url` stores the public S3/CDN URL and `Media.storageKey` retains the object key.
- Backend media endpoints, the Prisma schema, stories, and generation-job flows remain unchanged.
- Tests are written and observed failing before each production change.

---

## File Map

- `src/admin/media/media.service.ts`: persist the public URL returned by the S3 signer.
- `src/admin/media/media.service.spec.ts`: protect public URL persistence for custom prefixes.
- `packages/admin/index.html`: remove the Media sidebar button.
- `packages/admin/main.js`: remove Media routing/UI, manage selected post files, orchestrate uploads, and render post media.
- `packages/admin/styles.css`: style the drop zone, selected-file previews, and post-detail media gallery.
- `packages/admin/test/main.test.mjs`: protect navigation, file state, upload ordering/errors, dialog markup, and gallery output.
- `packages/admin/test/smoke.test.mjs`: keep the static sidebar in sync with `navItems` and assert Media is absent.

---

### Task 1: Persist public URLs for custom S3 prefixes

**Files:**
- Modify: `src/admin/media/media.service.spec.ts`
- Modify: `src/admin/media/media.service.ts`

**Interfaces:**
- Consumes: `SignedMediaUpload.publicUrl` and `SignedMediaUpload.storageKey` from `createS3UploadSigner()`.
- Produces: `MediaService.startUpload()` creates `Media` with `url: signed.publicUrl` and `storageKey: signed.storageKey` for both default and custom prefixes.

- [ ] **Step 1: Change the custom-prefix test to require a public URL**

Replace the custom-prefix URL assertions with:

```ts
await expect(
  service.startUpload({
    mediaType: "video",
    contentType: "video/mp4",
    fileName: " reel.mp4 ",
    storagePrefix: "pod/reels/character/character-1",
  }),
).resolves.toMatchObject({
  media: {
    id: "media-1",
    mediaType: "video",
    url: expect.stringMatching(
      /^https:\/\/cdn\.example\.com\/pod\/reels\/character\/character-1\/.+\.mp4$/,
    ),
  },
  uploadUrl: expect.stringContaining(
    "https://bucket.s3.us-east-1.amazonaws.com/pod/reels/character/character-1/",
  ),
});
expect(create.mock.calls[0][0].data).toMatchObject({
  mediaType: "video",
  storageKey: expect.stringMatching(
    /^pod\/reels\/character\/character-1\/.+\.mp4$/,
  ),
  url: expect.stringMatching(
    /^https:\/\/cdn\.example\.com\/pod\/reels\/character\/character-1\/.+\.mp4$/,
  ),
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- --runInBand src/admin/media/media.service.spec.ts
```

Expected: FAIL because the custom-prefix record still stores
`pod/reels/character/...` in `url`.

- [ ] **Step 3: Store the public URL unconditionally**

In `MediaService.startUpload()`, change the create data to:

```ts
const media = await this.prisma.media.create({
  data: {
    mediaType,
    url: signed.publicUrl,
    storageKey: signed.storageKey,
    contentType,
    ...numbers,
  },
});
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npm test -- --runInBand src/admin/media/media.service.spec.ts
```

Expected: all Media service tests PASS.

- [ ] **Step 5: Commit the backend contract change**

```bash
git add src/admin/media/media.service.ts src/admin/media/media.service.spec.ts
git commit -m "fix: store public media upload URLs"
```

---

### Task 2: Remove the standalone Media route and screen

**Files:**
- Modify: `packages/admin/index.html`
- Modify: `packages/admin/main.js`
- Modify: `packages/admin/test/main.test.mjs`
- Modify: `packages/admin/test/smoke.test.mjs`

**Interfaces:**
- Consumes: authenticated hash routing through `currentRouteFromHash()`.
- Produces: navigation without `media`; authenticated `#media` falls back to `characters`; badge requests no longer fetch pending media.

- [ ] **Step 1: Update navigation tests for the removed route**

Change the expected `navItems` IDs to:

```js
[
  "characters",
  "posts",
  "generation",
  "logs",
  "users",
  "credits",
  "payments",
  "moderation",
  "events",
  "analytics",
]
```

Change the `navBadgeRequests()` expectation to:

```js
[
  { key: "generation", path: "/api/generation/jobs?status=failed&limit=50" },
  {
    key: "moderation",
    path: "/api/moderation/reports?status=submitted&limit=50",
  },
  {
    key: "payments",
    path: "/api/payments/reconciliation?status=mismatch",
  },
]
```

Add this authenticated routing assertion:

```js
assert.equal(currentRouteFromHash("#media", "token-1"), "characters");
```

In `smoke.test.mjs`, add:

```js
assert.doesNotMatch(html, /data-route="media"/);
```

- [ ] **Step 2: Run the Admin UI tests and verify RED**

Run:

```bash
node --test packages/admin/test/main.test.mjs packages/admin/test/smoke.test.mjs
```

Expected: FAIL because Media is still present in navigation and badge requests.

- [ ] **Step 3: Remove Media navigation and state**

Delete the Media button from `packages/admin/index.html`. Remove the Media item
from `navItems` and the Media request from `navBadgeRequests()`.

Remove these fields from `ui`:

```js
mediaType: "전체",
mediaUploaded: "전체",
selMediaId: null,
```

Change sidebar reset state to:

```js
ui.selUserId = ui.selPayId = null;
```

- [ ] **Step 4: Remove standalone Media rendering and actions**

Delete all of the following UI-only code from `main.js`:

```text
renderSection() branch for route === "media"
renderMedia()
renderMediaDetail()
dialogBody() branch for type === "upload"
dispatchSubmit() branch for action === "dlg-upload"
handleClick() branches for select-media, back-media, and media-confirm
```

Also remove `fmtBytes()`, `basename()`, and `mediaDims()` after confirming with
`rg` that their only consumers were the deleted Media screen.

- [ ] **Step 5: Run the Admin UI tests and verify GREEN**

Run:

```bash
node --test packages/admin/test/main.test.mjs packages/admin/test/smoke.test.mjs
```

Expected: both test files PASS.

- [ ] **Step 6: Commit the screen removal**

```bash
git add packages/admin/index.html packages/admin/main.js packages/admin/test/main.test.mjs packages/admin/test/smoke.test.mjs
git commit -m "refactor: remove standalone admin media screen"
```

---

### Task 3: Build ordered multi-file upload behavior

**Files:**
- Modify: `packages/admin/main.js`
- Modify: `packages/admin/test/main.test.mjs`

**Interfaces:**
- Produces: `mediaTypeForFile(file): "image" | "video"`.
- Produces: `appendPostMediaFiles(current, incoming): File[]`.
- Produces: `removePostMediaFile(current, index): File[]`.
- Produces: `postPayload(form, requestFn, putObject, files): Promise<PostBody>` with ordered `mediaId` entries.

- [ ] **Step 1: Add failing tests for file state and MIME validation**

Import `appendPostMediaFiles`, `mediaTypeForFile`, and
`removePostMediaFile`, then add:

```js
test("post media selection appends mixed files and removes by index", () => {
  const image = new File(["image"], "photo.png", { type: "image/png" });
  const video = new File(["video"], "clip.mp4", { type: "video/mp4" });

  const selected = appendPostMediaFiles([image], [video]);

  assert.deepEqual(selected, [image, video]);
  assert.equal(mediaTypeForFile(image), "image");
  assert.equal(mediaTypeForFile(video), "video");
  assert.deepEqual(removePostMediaFile(selected, 0), [video]);
});

test("post media selection rejects unsupported files by name", () => {
  const text = new File(["notes"], "notes.txt", { type: "text/plain" });

  assert.throws(
    () => appendPostMediaFiles([], [text]),
    /notes\.txt.*image or video/i,
  );
});
```

- [ ] **Step 2: Run the two new tests and verify RED**

Run:

```bash
node --test --test-name-pattern="post media selection" packages/admin/test/main.test.mjs
```

Expected: FAIL because the three exported helpers do not exist.

- [ ] **Step 3: Implement minimal immutable file-state helpers**

Add to the pure helper layer in `main.js`:

```js
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
```

- [ ] **Step 4: Run the file-state tests and verify GREEN**

Run:

```bash
node --test --test-name-pattern="post media selection" packages/admin/test/main.test.mjs
```

Expected: both tests PASS.

- [ ] **Step 5: Replace the single-file payload test with ordered mixed uploads**

Replace the current single-file post test with:

```js
test("postPayload uploads mixed media sequentially and preserves order", async () => {
  const form = new FormData();
  form.set("actorId", " character-1 ");
  form.set("content", " hello ");
  form.set("reason", " daily post ");
  form.set("contentType", " feed ");
  form.set("hashtags", " film, night ");
const files = [
  new File(["image-bytes"], "photo.png", { type: "image/png" }),
  new File(["video-bytes"], "clip.mp4", { type: "video/mp4" }),
];
  const calls = [];
  let uploadNumber = 0;
  const request = async (path, options = {}) => {
    calls.push({ path, options });
    if (path === "/api/media/uploads") {
      uploadNumber += 1;
      return {
        ok: true,
        body: {
          media: { id: `media-${uploadNumber}` },
          uploadUrl: `https://s3.example/upload-${uploadNumber}`,
          method: "PUT",
          headers: {
            "content-type": uploadNumber === 1 ? "image/png" : "video/mp4",
          },
        },
      };
    }
    return { ok: true, body: { id: path.split("/")[3] } };
  };
  const putObject = async (url, options) => {
    calls.push({ url, options });
    return { ok: true };
  };

  const payload = await postPayload(form, request, putObject, files);

  assert.deepEqual(payload, {
    actorType: "character",
    actorId: "character-1",
    content: "hello",
    reason: "daily post",
    contentType: "feed",
    hashtags: ["film", "night"],
    media: [{ mediaId: "media-1" }, { mediaId: "media-2" }],
  });
  const presignBodies = calls
    .filter((call) => call.path === "/api/media/uploads")
    .map((call) => JSON.parse(call.options.body));
  assert.deepEqual(
    presignBodies.map(({ mediaType, storagePrefix }) => ({
      mediaType,
      storagePrefix,
    })),
    [
      {
        mediaType: "image",
        storagePrefix: "pod/feed/character/character-1",
      },
      {
        mediaType: "video",
        storagePrefix: "pod/feed/character/character-1",
      },
    ],
  );
});
```

Add a failure test:

```js
test("postPayload identifies the failed file and does not continue", async () => {
  const form = new FormData();
  form.set("actorId", "character-1");
  form.set("content", "hello");
  form.set("reason", "daily post");
  form.set("contentType", "feed");
  form.set("hashtags", "");
  const files = [
    new File(["image"], "first.png", { type: "image/png" }),
    new File(["video"], "broken.mp4", { type: "video/mp4" }),
  ];
  let presignCount = 0;
  const request = async (path) => {
    if (path === "/api/media/uploads" && ++presignCount === 2) {
      return { ok: false, body: { message: "signing failed" } };
    }
    if (path === "/api/media/uploads") {
      return {
        ok: true,
        body: {
          media: { id: "media-1" },
          uploadUrl: "https://s3.example/first",
          method: "PUT",
          headers: { "content-type": "image/png" },
        },
      };
    }
    return { ok: true, body: { id: "media-1" } };
  };

  await assert.rejects(
    () => postPayload(form, request, async () => ({ ok: true }), files),
    /broken\.mp4.*signing failed/,
  );
});
```

- [ ] **Step 6: Run the payload tests and verify RED**

Run:

```bash
node --test --test-name-pattern="postPayload" packages/admin/test/main.test.mjs
```

Expected: FAIL because `postPayload()` still requires one manual media type
and falls back to a URL.

- [ ] **Step 7: Implement sequential multi-file payload creation**

Replace `postPayload()` with:

```js
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
```

Remove the post-only call to `requiredMediaUrl()`; keep that helper while the
unchanged story URL fallback still uses it.

Delete the obsolete `post-create` branch from `formActionRequest()`:

```js
if (action === "post-create") {
  return jsonRequest("/api/posts", "POST", await postPayload(form));
}
```

Delete the matching `post-create` row from the table-driven
`formActionRequest maps supported forms to API requests` test. The visible
new-post dialog is wired directly to `postPayload()` in Task 4, and the focused
payload tests now own this asynchronous contract.

- [ ] **Step 8: Run all Admin helper tests and verify GREEN**

Run:

```bash
node --test packages/admin/test/main.test.mjs
```

Expected: all tests PASS with the direct `postPayload()` tests owning the post
upload contract.

- [ ] **Step 9: Commit the upload behavior**

```bash
git add packages/admin/main.js packages/admin/test/main.test.mjs
git commit -m "feat: upload multiple post media files"
```

---

### Task 4: Add the drag-and-drop post composer UI

**Files:**
- Modify: `packages/admin/main.js`
- Modify: `packages/admin/styles.css`
- Modify: `packages/admin/test/main.test.mjs`

**Interfaces:**
- Consumes: `appendPostMediaFiles()`, `removePostMediaFile()`, and `postPayload()` from Task 3.
- Produces: new-post dialog file input `[data-post-media-input]`, drop target `[data-post-media-dropzone]`, and selected preview list `[data-post-media-list]`.

- [ ] **Step 1: Add a failing new-post dialog contract test**

Add:

```js
test("new post dialog accepts multiple image and video files without URL fields", () => {
  const html = dialogBody({
    type: "new-post",
    ctx: { characters: [], actor: "" },
  });

  assert.match(html, /name="mediaFiles"/);
  assert.match(html, /type="file"/);
  assert.match(html, /multiple/);
  assert.match(html, /accept="image\/\*,video\/\*"/);
  assert.doesNotMatch(html, /name="mediaUrl"/);
  assert.doesNotMatch(html, /name="mediaType"/);
});
```

- [ ] **Step 2: Run the dialog test and verify RED**

Run:

```bash
node --test --test-name-pattern="new post dialog accepts" packages/admin/test/main.test.mjs
```

Expected: FAIL because the dialog still renders media type and URL fields.

- [ ] **Step 3: Replace the dialog media fields with the drop zone**

Use this markup in the `new-post` branch:

```html
<div class="field">
  <label>미디어</label>
  <label class="media-dropzone" data-post-media-dropzone for="postMediaFiles">
    <span class="media-dropzone-title">이미지 또는 영상을 드래그하세요</span>
    <span class="media-dropzone-copy">여러 파일 선택 가능 · 클릭해서 찾아보기</span>
  </label>
  <input
    class="media-file-input"
    id="postMediaFiles"
    name="mediaFiles"
    type="file"
    accept="image/*,video/*"
    multiple
    data-post-media-input
  >
  <div class="post-media-selection" data-post-media-list></div>
</div>
```

Initialize `dialogState.mediaFiles` for `new-post` in `openDialog()` and keep
that array until the dialog closes:

```js
dialogState = {
  type,
  ctx,
  ...(type === "new-post" ? { mediaFiles: [] } : {}),
};
```

- [ ] **Step 4: Run the dialog test and verify GREEN**

Run:

```bash
node --test --test-name-pattern="new post dialog accepts" packages/admin/test/main.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Implement preview lifecycle and file event handling**

Add preview URL cleanup and rendering:

```js
let postMediaPreviewUrls = [];

function clearPostMediaPreviewUrls() {
  for (const url of postMediaPreviewUrls) URL.revokeObjectURL(url);
  postMediaPreviewUrls = [];
}

function renderPostMediaSelection() {
  const root = dialogRoot?.querySelector("[data-post-media-list]");
  if (!root || dialogState?.type !== "new-post") return;
  clearPostMediaPreviewUrls();
  postMediaPreviewUrls = dialogState.mediaFiles.map((file) =>
    URL.createObjectURL(file),
  );
  root.innerHTML = dialogState.mediaFiles
    .map((file, index) => {
      const url = postMediaPreviewUrls[index];
      const preview =
        mediaTypeForFile(file) === "image"
          ? `<img src="${attr(url)}" alt="">`
          : `<video src="${attr(url)}" muted></video>`;
      return `<div class="post-media-selection-item">${preview}<div><strong>${escapeHtml(
        file.name,
      )}</strong><span>${escapeHtml(mediaTypeForFile(file))}</span></div><button type="button" class="btn btn-ghost" data-act="remove-post-media" data-index="${index}">제거</button></div>`;
    })
    .join("");
}
```

Call `renderPostMediaSelection()` after `paintDialog()`. Call
`clearPostMediaPreviewUrls()` from `closeDialog()`.

At the beginning of `handleChange()`, handle the file input:

```js
const fileInput = event.target.closest?.("[data-post-media-input]");
if (fileInput) {
  try {
    dialogState.mediaFiles = appendPostMediaFiles(
      dialogState.mediaFiles,
      fileInput.files,
    );
    renderPostMediaSelection();
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), "", true);
  }
  fileInput.value = "";
  return;
}
```

Add `remove-post-media` at the start of `handleClick()`:

```js
if (act === "remove-post-media") {
  dialogState.mediaFiles = removePostMediaFile(
    dialogState.mediaFiles,
    el.dataset.index,
  );
  renderPostMediaSelection();
  return;
}
```

Add delegated drag handlers:

```js
function mediaDropzoneFor(event) {
  return event.target.closest?.("[data-post-media-dropzone]");
}

function handlePostMediaDragOver(event) {
  const dropzone = mediaDropzoneFor(event);
  if (!dropzone || dialogState?.type !== "new-post") return;
  event.preventDefault();
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
```

Register them with the existing delegated listeners:

```js
document.body.addEventListener("dragover", handlePostMediaDragOver);
document.body.addEventListener("dragleave", handlePostMediaDragLeave);
document.body.addEventListener("drop", handlePostMediaDrop);
```

- [ ] **Step 6: Wire actual submit to the upload helper**

Replace the `dlg-new-post` branch with:

```js
if (action === "dlg-new-post") {
  const body = await postPayload(
    formData,
    request,
    fetch,
    dialogState?.mediaFiles ?? [],
  );
  const result = await submitViaSpec(
    jsonRequest("/api/posts", "POST", body),
    "게시물을 생성했습니다.",
  );
  if (result.ok) closeDialog();
  return;
}
```

- [ ] **Step 7: Style the drop zone and selected previews**

Add focused classes to `styles.css`:

```css
.media-file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
.media-dropzone {
  min-height: 120px;
  display: grid;
  place-content: center;
  gap: 6px;
  padding: 20px;
  text-align: center;
  cursor: pointer;
  border: 1px dashed var(--color-neutral-500);
  background: color-mix(in srgb, var(--color-accent) 4%, transparent);
}
.media-dropzone.is-dragging {
  border-color: var(--color-accent);
  background: var(--color-accent-100);
}
.media-dropzone-title {
  font-weight: 600;
}
.media-dropzone-copy {
  font-size: 12px;
  color: var(--color-neutral-600);
}
.post-media-selection {
  display: grid;
  gap: 8px;
  margin-top: 10px;
}
.post-media-selection-item {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border: 1px solid var(--color-divider);
}
.post-media-selection-item img,
.post-media-selection-item video {
  width: 64px;
  height: 48px;
  object-fit: cover;
}
.post-media-selection-item strong,
.post-media-selection-item span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.post-media-selection-item span {
  font-size: 12px;
  color: var(--color-neutral-600);
}
```

- [ ] **Step 8: Run Admin UI tests and verify GREEN**

Run:

```bash
npm run admin:check
```

Expected: all Admin UI tests PASS.

- [ ] **Step 9: Commit the composer UI**

```bash
git add packages/admin/main.js packages/admin/styles.css packages/admin/test/main.test.mjs
git commit -m "feat: add post media dropzone"
```

---

### Task 5: Render media previews and URLs in post detail

**Files:**
- Modify: `packages/admin/main.js`
- Modify: `packages/admin/styles.css`
- Modify: `packages/admin/test/main.test.mjs`

**Interfaces:**
- Produces: `postMediaGallery(media): string` with safe HTTP(S) previews and escaped URL text.
- Consumes: existing post response `media: Array<{ mediaType, url }>`.

- [ ] **Step 1: Add a failing gallery contract test**

Import `postMediaGallery` and add:

```js
test("postMediaGallery renders image and video previews with escaped URLs", () => {
  const html = postMediaGallery([
    { mediaType: "image", url: "https://cdn.example/photo.png?a=1&b=2" },
    { mediaType: "video", url: "https://cdn.example/clip.mp4" },
  ]);

  assert.match(html, /<img/);
  assert.match(html, /<video[^>]*controls/);
  assert.match(html, /photo\.png\?a=1&amp;b=2/);
  assert.match(html, /clip\.mp4/);
});

test("postMediaGallery does not create active previews for unsafe URLs", () => {
  const html = postMediaGallery([
    { mediaType: "image", url: "javascript:alert(1)" },
  ]);

  assert.doesNotMatch(html, /src="javascript:/);
  assert.match(html, /javascript:alert\(1\)/);
});
```

- [ ] **Step 2: Run the gallery tests and verify RED**

Run:

```bash
node --test --test-name-pattern="postMediaGallery" packages/admin/test/main.test.mjs
```

Expected: FAIL because `postMediaGallery()` does not exist.

- [ ] **Step 3: Implement the safe gallery renderer**

Add:

```js
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
```

Insert `${postMediaGallery(p.media)}` after the post hashtags and before the
statistics in `renderPostDetail()`.

- [ ] **Step 4: Style the post-detail gallery**

Add:

```css
.post-media-gallery {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
  margin-bottom: 28px;
}
.post-media-item {
  min-width: 0;
  margin: 0;
  border: 1px solid var(--color-divider);
  background: var(--color-surface);
}
.post-media-item img,
.post-media-item video,
.post-media-unavailable {
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  background: var(--color-neutral-200);
}
.post-media-unavailable {
  display: grid;
  place-items: center;
  color: var(--color-neutral-600);
}
.post-media-item figcaption {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
}
.post-media-url {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--color-neutral-700);
}
```

- [ ] **Step 5: Run the gallery and full Admin UI tests**

Run:

```bash
node --test --test-name-pattern="postMediaGallery" packages/admin/test/main.test.mjs
npm run admin:check
```

Expected: gallery tests and the full Admin UI suite PASS.

- [ ] **Step 6: Commit the post detail integration**

```bash
git add packages/admin/main.js packages/admin/styles.css packages/admin/test/main.test.mjs
git commit -m "feat: show media in admin post detail"
```

---

### Task 6: Final regression verification

**Files:**
- Verify only; make formatting corrections only in files already changed by Tasks 1–5.

**Interfaces:**
- Consumes: all preceding task outputs.
- Produces: a clean, tested, linted, formatted, buildable Admin application.

- [ ] **Step 1: Run all Admin UI tests**

```bash
npm run admin:check
```

Expected: PASS with zero failed tests.

- [ ] **Step 2: Run the Nest unit tests**

```bash
npm test -- --runInBand
```

Expected: PASS with zero failed suites.

- [ ] **Step 3: Run lint, formatting check, and build**

```bash
npm run lint
npm run format
npm run build
```

Expected: all three commands exit 0 with no lint, formatting, or TypeScript
errors.

- [ ] **Step 4: Inspect the final diff for scope and whitespace errors**

```bash
git status --short
git diff --check HEAD~5..HEAD
git diff --stat HEAD~5..HEAD
```

Expected: only the files named in this plan are changed; `git diff --check`
prints nothing.

- [ ] **Step 5: Commit formatting-only corrections if required**

If Step 3 changed formatting in an already modified file:

```bash
git add packages/admin/main.js packages/admin/styles.css packages/admin/test/main.test.mjs src/admin/media/media.service.ts src/admin/media/media.service.spec.ts
git commit -m "style: format admin post media changes"
```

If no formatting correction was required, do not create an empty commit.
