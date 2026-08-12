# PAVE Plan: 게시물 생성 Agent 아키텍처 V3 적용

- 최초 작성: 2026-08-12, V3 정렬: 2026-08-13
- PAVE 재점검: 2026-08-13
- 대상 브랜치: `experiment/image-prompt-optimization`
- 현재 상태: **V3 contract/runtime 구현 완료 — production rollout gate는 미충족**
- canonical schema 저장소: `/Users/hongtaeho/opod/opod-service-backend`
- 구현 저장소: `/Users/hongtaeho/opod/opod-admin`

## 0. 목표와 완료 조건

현재 결합된 콘텐츠 기획을 `Post Planning -> Image Planning -> Image Prompt
Generation`으로 분리하고, 각 산출물과 최종 선택 이미지에 대응하는 네 개의 진단 전용
Evaluation Agent를 기존 draft 파이프라인에 적용한다.

완료 조건:

1. 신규 V3 draft만 새 파이프라인을 사용하고 기존 V2 draft는 legacy 경로로 완주한다.
2. 세 생성 Agent의 입력·출력·권한 경계가 승인된 전문과 strict parser로 동일하게
   강제된다.
3. 이미지 장수는 오케스트레이터가 결정·저장하고 Image Planning Agent는 바꾸지 않는다.
4. 모델 전용 정책은 코드 registry가 소유하며 이미지 생성 파라미터는 Prompt Agent
   계약에 들어가지 않는다.
5. 네 Evaluation Agent는 진단 이력만 저장하고 재시도·재작성·모델 선택·후보 선택·상태
   전이를 하지 않는다.
6. 모든 단계는 대상 산출물 revision/hash와 LLM/evaluation attempt를 추적할 수 있다.
7. 운영자는 관리자 화면에서 현재 단계, 멈춘 이유, 다음 행동, 평가 결과를 확인한다.
8. 게시 성공 시 승인된 non-stale memory candidate만 post와 같은 transaction에서
   저장된다.
9. 관련 unit/integration/E2E/UI test와 두 저장소 schema/build 검증이 통과한다.

## 1. 요구사항 출처

| ID | 요구사항 | 출처 |
|---|---|---|
| R1 | Post Planning, Image Planning, Image Prompt Generation 역할을 분리한다. | `user-confirmed` |
| R2 | 동일한 운영자 요청을 Post/Image Planning에 주되 각 Agent는 자기 범위만 처리한다. | `user-confirmed` |
| R3 | 이미지 장수는 입력값이며 오케스트레이터가 난수로 결정한다. | `user-confirmed` |
| R4 | 레퍼런스 의미·선택은 Image Planning, 실제 slot/order는 모델 정책 코드가 소유한다. | `user-confirmed` |
| R5 | 모델 전용 지침은 공통 Prompt Agent 전문과 분리해 관리한다. | `user-confirmed` |
| R6 | seed/steps/CFG/sampler/scheduler/API endpoint는 이미지 생성 계층이 소유한다. | `user-confirmed` |
| R7 | 네 Evaluation Agent는 진단만 하고 파이프라인을 제어하지 않는다. | `user-confirmed` |
| R8 | Post 평가에는 operator request가 없는 경우가 대부분이며 persona, memory, recent posts, writing style, AI-tell을 평가한다. | `user-confirmed` |
| R9 | memory candidate는 게시 전 검토하고 게시 후에만 memory가 된다. | `user-confirmed` |
| R10 | 기존 draft/evaluation 이력을 깨뜨리지 않는다. | `repo-evidenced` |
| R11 | strict output을 요구하되 provider가 지원하지 않으면 V3를 활성화하지 않는다. | `agent-assumed`, 재검토 시 승인 대상 |
| R12 | 기존 hashtag 정규화 동작을 V3에서도 보존한다. | `repo-evidenced`, `agent-recommended` |
| R13 | Generated Image 평가는 컷별 최종 선택 세트에 대해 실행한다. | `agent-assumed`, 승인된 evaluator의 단일 이미지 입력 계약에서 도출 |

설계 정본:

- `.codex/pave/plans/2026-08-12-post-generation-agent-role-redesign.md`
- `.codex/pave/plans/2026-08-12-image-planning-evaluation-agent.md`
- `.codex/pave/plans/2026-08-12-image-prompt-evaluation-agent.md`
- `.codex/pave/plans/2026-08-12-generated-image-evaluation-agent.md`

## 2. Feature Readiness Gate

