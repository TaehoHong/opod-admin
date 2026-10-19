# Admin Settings API

API 연결·모델 목록과 기능별 실행 선택은 [API·모델 관리 API](admin-ai-management.md)가 담당한다.
여기서 조회·수정하는 기본 모델보다 기능별 선택이 우선한다. 생성 작업은 초안/잡에 보관한
선택을 사용하며 같은 연결의 주소·키는 settings owner가 현재 값으로 해석한다.

모든 API는 관리자 세션 쿠키 인증을 요구한다. 상태 변경 요청은
`x-opod-admin` 헤더가 필요하고, Origin이 있으면 요청 대상 origin과 정확히
일치해야 한다.

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
    "todaySpendUsd": 0.16
  }
}
```

- API keys are `{ "set": false }` when no DB key exists (an env key may
  still be in effect — check `resolved.sources.apiKey`).
- `resolved.*Provider` is the provider name the worker would route to right
  now. fal requires a key; opod-flux can resolve without one for an
  authentication-disabled deployment.
- `imageProvider: "spicyapi"`일 때 응답에 `spicyApiKey`(`{set,last4}`)와
  `spicyImageModel`(edit 모델 ID)이 있고, `resolved.t2iProvider`는 같은 계열의
  `spicyapi:<model>/text-to-image`, `editProvider`는 `spicyapi:<model>/edit`이다.
- `qwenImageNegativePrompt`는 `admin_settings`의
  `generation.qwenImageNegativePrompt`에 저장하는 공통 제외 문구다. 조회 시
  미설정이면 `null`이고, PUT은 문자열(최대 2,000자) 저장, 누락 유지,
  빈 값/null 삭제다. env나 코드 기본값은 없다. Admin 이미지 생성 설정에서
  편집하며 Qwen Image 3.0·Pro의 edit/t2i 요청에서만 게시물별 `negativePrompt`와
  합친다. 쉼표 단위 공백·빈 항목과 대소문자 차이의 중복을 정리하고, 합산
  2,000자 초과는 외부 생성 요청 전에 실패시킨다. 문구를 자동으로 자르지 않는다.
  저장 후 다음 제출부터 적용하고 이미 접수된 작업은 바꾸지 않는다.
- Each `sources` entry is `db`, `env`, or `none`.
- `worker`에는 KST 기준 당일 `costUsd` 합계와 예산·예상 비용 및 자동 실행
  스위치가 있다. `worker.enabled`는 이미지 생성 워커와 초안 워커를 함께
  제어한다. 워커는 매 tick마다 재해석한다.
- `enabledSource: "env"`는 아직 DB에 스위치를 저장하지 않아 `WORKER_ENABLED`
  초기값을 쓰는 상태다. 수동 실행은 이 스위치와 관계없이 가능하다.
- 평가 자동 실행 스위치는 현재 응답과 PUT 계약에 없다.

The same document also carries the **content-planner LLM** settings
(OpenAI-compatible chat completions, used by the draft worker):
`llmApiUrl`, `llmApiKey` (masked the same way), `llmModel`,
`resolved.plannerProvider` (`llm:<model>` or `unconfigured`), and
`resolved.plannerSources`. URL, key, and model must all resolve before draft
planning can run.

게시물 단계별 모델·지침은 [게시물 Agent 관리 API](admin-post-generation-agents.md)에서
관리한다. 저장된 단계는 해당 revision/model 참조를 사용하고, 아직 저장하지 않은
단계는 기존 공통 설정/코드 지침을 사용한다. 이미지 잡에 고정된 `_postAgent`
설정은 이후 공통 설정 변경으로 소급 교체하지 않는다.

## 캐릭터 채팅과 임베딩 설정 (opod-agent)

`chat.overrides`는 저장된 `agent.*` 값, `chat.effective`는 필드별 실효값이다.
채팅 URL·키·모델의 미설정 필드는 DB의 `planner.*` 값을 상속한다. 키는 설정
여부와 끝 4자리만 표시한다. PUT의 `agentLlmApiUrl`, `agentLlmApiKey`,
`agentLlmModel`은 생략하면 유지하고, 빈 값/null은 삭제해 재상속한다.

임베딩은 `agentEmbeddingApiUrl`, `agentEmbeddingApiKey`, `agentEmbeddingModel`
세 필드를 별도로 설정해야 한다. planner 상속과 자동 모델 기본값은 없다.
채팅 연결 테스트는 `target: "chat"`, 임베딩 테스트는 `target: "embedding"`이다.

현재 `DbSettingsProvider`는 매 호출마다 DB 설정을 조회한다. 설정이 같으면
provider 객체를 재사용하되, DB 조회 실패나 필수 설정 누락이면
`LlmConfigUnavailableError`를 반환한다. 이전 성공 설정이나 환경변수로
대체하지 않는다. 2026-07-21 계획의 60초 TTL과 마지막 설정 유지 설명은
현재 동작으로 사용하지 않는다.

## 과거 평가 설정

2026-08-18 게시물 평가 Agent와 평가 워커·화면·관리 설정을 제거했다.
과거 `DraftEvaluation`·`EvaluationReport` 행과 저장된 `evaluator.*` 값은
보존하지만, 현재 설정 응답·PUT·연결 테스트는 평가 실행 기능을 제공하지 않는다.
현재 게시물 Agent의 단계별 모델·지침·출력 규격은
[게시물 Agent 관리 API](admin-post-generation-agents.md)가 소유한다.

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

{ "target": "image" | "planner" | "chat" | "embedding",
  "imageProvider"?, "openaiApiKey"?, "openaiImageModel"?,
  "spicyApiKey"?, "spicyImageModel"?, "falApiKey"?,
  "opodFluxApiBaseUrl"?, "opodFluxApiKey"?,
  "llmApiUrl"?, "llmApiKey"?, "llmModel"? }
```

