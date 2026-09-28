# 캡션 작성·게시 확인 팝업 개발 배포

2026-09-28 사용자의 푸시·배포 요청으로 실행했다. 아래는 실제 검증한 개발서버 상태다.

## 적용 버전

- 기능 원본: `3a65fa5` (`main` 원격 푸시 완료).
- 개발 배포: `a6debd93f6c44e42f5475041c244696b4fdb65cb`.
- 배포 브랜치: `codex/dev-caption-publish-confirm` (원격 푸시 완료).
- 이미지: `opod-admin:release-a6debd9`, 실행 서비스 `opod-admin`.
- 이전 배포: `e87429c`. 백엔드는 `7cd7c4b`로 유지했다.

콘텐츠 프로필 데이터 이전이 완료되지 않아 `main` 전체를 배포하지 않았다.
기존 배포 위에 캡션 작성 원칙, 이모지 단독 캡션의 빈 언어 배열 허용,
수동 게시 최종 확인 팝업을 반영했다. `contentStyle`/`voice` 입력을 유지하며
프롬프트는 `caption-writer-v3-dev-legacy`, 계약은 `caption-set-v2`로 구분한다.
팝업 구현은 원본과 동일하다. 캐릭터 데이터·DDL·자동 게시 경로는 변경하지 않았다.

## 검증

배포할 정확한 소스 사본에서 `npm ci` 후 다음 검사를 통과했다.

- 단위 테스트: 51 suites, 490 tests.
- UI 타입 검사·테스트: 18 suites, 70 tests.
- 임시 PostgreSQL E2E: 9 suites, 33 tests.
- lint, format, build, Git diff 공백 검사.
- 서버 Linux/amd64 이미지 빌드와 이미지 파일 검증 런타임 smoke test.
- 실행 컨테이너의 리비전·캡션 버전·팝업 정적 파일 확인, 재시작 횟수 0.
- 외부 `/api/health`: 정상·DB 연결 정상. 백엔드 `/health` 응답 정상.
- 외부 `/posts`와 팝업을 포함한 `PostsPage-u4JwNBot.js` 응답 정상.
- 서버 내부 로그에서 앱·초안 워커·이미지 워커 기동 확인. 원문 로그는 반출하지 않았다.

실제 게시 요청, 새 이미지 생성, 실모델 캡션 품질 비교는 실행하지 않았다.
서버에 배포된 팝업의 실제 캐릭터 화면 조작은 이번 배포 확인 범위에 포함하지 않았다.
UI 동작은 원본의 로컬 브라우저 검증과 배포본의 UI 회귀 테스트로 확인했다.

## 복구와 후속 배포 주의

이전 이미지 보존 태그는 `opod-admin:before-caption-popup-20260928`다.
이 태그를 `opod-admin:latest`로 지정한 뒤 서버의 `/home/taeho/opod-admin`에서
`docker compose up -d --no-build --no-deps admin`으로 복구할 수 있다.
DB 변경이 없으므로 이번 배포를 되돌리기 위한 DDL은 없다.

이후 콘텐츠 프로필 분리 배포는 실제 데이터 이전을 확인한 뒤 수행해야 한다.
이전 분리 배포 이미지를 그대로 재사용하면 이후 이미지·캡션·팝업 개선이 빠진다.
