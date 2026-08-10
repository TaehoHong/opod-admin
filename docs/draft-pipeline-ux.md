# 게시물 생성 A-Z 파이프라인 화면 UX 설계

Status: 2차 IA 구현 (2026-08-10)
목표: 게시물 하나의 전 생애주기(스케줄→기획→프롬프트→생성→평가→검수→게시→
메모리)를 `게시물` 하나의 작업공간에서 파악하되, 각 단계는 독립 화면으로
분리해 현재 작업에만 집중하게 한다.

## 0. 2026-08-10 정보 구조 결정

기존 `게시글`·`초안`·draft 소속 `생성` 화면은 같은 게시물 생애주기를 서로 다른
엔티티 목록으로 보여 주어, 운영자가 현재 위치와 다음 행동을 직접 조합해야 했다.
따라서 다음 원칙으로 2차 IA를 확정했다.

- 상위 메뉴는 `게시물` 하나다. 게시 전 draft와 게시 완료 Post를 최근 변경순
  운영 큐에서 함께 본다.
- 목록 기본 필터는 `전체`다. 운영 필요, Agent 진행, 게시 대기, 게시 완료,
  실패로 좁힐 수 있다.
- 별도 상세 버튼 없이 행 전체 클릭 또는 키보드 Enter로 현재 단계에 들어간다.
- 상세는 브리프 → 기획 → 프롬프트 → 평가 → 이미지 생성 → 검수 → 게시 →
  메모리의 8개 route다. 공통 헤더와 단계 레일만 유지하고 본문은 현재 단계
  하나만 렌더한다.
- 평가는 화면상 선형 단계지만 실행 상태 머신을 막지 않는 비차단 신호다.
- `게시물 만들기`에서 시작한 작업은 항상 수동이다. 스케줄러 작업은 콘텐츠를
  수정·후보 교체·재생성하기 전까지 자동이다. 이는 등급이 아니라 진입 경로가
  정한 실행 정책이다.
- manual로 전환된 draft는 자동 기획 claim, 자동 생성 집계, 자동 게시에서
  제외한다. 이미 실행 중인 provider 작업은 완료될 수 있지만 다음 단계 전이는
  운영자가 해당 단계 버튼으로 수행한다.

## 1. 레퍼런스 조사 요약

두 갈래(LLM 관측성 도구 / 파이프라인·검수·미디어 도구)로 조사했다.
상세 출처는 문말 색인.

### 채택한 핵심 패턴

| 패턴 | 출처 | 적용 |
|---|---|---|
| 스테이지별 타입 인지 렌더링 — 모든 단계를 generic JSON으로 그리지 않는다 | LangSmith run_type | 기획→구조화 플랜, 프롬프트→복사 가능한 텍스트, 생성→후보 썸네일 그리드, 평가→루브릭 점수표, 게시→영수증 |
| 상단 스테이지 레일 + 단계별 route | GitLab stage graph + GitHub Actions steps | 8단계 레일은 유지하고 클릭하면 해당 단계 화면으로 이동. 세로 전체 타임라인은 폐기 |
| 휴먼 게이트를 시각적으로 구분되는 1급 노드로 | GitLab manual job(재생 아이콘) | 검수(⑥) 단계 칩에 사람 아이콘 — "지금 사람을 기다리는 중"이 한눈에 |
| 점수 칩 인라인 + 판정 사유 펼침 | Braintrust, Phoenix, MLflow 원칙 | 평가 차원별 색상 칩, 클릭 시 LLM 판정 사유 텍스트 펼침. 점수만 있고 사유 없는 UI는 안티패턴 |
| 자동 평가와 인간 판단을 한 스키마로 | Phoenix {label, score, explanation, annotator_kind: HUMAN/LLM/CODE} | 평가 표시 데이터 모델. 린트=CODE, LLM 심사=LLM, 검수 액션=HUMAN |
| 실패/재시도를 attempt 번호로 보존, 최신 기본 + 이력 드롭다운 | GitHub Actions attempts, Dagster related runs | 컷 재생성·재기획 이력을 덮어쓰지 않고 attempt로 노출 |
| 두 고도 설계: 위는 큐레이션된 타임라인, 아래는 원시 이벤트 로그 | Stripe 결제 상세(Timeline + Events and logs) | 스테이지 섹션 아래에 LlmLog·ActionLog 원시 로그(펼침식) |
| 상태 pill은 작은 상태 타입 집합 + 풍부한 상태 이름 | Prefect(state type vs name), Stripe | "생성 중 (시도 2/3)" 식 — 타입 6종, 이름은 자유 |
| 후보 카드에 액션·점수·레시피 부착 | Midjourney(카드 위 액션), ComfyUI(출력이 입력 레시피 보유) | CandidateCard에 평가 칩 + 프롬프트 스냅숏 링크 |
| 기계 판정 + 사유 + 관련 컨텍스트를 검수 화면에 인라인 | Stripe Radar(risk insights, related payments) | 검수 단계에 평가 요약·경고·캐릭터 최근 게시물을 함께 노출, 화면 이탈 없는 결정 |
| 게시·메모리는 영수증으로 | HatchWorks Action Receipts | 무엇이 어디에 게시됐고(링크) 메모리에 뭐가 쓰였는지(실제 텍스트) + 시각 |

### 이번 회차에서 채택하지 않은 것 (백로그, 근거 포함)

