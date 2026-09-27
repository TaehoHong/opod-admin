# 캐릭터 게시물 제작 설정 분리

상태: 2026-09-27 DDL 포함 승인 후 로컬 구현·검증. 실제 캐릭터 데이터 이전과 개발 배포는 아직 실행하지 않았다.

## 목적과 확정된 경계

캐릭터의 정체성·성격·생활·평소 말투는 공통 페르소나에 유지한다.
계정 컨셉·사진 스타일·캡션 스타일·제작 제한은 별도 게시물 제작 설정에 저장한다.
게시물 생성만 이 설정을 읽으며 채팅은 읽지 않는다. 소재 허용 목록이나 고정 주제 비율을
새로 만들지 않는다. 러닝 계정도 커피와 휴식을 자연스럽게 게시할 수 있다.

사용자가 2026-09-27 이 분리 방향의 구현을 승인했다. 별도 테이블 DDL도 승인했다.
외부 LLM 재평가, 개발서버 배포와 실제 캐릭터 데이터 쓰기는 이번 로컬 구현과 구분한다.

## 확인한 현재 소유자

- owner-found: 페르소나/구조 편집은 `CharacterService`와 `CharacterRepository`.
- owner-found: 게시 입력 선별은 `projectPostPersonaContext`, 단계 입력 조립은
  `PostPipelineV3Runner`. 현재 contentDirection은 선별된 persona 제목에 의존한다.
- owner-found: 채팅 DB 어댑터는 opod-agent의 `PostgresPersonaStore`, 주입 정책은
  `routePersona`. 신규 설정 테이블을 조회하거나 전달하지 않는다.
- owner-absent: 게시물 제작 설정의 독립 저장·조회 기능. 기존 posting-policy는
  게시 시간과 빈도, visual-profile은 외모와 이미지 참조를 관리하므로 대체 저장소로 쓰지 않는다.
- DB 정본은 backend `src/domain/database/schema.ts`와 `drizzle/`이며 admin은 미러를 가진다.

## 저장 및 API 계약

신규 테이블 이름은 `opod.character_content_profiles`.
캐릭터별 한 행이며 character_id를 PK 및 characters FK로 사용한다. 캐릭터 삭제 시 cascade.
텍스트 필드는 account_concept, image_style, caption_style, constraints의 네 개이며 빈 문자열이
기본값이다. created_at과 updated_at을 가진다. 기존 테이블/컬럼은 삭제하거나 변경하지 않는다.

정본 수정 대상: backend `src/domain/database/schema.ts`,
`drizzle/20260927073129_character_content_profiles/`의 migration 및 snapshot.
미러 수정 대상: admin `src/domain/database/schema.ts`. SQL과 migration snapshot 생성을 완료했다.

관리 API: 기존 인증을 따르는 GET/PUT `/api/admin/v1/characters/:id/content-profile`.
응답 및 PUT 본문은 accountConcept, imageStyle, captionStyle, constraints.
PUT은 네 필드를 명시하는 전체 교체이며 각 필드는 최대 10,000자. 빈 문자열은 삭제 의도다.
없는 설정은 빈 값으로 표시하고 페르소나에서 자동으로 복구하지 않는다.
없는/삭제된 캐릭터는 기존 캐릭터 조회의 오류 계약을 따른다.

새 CharacterContentProfileRepository에는 해당 테이블 접근만 둔다.
CharacterContentProfileService만 그 Repository를 사용한다. 캐릭터 확인은 CharacterService,
변경 이력은 CharacterActionLogService를 경유한다. 워커는 설정 Service를 경유해 읽는다.
관리 HTTP 모듈에 워커가 의존하지 않도록 필요한 domain provider 모듈만 분리한다.

## 운영 화면

