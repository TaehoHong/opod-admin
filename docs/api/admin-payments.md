# Admin Payments API

All endpoints require an admin JWT.

## List payment reconciliation

```http
GET /api/payments/reconciliation?status=mismatch&from=<iso>&to=<iso>
```

Each reconciliation item includes purchase amounts:

```json
{
  "paymentId": "0190d8d1-463b-7e36-a9ef-0242ac120060",
  "userId": "0190d8d1-463b-7e36-a9ef-0242ac120050",
  "provider": "local",
  "providerStatus": "paid",
  "creditAmount": 100,
  "paidAmount": 9900,
  "currency": "KRW",
  "ledgerStatus": "missing_grant",
  "reason": "paid purchase has no credit grant"
}
```

`creditAmount` is the number of credits purchased. `paidAmount` uses the
smallest unit of `currency`. These fields are available for every provider and
reconciliation status.

## Get a payment

```http
GET /api/payments/:id
```

The existing detail response remains unchanged and includes the same amount
fields plus purchase timestamps.
