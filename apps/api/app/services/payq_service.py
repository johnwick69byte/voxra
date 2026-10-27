"""PayQ UPI collection adapter.

PayQ is a form-encoded REST API. Authentication is the merchant ``user_token``
sent as a normal request field. There is no sandbox mode documented for these
endpoints, so every order created here is a live order.

The webhook signature is **not** an HMAC over the raw request body. PayQ signs
``http_build_query($_POST)`` after removing ``hash`` (HMAC-SHA256, hex). That is
a PHP-specific serialization: field order, ``+`` for spaces, percent-encoded
brackets for the legacy nested ``result[...]`` block, and every received field
except ``hash``. ``verify_webhook_signature`` reproduces that serialization so
we can verify the exact payload PayQ's PHP handler signs.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import re
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import quote_plus

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_BRACKET_KEY = re.compile(r"^([^\[]+)\[([^\]]*)\]$")
_SUCCESS_TOPS = {"COMPLETED", "SUCCESS"}
_SUCCESS_INNERS = {"SUCCESS", "COMPLETED", "TXN_SUCCESS"}
_FAIL_TOPS = {"FAILURE", "FAILED", "CANCELLED", "CANCELED", "EXPIRED", "DECLINED"}
_FAIL_INNERS = _FAIL_TOPS
_PENDING = {"", "PENDING", "PROCESSING", "INITIATED", "CREATED"}


class PayQError(RuntimeError):
    """Raised when PayQ rejects a request or returns an invalid response."""


def _base_url() -> str:
    return (get_settings().payq_base_url or "https://payq.cc/api").rstrip("/")


def configured() -> bool:
    """True when live order creation/status checks can run."""
    return bool((get_settings().payq_user_token or "").strip())


def webhook_configured() -> bool:
    """True when webhook signatures can be verified."""
    return bool((get_settings().payq_webhook_secret or "").strip())


def normalize_mobile(value: Any) -> str:
    """Return a PayQ-compatible 10-digit Indian mobile number."""
    digits = re.sub(r"\D", "", str(value or ""))
    if len(digits) >= 12 and digits.startswith("91"):
        digits = digits[-10:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    if len(digits) != 10 or digits[0] not in "6789":
        raise ValueError("A valid 10-digit mobile number is required")
    return digits


def _response_json(resp: httpx.Response) -> Dict[str, Any]:
    try:
        data = resp.json()
    except Exception:
        data = {}
    if not isinstance(data, dict):
        data = {}
    return data


def _message(data: Dict[str, Any], resp: httpx.Response) -> str:
    message = data.get("message") or data.get("error") or data.get("detail")
    if not message:
        message = (resp.text or "").strip()[:300]
    return str(message or f"HTTP {resp.status_code}")


def _status_ok(value: Any) -> bool:
    if value is True:
        return True
    if isinstance(value, (int, float)) and not isinstance(value, bool) and value == 1:
        return True
    return str(value or "").strip().lower() in {"true", "1", "success", "ok"}


def _result(payload: Dict[str, Any]) -> Dict[str, Any]:
    result = payload.get("result")
    return result if isinstance(result, dict) else {}


def _top_status(payload: Dict[str, Any]) -> str:
    raw = payload.get("status")
    if isinstance(raw, bool):
        return "TRUE" if raw else "FALSE"
    return str(raw or "").strip().upper()


def _inner_status(payload: Dict[str, Any]) -> str:
    result = _result(payload)
    return str(result.get("status") or result.get("txnStatus") or "").strip().upper()


def order_id(payload: Dict[str, Any]) -> str:
    result = _result(payload)
    return str(
        result.get("orderId")
        or result.get("order_id")
        or payload.get("orderId")
        or payload.get("order_id")
        or ""
    ).strip()


def amount(payload: Dict[str, Any]) -> Any:
    result = _result(payload)
    value = result.get("amount")
    if value is None:
        value = payload.get("amount")
    return value


def utr(payload: Dict[str, Any]) -> str:
    result = _result(payload)
    return str(result.get("utr") or payload.get("utr") or "").strip()


def payment_status(payload: Dict[str, Any]) -> str:
    top = _top_status(payload)
    if top not in {"", "TRUE", "FALSE"}:
        return top
    return _inner_status(payload)


def classify(payload: Dict[str, Any]) -> str:
    """Classify an authoritative status response.

    Only a strict success response can ever credit a wallet. Ambiguous or
    inconsistent responses are returned as ``UNKNOWN`` so the caller can put
    them in manual review rather than guessing.
    """
    top = _top_status(payload)
    inner = _inner_status(payload)
    if top in _SUCCESS_TOPS:
        if inner in _SUCCESS_INNERS:
            return "SUCCESS"
        if inner in {"PENDING", "PROCESSING", "INITIATED", "CREATED"}:
            return "PENDING"
        return "UNKNOWN"
    if top in _FAIL_TOPS:
        if inner in _FAIL_INNERS:
            return "FAILED"
        if inner in _PENDING or not inner:
            # PayQ uses string "FAILURE" for some API-level errors (notably
            # rate limits). Never mark a local order failed on that alone.
            return "PENDING"
        return "UNKNOWN"
    if inner in _FAIL_INNERS:
        return "FAILED"
    if top in _PENDING or inner in _PENDING:
        return "PENDING"
    return "UNKNOWN"


def is_success(payload: Dict[str, Any]) -> bool:
    return classify(payload) == "SUCCESS"


def is_failed(payload: Dict[str, Any]) -> bool:
    return classify(payload) == "FAILED"


def is_pending(payload: Dict[str, Any]) -> bool:
    return classify(payload) == "PENDING"


async def create_order(
    *,
    order_id: str,
    amount: float,
    customer_mobile: str,
    redirect_url: str,
    remark1: Optional[str] = None,
    remark2: Optional[str] = None,
) -> Dict[str, str]:
    """Create a live PayQ payment page.

    No automatic retry is performed: a timeout after PayQ created the order
    would otherwise create a second live order for one business transaction.
    """
    if not configured():
        raise PayQError("PayQ is not configured")
    if not str(redirect_url or "").startswith("https://"):
        raise PayQError("PayQ redirect_url must be an HTTPS URL")

    mobile = normalize_mobile(customer_mobile)
    payload = {
        "customer_mobile": mobile,
        "user_token": get_settings().payq_user_token.strip(),
        "amount": f"{float(amount):.2f}",
        "order_id": str(order_id),
        "redirect_url": redirect_url,
    }
    if remark1:
        payload["remark1"] = str(remark1)[:255]
    if remark2:
        payload["remark2"] = str(remark2)[:255]

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{_base_url()}/create-order",
                data=payload,
                headers={
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Accept": "application/json",
                },
            )
    except httpx.HTTPError as exc:
        logger.exception("PayQ create_order network error for %s", order_id)
        raise PayQError("Could not reach the payment gateway") from exc

    data = _response_json(resp)
    if resp.is_error:
        message = _message(data, resp)
        logger.error(
            "PayQ create_order failed (%s) for %s: %s",
            resp.status_code,
            order_id,
            message,
        )
        raise PayQError(message)
    if not _status_ok(data.get("status")):
        message = _message(data, resp)
        logger.error("PayQ create_order rejected for %s: %s", order_id, message)
        raise PayQError(message)

    result = _result(data)
    gateway_order_id = str(result.get("orderId") or result.get("order_id") or "").strip()
    payment_url = str(result.get("payment_url") or result.get("paymentUrl") or "").strip()
    if not gateway_order_id or gateway_order_id != str(order_id):
        logger.error("PayQ create_order returned a mismatched order id for %s", order_id)
        raise PayQError("Payment gateway returned an invalid order")
    if not payment_url.startswith("https://"):
        logger.error("PayQ create_order returned a non-HTTPS payment URL for %s", order_id)
        raise PayQError("Payment gateway returned an invalid payment page")

    return {"order_id": gateway_order_id, "payment_url": payment_url}


async def get_order_status(order_id: str) -> Dict[str, Any]:
    """Fetch the authoritative PayQ status for one order id."""
    if not configured():
        raise PayQError("PayQ is not configured")
    if not order_id:
        raise PayQError("order_id is required")

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{_base_url()}/check-order-status",
                data={
                    "user_token": get_settings().payq_user_token.strip(),
                    "order_id": str(order_id),
                },
                headers={
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Accept": "application/json",
                },
            )
    except httpx.HTTPError as exc:
        logger.exception("PayQ check_order_status network error for %s", order_id)
        raise PayQError("Could not reach the payment gateway") from exc

    data = _response_json(resp)
    if resp.is_error:
        message = _message(data, resp)
        logger.error(
            "PayQ check_order_status failed (%s) for %s: %s",
            resp.status_code,
            order_id,
            message,
        )
        raise PayQError(message)
    if not data:
        raise PayQError("Payment gateway returned an invalid status response")

    raw_status = data.get("status")
    if raw_status is False or str(raw_status).strip().lower() == "false":
        raise PayQError(_message(data, resp))

    # These are API-level/transient errors, not a definitive payment failure.
    # Raising leaves the local order PENDING and lets the reconciler retry.
    message_lower = str(data.get("message") or "").strip().lower()
    if any(
        marker in message_lower
        for marker in ("too many requests", "invalid user_token", "order not found")
    ):
        raise PayQError(_message(data, resp))

    return data


def _php_urlencode(value: Any) -> str:
    """Match PHP's urlencode() used by http_build_query()."""
    encoded = quote_plus(str(value), safe="-._")
    # Python always treats '~' as safe; PHP's urlencode() does not.
    return encoded.replace("~", "%7E")


