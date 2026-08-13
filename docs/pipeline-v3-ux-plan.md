# 파이프라인 V3 운영 UX 개선 계획 — 버전 발견성과 이미지 기획 단계 노출

- 작성일: 2026-08-13
- 상태: 계획 확정 전 검토용
- 범위: `게시물` 작업공간(큐·작업 화면·브리프 생성)과 설정 화면에서 V3
  파이프라인의 발견성·산출물 노출·수동 조작 UX
- 상위 문서: [post-creation-agent-architecture-v3.md](./post-creation-agent-architecture-v3.md),
  [draft-pipeline-ux.md](./draft-pipeline-ux.md)

## 1. 발단과 관측 사실

experiment/image-prompt-optimization 브랜치(= main에 squash 머지, PR #2)를
개발 서버에 배포한 뒤 "이미지 기획 단계가 없다"는 관측이 나왔다. 조사 결과:

1. **이미지 기획 단계는 구현되어 있다.** `PostWorkPage.tsx`의 `V3_STAGES`
   레일은 `브리프 → 게시글 기획 → 이미지 기획 → 프롬프트 → 이미지 생성 →
   검수 → 게시 → 메모리` 8단계다. 레일은 draft의
   `conceptJson.pipelineVersion === "post-pipeline-v3"` 여부로
   V3/legacy를 선택한다 (`StageRail`, `post-workspace.service.ts`의
   `v3ReadModel`).
2. **V3는 설정으로 게이트된다.** `pipeline.v3Enabled`(env 폴백
   `POST_PIPELINE_V3_ENABLED`, 기본 꺼짐)가 켜져 있어야 **새로 만드는
   초안부터** V3 concept으로 생성된다 (`drafts.service.ts#createDraft`).
   켜는 순간 기획 LLM의 strict JSON schema capability probe를 통과해야
   한다 (`admin-settings.controller.ts`).
3. **개발 서버는 꺼져 있었다.** 2026-08-13 개발 서버 DB 확인 결과
   `opod.admin_settings`에 `pipeline.v3Enabled` 키가 없고(= 기본 꺼짐),
   `opod.post_drafts` 31건 전부 `pipelineVersion`이 없는 V2 draft였다.
   따라서 화면은 legacy 레일(`브리프 → 기획 → 프롬프트 → 평가 → …`)을
   렌더했고, 이 레일에는 이미지 기획이 기획 단계에 통합되어 있다.

즉 기능 누락이 아니라 **"켜는 곳·켜졌는지·어느 버전으로 도는지"가 화면에
드러나지 않는 발견성 문제**다. 단, V3를 켰더라도 현재 이미지 기획 화면은
산출물을 거의 보여 주지 않아(아래 3.B) 같은 인상을 받았을 가능성이 높다.

## 2. 즉시 조치

> 2026-08-13 추가: 토글을 켠 뒤 게시글 기획이 400(`'oneOf' is not permitted`)으로
> 전부 실패하는 별개 버그가 드러났다. 원인·수정은
> [prompt-research-log.md](./prompt-research-log.md)의 `v3-schema-v2` 항목을
> 보라. 아래 조치는 그 수정이 배포된 뒤에 유효하다.

설정 → 생성 워커 → "게시글 생성 Agent V3 신규 초안 적용" 스위치를 켠다.
켜면 capability probe가 즉시 실행되어 실패 시 원인 메시지를 보여 준다.
그 후 **새 게시물을 만들면** 레일에 ③ 이미지 기획이 나타난다. 기존 초안은
설계대로 V2로 완주한다(소급 전환 없음). 개발 서버는 architecture 문서
§12의 rollout gate 관찰 환경이므로 켜는 것이 의도된 다음 단계다.

## 3. UI/UX 문제 분석

### A. 파이프라인 버전 발견성 (이번 혼란의 직접 원인)

| # | 문제 | 근거 |
|---|---|---|
| A1 | 작업 화면 어디에도 파이프라인 버전 표시가 없다. 레일이 조용히 다른 단계 집합을 렌더할 뿐, V2/V3 구분 배지·안내가 없다 | `PostWorkHeader`에 버전 정보 없음 |
| A2 | V3의 존재와 켜는 위치를 작업 흐름 안에서 알 수 없다. 토글은 설정 화면 `WorkerCard`에만 있고, 브리프 생성 화면(①)은 이번 초안이 어떤 버전으로 생성될지 예고하지 않는다 | `PostBriefCreatePage`에 버전 언급 없음 |
| A3 | 토글을 켠 뒤에는 큐에 V2/V3 초안이 섞이는데 목록에서 구분할 수 없다. 단계 라벨만 "기획" vs "게시글 기획"으로 미묘하게 다르다 | `PostQueuePage` 행에 버전 표시 없음 |
| A4 | UX 정본 문서가 V3 이전(2026-08-10) 상태다. 8단계 IA가 legacy 기준(평가가 ④ 단계)으로 기록되어 있어 화면과 문서가 어긋난다 | `draft-pipeline-ux.md` §0·§2 |

### B. 이미지 기획 단계의 산출물 노출 부족 (수동 파이프라인 원칙 위반)

수동 파이프라인 원칙: 수동 = 자동의 스텝 실행 모드, **단계마다 버튼 트리거 +
중간 산출물 노출 필수**. 현재 V3 단계 화면은 이를 충족하지 못한다.

| # | 문제 | 근거 |
|---|---|---|
| B1 | ImagePlan 아티팩트는 컷별 `scene`·`captureSetup`·`presentation`·`referenceBindings`(≤5)와 `continuity.lockedElements`(≤30)를 갖는데, 화면에는 revision·status·**이미지 장수만** 보인다. 이미지 기획 단계에 들어가도 기획 내용을 볼 수 없다 | `image-planner.ts` 타입 vs `v3ReadModel`의 `imagePlan: { revision, status, shotCount }` |
| B2 | PostPlan도 premise 한 줄만 노출된다. caption·hashtags·memory candidates가 화면에 없어 V2 기획 화면(`DraftPlanSummary` + 편집 폼)보다 **퇴행**이다 | `V3ArtifactStage`, `v3ReadModel`의 `postPlan: { revision, status, premise? }` |
| B3 | V3 프롬프트 단계는 프롬프트 개수·대상 모델만 보이고 컷별 프롬프트 본문이 없다. V2는 컷별 전문 조회·편집·재생성을 제공한다 | `V3PromptStage` vs `PromptStage` |
| B4 | PostPlan/ImagePlan/PromptSet의 수동 편집이 없다 (architecture §12 rollout gate에 명시된 미완 항목) | `V3ArtifactStage`에 편집 UI 없음 |
| B5 | 재실행이 없다. V3 단계 버튼은 `state === "pending" && stage === 현재 단계`일 때만 렌더되어 최초 실행 전용이다. ready 이후 "다시 기획"(revision+1) 경로가 UI에 없다. V2는 "전체 프롬프트 다시 생성"이 있다 | `V3ArtifactStage.runnable` 조건 |
| B6 | V3 인라인 평가는 결과가 없으면 아무것도 렌더하지 않는다. 평가 워커가 꺼져 있다는 사실·설정 링크 안내는 V2 평가 단계 화면에만 있다 | `EvaluationBlock`이 `evaluation` 없으면 `null` 반환 |

### C. 정보 구조·구현 일관성

| # | 문제 | 근거 |
|---|---|---|
| C1 | 같은 앱에 두 IA가 공존한다. V2 레일은 평가를 별도 단계(④)로 승격해 "대기" 상태가 관문처럼 읽히고(문서 원칙은 "비차단 신호"), V3는 인라인이다. V2 폐기 전까지는 감수하되 문서에 명시가 필요하다 | `LEGACY_STAGES` vs `V3_STAGES` |
| C2 | 단계 배열이 서버(`post-workspace.service.ts`)와 클라이언트(`PostWorkPage.tsx`)에 중복 정의되어 있고, 완료 표시가 1-based `stageIndex` 산술(`index + 1 < item.stageIndex`)에 의존한다. 한쪽만 바뀌면 완료 표시가 조용히 틀어진다 | 두 파일의 `V3_STAGES`/`STAGES` 중복 |
| C3 | 레일이 `overflow-x: auto`라 좁은 화면에서 ⑧ 메모리가 잘려도 더 있다는 시각 힌트가 없다 (관측 스크린샷에서 실제로 잘림). 모바일 대응 계획과 연결됨 | `PostWorkPage.module.css` `.rail` |
| C4 | V3 실행 버튼 3종(게시글 기획 실행/이미지 기획 실행/이미지 프롬프트 생성)이 모두 `POST /drafts/:id/plan`("다음 스텝 실행")을 호출한다. 현재는 stage 일치 시에만 버튼이 떠서 안전하지만, 단계별 의미가 API에 드러나지 않아 이후 재실행·부분 재기획을 넣을 때 모호해진다 | `runDraftStage(draftId, "plan")` 공용 호출 |

## 4. 개선 계획

원칙: V2는 legacy(신규 투자 최소화), V3 화면을
[draft-pipeline-ux.md](./draft-pipeline-ux.md)의 "스테이지별 타입 인지
렌더링" 패턴으로 끌어올린다. 스키마 변경 없음 — 모든 데이터는 이미
`conceptJson`에 있고 read model 확장만 필요하다.

### P1. 버전 투명성 (소규모, 혼란 재발 방지)

1. `PostWorkHeader`에 파이프라인 버전 배지 추가 — V3면 `Agent V3`,
   legacy면 `V2 (legacy)`. V2 배지에는 "V3는 설정에서 켠 뒤 새 초안부터
   적용" 안내(설정 링크 포함)를 툴팁/알림으로 연결.
2. `PostBriefCreatePage`에 적용 예정 버전 표시 — 설정 조회로 "이 초안은
   V3(이미지 기획 분리 8단계)로 진행됩니다" 또는 "V2로 진행됩니다 +
   설정 링크". 저장 전에 알 수 있어야 한다.
3. `PostQueuePage` 행 단계 셀에 V3 소형 배지 (V2/V3 혼재 기간 한정).
4. `draft-pipeline-ux.md`에 V3 IA(8단계 레일 교체, 평가 인라인화)를
   2026-08-13자 결정으로 추기.

- 대상: `packages/admin/src/features/posts/*`, `GET /post-work-items`
  read model은 이미 `pipelineV3`를 내려주므로 API 변경 불필요
  (브리프 화면만 설정 조회 1건 추가).

### P2. 이미지 기획 단계를 실제로 보이게 (산출물 노출)

1. `v3ReadModel` 확장 — UI 계약에 다음을 추가한다. 원본은 이미
   `conceptJson.*.output`에 저장돼 있으므로 read model 매핑만 늘린다.
   - PostPlan: caption, hashtags, memoryCandidates
   - ImagePlan: 컷별 { role, scene, captureSetup, presentation 요약,
     referenceBindings(대상 레퍼런스 id·의미) }, continuity.lockedElements
   - PromptBuild: 컷별 positive/negative 프롬프트 본문
2. `V3ArtifactStage`를 타입 인지 렌더링으로 교체 — 이미지 기획은 컷
   카드(장면·촬영·노출), 레퍼런스 바인딩 칩, continuity 잠금 목록.
   기존 `DraftPlanSummary`/`ShotCard` 관례 재사용.
3. V3 프롬프트 단계에 V2 수준의 컷별 프롬프트 조회(복사 가능한 텍스트).
4. 평가 결과 없음 상태 안내를 V3 인라인 블록에도 — 평가 워커 off면
   "평가 워커가 꺼져 있습니다 → 설정" (V2 평가 화면과 같은 문구 재사용).

- 대상: `src/admin/post-workspace/post-workspace.service.ts`,
  `packages/admin/src/features/posts/PostWorkPage.tsx` 및 신규 표시
  컴포넌트. 스키마·워커 변경 없음.

### P3. 수동 편집·재실행 (architecture §12 rollout gate 완성)

1. PostPlan 편집: caption·hashtags 수정, memory candidate 선택/제외.
   편집 시 downstream stale 표시(레일·단계 화면에 "이후 단계 산출물은
   오래됨 — 다시 실행 필요" 상태) — hash lineage는 이미 구현되어 있으므로
   UX만 얹는다.
2. ImagePlan·PromptSet 재실행: ready 상태에서도 "다시 기획/다시 생성"
   버튼으로 revision+1 재생성. C4의 모호함을 없애기 위해 stage를
   명시하는 실행 API(예: `POST /drafts/:id/v3/steps/:stage`) 신설을
   검토하되, 오케스트레이터 단일 진입 원칙(자동=수동 동일 경로)은 유지.
3. 우선순위 근거: P2 없이 P3만 하면 보이지 않는 것을 편집하게 되므로
   P2 → P3 순서 고정.

### P4. 구조 정리 (저위험, 드리프트 예방)

1. 단계 배열 단일화 — read model이 `stages: PostWorkStage[]`를 내려주고
   클라이언트는 렌더만 한다 (`stageIndex` 산술 의존 제거).
2. 레일 오버플로 힌트 — 잘림 그라데이션 또는 스크롤 섀도.
   admin 모바일 대응 계획(mobile-responsive-plan.md)과 함께 처리.
3. V2 레일의 평가 단계 인라인화는 **하지 않는다** — V2는 폐기 예정
   경로라 IA 변경 투자 대신 V3 전환 가속에 투자한다.

## 5. 수용 기준

- 운영자가 큐·작업 화면·브리프 화면 어디서든 현재/예정 파이프라인 버전을
  한 번에 알 수 있다.
- V3 이미지 기획 단계에서 컷별 장면·촬영·노출·레퍼런스·continuity를
  화면에서 읽을 수 있다 (JSON 원문 펼침이 아니라 타입 인지 렌더링).
- V3 각 단계에서 산출물 없음/평가 없음/워커 꺼짐이 구분되어 보이고,
  다음 행동이 항상 한 문장으로 제시된다 (`nextAction` 유지).
- P3 완료 시: PostPlan 편집 → downstream stale 표시 → 해당 단계 재실행이
  화면만으로 가능하다.
- 서버·클라이언트 단계 목록 정의가 한 곳이다.

## 6. 이번에 확정하지 않는 것

- V2 화면 개선(평가 단계 인라인화 포함) — legacy 동결.
- generated-image fixture calibration 등 architecture §12의 나머지
  품질 gate — 별도 트랙.
- 자동 게시 조건·evaluator 점수 기반 자동 재실행 — architecture §17과 동일.
- pgvector·메모리 후보 스키마 변경 — 필요 없음(모두 conceptJson 내 데이터).
