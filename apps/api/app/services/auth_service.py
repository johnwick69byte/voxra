import base64
import logging
import random
import string
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

import httpx

from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import create_access_token

logger = logging.getLogger(__name__)

_MC_TOKEN: Optional[str] = None
_MC_TOKEN_EXPIRES: Optional[datetime] = None
_MC_BASE = "https://cpaas.messagecentral.com"


def _normalize_phone(country_code: str, phone: str) -> str:
    digits = "".join(c for c in phone if c.isdigit())
    cc = country_code if country_code.startswith("+") else f"+{country_code}"
    return f"{cc}{digits}"


def _split_phone(full: str) -> Tuple[str, str]:
    """Return (country_code_digits, mobile_digits) from E.164-style phone."""
    digits = "".join(c for c in full if c.isdigit())
    if digits.startswith("91") and len(digits) > 10:
        return "91", digits[2:]
    if len(digits) > 10:
        return digits[:-10], digits[-10:]
    return "91", digits[-10:]


def _looks_like_jwt(value: str) -> bool:
    return value.startswith("eyJ") and value.count(".") >= 2


def _password_as_base64_key(raw: str) -> str:
    """MessageCentral token API `key` must be the dashboard password in Base64."""
    compact = "".join(raw.split())
    try:
        base64.b64decode(compact, validate=True)
        if "." not in compact:
            return compact
    except Exception:
        pass
    return base64.b64encode(raw.encode("utf-8")).decode("ascii")


async def _get_messagecentral_token() -> Optional[str]:
    global _MC_TOKEN, _MC_TOKEN_EXPIRES
    settings = get_settings()
    secret = (settings.messagecentral_api_key or "").strip()
    if not secret:
        return None
    if _MC_TOKEN and _MC_TOKEN_EXPIRES and datetime.now(timezone.utc) < _MC_TOKEN_EXPIRES:
        return _MC_TOKEN

    # Dashboard "Generate token" copies a JWT. That is the authToken, not the `key`.
    if _looks_like_jwt(secret):
        _MC_TOKEN = secret
        _MC_TOKEN_EXPIRES = datetime.now(timezone.utc) + timedelta(hours=20)
        return _MC_TOKEN

    params = {
        "customerId": settings.messagecentral_customer_id,
        "key": _password_as_base64_key(secret),
        "scope": "NEW",
        "country": "91",
    }
    if settings.messagecentral_email:
        params["email"] = settings.messagecentral_email
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{_MC_BASE}/auth/v1/authentication/token",
                params=params,
                headers={"accept": "*/*"},
            )
            data = resp.json() if resp.content else {}
            token = (
                data.get("token")
                or data.get("authToken")
                or (data.get("data") or {}).get("authToken")
                or (data.get("data") or {}).get("token")
            )
            if not token:
                logger.error(
                    "MessageCentral token response missing token (status=%s): %s",
                    resp.status_code,
                    data,
                )
                return None
            _MC_TOKEN = token
            _MC_TOKEN_EXPIRES = datetime.now(timezone.utc) + timedelta(hours=20)
            return token
    except Exception:
        logger.exception("MessageCentral token fetch failed")
        return None


def _mc_ok(data: dict) -> bool:
    inner = data.get("data") if isinstance(data.get("data"), dict) else {}
    code = data.get("responseCode", data.get("status"))
    inner_code = (inner or {}).get("responseCode")
    status = str((inner or {}).get("verificationStatus") or "").upper()
    if code in (200, "200", 0, "0") or inner_code in (200, "200", 0, "0"):
        return True
    if status in {"VERIFIED", "SUCCESS", "OTP_VERIFIED"}:
        return True
    msg = str(data.get("message") or "").upper()
    return msg in {"SUCCESS", "VERIFICATION_SUCCESS", "OTP_VERIFIED"}


def _mc_verification_id(data: dict) -> Optional[str]:
    """Docs sometimes typo this as verficationId."""
    inner = data.get("data") if isinstance(data.get("data"), dict) else {}
    blobs = [inner or {}, data]
    for blob in blobs:
        for key in ("verificationId", "verficationId", "verification_id"):
            val = blob.get(key)
            if val not in (None, ""):
                return str(val)
    return None


async def _send_messagecentral_otp(full: str) -> Optional[str]:
    """
    Docs curl:
      POST https://cpaas.messagecentral.com/verification/v3/send
        ?countryCode=91&flowType=SMS&mobileNumber=9999999999
      Header: authToken: <jwt>
    otpLength=6 matches the app (docs default is 4).
    """
    token = await _get_messagecentral_token()
    if not token:
        return None
    country_code, mobile = _split_phone(full)
    # Exact docs query shape (flowType, not BowType).
    params = {
        "countryCode": country_code,
        "flowType": "SMS",
        "mobileNumber": mobile,
        "otpLength": 6,
    }
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{_MC_BASE}/verification/v3/send",
                params=params,
                headers={"authToken": token},
            )
            data = resp.json() if resp.content else {}
            verification_id = _mc_verification_id(data)
            if resp.status_code >= 400 or not _mc_ok(data) or not verification_id:
                logger.error(
                    "MessageCentral OTP send failed: status=%s url=%s body=%s",
                    resp.status_code,
                    str(resp.request.url),
                    data or resp.text,
                )
                return None
            return verification_id
    except Exception:
        logger.exception("MessageCentral OTP send failed for %s", full)
        return None


