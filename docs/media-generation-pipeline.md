# 캐릭터 게시글 미디어 자동 생성 파이프라인

Date: 2026-07-12
Status: Phase 1·2 구현 완료 (2026-07-12) — Phase 1: 선행 수리 1~5, 스키마, WorkerModule,
비주얼 프로필 탭, 생성→게시 연결. Phase 2: PostDraft 파이프라인(기획→생성→검수→예약
게시→메모리 역반영), 콘텐츠 플래너(LLM/로컬), 포스팅 정책 스케줄러, 초안 검수 UI,
자동화 탭. Phase 3(i2v 릴/스토리/자동 QC/auto-publish)은 미착수.
관련 문서: `opod-service-backend/docs/server-architecture.md` (본 문서가 워커 배치 결정을 일부 갱신함),
`opod-service-backend/docs/credit-policy.md`, `docs/api/admin-generation-jobs.md`

AI 캐릭터가 올릴 게시글(피드/릴)·스토리의 사진/영상을 자동 생성하는 파이프라인 설계.
설계 초안에 대한 코드베이스 대조 검토(2026-07-12)를 반영한 v2이며, 검토에서 확인된
기존 코드의 결함(아래 "기존 코드 선행 수리" 참조)도 함께 다룬다.

## 목표와 범위

- 캐릭터별 포스팅 정책에 따라 포스트 초안(기획→미디어 생성→검수→게시)이 자동으로 생산된다.
- MVP에서는 전량 사람(admin) 승인 후 게시한다. 자동 게시는 신뢰가 쌓인 뒤 단계 전환.
- 이 파이프라인은 **운영 원가**다. 유저가 크레딧을 소모하는 생성 액션(`image_generate` 등,
  credit-policy.md)과는 별개 트랙이며, 프로바이더 어댑터 코드만 공유한다.

## 파이프라인 개요

```text
[기획] → [프롬프트 컴파일] → [미디어 생성] → [후처리/업로드] → [검수] → [게시] → [메모리 반영]
 LLM      비주얼 프로필 주입    프로바이더 API    S3 + Media 확정    admin     Post/Story   CharacterMemory
```

1. **기획(content_plan)** — LLM이 페르소나 + CharacterMemory + 최근 포스트(중복 소재 방지)를
   입력으로 포스트 컨셉을 구조화 출력: `{ caption, hashtags[], shots: [{scene, mood, composition}] }`.
2. **프롬프트 컴파일** — 샷별 장면 프롬프트에 캐릭터 비주얼 프로필(외모/스타일/네거티브)을 주입.
   페르소나 → 프롬프트 조립기는 현재 코드베이스에 없으므로 신규 구현이다(스키마 주석의 의도만 존재).
3. **미디어 생성** — 프로바이더 어댑터 호출. 컷(shot)당 후보 2~4장 생성(best-of-N).
4. **후처리** — 프로바이더 출력 다운로드 → 리사이즈/썸네일 → C2PA/워터마크 삽입(리사이즈 **이후**,
   메타데이터 소실 방지) → S3 업로드(storageKey) → `Media.uploadedAt` 확정.
   프로바이더가 준 임시 URL을 그대로 저장하는 것은 금지(만료됨 + `uploadedAt` 게이트에 걸려 게시 불가).
5. **검수** — draft가 `needs_review` 큐에 노출. admin이 컷별 후보 선택, 캡션 수정, 재생성, 승인/반려.
6. **게시** — 승인된 draft를 `scheduledAt`에 Post + PostMedia + 해시태그로 생성(기존 createPost
   로직 재사용 — 해시태그 connectOrCreate, CharacterActionLog 포함). 스토리는 Story 생성.
   `scheduledAt`이 이미 지난 뒤 승인되면 즉시 게시한다.
7. **메모리 반영** — 게시 완료 후 후속 잡이 "게시한 소재/장소/시점"을 CharacterMemory에 기록.
   확정 세계관 캐릭터(한소이 등)가 다음 기획에서 기존 게시물과 모순되지 않게 하는 유일한 장치.

## 핵심 결정 (ADR)

### D1. 워커 배치: 당분간 opod-admin 프로세스 내에서 실행

- **결정**: 생성 워커(폴링 루프)를 opod-admin 프로세스 안에서 함께 실행한다.
  별도 컨테이너를 지금은 추가하지 않는다. 추후 부하가 생기면 **별도 이미지로 분리**한다.
