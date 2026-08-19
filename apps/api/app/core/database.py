from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.core.config import get_settings

_client: AsyncIOMotorClient | None = None
_db: AsyncIOMotorDatabase | None = None


async def connect_db() -> AsyncIOMotorDatabase:
    global _client, _db
    settings = get_settings()
    _client = AsyncIOMotorClient(settings.mongodb_uri)
    _db = _client[settings.mongodb_db]
    await _ensure_indexes(_db)
    return _db


async def close_db() -> None:
    global _client, _db
    if _client is not None:
        _client.close()
    _client = None
    _db = None


def get_db() -> AsyncIOMotorDatabase:
    if _db is None:
        raise RuntimeError("Database not initialized")
    return _db


async def _ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    await db.users.create_index("user_id", unique=True)
    await db.users.create_index("phone", unique=True, sparse=True)
    await db.users.create_index("username", unique=True, sparse=True)
    await db.creator_profiles.create_index("user_id", unique=True)
    await db.wallets.create_index("user_id", unique=True)
    await db.call_records.create_index("call_id", unique=True)
    await db.call_records.create_index([("receiver_id", 1), ("status", 1)])
    await db.call_records.create_index([("caller_id", 1), ("created_at", -1)])
    await db.transactions.create_index("transaction_id", unique=True)
    await db.transactions.create_index([("user_id", 1), ("created_at", -1)])
    await db.push_tokens.create_index("user_id", unique=True)
    await db.follows.create_index([("follower_id", 1), ("creator_id", 1)], unique=True)
    await db.follows.create_index("creator_id")
    await db.reviews.create_index("creator_id")
    await db.blocks.create_index([("blocker_id", 1), ("blocked_id", 1)], unique=True)
    await db.admin_audit.create_index([("created_at", -1)])
    await db.otp_codes.create_index("expires_at", expireAfterSeconds=0)