async def _validate_messagecentral_otp(verification_id: str, code: str) -> bool:
    """
    Docs curl:
      GET https://cpaas.messagecentral.com/verification/v3/validateOtp
        ?verificationId=2949&code=1476
      Header: authToken: <jwt>
    """
    token = await _get_messagecentral_token()
    if not token:
        return False
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{_MC_BASE}/verification/v3/validateOtp",
                params={"verificationId": verification_id, "code": code},
                headers={"authToken": token},
            )
            data = resp.json() if resp.content else {}
            if resp.status_code >= 400 or not _mc_ok(data):
                logger.warning(
                    "MessageCentral OTP validate failed: status=%s body=%s",
                    resp.status_code,
                    data or resp.text,
                )
                return False
            return True
    except Exception:
        logger.exception("MessageCentral OTP validate failed")
        return False


async def send_otp(country_code: str, phone: str) -> dict:
    settings = get_settings()
    full = _normalize_phone(country_code, phone)
    db = get_db()
    await db.otp_codes.delete_many({"phone": full})

    if settings.messagecentral_api_key:
        verification_id = await _send_messagecentral_otp(full)
        if not verification_id:
            return {
                "success": False,
                "message": "Could not send OTP SMS. Check MessageCentral credentials and retry.",
                "dev": False,
            }
        await db.otp_codes.insert_one(
            {
                "phone": full,
                "verification_id": verification_id,
                "provider": "messagecentral",
                "created_at": datetime.now(timezone.utc),
                "expires_at": datetime.now(timezone.utc) + timedelta(minutes=10),
            }
        )
        return {"success": True, "message": "OTP sent", "dev": False}

    code = settings.dev_otp_code or "".join(random.choices(string.digits, k=6))
    await db.otp_codes.insert_one(
        {
            "phone": full,
            "code": code,
            "provider": "dev",
            "created_at": datetime.now(timezone.utc),
            "expires_at": datetime.now(timezone.utc) + timedelta(minutes=10),
        }
    )
    logger.info("DEV OTP for %s: %s", full, code)
    return {"success": True, "message": "OTP sent", "dev": True}


async def verify_otp(
    country_code: str,
    phone: str,
    otp: str,
    user_type: Optional[str] = None,
) -> dict:
    full = _normalize_phone(country_code, phone)
    db = get_db()
    record = await db.otp_codes.find_one({"phone": full}, sort=[("created_at", -1)])
    settings = get_settings()
    valid = False
    if record and record.get("verification_id"):
        valid = await _validate_messagecentral_otp(str(record["verification_id"]), otp)
    elif record and record.get("code") == otp:
        valid = True
    elif not settings.messagecentral_api_key and settings.dev_otp_code and otp == settings.dev_otp_code:
        valid = True
    if not valid:
        return {"success": False, "message": "Invalid OTP"}

    await db.otp_codes.delete_many({"phone": full})

    user = await db.users.find_one({"phone": full}, {"_id": 0})
    is_new = False
    if not user:
        is_new = True
        user_id = f"usr_{uuid.uuid4().hex[:12]}"
        utype = user_type or "user"
        user = {
            "user_id": user_id,
            "phone": full,
            "name": None,
            "username": None,
            "picture": None,
            "user_type": utype,
            "profile_complete": False,
            "is_suspended": False,
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
        }
        await db.users.insert_one(user)
        await db.wallets.insert_one(
            {
                "user_id": user_id,
                "balance": 0.0,
                "earnings_balance": 0.0,
                "updated_at": datetime.now(timezone.utc),
            }
        )
        if utype == "creator":
            await db.creator_profiles.insert_one(
                {
                    "user_id": user_id,
                    "bio": "",
                    "images": [],
                    "audio_rate_per_minute": None,
                    "video_rate_per_minute": None,
                    "instant_call_enabled": True,
                    "is_dnd": False,
                    "is_approved": False,
                    "verification_status": "pending_profile",
                    "created_at": datetime.now(timezone.utc),
                }
            )

    token = create_access_token(user["user_id"], user["user_type"])
    safe = {k: v for k, v in user.items() if k != "_id"}
    return {
        "success": True,
        "token": token,
        "user": safe,
        "is_new": is_new,
    }


async def generate_referral_code() -> str:
    db = get_db()
    while True:
        code = "".join(random.choices(string.ascii_uppercase + string.digits, k=8))
        exists = await db.users.find_one({"referral_code": code})
        if not exists:
            return code
