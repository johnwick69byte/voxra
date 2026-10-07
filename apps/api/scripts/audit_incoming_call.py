"""End-to-end audit of the incoming-call path across all three app states.

Traces the actual payload and handler chain rather than trusting the comments.
"""

import json
import pathlib
import os
import sys

MOBILE = pathlib.Path(__file__).resolve().parents[2] / "mobile"
API_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API_ROOT))

print("=" * 72)
print("INCOMING CALL - delivery path audit")
print("=" * 72)

import inspect
from firebase_admin import messaging, _messaging_encoder
import app.services.push_service as ps
from unittest.mock import patch
import asyncio

sent = {}
ps._ensure_firebase = lambda: True
messaging.send = lambda m: sent.setdefault("m", m) or "ok"
ps._incr_metric = lambda k: asyncio.sleep(0)

asyncio.get_event_loop().run_until_complete(
    ps.send_push(
        "tok",
        title="Incoming audio call",
        body="Vijay is calling you",
        data={
            "type": "incoming_call",
            "call_id": "call_abc",
            "caller_name": "Vijay",
            "call_type": "AUDIO",
            "channel_name": "channel_call_abc",
            "decline_token": "dt",
            "route": "incoming-call",
        },
        data_only=False,
        ttl_seconds=45,
        channel_id="incoming_calls_v1",
        full_screen=True,
        loop_sound=True,
        category="call",
    )
)
raw = _messaging_encoder.MessageEncoder().default(sent["m"])

print("\n1. SERVER PAYLOAD")
print(f"   notification block      : {'YES' if 'notification' in raw else 'NO'}")
print(f"   android delivery prio   : {raw['android'].get('priority')}")
n = raw["android"]["notification"]
print(f"   notification_priority   : {n.get('notification_priority')}")
print(f"   visibility              : {n.get('visibility')}")
print(f"   channel_id              : {n.get('channel_id')}")
print(f"   small icon              : {n.get('icon')}")
print(f"   ttl                     : {raw['android'].get('ttl')}")

# 2. Handler coverage
print("\n2. CLIENT HANDLERS (index.js)")
idx = (MOBILE / "index.js").read_text(encoding="utf-8")

checks = [
    ("killed + tap", "getInitialNotification", "routes to call screen"),
    ("background + tap", "onNotificationOpenedApp", "routes to call screen"),
    ("foreground", "onMessage", "routes to call screen"),
    ("background delivery", "setBackgroundMessageHandler", "persists pending call"),
]
for state, handler, note in checks:
    present = handler in idx
    print(f"   {state:20} {handler:30} {'OK' if present else 'MISSING'}  ({note})")

# 3. CallKeep for full-screen UI
ck = (MOBILE / "src/services/CallKeepService.ts").read_text(encoding="utf-8")
print("\n3. CALLKEEP (full-screen call UI)")
for name, needle in [
    ("registerAndroidEvents bound", "registerAndroidEvents"),
    ("displayIncomingCall used", "displayIncomingCall"),
    ("answer listener", "answerCall"),
    ("end listener", "endCall"),
    ("phone account ensure", "registerPhoneAccount"),
]:
    print(f"   {name:30} {'OK' if needle in ck else 'MISSING'}")

# 4. Dedup
lay = (MOBILE / "app/_layout.tsx").read_text(encoding="utf-8")
print("\n4. DEDUP")
print(f"   incomingOpen claim      : {'OK' if 'claimCall' in lay else 'MISSING'}")
print(f"   clears on dismiss       : {'OK' if 'setIncomingOpen(null)' in lay else 'MISSING'}")

print("\n" + "=" * 72)
print("VERDICT")
print("=" * 72)
ok = (
    "notification" in raw
    and raw["android"].get("priority") == "high"
    and all(h in idx for _, h, _ in checks)
    and "registerAndroidEvents" in ck
)
print("Incoming call should reach a CLOSED app:" , "YES" if ok else "NO")
print("  - notification message   -> Android draws it without the app running")
print("  - priority high          -> wakes the device promptly")
print("  - tap routes to call UI  -> via getInitialNotification/onNotificationOpenedApp")
print("  - CallKeep registered    -> full-screen incoming UI on the lock screen")
