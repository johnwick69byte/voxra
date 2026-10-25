#!/usr/bin/env python3
"""Reset admin passwords to known values."""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.database import connect_db, get_db, close_db
from app.core.security import hash_password


async def main():
    await connect_db()
    db = get_db()

    # Reset password for admin1@simple.talk
    new_password1 = 'Admin@123456'
    new_hash1 = hash_password(new_password1)

    result1 = await db.users.update_one(
        {'email': 'admin1@simple.talk'},
        {'$set': {'password_hash': hash_password(new_password1)}}
    )
    print(f"Updated admin1@simple.talk: {result1.modified_count} document(s)")
    print(f"New password for admin1@simple.talk: Admin@123456")

    # Also reset the original admin
    result2 = await db.users.update_one(
        {'email': 'admin@voxora.app'},
        {'$set': {'password_hash': hash_password('Admin@123456')}}
    )
    print(f"Updated admin@voxora.app: {result2.modified_count} document(s)")
    print(f"New password for admin@voxora.app: Admin@123456")

    await close_db()


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())