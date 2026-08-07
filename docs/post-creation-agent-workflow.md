# opod-admin 게시물 생성 Agent — 아키텍처 UML

파이프라인 한 줄 요약: **기획 → 프롬프트 빌드 → 이미지 생성 → 저장 → 검수(휴먼) → 게시 → 메모리 반영**

오케스트레이션 패턴: 별도 큐 시스템(Redis/BullMQ) 없이 **PostgreSQL을 내구성 큐로 쓰는 상태 머신 + lease 기반 클레임 + 15초 폴링 워커**.

---

## 0. 흐름 요약 모형 — 누가, 무엇을, 어떤 순서로

자동/수동 구분 없이(사람이 진행 버튼을 누르냐 차이일 뿐) 실행 순서만 단순화한 모형.

```mermaid
flowchart LR
    A["🗓️ DraftWorker<br/><b>스케줄링</b><br/><br/>게시 주기 도래한<br/>캐릭터의 초안 생성"]
    B["🧠 DraftWorker<br/>+ 기획 LLM<br/><b>기획</b><br/><br/>캡션·해시태그·<br/>컷 구성 결정"]
    C["✍️ DraftWorker<br/>+ 프롬프트 LLM<br/><b>프롬프트 빌드</b><br/><br/>컷별 영어<br/>프롬프트 변환"]
    D["🎨 GenerationWorker<br/>+ fal.ai<br/><b>이미지 생성</b><br/><br/>컷별 생성 → S3<br/>(후보 여러 장)"]
    E["📊 DraftWorker<br/><b>집계</b><br/><br/>전 컷 완료 확인<br/>→ 검수 대기"]
    F["👤 운영자<br/><b>검수</b><br/><br/>후보 선택·수정<br/>후 승인"]
    G["🚀 DraftWorker<br/><b>게시 + 기억</b><br/><br/>Post 발행 +<br/>캐릭터 메모리 기록"]

    FB(["♻️ 기록된 메모리는<br/>다음 회차 ② 기획의<br/>입력으로 재사용"])

    A --> B --> C --> D --> E --> F --> G
    G -.-> FB
```

| 순서 | 담당 | 작업 | 산출물 |
|---|---|---|---|
| 1 | DraftWorker | 스케줄링 — 게시 주기 도래한 캐릭터의 초안 생성 | `PostDraft(planned)` |
| 2 | DraftWorker + LLM | 기획 — 무엇을 올릴지 결정 | 캡션·해시태그·컷 구성 |
| 3 | DraftWorker + LLM | 프롬프트 빌드 — 컷별 이미지 프롬프트 작성 | 컷당 `GenerationJob` |
| 4 | GenerationWorker + fal.ai | 이미지 생성 — 컷별 실행, S3 저장 | `Media` 후보 N장 |
| 5 | DraftWorker | 집계 — 전 컷 완료 확인 | `needs_review` |
| 6 | 운영자 (사람) | 검수 — 후보 선택·수정·승인 | `approved` |
| 7 | DraftWorker | 게시 — Post 발행 + 캐릭터 메모리 기록 | `Post` + `CharacterMemory` |

---

## 1. 컴포넌트 다이어그램 — 시스템 구성과 의존 방향

```mermaid
flowchart LR
    subgraph UI["Admin React UI (packages/admin)"]
        OP["운영자 (Human Reviewer)"]
    end

    subgraph ADMIN["AdminModule (HTTP API)"]
        DC["DraftsController<br/>/api/admin/v1/drafts"]
        DS["DraftsService<br/>검수·승인·재생성 규칙"]
        GS["GenerationService<br/>단건 잡 위저드"]
    end

    subgraph WORKER["WorkerModule (자율 실행)"]
        DW["DraftWorkerService<br/>PostDraft 상태머신 소유"]
        GW["GenerationWorkerService<br/>GenerationJob 상태머신 소유"]
        CP["ContentPlanner<br/>(LLM 기획)"]
        PB["ImagePromptBuilder<br/>(LLM 프롬프트 변환)"]
    end

    subgraph DOMAIN["Domain / Infra"]
        SET["GenerationSettingsService<br/>DB 설정 > env 폴백"]
        LOG["LlmLogService<br/>모든 LLM 호출 기록"]
        PR["PrismaModule"]
    end

    subgraph EXT["외부 시스템"]
        LLM["LLM API<br/>(OpenAI-compatible)"]
        FAL["fal.ai Queue<br/>이미지 생성"]
        S3["AWS S3<br/>미디어 저장"]
        BE["opod-service-backend<br/>동일 DB 공유·스키마 소유"]
    end

    OP --> DC
    DC --> DS
    DS -->|수동 단계 실행| DW
    DS -->|잡 즉시 실행| GW
    GS --> GW
    DW --> CP & PB
    DW --> GW
    CP & PB --> LLM
    GW --> FAL
    GW --> S3
    WORKER --> SET & LOG & PR
    ADMIN --> PR
    PR --- BE
```