def _php_post_data(items: Iterable[Tuple[str, Any]]) -> Dict[str, Any]:
    """Rebuild the array shape PHP creates from form fields.

    The order of fields is retained. A nested ``result[...]`` block is inserted
    at the position of its first field, exactly as PHP's ``$_POST`` array does.
    """
    data: Dict[str, Any] = {}
    for raw_key, value in items:
        key = str(raw_key)
        if key == "hash":
            continue
        match = _BRACKET_KEY.match(key)
        if not match:
            data[key] = value
            continue
        parent, child = match.group(1), match.group(2)
        current = data.get(parent)
        if not isinstance(current, dict):
            current = {}
            data[parent] = current
        current[child] = value
    return data


def _append_query(prefix: str, value: Any, parts: List[str]) -> None:
    if isinstance(value, dict):
        for child_key, child_value in value.items():
            child_prefix = f"{prefix}[{child_key}]" if prefix else str(child_key)
            _append_query(child_prefix, child_value, parts)
        return
    if isinstance(value, (list, tuple)):
        for index, child_value in enumerate(value):
            child_prefix = f"{prefix}[{index}]" if prefix else str(index)
            _append_query(child_prefix, child_value, parts)
        return
    if value is None:
        # http_build_query() omits null values. Form values are strings, so this
        # is only relevant if a future caller builds the structure directly.
        return
    parts.append(f"{_php_urlencode(prefix)}={_php_urlencode(value)}")


