# Admin Story Read API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add authenticated, character-filtered story listing and single-story lookup.

**Architecture:** Keep reads in `AdminService` and reuse the existing `AdminStory`, `PrismaStory`, `toStory`, and media relation. Use shared cursor helpers for the list and add two GET routes to `AdminController`.

**Tech Stack:** NestJS 10, TypeScript 5.7, Prisma 7, Jest 29, Supertest 7

## Global Constraints

- Preserve and exclude existing uncommitted `packages/admin` changes.
- Add no expiry-state filter, mutation, schema change, or UI work.
- Keep the story creation response shape for list and detail reads.
- Use default limit 20, maximum 50, newest-first deterministic ordering, and filtered cursor validation.

---

### Task 1: Add Story List and Detail Reads with TDD

**Files:**

- Modify: `src/admin/admin.service.spec.ts`
- Modify: `src/admin/admin.service.ts`

**Interfaces:**

- Consumes: page helpers and `toStory`.
- Produces: `listStories(input: { characterId?: string } & PageInput): Promise<Page<AdminStory>>` and `getStory(storyId: string): Promise<AdminStory>`.

- [ ] **Step 1: Add failing filtered-pagination and invalid-cursor tests**

Use concrete dates, media, an encoded `story-cursor`, and two rows. Assert:

```typescript
await expect(
  service.listStories({
    characterId: " ai-1 ",
    cursor,
    limit: 1,
  }),
).resolves.toEqual({
  items: [
    {
      id: "story-2",
      characterId: "ai-1",
      caption: "newer",
      media: {
        mediaType: "image",
        url: "https://cdn.local/story.png",
        width: 1080,
        height: 1920,
      },
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    },
  ],
  nextCursor: expect.any(String),
});
expect(findFirst).toHaveBeenCalledWith({
  where: { id: "story-cursor", characterId: "ai-1" },
  select: { id: true },
});
expect(findMany).toHaveBeenCalledWith({
  where: { characterId: "ai-1" },
  orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  take: 2,
  cursor: { id: "story-cursor" },
  skip: 1,
  include: { media: true },
});
```

For invalid cursor, return `null` from `story.findFirst` and expect
`Invalid cursor`.

- [ ] **Step 2: Add failing detail success and missing tests**

Mock `story.findUnique` with a concrete story and `null`, then assert the
converted story and:

```typescript
expect(findUnique).toHaveBeenCalledWith({
  where: { id: "story-1" },
  include: { media: true },
});

await expect(service.getStory("missing-story")).rejects.toThrow(
  "Story not found",
);
```

- [ ] **Step 3: Verify RED**

Run: `npx jest --watchman=false src/admin/admin.service.spec.ts --runInBand`

Expected: `TS2339` for missing `listStories` and `getStory`.

- [ ] **Step 4: Add the minimal methods before createStory**

```typescript
async listStories(
  input: { characterId?: string } & PageInput,
): Promise<Page<AdminStory>> {
  const characterId = input.characterId?.trim();
  const where = characterId ? { characterId } : {};
  const cursorId = decodeCursor(input.cursor);
  if (
    cursorId &&
    !(await this.prisma.story.findFirst({
      where: { id: cursorId, ...where },
      select: { id: true },
    }))
  ) {
    throw new BadRequestException("Invalid cursor");
  }

  const stories = await this.prisma.story.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    include: { media: true },
  });
  return pageFromRows(
    stories.map((story) => this.toStory(story)),
    input.limit,
  );
}

async getStory(storyId: string): Promise<AdminStory> {
  const story = await this.prisma.story.findUnique({
    where: { id: storyId },
    include: { media: true },
  });
  if (!story) {
    throw new BadRequestException("Story not found");
  }
  return this.toStory(story);
}
```

- [ ] **Step 5: Verify GREEN**

Run: `npx jest --watchman=false src/admin/admin.service.spec.ts --runInBand`

Expected: all admin service tests pass.

### Task 2: Add Story GET Routes with TDD

**Files:**

- Modify: `src/admin/admin.controller.spec.ts`
- Modify: `src/admin/admin.controller.ts`

**Interfaces:**

- Consumes: `AdminService.listStories`, `AdminService.getStory`, `parsePageQuery`.
- Produces: `GET /api/stories` and `GET /api/stories/:id`.

- [ ] **Step 1: Extend mocks and add failing HTTP tests**

Add/reset `listStories` and `getStory`, then add:

```typescript
it("forwards story filters and pagination", async () => {
  listStories.mockResolvedValue({ items: [] });

  await request(app.getHttpServer())
    .get("/api/stories")
    .query({ characterId: "ai-1", limit: "5" })
    .expect(200)
    .expect({ items: [] });

  expect(listStories).toHaveBeenCalledWith({
    characterId: "ai-1",
    limit: 5,
  });
});

it("forwards the story detail ID", async () => {
  getStory.mockResolvedValue({ id: "story-1" });
  await request(app.getHttpServer())
    .get("/api/stories/story-1")
    .expect(200)
    .expect({ id: "story-1" });
  expect(getStory).toHaveBeenCalledWith("story-1");
});
```

- [ ] **Step 2: Verify RED outside sandbox**

Run: `npx jest --watchman=false src/admin/admin.controller.spec.ts --runInBand`

Expected: both new requests return HTTP 404.

- [ ] **Step 3: Add controller methods before createStory**

```typescript
@Get("stories")
listStories(
  @Query("characterId") characterId?: string,
  @Query("cursor") cursor?: string,
  @Query("limit") limit?: string,
) {
  return this.adminService.listStories({
    characterId,
    ...parsePageQuery(cursor, limit),
  });
}

@Get("stories/:id")
getStory(@Param("id") storyId: string) {
  return this.adminService.getStory(storyId);
}
```

- [ ] **Step 4: Verify GREEN outside sandbox**

Run: `npx jest --watchman=false src/admin/admin.controller.spec.ts src/admin/admin.service.spec.ts --runInBand`

Expected: both suites pass.

### Task 3: Verify and Commit

**Files:**

- Verify: `src/admin/admin.controller.spec.ts`
- Verify: `src/admin/admin.controller.ts`
- Verify: `src/admin/admin.service.spec.ts`
- Verify: `src/admin/admin.service.ts`

**Interfaces:**

- Produces: one isolated story-read implementation commit.

- [ ] **Step 1: Run targeted format, all tests, lint, and build**

```bash
npx prettier --check src/admin/admin.controller.spec.ts src/admin/admin.controller.ts src/admin/admin.service.spec.ts src/admin/admin.service.ts
npm run test -- --runInBand
npm run lint
npm run build
```

Expected: all commands exit 0; tests run outside sandbox for the Nest port.

- [ ] **Step 2: Audit, stage, and commit only four files**

```bash
git status --short
git diff --check
git add src/admin/admin.controller.spec.ts src/admin/admin.controller.ts \
  src/admin/admin.service.spec.ts src/admin/admin.service.ts
git diff --cached --name-only
git diff --cached --check
git commit -m "feat: add admin story read APIs"
```

Expected: exactly four implementation files are committed with no
`packages/admin` path.

- [ ] **Step 3: Confirm isolation**

Run: `git status --short && git show --stat --oneline --summary HEAD`

Expected: only the pre-existing four `packages/admin` modifications remain.
