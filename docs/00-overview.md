# 00. Project Overview

## 한 줄 정의

`opod-admin`은 OPOD 내부 운영자가 자동 생성 게시물, 댓글, 캐릭터 간
상호작용, 사용자·신고, 결제·환불·크레딧, 생성 비용과 실행 이력을
추적하고 제어하는 운영자 전용 콘솔이다.

## 대상 사용자와 권한

- 사용자는 OPOD 내부 운영자다.
- 첫 버전은 단일 관리자 역할만 사용한다.
- 공개 사용자용 API와 사용자 클라이언트는 이 저장소의 범위가 아니다.
- 신고 처리, 사용자 정지·해제, 콘텐츠 숨김·삭제, 환불 시작과 운영자용
  결제·크레딧 제어 화면은 이 저장소가 소유한다.
- canonical DB schema와 production migration은 `opod-service-backend`가
  소유한다.

## 현재 목표

현재 단계는 POC이며 게시글 생성 agent의 결과 품질을 높이는 것이
최우선이다.

- 게시글 자동 생성은 현재 의도적으로 꺼져 있다.
- 운영자는 게시글 생성을 수동으로 실행할 수 있다.
- 튜닝 단계에서는 생성 결과를 운영자가 승인한 뒤 게시한다.
- 최종 운영 단계에서는 자동 실행이 기본이며 생성부터 게시까지 자동으로
  완료한다. 수동 실행도 계속 지원한다.
- 자동 댓글과 캐릭터 간 상호작용은 사전 승인 없이 실행하고, 운영자는
  결과와 실패를 추적하고 필요할 때 중단한다.
- 현재 존재하는 관리자 기능 영역은 유지한다.

자동 게시로 전환하는 구체 조건과 화면별 세부 흐름은 자동화를 실제로
활성화하는 기능 작업에서 정한다.

## 제품 원칙

1. 운영자는 자동화의 현재 상태, 결과, 실패 이유와 비용을 확인할 수 있어야
   한다.
2. 자동 실행은 추적할 수 있어야 하고 운영자가 중단할 수 있어야 한다.
3. 권한, 결제, 환불, 크레딧과 데이터 무결성에 영향을 주는 작업은 사유와
   감사 가능한 결과를 남긴다.
4. POC에서는 실제 문제를 해결하는 가장 작은 유지보수 가능한 변경을
   우선하고 미래 요구를 위한 추상화를 미리 만들지 않는다.

## 제품 범위

포함:

- 관리자 인증과 계정 관리
- 캐릭터, 페르소나, 메모리, 비주얼 프로필과 포스팅 정책
- 게시글, 스토리, 댓글, 반응과 사용자 조회
- 게시글 기획, 미디어 생성, 후보 선택, 승인과 게시
- 자동 댓글·캐릭터 상호작용의 실행 이력과 중단
- 신고 처리, 사용자 정지·해제, 콘텐츠 숨김·삭제
- 결제 조회·조정, 환불 시작, 크레딧 지급과 원장 조회
- 공급자 설정, 운영 로그, LLM 로그와 토큰 사용량 대시보드

명시적 비범위 또는 보류:

- 공개 또는 사용자용 API
- 이 저장소에서의 canonical migration 실행
- POC 중 realtime 기능
- 사용자 계정 영구 삭제
- 관리자 역할 세분화
- 네이티브 모바일 앱
- GitHub Actions CI와 브라우저 E2E
- 공급자 범용 plugin layer
- 자동화 worker의 선제적 분리

## 데이터와 보존

- admin 기능은 별도 service API를 우회하지 않고 승인된 범위에서 공유
  PostgreSQL을 직접 변경한다.
- 생성 데이터는 현재 영구 보존한다. 보존 기간은 추후 다시 결정한다.
- LLM 요청·응답 원문은 비밀정보를 마스킹한 뒤 영구 보존한다.
- 게시글·댓글·상호작용의 관리자 삭제는 물리 삭제가 아니라 숨김 또는
  삭제 상태 전환이다.
- 사용자 영구 삭제는 정책을 별도로 정하기 전까지 구현하지 않는다.
- 결제·환불·크레딧·운영·LLM 로그는 물리 삭제하지 않는다.

로그는 다음 네 개의 물리 테이블로 분리하는 것이 승인된 목표다.

1. 일반 기능 사용 로그
2. LLM 로그
3. 결제·환불 로그
4. 크레딧 로그