- **컨텍스트**: server-architecture.md는 별도 `opod-worker` 런타임을 결정했으나, 현 시점에는
  캐릭터 수·잡 물량이 적어 컨테이너를 늘릴 실익이 없다.
- **기각 대안**: 별도 컨테이너/CMD(운영 단순화 우선으로 보류, 분리 시점에 채택),
  BullMQ+Redis(기존 "Redis는 durable 큐로 쓰지 않는다" 결정과 충돌).
- **분리 대비 구현 규칙**:
  - 워커 코드는 처음부터 `WorkerModule`로 격리하고 admin HTTP 모듈에 역참조를 두지 않는다.
    분리 시 엔트리포인트(`worker.ts`)와 이미지만 추가하면 되는 구조를 유지한다.
  - `WORKER_ENABLED` env로 온오프. 분리 후에는 admin에서 끄고 워커 컨테이너에서만 켠다.
  - admin을 스케일아웃하면 워커도 그 수만큼 돈다. SKIP LOCKED로 안전은 하지만 의도치 않은
    동시성 증가이므로, 스케일아웃 전에 분리를 선행한다.
- **감수하는 것**: admin 배포 시 진행 중 잡이 중단된다. 이는 D3의 lease/timeout 회수와
  `providerRequestId` 이어받기로 흡수한다(중단된 잡은 lease 만료 후 자동 재수용).

### D2. 큐: PostgreSQL + FOR UPDATE SKIP LOCKED (기존 결정 유지)

- `generation_jobs`를 durable 큐로 사용. 폴링 주기 10~30초. Redis/BullMQ 도입하지 않음.

### D3. 잡 생명주기: lease 기반 회수 + 원자적 전이 + providerRequestId

- **결정**: 잡 claim 시 `leaseExpiresAt`을 설정하고, 스윕 루프가 lease 만료된 `running` 잡을
  `queued`로 되돌린다(`attemptCount` 증가). `attemptCount`가 상한(기본 3)에 도달하면 `failed`.
- 모든 상태 전이는 조건부 `updateMany({ where: { id, status: <기대값> } })`로 수행하고
  affected=0이면 전이 실패로 처리한다. 현행 check-then-act(`getJob` 후 무조건 update)는 금지.
- 프로바이더에 제출한 직후 `providerRequestId`를 1급 컬럼에 기록한다(paramsJson에 뭉개지 않는다).
  재시작/재수용 시 이 ID가 있으면 새로 제출하지 않고 결과 폴링으로 이어받는다 → 이중 제출·이중 과금 방지.
- **retry 의미론 통일**: 자동 재시도 = 같은 행의 `attemptCount` 증가.
  사람이 누르는 재생성 = 새 행 생성 + `originJobId` 링크(감사 추적).
  현행 `retryJob`(상태 확인 없이 행 복제, 원본 링크 없음)은 이 규칙으로 대체한다.

### D4. 캐릭터 비주얼 일관성: 레퍼런스 이미지 컨디셔닝으로 시작

- **결정**: 캐릭터 기준 이미지 3~5장 + 장면 프롬프트를 reference-conditioned 모델
  (Gemini 이미지 모델, FLUX Kontext, Seedream 계열 등)에 넣는 방식으로 시작.
- **기각 대안**: 캐릭터별 LoRA 파인튜닝(일관성 최고지만 학습 비용·버전 관리 부담,
  캐릭터가 자리 잡은 뒤 `providerConfig`로 추가 도입 가능한 구조만 남겨둠).
- **콜드스타트**: 첫 레퍼런스 이미지는 비주얼 프로필 탭의 "테스트 생성" 루프로
  텍스트→이미지 생성 → 사람이 큐레이션 → 레퍼런스로 승격. 외부 이미지 수동 업로드
  (기존 presigned 업로드)도 허용.

### D5. 프로바이더: 어댑터 인터페이스 + 호스팅 API 우선, ComfyUI는 후순위

- **결정**: `ImageGenerationProvider` / `VideoGenerationProvider` 인터페이스를 정의하고,
  fal.ai 같은 애그리게이터 API 어댑터 1개로 시작한다(여러 모델을 API 하나로).
  env 기반 설정 + 로컬 개발용 fallback(플레이스홀더 이미지 반환) 관용구는
  `message-reply.provider.ts`에서 가져오되, 호출 구조는 동기 fetch가 아니라
  **제출→폴링(providerRequestId)** 비동기 패턴으로 새로 설계한다.