| 항목 | 결정 | 준비 상태 |
|---|---|---|
| Actor | 자동 scheduler/worker, 수동 admin operator, 네 evaluator worker | Ready |
| Trigger | 신규 draft 생성, 수동 단계 실행, 선택 이미지 변경, 게시 승인 | Ready |
| Happy path | brief -> post plan -> image plan -> prompt -> generation -> review -> publish -> memory | Ready |
| Material edge cases | 입력 부족, 사실 충돌, unsupported plan/model/reference, provider strict-output 미지원, lease 만료, stale revision, 일부 이미지 미선택, publish retry | Ready |
| Permissions | 기존 admin 인증/권한을 재사용하고 Agent 직접 호출 endpoint는 만들지 않는다. | Ready |
| Data rules | legacy V2/V3 pinning, per-artifact revision/hash, attempt 이력 재사용, memory stale/dedupe | Ready |
| Public errors | `needs_input`, `conflict`, `blocked`, `unsupported_plan`, `needs_configuration`, `failed`를 구분한다. | Ready |
| Acceptance | 아래 slice별 행동·테스트와 최종 검증으로 판정한다. | Ready |
| Verification | unit -> integration -> E2E/UI -> full lint/build/schema sync 순서 | Ready |
| Rollout evidence | 텍스트 fixture freeze와 실제 이미지 calibration이 필요하다. | **구현은 가능, production 활성화 gate** |

PAVE 판정: 구현 계획은 아래 미확정 결정을 한 번에 승인받은 뒤 실행 가능하다. 실제 이미지
fixture가 없는 상태에서는 contract 구현까지 가능하지만 production V3 활성화는 금지한다.

## 3. 범위 지도

```text
Draft creation
  -> pipeline version pinning
  -> Post Planning + Post Evaluation
  -> imageCount decision
  -> Image Planning + ImagePlan Evaluation
  -> model policy package
  -> Image Prompt Generation + Prompt Evaluation
  -> image generation and operator selection
  -> Generated Image Evaluation
  -> operator approval
  -> publish + selected memory candidates
```

In scope:

- V3 state/revision/lineage, 세 생성 Agent, 네 Evaluation Agent
- exact model policy registry와 generation 전 binding validator
- 기존 worker lease/state machine에 V3 claim gate 추가
- admin read model, 8단계 UI, 수동 실행·편집·선택 UX
- publish/memory 원자성, legacy V2 호환, rollout capability gate

Out of scope:

- 평가 결과 기반 자동 재작성·재생성·모델 교체
- evaluator가 생성 설정을 추천하는 기능
- 보조 인물 identity reference와 multi-location 지원
- 모델 정책의 관리자 자유 편집
- 완료된 legacy V2 row rewrite와 legacy 코드 제거
- production V3 활성화와 실제 이미지 품질 승인

## 4. Existing Owner Check

새 기능은 아래 기존 소유자를 확장하며 같은 책임의 두 번째 구현을 만들지 않는다.

| 책임 | 기존 소유자/증거 | 결정 |
|---|---|---|
| draft claim, lease, lifecycle | `src/worker/draft-worker.service.ts`, `draft-worker.repository.ts` | V3 stage/revision CAS를 여기 추가 |
| raw LLM 요청·응답 attempt | `LlmLog`, `src/domain/llm-logs/*` | 새 attempt table 금지; type/metadata만 확장 |
| evaluator attempt/lease | `DraftEvaluation`, `evaluation.repository.ts` | 기존 이력 모델과 kind를 재사용 |
| runtime settings/toggles | `GenerationSettingsService.resolveWorkerToggles()` | V3 enable/capability를 여기서 해석 |
| admin stage read model | `src/admin/post-workspace/*` | raw `conceptJson` 대신 typed V3 read model 제공 |
| model-family guidance | `prompts/image-prompt-builder.ts` | V3는 versioned model-policy prompt로 이동하되 legacy V2는 유지 |
| provider negative prompt 지원 | `src/worker/image-generation.provider.ts` | V3 policy registry가 이를 단일 capability source로 확장 |
| JSON/value helpers | `src/worker/value-utils.ts`, `plan-evaluator.ts` | transport 공통 검증만 공유; Agent 의미 검증은 각 parser 소유 |
| hashtag normalization | `content-planner.ts`, `drafts.service.ts`, `admin.service.ts`에 중복 | V3가 네 번째 구현을 만들지 않고 공통 helper로 현 동작을 보존 |
| UI tokens/layout | `docs/04-design-rules.md`, `packages/admin/src/app/theme.ts` | cream/ink/accent와 Mantine/CSS Modules 재사용 |
| UI stage/evaluation pattern | `DraftStage.tsx`, `EvaluationChips.tsx`, `PostWorkPage.tsx` | 기존 컴포넌트를 확장하고 별도 디자인 시스템 금지 |

