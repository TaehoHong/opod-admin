# Influencer reference library

로컬 Work는 Instagram 사진·영상 썸네일을 다운로드하고 직접 분석한다. Admin은 multipart 파일 검증·S3 저장·분석 저장·서버 설정 임베딩을 담당한다. 기존 게시물 생성 Agent는 이 라이브러리를 아직 검색하지 않는다.

## Schema and ownership

Backend `drizzle/20261019042242_influencers/migration.sql`이 정본이다. `influencers`, `character_influencers`, `influencer_media`만 추가하며 CHECK와 게시물 테이블은 없다. 기존 characters UUID는 유지하고 새 ID는 BIGINT 문자열로 API에 전달한다.

테이블별 Repository와 소유 Domain Service는 `src/influencers/`에 있다. `CharacterReferenceLinkService`는 캐릭터 검증과 두 Domain Service를 조합하는 기존 화면의 coordinator이며 이전 Repository는 제거했다. `InfluencerMediaApplicationService`는 계정·미디어 서비스, S3 adapter, 기존 settings/embedding/logging owner를 조합한다.

## API

모든 요청은 기존 Admin 세션, 쓰기는 x-opod-admin 헤더 필요. 신규 인증 방식을 만들지 않는다.

- GET /api/admin/v1/influencers: cursor/limit, 기존 공통 pagination 기본20 최대50.
- GET /api/admin/v1/characters/:characterId/influencers: 연결 계정 배열.
- POST 동일 경로, `{url}`: Instagram profile URL을 정규화하고 계정·연결 재사용. idempotent 연결 등록.
- PATCH /api/admin/v1/characters/:characterId/influencers/:influencerId, `{url}`: 해당 캐릭터의 계정 연결만 교체. 공유 계정명 변경 기능 아님.
- DELETE 동일 항목 경로: 매핑만 제거. 계정·미디어 보존.
- GET /api/admin/v1/character-reference-directory: 기존 화면 계약(referenceLinks 배열) 유지, 새 관계를 조회.
- POST /api/admin/v1/influencer-media: multipart file + metadata(JSON string).
- GET /api/admin/v1/influencer-media: influencerId/postId/slideIndex/work/cursor/limit. 기본30 최대100. work=analysis는 분석 없음, embedding은 분석 있으나 벡터 없거나 현재 모델 불일치. items/nextCursor, imageUrl은15분 presigned URL, 벡터는 제외.

metadata:
```json
{"influencerId":"12","postId":"ABC123","postUrl":"https://www.instagram.com/p/ABC123/","slideIndex":1,"assetType":"image","analysis":{"model":"vision-model","version":"composition-v1","content":{"description":"앉은 인물","personCount":1,"framing":"허리 위","pose":"앉은 자세","hands":null,"gaze":"카메라","camera":"눈높이","placement":"중앙","background":"실내","wardrobe":"흰 셔츠","lighting":"자연광"}}}}
```

analysis는 생략/null 가능. 포함 시 model/version/content.description 필수. 기타 content 값은 null/생략 가능. 정규화 시 생략 필드는 null. 클라이언트 mediaKey/sha256/embedding은 받지 않는다. 이미지 최대30MiB,4천만 픽셀,단일 JPEG/PNG/WebP; metadata 최대20000바이트. 원본 파일을 변환하지 않는다.

sourceCaption은 선택적 string/null이다. 누락/null은 기존 캡션을 보존하며 빈 문자열은 확인된 빈 캡션이다. 공백·줄바꿈을 그대로 저장한다. POST 응답과 GET items는 sourceCaption을 항상 포함하고 미확인은 null이다. 같은 influencerId + postId의 모든 슬라이드에 명시적 문자열을 반영하며 새 슬라이드는 알려진 캡션을 상속한다. 미디어 Repository 트랜잭션의 게시물 단위 advisory lock으로 동시 등록을 직렬화하고 마지막으로 성공한 명시적 저장을 유지한다. 식별자 충돌이면 캡션 변경도 롤백한다. 캡션만 바뀌면 구도 임베딩을 유지한다. 캡션 자체의 별도 길이 제한은 없으며 기존 multipart metadata 20000바이트와 파서 20000 JavaScript 코드 단위 제한을 유지한다.

