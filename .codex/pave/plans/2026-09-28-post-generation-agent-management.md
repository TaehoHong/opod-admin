# 게시물 Agent 관리 — 현재 설계

상태: 2026-09-28 구현·DDL 작성 및 검증 완료; 병합 전 사람의 검토 필요. 최신 결정이 이전 제안 전체를 대체한다.
코드·테스트·DDL 작성 완료. 검증 결과를 아래에 기록한다.

## 현재 결정

- user-confirmed: 테이블은 ai_models, post_agent_prompts 두 개다.
- user-confirmed: 모든 PK는 BIGINT 자동 증가다. API/JSON에서는 decimal string으로 전달한다.
- user-confirmed: 모델 구분 컬럼은 type ENUM(llm, image), name은 제거한다.
- user-confirmed: provider는 명시적 TEXT으로 저장하고 모델명으로 추정하지 않는다. provider 타입은 TEXT NOT NULL이며 공백을 금지한다.
- user-confirmed: post_agent_prompts는 ai_model_id 하나를 NOT NULL FK로 참조하고 model TEXT NULL override를 추가한다.
  provider 및 llm_model_config_id/image_model_config_id는 저장하지 않는다.
- user-confirmed: base_prompt_version/contract_version/change_note/복원 원본/관리자 ID·이메일은 저장하지 않는다.
- user-confirmed 조건 및 repo-evidenced: 실제 LLM 입력이 되는 output_schema JSONB를 저장한다.
  StrictJsonAgentClient는 이를 response_format.json_schema.schema에 전송한다.
- user-confirmed: model이 있으면 override, NULL이면 ai_models.model을 사용하며 provider는 ai_models.provider다.
- agent-assumed: 네 LLM 단계와 generation을 stage로 구분한다.
  image_prompt의 LLM은 해당 행, 목표 이미지 모델은 generation 행에서 해석한다.
- repo-evidenced: DDL 정본은 backend, Admin은 schema mirror 및 관리/worker 코드 소유다.
- repo-evidenced: docs/04-design-rules.md, app/theme.ts, DataPage와 기존 Mantine 폼을 사용한다.
- approved implementation: 참조되는 모델의 실행 값 변경은 새 모델 행 등록/선택으로 처리해 과거 복원값을 보존한다.

## ai_models

| 컬럼 | 정의 |
| --- | --- |
| id | BIGINT 자동 증가 PK |
| type | ai_model_type ENUM(llm, image), NOT NULL |
| provider | TEXT NOT NULL, 공백 금지 |
| model | TEXT NOT NULL, 공백만 저장 금지 |
| created_at | timestamptz(6) NOT NULL, 현재 시각 기본값 |

현재 llm adapter는 openai-compatible, image adapter는 openai/fal/opod-flux다.
기존 지원 모델/capability와 type/provider 조합을 검사한다.
API URL·키는 기존 GenerationSettingsService의 공급자별 연결 설정을 사용한다.
동일 공급자의 복수 endpoint/계정 등록 및 별도 secret 테이블은 현재 범위 밖이다.

## post_agent_prompts

| 컬럼 | 정의 |
| --- | --- |
| id | BIGINT 자동 증가 PK |
| stage | post_agent_stage ENUM(post_plan, image_plan, image_prompt, generation, caption), NOT NULL |
| revision | INTEGER NOT NULL, 양수, (stage, revision) UNIQUE |
| system_prompt | TEXT, 네 LLM 단계는 비어 있지 않은 값 필수, generation은 NULL |
| output_schema | JSONB, 네 LLM 단계는 JSON Schema object 필수, generation은 NULL |
| ai_model_id | BIGINT NOT NULL, ai_models.id FK, DELETE RESTRICT |
| model | TEXT NULL, 값이 있으면 참조 모델보다 우선 |
| created_at | timestamptz(6) NOT NULL, 현재 시각 기본값 |