## 5. Decision Ledger

| ID | 상태 | 결정 | 근거/출처 | 재검토 조건 |
|---|---|---|---|---|
| D1 | Confirmed | `plan`, `prompt`, `image` 의미는 보존하고 `image_plan`만 추가한다. | R10 + 기존 enum/row | legacy cleanup |
| D2 | Confirmed | 세부 상태는 `conceptJson.pipeline`; broad `PostDraftStatus` enum은 유지한다. | 기존 lease/lifecycle owner | JSON 크기·쿼리 성능이 문제일 때 |
| D3 | Revised | 산출물 최신본만 `conceptJson`에 두고 raw attempt 이력은 `LlmLog`, 평가 이력은 `DraftEvaluation`을 사용한다. 새 artifact-history table은 만들지 않는다. | Existing Owner Check | accepted-artifact 과거본 조회가 실제 제품 요구가 될 때 |
| D4 | Revised | 각 산출물에 `revision`, canonical `hash`, `producerLogId`, upstream revision/hash를 저장한다. downstream은 불일치 시 stale이다. | 재현성·CAS 요구 | 별도 normalized artifact table 도입 시 |
| D5 | Confirmed | imageCount는 `1..min(configuredMax, 3)` 균등 난수, 최초 호출 전에 저장하고 재진입 시 재사용한다. | R3 | 제품 최대 장수 변경 시 |
| D6 | Confirmed | `insufficient_distinct_shots`만 더 작은 장수로 새 ImagePlan attempt를 허용한다. evaluator는 관여하지 않는다. | 승인 설계 | 제품 정책 변경 시 |
| D7 | Revised | strict native JSON schema capability를 settings connection test에서 실제 probe한다. 미지원 provider는 V3 활성화 불가이며 loose fallback을 쓰지 않는다. | R11 | provider 계약 변경 시 |
| D8 | Confirmed | V3 Prompt Agent에 로컬 문자열 결합 fallback을 쓰지 않는다. 미설정/미지원은 `needs_configuration`으로 멈춘다. legacy V2 fallback은 유지한다. | Agent 계약·legacy 호환 | deterministic V3 compiler를 별도 승인할 때 |
| D9 | Confirmed | model registry는 exact model ID -> versioned policy/capabilities/slot mapping이다. unknown model은 `unsupported_plan`. | R4-R6 | provider/model onboarding 시 |
| D10 | Revised | hashtag는 현재 동작(선행 `#` 제거, trim, exact dedupe, 최대 5, case 보존)을 공통 helper로 이동해 보존한다. lowercase/NFC/internal-space 거절은 이번 범위에서 추가하지 않는다. | R12 | 별도 콘텐츠 정책 승인 시 |
| D11 | Recommended | `captionLanguages`는 순서 보존·중복 제거된 canonical BCP-47 tag로 검증한다. | 다국어 표현 필요 | 실제 character language taxonomy 확정 시 |
| D12 | Confirmed | 평가는 항상 비차단이며 evaluator failure는 evaluation attempt만 failed 처리한다. | R7 + 기존 구현 | 평가를 gate로 바꾸는 별도 제품 결정 시 |
| D13 | Recommended | Generated Image 평가는 모든 컷의 `outputMediaId`가 선택된 최종 세트만 대상으로 하며 선택 변경/재생성 시 새 attempt를 만든다. | R13 + evaluator 단일 이미지 입력 | 후보별 사전평가가 필요할 때 |
| D14 | Confirmed | memory candidate는 stable key와 source PostPlan hash를 가지며 편집 시 stale; publish 때만 selected/non-stale 항목을 저장한다. | R9 | memory 검수 UX 변경 시 |
| D15 | Revised | rollout flag는 env-only가 아니라 Generation Settings가 소유하고 env는 DB 미설정 시 fallback이다. 신규 draft의 version만 pin한다. | settings owner 관례 | rollout 완료 후 cleanup |
| D16 | Confirmed | UI는 기존 8칸 rail을 `brief/post-plan/image-plan/prompt/generation/review/publish/memory`로 바꾸고 평가를 각 단계에 inline 표시한다. | 기존 UI + 승인 설계 | 정보 구조 변경 시 |

재승인 시 D7, D10, D11, D13, D15를 포함한 전체 ledger가 승인된 것으로 본다.

