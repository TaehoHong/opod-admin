# 03. Deployment Rules

## Runtime

- Node.js 26
- npm과 committed `package-lock.json`
- Local development는 `npm install`, 재현 가능한 검증·배포는 `npm ci`
- API와 worker는 현재 하나의 NestJS process와 deployment로 유지

## Environments

- Local: sibling `opod-service-backend`의 database를 먼저 실행하고 admin을
  시작한다.
- Staging: POC 필수 환경으로 두지 않는다.
- 개발 서버: backend와 같은 `dev-run-taeho`에 Docker image를 수동 배포한다.
- 운영 환경은 아직 없다. DB 환경 용어는 backend의 개발 규칙을 따른다.
- GitHub Actions CI, CI/CD와 자동 rollback은 사용하지 않는다.

## Manual Deployment Flow

1. 변경 위험에 맞는 로컬 검증을 통과한다.
2. schema 변경이 있다면 `opod-service-backend`의 migration을 먼저
   검증하고 배포한다.
3. 명시적인 commit의 build context를 SSH로 개발 서버 Docker daemon에
   전송한다.
4. 개발 서버에서 Linux/amd64 image를 네이티브로 build한다.
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
- Drizzle schema mirror: `npm run schema:check`, `npm run build`

모든 변경에 가장 느린 검증을 일괄 적용하지 않는다. 위험이 높은 경계에는
강한 검증을 적용하되 기본 개발 피드백 경로는 빠르게 유지한다.

## Schema Ownership

- 공유 DB migration은 이 저장소에서 실행하지 않는다.
- migration은 canonical owner인 `opod-service-backend`에서 생성·검증·배포한다.
- admin은 canonical과 동일한 Drizzle `schema.ts` mirror를 동기화한다.
- backward compatibility가 필요한 schema rollout은 backend migration,
  admin deploy와 public service deploy 순서를 해당 변경에서 계획한다.

## Secrets

- 배포 secret은 server-local 환경 또는 credential 관리 위치에서
  실행 시 주입한다.
- secret을 repository, Docker image, archive, log 또는 문서에 넣지 않는다.
- 필수 secret 누락과 형식 오류는 startup failure다.
- 유출이 의심되면 즉시 교체한다.
- bootstrap password는 최초 계정 생성 후 배포 환경에서 제거한다.
- 2026-07-21 결정으로 `admin_settings`의 API 키는 애플리케이션의 at-rest
  암호화 없이 저장한다. DB 접근 통제, 응답의 설정 여부/끝 4자리 마스킹,
  `console_logs` 변경 이력이 현재 방어선이다. DB 접근 주체 증가,
  침해 사고 또는 새 컴플라이언스 요구 시 암호화 결정을 재검토한다.
- 당시 권고된 운영 DB 비밀번호 교체의 이행 여부는 문서와 현재 코드만으로
  확인되지 않는다. 이 기록을 현재 유출이나 교체 완료의 증거로 사용하지 않는다.

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

- 배포 전에 실행 commit·이전 image tag·DB backup 위치와 검증 결과를 기록한다.
  변경에 DDL 또는 데이터 이전이 있으면 app image 복구와 데이터 복구를 분리한다.
- DB backup은 서버 내부에서 `pg_restore --list`로 읽을 수 있는지 확인한다.
  이것이 전체 복원 리허설이나 정기 backup 체계 구축을 뜻하지는 않는다.
- 콘텐츠 프로필 분리 후 옛 admin image만 되돌리면 `never_prompt`로 옮긴 제작
  지침을 legacy 코드가 읽지 못할 수 있다. image 전환만을 전체 복구로 보지 않는다.
  현재 데이터와 backup을 비교하고 소유 Service를 통해 필요한 라우팅을 복구한다.
  공유 DB 전체 복원·테이블 삭제·down migration을 자동 실행하지 않는다.
- 자동 rollback과 정기 backup/restore 운영 체계는 여전히 별도 정비 대상이다.

### 2026-09-28 전체 개발 배포 기록

당일 검증된 실행 버전이며 현재 서버 상태를 새로 확인한 결과는 아니다. 이전
기능별 legacy 배포를 대체한 기록을 이 절에 병합했다.

| 대상 | 당시 실행 commit | image tag |
| --- | --- | --- |
| backend | `7cd7c4bf63a30ee39ca3db66a81b3c8b63ecbdcb` | `opod-service-backend:full-7cd7c4b` |
| admin API·worker·UI | `cb11be47c880c3933e83d675f2df3944d45b8210` | `opod-admin:full-cb11be4` |
| Agent API·web·Qwen embedding | `a348b799ab94b24b275f5f9544faf8215955b07a` | 각 image의 `full-a348b79` |