- **주의**: server-architecture.md와 credit-policy.md는 자체 ComfyUI GPU 원가(₩10-30)를
  전제한다. 호스팅 API 단가로 운영할 경우 credit-policy의 원가 전제 갱신이 필요하다(미해결 — 아래 참조).

### D6. 영상: image-to-video만 사용

- 텍스트→영상 직접 생성은 캐릭터 얼굴 일관성이 무너지므로 금지.
  대표 이미지를 먼저 생성/선택 → i2v(Kling/Veo/Runway 등)로 5~10초 릴 생성.
  영상 파이프라인은 이미지 파이프라인 뒤에 한 단계 붙는 구조가 된다.

### D7. best-of-N 후보 저장: GenerationJobOutput 1:N 테이블

- **결정**: 잡 1개 = 컷(shot) 1개로 두고, 후보 이미지들은 `GenerationJobOutput`
  (jobId, mediaId, candidateIndex, selected) 1:N으로 저장한다.
  기존 `outputMediaId` 단일 FK는 "선택된 최종 출력" 캐시로만 유지(또는 점진 폐기).
- **기각 대안**: 후보 1장 = 잡 1행(컷 순서 `sortOrder`와 의미 충돌, 잡 수 폭증).

### D8. 스토리 표현: draftType + 다형 참조

- **결정**: `PostDraft`에 `draftType(post | story)`을 두고, 게시 결과 참조를
  `publishedPostId` / `publishedStoryId` 두 개의 nullable FK로 분리한다.
  Story는 Post가 아니므로(별도 모델, 단일 media + expiresAt) 단일 FK로 담을 수 없다.
  스토리 `expiresAt`(현재 24h 하드코딩)은 스토리 파이프라인 착수 시 정책화한다.

### D9. 검수: 전량 인간 승인 → 조건부 auto-publish

- MVP는 승인 없이는 아무것도 게시되지 않는다. 반려율이 안정된 뒤 비전 모델 QC
  (캐릭터 일관성, 손/얼굴 왜곡, 이미지 내 텍스트 오염, NSFW) 통과 건에 한해
  auto-publish로 단계 전환한다.

## 상태 머신

### PostDraft

server-architecture.md의 상태도(`planned → generating → review → approved → published`,
`rejected`, `regenerating`)를 따르되 이름을 다음과 같이 확정한다:

```text
planned → generating → needs_review → approved → published
                     ↘ failed          ↘ rejected
needs_review → regenerating → needs_review   (컷 재생성 시)
```

- `needs_review` = arch doc의 `review`. 이후 문서는 이 이름으로 통일한다.
- **부분 실패 규칙**: draft의 모든 컷 잡이 성공해야 `needs_review`로 진입한다.
  어느 컷이든 attemptCount 소진으로 최종 `failed`가 되면 draft도 `failed`
  (운영자가 재생성 지시 또는 폐기). 부분 성공 게시는 허용하지 않는다.
- `approved` → `published` 전이는 워커가 수행한다(`scheduledAt` 도래 시, 지났으면 즉시).
- inactive 캐릭터(`Character.status = inactive`)는 스케줄러가 draft를 생성하지 않고,
  approved 상태여도 게시하지 않는다(보류).

### GenerationJob

```text
queued → running → completed
       ↖ (lease 만료, attempt < max) | → failed (attempt 소진)
```

## 데이터 모델 변경안

canonical 스키마는 `opod-service-backend/prisma/schema.prisma`. 아래는 스케치이며
필드명·타입은 구현 시 확정한다.

