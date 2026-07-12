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
  { id: "characters", label: "캐릭터" },
  { id: "posts", label: "게시물" },
  { id: "generation", label: "생성 작업" },
  { id: "logs", label: "액션 로그" },
  { id: "users", label: "사용자" },
  { id: "credits", label: "크레딧" },
  { id: "payments", label: "결제 정산" },
  { id: "moderation", label: "신고 처리" },
  { id: "events", label: "이벤트 · 선호" },
  { id: "analytics", label: "분석" },
];

const DEFAULT_ROUTE = "characters";

export function currentRouteFromHash(hash = "#characters", token = "") {
  const route = String(hash ?? "")
    .replace(/^#/, "")
    .split("?")[0];
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

export function navBadgeRequests() {
  return [
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

const CHARACTER_TABS = ["profile", "posts", "activity"];

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
  const tab = CHARACTER_TABS.includes(requestedTab) ? requestedTab : "profile";

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

export function postSelectionAfterAction(
  action,
  currentPostId,
  selectedPostId = "",
) {
  if (action === "select-post") return selectedPostId || null;
  if (action === "back-posts" || action === "sidebar-navigation") return null;
  return currentPostId;
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

export function generationClickRequest(clickAction, jobId) {
  if (clickAction === "job-run") {
    return generationActionRequest(jobId, "run");
  }
  if (clickAction === "job-retry") {
    return generationActionRequest(jobId, "retry");
  }
  return null;
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

// ═════════════════════════════════════════════════════════════════════════
// Rendering layer
// ═════════════════════════════════════════════════════════════════════════

const ui = {
  filters: {
    charStatus: "전체",
    jobStatus: "전체",
    payStatus: "전체",
    reportStatus: "전체",
    analyticsPeriod: "7일",
  },
  selUserId: null,
  selPostId: null,
  selPayId: null,
  ledgerUserId: "",
  eventUserId: "",
  cache: {
    charNames: new Map(),
    userLabels: new Map(),
  },
  badges: { moderation: 0, payments: 0 },
  toastTimer: 0,
};

// — request / auth —

async function request(path, options) {
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
    if (response.status === 401 && currentRoute() !== "login") {
      clearAdminAuth();
      renderApp();
    }
    return result;
  } catch (error) {
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

function currentRoute() {
  return currentRouteFromHash(location.hash, readAdminToken());
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

async function renderSection(route) {
  if (route === "characters") return renderCharacters();
  if (route === "posts") return renderPosts();
  if (route === "generation") return renderGeneration();
  if (route === "users") return renderUsers();
  if (route === "credits") return renderCredits();
  if (route === "payments") return renderPayments();
  if (route === "moderation") return renderModeration();
  if (route === "events") return renderEvents();
  if (route === "logs") return renderLogs();
  if (route === "analytics") return renderAnalytics();
  return renderCharacters();
}

// ── 캐릭터 ────────────────────────────────────────────────────────────────

async function renderCharacters() {
  const state = characterRouteState(location.hash);
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
  const primaryPersona = personas[0];

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
        ["posts", "게시물"],
        ["activity", "활동"],
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
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:56px">
        <div>
          <div style="display:flex;align-items:baseline;gap:10px;margin:0 0 10px"><span style="font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;font-weight:600">프로필 수정</span><span style="font-size:11px;color:var(--color-neutral-500)">PATCH /api/characters/:id</span></div>
          <form data-action="char-profile" data-character-id="${attr(
            c.id,
          )}" data-persona-id="${attr(primaryPersona?.id ?? "")}" style="display:flex;flex-direction:column;gap:12px">
            <div class="field"><label>표시 이름</label><input class="input" name="displayName" value="${attr(
              c.displayName,
            )}" required></div>
            <div class="field"><label>Bio</label><input class="input" name="bio" value="${attr(
              c.bio,
            )}" required></div>
            <div class="field"><label>페르소나 ${
              primaryPersona ? "" : "(첫 페르소나 생성)"
            }</label><textarea class="input" name="persona" rows="4" placeholder="말투 · 성격 · 세계관 설정">${escapeHtml(
              primaryPersona?.content ?? "",
            )}</textarea></div>
            <div class="field"><label>관심사 (쉼표 구분)</label><input class="input" name="interests" value="${attr(
              (c.interests ?? []).join(", "),
            )}"></div>
            <div><button class="btn btn-primary" type="submit">저장</button></div>
          </form>
        </div>
        <div>
          <div style="display:flex;align-items:baseline;gap:10px;margin:0 0 10px"><span style="font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;font-weight:600">기억</span><span style="font-size:11px;color:var(--color-neutral-500)">${
            memories.length
          }건 · POST /api/characters/:id/memory</span></div>
          <div style="font-size:13.5px;line-height:1.55;color:var(--color-neutral-800)">
            ${
              memories.length
                ? memories
                    .map(
                      (m) =>
                        `<div style="padding:8px 0;border-bottom:1px solid var(--color-divider);display:flex;justify-content:space-between;gap:12px"><span>${escapeHtml(
                          m.content,
                        )}</span><span style="color:var(--color-neutral-500);font-size:11px;flex:none">${fmtDate(
                          m.createdAt,
                        )}</span></div>`,
                    )
                    .join("")
                : `<div style="padding:8px 0;color:var(--color-neutral-600);font-style:italic">저장된 기억이 없습니다 — 아래에서 첫 기억을 추가하세요.</div>`
            }
          </div>
          <form data-action="memory-add" data-character-id="${attr(
            c.id,
          )}" style="display:flex;gap:8px;margin-top:12px">
            <input class="input" name="content" placeholder="새 기억 내용" required>
            <button class="btn btn-secondary" type="submit" style="flex:none">추가</button>
          </form>
        </div>
      </div>`;
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

async function renderGeneration() {
  await loadCharacterOptions();
  const statusParam =
    ui.filters.jobStatus === "전체" ? "" : ui.filters.jobStatus;
  const res = await request(
    endpoint("/api/generation/jobs", { status: statusParam, limit: 50 }),
  );
  const jobs = itemsFromPage(res.body);

  const rows = jobs.length
    ? jobs
        .map((j) => {
          const [sc, sl] = jobStatusMeta(j.status);
          const actions = [];
          if (j.status === "queued") {
            actions.push(
              `<button class="btn btn-ghost" data-act="job-run" data-id="${attr(
                j.id,
              )}">실행</button>`,
            );
          }
          if (j.status === "running") {
            actions.push(
              `<button class="btn btn-ghost" data-act="open-dialog" data-dialog="complete-job" data-job-id="${attr(
                j.id,
              )}">완료 처리</button>`,
            );
          }
          if (j.status === "failed") {
            actions.push(
              `<button class="btn btn-ghost" style="color:var(--color-accent-2-700)" data-act="job-retry" data-id="${attr(
                j.id,
              )}">재시도</button>`,
            );
          }
          return `<tr>
            <td style="font-weight:600">${escapeHtml(charName(j.characterId))}</td>
            <td>${escapeHtml(j.mediaType)}</td>
            <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${attr(
              j.prompt,
            )}">${escapeHtml(j.prompt)}</td>
            <td><span class="tag ${sc}">${escapeHtml(sl)}</span></td>
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
      `<button class="btn btn-primary" data-act="open-dialog" data-dialog="new-job">큐 등록</button>`,
    )}
    <div class="toolbar">
      ${segControl(
        "jobStatus",
        [
          { value: "전체", label: "전체" },
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
        <span class="cmyk-num" style="display:inline-block;font-family:var(--font-heading);font-weight:600;font-size:52px">
          <span class="paper">${escapeHtml(Number(m.value).toLocaleString())}</span>
          <span class="plate plate-c" aria-hidden="true">${escapeHtml(Number(m.value).toLocaleString())}</span>
          <span class="plate plate-m" aria-hidden="true">${escapeHtml(Number(m.value).toLocaleString())}</span>
          <span class="plate plate-y" aria-hidden="true">${escapeHtml(Number(m.value).toLocaleString())}</span>
        </span>
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

async function openDialog(type, ctx = {}) {
  dialogState = {
    type,
    ctx,
    ...(type === "new-post" ? { mediaFiles: [] } : {}),
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

function closeDialog() {
  clearPostMediaPreviewUrls();
  dialogState = null;
  if (dialogRoot) dialogRoot.innerHTML = "";
}

function paintDialog() {
  if (!dialogRoot || !dialogState) return;
  dialogRoot.innerHTML = `<div class="dialog-backdrop" data-act="dialog-backdrop"><div class="dialog" role="dialog" aria-modal="true">${dialogBody(
    dialogState,
  )}</div></div>`;
  const first = dialogRoot.querySelector("input, textarea, select");
  if (first) setTimeout(() => first.focus(), 40);
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

  const action = form.dataset.action;
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
      if (
        !location.hash ||
        currentRouteFromHash(location.hash, "x") === "login"
      ) {
        location.hash = DEFAULT_ROUTE;
      }
      renderApp();
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
    location.hash = characterHref({ characterId: id });
    renderApp();
    return;
  }

  // — character profile save (update + persona upsert) —
  if (action === "char-profile") {
    const id = form.dataset.characterId;
    const personaId = form.dataset.personaId;
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
    const persona = String(formData.get("persona") ?? "").trim();
    if (persona) {
      if (personaId) {
        await request(
          `/api/characters/${id}/personas/${personaId}`,
          jsonRequest(`/api/characters/${id}/personas/${personaId}`, "PATCH", {
            content: persona,
          }).options,
        );
      } else {
        await request(
          `/api/characters/${id}/personas`,
          jsonRequest(`/api/characters/${id}/personas`, "POST", {
            title: "기본 페르소나",
            content: persona,
          }).options,
        );
      }
    }
    showToast("프로필을 저장했습니다.", `PATCH /api/characters/${id}`);
    renderApp();
    return;
  }

  // — memory quick add (design has content-only; reason defaulted) —
  if (action === "memory-add") {
    const id = form.dataset.characterId;
    const content = String(formData.get("content") ?? "").trim();
    if (!content) return;
    await submitViaSpec(
      jsonRequest(`/api/characters/${id}/memory`, "POST", {
        content,
        reason: "운영 콘솔에서 추가",
      }),
      "기억을 추가했습니다.",
    );
    renderApp();
    return;
  }

  // — new post (character-authored, with hashtags) —
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
    ui.selUserId = ui.selPayId = null;
    ui.selPostId = postSelectionAfterAction("sidebar-navigation", ui.selPostId);
    location.hash = navBtn.dataset.route;
    return;
  }

  const el = event.target.closest?.("[data-act]");
  if (!el) return;
  const act = el.dataset.act;

  if (act === "remove-post-media") {
    dialogState.mediaFiles = removePostMediaFile(
      dialogState.mediaFiles,
      el.dataset.index,
    );
    renderPostMediaSelection();
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
  if (act === "go-char") {
    location.hash = characterHref({ characterId: el.dataset.id });
    return;
  }
  if (act === "go-char-list") {
    location.hash = characterHref();
    return;
  }
  if (act === "char-tab") {
    location.hash = characterHref({
      characterId: el.dataset.id,
      tab: el.dataset.tab,
    });
    return;
  }
  if (act === "select-post" || act === "back-posts") {
    ui.selPostId = postSelectionAfterAction(act, ui.selPostId, el.dataset.id);
    renderApp();
    return;
  }
  if (act === "select-user") {
    ui.selUserId = el.dataset.id;
    renderApp();
    return;
  }
  if (act === "back-users") {
    ui.selUserId = null;
    renderApp();
    return;
  }
  if (act === "select-payment") {
    ui.selPayId = el.dataset.id;
    renderApp();
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

function handleInput(event) {
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
  const route = currentRoute();

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

  const token = ++renderToken;
  mainPanel.innerHTML = spinner();
  let html;
  try {
    html = await renderSection(route);
  } catch (error) {
    html = noticeBlock(
      `섹션을 불러오는 중 오류가 발생했습니다: ${escapeHtml(
        error instanceof Error ? error.message : String(error),
      )}`,
    );
  }
  if (token !== renderToken) return; // a newer render superseded this one
  mainPanel.innerHTML = html;
}

// ═════════════════════════════════════════════════════════════════════════
// Boot
// ═════════════════════════════════════════════════════════════════════════

if (hasDocument) {
  updateIdentity();

  logoutButton?.addEventListener("click", () => {
    clearAdminAuth();
    closeDialog();
    location.hash = "";
    renderApp();
  });

  document.body.addEventListener("click", handleClick);
  document.body.addEventListener("submit", handleFormSubmit);
  document.body.addEventListener("change", handleChange);
  document.body.addEventListener("input", handleInput);
  document.body.addEventListener("dragover", handlePostMediaDragOver);
  document.body.addEventListener("dragleave", handlePostMediaDragLeave);
  document.body.addEventListener("drop", handlePostMediaDrop);

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && dialogState) closeDialog();
  });

  window.addEventListener("hashchange", () => {
    // Navigating dismisses any open modal so it can't linger over a new section.
    if (dialogState) closeDialog();
    renderApp();
  });

  // initial paint
  renderApp().then(() => {
    if (readAdminToken()) updateNavBadges();
  });
}
