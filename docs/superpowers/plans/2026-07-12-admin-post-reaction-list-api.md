# Admin Post Reaction List API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an authenticated, filterable, cursor-paginated list of reactions for one post.

**Architecture:** Add one read method beside existing reaction creation in `AdminService`, reusing `hasPost`, `toPostReaction`, and shared page helpers. Add one nested GET route to `AdminController`; do not introduce new modules or types.

**Tech Stack:** NestJS 10, TypeScript 5.7, Prisma 7, Jest 29, Supertest 7

## Global Constraints

- Preserve and exclude existing uncommitted `packages/admin` changes.
- Validate the parent post and validate cursors inside all active filters.
- Trim optional `characterId` and `reactionType`; ignore blank filters.
- Use default limit 20, maximum 50, and newest-first deterministic ordering.
- Add no reaction detail/update/delete/count API or unrelated refactor.

---

### Task 1: Add Reaction Listing to AdminService with TDD

**Files:**

- Modify: `src/admin/admin.service.spec.ts`
- Modify: `src/admin/admin.service.ts`

**Interfaces:**

- Consumes: page helpers, `hasPost`, and `toPostReaction`.
- Produces: `AdminService.listPostReactions(input: { postId: string; characterId?: string; reactionType?: string } & PageInput): Promise<Page<AdminPostReaction>>`.

- [ ] **Step 1: Add failing filtered-pagination test**

Mock an existing post, a valid filtered cursor, and two concrete reaction rows.
Assert the converted first item and `nextCursor`, plus:

```typescript
expect(findFirst).toHaveBeenCalledWith({
  where: {
    id: "reaction-cursor",
    postId: "post-1",
    characterId: "ai-1",
    reactionType: "like",
  },
  select: { id: true },
});
expect(findMany).toHaveBeenCalledWith({
  where: {
    postId: "post-1",
    characterId: "ai-1",
    reactionType: "like",
  },
  orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  take: 2,
  cursor: { id: "reaction-cursor" },
  skip: 1,
});
```

The call uses trimmed inputs and `limit: 1`; expected output contains `id`,
`postId`, `characterId`, `reactionType`, and ISO `createdAt`.

- [ ] **Step 2: Add failing missing-parent and invalid-cursor tests**

```typescript
await expect(
  service.listPostReactions({ postId: "missing-post", limit: 20 }),
).rejects.toThrow("Post not found");

await expect(
  service.listPostReactions({
    postId: "post-1",
    cursor,
    limit: 20,
  }),
).rejects.toThrow("Invalid cursor");
```

- [ ] **Step 3: Verify RED**

Run: `npx jest --watchman=false src/admin/admin.service.spec.ts --runInBand`

Expected: `TS2339` because `listPostReactions` is missing.

- [ ] **Step 4: Add the minimal service method before createPostReaction**

```typescript
async listPostReactions(
  input: {
    postId: string;
    characterId?: string;
    reactionType?: string;
  } & PageInput,
): Promise<Page<AdminPostReaction>> {
  if (!(await this.hasPost(input.postId))) {
    throw new BadRequestException("Post not found");
  }
  const characterId = input.characterId?.trim();
  const reactionType = input.reactionType?.trim();
  const where = {
    postId: input.postId,
    ...(characterId ? { characterId } : {}),
    ...(reactionType ? { reactionType } : {}),
  };
  const cursorId = decodeCursor(input.cursor);
  if (
    cursorId &&
    !(await this.prisma.postReaction.findFirst({
      where: { id: cursorId, ...where },
      select: { id: true },
    }))
  ) {
    throw new BadRequestException("Invalid cursor");
  }

  const reactions = await this.prisma.postReaction.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
  });
  return pageFromRows(
    reactions.map((reaction) => this.toPostReaction(reaction)),
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

- Consumes: `AdminService.listPostReactions` and `parsePageQuery`.
- Produces: `GET /api/posts/:id/reactions`.

- [ ] **Step 1: Extend the service mock and add failing HTTP test**

Add/reset `listPostReactions`, then add:

```typescript
it("forwards the post reaction path, filters, and pagination", async () => {
  listPostReactions.mockResolvedValue({ items: [] });

  await request(app.getHttpServer())
    .get("/api/posts/post-1/reactions")
    .query({ characterId: "ai-1", reactionType: "like", limit: "8" })
    .expect(200)
    .expect({ items: [] });

  expect(listPostReactions).toHaveBeenCalledWith({
    postId: "post-1",
    characterId: "ai-1",
    reactionType: "like",
    limit: 8,
  });
});
```

- [ ] **Step 2: Verify RED outside sandbox**

Run: `npx jest --watchman=false src/admin/admin.controller.spec.ts --runInBand`

Expected: the new request returns HTTP 404.

- [ ] **Step 3: Add the controller method after listPostComments**

```typescript
@Get("posts/:id/reactions")
listPostReactions(
  @Param("id") postId: string,
  @Query("characterId") characterId?: string,
  @Query("reactionType") reactionType?: string,
  @Query("cursor") cursor?: string,
  @Query("limit") limit?: string,
) {
  return this.adminService.listPostReactions({
    postId,
    characterId,
    reactionType,
    ...parsePageQuery(cursor, limit),
  });
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

- Produces: one isolated reaction-list implementation commit.

- [ ] **Step 1: Verify targeted format, all tests, lint, and build**

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
git commit -m "feat: add admin post reaction listing"
```

Expected: exactly four implementation paths are committed; no `packages/admin`
path is staged.

- [ ] **Step 3: Confirm isolation**

Run: `git status --short && git show --stat --oneline --summary HEAD`

Expected: only the pre-existing four `packages/admin` modifications remain.
