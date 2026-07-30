# 06. Architecture

## System Shape

- NestJS 기반 modular monolith다.
- admin API와 worker는 현재 같은 process와 deployment에 둔다.
- PostgreSQL은 OPOD application data와 현재 durable generation queue를
  저장한다.
- admin UI는 같은 repository와 deployment에 둔다.
- 게시글 생성 자동화가 실제로 별도 scale이나 장애 격리를 요구할 때만
  worker/service 분리를 검토한다.

미래 분리를 예상한 범용 abstraction이나 distributed architecture를
미리 만들지 않는다.

## Ownership

- `opod-admin`: 운영자 UI, admin API, 운영자용 moderation/payment/refund/
  credit control, 자동화 추적과 중단
- `opod-service-backend`: public/user API, canonical Prisma schema,
  production migration
- admin은 공유 DB를 직접 조회·변경하지만 schema owner는 아니다.

## Target Backend Module Shape

entity 단위 Nest module 안에 필요한 요소를 함께 둔다.

```text
src/<entity>/
  <entity>.module.ts
  <entity>.controller.ts
  <use-case>.application-service.ts
  <entity>.repository.ts
  dto/
  *.spec.ts
```

모든 파일을 기계적으로 만들지 않는다. entity에 필요한 provider만 둔다.

### Dependency Direction

```text
Controller
  -> Application Service
      -> Entity Repository
      -> Optional Domain Service
      -> External Capability Port
Entity Repository
  -> PrismaService / TransactionHost
External Adapter
  -> Provider SDK or HTTP
```

- controller는 HTTP boundary만 담당한다.
- application service가 use-case flow와 business rule을 처리한다.
- domain service는 재사용되거나 독립적으로 복잡한 rule에만 사용한다.
- repository는 entity 중심이며 모든 DB 접근을 소유한다.
- application service는 repository concrete class를 직접 주입한다.
- external integration만 interface와 Nest token으로 분리한다.
- module 외부 호출은 export된 Nest provider를 통한다.

## Data Access and Transactions

- `PrismaService`는 repository만 사용한다.
- 범용 base repository는 만들지 않는다.
- repository method는 use-case 의도를 드러낸다.
- application service가 transaction boundary를 소유한다.
- Prisma `$transaction`과 `nestjs-cls` `TransactionHost`로 repository가
  동일 transaction client를 공유한다.
- Prisma API, optimistic concurrency, constraint와 Serializable retry를
  Raw SQL보다 우선한다.
- Raw SQL 예외는 repository에 격리하고 필요를 검증한다.

현재 서비스가 Prisma를 직접 호출하는 부분은 목표 구조와의 구현 공백이다.
별도 기능 작업에서 점진적으로 이동하며 project-init에서 대규모
리팩터링하지 않는다.

## API

- target prefix: `/api/admin/v1/*`
- protocol: REST
- realtime: POC 동안 비활성
- request validation: Nest DTO + class-validator/class-transformer
- response: framework-free TypeScript contract
- Prisma model direct response: 금지
- Swagger/OpenAPI: 사용하지 않음

날짜는 UTC ISO 8601, UUID/BigInt ID는 string, 정밀도가 중요한
Decimal/BigInt는 string으로 직렬화한다.

## Frontend

```text
packages/admin/src/
  app/
  features/<feature>/
  shared/
```

- `app`: entry, router, provider와 theme
- `features/<feature>`: screen, component, API, query와 type을 함께 배치
- `shared`: 실제로 여러 feature가 재사용하는 코드만 배치

React Router가 client routing을, TanStack Query가 server state를 담당한다.
HTTP는 `shared/api/apiClient`의 native fetch wrapper를 통해 사용한다.
feature가 endpoint와 contract를 소유하며 UI와 query code가 직접
`fetch`하지 않는다.

Axios 전환은 다음 문제가 여러 feature에서 반복될 때만 검토한다.

