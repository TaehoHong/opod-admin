# Admin Payments API

모든 API는 관리자 세션 쿠키 인증을 요구한다. 변경 요청은 `x-opod-admin`
헤더가 필요하고, Origin이 있으면 요청 대상 origin과 정확히 일치해야 한다.
기본 경로는 `/api/admin/v1`이다.

The reconciliation view walks `credit_purchases` and reads its evidence from
`credit_ledger` and `credit_refund`. Schema ownership belongs to
`opod-service-backend`; `npm run schema:check` guards the copy in
`src/core/database/schema.ts`.

## List payment reconciliation

```http
GET /api/admin/v1/payments/reconciliation?status=mismatch&from=<iso>&to=<iso>
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
GET /api/admin/v1/payments/:id
```

Returns the purchase with the same optional payment fields plus purchase
timestamps.

## Run a reconciliation repair

```http
POST /api/admin/v1/payments/reconciliation/actions
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
  returns the recorded ledger amounts without another grant/recovery; replayed
  `debtAdded` is `0`, rather than a reconstruction of the first response. Reusing
  the reference for a different purchase is `409`.
- `recover_completed_refund` writes `credit_refund:<refundId>` per refund,
  because both this view and the service credit code read recovery state from
  that reference. Replaying it after every refund is recovered returns `409`
  (`No incomplete refund recovery found`) rather than the original receipt.

정산 복구 액션 4종은 현재 구현되어 있다. 원장은 기존 지급 행을 수정하지 않고
`grant` 또는 `refund_recovery` 행을 추가한다. 같은 사용자와 정산 참조에 대한
트랜잭션 잠금 후 `external_reference` UNIQUE 제약을 사용한다. 지급분보다 큰
회수는 유료 잔액에서 미수로 나타나며 `UnsettledCreditDebt.identityHash`를 쓰는
별도 작업으로 해석하지 않는다.

2026-08-06 미러 동기화 인수인계의 ‘복구 액션 제거’는 당시 상태다. 이 문서의
현재 API 계약과 구분한다. 당시 운영 데이터 존재 여부와 실제 화면 확인은
미확인이었으며, 이 코드 검증이 과거 운영 데이터의 보존 또는 소실을 판정하지 않는다.
