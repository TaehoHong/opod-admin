# 03. Deployment Rules

## Runtime

- Node.js 26
- npm과 committed `package-lock.json`
- Local development는 `npm install`, 재현 가능한 검증·배포는 `npm ci`
- API와 worker는 현재 하나의 NestJS process와 deployment로 유지

## Environments

- Local: sibling `opod-service-backend`의 database를 먼저 실행하고
  Prisma client를 생성한 뒤 admin을 시작한다.
- Staging: POC 필수 환경으로 두지 않는다.
- Production: 단일 운영 서버에 Docker image를 수동 배포한다.
- GitHub Actions CI, CI/CD와 자동 rollback은 사용하지 않는다.

## Manual Deployment Flow

1. 변경 위험에 맞는 로컬 검증을 통과한다.
2. schema 변경이 있다면 `opod-service-backend`의 migration을 먼저
   검증하고 배포한다.
3. 명시적인 commit의 build context를 SSH로 운영 서버 Docker daemon에
   전송한다.
4. 운영 서버에서 Linux/amd64 image를 네이티브로 build한다.
5. server-local compose 설정으로 admin service를 재시작한다.
6. 로그인, 주요 화면, DB 연결, media 접근과 worker 상태를 수동으로
   확인한다.

현재 `deploy.sh`는 실행 중인 checkout을 사용하므로 배포 전에 commit과
worktree 상태를 확인한다.

## Local Verification Before Deploy

- UI-only: `npm run admin:check`, `npm run format`
- 일반 API/worker: 관련 focused test, `npm run lint`, `npm run test`,
  `npm run build`
- auth, payment, refund, permission, transaction 또는 API contract:
  관련 focused test와 `npm run test:e2e`
- Prisma mirror: `npm run schema:check`, `npm run db:generate`

모든 변경에 가장 느린 검증을 일괄 적용하지 않는다. 위험이 높은 경계에는
강한 검증을 적용하되 기본 개발 피드백 경로는 빠르게 유지한다.

## Schema Ownership

- production migration은 이 저장소에서 실행하지 않는다.
- migration은 canonical owner인 `opod-service-backend`에서 생성·검증·배포한다.
- admin은 호환 가능한 mirror와 Prisma client를 동기화한다.
- backward compatibility가 필요한 schema rollout은 backend migration,
  admin deploy와 public service deploy 순서를 해당 변경에서 계획한다.

## Secrets

- production secret은 server-local 환경 또는 credential 관리 위치에서
  실행 시 주입한다.
- secret을 repository, Docker image, archive, log 또는 문서에 넣지 않는다.
- 필수 secret 누락과 형식 오류는 startup failure다.
- 유출이 의심되면 즉시 교체한다.
- bootstrap password는 최초 계정 생성 후 운영 환경에서 제거한다.

## First Admin

- 관리자 테이블이 비어 있을 때만 `ADMIN_BOOTSTRAP_EMAIL`과
  `ADMIN_BOOTSTRAP_PASSWORD`로 최초 계정을 생성한다.
- 테이블이 비어 있는데 두 값이 없으면 startup을 실패시킨다.
- 관리자가 이미 있으면 bootstrap 값으로 계정을 추가하거나 password를
  변경하지 않는다.
- 코드에 기본 email/password를 두지 않고 평문 password를 log에 남기지
  않는다.

## Automation State

- 현재 POC에서는 게시글 자동 실행을 비활성화한다.
- 수동 생성 결과는 운영자 승인 후 게시한다.
- 최종 자동화 활성화는 별도 변경으로 배포하며 생성부터 게시까지 자동
  완료하도록 한다.
- realtime은 POC 동안 비활성이다.

## Rollback and Operations

- 이전 image 복구와 database backup 책임은 현재 저장소에서 확인되지
  않은 setup gap이다.
- 자동 rollback이나 down migration이 있다고 가정하지 않는다.
- schema 변경은 app image만 되돌려도 안전한지 배포 전에 확인한다.
- 운영 로그에는 time, level, module과 request/job ID를 포함하고 secret을
  마스킹한다.
