# Admin User Counts and Balance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add user follow counts to list/detail and accurate spendable credit balance to detail.

**Architecture:** Extend the shared user select with a relation count and flatten it in `toAdminUser`. After a successful detail lookup, run active-grant and active-reservation aggregates with one timestamp and append a clamped balance.

**Tech Stack:** NestJS 10, TypeScript 5.7, Prisma 7, Jest 29

## Global Constraints

- Preserve and exclude existing uncommitted `packages/admin` changes.
- Keep balance detail-only; avoid per-row aggregates in list responses.
- Match service-backend active grant/reservation policy exactly.
- Use one `now` for both aggregate expiry filters and clamp below zero.
- Add no schema, controller, filtering, sorting, or UI changes.

---

### Task 1: Add User Follow Count Contract with TDD

**Files:**

- Modify: `src/admin/admin.service.spec.ts`
- Modify: `src/admin/admin.service.ts`

**Interfaces:**

- Adds `followCount: number` to `AdminUser`.

- [ ] **Step 1: Add failing list count test**

Mock `user.findMany` with a concrete user containing
`_count: { characterFollows: 7 }`, call `listUsers({ limit: 20 })`, and expect a
list item containing `followCount: 7` and ISO `createdAt`.

Assert the query includes:

```typescript
select: expect.objectContaining({
  _count: { select: { characterFollows: true } },
}),
```

- [ ] **Step 2: Verify RED**

Run: `npx jest --watchman=false src/admin/admin.service.spec.ts --runInBand`

Expected: expected `followCount` is absent.

- [ ] **Step 3: Extend types, select, and mapper**

Add `followCount: number` to `AdminUser`. Change `PrismaAdminUser` to omit
`followCount` and include:

```typescript
_count: {
  characterFollows: number;
}
```

Add to `userFields`:

```typescript
_count: { select: { characterFollows: true } },
```

Add to `toAdminUser`:

```typescript
followCount: user._count.characterFollows,
```

- [ ] **Step 4: Verify list GREEN**

Run: `npx jest --watchman=false src/admin/admin.service.spec.ts --runInBand`

Expected: all admin service tests pass.

### Task 2: Add Detail Credit Balance with TDD

**Files:**

- Modify: `src/admin/admin.service.spec.ts`
- Modify: `src/admin/admin.service.ts`

**Interfaces:**

- Produces `AdminUserDetail = AdminUser & { creditBalance: number }` from `getUser`.

- [ ] **Step 1: Add failing balance policy test**

Mock a found user with follow count 7, grant aggregate sum 120, and active
reservation sum 12. Expect detail with `creditBalance: 108`.

Assert grant aggregate:

```typescript
{
  _sum: { remainingAmount: true },
  where: {
    userId: "user-1",
    entryType: "grant",
    OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
  },
}
```

Assert reservation aggregate:

```typescript
{
  _sum: { amount: true },
  where: {
    userId: "user-1",
    status: "reserved",
    expiresAt: { gt: expect.any(Date) },
  },
}
```

Read both captured `gt` dates from Jest mock calls and assert equal epoch times.

- [ ] **Step 2: Add failing clamp and missing-user tests**

For grant remainder 5 and reservations 7, expect `creditBalance: 0`.

For `user.findUnique` returning `null`, expect `User not found` and assert both
aggregate mocks were not called.

- [ ] **Step 3: Verify RED**

Run: `npx jest --watchman=false src/admin/admin.service.spec.ts --runInBand`

Expected: detail expectations fail because `creditBalance` is absent and
aggregate mocks are unused.

- [ ] **Step 4: Implement detail balance after successful user lookup**

Define:

```typescript
type AdminUserDetail = AdminUser & {
  creditBalance: number;
};
```

Change `getUser` return type and, after the not-found check, add:

```typescript
const now = new Date();
const [grants, reservations] = await Promise.all([
  this.prisma.creditLedgerEntry.aggregate({
    _sum: { remainingAmount: true },
    where: {
      userId,
      entryType: "grant",
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
  }),
  this.prisma.creditReservation.aggregate({
    _sum: { amount: true },
    where: {
      userId,
      status: "reserved",
      expiresAt: { gt: now },
    },
  }),
]);
return {
  ...this.toAdminUser(user),
  creditBalance: Math.max(
    0,
    (grants._sum.remainingAmount ?? 0) - (reservations._sum.amount ?? 0),
  ),
};
```

- [ ] **Step 5: Verify GREEN**

Run: `npx jest --watchman=false src/admin/admin.service.spec.ts --runInBand`

Expected: all admin service tests pass.

### Task 3: Verify and Commit

**Files:**

- Verify: `src/admin/admin.service.spec.ts`
- Verify: `src/admin/admin.service.ts`

**Interfaces:**

- Produces: one isolated user count/balance implementation commit.

- [ ] **Step 1: Run targeted format, all tests, lint, and build**

```bash
npx prettier --check src/admin/admin.service.spec.ts src/admin/admin.service.ts
npm run test -- --runInBand
npm run lint
npm run build
```

- [ ] **Step 2: Audit, stage, and commit only two files**

```bash
git status --short
git diff --check
git add src/admin/admin.service.spec.ts src/admin/admin.service.ts
git diff --cached --name-only
git diff --cached --check
git commit -m "feat: add admin user counts and balance"
```

Expected: no `packages/admin` path is staged.

- [ ] **Step 3: Confirm isolation**

Run: `git status --short && git show --stat --oneline --summary HEAD`

Expected: only the pre-existing four `packages/admin` modifications remain.