def _php_build_query(data: Dict[str, Any]) -> str:
    parts: List[str] = []
    for key, value in data.items():
        _append_query(str(key), value, parts)
    return "&".join(parts)


def webhook_payload(items: Iterable[Tuple[str, Any]]) -> Dict[str, Any]:
    """Return the decoded form data, including the legacy nested result block."""
    return _php_post_data(items)


def verify_webhook_signature(
    items: Sequence[Tuple[str, Any]], signature: str
) -> bool:
    """Verify PayQ's ``hash`` field.

    ``items`` must contain every form field in the order PayQ sent it. The hash
    is HMAC-SHA256 over PHP's ``http_build_query($_POST - hash)`` using the
    separate Webhook Secret from the PayQ API Setup page.
    """
    secret = (get_settings().payq_webhook_secret or "").strip()
    if not secret or not signature:
        return False

    provided = str(signature).strip()
    if provided.lower().startswith("sha256="):
        provided = provided[7:]
    try:
        data = _php_post_data(items)
        serialized = _php_build_query(data)
        expected = hmac.new(
            secret.encode("utf-8"), serialized.encode("utf-8"), hashlib.sha256
        ).hexdigest()
        return hmac.compare_digest(expected, provided.lower())
    except Exception:
        logger.exception("PayQ webhook signature verification failed")
        return False
