# Admin Post Read API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add authenticated, documented admin endpoints for cursor-paginated post listing and single-post lookup.

**Architecture:** Keep post reads in the existing `AdminController` and `AdminService`, reusing `postWithMedia`, `toPost`, and the shared cursor helpers. Add no schema changes or new service/module abstractions; the list query applies exact optional filters and the detail query returns the same post representation as creation.

**Tech Stack:** NestJS 10, TypeScript 5.7, Prisma 7, Jest 29, Supertest 7

## Global Constraints

- Protect both endpoints with the existing controller-level `AdminJwtGuard`.
- Preserve uncommitted user changes under `packages/admin`; do not stage or edit them.
- Do not add database migrations or modify the mirrored Prisma schema.
- Reuse the existing `AdminPost` response shape, media ordering, hashtag ordering, cursor format, default page limit 20, and maximum page limit 50.
- Do not add comment/reaction counts, embedded character data, UI changes, or unrelated refactors.

---

## File Map

- `docs/api/admin-posts.md`: operator-facing endpoint and response contract.
- `src/admin/admin.service.spec.ts`: observable list/detail behavior and error contracts.
- `src/admin/admin.service.ts`: Prisma list/detail reads and optional content type parsing.
- `src/admin/admin.controller.spec.ts`: HTTP route, query parsing, guard override, and response forwarding contract.
- `src/admin/admin.controller.ts`: `GET /api/posts` and `GET /api/posts/:id` routes.

### Task 1: Publish the Post Read API Reference

**Files:**
- Create: `docs/api/admin-posts.md`

**Interfaces:**
- Consumes: Existing JWT bearer authentication, page envelope, and `AdminPost` shape.
- Produces: Stable documentation for `GET /api/posts` and `GET /api/posts/:id` used by admin UI implementers.

- [ ] **Step 1: Write the API reference**

Create `docs/api/admin-posts.md` with this complete content:

````markdown
# Admin Posts API

All endpoints require an admin JWT:

```http
Authorization: Bearer <admin-jwt>
```

## List posts

```http
GET /api/posts?characterId=<uuid>&contentType=feed&limit=20&cursor=<cursor>
```

Every query parameter is optional.

| Parameter | Values | Behavior |
| --- | --- | --- |
| `characterId` | character UUID | Exact match |
| `contentType` | `feed`, `reel` | Exact match |
| `limit` | positive integer | Default 20, maximum 50 |
| `cursor` | cursor returned by this endpoint | Reads the next page with the same filters |

Posts are ordered newest first by `createdAt`, then `id`. A successful response
is:

```json
{
  "items": [
    {
      "id": "0190d8d1-463b-7e36-a9ef-0242ac120002",
      "characterId": "0190d8d1-463b-7e36-a9ef-0242ac120003",
      "contentType": "feed",
      "content": "A new post",
      "media": [
        {
          "mediaType": "image",
          "url": "https://cdn.example.com/post.jpg",
          "width": 1080,
          "height": 1080
        }
      ],
      "hashtags": ["launch", "opod"],
      "createdAt": "2026-07-12T00:00:00.000Z"
    }
  ],
  "nextCursor": "eyJpZCI6IjAxOTBkOGQxLTQ2M2ItN2UzNi1hOWVmLTAyNDJhYzEyMDAwMiJ9"
}
```

`nextCursor` is absent on the last page. Reusing a cursor with filters that do
not contain that cursor post returns HTTP 400 `Invalid cursor`.

## Get a post

```http
GET /api/posts/:id
```

The response is one post in the same shape as an item from the list endpoint.
A missing post returns HTTP 400 `Post not found`.

## Validation errors

| Condition | Status | Message |
| --- | --- | --- |
| `contentType` is not `feed` or `reel` | 400 | `Post content type must be feed or reel` |
| `limit` is not a positive integer | 400 | `limit must be a positive integer` |
| `cursor` is malformed or outside the active filters | 400 | `Invalid cursor` |
````

- [ ] **Step 2: Check documentation formatting**

Run: `git diff --check -- docs/api/admin-posts.md`

Expected: exit 0 with no whitespace errors.

### Task 2: Add Cursor-Paginated Post Listing with TDD

**Files:**
- Modify: `src/admin/admin.service.spec.ts`
- Modify: `src/admin/admin.service.ts`

**Interfaces:**
- Consumes: `PageInput`, `decodeCursor`, `pageFromRows`, `postWithMedia`, `toPost`, and `parsePostContentType`.
- Produces: `AdminService.listPosts(input: { characterId?: string; contentType?: string } & PageInput): Promise<Page<AdminPost>>`.