- DB backup: `/home/taeho/opod-backend/backups/pre-all-services-20260928.dump`.
  당시 `pg_restore --list`로 검증했고 로컬로 복사하지 않았다.
- 다섯 image의 이전 보존 tag: 각 image 이름의 `before-all-services-20260928`.
- 권도건·서린·한소이의 제작 지침을 별도 프로필로 이전하고 원문·Canon 연결을
  유지했다. 해나의 프로필을 보존했고 나희·유하의 별도 설정은 빈 상태로 유지했다.
  원문·구조 해시는 서버 내부에서 비교했고 변경은 기존 소유 Service와 감사
  이력으로 처리했다.
- 해나의 Canon 연결 조각은 중복 사실만 `never_prompt`로 분리했다. 추가 성격·
  취향은 retrieved로 남겼으며 behavior/lore 조각의 schema version 표기를
  지원되는 v1로 정정했다. 이를 공통 검사 우회나 캐릭터 전용 runtime 예외로
  구현하지 않았다.
- 실제 DB reader/router와 세 단계의 설정 전달, 기동·health를 검증한 기록이다.
  유료 이미지/캡션 생성 품질 비교·게시 결과를 검증한 기록은 아니다.
- 상세 당시 테스트 숫자·일회성 실패·원문은 외부 보관함의
  [당시 전체 배포 기록](../../../opod-evaluation-archive/2026-09-29-cleanup-recovery/documents/opod-admin/docs/full-development-deployment-2026-09-28.md)에 보존한다.

### 공통 운영 기록

- 운영 로그에는 time, level, module과 request/job ID를 포함하고 secret을
  마스킹한다.


### 2026-10-19 레퍼런스 Agent·수집 라이브러리 main 배포

- 사용자 승인으로 기존 개발 브랜치 전체를 두 저장소의 main에 fast-forward 병합하고 푸시했다.
- Admin 실행 코드: `aa5662c`, 이미지 `opod-admin:release-aa5662c`.
- Backend 실행 코드: `668e3fb`, 이미지 `opod-service-backend:release-668e3fb`.
- 개발 DB에는 정본 `20261019060222_orange_warlock`의 nullable `source_caption text`만 추가했다. 기존 migration 해시와 대기 목록을 대조한 뒤 Backend 정본 runner로 적용하고 migration 이력을 기록했다. 컬럼 타입·nullable·기본값 없음 확인을 통과했다.
- 사용자가 명시적으로 백업 생략을 지시하여 이번 DB 백업은 수행하지 않았다. DB 컨테이너를 재시작하거나 기존 데이터를 덮어쓰지 않았다.
- 최종 서버 단위 테스트 77 suites/863 tests, UI 30 files/142 tests, build/lint/format/schema:check 통과. Backend build 통과. 실제 DB 동시성 E2E와 유료 생성은 실행하지 않았다.
- 교체 후 Admin health는 `status=ok,database=up`, Backend health는 `status=ok`를 반환했다. 기존 로그인 세션으로 수집 미디어 목록과 레퍼런스 Agent 설정을 확인했다. 신규 Agent 설정은 모델·지침을 명시 저장하기 전 상태로 유지했다.
- 배포 확인에서 선택 starter에 테이블 구조가 들어간 오류를 찾아 승인된 1단계 프롬프트 원문으로 복구했다. starter HTTP 회귀는 이전 값에서 실패하고 수정값에서 통과했다. 최종 서버 화면에서도 역할·1~3장·반복 허용 지침을 확인했다.
- 실행 이미지의 코드 commit은 위 값이며 이후 배포 기록 문서 커밋과 구분한다.


### 2026-10-19 원본별 캐릭터 비주얼 배정

