"""Verify the engine.io CORS wildcard handling.

`socketio.AsyncServer(cors_allowed_origins=["*"])` (a list) is NOT the same as
passing the string "*". engine.io only treats the *string* "*" as "allow
everything"; a list is compared by exact membership, so every real Origin fails
and the WebSocket upgrade is rejected with 403.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.config import get_settings

print("raw SOCKETIO_CORS_ORIGINS =", repr(get_settings().socketio_cors_origins))
print("socketio_cors_list       =", get_settings().socketio_cors_list)

import socketio

for value in (["*"], "*", None, ["http://localhost"]):
    srv = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins=value)
    eio = srv.eio
    allowed = eio.cors_allowed_origins

    # Reproduce engine.io's wildcard logic for a real phone Origin.
    origin = "http://localhost"
    if allowed is None:
        verdict = "ALLOW (None = allow all)"
    elif allowed == "*":
        verdict = "ALLOW (string wildcard)"
    elif isinstance(allowed, list):
        verdict = "ALLOW" if origin in allowed else f"REJECT (not in {allowed})"
    else:
        verdict = f"REJECT (unhandled type {type(allowed).__name__})"

    print(f"pass {value!r:22} -> eio.cors_allowed_origins={allowed!r:22} origin={origin!r} => {verdict}")
