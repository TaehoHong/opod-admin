# 이미지 프롬프트 v6 개발 배포 — 2026-09-27

후속 개발 배포 `e87429c`는 v6을 유지하면서 모델 변경 허용과 이미지 파일 검증을
추가했다. 최신 상태는 [이미지 출력 검증 배포 기록](image-output-validation-deployment-2026-09-27.md)을 참고한다.

## 배포 결과

- 개발 admin API·worker: `b7a794d77921509b51603c99d320ac622bfe2067`.
- 이미지: `opod-admin:release-b7a794d`, image ID prefix `95edaee45f3c`.
- 런타임에서 공통 프롬프트 v6, Nano 정책 v3, Kontext 정책 v2 확인.
- backend `7cd7c4b` 유지. 이번 배포에는 DDL이나 캐릭터 데이터 변경이 없다.

로컬 구현 커밋은 `08b9726`이다. 개발서버에 남아 있던 `cb571a5` 위에
이미지 프롬프트 변경만 적용한 `codex/dev-image-prompt-v6` 브랜치를 만들었다.
실제 캐릭터 제작 지침 이전이 완료되지 않아 콘텐츠 프로필 분리는 포함하지 않았다.
기존 persona 기반 게시물 스타일 전달과 관련 회귀 테스트를 유지했다.

**후속 배포:** `fd77cbb` 이미지는 이번 프롬프트 개선 이전 이미지이므로
그대로 전환하지 않는다. 콘텐츠 프로필 이전을 완료한 뒤 `08b9726`의 개선도
포함한 후속 커밋을 검증·빌드해야 한다. 현재 main을 바로 배포하면 미완료된
콘텐츠 프로필 분리까지 적용되므로 이 선행 조건을 확인한다.

## 검증 증거

배포 커밋을 별도 소스 스냅샷으로 추출하고 lockfile로 의존성을 설치했다.
초기 검증 환경의 workspace 의존성·backend migration 경로 누락을 보완한 뒤
다음 검증을 다시 실행했다.

- `npm test -- --runInBand`: 50 suites / 477 tests 통과.
- `npm run test:e2e`: 9 suites / 33 tests 통과. 임시 PostgreSQL 사용.
- `npm run lint`, `npm run build`: 통과.
- 명시적 커밋의 실행 소스만 `git archive`로 전송, 서버에서 linux/amd64 빌드 성공.
- 실행 컨테이너 revision `b7a794d`, 재시작 횟수 0.
- 외부 HTTPS admin health: HTTP 200, `status: ok`, `database: up`.
- 외부 HTTPS backend health: HTTP 200, `status: ok`.
- 관리자 HTML 및 연결된 초기 정적 자원 3개: HTTP 200.
- 비인증 `auth/me`: HTTP 401. 실제 계정 로그인은 재실행하지 않았다.
- 서버 내부 로그 검사: Nest 시작, Draft worker 시작, Generation worker 시작 확인.
  이미지 provider unavailable 경고 없음. 원문 대신 성공 여부만 반환했다.

전체 로그의 로컬 전송 방식은 자동 승인 검토에서 거절되어 실행되지 않았다.
대신 서버 내부 검사로 로그 payload를 전송하지 않고 시작 상태를 검증했다.
실제 모델 호출·이미지 A/B 평가·새 게시물 생성은 수행하지 않았다.

## 적용 범위와 롤백

이후 이미지 프롬프트 단계를 실행하는 초안에 v6이 적용된다. 이미 생성된
프롬프트·이미지를 자동으로 다시 만들지는 않는다. 장소 제외 조건 snapshot이
없는 기존 초안은 이전 결합 처리를 유지하며, 이미지 기획부터 재실행하면
새 제외 조건 전달 경로를 사용한다.

이전 실행 이미지 `cb571a5`는 서버의
`opod-admin:before-image-prompt-v6-20260927`로 보존했다.
필요하면 이 이미지를 `opod-admin:latest`로 지정하고
`/home/taeho/opod-admin`에서 `docker compose up -d --no-build --no-deps admin`을
실행해 admin만 복구한다. DB down migration은 필요하지 않다.
