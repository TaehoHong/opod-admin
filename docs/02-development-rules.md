# 02. Development Rules

## Current Commands

- Install: `npm install`
- Reproducible install: `npm ci`
- Prisma client: `npm run db:generate`
- Start API and served UI: `npm run start:dev`
- Equivalent development alias: `npm run admin:dev`
- Admin UI check: `npm run admin:check`
- Format: `npm run format`
- Lint: `npm run lint`
- Unit tests: `npm run test`
- Integration/E2E: `npm run test:e2e`
- Schema mirror check: `npm run schema:check`
- Build: `npm run build`

Node.js 26과 npm을 사용한다. `package-lock.json`을 변경 이력에 포함하고
재현 가능한 설치와 배포에서는 `npm ci`를 사용한다.

`npm run test:e2e`는 Testcontainers PostgreSQL과 Docker가 필요하다.
`npm run schema:check`는 기본적으로
`../opod-service-backend/prisma/schema.prisma`와 mirror를 비교한다.

## Decision and Change Policy

- 제품 동작, 보안, 데이터, 비용, 권한, 외부 계약 또는 아키텍처를 크게
  바꾸는 미확정 결정은 사용자에게 한 항목씩 묻는다.
- 명명, 작은 코드 배치, 동일한 동작을 유지하는 구현 세부사항처럼
  되돌릴 수 있는 소규모 결정은 승인된 원칙 안에서 판단하고 진행한다.
- 현재 요청에 필요하지 않은 abstraction, layer, dependency 또는 feature
  flag를 추가하지 않는다.
- 기능별 화면 집계 단위나 재시도 횟수 같은 값은 해당 기능 구현 시 정한다.

## TypeScript and NestJS

- 우선순위는 명시적 project rule, repository config, NestJS 공식 관례,
  일반적인 TypeScript/JavaScript 관례 순이다.
- TypeScript `strict` mode를 유지한다.
- 명시적 `any`는 기본적으로 금지한다. 외부 라이브러리 경계에서 피할 수
  없을 때만 범위를 최소화하고 이유를 남긴다.
- 불확실한 입력은 `unknown`으로 받고 narrowing한다.
- controller는 HTTP 입력, 인증, validation, response 변환만 담당한다.
- 모든 use case는 application service를 거친다.
- application service가 use-case 흐름과 business rule을 함께 처리한다.
- 여러 use case에서 재사용되거나 독립적으로 복잡한 규칙만 domain
  service로 분리한다.
- Nest module 외부에서는 export된 provider를 통해서만 기능을 호출한다.

## Module and Repository Rules

- module은 entity 중심으로 구성한다.
- 모든 DB 접근은 처음부터 해당 entity repository로 분리한다.
- `PrismaService`는 repository에서만 사용한다.
- application service는 repository concrete class를 직접 주입한다.
- `BaseRepository<T>` 같은 범용 CRUD 추상화를 만들지 않는다.
- repository는 실제 use case에 필요한 의도 중심 메서드만 제공한다.
- application service가 Prisma `where`, `include` 또는 transaction client를
  조립해 repository에 넘기지 않는다.
- repository 내부 반환에는 Prisma generated type을 사용할 수 있다.
- HTTP response에는 Prisma model을 직접 반환하지 않는다.
- 외부 API는 provider/gateway 뒤에 두고 application service는 capability
  interface와 Nest injection token에 의존한다.

현재 코드는 이 목표 구조로 완전히 분리되어 있지 않다. 새 기능부터
적용하되 별도 승인 없는 대규모 구조 변경은 하지 않는다.

## Transactions and Concurrency

- application service가 transaction 경계를 소유한다.
- Prisma `$transaction`과 `nestjs-cls`의 `TransactionHost`를 사용해 같은
  use case의 repository가 동일 transaction client를 공유한다.
- 어떤 use case에 transaction이 필요한지는 해당 기능 구현 시 판단한다.
- DB로 표현 가능한 invariant는 constraint로 최종 보장한다.
- 읽기-변경-쓰기 경쟁은 상태/version 기반 optimistic concurrency,
  atomic update, unique idempotency key를 먼저 검토한다.
- 필요한 경우 `Serializable` transaction과 제한된 P2034 retry를 사용한다.

## Prisma and Raw SQL

우선순위:

