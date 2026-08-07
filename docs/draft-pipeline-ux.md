# 게시물 생성 A-Z 파이프라인 화면 UX 설계

Status: 설계 확정 (2026-08-07), 구현 전
목표: 게시물 하나의 전 생애주기(스케줄→기획→프롬프트→생성→평가→검수→게시→
메모리)를 **한 화면에서** 파악·조작할 수 있게 검수 화면을 확장한다.

## 1. 레퍼런스 조사 요약

두 갈래(LLM 관측성 도구 / 파이프라인·검수·미디어 도구)로 조사했다.
상세 출처는 문말 색인.

### 채택한 핵심 패턴

| 패턴 | 출처 | 적용 |
|---|---|---|
| 스테이지별 타입 인지 렌더링 — 모든 단계를 generic JSON으로 그리지 않는다 | LangSmith run_type | 기획→구조화 플랜, 프롬프트→복사 가능한 텍스트, 생성→후보 썸네일 그리드, 평가→루브릭 점수표, 게시→영수증 |
| 상단 스테이지 레일 + 세로 확장 섹션 하이브리드 | GitLab stage graph + GitHub Actions collapsible steps | 8단계 칩 레일(클릭=해당 섹션으로 스크롤) + 기존 DraftStage 세로 타임라인 유지 |
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
- **목록 미니 파이프라인 점**(GitLab mini graph): 목록 화면 개편은 별도 회차.
- **딥링크·공유 URL**(Weave): admin 내부 도구라 후순위.

## 2. 정보 구조 (IA)

```
DraftDetailPanel (기존 확장)
├─ 헤더: 캐릭터·언어·상태 pill·예약 시각·기본 액션        [Stripe 헤더 패턴]
├─ 스테이지 레일: ①…⑧ 칩 (상태 아이콘+구분: 자동/휴먼게이트) [GitLab]
├─ ① 초안 생성   (기존 DraftStage 유지)
├─ ② 기획        (기존) + 평가 칩 행: 기획 평가 8차원 + 총점
│                  └ 펼침: 차원별 점수·사유·issues        [Braintrust]
├─ ③ 프롬프트    (기존) + 컷별 린트 배지
├─ ④ 생성        (기존 ShotCard) + 컷별 프롬프트 평가 칩
│                  ├ CandidateCard: 선택 상태 (기존)
│                  └ attempt 이력 드롭다운 (재생성 체인)    [GH Actions]
├─ ⑤ 집계/검수   (기존 승인·거절·재생성 폼)
│                  + 평가 요약·generationTrace 경고 인라인   [Radar]
├─ ⑥ 게시        영수증: Post 링크·게시 시각·적용 필터      [Receipts]
├─ ⑦ 메모리      영수증: 기록된 CharacterMemory 실제 텍스트
└─ 이벤트 로그    LlmLog + CharacterActionLog 시간순, 펼침식 [Stripe 2고도]
```

상태 타입 6종: `waiting / running / awaiting-human / done / failed / skipped`.
기존 `StageTone`(done/current/failed/future)을 확장 매핑한다.

## 3. 컴포넌트 계획 (디자인 시스템: Mantine, 정본 예시: DraftStage)

기존 `DraftStage`/`ShotCard`/`CandidateCard`/`DraftPlanSummary` 구조와
Mantine 토큰을 재사용한다. 하드코딩 색상 금지 — `DRAFT_STATUS_COLOR` 관례 확장.

| 컴포넌트 | 신규/수정 | 내용 |
|---|---|---|
| `StageRail` | 신규 | 8칩 가로 레일. 칩=Badge+아이콘, 클릭 시 스크롤. 휴먼 게이트 칩은 사람 아이콘 |
| `EvaluationChips` | 신규 | 차원별 점수 칩 행 + Collapse로 사유·issues. annotator_kind 배지(린트/LLM) |
| `AttemptSelect` | 신규 | 컷별 attempt 드롭다운(원 잡 체인). 기본=최신 |
| `StageReceipt` | 신규 | 게시·메모리 영수증(링크·시각·본문 발췌) |
| `DraftEventLog` | 신규 | LlmLog·ActionLog 병합 시간순, Spoiler/Code로 원시 JSON 펼침 |
| `DraftStage` | 수정 | tone 확장(awaiting-human), 요약행에 소요시간 표시 |
| `ShotCard` | 수정 | 프롬프트 평가 칩·린트 배지 삽입 |
| `DraftDetailPanel` | 수정 | 레일+신규 섹션 조립. 실패/휴먼대기 섹션 자동 펼침(GH Actions) |

## 4. 필요한 API 확장

| 엔드포인트 | 용도 |
|---|---|
| `GET /drafts/:id/evaluations` | 평가(plan/prompt, attempt 포함) — 평가 Agent 설계와 공유 |
| `GET /drafts/:id/timeline` | 이벤트 로그: 해당 draft의 CharacterActionLog + LlmLog(요청 requestId=draftId 또는 jobId 연결) 병합 |
| `GET /drafts/:id` 확장 | 컷별 전체 잡 체인(attempt 이력), 게시 영수증(메모리 본문·Post 링크) 포함 |

## 5. 단계적 구현

1. **1차 (평가 Agent 구현과 동시)**: 스테이지 레일, 평가 칩(②·④), 검수 인라인
   요약, 게시·메모리 영수증, 타임라인 API + 이벤트 로그 섹션.
2. **2차**: attempt 이력 드롭다운, 컷 레시피(프롬프트 스냅숏) 보기.
3. **백로그**: 키보드 검수, 목록 미니 파이프라인, 딥링크.

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
