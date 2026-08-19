"""
Optional Redis — presence/locks degrade to Mongo when Redis is down.

Supports:
- Standard REDIS_URL (redis:// or rediss://)
- Upstash via UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
  (auto-builds rediss:// compatible with redis-py)
"""

from __future__ import annotations

import logging
from typing import Optional
from urllib.parse import quote, urlparse

import redis.asyncio as redis

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_redis: Optional[redis.Redis] = None
_redis_ok = False


def _strip_env(value: str) -> str:
    return (value or "").strip().strip('"').strip("'")


def resolve_redis_url() -> str:
    """Pick a redis-py compatible URL (prefer Upstash TLS when REST creds exist)."""
    settings = get_settings()
    redis_url = _strip_env(settings.redis_url)
    rest_url = _strip_env(getattr(settings, "upstash_redis_rest_url", "") or "")
    token = _strip_env(getattr(settings, "upstash_redis_rest_token", "") or "")

    if rest_url and token:
        host = urlparse(rest_url).hostname
        if host:
            # Upstash native Redis protocol over TLS — works with redis.asyncio
            return f"rediss://default:{quote(token, safe='')}@{host}:6379"

    return redis_url or "redis://localhost:6379/0"


async def connect_redis() -> Optional[redis.Redis]:
    global _redis, _redis_ok
    url = resolve_redis_url()
    try:
        _redis = redis.from_url(
            url,
            decode_responses=True,
            socket_connect_timeout=5,
            socket_timeout=5,
            health_check_interval=30,
        )
        await _redis.ping()
        _redis_ok = True
        parsed = urlparse(url)
        logger.info("Redis connected (%s://%s)", parsed.scheme, parsed.hostname)
        return _redis
    except Exception:
        logger.exception("Redis connect failed for %s", urlparse(url).hostname or url)
        _redis = None
        _redis_ok = False
        return None


async def close_redis() -> None:
    global _redis, _redis_ok
    if _redis is not None:
        await _redis.aclose()
    _redis = None
    _redis_ok = False


def get_redis() -> Optional[redis.Redis]:
    return _redis


def redis_available() -> bool:
    return _redis_ok and _redis is not None


def presence_key(user_id: str) -> str:
    return f"presence:{user_id}"


def ring_lock_key(creator_id: str) -> str:
    return f"ring:{creator_id}"


def call_billing_key(call_id: str) -> str:
    return f"billing:{call_id}"


def call_timeout_key(call_id: str) -> str:
    return f"timeout:{call_id}"


def idempotency_key(key: str) -> str:
    return f"idem:{key}"
