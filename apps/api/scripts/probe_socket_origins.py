"""Probe the socket.io handshake with various Origin headers.

Production logs show every WebSocket upgrade from the phone being rejected with
403, while a bare client connects fine. The difference is request headers.
"""

import asyncio
import sys

from socketio import AsyncClient

URL = "https://voxra-dkfe.onrender.com"

ORIGINS = [
    None,                        # no Origin header (works today)
    "http://localhost",
    "http://localhost:8081",
    "https://localhost",
    "capacitor://localhost",
    "https://voxra-dkfe.onrender.com",
    "null",
]


async def try_origin(origin, poll: bool):
    sio = AsyncClient()
    headers = {"Origin": origin} if origin is not None else {}
    result = {"origin": origin, "ok": False, "err": None}

    @sio.event
    async def connect():
        result["ok"] = True

    @sio.event
    async def connect_error(data):
        result["err"] = f"connect_error: {data}"

    try:
        await sio.connect(
            URL,
            transports=["websocket"],
            headers=headers,
            wait_timeout=12,
        )
        await sio.disconnect()
    except Exception as e:
        result["err"] = f"{type(e).__name__}: {e}"
    return result


async def main():
    for origin in ORIGINS:
        r = await try_origin(origin, False)
        label = "(none)" if r["origin"] is None else r["origin"]
        status = "OK" if r["ok"] else "FAIL"
        print(f"{status:4} origin={label:35} {r['err'] or ''}")


if __name__ == "__main__":
    asyncio.run(main())