- [ ] **Step 1: Write the failing filtered-pagination test**

Add this test to `src/admin/admin.service.spec.ts`:

```typescript
  it("lists filtered posts with cursor pagination", async () => {
    const createdAt = new Date("2026-07-12T00:00:00.000Z");
    const cursor = Buffer.from(JSON.stringify({ id: "post-cursor" }), "utf8")
      .toString("base64url");
    const findFirst = jest.fn().mockResolvedValue({ id: "post-cursor" });
    const findMany = jest.fn().mockResolvedValue([
      {
        id: "post-2",
        characterId: "ai-1",
        contentType: "feed",
        content: "newer",
        createdAt,
        postMedia: [
          {
            media: {
              mediaType: "image",
              url: "https://cdn.local/newer.png",
              width: 1080,
              height: 1080,
              durationSeconds: null,
            },
          },
        ],
        hashtags: [{ hashtag: { name: "launch" } }],
      },
      {
        id: "post-1",
        characterId: "ai-1",
        contentType: "feed",
        content: "older",
        createdAt,
        postMedia: [],
        hashtags: [],
      },
    ]);
    const service = new (
      AdminService as new (...args: unknown[]) => AdminService
    )(
      { post: { findFirst, findMany } },
      { enqueueJob: jest.fn(), startJob: jest.fn(), completeJob: jest.fn() },
      { startUpload: jest.fn(), confirmUpload: jest.fn() },
    );

    await expect(
      service.listPosts({
        characterId: " ai-1 ",
        contentType: " feed ",
        cursor,
        limit: 1,
      }),
    ).resolves.toEqual({
      items: [
        {
          id: "post-2",
          characterId: "ai-1",
          contentType: "feed",
          content: "newer",
          media: [
            {
              mediaType: "image",
              url: "https://cdn.local/newer.png",
              width: 1080,
              height: 1080,
            },
          ],
          hashtags: ["launch"],
          createdAt: createdAt.toISOString(),
        },
      ],
      nextCursor: expect.any(String),
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: "post-cursor", characterId: "ai-1", contentType: "feed" },
      select: { id: true },
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { characterId: "ai-1", contentType: "feed" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 2,
      cursor: { id: "post-cursor" },
      skip: 1,
      include: {
        postMedia: {
          include: { media: true },
          orderBy: { sortOrder: "asc" },
        },
        hashtags: {
          include: { hashtag: true },
          orderBy: { hashtag: { name: "asc" } },
        },
      },
    });
  });
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npx jest src/admin/admin.service.spec.ts --runInBand`

Expected: FAIL during TypeScript compilation because `AdminService` has no
`listPosts` method.

- [ ] **Step 3: Implement the minimal list method**

Add this public method immediately before `createPost` in
`src/admin/admin.service.ts`:

```typescript
  async listPosts(
    input: { characterId?: string; contentType?: string } & PageInput,
  ): Promise<Page<AdminPost>> {
    const characterId = input.characterId?.trim();
    const contentType = input.contentType?.trim()
      ? this.parsePostContentType(input.contentType.trim())
      : undefined;
    const where = {
      ...(characterId ? { characterId } : {}),
      ...(contentType ? { contentType } : {}),
    };
    const cursorId = decodeCursor(input.cursor);
    if (
      cursorId &&
      !(await this.prisma.post.findFirst({
        where: { id: cursorId, ...where },
        select: { id: true },
      }))
    ) {
      throw new BadRequestException("Invalid cursor");
    }

    const posts = await this.prisma.post.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      include: postWithMedia,
    });
    return pageFromRows(
      posts.map((post) => this.toPost(post)),
      input.limit,
    );
  }
```

- [ ] **Step 4: Run the focused service test and verify GREEN**

Run: `npx jest src/admin/admin.service.spec.ts --runInBand`

Expected: PASS with the new list test included.

- [ ] **Step 5: Write the failing cursor and content-type error tests**

Add these tests to `src/admin/admin.service.spec.ts`:

```typescript
  it("rejects a post cursor outside the active filters", async () => {
    const cursor = Buffer.from(JSON.stringify({ id: "post-cursor" }), "utf8")
      .toString("base64url");
    const service = new (
      AdminService as new (...args: unknown[]) => AdminService
    )(
      {
        post: {
          findFirst: jest.fn().mockResolvedValue(null),
          findMany: jest.fn(),
        },
      },
      { enqueueJob: jest.fn(), startJob: jest.fn(), completeJob: jest.fn() },
      { startUpload: jest.fn(), confirmUpload: jest.fn() },
    );

    await expect(
      service.listPosts({ characterId: "ai-1", cursor, limit: 20 }),
    ).rejects.toThrow("Invalid cursor");
  });

  it("rejects an invalid post list content type", async () => {
    const service = new (
      AdminService as new (...args: unknown[]) => AdminService
    )(
      { post: { findFirst: jest.fn(), findMany: jest.fn() } },
      { enqueueJob: jest.fn(), startJob: jest.fn(), completeJob: jest.fn() },
      { startUpload: jest.fn(), confirmUpload: jest.fn() },
    );

    await expect(
      service.listPosts({ contentType: "article", limit: 20 }),
    ).rejects.toThrow("Post content type must be feed or reel");
  });
```