```prisma
// 신규 — 시각적 정체성 (페르소나 = 말투/성격과 분리)
model CharacterVisualProfile {
  characterId      String  @unique
  appearancePrompt String  // 외모 고정 서술
  stylePrompt      String  // 화풍 (예: film photography, Kodak Portra, grain)
  negativePrompt   String
  // 기준 이미지 3~5장 (Media 관계 테이블)
  providerConfig   Json?   // loraId, seed 등 프로바이더별 설정
}

// 신규 — 포스팅 정책 (스케줄러 입력; providerConfig에 끼워 넣지 않는다)
model CharacterPostingPolicy {
  characterId    String  @unique
  enabled        Boolean
  weeklyCadence  Int     // 주당 게시 횟수
  timeWindow     Json    // 게시 시간대 창 (KST 기준, 지터 적용)
  reelRatio      Float   // 릴 비중 (초기 낮게)
}

// 신규 — 기획~게시 단위
model PostDraft {
  characterId      String
  draftType        post | story
  contentType      PostContentType?   // post일 때 feed | reel
  caption          String
  hashtags         String[]
  conceptJson      Json               // LLM 기획 원본 (shots 포함)
  status           planned | generating | needs_review | regenerating
                   | approved | rejected | published | failed
  scheduledAt      DateTime?          // KST 정책으로 산출, UTC 저장
  publishedPostId  String?
  publishedStoryId String?
  @@index([status, scheduledAt])
}

// 확장 — GenerationJob
model GenerationJob {
  draftId           String?   // draft 1 : 컷 N
  sortOrder         Int       // 컷 순서 (캐러셀)
  provider          String?   // "fal:flux-kontext" 등
  paramsJson        Json?
  providerRequestId String?   // 제출 직후 기록, 이어받기·이중 과금 방지
  leaseExpiresAt    DateTime? // 좀비 회수
  attemptCount      Int
  originJobId       String?   // 수동 재생성 계보
  errorMessage      String?
  costUsd           Decimal?  // Float 금지 (누적 오차)
  @@index([status, createdAt])   // 폴링 쿼리 — 현재 인덱스 전무
  @@index([draftId])
}

// 신규 — best-of-N 후보 (D7)
model GenerationJobOutput {
  jobId          String
  mediaId        String
  candidateIndex Int
  selected       Boolean
}

// 확장 — enum/미디어
GenerationJobStatus: + failed
Media:               + isAiGenerated Boolean  // AI 기본법 표시 의무. Phase 1에 선반영 (백필 방지)
```

### 스키마 변경 절차 (필수 준수)

두 리포가 각자 schema.prisma를 갖고 있고 마이그레이션 이력 없이 `prisma db push`로 운영 중이다.
소유권: canonical = opod-service-backend (양쪽 AGENTS.md에 명시).

1. opod-service-backend의 schema.prisma에 먼저 반영하고 `db push`.
2. opod-admin의 schema.prisma에 동일 변경을 복사하고 `db:generate`.
3. 두 스키마의 drift를 잡는 diff 체크 스크립트를 CI에 추가한다(Phase 1 산출물).
   ※ 검토 시점에 이미 drift 실재(admin에 UserWithdrawal 없음, PostComment/PostReaction 구조
   불일치) — 별도 작업으로 선행 수리한다.
4. enum 변경(`failed` 추가)은 additive이므로 안전하지만, 컬럼 제거·타입 변경이 필요한 경우
   `--accept-data-loss` 없이 수행 가능한지 사전 검증한다. 중기적으로 스키마 단일 패키지 추출 검토.

## 기존 코드 선행 수리 (이 기능과 함께 반드시)

검토에서 확인된, 파이프라인 도입 전에 고쳐야 하는 현행 결함:

1. **`failed` status 부재는 현재 진행형 버그** — admin UI가 이미 `?status=failed`로 배지를
   호출 중이고 백엔드가 400을 반환하고 있다(packages/admin/main.js:93, failed 태그/재시도 버튼도
   UI에 존재). enum 추가 + `parseOptionalStatus` + `docs/api/admin-generation-jobs.md` 동시 갱신.
2. **uploadedAt 게이트** — URL로 완료된 Media는 `uploadedAt`이 null이라 createPost/createStory가
   400으로 거부한다(admin.service.ts assertStoredMedia). 워커는 반드시 S3 재업로드 경로만 사용.
   URL-만-저장 완료(completeJob url 경로)는 파이프라인에서 금지.
3. **원자적 전이 부재** — startJob/completeJob의 check-then-act를 조건부 updateMany로 교체(D3).
   completeJob은 재호출 시 Media를 중복 생성하므로 멱등하게 수정.
4. **수동 엔드포인트 정리** — 워커 도입 후 `POST /generation/jobs/:id/start|run|complete`는
   워커 미클레임 잡에만 허용하거나 폐기(계약 문서에 명시). `run`은 현재 provider 호출 없는
   껍데기이므로 재정의 대상. enqueue/start/run/retry/complete가 API 문서에 미기재 — 함께 문서화.
