# Admin Characters API

All endpoints require admin authentication.

## List characters

```http
GET /api/admin/v1/characters?status=active&limit=20&cursor=<cursor>
```

Each item includes operational counts:

```json
{
  "id": "0190d8d1-463b-7e36-a9ef-0242ac120003",
  "publicId": "mina_ai",
  "displayName": "Mina",
  "bio": "City walks",
  "interests": ["art"],
  "status": "active",
  "postCount": 12,
  "followerCount": 340,
  "createdAt": "2026-07-12T00:00:00.000Z"
}
```

`postCount` is the number of posts owned by the character. `followerCount` is
the number of user-character follow rows. Both return `0` when empty.

## Get a character

```http
GET /api/admin/v1/characters/:id
```

The detail response includes the same `postCount` and `followerCount` fields in
addition to existing `personas` and `memories`.

## Reference links

관리자 캐릭터 프로필의 모티브 SNS·참조 주소는 별도 `character_reference_links` 테이블에서 관리한다.

| Method | Path | Result |
| --- | --- | --- |
| GET | `/api/admin/v1/characters/:characterId/reference-links` | 등록 순서의 링크 배열, 미등록은 `[]` |
| POST | 동일 경로 | `{ "url": "https://example.com/reference" }` 등록, 201 |
| PATCH | 동일 경로 뒤 `/:linkId` | `{ "url": "https://example.com/updated" }` 수정 |
| DELETE | 동일 경로 뒤 `/:linkId` | 선택한 링크 삭제, `{ "id": "123" }` |

각 링크 응답은 `{ id, characterId, url, createdAt, updatedAt }`다. `id`는 BIGINT IDENTITY를
손실 없이 문자열로 반환하고 `characterId`는 기존 캐릭터 UUID다. 시각은 ISO 문자열이다.
앞뒤 공백과 URL 표기를 정규화하며, 사용자 정보가 없는 2048자 이내 HTTP/HTTPS 주소만 저장한다.
같은 캐릭터에 정규화된 URL이 중복되면 409, 잘못된 URL·ID는 400,
없는 캐릭터 또는 다른 캐릭터의 링크 ID는 404다. 관리자 쿠키와 기존 CSRF 규칙을 적용한다.
URL DB CHECK는 사용자 결정에 따라 두지 않는다. 새 테이블의 unique index와 FK는 유지한다.
링크 열기는 새 탭의 `noopener noreferrer` 앵커로 제공한다.

### SNS reference directory

`GET /api/admin/v1/character-reference-directory`는 관리자 인증 후
`{ items: [{ id, publicId, displayName, referenceLinks }], nextCursor? }`를 반환한다.
`referenceLinks`는 위 링크 응답 형식을 그대로 쓴다.

- `search`: 이름·핸들 부분 검색, 대소문자 무시, 100자 이내. 핸들 앞 `@`를 허용하며 `%`·`_`는 일반 문자로 검색한다.
- `registration`: `all`(기본), `registered`, `missing`. 전체 후보에 필터를 적용한 뒤 페이지를 만든다.
- `limit`: 기본 20, 최대 50. `cursor`는 응답의 `nextCursor`를 사용한다. 검색·필터를 바꾸면 cursor를 지운다.
- UUID 내림차순 keyset 조회로 페이지를 교체한다. 전체 개수나 페이지 수를 추정해 반환하지 않는다.
- 잘못된 검색·필터·cursor는 400, 비인증은 401이다. 일괄 조회는 기존 캐릭터·참조 링크 Domain Service를 조합한다.

Admin의 `/sns-references`는 현재 20명의 캐릭터 목록·참조 링크를 일괄 조회한다.
행을 클릭해 진입하는 `/sns-references/:characterId` 상세는 기존 캐릭터별 참조 링크 GET/POST/PATCH/DELETE로 여러 링크를 관리한다.
나머지 캐릭터의 링크를 개별 HTTP 요청으로 순회하지 않는다.
등록 상태가 드문 조건에서는 서버가 후보를 50명씩 순회하며 필요한 결과를 찾는다.
목록의 HTTP 요청 수를 캐릭터 수만큼 늘리지 않으며, 클라이언트 전체 목록 적재나 카드 누적은 사용하지 않는다.

## Profile image

Profile images reuse upload-confirmed image rows from the media library. The
character stores the media relation and normalized square-crop settings; the
original media is not modified.

```http
GET /api/admin/v1/characters/:id/profile-image
```

Characters without an image return a centered default crop:

```json
{
  "characterId": "0190d8d1-463b-7e36-a9ef-0242ac120003",
  "image": null,
  "crop": { "x": 0.5, "y": 0.5, "zoom": 1 }
}
```

Assign an existing media image and its crop:

```http
PUT /api/admin/v1/characters/:id/profile-image
Content-Type: application/json

{
  "mediaId": "0190d8d1-463b-7e36-a9ef-0242ac120020",
  "crop": { "x": 0.4, "y": 0.6, "zoom": 1.5 }
}
```

`x` and `y` range from `0` to `1`; `zoom` ranges from `1` to `3`. When `crop`
is omitted it defaults to centered at `1×`. Video, missing, or upload-pending
media returns HTTP 400.

```http
DELETE /api/admin/v1/characters/:id/profile-image
```

Clearing the profile resets the crop but keeps the media row available for
reuse. Profile images are optional in the current release; making them
required during character creation is deferred.

## Persona input

Persona titles are free text so operators can add character-specific sections.
The Admin UI offers fourteen standard blocks as presets, listed here in their
conventional order (Korean label in parentheses is UI-only — the stored title is
the key):

- `identity` (기본 프로필): role, occupation, and basic self-image
- `appearance` (외형): stable appearance
- `personality` (성격): temperament and emotional expression
- `values` (가치관): what the character prizes and refuses, sponsorship stance
  included
