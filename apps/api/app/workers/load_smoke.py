"""
Simple API smoke / load helpers for soft-launch checks.

  python -m app.workers.load_smoke
"""

from __future__ import annotations

import asyncio
import logging

import httpx

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("voxora.load")

BASE = "http://localhost:8000/api"


async def run():
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(f"{BASE}/healthz")
        logger.info("healthz %s %s", r.status_code, r.text)

        r = await client.get(f"{BASE}/app/config")
        logger.info("config %s", r.status_code)

        # Parallel OTP sends (dev)
        async def one(i: int):
            phone = f"90000000{i:02d}"
            s = await client.post(f"{BASE}/auth/otp/send", json={"phone": phone, "country_code": "+91"})
            v = await client.post(
                f"{BASE}/auth/otp/verify",
                json={"phone": phone, "country_code": "+91", "otp": "123456", "user_type": "user"},
            )
            return s.status_code, v.status_code, v.json().get("success")

        results = await asyncio.gather(*[one(i) for i in range(5)])
        logger.info("otp burst %s", results)
        logger.info("load smoke complete")


if __name__ == "__main__":
    asyncio.run(run())