5. **CharacterActionLog** — 워커의 모든 전이·게시도 기존과 동일하게 기록. 자동화로 로그가
   수십 배 늘어나므로 로그 조회(현재 take:50 고정, 필터 없음)에 페이지네이션 추가.

## 비용 통제

- 사후 집계(`costUsd`)만으로는 부족하다. 다음을 워커에 내장한다:
  - **일일 예산 상한**(env, USD) — 초과 시 신규 잡 claim 중단 + 운영자 노출.
  - **캐릭터별 일일 생성 상한** — 스케줄러 버그로 draft가 폭주해도 과금이 제한되도록.
  - **서킷브레이커** — 프로바이더 연속 실패 N회 시 해당 프로바이더 잡 claim을 일시 중단.
- 참고 단가(2026-07 기준 대략): 이미지 장당 $0.03~0.05, best-of-4 피드 1건 $0.15~0.3.
  영상 5~10초 $0.3~수 달러(모델 편차 큼) → 릴은 주 1~2회로 제한. LLM 기획·비전 QC 호출,
  실패 재시도분, S3/CDN 트래픽도 원가에 포함해 산정한다.

## 규제·안전

- AI 기본법(2026-01 시행)의 AI 생성물 표시 의무:
  - `Media.isAiGenerated` 플래그(Phase 1 스키마 선반영) → 서비스 UI 배지는 public API 계약
    변경이 필요하므로 별도 트랙으로.
  - C2PA/워터마크는 후처리에서 리사이즈·썸네일 **이후** 삽입(메타데이터 소실 방지).
- 생성 결과 NSFW/유해 필터(프로바이더 내장 + 필요 시 비전 모델 체크)를 거친 뒤에만 검수 큐 진입.
- 게시 후 신고(Report targetType=post) 대응: 게시물 숨김/삭제(takedown) 경로가 admin에 아직
  없으므로 별도 과제로 등록(미해결 — 아래 참조).

## 운영·관측

- 메트릭: 잡 실패율, 큐 대기 시간, draft 생산→게시 리드타임, 프로바이더별 비용/지연.
- 알림: 연속 실패·예산 소진 시 운영자에게 노출(초기에는 admin 대시보드 배지 수준).
- 반려·미선택 후보 Media와 S3 객체는 보존 기간(예: 30일) 후 정리하는 청소 잡을 둔다.
- 시간 기준: 스케줄·배치는 KST 기준으로 산출하고 UTC로 저장한다(CreditCheckIn 관행과 동일).

## Admin UX (packages/admin)

- **캐릭터 상세 > 비주얼 프로필 탭** — 레퍼런스 이미지 관리(업로드/승격/교체), 외모·스타일
  프롬프트 편집, 테스트 생성(콜드스타트 루프 겸용).
- **검수 큐** — needs_review draft 목록. 컷별 후보 N장 중 선택, 캡션 인라인 수정,
  컷 단위 재생성(프롬프트 수정 가능), 승인/반려.
- **콘텐츠 캘린더** — 캐릭터별 예정/게시 현황 주간 뷰. (Phase 2 후순위 — MVP 아님)

## 로드맵

### Phase 1 (MVP) — 완료 (2026-07-12)

"프롬프트를 넣으면 실제로 생성되고, 승인하면 게시된다."

- 선행 수리 1~5, 스키마(GenerationJob lease/providerRequestId/attemptCount +
  GenerationJobOutput + CharacterVisualProfile + `Media.isAiGenerated`),
  WorkerModule(admin 내장) + fal.ai 어댑터/로컬 fallback + S3 후처리 + 예산 상한,
  비주얼 프로필 탭 + 테스트 생성 + 레퍼런스 승격, 생성→게시 연결 E2E 검증.

### Phase 2 — 완료 (2026-07-12)

"초안이 자동으로 쌓이고, 사람은 승인만 한다."

- PostDraft 상태머신 + 콘텐츠 플래너(LLM env 없으면 로컬 결정적) + 드래프트 워커
  (기획 claim → 컷 잡 생성 → 집계 → 예약 게시 → CharacterMemory 역반영),
  CharacterPostingPolicy + 스케줄러(간격 + KST 시간창 지터),
  초안 검수 UI(후보 선택/캡션 편집/승인·반려/컷 재생성) + 캐릭터 자동화 탭.