핵심 규칙: 의존 방향은 **Admin → Worker 단방향**. WorkerModule은 AdminModule을 모른다. 프롬프트 템플릿은 `prompts/` 디렉터리에 순수 문자열로만 격리(네트워크·DB 접근 금지).

---

## 2. 액티비티 다이어그램 — 전체 워크플로우 (auto 모드)

```mermaid
flowchart TD
    START(["트리거"]) --> T1{"진입 경로"}
    T1 -->|"스케줄러<br/>(CharacterPostingPolicy 주기)"| CREATE["PostDraft 생성 (planned)"]
    T1 -->|"운영자 수동 생성<br/>POST /drafts"| CREATE

    CREATE --> MODE{"mode?"}
    MODE -->|manual| MANUAL["각 단계를 운영자가<br/>버튼으로 직접 실행"]
    MODE -->|auto| CLAIM["워커가 draft 클레임<br/>(lease + 시도횟수 증가)"]

    CLAIM --> PLAN["① 기획 (LLM)<br/>캡션·해시태그·장소·컷(shot) 구성"]
    PLAN --> VALIDATE{"검증 통과?<br/>JSON·컷 수·레퍼런스 정책·<br/>ID 환각 필터"}
    VALIDATE -->|"정책 위반<br/>(재시도 불가)"| FAILED["draft: failed"]
    VALIDATE -->|"일시 오류 & 시도 < 3"| CLAIM
    VALIDATE -->|통과| BUILD["② 프롬프트 빌드 (LLM)<br/>한국어 장면 → 영어 모델별 프롬프트"]

    BUILD --> PERSIST["③ 계획 저장 (1 트랜잭션)<br/>PostDraft 갱신 + 컷별 GenerationJob 생성 (queued)"]

    PERSIST --> GATE{"서킷브레이커 열림<br/>or 일일 예산 초과?"}
    GATE -->|예| WAIT["대기 (다음 tick)"]
    WAIT --> GATE
    GATE -->|아니오| GEN["④ 이미지 생성 (잡별)<br/>fal.ai 제출→폴링→다운로드→S3 업로드<br/>→ Media + 후보 N장 저장"]

    GEN --> AGG{"⑤ 집계<br/>컷별 최신 잡 상태"}
    AGG -->|하나라도 실패| FAILED
    AGG -->|전부 완료| REVIEW["draft: needs_review"]

    REVIEW --> HUMAN["⑥ 휴먼 검수<br/>컷별 후보 1장 선택·필터 프리셋·<br/>캡션/예약시간 수정"]
    HUMAN --> DECIDE{"판정"}
    DECIDE -->|거절| REJECTED["draft: rejected"]
    DECIDE -->|"컷 재생성<br/>(새 Job, originJobId 연결)"| GEN
    DECIDE -->|승인| APPROVED["draft: approved"]

    APPROVED --> DUE{"예약 시간 도래?"}
    DUE -->|아니오| DUE
    DUE -->|예| PUB["⑦ 게시 (1 트랜잭션)<br/>필름 피니시 적용 → Post + PostMedia<br/>+ Hashtag 생성"]
    PUB --> MEM["⑧ 메모리 반영 (동일 트랜잭션)<br/>CharacterMemory + ActionLog 기록"]
    MEM --> DONE(["published"])
```

