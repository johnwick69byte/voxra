"""
One-time migration: celebconnect-v2 (old) -> Simple Talk / voxora (new).

Usage (from apps/api, venv active):
    python scripts/migrate_from_celebconnect.py \
        --source "mongodb+srv://user:pass@old-cluster/celebconnect" \
        --source-db celebconnect \
        --dest "mongodb+srv://user:pass@new-cluster/voxora" \
        --dest-db voxora

What it does:
  1. users: user_type MODEL -> creator; drop appointment-only fields.
  2. model_profiles -> creator_profiles (profile_images -> images, carry flags).
  3. wallets: copied as-is.
  4. call_records: optional history import (see --skip-calls).
  5. Skips all appointments* collections.
  6. Rebuilds indexes via the API's _ensure_indexes-equivalent list.

Safe to re-run: upserts by primary id, never deletes. Pass --dry-run first.
"""

from __future__ import annotations

import argparse
import asyncio
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="celebconnect-v2 -> voxora migration")
    p.add_argument("--source", required=True, help="Old MongoDB URI")
    p.add_argument("--source-db", required=True, help="Old database name")
    p.add_argument("--dest", required=True, help="New MongoDB URI")
    p.add_argument("--dest-db", required=True, help="New database name")
    p.add_argument("--skip-calls", action="store_true", help="Do not import call history")
    p.add_argument("--dry-run", action="store_true", help="Report counts, write nothing")
    p.add_argument("--limit", type=int, default=0, help="Max docs per collection (0 = all)")
    return p.parse_args()


def _clean(doc: dict) -> dict:
    doc.pop("_id", None)
    return doc


async def migrate_users(src, dst, dry: bool, limit: int) -> int:
    cursor = src.users.find({"user_type": {"$in": ["MODEL", "USER", "model", "user", "ADMIN", "admin"]}})
    if limit:
        cursor = cursor.limit(limit)
    n = 0
    async for u in cursor:
        u = _clean(u)
        if u.get("user_type") in ("MODEL", "model"):
            u["user_type"] = "creator"
        elif u.get("user_type"):
            u["user_type"] = u["user_type"].lower()
        u["updated_at"] = datetime.now(timezone.utc)
        n += 1
        if not dry:
            await dst.users.update_one({"user_id": u["user_id"]}, {"$set": u}, upsert=True)
    return n


async def migrate_profiles(src, dst, dry: bool, limit: int) -> int:
    cursor = src.model_profiles.find({})
    if limit:
        cursor = cursor.limit(limit)
    n = 0
    async for p in cursor:
        p = _clean(p)
        p["images"] = p.pop("profile_images", p.get("images", [])) or []
        p.setdefault("bio", "")
        p.setdefault("instant_call_enabled", True)
        p.setdefault("is_dnd", False)
        p.setdefault("is_approved", False)
        if "verification_status" not in p:
            p["verification_status"] = "approved" if p.get("is_approved") else "pending_review"
        # Drop appointment-only fields, which have no home in the new schema.
        for key in ("appointment_enabled", "bank_details", "verification_video_link"):
            p.pop(key, None)
        n += 1
        if not dry:
            await dst.creator_profiles.update_one(
                {"user_id": p["user_id"]}, {"$set": p}, upsert=True
            )
    return n


async def migrate_wallets(src, dst, dry: bool, limit: int) -> int:
    cursor = src.wallets.find({})
    if limit:
        cursor = cursor.limit(limit)
    n = 0
    async for w in cursor:
        w = _clean(w)
        w.setdefault("balance", 0.0)
        w.setdefault("earnings_balance", w.get("earnings_balance", 0.0))
        n += 1
        if not dry:
            await dst.wallets.update_one({"user_id": w["user_id"]}, {"$set": w}, upsert=True)
    return n


async def migrate_calls(src, dst, dry: bool, limit: int) -> int:
    cursor = src.call_records.find({})
    if limit:
        cursor = cursor.limit(limit)
    n = 0
    async for c in cursor:
        c = _clean(c)
        c.pop("decline_token", None)
        n += 1
        if not dry:
            await dst.call_records.update_one({"call_id": c["call_id"]}, {"$set": c}, upsert=True)
    return n


async def ensure_indexes(dst) -> None:
    """Mirror apps/api/app/core/database.py _ensure_indexes for the migrated data."""
    await dst.users.create_index("user_id", unique=True)
    await dst.users.create_index("phone", unique=True, sparse=True)
    await dst.users.create_index("username", unique=True, sparse=True)
    await dst.users.create_index("referral_code", sparse=True)
    await dst.creator_profiles.create_index("user_id", unique=True)
    await dst.wallets.create_index("user_id", unique=True)
    await dst.call_records.create_index("call_id", unique=True)
    await dst.call_records.create_index([("receiver_id", 1), ("status", 1)])
    await dst.call_records.create_index([("caller_id", 1), ("created_at", -1)])


async def main() -> None:
    args = parse_args()
    src_client = AsyncIOMotorClient(args.source)
    dst_client = AsyncIOMotorClient(args.dest)
    src = src_client[args.source_db]
    dst = dst_client[args.dest_db]

    print(f"Migration {'(DRY RUN) ' if args.dry_run else ''}start")
    users = await migrate_users(src, dst, args.dry_run, args.limit)
    profiles = await migrate_profiles(src, dst, args.dry_run, args.limit)
    wallets = await migrate_wallets(src, dst, args.dry_run, args.limit)
    calls = 0 if args.skip_calls else await migrate_calls(src, dst, args.dry_run, args.limit)
    if not args.dry_run:
        await ensure_indexes(dst)
    print(
        f"Done: users={users} creator_profiles={profiles} wallets={wallets} "
        f"call_records={calls} (appointments* skipped)"
    )
    print(
        "Next: verify referential integrity for follows/reviews/transactions, "
        "and confirm the new app reads the migrated creators."
    )


if __name__ == "__main__":
    asyncio.run(main())
