# Post Pipeline V4 — 캡션 Agent 정규 단계 (검수 삭제 · 후보 없음)

Status: 계획 — 구현 승인 대기
Last updated: 2026-08-15
설계 정본: `docs/post-creation-agent-architecture-v3.md` §20 (§20.0 운영자 결정 3건,
§20.4 상태·단계, §20.5 계약, §20.6 화면, §20.10 수용 기준, §20.15 리뷰 생사표)

## Goal

캡션·해시태그를 ② 게시글 기획에서 떼어 ⑤ 이미지 생성 **뒤**의 정규 단계 ⑥ 캡션
Agent가 생성 이미지를 보고 쓰게 한다. 검수 단계는 없다 — 자동 모드는 사람 없이
게시까지, 수동 모드는 단계 버튼이 곧 검수다. 이미지는 프롬프트당 1장.

## Confirmed Product Decisions (운영자, 2026-08-15)

- 검수 단계 삭제. 자동 모드는 ⑦ 게시까지 사람 없이 진행(예약 시각 게시).
- 캡션 평가 Agent 없음. 게시글 평가에서 글 4차원 삭제.
- 후보 생성 없음 — 프롬프트당 1장.
- V4-0(기존 needs_review V3 초안 2건 선게시)은 **하지 않는다** → 기존 V3 초안은
  기존 검수 경로·화면으로 완주할 수 있어야 한다(코드 삭제 금지, 버전 분기).

## 판별자 결정

새 초안은 `pipelineVersion: "post-pipeline-v4"`. 실행 기계(claim·CAS·runner·
pause·requeue)는 V3와 동일하므로 `isPostPipelineV3()`는 v3|v4 모두 true로 넓히고
(이름은 유지 — 호출처 6곳 무변경), `isPostPipelineV4()`를 추가해 **분기가 필요한
곳에서만** 쓴다: 스테이지 배열·⑤→⑥ 전이·게시 조건·PATCH 게이트·UI 레일·
candidateCount. 기존 v3 초안(needs_review 2건 포함)은 어떤 경로도 바뀌지 않는다.
`pipeline.v3Enabled` 설정 게이트는 그대로 v4를 켠다(설명 문구만 갱신).

## Scope Map

| 서브시스템 | 변경 | 파일 |
|---|---|---|
| A. 계약·프롬프트 | `post-planner-v2`(caption·hashtags·captionLanguages 제거) · `caption-writer-v1` 신설 · 게시글 평가 루브릭 v2(4차원 삭제, memory_discipline 문구) · image-planner 프롬프트 **불변** | `prompts/post-planner.ts`, `prompts/caption-writer.ts`(신규), `prompts/v3-evaluators.ts`, `src/worker/post-planner.ts`, `src/worker/caption-writer.ts`(신규), `src/worker/image-planner.ts`(입력 타입에서 caption 제거) |
| B. 오케스트레이션 | stage `caption` 추가 · runner 디스패치 · ⑤ 완료→`caption pending` · ④ 컬럼 기록 제거 · V3 job `candidateCount: 1` + 단일 출력 자동 선택 · 게시 조건 확장 + 캡션 preflight | `src/worker/post-pipeline-v3.ts`, `post-pipeline-v3.runner.ts`, `draft-worker.service.ts`, `draft-worker.repository.ts`, `generation-job.repository.ts`, `evaluation-worker.service.ts`(hash 함수 export) |
| C. Admin API | PATCH 캡션 게이트(V4: planned+stage publish) · publishDraftNow 게이트 · read model(`captionBuild`·stale·matchesColumn·stage `caption`) · 제목 폴백은 UI | `src/admin/drafts/drafts.service.ts`, `drafts.repository.ts`, `src/admin/post-workspace/post-workspace.service.ts`, `packages/admin/src/features/posts/api.ts`, `features/drafts/api.ts` |
| D. Admin UI | V4 레일(검수→캡션) · `V3CaptionStage`(카드+편집 폼+재실행 노트) · ⑤ 후보 UI 제거(V4) · ⑦ 미리보기 문구 · ② 카드 v2 · 제목 폴백 3곳 | `PostWorkPage.tsx`, `PostQueuePage.tsx`, `CharacterAutomationPanel.tsx`, `drafts/CandidateCard.tsx`·`ShotCard.tsx`(V4 분기) |
| E. 문서 | research-log `post-planner-v2`·`caption-writer-v1`·`post-evaluator-v2` 엔트리, 아키텍처 §12 구현 현황·§20 상태, `docs/api/admin-drafts.md` | `docs/` |