- **키보드 중심 검수**(Langfuse 1-9/Cmd+Enter, Radar J/K): 검수량이 일 수십 건
  수준이 되면 도입. 지금은 운영자 1인·저볼륨.
- **DAG/Gantt 뷰**(Airflow/Dagster): 파이프라인이 선형+루프라 그래프는 과설계.
  세로 스테이지가 적합 (레퍼런스 종합의 결론과 일치).
- **목록 미니 파이프라인 점**(GitLab mini graph): 통합 목록은 구현했지만 각 행에
  점 8개를 반복하면 현재 단계와 대표 상태보다 소음이 커서 넣지 않았다.
- **딥링크·공유 URL**(Weave): admin 내부 도구라 후순위.

## 2. 정보 구조 (IA)

```
게시물 운영 큐 (/posts)
└─ 행 클릭 → /posts/:workId/:stage
   ├─ 공통 헤더: 캐릭터·상태·수동/자동·예약·최근 변경
   ├─ 공통 단계 레일: ① 브리프 … ⑧ 메모리
   └─ 현재 route 본문 하나
      ├─ /brief       입력·출처 영수증
      ├─ /plan        캡션·해시태그·컷 기획 편집
      ├─ /prompt      좌측 컷 목록 + 선택한 한 컷 편집
      ├─ /evaluation  기획/프롬프트 점수·사유 (비차단)
      ├─ /generation  컷별 실행·후보 생성
      ├─ /review      후보 선택·마감·캡션·승인/반려
      ├─ /publish     게시 대기·게시 결과·댓글/반응 진입
      └─ /memory      메모리 반영 영수증
```

상태 타입 6종: `waiting / running / awaiting-human / done / failed / skipped`.
기존 `StageTone`(done/current/failed/future)을 확장 매핑한다.

## 3. 구현 컴포넌트 (디자인 시스템: Mantine)

기존 `DraftStage`/`ShotCard`/`CandidateCard`/`DraftPlanSummary` 구조와
Mantine 토큰을 재사용한다. 하드코딩 색상 금지 — `DRAFT_STATUS_COLOR` 관례 확장.

| 컴포넌트 | 상태 | 내용 |
|---|---|---|
| `PostQueuePage` | 구현 | draft/Post 통합 6열 운영 큐, URL 필터, 행/Enter 탐색 |
| `PostWorkPage` | 구현 | 공통 헤더·8단계 route rail·현재 단계 단일 렌더 |
| `PostBriefCreatePage` | 구현 | 항상 manual draft를 만드는 단일 생성 진입점 |
| `EvaluationChips` | 재사용 | 차원별 점수와 사유를 평가 단계에 표시 |
| `DraftPlanSummary` | 재사용 | 기획 구조와 컷 요약 표시 |
| `ShotCard` / `CandidateCard` | 재사용 | 생성·검수 단계의 컷과 후보 조작 |
| `DraftDetailPanel` | 유지 | 이전 컴포넌트. 현재 navigation에서는 `PostWorkPage`가 단계별 조립을 소유 |

## 4. 필요한 API 확장

| 엔드포인트 | 상태 | 용도 |
|---|---|---|
| `GET /drafts/:id/evaluations` | 기존 구현 | 평가(plan/prompt, attempt 포함) |
| `GET /post-work-items` | 구현 | draft와 독립 Post를 중복 없이 합친 최근 변경순 운영 큐 |
| `GET /post-work-items/:id` | 구현 | workId가 draft/Post 중 무엇인지와 현재 단계 식별 |
| `PATCH /drafts/:id/plan` | 구현 | manual draft의 기획과 컷 메타데이터 동시 수정 |
| `PATCH /drafts/:id/prompts` | 구현 | draft-state 컷 프롬프트 일괄 확정 |
| `GET /drafts/:id/timeline` | 백로그 | ActionLog와 LlmLog 병합 이벤트 로그 |
| `GET /drafts/:id` attempt 확장 | 백로그 | 컷별 전체 잡 체인과 실제 메모리 row 연결 |

## 5. 단계적 구현

1. **구현됨**: 통합 운영 큐, 8단계 딥링크, 평가 화면, 수동 브리프·기획·
   프롬프트·생성·검수·게시, 독립 게시물의 게시/메모리 영수증.
2. **부분 구현**: 메모리는 현재 schema에 draft FK가 없어 게시 당시 캡션을
   영수증으로 표시한다. 평가 Worker가 꺼져 있으면 결과 없음 상태를 표시한다.
3. **백로그**: attempt 전체 이력, draft 이벤트 로그 병합, 실제 CharacterMemory
   row 연결. 현재 요청을 위해 schema나 추상화를 미리 추가하지 않는다.

## 6. 출처 색인

LangSmith view-traces·annotation queues / Langfuse trace view·annotation
queues·multi-modality / Braintrust comparing-experiments·human-review /
Arize Phoenix annotations / W&B Weave / OpenAI trace grading / MLflow
"LLM Observability UI" (2026) / HatchWorks Agent UX Patterns (2025) /
GitLab pipelines / GitHub Actions visualization·re-runs / Dagster webserver /
Prefect states / Temporal Web UI / Vercel deployments / Stripe Radar
reviews·payment detail / Stream scaling-content-moderation / Midjourney
variations / ComfyUI queue·history / Shopify order Timeline.
(전체 링크는 조사 원문 참조 — 조사일 2026-08-07)