- Admin 실행 커밋 `339572b`, 이미지 `opod-admin:reference-composition-339572b`, 시작 시각 09:10:06 UTC.
- Backend 정본 `0ac8251`의 `20261019084411_deep_ken_ellis`를 정본 runner로 개발 DB에 적용했다. nullable composition_analysis JSONB 컬럼 하나이며 기존 description을 보존한다. Backend 앱 이미지는 교체하지 않았다.
- 적용 전 영향 테이블 백업은 `/home/taeho/opod-backend/backups/pre-person-composition-20261019.dump`에 보관하고 목록 읽기를 확인했다.
- 실제 분석·재색인 작업으로 활성 비주얼 35/35를 준비했다. 별도 SNS 수집이 병행되어 최종 조회 시 38/38이 person-composition-v1이고 임베딩 미완료는 0이었다. 비주얼 설명 해시도 보존됐다. 이는 해당 시점 조회 결과다.
- 기존 임베딩 컬럼을 공통 촬영 분석 텍스트로 재색인했다. 원본 선택 이후 컷별 벡터 후보와 비전 선택으로 사용할 비주얼만 고정하며, 이후 프롬프트·생성은 같은 조합을 쓴다.
- 타입 검사·lint·format·build·schema mirror 검사, DB metadata와 API 상태 조회를 통과했다. 사용자 지시로 테스트·실제 게시물 단계 실행·이미지 생성은 하지 않았다.


### 2026-10-20 레퍼런스 생성 후 상세 조회 오류 수정

- Admin 코드 `aca0157`, 이미지 `opod-admin:fix-aca0157`을 main 푸시 후 개발 배포했다.
- 원인: 생성 worker가 논리 참조 이름을 `_shot.execution.referenceMediaIds`에 기록하고 상세 조회가 이를 media UUID로 조회했다. 기존 서버의 실제 Domain Service에서 SQLSTATE `22P02`를 재현했다.
- 신규 실행은 논리 `referenceIds`와 실제 UUID `referenceMediaIds`를 구분한다. reference 상세는 전용 artifact를 사용해 과거 기록도 읽는다. 기존 자연형 Agent 경로는 유지한다.
- 실제 실패 초안을 같은 Domain Service로 읽기 전용 재조회해 완료 결과 1개·선택 결과 1개와 참조 이름 보존을 확인했다. 이미지 재생성·DB 행 수정·DDL은 수행하지 않았다.
- 서버 77 suites/866 tests, build/lint/format 통과. 두 회귀 테스트 묶음은 수정 전의 실제 실패 조건을 재현하고 수정 후 통과했다. 생성 공급자는 테스트 대역이며 실제 유료 생성은 실행하지 않았다.
- Sol 6.1 subagent가 worker 기록과 회귀 테스트를 구현했고 메인 에이전트가 상세 조회·통합 검증·배포·실제 조회를 확인했다. health는 `status=ok,database=up`이었다.

### 2026-10-20 레퍼런스 이미지 프롬프트 재구성 지침 적용

- 실행 코드 `a4930ec9b386e45c0fe6fd18b4a28d6540494645`, 이미지 `opod-admin:reference-v2-a4930ec`를 해당 커밋의 archive에서 빌드해 개발서버 Admin에 적용했다. 이전 이미지는 `opod-admin:before-reference-v2-a4930ec`로 보존했다.
- 원본의 장소·옷차림의 시각적 성격을 관찰하고 공간·의상·소품을 재구성하는 지침을 starter와 저장된 reference image_prompt에 반영했다. 관찰 상태를 요청에 없는 노출 제한 등으로 확대하지 않는다.
- 저장은 `GenerationSettingsService.saveReferenceAgentSettings`의 revision CAS를 사용했다. 변경 후 설정 revision은 `28b1c27c-5a90-47b0-af49-28e3390c6035`, systemPrompt SHA-256은 `ffefe53d8c18a2baab46e8b579df555415ffcf1c9533d795800c48be2ad2914a`다. 다른 단계·모델·schema·선택 설정과 자연형 설정의 보존을 읽기 검증했다.
- 선택된 캐릭터 참조를 먼저, 원본을 마지막으로 전달한다. 얼굴과 체형 모두를 강제하지 않으며 얼굴→원본, 체형→원본, 얼굴·체형→원본, 인물 비노출 원본 전용을 지원한다. 기존 frozen 작업의 순서는 그대로 유지한다. 저장 설정은 새 초안에 고정되며 기존 초안 설정을 일괄 변경하지 않았다.
- 최종 77 suites/873 tests, lint/format/build 통과. 배포된 입력 검증에서도 네 조합과 기존 원본 우선 입력을 확인했고 health는 `status=ok,database=up`이었다. 생성 공급자 호출은 테스트 대역으로 검증했으며 배포 후 유료 생성·게시는 실행하지 않았다.
- 설정 변경 전후와 검증 영수증은 로컬 `content-work/reference-agent-v2-deployment-20261020/`에 회수했다. DB schema와 캐릭터 데이터는 변경하지 않았다.

### 2026-10-20 원본 선택 ID 전용 출력과 저장 지침 적용