캐릭터 관리에 ‘게시물 제작’ 탭을 추가한다. 네 개의 라벨이 있는 여러 줄 입력과 저장 버튼을 둔다.
‘게시물 생성에만 사용합니다. 채팅에는 적용되지 않습니다.’를 표시한다.
설정 없음은 빈 입력, 조회 실패는 재시도 가능한 오류, 저장 중은 중복 제출 차단으로 처리한다.
캐릭터 전환 시 이전 입력이 남지 않도록 캐릭터 ID로 폼을 구분한다.
기준은 `docs/04-design-rules.md`, 구현 예시는 `CharacterAutomationPanel.tsx`의
Mantine/useForm/TanStack Query 설정 폼이다. 새로운 디자인 토큰이나 라이브러리는 추가하지 않는다.

## 단계별 입력

| 단계 | 게시물 제작 설정 | 함께 쓰는 기존 입력 |
| --- | --- | --- |
| 게시물 기획 | 계정 컨셉, 제작 제한 | 공통 페르소나, 관련 기억, 최근 게시물, 요청 |
| 이미지 기획 | 계정 컨셉, 사진 스타일, 제작 제한 | 채택한 기획, 외모/참조 이미지, 관련 공통 페르소나 |
| 이미지 프롬프트 | 이미지 기획에 반영된 스타일과 제한 | 기존 이미지 기획 결과와 모델별 변환 규칙 |
| 캡션 | 계정 컨셉, 캡션 스타일, 제작 제한 | 채택한 기획, 생성 이미지, 공통 말투 |
| 채팅 | 전달하지 않음 | 기존 공통 페르소나와 기억 |

신규 설정은 키워드 검색 없이 명시적으로 전달한다. 설정 자체를 Canon이나 캐릭터 경험으로
기록하지 않는다. 각 단계 artifact의 입력에 사용한 값을 남겨 재현 가능성을 유지한다.
빈 설정에서는 공통 페르소나로 생성할 수 있지만 계정 컨셉이 설정돼 있다고 주장하지 않는다.
기존 artifact 출력 형식과 이미 진행 중인 후속 단계의 읽기 호환성을 유지한다.
별도 설정을 실제 입력으로 연결한 뒤, 이전 미커밋 수정의 `게시물 기획` 검색 단서와
persona 제목 기반 contentDirection 추출을 대체한다. 이중으로 주입하지 않는다.

## 기존 데이터 이전 검토

2026-09-27 읽기 전용으로 확보한 6명 fixture를 확인했다. 실제 쓰기 직전에는 원본 버전을 다시 확인한다.

| 캐릭터 | 확인된 자료 | 이전 방향 |
| --- | --- | --- |
| 권도건 | content_style / retrieved | 수행 중심 계정 방향, 기록 표현, 영상/사진 방식, 공정성·노출 제한을 해당 필드로 구분 |
| 서린 | content_style / retrieved 4조각 | 계정 방향, 촬영 구도, 캡션, 의상·금지 표현으로 이미 나뉜 조각을 활용 |
| 한소이 | content_style / retrieved | 피드 방향·사진/촬영 방식·협찬 기준을 구분. ‘셀카를 싫어한다’ 같은 개인 취향은 공통 페르소나 유지 여부를 확인 |
| 나희 | content_guidance / creator_note / never_prompt | 자동 이전 제외. 명시적으로 게시 제작용으로 재분류하기 전까지 모델에 전달하지 않음 |
| 해나·유하 | 해당 독립 항목 없음 | 빈 설정으로 시작. 기존 페르소나에서 새 계정 컨셉을 임의 작성하지 않음 |

원문을 단순 제목 기준으로 통째로 삭제하지 않는다. 실제 이전은 필드별 전후 비교,
원문/구조 hash, Canon 연결을 확인한 뒤 기존 소유 Service를 통해 처리한다.
이전한 제작 전용 조각은 채팅 입력에 남지 않도록 기존 주입 정책으로 비활성화하고 원문과
출처 연결을 보존한다. 공통 성격·취향 문장은 남긴다. 제목만으로 채팅 라우터에 새 예외를
쌓지 않는다. 신규 제작 설정은 이후 일반 페르소나 편집에서 관리하지 않는다.
이번 DDL migration에 데이터 이전이나 never_prompt 재분류를 섞지 않는다.

