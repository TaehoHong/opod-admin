# Admin Characters API

All endpoints require an admin JWT.

## List characters

```http
GET /api/characters?status=active&limit=20&cursor=<cursor>
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
GET /api/characters/:id
```

The detail response includes the same `postCount` and `followerCount` fields in
addition to existing `personas` and `memories`.

## Visual profile

The visual profile holds the character's appearance/style prompts and reference
images used by the media generation pipeline
(`docs/media-generation-pipeline.md`).

```http
GET /api/characters/:id/visual-profile
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
PUT /api/characters/:id/visual-profile
Content-Type: application/json

{ "appearancePrompt": "...", "stylePrompt": "...", "negativePrompt": "..." }
```

Upserts the prompts (each at most 4000 characters; omitted fields become `""`).
An optional `providerConfig` JSON object stores provider-specific settings
(LoRA id, seed).

```http
PUT /api/characters/:id/visual-profile/references
Content-Type: application/json

{ "mediaIds": ["<media uuid>", "..."] }
```

Replaces the reference set (array order = display order, 5 at most). Every
media id must be upload-confirmed image media; unconfirmed media returns HTTP
400 `Media upload is not confirmed`.

```http
POST /api/characters/:id/visual-profile/test-generation
Content-Type: application/json

{ "scene": "walking on a beach at sunset" }
```

Compiles `appearancePrompt, scene, stylePrompt` into one prompt and enqueues a
queued image generation job for the worker. Returns
`{ "jobId": "...", "prompt": "...", "status": "queued" }`. Requires at least
one non-empty prompt part.
