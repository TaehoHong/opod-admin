# Admin Post Comment List API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an authenticated, optionally author-filtered, cursor-paginated list of comments for one post.

**Architecture:** Add one read method to the existing `AdminService`, reusing `hasPost`, `toPostComment`, and shared page helpers. Add one nested GET route to `AdminController`; no new module, service, schema, or response type is needed.

**Tech Stack:** NestJS 10, TypeScript 5.7, Prisma 7, Jest 29, Supertest 7

## Global Constraints

- Preserve and exclude existing uncommitted `packages/admin` changes.
- Validate that the parent post exists before listing comments.
- Validate a cursor within the active post and optional author filter.
- Keep default limit 20, maximum 50, and newest-first deterministic ordering.
- Add no comment detail/update/delete/count API or unrelated refactor.

---

### Task 1: Add Comment Listing to AdminService with TDD

**Files:**

- Modify: `src/admin/admin.service.spec.ts`
- Modify: `src/admin/admin.service.ts`

**Interfaces:**

- Consumes: `PageInput`, `Page`, `decodeCursor`, `pageFromRows`, `hasPost`, `toPostComment`.
- Produces: `AdminService.listPostComments(input: { postId: string; characterId?: string } & PageInput): Promise<Page<AdminPostComment>>`.

- [ ] **Step 1: Add failing filtered-pagination test**

Create a concrete `createdAt`, encoded `comment-cursor`, two comment rows, and
mocks for `post.findUnique`, `postComment.findFirst`, and
`postComment.findMany`. Assert:

```typescript
await expect(
  service.listPostComments({
    postId: "post-1",
    characterId: " ai-1 ",
    cursor,
    limit: 1,
  }),
).resolves.toEqual({
  items: [
    {
      id: "comment-2",
      postId: "post-1",
      characterId: "ai-1",
      body: "newer",
      createdAt: createdAt.toISOString(),
    },
  ],
  nextCursor: expect.any(String),
});
expect(findFirst).toHaveBeenCalledWith({
  where: { id: "comment-cursor", postId: "post-1", characterId: "ai-1" },
  select: { id: true },
});
expect(findMany).toHaveBeenCalledWith({
  where: { postId: "post-1", characterId: "ai-1" },
  orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  take: 2,
  cursor: { id: "comment-cursor" },
  skip: 1,
});
```

- [ ] **Step 2: Add failing missing-parent and invalid-cursor tests**

```typescript
await expect(
  service.listPostComments({ postId: "missing-post", limit: 20 }),
).rejects.toThrow("Post not found");

await expect(
  service.listPostComments({
    postId: "post-1",
    cursor,
    limit: 20,
  }),
).rejects.toThrow("Invalid cursor");
```

For the missing-parent test, mock `post.findUnique` as `null`. For the cursor
test, return an existing post and `null` from `postComment.findFirst`.

- [ ] **Step 3: Verify RED**

Run: `npx jest --watchman=false src/admin/admin.service.spec.ts --runInBand`

Expected: TypeScript `TS2339` because `listPostComments` does not exist.

- [ ] **Step 4: Add the minimal service method before createPostComment**

```typescript
async listPostComments(
  input: { postId: string; characterId?: string } & PageInput,
): Promise<Page<AdminPostComment>> {
  if (!(await this.hasPost(input.postId))) {
    throw new BadRequestException("Post not found");
  }
  const characterId = input.characterId?.trim();
  const where = {
    postId: input.postId,
    ...(characterId ? { characterId } : {}),
  };
  const cursorId = decodeCursor(input.cursor);
  if (
    cursorId &&
    !(await this.prisma.postComment.findFirst({
      where: { id: cursorId, ...where },
      select: { id: true },
    }))
  ) {
    throw new BadRequestException("Invalid cursor");
  }

  const comments = await this.prisma.postComment.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
  });
  return pageFromRows(
    comments.map((comment) => this.toPostComment(comment)),
    input.limit,
  );
}
```

- [ ] **Step 5: Verify GREEN**

Run: `npx jest --watchman=false src/admin/admin.service.spec.ts --runInBand`

Expected: all admin service tests pass.

### Task 2: Add the Nested HTTP Route with TDD

**Files:**

- Modify: `src/admin/admin.controller.spec.ts`
- Modify: `src/admin/admin.controller.ts`

**Interfaces:**

- Consumes: `AdminService.listPostComments` and `parsePageQuery`.
- Produces: `GET /api/posts/:id/comments`.

- [ ] **Step 1: Extend the controller mock and add failing HTTP test**

Add/reset `listPostComments` in the existing controller service mock, then add:

```typescript
it("forwards the post comment path, author filter, and pagination", async () => {
  listPostComments.mockResolvedValue({ items: [] });

  await request(app.getHttpServer())
    .get("/api/posts/post-1/comments")
    .query({ characterId: "ai-1", limit: "6" })
    .expect(200)
    .expect({ items: [] });

  expect(listPostComments).toHaveBeenCalledWith({
    postId: "post-1",
    characterId: "ai-1",
    limit: 6,
  });
});
```

- [ ] **Step 2: Verify RED outside the sandbox**

Run: `npx jest --watchman=false src/admin/admin.controller.spec.ts --runInBand`

Expected: the new request returns HTTP 404.

- [ ] **Step 3: Add the controller method after getPost**

```typescript
@Get("posts/:id/comments")
listPostComments(
  @Param("id") postId: string,
  @Query("characterId") characterId?: string,
  @Query("cursor") cursor?: string,
  @Query("limit") limit?: string,
) {
  return this.adminService.listPostComments({
    postId,
    characterId,
    ...parsePageQuery(cursor, limit),
  });
}
```

- [ ] **Step 4: Verify GREEN outside the sandbox**

Run: `npx jest --watchman=false src/admin/admin.controller.spec.ts src/admin/admin.service.spec.ts --runInBand`

Expected: both suites pass.

### Task 3: Verify and Commit

**Files:**

- Verify: `src/admin/admin.controller.spec.ts`
- Verify: `src/admin/admin.controller.ts`
- Verify: `src/admin/admin.service.spec.ts`
- Verify: `src/admin/admin.service.ts`

**Interfaces:**

- Produces: one isolated comment-list implementation commit.

- [ ] **Step 1: Run targeted format, all tests, lint, and build**

```bash
npx prettier --check src/admin/admin.controller.spec.ts src/admin/admin.controller.ts src/admin/admin.service.spec.ts src/admin/admin.service.ts
npm run test -- --runInBand
npm run lint
npm run build
```

Expected: all commands exit 0; run tests outside the sandbox for the Nest port.

- [ ] **Step 2: Audit and stage only four files**

```bash
git status --short
git diff --check
git add src/admin/admin.controller.spec.ts src/admin/admin.controller.ts \
  src/admin/admin.service.spec.ts src/admin/admin.service.ts
git diff --cached --name-only
```

Expected: exactly those four cached paths and no `packages/admin` path.

- [ ] **Step 3: Commit and confirm isolation**

```bash
git diff --cached --check
git commit -m "feat: add admin post comment listing"
git status --short
git show --stat --oneline --summary HEAD
```

Expected: only the pre-existing four `packages/admin` modifications remain.
