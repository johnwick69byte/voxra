"""KwikUPI hosted-checkout adapter.

KwikUPI exposes a small REST API with API-key authentication. There is no
sandbox: every order created here is a live payment order. The API secret is
also the webhook signing secret (HMAC-SHA256 of the raw request body).
"""

from __future__ import annotations

import hashlib
import hmac
import logging
from typing import Any, Dict, Optional
from urllib.parse import quote

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class KwikUPIError(RuntimeError):
    """Raised when KwikUPI rejects a request or returns an invalid response."""


def _base_url() -> str:
    return (get_settings().kwikupi_base_url or "https://kwikupi.com/api").rstrip("/")


def _headers() -> Dict[str, str]:
    settings = get_settings()
    return {
        "X-API-KEY": settings.kwikupi_api_key,
        "X-API-SECRET": settings.kwikupi_api_secret,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def configured() -> bool:
    settings = get_settings()
    return bool(settings.kwikupi_api_key and settings.kwikupi_api_secret)


def _response_json(resp: httpx.Response) -> Dict[str, Any]:
    try:
        data = resp.json()
    except Exception:
        data = {}
    if not isinstance(data, dict):
        data = {}
    return data


def _error_message(data: Dict[str, Any], resp: httpx.Response) -> str:
    message = data.get("message") or data.get("error") or data.get("detail")
    if not message:
        message = (resp.text or "").strip()[:300]
    return str(message or f"HTTP {resp.status_code}")


async def create_payment(
    *,
    order_id: str,
    amount: float,
    customer_name: Optional[str],
    redirect_url: str,
    customer_email: Optional[str] = None,
) -> Dict[str, Any]:
    """Create a hosted payment page and return KwikUPI's response.

    No automatic retry is performed because a timeout after the gateway created
    the order can produce a second live payment page for the same business
    order. The app can safely start a fresh order instead.
    """
    if not configured():
        raise KwikUPIError("KwikUPI is not configured")

    payload: Dict[str, Any] = {
        "amount": round(float(amount), 2),
        "order_id": order_id,
        "customer_name": (customer_name or "Simple Talk user")[:100],
        "redirect_url": redirect_url,
    }
    if customer_email:
        payload["customer_email"] = customer_email

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{_base_url()}/create-payment", json=payload, headers=_headers()
            )
    except httpx.HTTPError as exc:
        logger.exception("KwikUPI create_payment network error for %s", order_id)
        raise KwikUPIError("Could not reach the payment gateway") from exc

    data = _response_json(resp)
    if resp.is_error:
        message = _error_message(data, resp)
        logger.error(
            "KwikUPI create_payment failed (%s) for %s: %s",
            resp.status_code,
            order_id,
            message,
        )
        raise KwikUPIError(message)

    payment_id = data.get("payment_id")
    payment_page = data.get("payment_page")
    if not payment_id or not payment_page:
        logger.error("KwikUPI create_payment missing fields for %s: %s", order_id, data)
        raise KwikUPIError("Payment gateway returned an invalid response")
    if not str(payment_page).startswith("https://"):
        logger.error("KwikUPI returned a non-HTTPS payment page for %s", order_id)
        raise KwikUPIError("Payment gateway returned an invalid payment page")
    data["payment_id"] = str(payment_id)
    data["payment_page"] = str(payment_page)
    return data


async def get_payment_status(payment_id: str) -> Dict[str, Any]:
    """Fetch the authoritative status for one KwikUPI payment."""
    if not configured():
        raise KwikUPIError("KwikUPI is not configured")
    if not payment_id:
        raise KwikUPIError("payment_id is required")

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{_base_url()}/payment-status/{quote(str(payment_id), safe='')}",
                headers=_headers(),
            )
    except httpx.HTTPError as exc:
        logger.exception("KwikUPI payment-status network error for %s", payment_id)
        raise KwikUPIError("Could not reach the payment gateway") from exc

    data = _response_json(resp)
    if resp.is_error:
        message = _error_message(data, resp)
        logger.error(
            "KwikUPI payment-status failed (%s) for %s: %s",
            resp.status_code,
            payment_id,
            message,
        )
        raise KwikUPIError(message)
    if not data:
        raise KwikUPIError("Payment gateway returned an invalid status response")
    return data


def payment_status(payload: Dict[str, Any]) -> str:
    return str(payload.get("status") or "").strip().upper()


def is_success(payload: Dict[str, Any]) -> bool:
    return payment_status(payload) == "TXN_SUCCESS"


def is_pending(payload: Dict[str, Any]) -> bool:
    return payment_status(payload) in {"", "PENDING", "PROCESSING", "INITIATED"}


def is_failed(payload: Dict[str, Any]) -> bool:
    return payment_status(payload) in {
        "TXN_FAILED",
        "TXN_FAILURE",
        "FAILED",
        "FAILURE",
        "CANCELLED",
        "CANCELED",
        "EXPIRED",
    }


def verify_webhook_signature(raw_body: bytes, signature: str) -> bool:
    """Verify X-Webhook-Signature = hex(HMAC-SHA256(raw_body, API secret))."""
    secret = get_settings().kwikupi_api_secret
    if not secret or not signature:
        return False

    provided = str(signature).strip()
    if provided.lower().startswith("sha256="):
        provided = provided[7:]
    try:
        expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, provided.lower())
    except Exception:
        logger.exception("KwikUPI webhook signature verification failed")
        return False