## 6. 저장·상태·오류 계약

`conceptJson`은 최신 accepted snapshot만 저장한다. raw prompts/response/error attempt는
`LlmLog`, evaluator attempt는 `DraftEvaluation`이 소유한다.

```json
{
  "pipelineVersion": "post-pipeline-v3",
  "operatorRequest": "string | null",
  "pipeline": {
    "stage": "post_plan | image_plan | image_prompt | generation | review | publish | memory",
    "state": "pending | running | ready | needs_input | conflict | blocked | unsupported_plan | needs_configuration | failed",
    "imageCount": "integer | null",
    "reasonCodes": ["string"]
  },
  "postPlanning": {
    "revision": 1,
    "hash": "sha256:...",
    "producerLogId": "123",
    "contractVersion": "post-plan-v1",
    "promptVersion": "post-planner-v1",
    "input": {},
    "output": {}
  },
  "imagePlanning": {
    "revision": 1,
    "hash": "sha256:...",
    "source": { "postPlanningRevision": 1, "postPlanningHash": "sha256:..." },
    "producerLogId": "124",
    "contractVersion": "image-plan-v1",
    "promptVersion": "image-planner-v1",
    "input": {},
    "output": {}
  },
  "promptBuild": {
    "revision": 1,
    "hash": "sha256:...",
    "source": { "imagePlanningRevision": 1, "imagePlanningHash": "sha256:..." },
    "producerLogId": "125",
    "contractVersion": "prompt-build-package-v1",
    "commonPromptVersion": "image-prompt-generator-v1",
    "modelPolicy": { "id": "string", "version": "string" },
    "input": {},
    "output": {}
  }
}
```

Rules:

- `pipelineVersion`이 없으면 legacy V2이며 실행 중 V3로 변환하지 않는다.
- artifact hash는 key ordering이 고정된 canonical JSON의 SHA-256이다.
- stage write는 expected stage/state/revision을 조건으로 한 compare-and-set이며 artifact,
  pipeline state, action log를 한 transaction에서 갱신한다.
- upstream revision/hash가 바뀌면 downstream artifact/job/evaluation은 삭제하지 않고
  stale로 판정하며 다음 실행이 새 revision/attempt를 만든다.
- `needs_input/conflict/blocked/unsupported_plan/needs_configuration`은 lease를 해제한
  paused state다. V3 claim은 `pipeline.state=pending`만 집는다.
- lease 만료는 broad status와 lease만 회수하고 저장된 stage/imageCount/revision은
  보존한다.
- `failed`는 transient/system attempt가 재시도 상한을 소진한 상태다. 재시도 정책은
  evaluator가 아니라 worker owner가 집행한다.

Public state guidance:

| 상태 | 의미 | 운영자 다음 행동 |
|---|---|---|
| needs_input | 필수 캐릭터/요청 정보 부족 | 입력 보완 후 현재 단계 재실행 |
| conflict | 요청과 확정 사실/정책 충돌 | 요청 수정 또는 중단 |
| blocked | 현재 계약으로 정상 산출 불가 | 레퍼런스/기획 보완 또는 범위 변경 |
| unsupported_plan | 모델/route/reference 조합 미지원 | 모델 또는 이미지 기획 변경 |
| needs_configuration | LLM 설정/strict output capability 부족 | 설정 연결 테스트 후 재실행 |
| failed | 네트워크·provider·내부 오류 | 진단정보 확인 후 재시도 |

## 7. 입력·정규화 계약

- `operatorRequest` 최대 4,000자. legacy `sceneHint` 하나만 들어오면 그대로 매핑하고,
  둘 다 다르며 nonblank이면 400을 반환한다.
- recent posts는 최신 20개 newest-first; V3는 saved premise + published caption/hashtags,
  legacy premise는 `null`이다.
- active memories는 최신 20개의 `type + content`만 제공하고 내부 reason은 제외한다.
- persona router는 `characterContext`, `content_style`, `voice`, `boundaries`와 추가
  context를 구분하며 greeting/examples는 planning authority로 쓰지 않는다.
- content_style 또는 voice가 없으면 LLM 호출 없이 `needs_input`이다.
- hashtag는 D10의 현행 동작을 공통 helper로 보존한다.
- 길이 상한은 parser와 DTO 양쪽에 같은 상수로 둔다: caption/premise 2,000,
  purpose 1,000, memory candidate 2,000, scene 4,000, capture 2,000, prompt 16,000,
  negative prompt 4,000.
