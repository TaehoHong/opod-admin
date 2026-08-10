# 크레딧·결제 스키마 미러 동기화 — 인수인계

> 작성 2026-08-06. 다른 세션이 이 작업을 이어받기 위한 문서다.
> **변경은 워킹트리에만 있고 커밋되지 않았다.**

## 0. 한 줄 상태

정본(`opod-service-backend`)이 결제 도메인을 분리하며 크레딧 원장을 append-only로
바꿨고, admin 미러가 따라가지 못해 **크레딧·결제 화면이 존재하지 않는 테이블을
조회하던 상태**였다. 미러와 admin 코드를 새 구조로 옮겼고 선언된 검증은 전부
통과했다. 남은 것은 **제거된 "결제 정산 복구 액션" 4종에 대한 제품 결정**이다.

| 항목 | 값 |
| --- | --- |
| admin HEAD | `c098ab4` (커밋 없음, 워킹트리 21파일 수정) |
| 정본 HEAD | `opod-service-backend` `8f6e340` |
| 변경 규모 | 21 files, +589 / −913 |
| 커밋 여부 | **안 함** |

## 1. 왜 이 작업이 필요했나

정본 마이그레이션 `20260804025037_payment_credit_domains`가 옛 테이블 5개를
**데이터 이관 없이 DROP** 했다.

- `credit_ledger_entries`, `credit_accounts`, `credit_reconciliation_actions`,
  `credit_refund_allocations`, 그리고 `credit_refunds`의 일부 컬럼.

admin은 정본 스키마의 **부분 복사본(미러)** 을 들고 같은 DB에 직접 붙는다
(`scripts/check-schema-sync.mjs`, `npm run schema:check`). 미러가 갱신되지 않아
`npm run schema:check`가 11건 drift로 실패했고, 더 중요하게는 **admin 런타임이
이미 없는 테이블을 조회하고 있었다** — TypeScript 컴파일은 통과하므로 조용히
깨진 상태였다.

## 2. 구조 변경 요약

| 옛 구조 | 새 구조 |
| --- | --- |
| `CreditLedgerEntry.remainingAmount` (가변 컬럼) | `CreditLedger` + `CreditUsage` — **append-only**, 잔액은 파생 계산 |
| `CreditAccount.paidDebt` | 소멸 → 파생 `recoveryDebt` + `UnsettledCreditDebt` |
| `CreditRefundAllocation` | `CreditRefund` 스칼라(`lockedAmount`·`recoveryAmount`·`debtAmount`) + `CreditUsage` |
| `CreditPurchase`의 provider·금액·통화 | `Payment` 모델로 이동 |
| `CreditEntryType` (grant/debit) | `CreditLedgerType` (grant/usage/refund_recovery/adjustment) |
| `CreditPurchaseStatus.paid` | `completed` (+ `payment_processing`·`reversed` 추가) |
| `CreditRefundStatus` (DB 타입 `credit_refund_status`) | 6종 확대, DB 타입 `credit_refund_state` |
| `CreditReconciliationAction` | 소멸 (§4 참조) |

정본에서 그대로 복사해 온 신규 블록: `CreditProduct`, `PaymentProductMapping`,
`Payment`, `PaymentLedger`, `PaymentProviderEvent`, `CreditUsage` + 결제 enum 5종.

## 3. 수정한 파일

**스키마** — `prisma/schema.prisma` (74블록이 정본과 바이트 단위 일치)

**백엔드**

- `admin-credit-payment.repository.ts` — `creditLedgerEntry`→`creditLedger`,
  구매 조회에 `payment` include. 정산 복구 트랜잭션·세션 전체 삭제.
- `admin-user.repository.ts` — `getSpendableBalances`를 정본 `grantState` 방식으로
  재작성. `grant.amount − creditUsage 합`에 환불 회수·진행 중 환불 lock·adjustment 반영.
