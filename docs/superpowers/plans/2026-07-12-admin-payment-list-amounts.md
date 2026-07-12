# Admin Payment List Amount Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Include purchase credit and monetary amounts in every payment reconciliation list item.

**Architecture:** Extend the reconciliation response type, build common payment fields once in the existing row mapper, and preserve them through the final public projection. No query or controller changes are needed.

**Tech Stack:** NestJS 10, TypeScript 5.7, Prisma 7, Jest 29

## Global Constraints

- Preserve and exclude existing uncommitted `packages/admin` changes.
- Use fields already loaded on `CreditPurchase`; add no query or schema change.
- Include amounts in pending, paid, failed, canceled, and refunded branches.
- Keep all reconciliation status and reason behavior unchanged.

---

### Task 1: Add Amount Response Contracts with TDD

**Files:**

- Modify: `src/admin/admin.service.spec.ts`

**Interfaces:**

- Adds `creditAmount`, `paidAmount`, and `currency` to reconciliation items.

- [ ] **Step 1: Extend the existing paid mismatch expectation**

Add to the expected item:

```typescript
creditAmount: 100,
paidAmount: 9900,
currency: "KRW",
```

- [ ] **Step 2: Add a failing pending-row test**

Mock one pending purchase with `creditAmount: 50`, `paidAmount: 4900`, and
`currency: "KRW"`, no grant entry, and call
`listPaymentReconciliation({ status: "pending" })`. Expect:

```typescript
{
  items: [
    {
      paymentId: "purchase-pending",
      userId: "human-1",
      provider: "local",
      providerStatus: "pending",
      creditAmount: 50,
      paidAmount: 4900,
      currency: "KRW",
      ledgerStatus: "not_granted",
      reason: "payment pending",
    },
  ],
}
```

- [ ] **Step 3: Verify RED**

Run: `npx jest --watchman=false src/admin/admin.service.spec.ts --runInBand`

Expected: both expectations lack the three amount fields in received items.

### Task 2: Map Amounts Through Every Branch

**Files:**

- Modify: `src/admin/admin.service.ts`

**Interfaces:**

- Produces amount fields on `PaymentReconciliationItem` and every row branch.

- [ ] **Step 1: Extend `PaymentReconciliationItem`**

```typescript
creditAmount: number;
paidAmount: number;
currency: string;
```

- [ ] **Step 2: Create shared fields at the top of `toPaymentReconciliationRow`**

```typescript
const payment = {
  paymentId: purchase.id,
  userId: purchase.userId,
  provider: purchase.provider,
  providerStatus: purchase.status,
  creditAmount: purchase.creditAmount,
  paidAmount: purchase.paidAmount,
  currency: purchase.currency,
};
```

Replace the repeated identity fields in all three returns with `...payment`.

- [ ] **Step 3: Preserve fields in the public projection**

Add to the final `.map` in `listPaymentReconciliation`:

```typescript
creditAmount: item.creditAmount,
paidAmount: item.paidAmount,
currency: item.currency,
```

- [ ] **Step 4: Verify GREEN**

Run: `npx jest --watchman=false src/admin/admin.service.spec.ts --runInBand`

Expected: all admin service tests pass.

### Task 3: Verify and Commit

**Files:**

- Verify: `src/admin/admin.service.spec.ts`
- Verify: `src/admin/admin.service.ts`

**Interfaces:**

- Produces: one isolated payment-list amount implementation commit.

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
git commit -m "feat: add amounts to payment reconciliation"
```

Expected: no `packages/admin` path is staged.

- [ ] **Step 3: Confirm isolation**

Run: `git status --short && git show --stat --oneline --summary HEAD`

Expected: only the pre-existing four `packages/admin` modifications remain.
