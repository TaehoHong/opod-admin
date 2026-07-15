# 캐릭터 게시글 미디어 자동 생성 파이프라인

Status: 운영 중인 Phase 1·2 구조

이 문서는 캐릭터 게시물의 기획, 이미지 생성, 검수, 게시 파이프라인에서
코드만으로 드러나지 않는 운영 결정을 기록한다. HTTP 계약은
docs/api/admin-generation-jobs.md, docs/api/admin-drafts.md,
docs/api/admin-settings.md를 따른다.

## 범위

- 캐릭터별 포스팅 정책에 따라 초안을 만들고 미디어를 생성한다.
- 모든 결과는 관리자 승인 후 게시한다.
- 운영 콘텐츠 생성 비용은 사용자 크레딧과 분리한다.

    기획 → 프롬프트 컴파일 → 이미지 생성 → 저장 → 검수 → 게시 → 메모리 반영

## 결정

### 워커 배치

- 생성 워커와 초안 워커는 현재 opod-admin 프로세스의 독립 WorkerModule에서
  실행한다.
- 워커 모듈은 admin HTTP 모듈을 역참조하지 않는다.
- 자동 루프는 WORKER_ENABLED로 제어한다. 관리자 수동 실행은 이 설정과
  무관하다.
- admin을 수평 확장하기 전에는 워커를 별도 프로세스로 분리해야 한다.

### 큐와 상태 전이

- PostgreSQL의 generation_jobs가 durable queue다. Redis/BullMQ는 쓰지
  않는다.
- claim은 FOR UPDATE SKIP LOCKED와 lease를 사용한다.
- 상태 전이는 기대 상태를 조건으로 한 원자적 갱신이어야 한다.
- lease가 만료된 running job은 재시도 한도 안에서 queued로 돌린다.
- provider 제출 직후 providerRequestId를 저장해 재시작 시 중복 제출과
  이중 과금을 막는다.
- 자동 재시도는 같은 job의 attempt를 증가시키고, 사람의 재생성은
  originJobId로 연결된 새 job을 만든다.

### 캐릭터 일관성과 provider

- 외모, 스타일, negative prompt는 CharacterVisualProfile에 저장한다.
- 캐릭터별 기준 이미지와 장면 프롬프트를 reference-conditioned 모델에
  전달한다.
- provider 설정은 DB의 관리자 설정을 우선하고 환경 변수를 fallback으로
  사용한다.
- provider의 임시 URL은 영구 저장하지 않는다. 결과를 소유한 스토리지로
  옮기고 Media.uploadedAt을 확정해야 게시할 수 있다.
- 한 cut의 여러 후보는 GenerationJobOutput으로 저장하며, 선택 결과만 최종
  출력으로 연결한다.

### 컨텍스트 선별 — LLM 선별로 시작, 임베딩은 규모 기준 충족 시 전환

- **결정(2026-07-15)**: 레퍼런스·메모리를 "전부 밀어넣기" 하지 않고 장면에
  맞는 것만 선별한다. 선별 방식은 **LLM 선별**로 시작한다 — 기획 LLM 호출에
  레퍼런스 캡션 카탈로그(ID + 서술)를 함께 주고, 출력 스키마를
  `shots: [{scene, referenceIds}]`로 확장해 장면을 만든 모델이 직접 고른다.
  페르소나는 상시 컨텍스트이므로 전부 유지한다.
- **선행 작업(방식 무관 공통)**: 레퍼런스 이미지 캡셔닝 — 승격/업로드 시
  비전 LLM으로 장면·구도·의상·조명 서술을 생성해
  `CharacterVisualProfileReference.description`에 저장(backend 마이그레이션).
  이미지 전달은 S3 접근 정책과 무관하도록 base64로 한다.
- **앵커 슬롯**: 선별 결과와 무관하게 sortOrder 0~1(대표 정면컷)은 항상
  포함한다 — 정체성 고정과 장면 적합성은 다른 역할이다.
- **기각(현 규모)**: 임베딩 + pgvector 정공법. 캐릭터당 레퍼런스 ~12장,
  메모리 수십 개 규모에서는 인프라(확장·컬럼·백필·임베딩 설정) 대비 이득이
  없고, LLM 선별이 추론 기반이라 품질도 낫다.
- **임베딩 하이브리드 전환 기준** — 아래 중 하나라도 충족하면
  "임베딩 1차 축소(top-20) → LLM 최종 선별" 하이브리드로 전환한다.
  **이 기준이 관측되면 어시스턴트는 운영자에게 전환을 강하게 제안할 것.**
  1. 캐릭터당 활성 메모리 > 100개
  2. 캐릭터당 레퍼런스 > 30장
  3. 기획 호출 입력이 상시 10K 토큰을 초과 (카탈로그 비대화)
- 전환 시 설계: pgvector 확장 + `embedding vector(1536)` 컬럼(메모리·레퍼런스),
  쓰기 시점 임베딩(text-embedding-3-small 급), 수동 백필 버튼,
  임베딩 미존재 행은 최신순 폴백.

### 검수와 게시

- 초안은 모든 cut 생성이 성공한 뒤에만 needs_review로 이동한다.
- 일부 cut만 성공한 상태로 게시하지 않는다.
- inactive 캐릭터는 새 초안을 만들거나 승인된 초안을 게시하지 않는다.
- 게시 완료 후 사용한 소재와 설정을 캐릭터 메모리에 반영한다.

## 상태 머신

    PostDraft:
    planned → generating → needs_review → approved → published
                         ↘ failed          ↘ rejected
    needs_review → regenerating → needs_review

    GenerationJob:
    queued → running → completed
           ↖ lease 만료  ↘ failed

## 스키마 소유권

opod-service-backend/prisma/schema.prisma가 canonical schema다.

1. backend schema를 먼저 변경하고 적용한다.
2. admin schema mirror를 동일하게 갱신한다.
3. 양쪽 Prisma client를 다시 생성하고 schema drift를 검사한다.

## 운영 원칙

- 일일 생성 예산, 캐릭터별 생성량, provider 연속 실패를 제한한다.
- 스케줄은 KST로 계산하고 UTC로 저장한다.
- 생성 미디어는 isAiGenerated를 기록한다.
- 잡 실패율, 큐 대기 시간, 생성부터 게시까지의 시간, provider 비용을
  관측한다.
- 반려되거나 선택되지 않은 미디어는 보존 정책에 따라 정리한다.
