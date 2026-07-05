const output = document.querySelector("#output");
const statusDot = document.querySelector("#statusDot");
const statusText = document.querySelector("#statusText");

document.querySelector("#healthButton").addEventListener("click", checkHealth);
bindJsonForm("#characterForm", "/api/admin/characters", characterPayload);
bindJsonForm("#postForm", "/api/admin/posts", postPayload);
bindJsonForm(
  "#generationForm",
  "/api/admin/generation/jobs",
  generationPayload,
);
bindJsonForm("#creditForm", "/api/admin/credits/grants", creditPayload);

async function checkHealth() {
  const result = await request("/api/admin/character-action-logs");
  statusDot.classList.toggle("ok", result.ok);
  statusText.textContent = result.ok ? "정상" : "오류";
  render(result.body);
}

function bindJsonForm(selector, path, toPayload) {
  document.querySelector(selector).addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const result = await request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(toPayload(new FormData(form))),
    });

    render(result.body);
    if (result.ok) {
      form.reset();
    }
  });
}

async function request(path, options) {
  try {
    const response = await fetch(path, options);
    const text = await response.text();
    return {
      ok: response.ok,
      body: text ? JSON.parse(text) : { status: response.status },
    };
  } catch (error) {
    return { ok: false, body: { error: error.message } };
  }
}

function characterPayload(form) {
  return {
    publicId: form.get("publicId"),
    displayName: form.get("displayName"),
    bio: form.get("bio"),
    interests: splitCsv(form.get("interests")),
  };
}

function postPayload(form) {
  return {
    actorType: "character",
    actorId: form.get("actorId"),
    content: form.get("content"),
    reason: form.get("reason"),
    media: [
      {
        mediaType: form.get("mediaType"),
        url: form.get("mediaUrl"),
      },
    ],
  };
}

function generationPayload(form) {
  return {
    characterId: form.get("characterId"),
    mediaType: form.get("mediaType"),
    prompt: form.get("prompt"),
  };
}

function creditPayload(form) {
  return {
    userId: form.get("userId"),
    amount: Number(form.get("amount")),
    reason: form.get("reason"),
  };
}

function splitCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function render(value) {
  output.textContent = JSON.stringify(value, null, 2);
}