- `social_style` (대인 반응): responses to other people
- `emotions` (감정·대인): emotional responses and how the character treats others
- `voice` (말투): vocabulary, sentence length, names, and prohibited expressions
- `world` (배경): background and living environment
- `relationships` (관계): named people and organizations around the character
- `preferences` (취향): likes and dislikes
- `goals` (목표): ongoing goals
- `boundaries` (가드레일): behavior rules, public-comment rules included
- `greeting` (첫인사): the message the character opens a conversation with
- `examples` (대화 예시): example dialogue, free-form `유저:` / `캐릭터:` lines

Each block should cover one concern. Structured role and injection metadata
control prompt selection; a title alone does not insert a block into every Agent
or content-planning prompt. Do not number the titles — ordering is `sortOrder` alone.
Account concept, image style, caption style, and production constraints belong
to `GET/PUT /api/admin/v1/characters/:id/content-profile`, separate from persona.

Write only statements that stay true if the character moves to another system.
Cadence and channel ("주 1회 릴스") belong to posting policy, not persona.

```http
POST /api/admin/v1/characters/:id/personas
Content-Type: application/json

{ "title": "voice", "content": "짧고 다정한 반말을 쓴다." }
```

Custom titles such as `"photography philosophy"` are also accepted, and older
custom titles keep working.

## Canon memory input

Character memories are established facts about the character. Keep one fact in
each item. Do not put guesses, temporary feelings, or memories about a specific
user here; relationship memory is managed separately by the Agent.

Allowed `type` values:

- `fact`: general established fact
- `preference`: likes, dislikes, and tastes
- `relationship`: relationships with people or organizations
- `event`: canonical past event
- `routine`: recurring habit or routine
- `goal`: ongoing goal

`reason` records why or from where the memory was entered; it is not the memory
type. Existing rows are migrated as `type: "fact"`.

```http
POST /api/admin/v1/characters/:id/memory
Content-Type: application/json

{
  "content": "매주 토요일 아침 필름을 현상한다.",
  "type": "routine",
  "reason": "운영자 초기 설정"
}
```

The bulk endpoint accepts the same fields per item:

```http
POST /api/admin/v1/characters/:id/memory/bulk
Content-Type: application/json

{
  "items": [
    {
      "content": "한강 야경 촬영을 좋아한다.",
      "type": "preference",
      "reason": "초기 설정"
    }
  ]
}
```

## Visual profile

The visual profile holds the character's appearance/style prompts and reference
images used by the media generation pipeline
(`docs/media-generation-pipeline.md`).

```http
GET /api/admin/v1/characters/:id/visual-profile
```

Returns the profile, or an empty default (all prompts `""`, no references)
before one is saved:

```json
{
  "characterId": "0190d8d1-463b-7e36-a9ef-0242ac120003",
  "appearancePrompt": "young woman, short black hair",
  "stylePrompt": "film photography, Kodak Portra",
  "negativePrompt": "blurry",
  "referenceMedia": [
    {
      "mediaId": "0190d8d1-463b-7e36-a9ef-0242ac120020",
      "url": "https://cdn.example.com/ref-1.png",
      "sortOrder": 10
    }
  ],
  "updatedAt": "2026-07-12T00:00:00.000Z"
}
```

```http
PUT /api/admin/v1/characters/:id/visual-profile
Content-Type: application/json

{ "appearancePrompt": "...", "stylePrompt": "...", "negativePrompt": "..." }
```

Upserts the prompts (each at most 4000 characters; omitted fields become `""`).
An optional `providerConfig` JSON object stores provider-specific settings
(LoRA id, seed).

```http
PUT /api/admin/v1/characters/:id/visual-profile/references
Content-Type: application/json

{ "mediaIds": ["<media uuid>", "..."] }
```

Replaces the reference set (array order = display order, 20 at most). Every
media id must be upload-confirmed image media; unconfirmed media returns HTTP
400 `Media upload is not confirmed`.

```http
POST /api/admin/v1/characters/:id/visual-profile/test-generation
Content-Type: application/json

{ "scene": "walking on a beach at sunset" }
```

Compiles `appearancePrompt, scene, stylePrompt` into one prompt and enqueues a
queued image generation job for the worker. Returns
`{ "jobId": "...", "prompt": "...", "status": "queued" }`. Requires at least
one non-empty prompt part.


### 캐릭터 비주얼 촬영 분석·색인

`POST /api/admin/v1/characters/:id/visual-profile/composition-index` (관리자 인증, body 없음)은
활성 비주얼의 누락된 `person-composition-v1` 분석과 임베딩을 채운다. 연결 SNS 미디어도 같은 기준으로
분석·재색인한다. 실제 이미지 분석과 임베딩 호출이 발생하며, 현재 버전·모델의 결과는 재사용한다.
응답은 `{ character: { analyzed, indexed, total, model }, sourceCount }`다. 항목별 결과를 즉시 저장하므로
한 요청에서 최대 3장의 누락 분석을 처리한다. 중간 실패 후 다시 호출하면 완료한 항목은 재사용한다.
`GET`의 동일 경로는 `{ model, total, analyzed, indexed }`로 활성 비주얼의 준비 상태를 반환한다.

`GET .../visual-profile`의 referenceMedia에 nullable `compositionAnalysis: { version, model, content }`가 추가된다.
content는 personCount와 framing/faceDirection/bodyDirection/pose/hands/gaze/camera/placement/occlusion이다.
관찰할 수 없는 문자열 항목은 null이며 기존 정체성 description과 분리한다. 기존 임베딩 컬럼은 이 분석의
검색 텍스트를 담는다. 설명·분석 변경과 경합한 늦은 저장은 409로 거부한다.
