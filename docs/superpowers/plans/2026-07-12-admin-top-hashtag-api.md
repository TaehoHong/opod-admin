# Admin Top Hashtag API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded global hashtag ranking by linked post count.

**Architecture:** Query hashtag relation counts directly in `AdminService`, map them to an analytics DTO, and expose one guarded GET route. Reuse shared positive-limit validation but override its default to 10 at the controller boundary.

**Tech Stack:** NestJS 10, TypeScript 5.7, Prisma 7, Jest 29, Supertest 7

## Global Constraints

- Preserve and exclude existing uncommitted `packages/admin` changes.
- Use one Prisma query and no schema changes.
- Rank post count descending, hashtag name ascending; default 10, maximum 50.
- Add no cursor, date range, user preference score, or UI work.

---

### Task 1: Add Top Hashtag Service Query with TDD

**Files:**

- Modify: `src/admin/admin.service.spec.ts`
- Modify: `src/admin/admin.service.ts`

**Interfaces:**

- Produces: `AdminService.listTopHashtags(input: { limit: number }): Promise<{ items: Array<{ hashtag: string; postCount: number }> }>`.

- [ ] **Step 1: Add failing query/mapping test**

```typescript
it("lists top global hashtags by post count", async () => {
  const findMany = jest.fn().mockResolvedValue([
    { name: "opod", _count: { posts: 42 } },
    { name: "launch", _count: { posts: 18 } },
  ]);
  const service = new (
    AdminService as new (...args: unknown[]) => AdminService
  )(
    { hashtag: { findMany } },
    { enqueueJob: jest.fn(), startJob: jest.fn(), completeJob: jest.fn() },
    { startUpload: jest.fn(), confirmUpload: jest.fn() },
  );

  await expect(service.listTopHashtags({ limit: 10 })).resolves.toEqual({
    items: [
      { hashtag: "opod", postCount: 42 },
      { hashtag: "launch", postCount: 18 },
    ],
  });
  expect(findMany).toHaveBeenCalledWith({
    orderBy: [{ posts: { _count: "desc" } }, { name: "asc" }],
    take: 10,
    select: {
      name: true,
      _count: { select: { posts: true } },
    },
  });
});
```

- [ ] **Step 2: Verify RED**

Run: `npx jest --watchman=false src/admin/admin.service.spec.ts --runInBand`

Expected: `TS2339` because `listTopHashtags` is missing.

- [ ] **Step 3: Add minimal service method near hashtag preferences**

```typescript
async listTopHashtags(input: { limit: number }): Promise<{
  items: Array<{ hashtag: string; postCount: number }>;
}> {
  const hashtags = await this.prisma.hashtag.findMany({
    orderBy: [{ posts: { _count: "desc" } }, { name: "asc" }],
    take: input.limit,
    select: {
      name: true,
      _count: { select: { posts: true } },
    },
  });
  return {
    items: hashtags.map((hashtag) => ({
      hashtag: hashtag.name,
      postCount: hashtag._count.posts,
    })),
  };
}
```

- [ ] **Step 4: Verify GREEN**

Run: `npx jest --watchman=false src/admin/admin.service.spec.ts --runInBand`

Expected: all admin service tests pass.

### Task 2: Add Analytics HTTP Route with TDD

**Files:**

- Modify: `src/admin/admin.controller.spec.ts`
- Modify: `src/admin/admin.controller.ts`

**Interfaces:**

- Produces: `GET /api/analytics/hashtags?limit=10`.

- [ ] **Step 1: Extend mock and add failing default/explicit limit tests**

Add/reset `listTopHashtags`, then add two HTTP tests. The default test requests
`/api/analytics/hashtags` and expects `{ limit: 10 }`; the explicit test requests
`?limit=7` and expects `{ limit: 7 }`. Both return `{ items: [] }`.

```typescript
await request(app.getHttpServer())
  .get("/api/analytics/hashtags")
  .expect(200)
  .expect({ items: [] });
expect(listTopHashtags).toHaveBeenCalledWith({ limit: 10 });
```

- [ ] **Step 2: Verify RED outside sandbox**

Run: `npx jest --watchman=false src/admin/admin.controller.spec.ts --runInBand`

Expected: both new requests return HTTP 404.

- [ ] **Step 3: Add route before the existing analytics route**

```typescript
@Get("analytics/hashtags")
listTopHashtags(@Query("limit") limit?: string) {
  return this.adminService.listTopHashtags({
    limit: parsePageQuery(undefined, limit ?? "10").limit,
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

- Produces: one isolated top-hashtag implementation commit.

- [ ] **Step 1: Verify targeted format, all tests, lint, and build**

```bash
npx prettier --check src/admin/admin.controller.spec.ts src/admin/admin.controller.ts src/admin/admin.service.spec.ts src/admin/admin.service.ts
npm run test -- --runInBand
npm run lint
npm run build
```

- [ ] **Step 2: Audit, stage, and commit only four files**

```bash
git status --short
git diff --check
git add src/admin/admin.controller.spec.ts src/admin/admin.controller.ts \
  src/admin/admin.service.spec.ts src/admin/admin.service.ts
git diff --cached --name-only
git diff --cached --check
git commit -m "feat: add admin top hashtag analytics"
```

Expected: no `packages/admin` path is staged.

- [ ] **Step 3: Confirm isolation**

Run: `git status --short && git show --stat --oneline --summary HEAD`

Expected: only the pre-existing four `packages/admin` modifications remain.
