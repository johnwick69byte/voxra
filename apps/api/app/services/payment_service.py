"""Recharge payments via KwikUPI with crash-safe, idempotent wallet credit.

Economics: the platform keeps ``recharge_commission_rate`` (default 6%, split
3% gateway + 3% service) of every recharge. The user is credited the remainder
(94%). Every credited recharge writes a document to ``platform_commissions``.

KwikUPI has no sandbox. A wallet credit is only applied after the server asks
KwikUPI's payment-status API and verifies the order id, payment id, status and
actual paid amount. Webhook bodies are signature-verified but are never trusted
for the paid amount on their own.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Dict, Optional
from urllib.parse import quote

from app.core.config import get_settings
from app.core.database import get_db
from app.core.database_redis import get_redis, idempotency_key
from app.core.socket import emit_to_user
from app.services import kwikupi_service, wallet_service

logger = logging.getLogger(__name__)

PLATFORM_WALLET_ID = "platform_001"
_CENT = Decimal("0.01")


def _decimal_amount(value: Any) -> Decimal:
    if isinstance(value, bool):
        raise ValueError("Invalid amount")
    text = str(value).replace(",", "").strip()
    if text.startswith("₹"):
        text = text[1:].strip()
    try:
        amount = Decimal(text)
    except (InvalidOperation, ValueError) as exc:
        raise ValueError("Invalid amount") from exc
    if not amount.is_finite():
        raise ValueError("Invalid amount")
    return amount


def normalize_recharge_amount(amount: Any) -> float:
    """Validate a user-entered recharge amount and round it to paise."""
    settings = get_settings()
    value = _decimal_amount(amount).quantize(_CENT, rounding=ROUND_HALF_UP)
    minimum = _decimal_amount(settings.min_recharge_amount)
    maximum = _decimal_amount(settings.max_recharge_amount)
    if value < minimum:
        raise ValueError(f"Minimum recharge is ₹{minimum:.0f}")
    if value > maximum:
        raise ValueError(f"Maximum recharge is ₹{maximum:.0f}")
    return float(value)


def split_recharge(amount: float) -> dict:
    """Split a gross recharge into the user credit and platform commission parts."""
    settings = get_settings()
    gross = _decimal_amount(amount).quantize(_CENT, rounding=ROUND_HALF_UP)
    total_commission = (gross * _decimal_amount(settings.recharge_commission_rate)).quantize(
        _CENT, rounding=ROUND_HALF_UP
    )
    gateway = (gross * _decimal_amount(settings.recharge_gateway_rate)).quantize(
        _CENT, rounding=ROUND_HALF_UP
    )
    service = (total_commission - gateway).quantize(_CENT, rounding=ROUND_HALF_UP)
    credit_amount = (gross - total_commission).quantize(_CENT, rounding=ROUND_HALF_UP)
    return {
        "original_amount": float(gross),
        "credit_amount": float(credit_amount),
        "total_commission": float(total_commission),
        "gateway_commission": float(gateway),
        "service_commission": float(service),
    }


async def initiate_recharge(*, user: dict, amount: float, package_id: Optional[str] = None) -> dict:
    """Create a live KwikUPI payment page for a recharge order."""
    settings = get_settings()
    if not kwikupi_service.configured():
        raise ValueError(
            "Recharge is temporarily unavailable because the payment gateway is not configured."
        )

    if package_id:
        pkg = next((p for p in wallet_service.RECHARGE_PACKAGES if p["id"] == package_id), None)
        if not pkg:
            raise ValueError("Invalid recharge package")
        gross = normalize_recharge_amount(pkg["amount"])
    else:
        gross = normalize_recharge_amount(amount)

    order_id = f"ord_{uuid.uuid4().hex[:14]}"
    tx_id = f"tx_recharge_{order_id}"
    db = get_db()
    now = datetime.now(timezone.utc)

    await db.transactions.insert_one(
        {
            "transaction_id": tx_id,
            "user_id": user["user_id"],
            "type": "RECHARGE_PENDING",
            "amount": gross,
            "description": f"Recharge ₹{gross:.2f}",
            "metadata": {
                "order_id": order_id,
                "base_amount": gross,
                "package_id": package_id,
                "status": "PENDING",
                "gateway": "kwikupi",
                "gateway_environment": "live",
                "created_for_verification": True,
                "initiated_at": now,
            },
            "created_at": now,
        }
    )

    return_url = settings.kwikupi_return_url or (
        f"{settings.backend_url.rstrip('/')}/api/wallet/recharge/return"
    )
    separator = "&" if "?" in return_url else "?"
    redirect_url = f"{return_url}{separator}order_id={quote(order_id, safe='')}"

    try:
        gateway = await kwikupi_service.create_payment(
            order_id=order_id,
            amount=gross,
            customer_name=user.get("name") or "Simple Talk user",
            customer_email=user.get("email") if "@" in str(user.get("email") or "") else None,
            redirect_url=redirect_url,
        )
    except Exception as exc:
        await db.transactions.update_one(
            {"transaction_id": tx_id},
            {
                "$set": {
                    "metadata.status": "FAILED",
                    "metadata.failure_reason": "GATEWAY_CREATE_FAILED",
                    "metadata.failed_at": datetime.now(timezone.utc),
                }
            },
        )
        logger.exception("KwikUPI order creation failed for %s", order_id)
        raise ValueError("Could not start payment. Please try again.") from exc

    payment_id = str(gateway["payment_id"]).strip()
    payment_url = str(gateway["payment_page"]).strip()

    # Persist the gateway identifiers before returning the URL. If this update
    # fails, do not hand the user a live payment page we cannot settle.
    try:
        await db.transactions.update_one(
            {"transaction_id": tx_id},
            {
                "$set": {
                    "metadata.payment_id": payment_id,
                    "metadata.payment_url": payment_url,
                    "metadata.gateway_status": "CREATED",
                    "metadata.last_checked_at": now,
                }
            },
        )
    except Exception as exc:
        logger.exception("Could not persist KwikUPI payment id for %s", order_id)
        try:
            await db.transactions.update_one(
                {"transaction_id": tx_id},
                {
                    "$set": {
                        "metadata.status": "FAILED",
                        "metadata.failure_reason": "PAYMENT_ID_PERSIST_FAILED",
                        "metadata.failed_at": datetime.now(timezone.utc),
                    }
                },
            )
        except Exception:
            logger.exception("Could not mark failed recharge %s", order_id)
        raise ValueError("Could not start payment. Please try again.") from exc

    splits = split_recharge(gross)
    return {
        "success": True,
        "order_id": order_id,
        "transaction_id": tx_id,
        "payment_id": payment_id,
        "payment_url": payment_url,
        "amount": gross,
        "credit_amount": splits["credit_amount"],
        "commission": splits["total_commission"],
    }


async def _claim_order(order_id: str, *, allow_reverify: bool) -> Optional[dict]:
    """Atomically claim a pending recharge for processing. Returns the transaction or None."""
    db = get_db()
    tx = await db.transactions.find_one({"metadata.order_id": order_id}, {"_id": 0})
    if not tx:
        return None
    if tx.get("type") == "RECHARGE" or (tx.get("metadata") or {}).get("status") == "SUCCESS":
        return None

    claimable = ["PENDING"]
    if allow_reverify:
        claimable.append("PROCESSING")
    claimed = await db.transactions.find_one_and_update(
        {
            "transaction_id": tx["transaction_id"],
            "type": "RECHARGE_PENDING",
            "metadata.order_id": order_id,
            "metadata.status": {"$in": claimable},
        },
        {
            "$set": {
                "metadata.status": "PROCESSING",
                "metadata.processing_at": datetime.now(timezone.utc),
            }
        },
        return_document=True,
    )
    return claimed


async def _mark_review(
    order_id: str,
    reason: str,
    payment: Dict[str, Any],
    *,
    paid_amount: Optional[float] = None,
) -> None:
    db = get_db()
    payment_id = str(payment.get("payment_id") or "")
    await db.transactions.update_one(
        {
            "metadata.order_id": order_id,
            "type": "RECHARGE_PENDING",
            "metadata.status": {"$in": ["PENDING", "PROCESSING", "REVIEW"]},
        },
        {
            "$set": {
                "metadata.status": "REVIEW",
                "metadata.review_reason": reason,
                "metadata.gateway_status": kwikupi_service.payment_status(payment),
                "metadata.gateway_payment_id": payment_id or None,
                "metadata.gateway_amount": paid_amount,
                "metadata.reviewed_at": datetime.now(timezone.utc),
                "metadata.last_checked_at": datetime.now(timezone.utc),
            }
        },
    )
    logger.critical(
        "Recharge %s requires review (%s): gateway status=%s amount=%s",
        order_id,
        reason,
        payment.get("status"),
        payment.get("amount"),
    )


def _validate_success_payment(order: dict, payment: Dict[str, Any]) -> tuple[bool, str, Optional[float]]:
    """Validate the authoritative gateway status against the stored order."""
    if not kwikupi_service.is_success(payment):
        return False, "NOT_SUCCESS", None

    metadata = order.get("metadata") or {}
    order_id = str(metadata.get("order_id") or "")
    gateway_order_id = str(payment.get("order_id") or "")
    if not gateway_order_id or gateway_order_id != order_id:
        return False, "ORDER_ID_MISMATCH", None

    stored_payment_id = str(metadata.get("payment_id") or "")
    gateway_payment_id = str(payment.get("payment_id") or "")
    if not gateway_payment_id:
        return False, "PAYMENT_ID_MISSING", None
    if stored_payment_id and gateway_payment_id != stored_payment_id:
        return False, "PAYMENT_ID_MISMATCH", None

    raw_amount = payment.get("amount")
    if raw_amount is None or str(raw_amount).strip() == "":
        return False, "AMOUNT_MISSING", None
    try:
        paid = _decimal_amount(raw_amount).quantize(_CENT, rounding=ROUND_HALF_UP)
        expected = _decimal_amount(order.get("amount")).quantize(_CENT, rounding=ROUND_HALF_UP)
    except ValueError:
        return False, "AMOUNT_INVALID", None
    if paid != expected:
        return False, "AMOUNT_MISMATCH", float(paid)
    return True, "", float(paid)


async def _pay_first_recharge_referral(user_id: str) -> None:
    """Best-effort referral bonus; idempotent in referral_service."""
    try:
        from app.services import referral_service

        await referral_service.maybe_pay_first_recharge_bonus(user_id)
    except Exception:
        logger.exception("referral bonus failed for %s", user_id)


async def process_order_success(
    order_id: str,
    *,
    verified_payment: Dict[str, Any],
    gateway_transaction_id: Optional[str] = None,
) -> dict:
    """Idempotently credit a verified successful order.

    Safe to call from the signed webhook, the return page, the in-app verify
    call, or the background reconciler at the same time: the order status claim
    prevents duplicate work and the wallet credit itself is atomic + idempotent.
    """
    db = get_db()
    r = get_redis()

    tx = await db.transactions.find_one({"metadata.order_id": order_id}, {"_id": 0})
    if not tx:
        return {"success": False, "status": "NOT_FOUND", "message": "Order not found"}
    if tx.get("type") == "RECHARGE" or (tx.get("metadata") or {}).get("status") == "SUCCESS":
        await _pay_first_recharge_referral(tx["user_id"])
        wallet = await wallet_service.get_wallet(tx["user_id"])
        return {
            "success": True,
            "status": "SUCCESS",
            "message": "Already credited",
            "already": True,
            "balance": wallet.get("balance", 0),
            "credited": (tx.get("metadata") or {}).get("credit_amount"),
        }

    valid, reason, paid_amount = _validate_success_payment(tx, verified_payment)
    if not valid:
        await _mark_review(order_id, reason, verified_payment, paid_amount=paid_amount)
        return {
            "success": False,
            "status": "REVIEW",
            "message": "Payment could not be automatically credited and needs review",
            "reason": reason,
        }

    claimed = await _claim_order(order_id, allow_reverify=True)
    if claimed is None:
        current = await db.transactions.find_one({"metadata.order_id": order_id}, {"_id": 0})
        if not current:
            return {"success": False, "status": "NOT_FOUND", "message": "Order not found"}
        if current and (
            current.get("type") == "RECHARGE"
            or (current.get("metadata") or {}).get("status") == "SUCCESS"
        ):
            await _pay_first_recharge_referral(current["user_id"])
            wallet = await wallet_service.get_wallet(current["user_id"])
            return {
                "success": True,
                "status": "SUCCESS",
                "message": "Already credited",
                "already": True,
                "balance": wallet.get("balance", 0),
                "credited": (current.get("metadata") or {}).get("credit_amount"),
            }
        status = (current or {}).get("metadata", {}).get("status") or "PENDING"
        return {"success": False, "status": status, "message": "Order is being processed"}

    gross = float(claimed.get("amount") or 0)
    splits = split_recharge(gross)
    user_id = claimed["user_id"]
    metadata = claimed.get("metadata") or {}
    now = datetime.now(timezone.utc)
    payment_id = str(verified_payment.get("payment_id") or metadata.get("payment_id") or "")

    # 1. Credit the user's spendable wallet (94%) exactly once.
    applied, wallet = await wallet_service.credit_balance_once(
        user_id, splits["credit_amount"], order_id
    )
    if not applied:
        logger.warning("Recharge %s wallet credit already applied; continuing settlement", order_id)

    # 2. Credit the platform wallet once and log the commission ledger once.
    await wallet_service.add_platform_balance_once(splits["total_commission"], order_id)
    await wallet_service.record_platform_commission(
        commission_type="RECHARGE_COMMISSION",
        amount=splits["total_commission"],
        source_id=order_id,
        user_id=user_id,
        gross_amount=splits["original_amount"],
        model_earnings=splits["credit_amount"],
        gateway_commission=splits["gateway_commission"],
        service_commission=splits["service_commission"],
        commission_id=f"pcom_recharge_{order_id}",
        metadata={
            "order_id": order_id,
            "transaction_id": claimed["transaction_id"],
            "payment_id": payment_id,
            "gateway": "kwikupi",
            "gateway_transaction_id": gateway_transaction_id,
            "gateway_commission": splits["gateway_commission"],
            "service_commission": splits["service_commission"],
        },
    )

    # 3. Mark the recharge transaction SUCCESS.
    await db.transactions.update_one(
        {"transaction_id": claimed["transaction_id"]},
        {
            "$set": {
                "type": "RECHARGE",
                "description": (
                    f"Recharge ₹{splits['original_amount']:.2f} — "
                    f"₹{splits['credit_amount']:.2f} credited after "
                    f"₹{splits['total_commission']:.2f} fee"
                ),
                "metadata.status": "SUCCESS",
                "metadata.payment_id": payment_id,
                "metadata.gateway_status": kwikupi_service.payment_status(verified_payment),
                "metadata.gateway_transaction_id": gateway_transaction_id,
                "metadata.gateway_amount": splits["original_amount"],
                "metadata.credit_amount": splits["credit_amount"],
                "metadata.completed_at": now,
                "metadata.verified_at": now,
                "metadata.last_checked_at": now,
                "metadata.commission_breakdown": splits,
            }
        },
    )

    # 4. Referral bonus (never blocks the credit).
    await _pay_first_recharge_referral(user_id)

    if r:
        try:
            await r.delete(idempotency_key(f"recharge:{order_id}"))
        except Exception:
            pass

    wallet = await wallet_service.get_wallet(user_id)
    await emit_to_user(
        user_id,
        "wallet_updated",
        {"balance": wallet.get("balance", 0), "order_id": order_id},
    )
    return {
        "success": True,
        "status": "SUCCESS",
        "balance": wallet.get("balance", 0),
        "credited": splits["credit_amount"],
        "commission": splits["total_commission"],
        "payment_id": payment_id,
    }


async def verify_with_gateway(
    order_id: str,
    *,
    payment_id_hint: Optional[str] = None,
    gateway_transaction_id: Optional[str] = None,
) -> dict:
    """Check the authoritative gateway status and settle the order if paid."""
    db = get_db()
    order = await db.transactions.find_one({"metadata.order_id": order_id}, {"_id": 0})
    if not order:
        return {"success": False, "status": "NOT_FOUND", "message": "Order not found"}
    metadata = order.get("metadata") or {}
    if metadata.get("gateway") != "kwikupi":
        # Never poll a legacy Cashfree/dev order through KwikUPI. Those require
        # manual reconciliation with the gateway that created them.
        return {
            "success": False,
            "status": "LEGACY",
            "message": "This order was created by a previous payment gateway",
        }
    if order.get("type") == "RECHARGE" or metadata.get("status") == "SUCCESS":
        await _pay_first_recharge_referral(order["user_id"])
        wallet = await wallet_service.get_wallet(order["user_id"])
        return {
            "success": True,
            "status": "SUCCESS",
            "already": True,
            "balance": wallet.get("balance", 0),
            "credited": metadata.get("credit_amount"),
        }
    if metadata.get("status") == "REVIEW":
        return {
            "success": False,
            "status": "REVIEW",
            "message": metadata.get("review_reason") or "Payment needs review",
        }

    stored_payment_id = str(metadata.get("payment_id") or "")
    if stored_payment_id:
        # The stored id came from the authenticated create-payment response.
        # Webhook body fields are a hint only; if they disagree, trust the
        # stored id and let the status API decide.
        payment_id = stored_payment_id
        if payment_id_hint and str(payment_id_hint) != stored_payment_id:
            logger.warning(
                "Ignoring webhook payment_id %s for order %s (stored %s)",
                payment_id_hint,
                order_id,
                stored_payment_id,
            )
    else:
        payment_id = str(payment_id_hint or "")
    if not payment_id:
        created_at = order.get("created_at")
        if isinstance(created_at, datetime):
            if created_at.tzinfo is None:
                created_at = created_at.replace(tzinfo=timezone.utc)
            age_seconds = (datetime.now(timezone.utc) - created_at).total_seconds()
        else:
            age_seconds = 10**9
        if age_seconds < 120:
            # The order row is inserted before create-payment returns. If a
            # webhook somehow races that write, retry instead of freezing the
            # payment in REVIEW.
            await db.transactions.update_one(
                {"metadata.order_id": order_id},
                {"$set": {"metadata.last_checked_at": datetime.now(timezone.utc)}},
            )
            return {
                "success": False,
                "status": "PENDING",
                "retryable": True,
                "message": "Payment is still being registered",
            }
        await _mark_review(
            order_id,
            "PAYMENT_ID_MISSING",
            {"payment_id": "", "status": metadata.get("gateway_status"), "amount": None},
        )
        return {
            "success": False,
            "status": "REVIEW",
            "message": "Payment identifier missing",
        }
    try:
        payment = await kwikupi_service.get_payment_status(payment_id)
    except Exception as exc:
        logger.warning("Gateway status check failed for %s: %s", order_id, exc)
        await db.transactions.update_one(
            {"metadata.order_id": order_id},
            {
                "$set": {
                    "metadata.gateway_status": "STATUS_CHECK_FAILED",
                    "metadata.last_gateway_error": str(exc)[:300],
                    "metadata.last_checked_at": datetime.now(timezone.utc),
                }
            },
        )
        return {
            "success": False,
            "status": "PENDING",
            "message": "Gateway status is temporarily unavailable",
            "retryable": True,
        }

    # Trust the status API, not the webhook body, for success/amount.
    status_order_id = str(payment.get("order_id") or "")
    status_payment_id = str(payment.get("payment_id") or "")
    if status_order_id and status_order_id != order_id:
        await _mark_review(order_id, "STATUS_ORDER_ID_MISMATCH", payment)
        return {"success": False, "status": "REVIEW", "message": "Order id mismatch"}
    if status_payment_id and status_payment_id != payment_id:
        await _mark_review(order_id, "STATUS_PAYMENT_ID_MISMATCH", payment)
        return {"success": False, "status": "REVIEW", "message": "Payment id mismatch"}
    if not status_payment_id:
        payment["payment_id"] = payment_id
    if not stored_payment_id:
        # Persist only after the gateway accepts the id. A bad webhook hint must
        # not become a permanent, unverifiable payment_id.
        await db.transactions.update_one(
            {"metadata.order_id": order_id},
            {"$set": {"metadata.payment_id": payment_id}},
        )

    if kwikupi_service.is_success(payment):
        result = await process_order_success(
            order_id,
            verified_payment=payment,
            gateway_transaction_id=gateway_transaction_id,
        )
        return result

    if kwikupi_service.is_failed(payment):
        await db.transactions.update_one(
            {
                "metadata.order_id": order_id,
                "metadata.status": {"$in": ["PENDING", "PROCESSING"]},
            },
            {
                "$set": {
                    "metadata.status": "FAILED",
                    "metadata.gateway_status": kwikupi_service.payment_status(payment),
                    "metadata.failed_at": datetime.now(timezone.utc),
                    "metadata.last_checked_at": datetime.now(timezone.utc),
                }
            },
        )
        return {
            "success": True,
            "status": "FAILED",
            "message": "Payment failed",
        }

    if kwikupi_service.is_pending(payment):
        await db.transactions.update_one(
            {
                "metadata.order_id": order_id,
                "metadata.status": {"$in": ["PENDING", "PROCESSING"]},
            },
            {
                "$set": {
                    "metadata.status": "PENDING",
                    "metadata.gateway_status": kwikupi_service.payment_status(payment) or "PENDING",
                    "metadata.last_checked_at": datetime.now(timezone.utc),
                }
            },
        )
        return {
            "success": True,
            "status": "PENDING",
            "message": "Payment is still pending",
        }

    await _mark_review(order_id, "UNKNOWN_GATEWAY_STATUS", payment)
    return {
        "success": False,
        "status": "REVIEW",
        "message": "Unexpected payment status",
    }


async def handle_webhook_payload(payload: Dict[str, Any]) -> dict:
    """Resolve the order from a verified webhook and re-check it with KwikUPI."""
    nested = payload.get("data")
    if not isinstance(nested, dict):
        nested = payload.get("payload")
    if not isinstance(nested, dict):
        nested = {}

    def first(*keys: str) -> Any:
        for source in (payload, nested):
            for key in keys:
                value = source.get(key)
                if value not in (None, ""):
                    return value
        return None

    order_id = first("order_id", "orderId")
    payment_id = first("payment_id", "paymentId")
    transaction_id = first("transaction_id", "transactionId", "txn_id")
    if not order_id and payment_id:
        db = get_db()
        tx = await db.transactions.find_one(
            {"metadata.payment_id": str(payment_id)}, {"_id": 0, "metadata.order_id": 1}
        )
        order_id = ((tx or {}).get("metadata") or {}).get("order_id")
    if not order_id:
        raise ValueError("order_id is required")
    return await verify_with_gateway(
        str(order_id),
        payment_id_hint=str(payment_id) if payment_id else None,
        gateway_transaction_id=str(transaction_id) if transaction_id else None,
    )


async def reconcile_pending_orders(max_age_minutes: int = 10) -> int:
    """Settle pending recharges the user may have abandoned after paying."""
    db = get_db()
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=max_age_minutes)
    pending = (
        await db.transactions.find(
            {
                "type": "RECHARGE_PENDING",
                "metadata.status": {"$in": ["PENDING", "PROCESSING"]},
                "metadata.gateway": "kwikupi",
                "metadata.dev_mode": {"$ne": True},
                "created_at": {"$lt": cutoff},
            },
            {"_id": 0, "metadata.order_id": 1},
        )
        .sort("metadata.last_checked_at", 1)
        .limit(50)
        .to_list(50)
    )
    settled = 0
    for row in pending:
        order_id = (row.get("metadata") or {}).get("order_id")
        if not order_id:
            continue
        try:
            result = await verify_with_gateway(order_id)
        except Exception:
            logger.exception("Pending recharge reconciliation failed for %s", order_id)
            continue
        if result.get("status") == "SUCCESS" and not result.get("already"):
            settled += 1
    if settled:
        logger.info("Reconciler settled %s pending recharges", settled)
    return settled
