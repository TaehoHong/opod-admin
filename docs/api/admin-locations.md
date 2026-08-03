# Admin Locations API

모든 endpoint는 admin cookie session이 필요하며 상태 변경 요청은
`x-opod-admin` 헤더도 요구한다. 장소는 게시물 생성기가 재사용하는 정본
환경 설명과 레퍼런스 이미지 묶음이다.

## 목록과 필터

```http
GET /api/admin/v1/locations?scope=all&characterId=<uuid>&limit=20&cursor=<cursor>
```

- `scope`: `all`(기본), `global`, `character`
- `characterId`: 지정하면 해당 캐릭터 전용 장소만 정확히 조회하며 `scope`보다
  우선한다.
- `characterId`가 `null`인 장소는 범용 장소다.
- soft-delete된 장소는 목록과 상세 조회에서 제외된다.

응답은 `{ "items": [...], "nextCursor": "..." }` 형식이며 각 장소에
캐릭터 요약, `referenceCount`, 순서가 적용된 `references`가 포함된다.

## 생성·상세·수정·삭제

```http
POST   /api/admin/v1/locations
GET    /api/admin/v1/locations/:id
PATCH  /api/admin/v1/locations/:id
DELETE /api/admin/v1/locations/:id
```

생성 본문:

```json
{
  "characterId": null,
  "locationKey": "buldang-gym",
  "displayName": "불당동 헬스장",
  "description": "운영자와 기획 LLM이 읽는 장소 설명",
  "visualPrompt": "이미지 프롬프트에 합성할 환경 묘사",
  "negativePrompt": "장소에서 피할 시각 요소"
}
```

`locationKey`는 영문 소문자·숫자·하이픈 형식이며 같은 범위 안에서
고유하다. 삭제는 `deletedAt`만 기록하는 soft delete다. 기존 draft와 media는
삭제하지 않는다.

## 레퍼런스 교체

```http
PUT /api/admin/v1/locations/:id/references
```

```json
{
  "references": [
    { "mediaId": "<uuid>", "description": "입구에서 본 웨이트 존" },
    { "mediaId": "<uuid>", "description": "거울과 덤벨 랙" }
  ]
}
```

배열 순서가 저장 순서이며 최대 20장이다. media ID는 중복될 수 없고 업로드가
확정된 이미지여야 한다. 기존 항목을 배열에서 빼면 연결만 해제되고 media
원본은 보존된다.