## Checklist (구현 순서 = 의존 순서)

### 1. 계약 (A)
- [ ] `prompts/post-planner.ts` v2: 프롬프트에서 caption/hashtag/language 문장 제거, 스키마 required·properties에서 3키 제거, `POST_PLANNER_PROMPT_VERSION="post-planner-v2"`, `POST_PLAN_CONTRACT_VERSION="post-plan-v2"`
- [ ] `src/worker/post-planner.ts` 파서 v2 (exactKeys에서 3키 제거). `postPlanReady()`(runner:604) 캐스트는 유지 — v1 artifact 호환
- [ ] `prompts/caption-writer.ts` 신규: `CAPTION_WRITER_PROMPT_VERSION="caption-writer-v1"`, `CAPTION_SET_CONTRACT_VERSION="caption-set-v1"`, 시스템 프롬프트(§20.5 제약: memory discipline, 이미지·계획 양쪽 근거, 해시태그 규칙 이관, operatorRequest 글쓰기 부분), `CAPTION_SET_JSON_SCHEMA` (rootUnionSchema, ready 단일)
- [ ] `src/worker/caption-writer.ts` 신규: `CaptionWriterInput` 타입, `runCaptionWriter(client, input, images)` — `visionUserContent` 패턴 재사용, `parseCaptionSet` (BCP-47 canonical·2,000자·`cleanHashtags` — post-planner에서 이동)
- [ ] `src/worker/image-planner.ts` `ImagePlannerInput.postPlan`에서 `caption` 제거 (프롬프트 문장·버전 불변 — research-log 기록됨)
- [ ] `prompts/v3-evaluators.ts`: `POST_EVALUATOR_READY_DIMENSIONS`에서 4차원 삭제, `memory_discipline` 문구에서 caption 제거, 루브릭 버전 `post-evaluator-v2`
- [ ] `src/domain/llm-logs/llm-log.service.ts` `LLM_LOG_TYPE.captionWrite` 추가
- [ ] `src/worker/strict-schema.spec.ts` 캡처 목록에 caption-writer 스키마 추가

### 2. 오케스트레이션 (B)
- [ ] `post-pipeline-v3.ts`: `POST_PIPELINE_V4`, `createPostPipelineV3Concept` → v4 버전 기록, `isPostPipelineV3()` v3|v4, `isPostPipelineV4()`, `PostPipelineV3ArtifactKey`에 `captionBuild`, stage 유니언에 `caption`
- [ ] `evaluation-worker.service.ts`: `selectedSetHash` → export (`generationSetHash` 별칭), 정렬 `createdAt desc, id desc` 명시
- [ ] `post-pipeline-v3.runner.ts`: `runCurrentStage`에 `stage === "caption"` → `runCaption()` — 입력 조립(intent·writing profile·recentPosts·operatorRequest·ImagePlan 원문·컷별 완료 잡의 media·언어), 이미지 bytes 읽기(`MediaBytesReader` 재사용), `captionBuild` artifact(revision·hash·contractVersion·promptVersion·producerLogId·input(media ID만)·output·source{postPlanning, generationSetHash}), 다음 stage `publish/pending`
- [ ] `draft-worker.repository.ts`: `persistV3CaptionBuild` — `persistV3Artifact`와 같은 CAS(stage=caption,state=running,revision) + 같은 트랜잭션에서 `caption`/`hashtags` 컬럼 갱신 + `DRAFT_V3_CAPTION_READY`. `persistV3PromptJobs`의 `caption`/`hashtags` data 제거(locationId·conceptJson·lease는 유지)
- [ ] `persistV3PromptJobs`의 generationJob.create에 `candidateCount: 1` (V4)
- [ ] `generation-job.repository.ts` 완료 persist: 출력이 정확히 1장이면 `outputMediaId=media`, `selected: true` (V2 candidateCount=1도 동일 — 무해)
- [ ] `draft-worker.service.ts` `aggregateDraft`: V4면 `markDraftNeedsReview` 대신 `markDraftCaptionPending`(status planned, stage caption/pending, 액션 `DRAFT_V3_IMAGES_READY`); V3/V2는 그대로
- [ ] 게시: `findDueDrafts`·`findApprovedDraft`·`persistPublishedPost` CAS·`recordPublishError`에 V4 조건(status planned ∧ stage publish ∧ state pending ∧ (자동이면 mode≠manual)) OR 기존 approved. `publishDraft` preflight: `caption.trim()===""` → 실패 사유 `caption_missing`(재시도 대상 아님)
- [ ] 게시 성공 시 V4는 stage `memory` 완료 처리(기존 selectedPublishedMemories 그대로)
- [ ] 컷 재생성(`regenerateShot`) V4: needs_review 게이트 대신 planned+stage∈{caption,publish} 허용, 완료 후 aggregate가 다시 `caption pending`으로 (captionBuild는 hash 불일치로 stale)
- [ ] 평가 트리거: `image` kind 게이트의 `DRAFT_READY_FOR_REVIEW`에 `DRAFT_V3_IMAGES_READY` 추가; `prompt` kind에 `DRAFT_V3_PROMPTS_READY` 추가(기존 누락 수리, 1줄)