1. Prisma CRUD, nested write와 atomic update
2. 상태 또는 version 기반 optimistic concurrency
3. unique constraint와 idempotency key
4. `Serializable` transaction과 충돌 retry
5. 위 방식으로 요구사항을 충족할 수 없음이 확인된 경우의 Raw SQL

- Raw SQL은 기본 금지한다.
- 예외는 repository 내부에만 둔다.
- 동시성 또는 성능 필요를 테스트나 실행 계획으로 입증해야 한다.
- 허용된 예외도 parameter binding이 적용되는 tagged template을 사용한다.
- `$queryRawUnsafe`, `$executeRawUnsafe`와 문자열 조합 SQL은 금지한다.
- 다중 worker queue에서 optimistic claim의 충돌이 실제 문제가 될 때
  `FOR UPDATE SKIP LOCKED`를 예외로 검토할 수 있다.

## Schema and Indexes

- canonical Prisma schema와 migration은 `opod-service-backend`에서 먼저
  변경한다.
- 이 저장소는 필요한 mirror와 generated client만 동기화한다.
- `NOT NULL`, foreign key, unique와 값 범위처럼 DB로 표현 가능한
  invariant는 constraint로 보장한다.
- business entity의 기본 PK는 PostgreSQL UUIDv7을 사용한다. 다른 ID가
  필요한 경우 이유를 해당 schema 변경에 기록한다.
- log table의 ID 형식은 각 log schema를 구현할 때 정한다.
- application validation은 이해하기 쉬운 오류를 위한 사전 검증이며
  constraint가 최종 방어선이다.
- index는 실제 filter, join, sort와 실행 계획을 근거로 추가한다.
- 모든 foreign key나 미래 조회를 예상해 index를 일괄 추가하지 않는다.
- 성능 문제는 `EXPLAIN ANALYZE`로 확인하고 중복·미사용 index를 제거한다.

## API and Serialization

- 승인된 admin API 경로는 `/api/admin/v1/*`다.
- Prisma model을 직접 반환하지 않고 controller 경계에서 명시적인
  TypeScript response contract로 변환한다.
- 별도 mapper class는 변환이 실제로 반복될 때만 만든다.
- 날짜·시간은 UTC ISO 8601 문자열로 전달한다.
- UUID와 BigInt ID는 문자열로 전달한다.
- `Decimal`과 정밀도가 중요한 BigInt 값은 문자열로 전달한다.
- 안전 범위의 일반 count와 page 값은 JSON number를 사용한다.
- Swagger/OpenAPI와 generated API client는 사용하지 않는다.
- Nest DTO class는 서버 validation에 사용하고 UI와 공유하지 않는다.
- framework에 의존하지 않는 순수 TypeScript request/response contract를
  같은 repository에서 공유한다.

## Validation, Errors, Config and Logs

- `class-validator`, `class-transformer`와 global `ValidationPipe`를
  사용한다.
- DTO에 없는 필드는 오류 없이 제거한다.
- API 오류는 Nest 기본 응답 구조를 유지하고 UI가 공통 형식으로
  정규화한다.
- 일반 코드에서 `process.env`를 직접 읽지 않고 typed Config provider를
  주입한다.
- 필수 설정 누락이나 잘못된 형식은 startup failure로 처리한다.
- runtime log와 DB business/audit log는 분리한다.
- runtime log는 local/production 모두 읽기 쉬운 text 형식을 사용하고
  time, level, module, request/job ID를 포함한다.
- POC에서는 Nest Logger를 사용한다.

## Secret Handling

- DB URL, JWT secret, provider API key와 bootstrap password는 환경변수로만
  주입한다.
- `.env`와 실제 credential을 source, docs, plan, report 또는 log에
  기록하지 않는다.
- `.env.example`에는 변수명과 설명만 둔다.
- secret은 Docker image에 포함하지 않고 실행 시 주입한다.
- password, JWT, session, API key, cookie와 결제 인증정보는 반드시
  마스킹한다.

## Review

- 관련 없는 사용자 변경을 되돌리거나 정리하지 않는다.
- module ownership, dependency rule, canonical example, test 위치 또는
  verification command가 바뀌면 `docs/07-codebase-guide.md`를 갱신한다.
- product code와 문서가 다르면 현재 동작을 사실로 보고 문서는 목표 또는
  구현 공백으로 명확히 표시한다.