- 실행 코드 `55240c4fe2c11cadb5279ae6a3d38909e3e156a6`, 이미지 `opod-admin:source-selection-55240c4`를 커밋 archive에서 빌드해 개발서버 Admin에 적용했다. 직전 `3b92362` 이미지도 `opod-admin:before-source-selection-55240c4`로 보존했다.
- 사용자 확정 원문을 reference_select의 starter와 개발 DB 저장 지침에 적용했다. 성공은 `selections[{mediaId}]`만 반환하고, 선택 불가는 빈 selections와 shortfallReason을 요구한다. 새 원본 shot에는 선택 이유를 저장하지 않는다. 과거 reason 포함 응답·저장 shot의 표시 호환과 캐릭터 비주얼 배정 이유는 유지했다.
- `GenerationSettingsService`의 revision CAS로 systemPrompt와 outputSchema만 교체했다. 저장 revision `097ef2dd-b21f-4dd1-a055-569be24e05c9`, 지침 SHA-256 `d83fa303bc25ecafbf67e85153f3a8f31d72b074d617cd0eb20e9fa863c83566`이다. controller의 current/starters 일치, ID 전용 parser 실행, 다른 단계·모델·자연형·자동화 설정 보존을 읽기 검증했다. 새 초안부터 적용하며 기존 초안을 일괄 갱신하지 않았다.
- 단위 77 suites/874 tests, 관련 실제 PostgreSQL E2E 7 tests, 원본 결과 UI 25 tests, 타입 검사·lint·format·build를 통과했다. E2E의 LLM 전송은 테스트 대역이다. 전체 admin:check는 수정하지 않은 ReferenceAgentPanel.test.tsx의 기존 저장 안내 문구/이미지 모델 fixture 불일치 2건으로 실패했다(146 passed/2 failed). 해당 파일만 실행해도 재현되며 범위 밖 테스트·화면은 수정하지 않았다.
- health `status=ok,database=up`, 재시작 횟수 0을 확인했다. 배포 후 유료 생성·게시·DB schema 변경은 하지 않았다. 설정 전후 백업과 검증 영수증은 `content-work/source-selection-deployment-20261020/`에 회수했다.

### 2026-10-20 이미지 프롬프트 중복 첨부·60초 타임아웃 수정

- 코드 커밋 `324746c`(사진 중복 제거), `f54814e`(구조화 LLM 타임아웃 제거)를 main에 푸시했다. 실행 커밋 `f54814ec53520ce02144dcbffca5a2891f9ccdd1`의 Git archive로 Linux/amd64 이미지 `opod-admin:image-dedup-f54814e`를 빌드하고 개발 Admin에 적용했다.
- 17:04 KST 기동 후 이미지 revision 일치, 재시작 횟수 0, health `status=ok,database=up`을 확인했다. 직전 이미지는 `opod-admin:before-image-dedup-f54814e`로 보존했다.
- 로컬 단위 77 suites/876 tests, lint·format·build 통과. 배포된 Node.js 26.7.0 코드에서 합성 픽셀과 테스트 공급자로 3컷의 참조 9개가 이미지 5장으로 전송되고, 컷별 매핑·생성용 이미지 번호 유지 및 LLM 요청의 timeout signal 제거를 확인했다.
- 원본 실패 로그 2490과 이전 2489는 같은 초안의 이미지 프롬프트 단계에서 각각 60.054초·60.056초에 애플리케이션의 60초 중단으로 실패했다. 공급자 내부 지연 원인과 실제 LLM 결과 품질은 이번 검증 범위에 포함하지 않는다. 유료 생성·게시·DB schema/저장 설정 변경은 수행하지 않았다.


### 2026-10-21 게시물별 SpicyAPI 프롬프트 확장 스위치

- 코드 `e566dfa`를 main에 푸시하고 해당 Git archive로 빌드한 `opod-admin:prompt-expansion-e566dfa`를 개발 Admin에 배포했다. 실행 revision 일치, 재시작 횟수 0, health `status=ok,database=up`을 확인했다.
- 레퍼런스 Agent 이미지 생성 단계의 SpicyAPI Qwen 스위치는 기본 ON이다. 최초 생성·전체 재생성의 모든 컷에 선택값을 고정하며 기존 작업 재개·실패 컷 단순 재시도는 저장된 입력을 유지한다. Seedream과 전역 설정은 변경하지 않았다.
- Sol 6.1 subagent가 UI와 초안 API/저장을 구현했고 메인이 공급자 요청·독립 검토·통합 검증·배포를 수행했다. 기존 작업 재개 시 옵션을 생략하는 회귀도 포함했다.
- 서버 78 suites/899 tests, 최종 관련 UI 32 tests, build/lint/format을 통과했다. 전체 admin:check는 이번 변경과 무관한 ReferenceAgentPanel.test.tsx의 기존 저장 안내 문구 검증 2건으로 실패했고, 해당 파일 단독 실행에서도 재현했다. 범위 밖 테스트는 수정하지 않았다.
- 배포 코드에서 ON/OFF·값 없는 이전 입력의 기본 ON·Seedream 필드 생략을 검증했다. 실제 유료 생성·게시·DB schema 변경은 하지 않았다. 실제 DB 동시성 E2E는 로컬 Docker 중단 상태로 보류했다. Mac 잠금으로 배포 후 브라우저 시각 검증은 수행하지 못했다.

