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
