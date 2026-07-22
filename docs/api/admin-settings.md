# Admin Settings API

All endpoints require an admin JWT:

```http
Authorization: Bearer <admin-jwt>
```

Settings are stored in the `admin_settings` key-value table. **DB values
override env vars** and apply from the next processed generation job — no
process restart needed. The raw API key is never returned by any endpoint;
responses expose only `{ set, last4 }`.

## Get generation provider settings

```http
GET /api/settings/generation
```

```json
{
  "falApiKey": { "set": true, "last4": "cd12" },
  "falImageModel": "fal-ai/nano-banana/edit",
  "falImageT2iModel": "fal-ai/nano-banana",
  "resolved": {
    "t2iProvider": "fal:fal-ai/nano-banana",
    "editProvider": "fal:fal-ai/nano-banana/edit",
    "sources": { "apiKey": "db", "editModel": "db", "t2iModel": "db" }
  },
  "worker": {
    "enabled": true,
    "dailyBudgetUsd": 2,
    "jobCostEstimateUsd": 0.08,
    "todaySpendUsd": 0.16
  }
}
```

- `falApiKey` is `{ "set": false }` when no DB key exists (an env key may
  still be in effect — check `resolved.sources.apiKey`).
- `resolved.*Provider` is the provider name the worker would route to right
  now (`local` when no key resolves).
- Each `sources` entry is `db`, `env`, or `none`.
- `worker` reflects env-driven worker config plus today's (KST) `costUsd` sum.

The same document also carries the **content-planner LLM** settings
(OpenAI-compatible chat completions, used by the draft worker):
`llmApiUrl`, `llmApiKey` (masked the same way), `llmModel`,
`resolved.plannerProvider` (`llm:<model>` or `local`), and
`resolved.plannerSources`. The LLM planner activates only when URL, key, and
model all resolve; otherwise the deterministic local planner runs.

## Character-chat LLM (opod-agent)

The same document carries the chat LLM under `chat`: `overrides` (the raw
`agent.*` values; key masked) and `effective` (what the agent will actually
use — unset fields inherit the planner's effective values per field, plus
`embeddingModel` defaulting to `text-embedding-3-small`, and an `overridden`
map). PUT accepts `agentLlmApiUrl` / `agentLlmApiKey` / `agentLlmModel` /
`agentEmbeddingModel` with the usual omit/blank semantics — clearing a field
re-inherits. The connection test accepts `target: "chat"`. opod-agent
re-reads these settings on a ~60s TTL, so console changes reach live chat
without a restart.

## Setting change history (audit)

```http
GET /api/settings/generation/changes
```

Returns `{ items: [{ id, adminEmail, actionType, target, summary, createdAt }] }`
— the latest 20 rows from `console_logs` (actions `SETTINGS_SET` /
`SETTINGS_CLEAR`). Every PUT records only fields whose value actually
changed; key values are summarized as `····last4`, never raw. System-side
events live in the separate `service_logs` table (first writers:
`DRAFT_PUBLISH_FAILED` from the admin worker, `MESSAGE_REPLY_FAILED` from
service-backend).

## Test a provider connection (read-only)

```http
POST /api/settings/generation/test
Content-Type: application/json

{ "target": "image" | "planner", "falApiKey"?, "llmApiUrl"?, "llmApiKey"?, "llmModel"? }
```

Validates the combination that WOULD apply after saving: supplied fields
override the currently effective settings (DB > env), omitted fields fall
through. Returns `{ ok, message }`. The image check authenticates against fal
without submitting a job (no cost); the planner check makes a minimal
1-token completion call. Nothing is persisted.

## Update generation provider settings

```http
PUT /api/settings/generation
```

Body (all fields optional):

| Field | Semantics |
| --- | --- |
| `falApiKey` | omit = keep, `null`/blank = delete (fall back to env), string = save |
| `falImageModel` | same semantics; the reference-conditioning (edit) model |
| `falImageT2iModel` | same semantics; the cold-start text-to-image model |
| `llmApiUrl` | same semantics; planner LLM endpoint (OpenAI-compatible) |
| `llmApiKey` | same semantics; planner LLM key |
| `llmModel` | same semantics; planner LLM model |

```json
{ "falApiKey": "fal-...", "falImageModel": "fal-ai/nano-banana/edit" }
```

The response is the same shape as `GET`. Validation: strings only, key ≤ 500
chars, models ≤ 200 chars.

## Run the generation worker manually

```http
POST /api/generation/worker/run
```

Body: `{ "jobId": "<uuid>" }` (optional). With `jobId` it claims that specific
**queued image** job; without it, the next queued job. The claim is
conditional (`queued → running`, lease set, `attemptCount` incremented) and
processing continues in the background — the response returns immediately:

```json
{ "jobId": "0190d8d1-463b-7e36-a9ef-0242ac120010" }
```

- `{ "jobId": null }` (200-range) — no queued job was available.
- `400 Generation job is not queued (image jobs only)` — a specific `jobId`
  was requested but that job is not claimable.

Manual runs work regardless of `WORKER_ENABLED` (which only controls the
automatic polling loop). The run uses the currently resolved provider
settings, so a key saved via `PUT /api/settings/generation` applies
immediately.