단계별 최대 revision이 현재 설정이다. 변경/복원은 새 revision을 추가한다.
모델 FK가 있으면 네 LLM 단계는 type=llm, generation은 type=image만 저장한다.
저장 이전의 revision 0 화면만 기존 공통 설정을 표시한다. 저장 행에는 모델 FK가 필수다.
단계별 잠금과 expectedRevision 비교로 동시 편집 덮어쓰기를 방지한다.
기존 parser/필드 계약과 모델별 필수 reference 정책은 코드 owner에서 유지한다.
현재 필드 계약에 호환되지 않는 출력 schema의 저장/복원은 차단한다.

## DDL 범위와 승인 경계

두 테이블, 두 ENUM, PK 두 개, FK 하나, 단계별 UNIQUE와
revision/model/stage별 prompt-schema CHECK를 추가한다.
기존 테이블·데이터 변경은 없다. 이 구조의 DDL 작성은 2026-09-28 명시적으로 승인되었다.
정본은 backend src/domain/database/schema.ts 및 drizzle/*_post_agent_prompts/{migration.sql,snapshot.json}이고
admin src/domain/database/schema.ts는 동일 정의를 미러링한다.
SQL 실행 대상은 Testcontainers 테스트 DB뿐이다. 개발 DB 적용/배포는 별도 범위다.
코드 롤백은 추가 테이블·이력을 보존하고 기존 코드 기본 설정으로 돌아간다.

## Owner와 실행 연결

- owner-found: GenerationSettingsService/Repository가 기존 설정의 URL·키·기본 모델 해석을 소유한다.
  key 정의와 resolvePlannerSettings/resolveProviderSettings 호출로 확인했다.
- owner-found: prompts의 네 지침/schema 상수, Agent/StrictJsonAgentClient가 구성·전송·출력 검사를 소유한다.
  상수 export와 client.run 및 response_format 구성으로 확인했다.
- owner-found: PostPipelineV3Runner/LlmLogService는 단계 실행·artifact 및 호출 기록을 소유한다.
- owner-found: image-model-policy/provider/GenerationWorkerService가 reference/capability와 이미지 실행을 소유한다.
- owner-absent: 단계별 저장 지침/모델 목록. AiModelService, PostAgentPromptService와 각각 소유 Repository를 만든다.
  Controller/Worker는 Domain Service만 조합하고 다른 Repository를 직접 호출하지 않는다.

LLM 실행 시작에 현재 프롬프트와 모델 FK를 한 번 해석해 지침·model·schema를 전달한다.
이미지 프롬프트 생성 때 generation 행에서 목표 이미지 모델을 해석한다.
생성 job에 선택한 설정/모델 ID와 실효 provider/model을 보존하고 이미지 Worker가 사용한다.
미저장 단계와 기존 metadata 없는 잡은 기존 공통 설정 경로를 유지한다.
로그/artifact에 API secret을 복사하지 않는다. 기존 artifact/job의 새 metadata 누락은 호환한다.
기존 수동 모델 변경 허용 동작을 유지한다. 설정 변경으로 완료한 결과를 재작성하지 않는다.

## UI와 API

- 기존 시스템 메뉴에 게시물 Agent 관리, stage별 URL, 설정 편집/이력/복원을 추가한다.
- 모델 등록·목록은 type/provider/model만 사용하고 선택 항목은 provider + model로 표시한다.
- Agent의 단일 모델 Select는 해당 type으로 필터링한다. 모델 선택은 필수이며 nullable override는 별도 입력이다.
- generation은 모델 선택만 표시하고 지침/출력 schema는 표시하지 않는다.
- 출력 JSON Schema는 실제 저장·전송 내용을 읽기 전용 기술 상세로 보여준다.
- AdminJwtGuard/기존 CSRF를 유지한다. 미저장 전환 취소, pending 중복 차단,
  오류/409에서 입력 보존, keyboard/좁은 화면 상태를 검증한다.
- 모델 목록/등록과 단계별 현재 설정·버전 목록/저장/복원/기본값 적용 API를 제공한다.
- BIGINT ID는 양의 정수 문자열로 검증한다. 미존재 404, 입력/유형 오류 400, revision 충돌 409다.

## 구현 및 검증

1. 모델 등록/조회와 설정 저장까지 연결:
   backend schema/생성 migration, admin mirror,
   src/domain/ai-models/{repository,service,module}, src/domain/post-agent-prompts/{repository,service,module},
   src/admin/post-generation-agents/{controller,dto}, admin.module.ts,
   관리 frontend와 test/e2e-global-setup.ts/관리 E2E.
   검증: 저장·재조회, ENUM/FK/유형/override NULL fallback, 인증/CSRF, 참조 모델 삭제 차단.
2. 설정 저장/복원과 실제 단계 요청:
   post-pipeline-v3.runner.ts, worker.module.ts, 네 Agent,
   generation-worker.service.ts, 기존 provider/settings owner 입력 연결.
   검증: 동시 revision 경쟁, 과거 버전 보존, 실제 요청에 DB 지침/schema/모델 반영,
   generation 모델 연결, 기존 job/artifact 호환 및 미저장 단계의 기존 공통 설정 사용.
3. Admin 완성 및 guide/API 문서:
   packages/admin/src/features/post-generation-agents, app/routes.tsx.
   검증: 모델 선택·nullable override, 버전 복원, 오류 입력 보존, 미저장 취소,
   pending 중복 차단, keyboard/responsive 및 실제 화면 시각 확인.
4. admin: npm run admin:check, npm run lint, npm run test -- --runInBand,
   npm run build, npm run test:e2e, npm run schema:check, npm run format.
   backend: npm run db:generate -- --name post_agent_prompts,
   migration E2E, npm run lint, npm run build, npm run format.

유료 모델 실험, 개발 DB 적용, 배포, 커밋·푸시는 현재 범위 밖이다.
기존 dirty prompt/worker/guide 및 다른 캐릭터 문서를 보존한다.

최종 승인 SQL 우선: ai_models.provider TEXT, post_agent_prompts.ai_model_id NOT NULL, model TEXT NULL. 초기 미저장 단계만 기존 공통 설정을 사용한다. 저장한 설정에는 모델 선택이 필수다.


## 검증 결과와 검토

- Red: 관리 API가 없는 상태에서 새 E2E의 GET 200 / 인증 401 기대가 404로 실패했다.
- Green: Admin unit 52 suites / 527 tests, frontend typecheck + 20 files / 83 tests,
  전체 Admin E2E 11 suites / 38 tests 통과.
- backend migration E2E 4 tests 통과. 임시 Testcontainers DB에서 NOT NULL,
  지침/schema CHECK, stage/revision UNIQUE, 참조 모델 DELETE RESTRICT 및
  기존 데이터 보존을 확인했다.
- Admin/backend lint·build·format 통과, schema mirror 일치,
  backend db:generate 재검증 시 추가 drift 없음.
- 실제 요청 경계: 저장 LLM 지침/schema/model 반영, 이미지 프롬프트 target policy와
  이미지 잡 버전 고정, global fal 설정과 독립적인 OpenAI 키/model API 요청을 검증했다.
  유료 API는 호출하지 않았다.
- UI: localhost fixture + 실제 Vite 앱으로 데스크톱/390px 모바일 단계 선택,
  generation 폼, 모델 관리 팝업 확인. 임시 서버와 브라우저를 정리했다.
  UI 테스트가 저장 충돌 입력 보존/재편집, 단계 전환·초안 복구,
  복원 확인 및 실패 후 재시도, 모델 등록 요청을 검증한다.
- Review: 새 Controller/Worker는 새 Domain Service만 주입한다. 새 Repository는
  소유 Service만 참조한다. 출력 규격과 모델별 reference 정책은 기존 owner 유지.
  기존 dirty 문서/캐릭터 작업은 건드리지 않았다.
- Human review focus: canonical migration.sql, PostAgentPromptService의 revision/규격
  계약, WorkerModule의 이미지 설정 버전 고정. 데이터 모델/아키텍처 변경이므로
  verified; human review required before merge.
- Knowledge Delta: repo-evidenced 소유권/실행 경계/검증 owner를 두 repo의
  docs/07-codebase-guide.md와 Admin docs/api/admin-post-generation-agents.md에 반영했다.
- 남은 운영 작업: 개발 DB migration 적용, 배포, 커밋·푸시는 이 구현 승인 범위 밖이며
  실행하지 않았다. 이미지의 자연스러움/실모델 품질은 이번 입력 연결 테스트가 증명하지 않는다.

## Agent/backend 구조 변경 후속 검증

- 게시물 생성과 모델 호출은 Admin의 pipeline/worker가 소유한다. service-backend는
  canonical schema/migration을 소유하고, opod-agent는 채팅/메모리 실행을 소유한다.
  새 게시물 모델/지침을 Agent 채팅에 연결하는 런타임 변경은 필요하지 않다.
- backend schema.spec.ts에 누락된 새 테이블/ENUM/열/인덱스/FK 개수와 BIGINT/CHECK
  검증을 반영했다. 전체 unit 27 suites / 150 tests, E2E 15 suites / 126 tests,
  lint/format/build 및 diff check 통과.
- 새 migration을 적용한 임시 PostgreSQL에 모델/게시물 지침을 저장한 상태에서도
  Agent의 agent.llmModel 우선 선택, planner.llmModel fallback, 게시물 지침의 채팅
  프롬프트 미포함을 확인했다. Agent 런타임 파일은 수정하지 않았다.
- Agent typecheck/build 통과. lint 종료 코드 0이나 기존 eval artifact에 경고가 있다.
  기본 테스트 435 통과 / 25 skip, 실제 DB 테스트 459 통과 / 1 실패.
- 실패는 src/chat/character-context.integration.test.ts의 FakeProvider 응답에
  기존 필수 contextInjectionMode가 누락된 fixture 계약 불일치다. 같은 임시 DB에서
  새 테이블/ENUM을 제거해도 동일하게 실패하므로 이번 DDL 회귀가 아니다.
  관련 없는 fixture/메모리 런타임은 수정하지 않았다.
- 개발 DB/유료 API/배포/커밋·푸시는 실행하지 않았다. 임시 컨테이너는 정리했다.

## main 릴리스 승인과 배포 전 검증

- 후속 사용자 요청 `main에 커밋 푸시 배포해`로 main 커밋/푸시 및 개발 배포가
  승인됐다. 기존 DDL 포함 승인을 사용하고 backend migration을 Admin보다 먼저 적용한다.
- 세 저장소 main과 origin/main이 일치함을 fetch 후 확인했다. Agent는 코드 변경이
  없고 개발 서버의 full-a348b79 이미지가 현재 main과 같아 재빌드 대상이 아니다.
- 배포 직전 재검증: Admin UI 83 / unit 527 / E2E 38, backend unit 150 /
  E2E 126 통과. 양쪽 lint/format/build, Admin schema mirror, backend migration
  생성 drift 없음도 확인했다. Agent typecheck/build 및 기본 테스트 435 통과 / 25 skip.
- 샌드박스 소켓/Docker 접근 때문에 최초 테스트 실행이 실패했으나 필요한 권한으로
  전체 재실행이 통과했다. 코드 변경으로 테스트를 우회하지 않았다.
- 이번 작업의 코드/테스트/문서만 커밋한다. 별도 캐릭터 제작 자료와 기존 다른 문서
  변경은 보존한다. 서버 환경/비밀값을 포함하지 않는 git archive로 커밋을 빌드한다.
- 개발 DB의 서버 내부 백업과 이전 이미지 태그를 보존한 뒤 backend/Admin을 적용하고,
  migration 등록, 서비스 health, 관리 단계 조회와 인증 경계를 검증한다.
- 배포 전 최종 HTTP 경계 점검에서 src/main.ts의 SPA 허용 경로에 새 메뉴가
  누락된 것을 발견했다. 기존 경로 목록에 post-generation-agents를 추가했다.
  수정 전 직접 진입/단계 URL 거부를 재현하고, 수정 후 두 경로의 허용과 기존 화면
  유지/API·미등록 경로 제외를 확인했다. 개발 서버에서도 직접 진입과 새로고침 경로를
  확인한다. 새 기능의 화면 경로와 서버 SPA 허용 경로는 함께 변경해야 한다.