### 3. Admin API (C)
- [ ] `drafts.service.ts` `updateDraft`: V4 draft는 `status planned ∧ stage publish`(captionBuild 존재)에서 caption/hashtags/scheduledAt 편집 허용; 저장 시 선택 `reason` → `DRAFT_CAPTION_EDITED` 액션 로그(§20.8). DTO에 `reason?` 추가
- [ ] `publishDraftNow` 게이트 V4 확장; `approveDraft`/`rejectDraft`는 V4 draft에 400("V4 초안은 승인 단계가 없습니다")
- [ ] `selectShotOutput`: V4 draft 400
- [ ] `post-workspace.service.ts`: `PostWorkStage`에 `caption`, `V3_STAGES`는 버전별 배열(v4: …generation, caption, publish, memory), `stageForDraft`(planned+stage caption/publish 매핑), `nextAction` 문구, `artifacts.captionBuild`(lineage + caption·hashtags·captionLanguages·operatorNote·stale·staleShots·matchesColumn — stale은 export한 hash 함수로 서버 계산, job include에 mediaId·jobId), `pipelineV3.version` 유니언 v3|v4
- [ ] `packages/admin/src/features/posts/api.ts`·`drafts/api.ts` 타입 동기화(`caption` stage, `captionBuild`, version)

### 4. Admin UI (D)
- [ ] `PostWorkPage.tsx`: `V3_STAGES`를 버전별로(v4: `caption` 라벨 "캡션"), `StageBody` `stage==="caption"` → `V3CaptionStage`
- [ ] `V3CaptionStage`: `V3Stage` 공통 틀(실행/다시 실행 버튼, 상태 배지, 사유) + `operatorNote` 접이식 입력(재실행 시 `POST /drafts/:id/plan` body에 note — 컨트롤러 DTO 확장) + CaptionSet 카드(캡션·해시태그·계보 푸터·"지시 · …") + stale 배너(계보 자리, "무효" 금지) + **게시 캡션 편집 폼**(라벨 "게시 캡션 — 이 내용이 게시됩니다", `key={captionBuild.hash}`로 재실행 시 리셋, dirty+재실행 시 확인 모달, 저장 시 "왜 고쳤나" 선택 입력)
- [ ] `GenerationStage`(V4): 후보 카드/선택 버튼 숨김, 컷당 1장 + 컷 재생성 + finish 유지
- [ ] `PublishStage`/`PublishPreview`(V4): 게시 버튼 게이트 = stage publish, 캡션 없으면 "게시 캡션 없음 — ⑥에서 생성하거나 입력하세요"(폴백 없음), stale 배너 동일
- [ ] `PostPlanArtifact`: v2 artifact면 캡션·해시태그 미표시, 리드 premise; v1 artifact는 그대로. ② 설명 "게시글 의도를 확정합니다"
- [ ] 제목 폴백: `PostQueuePage.tsx:138`, `PostWorkPage.tsx:168` → `caption || premise(+"가제" 배지) || "(제목 없음)"`; `CharacterAutomationPanel.tsx:97`은 `/drafts` 응답 `conceptJson.postPlanning.output.intent.premise` 읽기(타입 `DraftConcept`에 `postPlanning` 추가)
- [ ] 설정 화면 `pipeline.v3Enabled` 설명 문구에 "V4(캡션 후치·검수 없음) 포함"

### 5. 문서 (E)
- [ ] research-log: `post-planner-v2`, `caption-writer-v1`, `post-evaluator-v2` 엔트리(가설·변경·판정 보류·표본 규칙)
- [ ] 아키텍처 §12 구현 현황 갱신, §20 상태 "구현 완료", §19.1 #16
- [ ] `docs/api/admin-drafts.md` — PATCH 게이트·`/plan` body note·V4 400 응답

