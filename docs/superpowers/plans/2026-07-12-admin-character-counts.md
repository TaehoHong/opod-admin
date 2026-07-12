# Admin Character Count Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add post and follower counts to existing character list and detail responses.

**Architecture:** Select Prisma relation counts with each character row and flatten them in the shared list-item mapper used by both endpoints. No controller or database changes are needed.

**Tech Stack:** NestJS 10, TypeScript 5.7, Prisma 7, Jest 29

## Global Constraints

- Preserve and exclude existing uncommitted `packages/admin` changes.
- Use Prisma `_count` in the existing query; no per-row queries or migrations.
- Add counts only to list/detail responses, not create/update/status receipts.
- Keep all existing filtering, pagination, personas, and memories behavior.

---

### Task 1: Add Count Contracts with TDD

**Files:**

- Modify: `src/characters/characters.service.spec.ts`

**Interfaces:**

- Produces expected `postCount` and `followerCount` fields for list and detail.

- [ ] **Step 1: Update the existing detail fixture and expectation**

Add this to the mocked character row:

```typescript
_count: { posts: 12, userFollowers: 340 },
```

Add these fields to the expected detail:

```typescript
postCount: 12,
followerCount: 340,
```

- [ ] **Step 2: Add a failing list selection/mapping test**

```typescript
it("lists character post and follower counts", async () => {
  const createdAt = new Date("2026-07-12T00:00:00.000Z");
  const findMany = jest.fn().mockResolvedValue([
    {
      id: "character-1",
      publicId: "mina_ai",
      displayName: "Mina",
      bio: "City walks",
      interests: ["art"],
      status: "active",
      createdAt,
      _count: { posts: 12, userFollowers: 340 },
    },
  ]);
  const service = new (
    CharactersService as new (...args: unknown[]) => CharactersService
  )({ character: { findMany } });

  await expect(
    service.listCharacters({ status: "active", limit: 20 }),
  ).resolves.toEqual({
    items: [
      {
        id: "character-1",
        publicId: "mina_ai",
        displayName: "Mina",
        bio: "City walks",
        interests: ["art"],
        status: "active",
        postCount: 12,
        followerCount: 340,
        createdAt: createdAt.toISOString(),
      },
    ],
  });
  expect(findMany).toHaveBeenCalledWith({
    where: { status: "active" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 21,
    select: expect.objectContaining({
      _count: { select: { posts: true, userFollowers: true } },
    }),
  });
});
```

- [ ] **Step 3: Verify RED**

Run: `npx jest --watchman=false src/characters/characters.service.spec.ts --runInBand`

Expected: list/detail expectations fail because count fields are absent.

### Task 2: Select and Map Counts

**Files:**

- Modify: `src/characters/characters.service.ts`

**Interfaces:**

- Produces flat numeric count fields from Prisma relation counts.

- [ ] **Step 1: Extend response and Prisma row types**

Add to `AdminCharacterListItem`:

```typescript
postCount: number;
followerCount: number;
```

Change `PrismaCharacterListItem` to:

```typescript
type PrismaCharacterListItem = Omit<
  AdminCharacterListItem,
  "createdAt" | "postCount" | "followerCount"
> & {
  createdAt: Date;
  _count: {
    posts: number;
    userFollowers: number;
  };
};
```

- [ ] **Step 2: Extend the shared select**

Add to `characterListFields`:

```typescript
_count: {
  select: {
    posts: true,
    userFollowers: true,
  },
},
```

- [ ] **Step 3: Flatten counts in `toCharacterListItem`**

```typescript
postCount: character._count.posts,
followerCount: character._count.userFollowers,
```

- [ ] **Step 4: Verify GREEN**

Run: `npx jest --watchman=false src/characters/characters.service.spec.ts --runInBand`

Expected: all character service tests pass.

### Task 3: Verify and Commit

**Files:**

- Verify: `src/characters/characters.service.spec.ts`
- Verify: `src/characters/characters.service.ts`

**Interfaces:**

- Produces: one isolated character-count implementation commit.

- [ ] **Step 1: Run format, all tests, lint, and build**

```bash
npx prettier --check src/characters/characters.service.spec.ts src/characters/characters.service.ts
npm run test -- --runInBand
npm run lint
npm run build
```

- [ ] **Step 2: Audit, stage, and commit only two files**

```bash
git status --short
git diff --check
git add src/characters/characters.service.spec.ts src/characters/characters.service.ts
git diff --cached --name-only
git diff --cached --check
git commit -m "feat: add admin character counts"
```

Expected: no `packages/admin` path is staged.

- [ ] **Step 3: Confirm isolation**

Run: `git status --short && git show --stat --oneline --summary HEAD`

Expected: only the pre-existing four `packages/admin` modifications remain.
