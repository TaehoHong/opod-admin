# Admin Payments API

All endpoints require an admin JWT.

The reconciliation view walks `credit_purchases` and reads its evidence from
`credit_ledger` and `credit_refund`. Schema ownership belongs to
`opod-service-backend`; `npm run schema:check` guards the copy in
`prisma/schema.prisma`.

## List payment reconciliation

```http
GET /api/payments/reconciliation?status=mismatch&from=<iso>&to=<iso>
```

```json
{
  "paymentId": "0190d8d1-463b-7e36-a9ef-0242ac120060",
  "userId": "0190d8d1-463b-7e36-a9ef-0242ac120050",
  "provider": "local",
  "providerStatus": "completed",
  "paymentStatus": "paid",
  "creditAmount": 100,
  "paidAmount": 9900,
  "currency": "KRW",
  "ledgerStatus": "missing_grant",
  "reason": "paid purchase has no credit grant"
}
```

`paymentId` is the credit purchase id. `providerStatus` is the purchase
lifecycle status (`pending`, `payment_processing`, `completed`, `failed`,
`canceled`, `refunded`, `reversed`) — a purchase is settled at `completed`.
`paymentStatus` is the provider-side status from the linked `payments` row.

`provider`, `paymentStatus`, `paidAmount`, and `currency` come from that
`payments` row and are **omitted** when a purchase has no payment yet (a
purchase created before checkout). `creditAmount` is the number of credits
purchased; `paidAmount` uses the smallest unit of `currency`.

### Issue codes

| code                                | meaning                                              |
| ----------------------------------- | ---------------------------------------------------- |
| `paid_missing_grant`                | completed purchase has no base grant                 |
| `paid_grant_amount_mismatch`        | base grant amount ≠ purchase credit amount           |
| `duplicate_base_grant`              | completed purchase has more than one base grant      |
| `nonpaid_has_grant`                 | non-completed purchase has a grant                   |
| `refunded_without_completed_refund` | refunded purchase has no completed refund            |
| `refund_missing_recovery`           | completed refund has no `refund_recovery` ledger row |
| `canceled_refund_has_recovery`      | canceled refund has a recovery ledger row            |
| `refund_total_exceeds_payment`      | completed refunds exceed the paid amount             |

## Get a payment

```http
GET /api/payments/:id
```

Returns the purchase with the same optional payment fields plus purchase
timestamps.

## Run a reconciliation repair

```http
POST /api/payments/reconciliation/actions
```

```json
{
  "purchaseId": "0190d8d1-463b-7e36-a9ef-0242ac120060",
  "action": "grant_missing_purchase",
  "reference": "repair-2026-08-10-1",
  "reason": "provider settled but grant was lost"
}
```

Repairs write credit ledger rows only — credits are never taken back by editing
a grant. `grant_missing_purchase` inserts the missing `grant` row; the three
`recover_*` actions insert a `refund_recovery` row scoped to the purchase, and
any part of the recovery that exceeds the purchase's remaining grants shows up
as a negative paid balance (reported as `debtAdded`).

Idempotency rides on the `credit_ledger.external_reference` unique constraint:

- `grant_missing_purchase`, `recover_nonpaid_grants`, `recover_duplicate_grants`
  write `credit_reconciliation:<reference>`. Replaying the same reference
  returns the original receipt; reusing it for a different purchase is `409`.
- `recover_completed_refund` writes `credit_refund:<refundId>` per refund,
  because both this view and the service credit code read recovery state from
  that reference. Replaying it after every refund is recovered returns `409`
  (`No incomplete refund recovery found`) rather than the original receipt.