- `admin-analytics.repository.ts` — `sumCredits(types[])`로 변경.
- `admin.service.ts` — `entryType`→`type`, `paid`→`completed`, 결제 필드를
  `payment`에서 매핑(nullable), 정산 **탐지** 로직은 새 원장 기준으로 이식,
  `reconcilePayment` 삭제.
- `admin.controller.ts`, `dto/reconcile-payment.dto.ts` — 복구 엔드포인트·DTO 삭제.
- 스펙 3종 갱신 또는 삭제.

**프론트엔드** — `credits/api.ts`·`CreditsPage.tsx`(원장 4종 한글 라벨),
`payments/api.ts`·`labels.ts`(상태 7종), `PaymentDetailPanel.tsx`·`PaymentsPage.tsx`
(금액·수단 null 처리), `users/UserDetailModal.tsx`, 테스트 픽스처 2건.

**문서** — `docs/api/admin-payments.md`, `docs/07-codebase-guide.md`(Known Gaps).

## 4. 결정 대기 — 결제 정산 "복구 액션" 4종 제거

**현재 상태: 제거했고 승인받지 않았다.**

### 제거한 근거

1. 의존하던 구조 4개(`remaining_amount` 가변 컬럼, `credit_accounts`,
   `credit_refund_allocations`, `credit_reconciliation_actions`)가 DB에서 DROP됨.
2. 정본에서 지급·상태변경과 환불·회수가 **한 트랜잭션**으로 묶여, 이 복구가
   겨냥하던 실패 모드가 구조적으로 사라짐.
3. 옛 테이블이 이관 없이 삭제돼 레거시 데이터도 없음.

### 그대로 못 옮긴 결정적 이유

옛 기능의 안전성은 `CreditReconciliationAction.reference @unique`(멱등 재생)에
의존했다. 후계로 볼 수 있는 `PaymentLedger`에는 **unique reference가 없다**.
돈을 움직이는 admin 쓰기에서 멱등성을 조용히 잃는 선택은 추측으로 할 수 없어,
제거하고 보고하는 쪽을 택했다.

### 되살릴 경우의 설계 경로 (증거 기반)

- 멱등성: `CreditLedger.externalReference @unique`가 정본에 이미 있다.
- 감사 기록: `PaymentLedger`가 `adminId` FK + `type: adjustment` + `reason`/`details`를
  이미 갖고 있다.
- **미해결**: "부채"를 어디에 쓸지. `CreditAccount.paidDebt`의 후계인
  `UnsettledCreditDebt`는 키가 `userId`가 아니라 **`identityHash`** 라 의미가 다르다.
  이 지점은 `opod-service-backend`와 함께 정해야 한다.

### 유지된 것

정산 **탐지(조회)** 8종은 전부 유지했다. 이슈 코드 모두 새 구조에서 재도출되며,
`released_refund_has_recovery`만 새 enum에 맞춰 `canceled_refund_has_recovery`로
개명했다.

### 되돌리기 쉬운 보조 결정 2건

- `credits.debited` 지표를 `usage + refund_recovery` 합으로 정의했다(둘 다 양수라
  옛 `debit`와 부호가 일관). `usage`만으로 볼 수도 있다.
- 결제 목록의 "결제 상태"는 **구매 상태**(`CreditPurchaseStatus`)를 계속 쓴다.
  별도로 존재하는 `Payment.status`는 상세에 `paymentStatus`로 추가만 해뒀다.

## 5. 검증 결과 (2026-08-06, 재확인 완료)

| 명령 | 결과 |
| --- | --- |
| `npm run schema:check` | PASS — 74블록 일치 |
| `npm run db:generate` | PASS |
| `npm run lint` | PASS |
| `npm run test` | PASS — 30 suites / 278 tests |
| `npm run build` | PASS |
| `npm run admin:check` | PASS — 14 files / 36 tests |
| `npm run test:e2e` | PASS — 5 suites / 11 tests (Docker) |

e2e는 `prisma db push`로 새 미러를 실제 PostgreSQL에 생성한 뒤 돌기 때문에,
미러가 유효한 스키마라는 것까지 검증됐다.