일반 기능 로그는 실패한 조회와 생성·수정·삭제의 성공·실패를 기록한다.
요청과 응답은 JSON으로 저장하되 password, JWT, session, API key, cookie와
결제 인증정보를 마스킹한다. LLM 로그는 provider의 실제 호출 시도 단위로
요청·응답 원문, provider, model, 생성 job 연결과 토큰 사용량을 기록한다.

## 토큰 사용량

첫 대시보드는 최근 30일을 기본 기간으로 사용하며 다음을 제공한다.

- 기간 합계와 추이
- provider별 집계
- model별 집계

호출별 사용량은 LLM 로그에서 확인하므로 별도 호출 목록은 만들지 않는다.
차트 집계 간격 같은 화면 세부사항은 구현할 때 정한다.

## 현재 구현과 승인된 목표

| 영역        | 현재 저장소 사실                                                           | 승인된 목표                                                  |
| ----------- | -------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Backend     | NestJS 10, Prisma, API와 worker가 한 process                               | modular monolith 유지, entity 중심 module과 repository 적용  |
| Admin API   | controller가 `/api/admin/v1/*` 아래에 있고 Swagger/OpenAPI는 제거됨        | `/api/admin/v1/*`, Swagger/OpenAPI 미사용                    |
| Auth        | 7일 `__Host-` HttpOnly cookie JWT, 최초 계정은 bootstrap 환경변수로만 생성 | 7일 HttpOnly cookie JWT, bootstrap 환경변수로 최초 계정 생성 |
| Admin UI    | `packages/admin`의 정적 HTML/CSS/JavaScript                                | React, TypeScript, Vite, Mantine                             |
| 게시 자동화 | worker와 수동 승인 흐름이 있으며 자동 실행은 꺼짐                          | 튜닝 중 승인 게시, 최종 단계는 생성부터 게시까지 자동 완료   |
| DB schema   | 이 저장소에 Prisma mirror가 있음                                           | canonical 변경은 backend에서 먼저 수행하고 mirror 동기화     |

목표 구조는 project-init에서 제품 코드로 구현하지 않는다. 각 변경은 별도
기능 또는 리팩터링 작업에서 현재 동작과 migration 위험을 확인한 뒤
진행한다.

## 필수 결정 영역

| 영역                           | 상태             | 결정                                                             |
| ------------------------------ | ---------------- | ---------------------------------------------------------------- |
| Product actors and permissions | decided          | 내부 운영자, 단일 관리자 역할                                    |
| Auth/session model             | decided          | 7일 cookie JWT, 서버 측 logout 무효화 없음, 명시적 bootstrap     |
| Core workflows                 | decided          | 현재 기능 영역 유지, 게시 자동·수동 실행 지원                    |
| API/realtime                   | decided/deferred | REST `/api/admin/v1/*`; realtime은 POC 동안 비활성               |
| Data ownership/lifecycle       | decided          | backend canonical schema, admin direct DB access, 현재 영구 보존 |
| Privacy/security               | decided          | 마스킹된 원문 로그, secret 실행 시 주입                          |
| Moderation/safety              | decided          | 제재와 논리 삭제는 admin, 사용자 영구 삭제 보류                  |
| Payments/credits               | decided          | 환불은 admin에서 시작, 원장 직접 변경 금지                       |
| Background automation          | decided          | 현재 승인 게시, 최종 자동 게시, 상호작용 추적·중단               |
| External providers             | deferred         | 현재 provider 유지, fal 변경 가능성은 추후 판단                  |
| Deployment/operations          | decided          | 단일 서버 수동 Docker 배포                                       |
| Verification                   | decided          | 빠른 로컬 검증, 의미 있는 테스트, CI·브라우저 E2E 없음           |

## 온보딩

작업을 시작할 때 `AGENTS.md`와 `docs/07-codebase-guide.md`를 먼저 읽는다.
코드베이스 가이드의 현재 구현 증거와 이 문서의 승인된 목표가 다르면,
현재 동작을 보존하면서 목표로 이동하는 별도 작업으로 계획한다.

## 문서 색인

- [01-roadmap.md](./01-roadmap.md)
- [02-development-rules.md](./02-development-rules.md)
- [03-deployment-rules.md](./03-deployment-rules.md)
- [04-design-rules.md](./04-design-rules.md)
- [05-quality-rules.md](./05-quality-rules.md)
- [06-architecture.md](./06-architecture.md)
- [07-codebase-guide.md](./07-codebase-guide.md)