- catalog/reference ID, binding/slot, sortOrder, imageCount, union exact key와 presentation/
  continuity 불변조건은 LLM schema뿐 아니라 런타임 parser가 다시 검증한다.

## 8. 모델 정책과 평가 계약

Model policy:

- 공통 Agent prompt는 의미 보존·출력 형식을, code-injected model policy는 문법,
  capability, slot wording/order만 소유한다.
- policy는 visible semantics를 새로 만들거나 ImagePlan의 reference 의미를 변경할 수 없다.
- provider 요청 직전 `(shotSortOrder, bindingId)`로 ImagePlan binding, prompt slot, 실제
  media asset을 join해 누락·추가·중복·순서 불일치를 거절한다.
- generation 실행 설정은 기존 provider/settings owner가 계속 소유한다.

Evaluation:

- kind mapping은 `plan=Post`, `image_plan=ImagePlan`, `prompt=ImagePrompt`,
  `image=Generated Image`다.
- `rubricVersion`은 suite version, 개별 evaluator/prompt/schema version과 대상 artifact
  revision/hash는 `scoresJson._meta`에 저장한다.
- evaluator parser 실패는 해당 attempt만 failed로 끝낸다.
- V3 `suggestionsJson`은 rewrite를 만들지 않으므로 `null`이다. 진단은 fixed scores,
  issues/evidence, operator assessment에 보존한다.
- Generated evaluator는 선택하지 않는다. 모든 컷에 선택 이미지가 있는 경우만 최신
  선택 세트를 평가한다.

## 9. UI 기준

- 디자인 정본: `docs/04-design-rules.md`.
- token 정본: `packages/admin/src/app/theme.ts`.
- 단계 패턴: `DraftStage.tsx`, `PostWorkPage.tsx`; 평가 패턴: `EvaluationChips.tsx`.
- 장식보다 현재 상태·영향·다음 행동을 우선하고 `문제 -> 가능한 원인 -> 다음 행동`
  순서로 한국어 안내한다.
- raw provider payload/ID는 기본 화면에 숨기고 진단 펼치기에서만 표시한다.
- 색상만으로 상태를 구분하지 않고 label/text를 함께 제공한다.
- 기존 `/evaluation` URL은 `/prompt` redirect로 보존한다.
- backend가 typed V3 read model을 만들며 frontend가 raw `conceptJson`을 추측하지 않는다.

## 10. 수직 구현 슬라이스

각 slice는 outcome과 focused verification을 통과하기 전 다음 slice로 가지 않는다.

### [x] Slice 1 — 평가 enum schema sync

Outcome: `DraftEvaluationKind.image_plan`을 canonical schema/migration/admin mirror에 추가.

Files:

- service `prisma/schema.prisma`
- service `prisma/migrations/20260812145819_add_image_plan_draft_evaluation_kind/migration.sql`
- admin `prisma/schema.prisma`

Verified:

- service `npm run db:generate`
- service `npm run test -- architecture` (7/7)
- service `npm run build`
- admin `npm run schema:check`
- admin `npm run db:generate`

### [x] Slice 2 — V3 version pinning, artifact lineage, CAS

Outcome: 신규 draft의 version을 고정하고 최신 artifact revision/hash와 stage state를
transactional CAS로 저장한다. LLM/evaluation 이력 모델은 재사용한다.

Files:

- `src/admin/drafts/drafts.service.ts`
- `src/admin/drafts/drafts.repository.ts`
- `src/admin/drafts/drafts.service.spec.ts`
- `src/worker/draft-worker.repository.ts`
- `src/worker/draft-worker.service.ts`
- `src/worker/value-utils.ts`
- `src/worker/draft-worker.repository.spec.ts`
- `src/worker/draft-worker.service.spec.ts`

Verify:

- concurrent expected-revision 중 하나만 성공
- lease 회수 후 imageCount/revision 보존
- upstream edit 뒤 downstream stale 판정
- legacy V2 draft 분기 유지

### [x] Slice 3 — rollout setting과 strict-output capability gate

Outcome: Generation Settings가 신규 draft의 V3 pinning과 LLM strict JSON capability를
소유한다. 지원하지 않는 설정은 저장/활성화 전에 진단된다.

Files:

- `src/domain/settings/generation-settings.service.ts`
- `src/domain/settings/generation-settings.repository.ts`
- `src/admin/settings/dto/update-generation-settings.dto.ts`
- `src/admin/settings/dto/test-generation-settings.dto.ts`
- `src/admin/settings/admin-settings.controller.ts`
- `src/domain/settings/generation-settings.service.spec.ts`
- `packages/admin/src/features/settings/api.ts`
- `packages/admin/src/features/settings/payload.ts`
- `packages/admin/src/features/settings/GenerationSettingsForm.tsx`
- `packages/admin/src/features/settings/SettingsPage.test.tsx`

Verify:

- DB setting > env fallback, default false
- connection test가 최소 strict JSON schema request를 실제 전송
- 미지원이면 V3 enable 거절/`needs_configuration`
- 이미 생성된 draft version은 setting 변경에 영향 없음

### [x] Slice 4 — Post Planning end-to-end

Outcome: 승인 전문, native schema 요청, strict parser, input preflight, persistence와 수동/
자동 실행이 하나의 Post Planning slice로 동작한다.

Files:

- `prompts/post-planner.ts`
- `src/worker/post-planner.ts`
- `src/worker/draft-worker.service.ts`
- `src/worker/draft-worker.repository.ts`
- `src/domain/llm-logs/llm-log.service.ts`
- `src/worker/post-planner.spec.ts`
- `src/worker/draft-worker.service.spec.ts`
- `src/domain/llm-logs/llm-log.service.spec.ts`

Verify:

- ready/needs_input/conflict exact union
- extra/inactive key, unsupported catalog ID, length 위반 거절
- operatorRequest 없는 정상 자동 입력
- writing profile 부족 시 LLM 무호출
- output revision/hash/producerLogId/action log 원자 저장
- 새 `runJsonFetchWithLog` 계열이 LLM response와 log id를 반환하고 기존
  `runJsonFetch` 호출 계약은 유지

### [x] Slice 5 — Image Planning과 imageCount end-to-end

Outcome: PostPlan ready 뒤 저장된 imageCount로 Image Planning을 실행하고 reference 의미와
blocked 계약을 strict하게 저장한다.

Files:

- `prompts/image-planner.ts`
- `src/worker/image-planner.ts`
- `src/worker/draft-worker.service.ts`
- `src/worker/draft-worker.repository.ts`
- `src/worker/image-planner.spec.ts`
- `src/worker/draft-worker.service.spec.ts`
- `src/worker/draft-worker.repository.spec.ts`

Verify:

- 최초 난수 저장/재진입 재사용
- requested count/sortOrder/reference binding 불변조건
- insufficient distinct만 더 작은 count로 새 revision
- 1장 실패와 기타 blocker는 pause, 무한 reclaim 없음
- 동일 operatorRequest가 전달되지만 글/프롬프트 결정은 출력되지 않음

### [x] Slice 6 — model policy와 Image Prompt Generation end-to-end

Outcome: exact model registry가 capability/slot package를 만들고 Prompt Agent가 확정된
ImagePlan을 재결정하지 않은 채 컷별 prompt를 배치 생성한다.

Files:

- `prompts/image-prompt-generator.ts`
- `prompts/image-model-policies.ts`
- `src/worker/image-model-policy.ts`
- `src/worker/image-prompt-generator.ts`
- `src/worker/image-generation.provider.ts`
- `src/worker/draft-worker.service.ts`
- `src/worker/image-model-policy.spec.ts`
- `src/worker/image-prompt-generator.spec.ts`
- `src/worker/image-generation.provider.spec.ts`
- `src/worker/draft-worker.service.spec.ts`

Verify:

- exact model mapping, unknown model 무호출
- binding 1개 = slot 1개 = provider URL 1개, order 일치
- policy visible semantics 추가 금지
- unsupported route/reference/count/negative contract pause
- seed/steps/CFG/sampler/scheduler가 Agent I/O에 없음
- V3는 unconfigured local fallback을 사용하지 않음

### [x] Slice 7 — generation lineage와 선택 세트

Outcome: GenerationJob이 prompt/ImagePlan revision과 실제 reference asset을 추적하고,
선택 변경·재생성은 후속 image evaluation을 stale 처리한다.

Files:

- `src/worker/generation-worker.service.ts`
- `src/worker/generation-job.repository.ts`
- `src/admin/drafts/drafts.service.ts`
- `src/admin/drafts/drafts.repository.ts`
- `src/worker/generation-worker.service.spec.ts`
- `src/worker/generation-job.repository.spec.ts`
- `src/admin/drafts/drafts.service.spec.ts`
- `src/admin/drafts/drafts.repository.spec.ts`

Verify:

- provider 호출 전 pairwise binding validator
- stale prompt/job은 실행 또는 선택 불가
- `DRAFT_SHOT_OUTPUT_SELECTED` action과 선택 update 원자성
- 선택 변경/재생성 후 이전 evaluation target hash 불일치

### [x] Slice 8A — Post Evaluation Agent

Outcome: PostPlan target revision/hash를 고정하고 승인된 글 평가 전문과 strict 결과를
비차단 attempt로 저장한다.

Files: `prompts/post-plan-evaluator.ts`, `src/worker/post-plan-evaluator.ts`,
`src/worker/evaluation-worker.service.ts`, `src/worker/evaluation.repository.ts`,
`src/worker/evaluation-worker.service.spec.ts`, 신규 `src/worker/post-plan-evaluator.spec.ts`.

Verify: operator request absent/present, persona/memory/recent/voice/AI-tell, memory candidate
recall/dedupe, exact owner/evidence/verdict, evaluator failure non-blocking.

### [x] Slice 8B — ImagePlan Evaluation Agent

Outcome: ImagePlan target revision/hash를 고정하고 planning qualification/grounding을
비차단 attempt로 저장한다.

Files: `prompts/image-plan-evaluator.ts`, `src/worker/image-plan-evaluator.ts`,
`src/worker/evaluation-worker.service.ts`, `src/worker/evaluation.repository.ts`,
`src/worker/evaluation-worker.service.spec.ts`, 신규 `src/worker/image-plan-evaluator.spec.ts`.

Verify: ready/needs_input/blocked, story coverage, reference/character/block grounding,
qualification owner, non-owner 5, non-blocking.

### [x] Slice 8C — Image Prompt Evaluation Agent

Outcome: PromptBuildPackage와 prompt target revision/hash를 고정하고 plan/policy 충실도를
비차단 attempt로 저장한다.

Files: `prompts/image-prompt-evaluator.ts`, `src/worker/image-prompt-evaluator.ts`,
`src/worker/evaluation-worker.service.ts`, `src/worker/evaluation.repository.ts`,
`src/worker/evaluation-worker.service.spec.ts`, 신규 `src/worker/image-prompt-evaluator.spec.ts`.

Verify: package/policy authority, plan fidelity, reference slot alignment, positive/negative
contradiction, model rules, static lint separation, non-blocking.

### [x] Slice 8D — Generated Image Evaluation Agent

Outcome: 최신 final selected-set hash와 실제 media를 고정하고 이미지 진단을 비차단
attempt로 저장하며 후보 선택 결과를 만들지 않는다.

Files: `prompts/generated-image-evaluator.ts`, `src/worker/generated-image-evaluator.ts`,
`src/worker/evaluation-worker.service.ts`, `src/worker/evaluation.repository.ts`,
`src/worker/evaluation-worker.service.spec.ts`, 신규
`src/worker/generated-image-evaluator.spec.ts`.

Verify: final selected set only, required-but-unobservable vs no-contract N/A, identity/
reference/cross-shot/hard failures, no selection output, non-blocking.

### [x] Slice 9 — typed admin API와 8단계 UI

Outcome: 운영자가 V3 상태와 다음 행동을 정확히 보고 같은 오케스트레이터의 단계 명령을
사용한다.

Backend files:

- `src/admin/drafts/dto/create-draft.dto.ts`
- `src/admin/drafts/drafts.controller.ts`
- `src/admin/drafts/drafts.service.ts`
- `src/admin/post-workspace/post-workspace.service.ts`
- `src/admin/evaluations/evaluations.service.ts`

Frontend files:

- `packages/admin/src/features/drafts/api.ts`
- `packages/admin/src/features/posts/api.ts`
- `packages/admin/src/features/posts/PostWorkPage.tsx`
- `packages/admin/src/features/posts/PostWorkPage.module.css`
- `packages/admin/src/features/drafts/DraftDetailPanel.tsx`
- `packages/admin/src/features/drafts/EvaluationChips.tsx`
- `packages/admin/src/features/posts/PostWorkPage.test.tsx`
- `packages/admin/src/features/drafts/DraftDetailPanel.test.tsx`

Verify:

- six public state별 문제/원인/다음 행동
- 8단계 route와 legacy redirect
- stage guard/idempotent manual action/concurrent request 400 또는 existing result
- 네 kind, N/A, operator assessment, evidence 표시
- keyboard/focus/label과 색상 외 상태 텍스트

### [~] Slice 10 — PostPlan edit, memory selection, atomic publish

Outcome: PostPlan 수정이 downstream/memory candidate를 stale 처리하고 게시 성공 시 선택된
candidate만 원자적으로 memory가 된다.