---

## 3. 시퀀스 다이어그램 — 기획~생성 핵심 구간

```mermaid
sequenceDiagram
    participant DW as DraftWorkerService
    participant DB as PostgreSQL (Prisma)
    participant LLM as LLM API
    participant GW as GenerationWorkerService
    participant FAL as fal.ai
    participant S3 as S3

    Note over DW: tick() 15초 폴링
    DW->>DB: claimPlannedDraft (SKIP LOCKED + lease)
    DB-->>DW: draft + 캐릭터 페르소나·메모리·장소·비주얼 프로필
    DW->>LLM: ① 콘텐츠 기획 요청
    LLM-->>DW: 캡션·해시태그·컷 구성 (JSON)
    DW->>DW: 검증 (컷 수·레퍼런스 정책·ID 환각 필터)
    DW->>DB: extendPlanLease (LLM 2회 직렬호출 대비)
    DW->>LLM: ② 이미지 프롬프트 빌드 (전 컷 배치 1회)
    LLM-->>DW: 영어 모델 최적화 프롬프트
    DW->>DB: ③ persistPlan (1 tx: draft 갱신 + Job N개 queued)

    Note over GW: tick() — 예산·서킷브레이커 통과 시
    GW->>DB: 잡 클레임 (FOR UPDATE SKIP LOCKED + lease)
    GW->>FAL: ④ submit (t2i 또는 edit 라우팅,<br/>레퍼런스는 S3 presigned URL)
    loop 폴링
        GW->>FAL: poll status
    end
    FAL-->>GW: 결과 이미지 N장
    GW->>S3: 업로드
    GW->>DB: persistSuccess (Media + 후보 Output + completed)

    Note over DW: 다음 tick
    DW->>DB: ⑤ 집계 → needs_review (휴먼 검수 대기)
```

---

## 4. 상태 머신 — 두 핵심 엔티티

```mermaid
stateDiagram-v2
    state "PostDraft" as PD {
        [*] --> planned : 스케줄러 / 수동 생성
        planned --> generating : 워커 클레임
        generating --> planned : lease 만료 재큐 (시도 < 3)
        generating --> needs_review : 전 컷 생성 완료
        generating --> failed : 시도 소진 / 정책 위반 / 컷 실패
        needs_review --> approved : 운영자 승인 (컷별 1장 선택 필수)
        needs_review --> rejected : 운영자 거절
        needs_review --> regenerating : 컷 재생성
        regenerating --> needs_review : 새 잡 완료
        approved --> published : 예약 시각 도래 → 게시 tx
    }
```

```mermaid
stateDiagram-v2
    state "GenerationJob" as GJ {
        [*] --> draft : manual 모드 사전 상태
        [*] --> queued : auto 모드
        draft --> queued : 운영자 생성 버튼
        queued --> running : 워커 클레임 (lease)
        running --> queued : lease 만료 / 일시 오류<br/>(providerRequestId 유지 → 이중과금 방지)
        running --> completed : 이미지 저장 성공
        running --> failed : 영구 오류(422) / 시도 소진
    }
```

---

## 아키텍처 결정 포인트 요약

| 결정 | 내용 |
|---|---|
| 큐 | 별도 큐 인프라 없음 — Postgres `FOR UPDATE SKIP LOCKED` + lease가 큐 역할 |
| 복구 | 3계층: draft 재큐(≤3회) / 잡 재시도(≤3회, 폴링 재개) / 전역 게이트(서킷브레이커·일일 예산) |
| 휴먼 게이트 | `needs_review` 승인 필수 (현재 POC 제약, 최종 목표는 완전 자동) |
| 수동/자동 | `mode=manual`이면 모든 단계가 운영자 버튼 실행, 자동 게시 제외 |
| 관측성 | 모든 LLM·이미지 호출 → `LlmLog`, 모든 상태 전이 → `CharacterActionLog` |
| 피드백 루프 | 게시 시 `CharacterMemory` 기록 → 다음 기획 LLM의 입력으로 재사용 |