## Test Value Gate

실행할 행동 테스트(각각 잡는 결함):

| 테스트 | 잡는 결함 |
|---|---|
| `post-planner.spec.ts` v2 fixture / caption 포함 시 "invalid fields" | 계약 v2 미적용 |
| `caption-writer.spec.ts` (신규): ready 파싱, BCP-47 canonical, 태그 정규화·중복 거부, 2,000자 상한, `image_url` 블록이 media 수만큼 | 파서 이관 누락, vision 입력 누락 |
| `post-pipeline-v3.runner.spec.ts`: ② v2 스텁 → captionless artifact 저장; **caption stage** → `captionBuild` + 컬럼 + 다음 stage publish; 실패 시 requeue | 디스패치 누락, 반쪽 저장 |
| `draft-worker.repository.spec.ts`: `persistV3PromptJobs`가 caption/hashtags를 data에 넣지 않음, `candidateCount: 1` | ④ 컬럼 이중 소유 재발 |
| `draft-worker.service.spec.ts`: V4 aggregate → `caption pending`(V3는 needs_review 유지); `publishDueDrafts`가 V4 stage publish를 집고 빈 캡션은 `caption_missing`으로 실패; V2 `approved` 경로 불변 | 검수로 새는 회귀, 빈 본문 게시 |
| `generation-job.repository.spec.ts`: 1장 출력 → outputMediaId·selected | 게시 시 "no completed output" |
| `post-workspace.service.spec.ts`: v4 stage `caption` 매핑, `captionBuild` 노출(promptVersion 포함), stale 계산(선택 hash ≠), matchesColumn | 저장돼 있는데 화면이 못 읽음 |
| `drafts.service.spec.ts`: V4 PATCH 게이트(stage publish 허용, caption 단계 전 거부), approve/select V4 400, `DRAFT_CAPTION_EDITED` reason 기록 | 게이트 어긋남 |
| `evaluation.repository` 게이트: SQL이라 단위 없음 → 개발 서버 DB로 수동 확인(`DRAFT_V3_IMAGES_READY`로 image 평가 claim, `DRAFT_V3_PROMPTS_READY`로 prompt 재평가) | 평가 안 도는 회귀 |
| UI `PostWorkPage.test.tsx`: v4 레일에 "캡션" 있고 "검수" 없음; v1 artifact ② 카드 캡션 표시 유지(`:186`), v2는 미표시; 캡션 단계 카드 + 편집 폼 렌더; 제목 폴백 | 레일 회귀, v1 호환 |
| `strict-schema.spec.ts` | caption-writer 스키마 프로바이더 문법 위반(#3 재현) |

깨질 것으로 예측된 기존 spec(리뷰 E): `post-planner.spec.ts:17,24`(v2화·BCP-47 검사는 caption-writer spec으로), `post-pipeline-v3.runner.spec.ts:123`(스텁 v2, `:173` v1 호환 가드는 **유지**), `image-planner.spec.ts:7-15`(입력 리터럴), `PostWorkPage.test.tsx:186`(v1 분기로 유지).

비테스트 검증: `npm run lint`, `npm run build`, `npm --prefix packages/admin run typecheck`, `npm run schema:check`(Prisma 변경 없음 확인), 개발 서버 배포 후 수동 초안 1건 ①→⑧ 완주 + 자동 초안 1건(스케줄러 또는 mode auto) 완주.

## Risk / Residual

- 자동 모드 = 사람 없는 게시(§20.11). 자동 초안은 배포 직후 스케줄러가 켜져 있으면 바로 나간다 — 첫 자동 완주는 스케줄러 꺼둔 상태에서 `mode auto` 수동 생성으로 관측한다.
- 기존 v3 초안 2건은 needs_review에 그대로 — 기존 검수 화면으로 완주 가능(코드 유지). 완주 전까지 legacy 경로 삭제 금지.
- `image-planner-v3` 관측 조건 변경(입력에서 caption 제거) — research-log 기록됨.
- `overallScore=0` 버그는 이번 범위 밖(별건).

## Approval Boundary

위 Scope Map A~E 전부, 한 배포 단위. Prisma 스키마 변경 없음(enum 추가 없음 — 캡션
평가 kind 없음). 새 엔드포인트 없음(`/plan` body에 `note?` 확장만).