현재 적용: selected/current-hash 후보 필터, batch dedupe, 기존 memory 중복 조회,
post/media/memory 단일 transaction. 남음: 수동 candidate 선택 UI와 PostPlan 편집 UX.

Files:

- `src/admin/drafts/drafts.service.ts`
- `src/admin/drafts/drafts.repository.ts`
- `src/worker/draft-worker.service.ts`
- `src/worker/draft-worker.repository.ts`
- publish specs와 `test/generation.e2e-spec.ts`
- `src/admin/drafts/drafts.service.spec.ts`
- `src/worker/draft-worker.service.spec.ts`
- `packages/admin/src/features/posts/PostWorkPage.tsx`
- `packages/admin/src/features/posts/PostWorkPage.test.tsx`

Verify:

- stable candidate key, current PostPlan hash 검증
- auto unchanged = all selected; manual explicit selection
- edit 뒤 stale candidate publish 금지
- duplicate memory 미생성
- post + N memories 원자성, publish retry 멱등성
- legacy memory 합성 유지

### [ ] Slice 11 — calibration freeze와 rollout readiness

Outcome: contract test와 model 품질 승인을 분리하고 production activation 조건을 기록한다.

Files:

- `.codex/pave/plans/2026-08-12-post-evaluator-review-fixtures-v1.md`
- `.codex/pave/plans/2026-08-12-image-planning-evaluator-fixtures.md`
- `.codex/pave/plans/2026-08-12-image-prompt-evaluator-fixtures.md`
- `.codex/pave/plans/2026-08-12-generated-image-evaluator-fixture-manifest.md`
- `fixtures/generated-image/**` 실제 PNG와 manifest
- `docs/post-pipeline-v3-rollout.md`

Verify:

- text fixture는 full schema-valid input, one-variable mutation, exact expected output,
  SHA-256 고정
- generated fixture는 asset-set hash와 최소 두 vision reviewer 합의
- stage 성공률/latency/token, blocked/unsupported reason, verdict/human action 지표
- V3 off -> staging manual -> staging auto -> production new drafts 순서
- active legacy V2 draft가 0이 되기 전 legacy runner 제거 금지

## 11. Test Value Gate

- parser test: malformed/over-authoritative LLM 결과가 DB/provider 경계를 넘지 못하게 한다.
- CAS/lineage test: 재시작·경합·편집 뒤 다른 revision 산출물이 섞이지 않게 한다.
- policy/asset test: prompt slot과 실제 reference URL 순서 불일치를 막는다.
- evaluator test: fixed dimensions, owner, evidence, verdict와 비차단 경계를 보호한다.
- UI test: 운영자가 멈춘 이유와 유효한 다음 행동을 보는 계약을 보호한다.
- publish E2E: post/memory 원자성과 멱등성을 보호한다.
- 단순 prompt 전체 문자열 snapshot, 구현 세부 mock 호출 횟수, 의미 없는 getter test는 만들지
  않는다.

## 12. 최종 검증

`opod-service-backend`:

- `npm run format`
- `npm run lint`
- `npm run test`
- `npm run test -- architecture`
- `npm run test:e2e`
- `npm run db:generate`
- `npm run build`

`opod-admin`:

- `npm run format`
- `npm run lint`
- `npm run test`
- `npm run admin:check`
- `npm run test:e2e`
- `npm run schema:check`
- `npm run db:generate`
- `npm run build`
- `git diff --check`

Human review:

- stage/revision/action log가 같은 transaction인가
- legacy V2/V3 claim이 서로의 draft를 집지 않는가
- 동일 operatorRequest가 두 planner에 보존되면서 scope는 분리되는가
- model policy가 reference 의미나 visible semantics를 만들지 않는가
- evaluator에서 상태 변경/retry/rewrite/model/selection 호출 경로가 없는가
- publish가 current PostPlan의 selected/non-stale candidate 외 memory를 만들지 않는가
- UI가 paused state를 running/failed로 오표시하지 않는가

## 13. 승인 체크포인트

PAVE 통합 승인 범위:

- 본 문서의 R1-R13, D1-D16, Slice 2-11
- D7 strict-output capability gate
- D10 기존 hashtag 동작 보존
- D11 BCP-47 language tag 검증
- D13 final selected image set 평가
- D15 settings-owned rollout flag

통합 구현 승인은 완료됐다. production 활성화는 Slice 11의 실제 이미지 calibration과
staging 관찰을 통과한 뒤 별도로 판단한다.