`npm run format`은 `src/worker/*`와 `prompts/content-planner.ts` **7파일이 이번
작업 이전부터 실패** 상태다. 건드리지 않았다. 이번에 수정한 파일은 모두 통과한다.

## 6. 우려점

작업을 이어받기 전에 확인할 것들이다. 위험도 순.

### 6.1 운영 DB 데이터 손실 여부가 확인되지 않았다 (최우선)

정본 마이그레이션이 크레딧 테이블 5개를 **이관 없이 DROP** 했다. 정본 계획
문서(`opod-service-backend/.codex/pave/plans/payments-credits-iap.md`)는
"신규개발·기존 데이터 0건 전제"라고 적고 있으나, **실 운영 DB가 그 전제와
같은지는 이 작업에서 확인하지 못했다.**

운영 DB에 크레딧 원장 행이 있었다면 이미 소실됐다. 확인 방법: 운영 DB에서
`credit_ledger` 행 수와 `credit_purchases` 행 수를 비교하고, 백업 시점을 확인한다.
이건 admin 코드 문제가 아니라 **정본 마이그레이션 운영 문제**다.

### 6.2 런타임 검증을 하지 않았다

빌드·유닛·e2e는 통과하지만, **admin을 실제로 띄워서 크레딧·결제·유저 상세 화면이
동작하는지는 확인하지 않았다.** 특히 다음이 실측되지 않았다.

- `getSpendableBalances`의 파생 잔액 계산이 옛 `remainingAmount`와 같은 값을 내는지
- 결제 상세의 nullable 금액·수단 표시
- 정산 탐지 8종이 실제 데이터에서 오탐 없이 도는지

다음 세션은 `npm run dev`(또는 리포의 launch 설정)로 띄워서 이 세 화면을 먼저
눈으로 확인하는 것을 권한다.

### 6.3 커밋되지 않았다

21개 파일이 워킹트리에만 있다. 다른 브랜치로 이동하거나 `git checkout`을 하면
잃는다. 이어받는 세션은 **가장 먼저** 커밋하거나 `git stash`로 안전하게 보관할 것.

untracked `docs/mobile-responsive-plan.md`는 이 작업과 무관한 기존 파일이다.

### 6.4 정본이 다시 움직이면 또 어긋난다

정본 `8f6e340`의 커밋 메시지가 `chore: checkpoint payment catalog refactor` —
**"checkpoint"** 다. 결제 리팩터링이 아직 진행 중일 가능성이 있다. 이어받기 전에
`opod-service-backend`를 pull하고 `npm run schema:check`를 먼저 돌려서 이 문서의
전제가 유효한지 확인할 것.

### 6.5 admin의 크레딧 화면이 얼마나 오래 깨져 있었는지 모른다

정본 마이그레이션이 2026-08-04, 이 작업이 2026-08-06이다. 그 사이 admin에서
크레딧·결제 화면을 사용했다면 500 에러를 봤을 것이다. 운영자에게 증상 보고가
있었는지 확인하면 6.1의 데이터 손실 여부 판단에도 도움이 된다.

## 7. 다음 세션이 할 일 (순서대로)

1. **워킹트리 보전** — 커밋 또는 stash. (6.3)
2. **정본 최신 확인** — `opod-service-backend` pull 후 `npm run schema:check`. (6.4)
3. **운영 DB 데이터 손실 여부 확인.** (6.1)
4. **복구 액션 4종 제거를 승인받거나 재설계 결정.** (§4)
5. **런타임 검증** — 크레딧·결제·유저 상세 화면 실제 확인. (6.2)

## 관련 문서

- `docs/02-development-rules.md` — 미러 동기화 규칙
- `docs/07-codebase-guide.md` — Known Gaps 갱신됨
- `docs/api/admin-payments.md` — 결제 API 계약 갱신됨
- `opod-service-backend/.codex/pave/plans/payments-credits-iap.md` — 정본 측 설계 계획