- 순서와 조건이 있는 interceptor chain
- 유지하기 어려운 upload/download progress
- Axios 규모의 retry, transform과 error recovery 재구현

endpoint 수 증가, JSON 처리, auth cookie, 일반 오류 정규화, timeout,
cancel 또는 TanStack Query retry만으로는 전환하지 않는다.

## Authentication and Web Security

- 7일 JWT를 `HttpOnly; Secure; SameSite=Strict` cookie에 저장한다.
- server-side token invalidation list는 두지 않는다.
- logout은 cookie를 제거한다.
- cookie 이름은 `__Host-` prefix를 사용한다.
- state-changing request는 exact Origin 검증과 고정 custom header를
  요구한다.
- production CORS는 same-origin만 허용한다.
- GET/HEAD/OPTIONS는 state를 변경하지 않는다.
- signed double-submit token과 별도 CSRF library는 사용하지 않는다.
- Helmet을 전역 적용하고 CSP 세부값은 React 전환 시 실제 asset에 맞춘다.

관리자 password는 비동기 scrypt `N=2^15, r=8, p=3`과 16-byte random
salt를 사용한다. hash에 algorithm과 parameter를 포함하며 legacy hash는
로그인 성공 시 재해시한다. algorithm, parameter, salt와 hash는 하나의
encoded value로 저장한다.

- 최소 8자, 최대 128자
- 문자 종류 조합 규칙 없음
- 공백과 Unicode 허용
- 입력을 `trim()`하거나 조용히 truncate하지 않음
- paste와 password manager 허용
- 유출이 확인되지 않는 한 주기적 변경을 강제하지 않음

로그인 실패는 계정 존재 여부와 무관하게 동일한 `401` 응답을 사용한다.
로그인 성공·실패는 secret 없이 기록한다. IP rate limit, account lockout과
proxy IP 정책은 적용하지 않는다.

## Logging Architecture

DB log는 네 개의 물리 테이블로 분리한다.

- general feature usage
- LLM
- payment/refund
- credit

일반 기능 로그는 failed read와 create/update/delete의 success/failure를
기록한다. request/response는 각각 JSON column으로 저장하고 식별·검색에
필요한 공통 metadata는 별도 column으로 둔다.

LLM 로그는 provider 실제 호출 시도 단위이며 retry와 failure도 별도
기록한다. masked request/response JSON, provider, model, generation job과
token usage JSON을 보존한다. cost field는 두지 않는다.

runtime log는 위 business/audit log와 분리한다.

## Automation Flow

현재 POC:

```text
수동 실행 -> 기획/생성 -> 운영자 승인 -> 게시
```

최종 목표:

```text
자동 또는 수동 실행 -> 기획/생성 -> 자동 게시 -> 추적/중단
```

자동 댓글과 캐릭터 상호작용은 사전 승인 없이 실행 후 추적·중단한다.

## Architecture Decisions

| 결정 | 상태 |
| --- | --- |
| Modular monolith, API+worker 같은 process | decided |
| Entity 중심 module과 repository | decided |
| Application service 중심 business flow | decided |
| Prisma/CLS transaction | decided |
| Concrete repository injection | decided |
| External capability interface/token | decided |
| React/Vite/Mantine frontend | decided |
| REST `/api/admin/v1/*`, no Swagger | decided |
| Shared DB direct access, backend schema ownership | decided |
| Automation 분리는 필요가 확인될 때 검토 | deferred |

## Known Implementation Gaps

- current route와 목표 API prefix가 다르다.
- current auth는 Bearer JWT와 알려진 기본 관리자 생성을 사용한다.
- controller/service에서 Prisma를 직접 사용하는 코드가 남아 있다.
- Swagger package와 bootstrap 설정이 남아 있다.
- frontend는 아직 정적 HTML/CSS/JavaScript다.
- approved log table structure와 token dashboard가 완성되지 않았다.
- 현재 Raw SQL은 queue claim, row/advisory lock에 사용된다.