- 전 구간 E2E 검증: 수동 draft → 기획 → 생성 → 검수 → 승인 → 자동 게시 + 메모리.
- 이월: 콘텐츠 캘린더 UI(주간 뷰)는 Phase 3으로.

### 다음 단계 A — 실서비스 전환 준비 (코드보다 운영 작업, Phase 3 전에)

1. **실제 프로바이더 연결** (fal.ai 어댑터 구현 완료 — 2026-07-14):
   `FAL_API_KEY` + `FAL_IMAGE_MODEL`(레퍼런스 컨디셔닝 edit 모델, 권장
   `fal-ai/nano-banana/edit` ~$0.039/장) + `FAL_IMAGE_T2I_MODEL`(콜드스타트
   text-to-image, 권장 `fal-ai/nano-banana`), `LLM_API_URL/KEY/MODEL`(기획) 설정.
   `WORKER_DAILY_BUDGET_USD` 필수 설정, `WORKER_JOB_COST_ESTIMATE_USD`를
   실제 모델 단가 × 후보 수로 보정(nano-banana × 후보 2 ≈ 0.08).
   **키/모델은 admin UI(생성 작업 > 프로바이더 설정)에서 DB로도 관리할 수 있고,
   DB 값이 env보다 우선하며 재시작 없이 다음 잡부터 적용된다**
   (`docs/api/admin-settings.md`). 수동 실행은 `POST /api/generation/worker/run`.
   워커는 레퍼런스 유무로 t2i/edit 모델을 라우팅한다 — edit 계열은
   `image_urls`가 필수라 콜드스타트 잡을 받을 수 없기 때문.
   `visualProfile.providerConfig`(기본값) ← `job.paramsJson`(우선) 순으로
   모델별 파라미터(nano-banana `aspect_ratio`, seedream `image_size` 등)를 주입.
   **주의**: 레퍼런스 이미지 URL은 fal이 밖에서 fetch할 수 있어야 한다 —
   `S3_PUBLIC_BASE_URL`(공개 CDN/버킷) 설정이 전제. negative prompt는
   SD 계열 외 모델(nano-banana·seedream·flux)이 입력으로 받지 않아 전달하지
   않는다(필요 시 paramsJson의 `negative_prompt`로 강제).
2. **한소이(@soi_film) 온보딩**: 비주얼 프로필(외모/스타일/네거티브) 작성 →
   테스트 생성 루프로 레퍼런스 3~5장 큐레이션·승격 → 페르소나/메모리 정비 →
   포스팅 정책 활성화(주 3~4회, 18~22 KST). 첫 몇 주는 전량 검수 유지.
3. **실프로바이더 리허설**: 첫 주는 반려율·건당 비용·프롬프트 품질을 액션로그와
   costUsd 기준으로 모니터링. 반려 사유를 모아 플래너 시스템 프롬프트 보정.
4. **스키마 drift 수리 마무리** (User/PostComment/PostReaction — 별도 작업 진행 중)
   후 `npm run schema:check`를 CI에 편입.
5. **credit-policy.md 원가 전제 갱신** — 호스팅 API 단가 기준으로 (미해결 질문 1).

### 다음 단계 B — Phase 3: "완전 자동 운영, 사람은 예외 처리만" (미착수)

- **릴(i2v)**: `VideoGenerationProvider` 어댑터(대표 이미지 → image-to-video,
  Kling/Veo 등) + 워커의 video 잡 처리(현재 claim은 image만) + 영상 후처리
  (썸네일/duration/byteSize). draft `contentType=reel` 경로 활성화.
- **스토리 파이프라인**: D8 결정 활용 — `draftType=story`(단일 컷,
  `publishedStoryId`), 워커 게시 경로에 Story 생성 추가, expiresAt 정책화
  (현재 createStory는 24h 하드코딩).
- **자동 QC → 조건부 auto-publish**: 비전 모델 judge(캐릭터 일관성, 손/얼굴 왜곡,
  이미지 내 텍스트 오염, NSFW)를 needs_review 진입 전에 실행. 반려율이 안정된
  캐릭터에 한해 QC 통과 건 auto-publish를 **캐릭터별 opt-in**으로 도입.
- **미구현 후처리 완성**: C2PA/워터마크 삽입(규제 섹션 — 현재 `isAiGenerated`
  플래그만 존재), 서비스 UI AI 배지 노출(public API 계약 — 별도 트랙),
  반려·미선택 후보 Media/S3 청소 잡(보존 30일).