- [ ] **Step 6: Run the tests and verify the new edge cases**

Run: `npx jest src/admin/admin.service.spec.ts --runInBand`

Expected: PASS. The cursor test proves filtered cursor validation and the
content type test proves reuse of existing domain validation.

### Task 3: Add Single-Post Lookup with TDD

**Files:**
- Modify: `src/admin/admin.service.spec.ts`
- Modify: `src/admin/admin.service.ts`

**Interfaces:**
- Consumes: `postWithMedia` and `toPost`.
- Produces: `AdminService.getPost(postId: string): Promise<AdminPost>`.

- [ ] **Step 1: Write the failing detail and missing-post tests**

Add these tests to `src/admin/admin.service.spec.ts`:

```typescript
  it("gets a post with the admin post representation", async () => {
    const createdAt = new Date("2026-07-12T00:00:00.000Z");
    const findUnique = jest.fn().mockResolvedValue({
      id: "post-1",
      characterId: "ai-1",
      contentType: "reel",
      content: "detail",
      createdAt,
      postMedia: [
        {
          media: {
            mediaType: "video",
            url: "https://cdn.local/detail.mp4",
            width: 1080,
            height: 1920,
            durationSeconds: 15,
          },
        },
      ],
      hashtags: [{ hashtag: { name: "detail" } }],
    });
    const service = new (
      AdminService as new (...args: unknown[]) => AdminService
    )(
      { post: { findUnique } },
      { enqueueJob: jest.fn(), startJob: jest.fn(), completeJob: jest.fn() },
      { startUpload: jest.fn(), confirmUpload: jest.fn() },
    );

    await expect(service.getPost("post-1")).resolves.toEqual({
      id: "post-1",
      characterId: "ai-1",
      contentType: "reel",
      content: "detail",
      media: [
        {
          mediaType: "video",
          url: "https://cdn.local/detail.mp4",
          width: 1080,
          height: 1920,
          durationSeconds: 15,
        },
      ],
      hashtags: ["detail"],
      createdAt: createdAt.toISOString(),
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: "post-1" },
      include: {
        postMedia: {
          include: { media: true },
          orderBy: { sortOrder: "asc" },
        },
        hashtags: {
          include: { hashtag: true },
          orderBy: { hashtag: { name: "asc" } },
        },
      },
    });
  });

  it("rejects a missing post detail", async () => {
    const service = new (
      AdminService as new (...args: unknown[]) => AdminService
    )(
      { post: { findUnique: jest.fn().mockResolvedValue(null) } },
      { enqueueJob: jest.fn(), startJob: jest.fn(), completeJob: jest.fn() },
      { startUpload: jest.fn(), confirmUpload: jest.fn() },
    );

    await expect(service.getPost("missing-post")).rejects.toThrow(
      "Post not found",
    );
  });
```

- [ ] **Step 2: Run the service tests and verify RED**

Run: `npx jest src/admin/admin.service.spec.ts --runInBand`

Expected: FAIL during TypeScript compilation because `AdminService` has no
`getPost` method.

- [ ] **Step 3: Implement the minimal detail method**

Add this method immediately after `listPosts` in `src/admin/admin.service.ts`:

```typescript
  async getPost(postId: string): Promise<AdminPost> {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: postWithMedia,
    });
    if (!post) {
      throw new BadRequestException("Post not found");
    }
    return this.toPost(post);
  }
```

- [ ] **Step 4: Run the service tests and verify GREEN**

Run: `npx jest src/admin/admin.service.spec.ts --runInBand`

Expected: PASS with all list/detail cases.

### Task 4: Expose and Verify the HTTP Routes

**Files:**
- Create: `src/admin/admin.controller.spec.ts`
- Modify: `src/admin/admin.controller.ts`

**Interfaces:**
- Consumes: `AdminService.listPosts`, `AdminService.getPost`, and `parsePageQuery`.
- Produces: `GET /api/posts` and `GET /api/posts/:id` under `AdminJwtGuard`.

