# Call Flow, Billing & Withdrawal — Acceptance Tests

Companion to `CALL_FLOW_AND_BILLING_ANALYSIS.md`. Run on a native build with two
devices (fan + creator). Record balances before/after each minute.

## Setup
- Fan spendable = ₹100, creator earnings = ₹0, platform wallet = known value.
- Creator rate audio = ₹10/min, video = ₹20/min, commission = 15%.

## Billing
| ID | Step | Expected |
|----|------|----------|
| B-1 | Fan starts audio call, creator accepts, fan media joins | Exactly **one** ₹10 debit. `total_amount=10`, `last_billed_minute=1`. `platform_commissions` gains one `CALL_COMMISSION` (amount ₹1.50, gross ₹10, model ₹8.50, minute 1). Creator `earnings_balance` +₹8.50. Platform wallet +₹1.50 |
| B-2 | Wait 60s | Second debit ₹10. Commission doc minute 2. Creator earnings +₹8.50 again. No double debit at the boundary (server loop + client backup) |
| B-3 | Wait 3 minutes total | Fan −₹30, creator +₹25.50, platform +₹4.50, three commission docs |
| B-4 | Fan balance = ₹6 at start | Minute 1 billed; at next boundary no balance → `ENDED_INSUFFICIENT_BALANCE` for both; creator paid for minutes actually billed; no negative balance |
| B-5 | Kill the fan app mid-call (2 min in) | Sweeper/finalize runs. Creator already has 2-minute credits (immediate), so nothing is lost. Call finalizes; creator returns ACTIVE |
| B-6 | End call | No additional `CALL_CREDIT`/`COMMISSION` beyond the per-minute docs. One `CALL_DEBIT` summary for the fan. No double credit |

## Live wallets
| ID | Step | Expected |
|----|------|----------|
| W-1 | Fan opens call screen | Fan sees `bal` = wallet balance (fetched on join, not ₹0) |
| W-2 | Creator opens call screen | Creator sees live **earnings** balance |
| W-3 | Each minute boundary | Fan `bal` drops by rate; creator earnings rises by 85% *on screen* within ~1s of the event |
| W-4 | Gift ₹100 from fan | Fan −₹100; creator earnings +₹85 (15% gift commission); `GIFT_COMMISSION` doc ₹15; both screens update |

## Withdrawal
| ID | Step | Expected |
|----|------|----------|
| D-1 | Withdraw ₹99 (if min ₹250) | Blocked with the minimum message |
| D-2 | Withdraw > earnings | HTTP 402, earnings unchanged |
| D-3 | Withdraw without bank details | Blocked: complete bank details required |
| D-4 | Withdraw without UPI | Blocked: UPI required |
| D-5 | Valid withdrawal | Earnings drop by amount (held); PENDING doc has `upi_id` + `bank_details`; `WITHDRAW_HOLD` ledger row; bank/UPI saved on profile |
| D-6 | Reopen withdrawal screen | Bank name / account / IFSC / holder / UPI pre-filled from profile |
| D-7 | Exceed daily request cap | Blocked with the per-day message |
| D-8 | Admin marks paid | Status PAID + push + Updates row |
| D-9 | Admin rejects | Earnings refunded once; `WITHDRAW_REVERSED` row; push + Updates |
| D-10 | Admin marks error with refund | Earnings refunded; status FAILED |

## Commission ledger
| ID | Step | Expected |
|----|------|----------|
| C-1 | One recharge ₹500 | `RECHARGE_COMMISSION` ₹30 (6%), user credited ₹470 |
| C-2 | One 2-min ₹10 call | Two `CALL_COMMISSION` docs, ₹1.50 each |
| C-3 | One ₹100 gift | One `GIFT_COMMISSION` doc, ₹15 |
| C-4 | Admin financial page | Recharge / Call / Gift commission totals and rows visible |

## Regression
| ID | Check |
|----|-------|
| R-1 | No `CALL_CREDIT` is created at end when per-minute credits exist |
| R-2 | Replaying `/bill-minute` at the same minute debits once |
| R-3 | `platform_commissions` has no duplicate `(source_id, minute, type)` |
| R-4 | Reconnect grace does not double-bill or double-credit |
