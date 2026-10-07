"""Reproduce the socket.io 403 the production logs show on every WebSocket upgrade."""

import asyncio
import sys

from socketio import AsyncClient


async def main(url: str):
    sio = AsyncClient()

    @sio.event
    async def connect():
        print("CONNECTED")

    @sio.event
    async def connect_error(data):
        print("CONNECT_ERROR:", data)

    try:
        await sio.connect(url, transports=["websocket"], wait_timeout=15)
        print("result: connected, sid =", sio.sid)
        await sio.disconnect()
    except Exception as e:
        print("result: FAILED ->", type(e).__name__, e)


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "https://voxra-dkfe.onrender.com"
    asyncio.run(main(target))
