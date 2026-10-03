"""One-off backfill for browse denormalization.

Fills creator_profiles.search_text, avg_rating, review_count, and normalizes
is_online / is_dnd defaults, so the rewritten /creators/browse filters, search
and ranking work on data created before those fields existed.

Usage (from apps/api, venv active):
    python scripts/backfill_browse_index.py
"""

from __future__ import annotations

import asyncio

from motor.motor_asyncio import AsyncIOMotorClient

from app.core.config import get_settings


def _search_text(profile: dict, user: dict) -> str:
    parts = [
        user.get("name") or "",
        user.get("username") or "",
        profile.get("bio") or "",
        profile.get("category") or "",
        " ".join(profile.get("languages") or []),
    ]
    return " ".join(p for p in parts if p).lower()


async def main() -> None:
    settings = get_settings()
    client = AsyncIOMotorClient(settings.mongodb_uri)
    db = client[settings.mongodb_db]

    profiles = await db.creator_profiles.find({}).to_list(None)
    print(f"Backfilling {len(profiles)} creator profiles…")
    for p in profiles:
        uid = p["user_id"]
        u = await db.users.find_one({"user_id": uid}, {"_id": 0, "name": 1, "username": 1}) or {}
        rating = await db.reviews.aggregate(
            [
                {"$match": {"creator_id": uid}},
                {"$group": {"_id": None, "avg": {"$avg": "$rating"}, "count": {"$sum": 1}}},
            ]
        ).to_list(1)
        update = {
            "search_text": _search_text(p, u),
            "is_online": bool(p.get("is_online", False)),
            "is_dnd": bool(p.get("is_dnd", False)),
            "avg_rating": round(rating[0]["avg"], 2) if rating else None,
            "review_count": rating[0]["count"] if rating else 0,
        }
        await db.creator_profiles.update_one({"user_id": uid}, {"$set": update})
    print("Done.")


if __name__ == "__main__":
    asyncio.run(main())
