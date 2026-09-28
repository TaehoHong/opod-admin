# 콘텐츠 프로필 개발 배포 — 2026-09-27

> 후속 상태: 2026-09-28 제작 지침 이전과 세 저장소 전체 배포를 완료했다.
> [전체 개발 배포 기록](full-development-deployment-2026-09-28.md)을 따른다. 아래는 당시의 기록이다.

## 2026-09-27 당시 상태

사용자가 DDL 포함 구현과 후속 개발 배포를 승인했다. Backend와 추가형 DDL은 배포됐고,
admin은 기존 제작 지침 이전을 검증할 수 없어 기존 버전을 유지한다. 전체 배포 완료가 아니다.

| 대상 | 상태 |
| --- | --- |
| backend | 7cd7c4b / opod-service-backend:release-7cd7c4b 배포 완료 |
| DB | 20260927073129_character_content_profiles 적용, 7개 컬럼 확인 |
| admin 신규 이미지 | fd77cbb / opod-admin:release-fd77cbb 빌드 완료 |
| admin 실행 중 | e87429c: 기존 persona 경로에 프롬프트 v6·이미지 출력 검증만 분리 배포. 콘텐츠 프로필 분리는 미적용 |
| agent | a348b79는 회귀 테스트만 변경한 로컬 커밋. 서비스 재배포 불필요 |
| 실제 캐릭터 지침 이전 | 미실행 |
| Git 원격 push | 미실행 |

명시적 commit의 실행 소스만 git archive로 전달해 서버 Docker에서 linux/amd64로 빌드했다.
일반 작업 폴더의 미추적 게시물 파일과 .env는 빌드 컨텍스트에 포함하지 않았다.

## 검증

- backend 시작 시 정본 migration 적용 후 `npm run db:migrate:deploy` 재실행:
  Drizzle migrations are up to date.
- migration 레지스트리 최신 이름과 information_schema의 새 테이블 7개 컬럼 일치.
  이 검증은 캐릭터 레코드나 persona 원문을 읽지 않았다.
- backend Docker health healthy, 실행 revision 7cd7c4b.
- 외부 HTTPS backend /health: ok, admin /api/health: ok / database up.
- admin 실행 revision cb571a5로 유지됨을 확인.
- 배포 전 테스트: admin unit 465, E2E 36, UI 65; backend unit 150,
  migration E2E 3; agent 실제 테스트 DB persona/router 27. lint/build/schema mirror 통과.

## 보존 및 롤백

- 서버 내부 DB 백업: /home/taeho/opod-backend/backups/pre-content-profile-20260927.dump.
  빈 파일 아님과 pg_restore --list 성공을 확인했다. 로컬로 복사하지 않았다.
- 이전 이미지 태그: opod-admin:before-content-profile-20260927,
  opod-service-backend:before-content-profile-20260927.
- 코드 롤백이 필요하면 이전 이미지로 전환한다. 추가된 테이블/저장 데이터를 자동 삭제하지 않는다.

## 남은 단계와 차단 원인

자동 승인 검토가 다음 두 작업을 거절했다.

1. 개발서버의 기존 제작 지침 원문을 로컬 /private/tmp 파일로 복사.
2. 원문을 제외한 캐릭터 ID·원문/구조 SHA·주입 정책만 같은 로컬 경로로 복사.

이유: 배포 승인만으로 해당 payload와 로컬 목적지에 대한 명시적 전송 승인이 확인되지 않음.
두 거절된 명령은 실행하지 않았고, 대상 원문/메타데이터를 이번 배포 작업에서 가져오지 않았다.

남은 승인 요청은 제작 지침(content_style/content_guidance/capture_style)의 원문·ID·해시·
주입 정책을 개발서버에서 조회해 이 PC의 /private/tmp 검토 파일로 복사하는 작업이다.
채팅 기록, 캐릭터 기억, API 비밀값이나 외부 LLM 전송은 이 요청에 포함하지 않는다.

승인 후 실행 순서:

1. 현재 소스·구조를 재확인하고 필드별 이전안을 기존 검토본과 비교.
2. CharacterContentProfileService를 통해 설정 저장. CharacterService를 통해 이전된 제작
   전용 조각만 기존 never_prompt 정책으로 보존해 채팅에서 제외. Canon 출처와 원문은 유지.
   기존 never_prompt 항목은 자동으로 새 제작 설정에 승격하지 않는다.
3. 현재 값·출처 해시·일반 페르소나 보존과 실제 단계 입력을 비교해 누락/중복 없는지 검증.
4. 이미지 출력 검증 개선 커밋 a95b708까지 포함한 후속 admin 이미지를 검증·빌드하고
   전환한 뒤 관리자 설정 조회·worker 상태·헬스체크. fd77cbb 이미지를 그대로
   배포하면 현재 e87429c의 프롬프트·이미지 출력 검증 개선이 빠지므로 사용하지 않는다.

이후 이미지 프롬프트 단독 배포 결과는
[이미지 프롬프트 개발 배포 기록](image-prompt-deployment-2026-09-27.md)에 있다.

설정이 빈 상태에서 새 admin으로 먼저 전환하면 이전 persona 기반 지침을 읽지 않아
기존 캐릭터 스타일이 빠진다. 따라서 이 데이터 확인 경계 앞에서 admin 전환을 보류했다.
