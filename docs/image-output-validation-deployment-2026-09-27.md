# 이미지 출력 검증 개발 배포 — 2026-09-27

## 배포 결과

- 개발 admin API·worker: `e87429c7c2111e78d0655e9b717668621af9a28f`.
- 이미지: `opod-admin:release-e87429c`, image ID prefix `d8cadc3f2ecb`.
- 로컬 구현 커밋: `a95b708`. 현재 서버 버전 `b7a794d` 위에 해당 변경만
  적용한 브랜치: `codex/dev-image-output-validation`.
- 기획 모델과 실행 모델이 달라도 프롬프트를 재작성하거나 차단하지 않는다.
- provider 성공 후 실제 파일 디코딩·MIME·표시 해상도·요청 비율을 검증한다.
  빈 결과·손상·비율 불일치는 `generated_image_invalid` 사유로 실패 처리하며
  이미지 후보 저장이나 캡션 단계로 넘기지 않는다.
- backend `7cd7c4b` 유지. DDL·캐릭터 데이터 변경·콘텐츠 프로필 이관은 없다.

## 검증

배포 커밋의 별도 소스 스냅샷에서 lockfile로 의존성을 설치한 뒤 확인했다.

- 단위 테스트: 51 suites / 488 tests 통과.
- E2E: 9 suites / 33 tests 통과. 임시 PostgreSQL에서 파일 검증 실패의
  API 상태·사유·미디어 미저장과 기존 정상 생성·선택·재생성 흐름 확인.
- lint·build 통과. 커밋의 실행 소스만 전송해 서버에서 linux/amd64 빌드.
- 새 이미지의 네트워크 없는 컨테이너에서 정상 PNG의 실제 크기·MIME 확인,
  손상 데이터와 비율 불일치 거부 확인. 실제 이미지 모델 호출은 하지 않았다.
- 실행 revision `e87429c`, restartCount 0.
- 외부 admin health HTTP 200 / DB up, backend health HTTP 200 / ok.
- 관리자 HTML·초기 정적 자원 3개 HTTP 200, 비인증 auth/me HTTP 401.
- 서버 내부 검사로 API·Draft worker·Generation worker 시작 성공 확인.
  provider unavailable 경고 없음. 로그 원문은 로컬로 전송하지 않았다.

## 복구와 후속 배포

이전 이미지 `b7a794d`는 `opod-admin:before-image-output-validation-20260927`로
보존했다. 이 이미지를 `opod-admin:latest`로 지정한 뒤 서버의
`/home/taeho/opod-admin`에서 `docker compose up -d --no-build --no-deps admin`을
실행하면 admin만 복구할 수 있다. DB down migration은 필요 없다.

콘텐츠 프로필 이관은 별도 미완료 상태다. 이관 후 전체 배포할 때는 이번
`a95b708`까지 포함한 후속 소스를 검증·빌드해야 하며, 예전 `fd77cbb` 이미지를
사용하면 프롬프트 v6과 출력 검증 개선이 빠진다.
