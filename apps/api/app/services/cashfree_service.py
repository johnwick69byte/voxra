"""Cashfree Payment Gateway adapter (orders + status + webhook verification)."""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
from typing import Any, Dict, Optional

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)


def _base_url() -> str:
    env = (get_settings().cashfree_environment or "sandbox").lower()
    return "https://api.cashfree.com/pg" if env == "production" else "https://sandbox.cashfree.com/pg"


def _headers() -> Dict[str, str]:
    s = get_settings()
    return {
        "x-client-id": s.cashfree_app_id,
        "x-client-secret": s.cashfree_secret_key,
        "x-api-version": "2023-08-01",
        "Content-Type": "application/json",
    }


def configured() -> bool:
    s = get_settings()
    return bool(s.cashfree_app_id and s.cashfree_secret_key)


async def create_order(
    *,
    order_id: str,
    amount: float,
    customer_id: str,
    customer_phone: str,
    customer_name: Optional[str] = None,
    return_url: str,
    notify_url: str,
) -> Dict[str, Any]:
    """Create a Cashfree order and return the hosted payment_session_id."""
    payload = {
        "order_id": order_id,
        "order_amount": round(float(amount), 2),
        "order_currency": "INR",
        "customer_details": {
            "customer_id": customer_id[:50],
            "customer_phone": (customer_phone or "9999999999")[-10:],
            "customer_name": (customer_name or "Simple Talk user")[:100],
        },
        "order_meta": {
            "return_url": f"{return_url}?order_id={order_id}",
            "notify_url": notify_url,
        },
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(f"{_base_url()}/orders", json=payload, headers=_headers())
    data = resp.json() if resp.content else {}
    if resp.is_error or not data.get("payment_session_id"):
        msg = data.get("message") or resp.text
        logger.error("Cashfree create_order failed (%s): %s", resp.status_code, msg)
        raise RuntimeError(f"Cashfree error: {msg}")
    return data


async def get_order(order_id: str) -> Dict[str, Any]:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(f"{_base_url()}/orders/{order_id}", headers=_headers())
    resp.raise_for_status()
    return resp.json()


def is_paid(order: Dict[str, Any]) -> bool:
    return str(order.get("order_status", "")).upper() == "PAID"


def is_failed(order: Dict[str, Any]) -> bool:
    return str(order.get("order_status", "")).upper() in {"EXPIRED", "TERMINATED", "CANCELLED"}


def verify_webhook_signature(raw_body: bytes, signature: str, timestamp: str) -> bool:
    secret = get_settings().cashfree_secret_key
    if not secret or not signature or not timestamp:
        return False
    try:
        message = timestamp.encode() + raw_body
        computed = base64.b64encode(
            hmac.new(secret.encode(), message, hashlib.sha256).digest()
        ).decode()
        return hmac.compare_digest(computed, signature)
    except Exception:
        logger.exception("Cashfree webhook signature verification failed")
        return False