신규201/재요청200. 응답 id/created/mediaKey/sha256/sourceCaption/analysisStatus 및 embedding{status,model,error}. 분석 없으면 not_requested, 성공ready, 임베딩 실패failed. 분석·파일은 보존하며 같은 분석 포함 요청으로 재시도한다. 오류 이유는 기존 LLM 로그에 기록하며 응답에 공급자 원문·키를 노출하지 않는다.

같은 계정·게시물·슬라이드의 해시/assetType이 다르면409. 분석 없는 요청은 기존 분석 보존. 분석·모델·버전 변경은 벡터 무효화. 서버는 구조화된 구도 필드로 텍스트를 만들고, 전부 비었을 때 description을 사용한다. 검색 벡터1024는 기존 ReferenceEmbeddingClient 규격이다. 분석 snapshot 및 대상 embeddingModel을 조건으로 저장해 늦은 결과의 덮어쓰기를 막는다. 같은 분석의 동시 실행은 외부 호출이 중복될 수 있지만 미디어 행은 하나이며, 별도 queue/lease 테이블은 없다.

S3: pod/reference-library/instagram/v3/accounts/{influencerId}/posts/{postId}/{slideIndex}-{sha256}.{format}. 조건부 업로드와 HEAD 검증. 파일 저장 성공 뒤 DB 실패 시 동일 요청으로 복구. 기존 v1/v2 객체는 삭제하지 않는다. 동일 식별자에 서로 다른 파일이 동시 요청되면 DB에서 한 자료만 승인되며 미참조 S3 객체가 남을 수 있다. 자동 삭제하지 않는다.

source_caption의 정본 추가 migration은 Backend `drizzle/20261019060222_orange_warlock/migration.sql`이다. nullable text 한 컬럼만 추가하며 Admin은 schema mirror를 유지한다.

## Migration and rollout

기존 링크를 계정으로 정규화, 중복 통합, 매핑 이전, 전체 누락 검증 후 기존 테이블을 제거한다. 지원하지 않는 URL은 RAISE로 전체 transaction을 중단한다. 기존 링크 ID/등록시각/URL 원문 표기는 새 최소 스키마에 보존되지 않으므로 실제 개발 DB 적용 전 전체 old table 백업 필수. 계정명은 불변 플랫폼 ID가 아니므로 변경·재사용을 자동 병합하지 않는다.

이 변경은 old table을 제거하므로 기존 Admin 서버를 실행한 채 migration만 적용하지 않는다. 실제 배포 시 이전 테이블 백업 → 쓰기 중지 → transaction migration → 새 Admin 시작 → 읽기/업로드 점검 순서. 롤백은 쓰기를 중지하고 백업의 old table을 복원한 뒤 이전 코드를 실행한다. 새 테이블·S3 객체는 보존하고 전환 후 신규 매핑은 복원 전에 별도 보존한다. 이 작업에서는 개발 DB 적용·배포하지 않는다.

## Verification

- Admin: npm run test:e2e -- --runTestsByPath test/influencer-media.e2e-spec.ts test/character-reference-links.e2e-spec.ts test/character-reference-directory.e2e-spec.ts
- Backend: npm run test:e2e -- --runTestsByPath test/character-reference-links-migration.e2e-spec.ts test/drizzle-migrations.e2e-spec.ts
- API e2e는 실제 DB/HTTP를 사용하고 S3 adapter·임베딩 외부 HTTP만 대체한다. 실제 공급자/S3 검증은 별도 필요.
- npm run lint, npm run test, npm run build, npm run admin:check, npm run schema:check.

## SNS reference library UI

- `GET /influencers` supports optional `search` (username, up to 100 characters) and `characterId` (UUID) alongside cursor/limit. An unlinked character returns an empty result.
- `POST /influencers` accepts `{ "url": "https://www.instagram.com/username/" }` and returns the existing or newly registered account. Authentication and CSRF requirements match media registration. Optional character linking uses the existing character-influencers API.
- `GET /influencer-media` adds optional `characterId`, `assetType=image|video_thumbnail`, `analysisStatus=ready|missing`, `search` (description/post ID, up to 200 characters), and `order=newest|oldest`. Here ready means analysis exists, not embedding readiness. Defaults remain oldest-first for existing collectors. `influencer` provides account id/username/url/platform for each returned media item. Character and account filters intersect.
- Manual UI upload uses the existing multipart endpoint with `analysis:null`. Files are registered sequentially; successful files are retained when others fail. Repeating the same file/identity uses the existing idempotency contract. No schema change or automatic vision call is introduced.
