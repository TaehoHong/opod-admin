# 세 저장소 전체 개발 배포 — 2026-09-28

사용자의 `opod-service-backend / opod-admin / opod-agent 세개다 전부 배포해` 요청으로
세 저장소의 전체 실행 소스를 개발서버에 반영했다. 이전 기능별 legacy 배포를 대체한다.

## 실행 버전

| 대상 | 커밋 | 서버 이미지 |
| --- | --- | --- |
| backend | `7cd7c4bf63a30ee39ca3db66a81b3c8b63ecbdcb` | `opod-service-backend:full-7cd7c4b` |
| admin/API·게시물 워커·관리 UI | `cb11be47c880c3933e83d675f2df3944d45b8210` | `opod-admin:full-cb11be4` |
| agent API | `a348b799ab94b24b275f5f9544faf8215955b07a` | `opod-agent:full-a348b79` |
| agent 웹 | 같은 agent 커밋 | `opod-agent-web:full-a348b79` |
| Qwen 임베딩 | 같은 agent 커밋 | `opod-qwen-embedding:full-a348b79` |

정확한 커밋의 `git archive`만 서버 Docker로 전달해 Linux/amd64 이미지를 빌드했다.
서버의 환경변수·비밀값·compose 구성을 유지했다. 미추적 제작 자료와 로컬 환경파일은
빌드에 포함하지 않았다. 서버의 `latest` 태그는 위 이미지들을 가리킨다.

Admin에는 실행 모델 비교 수정 `bbbfc16`, 이미지 기획·프롬프트 v7 `cb11be4`와
기존 main의 게시물 제작 설정 분리·캡션·최종 확인 팝업·이미지 검증·Sunburst 연동을 포함한다.
Backend는 이미 적용된 커밋을 재빌드·재배포했다. 새 DDL은 없으며
`npm run db:migrate:deploy`가 `Drizzle migrations are up to date`로 완료됐다.

## 제작 설정 이전

이전 배포의 차단은 원문을 로컬로 반출하는 작업이었다. 이번에는 기존 검토본과 현재 DB의
원문·구조 해시를 서버 내부에서 비교하고 일치 여부만 출력했다. 데이터 접근·변경은
기존 CharacterService / CharacterContentProfileService / CharacterActionLogService를 사용했다.

- 권도건·서린·한소이의 제작 지침을 accountConcept / imageStyle / captionStyle /
  constraints로 구분했다. 기존 문장 내용을 보존했으며 원문과 Canon 연결도 유지했다.
- 이전한 제작 조각만 `never_prompt`로 바꿔 채팅과 중복 주입을 막았다.
  한소이의 셀카 취향은 기존 공통 preferences에 계속 남아 있음을 확인했다.
- 해나의 보강된 네 필드를 그대로 보존했다.
- 나희의 기존 never_prompt 제작 메모는 활성화하지 않았다. 유하는 기존 제작 항목이 없다.
  두 캐릭터의 별도 설정은 빈 상태이며 공통 페르소나를 사용한다.
- 6명 모두 원문·기억·이전 대상 밖의 페르소나와 다른 설정 보존을 확인했다.

## 실제 채팅 확인 중 발견한 기존 데이터 오류

최신 Agent의 실제 PersonaStore에서 해나만 `invalid character persona canon link`로
읽히지 않았다. 나이·운동 취향 조각이 Canon에 연결된 상태로 retrieved였기 때문이다.
기존 규칙은 연결된 조각을 never_prompt로 보존하고 Canon을 정본으로 읽는 방식이다.

두 조각에서 중복된 사실 문장만 never_prompt + 기존 Canon 연결로 분리하고,
추가 성격·취향·미정 사항은 기존 retrieved 정책으로 남겼다. identity 저장 후
lifestyle 저장에서 기존 v2/lore 조합도 잘못됐음이 확인됐다. 기존 behavior/lifestyle의
behavior/lore 조각은 그 타입을 지원하는 v1로 표시를 정정했다. 원문·Canon 연결·
메모리 본문은 바꾸지 않았다. CharacterService의 원문·구조 CAS와 감사 이력으로 처리했다.
공통 코드에 해나 전용 예외나 무결성 검사 우회는 추가하지 않았다.

복구 후 배포된 Agent에서 6명 모두 실제 DB를 읽고 routePersona를 통과했다.
기존 제작 조각이 채팅의 활성 문맥에서 제외되고 공통 성격이 남는 것도 확인했다.

## 검증

- Admin: 단위 52 suites / 507 tests, UI 19 suites / 73 tests,
  E2E 10 suites / 36 tests, lint·schema mirror·build 통과.
- Backend: 단위 27 suites / 150 tests, E2E 15 suites / 125 tests, lint·build 통과.
  첫 E2E에서 회원가입 요청 1건이 404였으나 새 일회용 DB로 전체 재실행은 통과했다.
  이 일회성 실패의 근본 원인은 확정하지 않았다.
- Agent: 타입검사·build, 단위 435 tests 통과(환경 조건 DB 테스트 25개는 기본 실행에서 제외).
  별도 일회용 PostgreSQL에서 persona store/router 27 tests 통과.
  웹 타입검사·7 suites / 42 tests 및 서버 이미지 빌드 통과.
  lint는 오류 없이 완료됐으나 기존 경고 34개·정보 13개가 남아 있다.
- 배포된 admin Runner + 실제 DB 설정으로 6명 × 기획/이미지/캡션 3단계 입력을
  캡처해 담당 필드와 저장값의 일치를 확인했다. 이는 가상 초안·가상 이미지 기반
  읽기 전용 검사이며 레퍼런스 미디어, 외부 모델 호출, DB 쓰기는 제외했다.
- Sunburst provider/model/키 존재와 image-planner-v7 / image-prompt-generator-v7을 확인했다.
  비밀값은 출력하지 않았다.
- 세 핵심 서비스와 Agent 웹·임베딩 모두 해당 리비전으로 기동, 재시작 횟수 0.
  backend/admin 외부 HTTPS health 정상, admin DB up, 앱·초안 워커·이미지 워커 시작 확인.
  새 content-profile 경로가 등록됐다.

이번 검증은 배포·설정 연결·채팅 격리 검증이다. 실제 유료 생성과 시각 품질 비교,
게시 요청은 실행하지 않았다. 기존 초안의 과거 산출물을 자동으로 다시 생성하지 않는다.

## 보존 및 복구

- 서버 내부 DB 백업: `/home/taeho/opod-backend/backups/pre-all-services-20260928.dump`.
  pg_restore 목록 읽기로 검증했으며 로컬로 복사하지 않았다.
- 다섯 이미지의 이전 태그: 각 이미지 이름에 `:before-all-services-20260928`.
- 이전 admin은 별도 제작 설정을 읽지 않는 legacy 버전이다. 이미지 태그만 되돌리면
  이전된 제작 지침이 전달되지 않으므로 단순 이미지 rollback을 전체 복구로 취급하지 않는다.
  필요시 현재 데이터와 서버 백업을 비교해 소유 Service로 해당 라우팅만 복구해야 한다.
  공유 DB 전체 복원이나 테이블 삭제를 자동 실행하지 않는다.

이 기록이 이전 content-profile 배포 보류 기록과 기능별 legacy 배포 기록의 후속 정본이다.