- **콘텐츠 캘린더 UI**: 캐릭터별 예정/게시 주간 뷰 (Phase 2 이월).
- **워커 별도 이미지 분리**: D1 마이그레이션 실행 — `worker.ts` 엔트리포인트 +
  전용 컨테이너, admin은 `WORKER_ENABLED=false`. 잡 물량/스케일아웃 필요가
  근거가 될 때.

## 부록: 워커 환경 변수 (Phase 1 구현 기준)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `WORKER_ENABLED` | `false` | `true`/`1`일 때만 워커 루프 가동 |
| `WORKER_POLL_INTERVAL_MS` | 15000 | 큐 폴링 주기 |
| `WORKER_JOBS_PER_TICK` | 1 | 틱당 처리 잡 수 |
| `WORKER_LEASE_SECONDS` | 600 | claim lease. 만료 running 잡은 스윕이 회수 |
| `WORKER_MAX_ATTEMPTS` | 3 | 소진 시 failed 전이 |
| `WORKER_PROVIDER_POLL_INTERVAL_MS` | 5000 | 프로바이더 결과 폴링 주기 |
| `WORKER_PROVIDER_TIMEOUT_MS` | 300000 | 잡당 프로바이더 폴링 데드라인 |
| `WORKER_CANDIDATE_COUNT` | 2 | 컷당 best-of-N 후보 수 |
| `WORKER_DAILY_BUDGET_USD` | (없음) | 설정 시 KST 일일 예산 게이트 |
| `WORKER_JOB_COST_ESTIMATE_USD` | 0.2 | 비용 미보고 프로바이더의 잡당 추정 단가 (기록·예산 계산) |
| `WORKER_CIRCUIT_BREAKER_THRESHOLD` | 5 | 연속 실패 임계치 |
| `WORKER_CIRCUIT_BREAKER_COOLDOWN_MS` | 300000 | 서킷 오픈 시간 |
| `FAL_API_KEY` | (없음) | 미설정 시 로컬 플레이스홀더 프로바이더 (t2i/edit 모두) |
| `FAL_IMAGE_MODEL` | (없음) | 레퍼런스 컨디셔닝(edit) 모델. 예: `fal-ai/nano-banana/edit` |
| `FAL_IMAGE_T2I_MODEL` | (없음) | 콜드스타트 text-to-image 모델. 예: `fal-ai/nano-banana`. 미설정 시 `FAL_IMAGE_MODEL`을 그대로 사용 — edit 전용 모델을 쓴다면 반드시 함께 설정 |
| `S3_BUCKET` 등 기존 S3 변수 | — | 미설정 시 data-URL 저장(개발 전용, 1MB 상한) |
| `LLM_API_URL` / `LLM_API_KEY` / `LLM_MODEL` | (없음) | 기획 플래너. 미설정 시 로컬 결정적 플래너. admin UI(생성 작업 > 프로바이더 설정)의 DB 값이 env보다 우선 |
| `DRAFT_PLAN_LEASE_SECONDS` | 120 | 기획 단계 lease |
| `DRAFT_MAX_ATTEMPTS` | 3 | 기획 재시도 상한 |
| `DRAFT_MAX_SHOTS` | 2 | draft당 컷 수 (상한 3) |
| `DRAFT_SCHEDULER_ENABLED` | true | 포스팅 정책 스케줄러 온오프 |

생성 출력의 스토리지 키는 `pod/generated/character/{characterId}/` 아래에 쌓인다
(기존 업로드 컨벤션 `pod/*`와 동일 트리 — 버킷 정책/수명주기 규칙 공유).

## 미해결 질문 (착수 전 결정 불필요, 해당 Phase 전 결정)

1. credit-policy.md 원가 전제(ComfyUI ₩10-30) — 호스팅 API 단가 기준으로 갱신할지,
   ComfyUI를 병행 어댑터로 도입할지 (Phase 2 전).
2. 자동 게시 시 팔로워 Notification 생성 여부와 주체 (Phase 2 전).
3. 게시물 takedown(숨김/삭제) 경로 — 신고 대응, 이 파이프라인과 무관하게도 필요 (별도 과제).
4. 유저 요청 생성(`image_generate` 크레딧 액션)과의 어댑터 공유 범위 (해당 기능 착수 시).