## 구현 및 검증 순서

- [x] 기존 저장소/입력/채팅 경로와 실제 이전 후보 조사.
- [x] DDL 승인 후 새 테이블 정본·미러·migration 작성. 테스트 DB에서 생성, FK/유일성,
  기존 persona/Canon 보존과 재실행 검증.
- [x] admin 설정 Repository/Service/DTO/GET·PUT와 관리 탭을 연결.
  저장 후 재조회, 캐릭터 간 격리, 비인증 거절, 입력 제한, 빈 값 삭제를 검증.
- [x] 기존 단계 입력 조립 owner에서 새 설정을 읽도록 교체. 기획/이미지/캡션 입력에
  담당 설정이 전달되는지, 키워드와 무관한지, 이전 지침과 이중 주입되지 않는지 검증.
- [x] 채팅 입력 테스트에서 제작 설정의 고유 문구가 포함되지 않고 공통 페르소나는
  유지되는지 검증. 이전 데이터의 비활성 조각이 원문 경로로 복구되지 않는지도 확인.
- [x] admin lint/unit/E2E/build/admin:check/schema:check, backend migration E2E/build,
  agent 관련 persona 테스트를 실행. UI 실제 렌더와 저장/실패 상태 확인.
- [x] 로컬 검증 결과와 실제 이전 후보 검토를 보고.
- [ ] 개발 DB 쓰기/배포 시 필드별 이전 전후 비교와 원문 정책 변경을 실행.

## DDL 영향과 되돌리기

추가형 테이블 생성만 포함한다. 기존 데이터 갱신·삭제, 기존 채팅 테이블 변경은 없다.
로컬/일회용 테스트 DB에서 먼저 적용한다. 개발 DB 적용은 이번 로컬 구현에 포함하지 않는다.
문제가 생기면 코드부터 되돌리고 신규 테이블과 저장 데이터는 보존한다.
테이블 삭제나 개발 DB 복원은 자동으로 하지 않는다.

구현 전 차단 결정은 없다. 배포 시에는 기존 제작 지침을 먼저 이전하고 채팅용 원문 주입을 정리해야 한다.


## 검증 결과

- admin: 전체 단위 테스트, E2E 10 suites / 36 tests, frontend 19 suites / 65 tests,
  lint/build/schema:check 통과. 단계별 입력 focused 테스트 22개 통과.
- backend: 단위 27 suites / 150 tests, migration E2E 3개, build/lint 통과.
  migration은 빈 DB·기존 DB와 재실행을 검증했고 데이터 삭제를 수행하지 않았다.
- agent: 일회용 PostgreSQL에 신규 schema와 합성 캐릭터를 넣은 뒤 persona store/router
  27개 테스트 모두 통과(조건부 DB 테스트도 건너뛰지 않음). typecheck와 변경 파일 lint 통과.
- UI: 합성 API를 이용해 실제 CharacterContentProfilePanel의 입력 수정·저장·새로고침
  재조회를 브라우저에서 확인. 기존 앱의 Mantine theme을 사용했다. 화면 증거는
  `/private/tmp/opod-content-profile-preview.png`. 임시 미리보기 파일과 서버는 정리한다.
- 첫 admin E2E 실행에서 기존 character-context fixture 생성이 404로 실패한 사례가 있었고,
  해당 경로 코드 변경 없이 전체 재실행에서 통과했다. 원인은 확정하지 않았다.
- 실제 캐릭터 데이터/외부 LLM 호출/개발서버 배포/커밋/푸시는 이번 변경에서 수행하지 않았다.
  실제 캐릭터의 스타일 개선 효과는 데이터 이전과 새 모델 평가 후 판단해야 한다.

병합 전 검토 초점: 신규 테이블 DDL, 이전 지침 제외와 빈 설정 동작, 실제 데이터 이전 범위.
기존 페르소나에 남은 제작 지침은 아직 채팅 정책도 기존 상태이므로, 로컬 구현만으로
개발서버 캐릭터의 지침 분리가 완료됐다고 해석하면 안 된다.
