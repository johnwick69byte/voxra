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


async def _get_messagecentral_token() -> Optional[str]:
    global _MC_TOKEN, _MC_TOKEN_EXPIRES
    settings = get_settings()
    if not settings.messagecentral_api_key:
        return None
    if _MC_TOKEN and _MC_TOKEN_EXPIRES and datetime.now(timezone.utc) < _MC_TOKEN_EXPIRES:
        return _MC_TOKEN
    params = {
        "customerId": settings.messagecentral_customer_id,
        "key": settings.messagecentral_api_key,
        "scope": "NEW",
    }
    if settings.messagecentral_email:
        params["email"] = settings.messagecentral_email
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                "https://cpaas.messagecentral.com/auth/v1/authentication/token",
                params=params,
            )
            resp.raise_for_status()
            data = resp.json()
            token = (
                data.get("token")
                or data.get("authToken")
                or (data.get("data") or {}).get("authToken")
            )
            if not token:
                logger.error("MessageCentral token response missing token: %s", data)
                return None
            _MC_TOKEN = token
            _MC_TOKEN_EXPIRES = datetime.now(timezone.utc) + timedelta(hours=1)
            return token
    except Exception:
        logger.exception("MessageCentral token fetch failed")
        return None


async def _send_messagecentral_otp(full: str, code: str) -> bool:
    token = await _get_messagecentral_token()
    if not token:
        return False
    country_code, mobile = _split_phone(full)
    params = {
        "countryCode": country_code,
        "mobileNumber": mobile,
        "flowType": "SMS",
        "type": "SMS",
        "message": f"Your Voxora verification code is {code}",
        "messageType": "OTP",
    }
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                "https://cpaas.messagecentral.com/verification/v3/send",
                params=params,
                headers={"authToken": token},
            )
            if resp.status_code >= 400:
                logger.error("MessageCentral OTP send failed: %s %s", resp.status_code, resp.text)
                return False
            return True
    except Exception:
        logger.exception("MessageCentral OTP send failed for %s", full)
        return False


async def send_otp(country_code: str, phone: str) -> dict:
    settings = get_settings()
    full = _normalize_phone(country_code, phone)
    if settings.messagecentral_api_key:
        code = "".join(random.choices(string.digits, k=6))
        dev_mode = False
    else:
        code = settings.dev_otp_code or "".join(random.choices(string.digits, k=6))
        dev_mode = True
    db = get_db()
    await db.otp_codes.delete_many({"phone": full})
    await db.otp_codes.insert_one(
        {
            "phone": full,
            "code": code,
            "created_at": datetime.now(timezone.utc),
            "expires_at": datetime.now(timezone.utc) + timedelta(minutes=10),
        }
    )
    if settings.messagecentral_api_key:
        sent = await _send_messagecentral_otp(full, code)
        if not sent:
            logger.warning("MessageCentral send failed for %s — OTP stored for retry/verify", full)
    else:
        logger.info("DEV OTP for %s: %s", full, code)
    return {"success": True, "message": "OTP sent", "dev": dev_mode}


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
    if record and record.get("code") == otp:
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
