"""Agora RTC token minting."""

from __future__ import annotations

import logging
import time

from app.core.config import get_settings

logger = logging.getLogger(__name__)


def uid_for_user(user_id: str) -> int:
    """Stable nonzero Agora uid for a participant.

    Derived from the user id so both sides can compute each other's uid, and
    different users always collide-free within a channel. Agora reserves 0 for
    "auto-assign", which must not be used when two clients share a channel.
    """
    import hashlib

    digest = hashlib.sha256(user_id.encode("utf-8")).digest()
    # 31-bit positive integer, never 0.
    uid = int.from_bytes(digest[:4], "big") & 0x7FFFFFFF
    return uid or 1


def build_rtc_token(channel_name: str, uid: int = 0, role: str = "publisher", expire_seconds: int = 3600) -> dict:
    """Mint an Agora RTC token.

    `uid` must be a nonzero, per-participant integer. Join as 0 ("any") on both
    sides makes Agora treat the second joiner as a duplicate of the first and
    evict one of them -- the call appears to connect but there is no audio.
    Callers should pass a stable uid derived from the participant.
    """
    settings = get_settings()
    app_id = settings.agora_app_id
    cert = settings.agora_app_certificate
    if not app_id:
        # Dev fallback — client must still have a real app id in production
        return {
            "app_id": "DEV_AGORA_APP_ID",
            "token": f"dev_token_{channel_name}",
            "channel_name": channel_name,
            "uid": uid,
            "expire_at": int(time.time()) + expire_seconds,
        }
    try:
        from agora_token_builder import RtcTokenBuilder, Role_Publisher, Role_Subscriber

        role_const = Role_Publisher if role == "publisher" else Role_Subscriber
        privilege_expired_ts = int(time.time()) + expire_seconds
        token = RtcTokenBuilder.buildTokenWithUid(
            app_id, cert, channel_name, uid, role_const, privilege_expired_ts
        )
        return {
            "app_id": app_id,
            "token": token,
            "channel_name": channel_name,
            "uid": uid,
            "expire_at": privilege_expired_ts,
        }
    except Exception:
        logger.exception("Agora token build failed")
        raise
