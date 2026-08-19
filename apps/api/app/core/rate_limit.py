"""Rate limiting with Redis (in-memory fallback when Redis is down)."""

from __future__ import annotations

import asyncio
import time
from typing import Dict, List

from app.core.database_redis import get_redis, redis_available

_memory: Dict[str, List[float]] = {}
_lock = asyncio.Lock()


async def check_rate_limit(key: str, limit: int, window_seconds: int) -> bool:
    """Return True if the request is allowed, False if the limit is exceeded."""
    r = get_redis()
    if r and redis_available():
        try:
            pipe_key = f"rl:{key}"
            count = await r.incr(pipe_key)
            if count == 1:
                await r.expire(pipe_key, window_seconds)
            return count <= limit
        except Exception:
            pass

    async with _lock:
        now = time.time()
        cutoff = now - window_seconds
        hits = [t for t in _memory.get(key, []) if t > cutoff]
        if len(hits) >= limit:
            _memory[key] = hits
            return False
        hits.append(now)
        _memory[key] = hits
        return True
