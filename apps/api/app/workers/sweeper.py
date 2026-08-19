"""
Background worker entry (optional separate process).

  python -m app.workers.sweeper

Main API already runs an in-process sweeper; use this for multi-instance deploys.
"""

import asyncio
import logging

from app.core.database import connect_db, close_db
from app.core.database_redis import connect_redis, close_redis
from app.services import call_service

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("voxora.sweeper")


async def main():
    await connect_db()
    await connect_redis()
    try:
        while True:
            n = await call_service.sweep_stuck_calls()
            if n:
                logger.info("Swept %s stuck calls", n)
            await asyncio.sleep(30)
    finally:
        await close_redis()
        await close_db()


if __name__ == "__main__":
    asyncio.run(main())
