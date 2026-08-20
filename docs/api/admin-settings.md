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
GET /api/admin/v1/settings/generation
```

```json
{
  "imageProvider": "opod-flux",
  "opodFluxApiBaseUrl": "https://taeho.taildac41e.ts.net:8850/v1",
  "opodFluxApiKey": { "set": true, "last4": "cd12" },
  "falApiKey": { "set": true, "last4": "cd12" },
  "falImageModel": "fal-ai/nano-banana/edit",
  "falImageT2iModel": "fal-ai/nano-banana",
  "resolved": {
    "t2iProvider": "opod-flux:v1",
    "editProvider": "opod-flux:v1",
    "sources": {
      "provider": "db",
      "apiKey": "db",
      "editModel": "db",
      "t2iModel": "db",
      "opodFluxApiBaseUrl": "db",
      "opodFluxApiKey": "db"
    }
  },
  "worker": {
    "enabled": true,
    "enabledSource": "db",
    "dailyBudgetUsd": 2,
    "jobCostEstimateUsd": 0.08,
    "todaySpendUsd": 0.16,
    "evaluation": { "enabled": false, "enabledSource": "env" }
  }
}
```

- API keys are `{ "set": false }` when no DB key exists (an env key may
  still be in effect — check `resolved.sources.apiKey`).
- `resolved.*Provider` is the provider name the worker would route to right
  now. fal requires a key; opod-flux can resolve without one for an
  authentication-disabled deployment.
- Each `sources` entry is `db`, `env`, or `none`.
- `worker` carries today's (KST) `costUsd` sum, the boot-time tuning values
  (interval, budget, cost estimate) and the two automatic-loop switches.
- `worker.enabled` gates both the generation worker and the draft worker;
  `worker.evaluation.enabled` gates the evaluation worker. Both live in
  `admin_settings` and each worker re-reads its switch on every tick, so a
  PUT takes effect on the next poll without a restart. `enabledSource: "env"`
  means the switch has never been saved from the console and the
  `WORKER_ENABLED` / `EVALUATION_WORKER_ENABLED` env value is still acting as
  the initial default; the first save takes over permanently. Manual runs are
  never gated by these switches.

The same document also carries the **content-planner LLM** settings
(OpenAI-compatible chat completions, used by the draft worker):
`llmApiUrl`, `llmApiKey` (masked the same way), `llmModel`,
`resolved.plannerProvider` (`llm:<model>` or `unconfigured`), and
`resolved.plannerSources`. URL, key, and model must all resolve before draft
planning can run.

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

## Evaluation LLM (evaluation worker)

The same document carries the evaluation LLM under `evaluator`, with the same
`overrides` / `effective` shape as `chat`. Unset fields inherit the planner's
effective values per field, which lets a cheaper or simply different judge
model be pinned to reduce self-evaluation bias.

Unlike the image and planner settings, `evaluator.*` has **no env fallback** —
it is DB-only, so a stale `EVALUATOR_LLM_*` left in the environment can never
resurrect a key that was cleared from the console. PUT accepts
`evaluatorLlmApiUrl` / `evaluatorLlmApiKey` / `evaluatorLlmModel` with the
usual omit/blank semantics; clearing a field re-inherits from the planner. The
connection test accepts `target: "evaluator"`.

## Setting change history (audit)

```http
GET /api/admin/v1/settings/generation/changes
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
POST /api/admin/v1/settings/generation/test
Content-Type: application/json

{ "target": "image" | "planner" | "chat" | "evaluator",
  "imageProvider"?, "falApiKey"?,
  "opodFluxApiBaseUrl"?, "opodFluxApiKey"?,
  "llmApiUrl"?, "llmApiKey"?, "llmModel"? }
```

Validates the combination that WOULD apply after saving: supplied fields
override the currently effective settings (DB > env), omitted fields fall
through. Returns `{ ok, message }`. The image check probes the selected provider
without submitting a job (no cost); opod-flux sends Bearer only when a key resolves,
so an authentication-disabled Tailnet deployment can be tested with URL alone. The
planner check makes a minimal 1-token completion call. Nothing is persisted.

## Update generation provider settings

```http
PUT /api/admin/v1/settings/generation
```

Body (all fields optional):

| Field                                                                         | Semantics                                                             |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `imageProvider`                                                               | `fal` or `opod-flux`; omit = keep, `null` = env/default `fal`         |
| `opodFluxApiBaseUrl`                                                          | omit = keep, `null`/blank = env fallback, HTTPS `/v1` base URL = save |
| `opodFluxApiKey`                                                              | optional; omit = keep, `null`/blank = env fallback, string = save     |
| `falApiKey`                                                                   | omit = keep, `null`/blank = delete (fall back to env), string = save  |
| `falImageModel`                                                               | same semantics; the reference-conditioning (edit) model               |
| `falImageT2iModel`                                                            | same semantics; the cold-start text-to-image model                    |
| `llmApiUrl`                                                                   | same semantics; planner LLM endpoint (OpenAI-compatible)              |
| `llmApiKey`                                                                   | same semantics; planner LLM key                                       |
| `llmModel`                                                                    | same semantics; planner LLM model                                     |
| `agentLlmApiUrl` / `agentLlmApiKey` / `agentLlmModel` / `agentEmbeddingModel` | same semantics; blank re-inherits from the planner                    |
| `evaluatorLlmApiUrl` / `evaluatorLlmApiKey` / `evaluatorLlmModel`             | same semantics; blank re-inherits from the planner                    |
| `workerEnabled`                                                               | boolean; `null` restores the `WORKER_ENABLED` env default             |
| `evaluationWorkerEnabled`                                                     | boolean; `null` restores the `EVALUATION_WORKER_ENABLED` env default  |

```json
{ "falApiKey": "fal-...", "falImageModel": "fal-ai/nano-banana/edit" }
```

The response is the same shape as `GET`. Validation: strings only (booleans for
the two switches), key ≤ 500 chars, models ≤ 200 chars. Switch changes are
audited like any other field, with the stored `"true"` / `"false"` as the
summary.

## Run the generation worker manually

```http
POST /api/admin/v1/generation/worker/run
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

Manual runs work regardless of the `workerEnabled` switch (which only controls
the automatic polling loop). The run uses the currently resolved provider
settings, so a key saved via `PUT /api/admin/v1/settings/generation` applies
immediately.

The evaluation worker has the equivalent manual trigger at
`POST /api/admin/v1/evaluations/worker/run` — see
`docs/api/admin-evaluations.md`.
