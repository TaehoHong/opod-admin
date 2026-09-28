# OpenAI Sunburst 이미지 연동

2026-09-28 사용자 선택: `gpt-image-2.5-sunburst`.

## 설정과 소유권

기존 `GenerationSettingsService`와 `resolveImageGenerationProviders`를 확장한다
(owner-found). OpenAI Images API adapter는 기존 구현이 없어
`src/worker/openai-image.provider.ts`에 둔다 (owner-absent). 레퍼런스 변환과
API 호출만 담당하며, 파일 검사·업로드·완료 전이는 기존 generation worker가 소유한다.
DB 테이블이나 DDL은 추가하지 않는다.

- `generation.imageProvider`: `openai` 선택.
- `generation.openaiApiKey`: 이미지 전용 키. `OPENAI_IMAGE_API_KEY`가 env 폴백이다.
- `generation.openaiImageModel`: `gpt-image-2.5-sunburst`.
  `OPENAI_IMAGE_MODEL`이 env 폴백이다.
- 이미지 키는 기획·채팅 키와 독립적으로 저장한다. 운영자가 설정할 때 같은 키를
  복사할 수 있지만 실행 중 암묵적으로 다른 공급자의 키를 상속하지 않는다.
- 설정 API는 키를 마스킹하고 감사 이력에는 마지막 네 자리만 남긴다.
  화면의 빈 키 입력은 기존 값을 유지하고, 키 삭제 버튼은 DB 값을 제거한다.
- 공식 `https://api.openai.com/v1`만 호출한다. 사용자 지정 URL은 추가하지 않는다.
  연결 테스트는 모델 접근 조회이며 실제 이미지 생성 성공을 의미하지 않는다.

## 실행

레퍼런스가 없으면 `/images/generations`, 있으면 `/images/edits`에 JSON으로
요청한다. 서명된 이미지 URL 순서를 유지한다. 프롬프트 정책은
`gpt-image-policy-v1`이며 간결한 장면·레퍼런스 역할·보존/제외 조건을 전달한다.

숫자 `image_size`와 OpenAI `size` 명시값이 기본 비율보다 우선한다. 기본 피드
4:5는 1024×1280, 스토리·릴 9:16은 720×1280으로 요청한다. 기본 품질은
`auto`, 출력은 PNG다. 다른 공급자의 임의 파라미터를 전달하지 않는다.
원본 결과는 기존 MIME·전체 디코딩·비율 검증을 통과한 뒤 저장한다.
응답에 사용량이 있으면 Sunburst 공식 토큰 단가로 비용을 기록하고, 없으면 기존
worker의 추정 비용 경로를 유지한다.

Images API는 결과 재조회 endpoint를 제공하지 않으므로, 먼저 로컬 요청 식별자를
DB에 기록하고 첫 poll에서 유료 호출을 시작한다. 호출 중에는 기존 poll/lease
갱신을 유지한다. 재시작으로 메모리의 결과를 잃거나 통신·HTTP·결과 오류가 나면
자동으로 다시 과금하지 않고 실패시킨다. 재생성은 운영자가 선택한다.
이는 결과 복구를 지원하는 opod-flux와 다른 제약이다.

## 검증과 출처

Adapter 테스트는 생성/편집 라우팅, 레퍼런스 순서, 크기 변환, 다른 공급자
파라미터 차단, 응답/실패·중복 호출 방지·비용 계산을 검증한다. Settings tests는
키 분리·마스킹·모델 접근 조회와 키 없는 설정 조회를 검증한다. UI tests는
Sunburst 표시와 저장 시 기존 키 유지를 확인한다. 실제 캐릭터 품질은 이 테스트로
보장하지 않는다.

- [Sunburst 모델](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst)
- [이미지 편집 API](https://developers.openai.com/api/reference/resources/images/methods/edit)
- [이미지 생성 가이드](https://developers.openai.com/api/docs/guides/image-generation)

## 개발서버 적용 결과 (2026-09-28)

- 기능 커밋: `7793ae1` (`main` 푸시 완료).
- 개발 배포: `eb3131df318323f2fc72d1376046cee6033b9565`,
  `codex/dev-sunburst-image-api`, `opod-admin:release-eb3131d`.
- 콘텐츠 프로필 이전이 완료되지 않아 직전 개발 배포 `a6debd9`에 이번 연동만
  적용했다. 기존 이미지 검증·캡션 개선·수동 게시 확인 팝업을 유지한다.
- 실행 설정을 다시 조회해 `provider=openai`, t2i/edit 모두
  `openai:gpt-image-2.5-sunburst`, 이미지 키 출처 `db`를 확인했다.
- 기존 공식 OpenAI 기획 키를 서버 내부에서 이미지 전용 설정으로 복사했다.
  키 값을 로컬·도구 출력으로 가져오지 않았으며 채팅 키는 사용하지 않았다.
- 설정 변경은 기존 Settings Domain Service를 사용했다. 이 서버 내부 작업은
  관리 HTTP endpoint를 통하지 않았으므로 UI의 설정 감사 이력에는 남지 않는다.
- main 검증: 단위 502개·UI 73개·E2E 36개, lint·format·build 통과.
- 실제 개발 배포 소스 검증: 단위 506개·UI 72개·E2E 33개,
  lint·format·build와 Linux/amd64 Docker 빌드 통과.
- 실제 Sunburst `/images/edits` 호출 1회 성공. 서버에서 만든 단색 PNG만
  레퍼런스로 사용했고 캐릭터 데이터는 보내지 않았다. 출력 1024×1280 PNG의
  전체 디코딩·4:5 비율 검증 통과. 응답 사용량 기준 비용은 `$0.007443`.
  테스트 결과는 게시물이나 캐릭터 미디어로 등록하지 않았다.
- 외부 상태 API·DB 연결과 Sunburst 설정 화면의 정적 자산 확인 완료.
  앱·초안 워커·이미지 워커 기동 정상, 컨테이너 재시작 횟수 0.
- desktop/mobile 합성 설정 화면을 검증했다. 독립 UI 검토에서 키의 env 출처
  표시 1건을 수정한 뒤 해당 수정 범위의 ship 판정을 받았다.

복구 시 먼저 Settings Domain Service 또는 설정 화면에서 이미지 공급자를
`opod-flux`로 되돌린다. 이전 fal 논리 모델 ID와 opod-flux 연결 설정은 보존돼 있다.
이전 이미지 태그는 `opod-admin:before-sunburst-20260928`이며, 필요하면 이를
`opod-admin:latest`로 지정하고 서버 `/home/taeho/opod-admin`에서
`docker compose up -d --no-build --no-deps admin`을 실행한다.
이미지 공급자를 되돌리기 전에 구버전 이미지만 재시작하면 `openai`를 인식하지
못하므로 이 순서를 지킨다. DDL은 없다.