- [ ] **Step 1: Write failing HTTP contract tests**

Create `src/admin/admin.controller.spec.ts`:

```typescript
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { AdminJwtGuard } from "./auth/admin-jwt.guard";

describe("AdminController post reads", () => {
  let app: INestApplication;
  const listPosts = jest.fn();
  const getPost = jest.fn();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        {
          provide: AdminService,
          useValue: { listPosts, getPost },
        },
      ],
    })
      .overrideGuard(AdminJwtGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    listPosts.mockReset();
    getPost.mockReset();
  });

  afterAll(async () => {
    await app.close();
  });

  it("forwards post list filters and parsed pagination", async () => {
    listPosts.mockResolvedValue({ items: [] });

    await request(app.getHttpServer())
      .get("/api/posts")
      .query({ characterId: "ai-1", contentType: "feed", limit: "7" })
      .expect(200)
      .expect({ items: [] });

    expect(listPosts).toHaveBeenCalledWith({
      characterId: "ai-1",
      contentType: "feed",
      limit: 7,
    });
  });

  it("forwards the post detail ID", async () => {
    getPost.mockResolvedValue({ id: "post-1" });

    await request(app.getHttpServer())
      .get("/api/posts/post-1")
      .expect(200)
      .expect({ id: "post-1" });

    expect(getPost).toHaveBeenCalledWith("post-1");
  });
});
```

- [ ] **Step 2: Run the controller test and verify RED**

Run: `npx jest src/admin/admin.controller.spec.ts --runInBand`

Expected: FAIL because the controller does not register either GET route, so
the HTTP requests return 404.

- [ ] **Step 3: Add the two controller methods**

Add these methods immediately before the existing `createPost` method in
`src/admin/admin.controller.ts`:

```typescript
  @Get("posts")
  listPosts(
    @Query("characterId") characterId?: string,
    @Query("contentType") contentType?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.adminService.listPosts({
      characterId,
      contentType,
      ...parsePageQuery(cursor, limit),
    });
  }

  @Get("posts/:id")
  getPost(@Param("id") postId: string) {
    return this.adminService.getPost(postId);
  }
```

- [ ] **Step 4: Run controller and service tests and verify GREEN**

Run: `npx jest src/admin/admin.controller.spec.ts src/admin/admin.service.spec.ts --runInBand`

Expected: PASS with both suites and all post read cases.

### Task 5: Verify and Commit the Feature

**Files:**
- Verify: `docs/api/admin-posts.md`
- Verify: `docs/superpowers/specs/2026-07-12-admin-post-read-api-design.md`
- Verify: `src/admin/admin.controller.spec.ts`
- Verify: `src/admin/admin.controller.ts`
- Verify: `src/admin/admin.service.spec.ts`
- Verify: `src/admin/admin.service.ts`

**Interfaces:**
- Consumes: All deliverables from Tasks 1-4.
- Produces: One independently verified feature commit, excluding user-owned admin UI changes.

- [ ] **Step 1: Run formatting checks**

Run: `npm run format`

Expected: exit 0 and no formatting differences.

- [ ] **Step 2: Run the complete unit suite**

Run: `npm run test -- --runInBand`

Expected: exit 0 with zero failed suites and zero failed tests.

- [ ] **Step 3: Run lint**

Run: `npm run lint`

Expected: exit 0 with no lint errors.

- [ ] **Step 4: Run the production build**

Run: `npm run build`

Expected: exit 0.

- [ ] **Step 5: Audit the exact diff and protected user changes**

Run: `git status --short && git diff --check && git diff --stat`

Expected: only the six feature files above plus the pre-existing four modified
files under `packages/admin`; no generated files, schema changes, or unrelated
source changes.

- [ ] **Step 6: Stage only the post read feature**

Run:

```bash
git add docs/api/admin-posts.md \
  docs/superpowers/specs/2026-07-12-admin-post-read-api-design.md \
  src/admin/admin.controller.spec.ts \
  src/admin/admin.controller.ts \
  src/admin/admin.service.spec.ts \
  src/admin/admin.service.ts
```

Expected: `git diff --cached --name-only` contains exactly those six paths and
does not contain any `packages/admin` path.

- [ ] **Step 7: Re-run staged diff validation and commit**

Run: `git diff --cached --check && git diff --cached --stat && git commit -m "feat: add admin post read APIs"`

Expected: validation exits 0 and the commit succeeds.

- [ ] **Step 8: Confirm commit isolation**

Run: `git status --short && git show --stat --oneline --summary HEAD`

Expected: the new commit contains only the six feature files; the four
pre-existing `packages/admin` modifications remain unstaged and preserved.