### 2026-10-22 요청 문구 없는 레퍼런스 캡션 저장 오류 수정

- 코드 `a4f3e93`을 main에 푸시하고 `opod-admin:caption-canonical-a4f3e93`로 개발 Admin에 배포했다. 실행 revision 일치, 재시작 횟수 0, health `status=ok,database=up`을 확인했다.
- 요청 문구가 없는 초안에 runner가 `operatorRequest: undefined`를 넣어 정상 캡션 응답 뒤 inputHash 계산이 실패했다. 선택 필드를 생략하도록 수정하고 canonicalJsonHash의 엄격한 검증은 유지했다. 요청 문구 유무별 회귀 테스트로 수정 전 실패·수정 후 성공을 확인했다.
- 서버 78 suites/901 tests와 lint/format/build를 통과했다. 로컬 포트 사용 제한으로 실패한 HTTP 테스트는 권한 확보 후 같은 명령으로 전체 통과했다. 기존 실패 초안과 성공 로그 2549를 배포된 runner·공용 LLM 파서로 재생해 캡션 artifact 조립과 해시 계산을 확인했다. 외부 호출·저장은 테스트 대역으로 차단했으며 기존 실패 초안은 변경하지 않았다.
- 기본 빌드의 npm audit 외부 조회가 지연되어 해당 임시 빌드만 중단했다. 동일 커밋 archive의 임시 Dockerfile에서 prune에 `--offline --no-audit --no-fund`만 추가해 설치된 의존성을 정리했다. 앱 빌드는 같은 캐시 레이어를 사용했고 저장소 Dockerfile·의존성 버전·DB schema는 변경하지 않았다. 유료 생성·게시는 실행하지 않았다.

### 2026-10-22 원본의 일상 맥락을 활용하는 캡션 지침 적용

- 사용자 승인 지침을 `prompts/reference-caption.ts`와 운영 reference caption 설정에 동일하게 적용했다. 설정 CAS revision은 `5b33f940-fc5b-4f23-94c0-6833e407bf53`, 지침 SHA-256은 `52d9a4263f986324d9c3c90916972cbf531578489c2686466891a7d1e5691378`이다. 선택·이미지 프롬프트·이미지 생성 설정·캡션 모델·schema는 보존했다.
- `CaptionWriterAgent`와 저장된 gpt-6.1-sol 설정으로 서린 초안 `01a15d42-de31-742e-aa28-c79cd8dd553d`의 기존 입력·이미지 2장만 사용해 캡션을 재생성했다. 성공 로그는 `2551`이며 원본 캡션과 새 지침의 실제 전달을 확인했다. 새 결과는 기존 `DraftsService.updateDraft` 편집 경로로 저장하고 새 로그 ID·설정 revision을 액션 로그 사유에 기록했다. 기존 frozen captionBuild는 이전 실행 기록으로 보존했다. 게시·이미지 재생성은 하지 않았다.
- 코드 `e0f57d0`을 main에 푸시하고 `opod-admin:casual-caption-e0f57d0`로 개발 Admin에 배포했다. 이전과 같은 임시 오프라인 prune 옵션을 사용했으며 저장소 Dockerfile은 변경하지 않았다. 실행 revision 일치, 재시작 0, health `status=ok,database=up`과 기본 지침·운영 지침·로그 2551의 system 입력 일치를 검증했다.
- 기존 서버 78 suites/901 tests와 lint/format/build를 통과했다. 단순 지침 문구 일치를 고정하는 새 테스트는 추가하지 않았다. 저장된 새 캡션과 needs_review 상태, 기존 잡·선택 미디어 ID 2개의 보존을 재조회했다. 실제 캡션 품질은 생성한 원문으로 사용자가 검토한다.
