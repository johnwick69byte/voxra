"""Push notifications via FCM.

Two delivery modes:

* ``send_push`` (data_only=False) sends a *notification* message. Android
  renders it from the system tray, so it works even when the app has been
  force-stopped. Used for calls: a data-only message is NOT delivered to a
  killed app, which is why incoming calls never arrived.

* ``send_push`` (data_only=True) sends a data message, only for a process that
  is already alive.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any, Dict, Optional

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_firebase_ready = False


async def _incr_metric(key: str) -> None:
    try:
        from app.core.database_redis import get_redis, redis_available

        r = get_redis()
        if r and redis_available():
            await r.incr(key)
    except Exception:
        pass


def _ensure_firebase() -> bool:
    global _firebase_ready
    if _firebase_ready:
        return True
    settings = get_settings()
    if not settings.firebase_credentials_path and not settings.firebase_credentials_json:
        logger.warning(
            "Firebase not configured — push notifications are no-ops. Set "
            "FIREBASE_CREDENTIALS_PATH (Secret File) or FIREBASE_CREDENTIALS_JSON."
        )
        return False
    try:
        import json

        import firebase_admin
        from firebase_admin import credentials

        if not firebase_admin._apps:
            if settings.firebase_credentials_json:
                # JSON pasted directly into an env var (Render/any host).
                info = json.loads(settings.firebase_credentials_json)
                # Render may store newlines escaped; fix the private key.
                if "private_key" in info and "\\n" in info["private_key"]:
                    info["private_key"] = info["private_key"].replace("\\n", "\n")
                cred = credentials.Certificate(info)
            else:
                cred = credentials.Certificate(settings.firebase_credentials_path)
            firebase_admin.initialize_app(cred)
        _firebase_ready = True
        return True
    except Exception:
        logger.exception("Firebase init failed")
        return False


async def send_push(
    token: str,
    *,
    title: str,
    body: str,
    data: Optional[Dict[str, Any]] = None,
    data_only: bool = False,
    ttl_seconds: Optional[int] = None,
    channel_id: str = "app_notifications",
    full_screen: bool = False,
    loop_sound: bool = False,
    category: Optional[str] = None,
) -> bool:
    """Send one FCM message.

    full_screen=True marks the notification as a time-critical call alert:
    Android may then launch the app over the lock screen, which is what makes an
    incoming call look like WhatsApp. It also keeps the ring repeating.
    """
    if not token:
        return False
    if not _ensure_firebase():
        # Report the failure honestly. Previously this logged a "dry-run" and
        # returned True, so a misconfigured server looked like a healthy one and
        # the missing killed-state ring was invisible in the metrics.
        logger.error(
            "PUSH FAILED (Firebase not configured) %s | %s | data_only=%s",
            title,
            body,
            data_only,
        )
        await _incr_metric("metrics:fcm_fail")
        return False

    from firebase_admin import messaging

    str_data = {str(k): str(v) for k, v in (data or {}).items() if v is not None}
    ttl = timedelta(seconds=ttl_seconds) if ttl_seconds else None

    if data_only:
        android = messaging.AndroidConfig(priority="high", ttl=ttl, notification=None)
    else:
        android_notification = messaging.AndroidNotification(
            channel_id=channel_id,
            sound="default",
            # White silhouette installed by
            # plugins/withAndroidNotificationIcon.js. FCM renders this when the
            # app is killed; without it Android falls back to the launcher icon.
            icon="ic_notification",
            color="#0F766E",
        )
        if full_screen:
            # AndroidNotification has no full-screen flag; FCM maps these
            # extras onto the notification so the OS treats it as an alarm-class
            # alert that can take over the screen.
            # `priority` encodes to FCM's notification_priority and takes one of
            # "default" / "min" / "low" / "high" / "max".
            android_notification.priority = "max"
            android_notification.visibility = "public"
            android_notification.default_vibrate_timings = True
            android_notification.vibrate_timings_millis = [300, 500, 300, 500]
            android_notification.default_sound = True
            # No click_action: FCM treats it as an Intent action and it is
            # ignored unless the app declares a matching intent-filter. The tap
            # is routed by the data payload instead (see the mobile callRouter).
            android_notification.tag = str_data.get("call_id", "incoming_call")
            # Deliberately not sticky: a sticky notification survives the call
            # ending and the user cannot swipe it away.
        # NOTE: Android has no FCM `category` field -- the CALL category is
        # applied in-app by Notifee. `category` below sets the iOS APNs one.
        if channel_id == "incoming_calls_v1":
            android_notification.default_sound = True
        android = messaging.AndroidConfig(
            priority="high",
            ttl=ttl,
            notification=android_notification,
        )

    # On iOS a call must set content-available so the app can be woken, and
    # sound must be present for the ring to play while backgrounded.
    # Note: no CriticalSound -- that needs Apple's critical-alerts entitlement,
    # and requesting it without one makes the whole push fail.
    apns = messaging.APNSConfig(
        headers={"apns-priority": "10", "apns-push-type": "alert"}
        if not data_only
        else {"apns-priority": "5", "apns-push-type": "background"},
        payload=messaging.APNSPayload(
            aps=messaging.Aps(
                content_available=True,
                sound=None if data_only else "default",
                category="INCOMING_CALL" if loop_sound else None,
            )
        ),
    )

    message = messaging.Message(
        notification=None if data_only else messaging.Notification(title=title, body=body),
        data=str_data,
        token=token,
        android=android,
        apns=apns,
    )
    try:
        import asyncio

        await asyncio.to_thread(messaging.send, message)
        await _incr_metric("metrics:fcm_ok")
        return True
    except Exception:
        logger.exception("FCM send failed")
        await _incr_metric("metrics:fcm_fail")
        return False