Validates the combination that WOULD apply after saving: supplied fields
override the currently effective settings (DB > env), omitted fields fall
through. Returns `{ ok, message }`. The image check probes the selected provider
without submitting a job (no cost); opod-flux sends Bearer only when a key resolves,
so an authentication-disabled Tailnet deployment can be tested with URL alone.
SpicyAPI is checked with the free `GET https://api.spicyapi.ai/api/v1/models/{model}`
lookup (Bearer key); it reports 401/403 and an unavailable model but does not
prove that a generation will succeed. The
planner check makes a minimal 1-token completion call. Nothing is persisted.

## Update generation provider settings

```http
PUT /api/admin/v1/settings/generation
```

Body (all fields optional):

| Field                                                                         | Semantics                                                             |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `imageProvider`                                                               | `fal`, `opod-flux`, `openai` or `spicyapi`; omit = keep, `null` = env/default `fal` |
| `opodFluxApiBaseUrl`                                                          | omit = keep, `null`/blank = env fallback, HTTPS `/v1` base URL = save |
| `opodFluxApiKey`                                                              | optional; omit = keep, `null`/blank = env fallback, string = save     |
| `openaiApiKey` | omit = keep, `null`/blank = delete; `OPENAI_IMAGE_API_KEY` env fallback |
| `openaiImageModel` | omit = keep, `null`/blank = delete; `OPENAI_IMAGE_MODEL` env fallback. 현재 허용값은 `gpt-image-2.5-sunburst` |
| `spicyApiKey` | omit = keep, `null`/blank = delete; `SPICY_API_KEY` env fallback. 응답·감사 이력에는 끝 4자리만 |
| `spicyImageModel` | omit = keep, `null`/blank = delete; `SPICY_IMAGE_MODEL` env fallback. 허용값 `alibaba/qwen-image-3.0-pro/edit`(화면 기본값), `alibaba/qwen-image-3.0/edit`, `bytedance/seedream-5.0-pro/edit`. 레퍼런스 없는 컷은 같은 계열의 `/text-to-image`로 실행 |
| `falApiKey`                                                                   | omit = keep, `null`/blank = delete (fall back to env), string = save  |
| `falImageModel`                                                               | same semantics; the reference-conditioning (edit) model               |
| `falImageT2iModel`                                                            | same semantics; the cold-start text-to-image model                    |
| `llmApiUrl`                                                                   | same semantics; planner LLM endpoint (OpenAI-compatible)              |
| `llmApiKey`                                                                   | same semantics; planner LLM key                                       |
| `llmModel`                                                                    | same semantics; planner LLM model                                     |
| `agentLlmApiUrl` / `agentLlmApiKey` / `agentLlmModel` | 생략 = 유지, 빈 값/null = 삭제 후 DB planner 필드 상속 |
| `agentEmbeddingApiUrl` / `agentEmbeddingApiKey` / `agentEmbeddingModel` | 생략 = 유지, 빈 값/null = 삭제 후 미설정. 임베딩 세 값 별도 필수 |
| `workerEnabled`                                                               | boolean; `null` restores the `WORKER_ENABLED` env default             |
| `pipelineV3Enabled` | boolean; `null` = `POST_PIPELINE_V3_ENABLED` 초기값. 활성화 전 strict-output capability probe를 검증 |

```json
{ "falApiKey": "fal-...", "falImageModel": "fal-ai/nano-banana/edit" }
```

The response is the same shape as `GET`. Validation: strings only (booleans for
`workerEnabled` and `pipelineV3Enabled`), key ≤ 500 chars, models ≤ 200 chars. Switch changes are
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
