# Admin Payment List Amount Fields Design

## Goal

Expose purchase credit and monetary amounts in payment reconciliation list
items so operators do not need one detail request per row.

## Scope

This change adds `creditAmount`, `paidAmount`, and `currency` to every item from
`GET /api/payments/reconciliation`. It does not change reconciliation logic,
filters, detail responses, provider integration, schemas, or admin UI.

## Chosen Approach

`listPaymentReconciliation` already loads complete `CreditPurchase` rows,
including all three fields. `toPaymentReconciliationRow` creates a shared base
payment object and spreads it into pending, paid, and other-status branches.
No query or controller change is required.

Fetching detail per item would create N+1 requests. Adding a second database
query would duplicate data already present in memory.

## API Contract

Every reconciliation item adds:

```json
{
  "creditAmount": 100,
  "paidAmount": 9900,
  "currency": "KRW"
}
```

`creditAmount` is the purchased credit quantity. `paidAmount` is expressed in
the smallest unit of `currency`, matching payment detail and stored purchase
fields. All existing provider, ledger, reconciliation, and reason fields remain
unchanged.

## Testing

The existing paid-without-grant reconciliation test is extended to require all
three fields. A focused test also verifies a pending row receives the same
fields, protecting all branch-independent mapping. Full tests, lint, targeted
formatting, and build are required before the isolated implementation commit.

## Change Boundaries

Only payment API documentation, `AdminService`, and focused tests change.
Existing `packages/admin` modifications remain untouched and excluded.
