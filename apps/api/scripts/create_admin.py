"""Create, update or list admin accounts for the Simple Talk ops dashboard.

Uses the API's own settings, so it targets whatever `.env` points at:
    python scripts/create_admin.py                 # interactive
    python scripts/create_admin.py --list          # show existing admins
    python scripts/create_admin.py --email ops@you.com --password 'S3cret!' --name "Ops"

Re-running with an existing email updates the password (and name) instead of
failing, which is what you want for rotating a leaked credential.

Note: this writes directly to MongoDB. Point it at production only when you
genuinely mean to -- it prints the target DB host so you can tell.
"""

from __future__ import annotations

import argparse
import asyncio
import getpass
import os
import re
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.core.config import get_settings  # noqa: E402
from app.core.database import close_db, connect_db, get_db  # noqa: E402
from app.core.security import hash_password  # noqa: E402

MIN_PASSWORD_LENGTH = 10

# Passwords that have shipped in this project's history or are trivially guessed.
BANNED_PASSWORDS = {
    "admin123456",
    "admin123",
    "admin",
    "password",
    "password123",
    "simpletalk",
    "voxora123",
    "12345678",
    "changeme",
}

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def target_description() -> str:
    """Which database this run will touch -- easy to miss, so print it."""
    settings = get_settings()
    uri = settings.mongodb_uri
    try:
        host = urlparse(uri).hostname or "unknown-host"
    except Exception:
        host = "unparseable-uri"
    local = host in ("localhost", "127.0.0.1", "mongo")
    kind = "LOCAL" if local else "REMOTE"
    return f"{kind}  host={host}  db={settings.mongodb_db}"


def validate_email(value: str) -> str:
    email = value.strip().lower()
    if not EMAIL_RE.match(email):
        raise SystemExit(f"error: '{value}' is not a valid email address")
    return email


def validate_password(value: str) -> str:
    if len(value) < MIN_PASSWORD_LENGTH:
        raise SystemExit(
            f"error: password must be at least {MIN_PASSWORD_LENGTH} characters"
        )
    if value.lower() in BANNED_PASSWORDS:
        raise SystemExit(
            "error: that password has been used as a default in this project "
            "before (it is in the git history) -- pick something else"
        )
    return value


async def list_admins() -> None:
    db = get_db()
    admins = await db.users.find(
        {"user_type": "admin"},
        {"_id": 0, "user_id": 1, "email": 1, "name": 1, "created_at": 1},
    ).to_list(50)
    if not admins:
        print("No admin accounts found. Create one:")
        print("  python scripts/create_admin.py --email you@example.com --password '...'")
        return
    print(f"{len(admins)} admin account(s):")
    for a in admins:
        created = a.get("created_at")
        when = created.strftime("%Y-%m-%d") if hasattr(created, "strftime") else "-"
        print(f"  {a.get('email'):<32} {a.get('name') or '-':<20} {a.get('user_id')}  (since {when})")


async def upsert_admin(email: str, password: str, name: str) -> str:
    db = get_db()
    existing = await db.users.find_one({"email": email}, {"_id": 0, "user_id": 1, "user_type": 1})
    now = datetime.now(timezone.utc)

    if existing:
        was = existing.get("user_type")
        await db.users.update_one(
            {"email": email},
            {
                "$set": {
                    "user_type": "admin",
                    "password_hash": hash_password(password),
                    "name": name,
                    "profile_complete": True,
                    "updated_at": now,
                }
            },
        )
        # If a fan/creator account was promoted, make sure it is usable.
        await db.users.update_one(
            {"email": email},
            {"$unset": {"is_suspended": "", "deleted": ""}},
        )
        action = f"updated (was user_type={was})" if was != "admin" else "updated"
        print(f"\n  {action}: {email}")
        print(f"  user_id: {existing['user_id']}")
        return existing["user_id"]

    user_id = f"adm_{uuid.uuid4().hex[:10]}"
    await db.users.insert_one(
        {
            "user_id": user_id,
            "email": email,
            "name": name,
            "password_hash": hash_password(password),
            "user_type": "admin",
            "profile_complete": True,
            "created_at": now,
        }
    )
    print(f"\n  created: {email}")
    print(f"  user_id: {user_id}")
    return user_id


def prompt_email() -> str:
    while True:
        raw = input("Admin email: ").strip()
        try:
            return validate_email(raw)
        except SystemExit as e:
            print(f"  {e}")


def prompt_password() -> str:
    while True:
        pw = getpass.getpass(f"Admin password (min {MIN_PASSWORD_LENGTH} chars): ")
        if len(pw) < MIN_PASSWORD_LENGTH:
            print(f"  too short -- need at least {MIN_PASSWORD_LENGTH} characters")
            continue
        if pw.lower() in BANNED_PASSWORDS:
            print("  that password has been a project default before -- pick another")
            continue
        again = getpass.getpass("Confirm password: ")
        if pw != again:
            print("  passwords did not match -- try again")
            continue
        return pw


async def main() -> None:
    parser = argparse.ArgumentParser(
        description="Create, update or list Simple Talk admin accounts.",
    )
    parser.add_argument("--email", help="admin email address")
    parser.add_argument("--password", help="admin password (omit to be prompted securely)")
    parser.add_argument("--name", default=None, help="display name (default: Admin)")
    parser.add_argument("--list", action="store_true", help="list admins and exit")
    parser.add_argument("--yes", action="store_true", help="skip the remote-target confirmation")
    args = parser.parse_args()

    print("=" * 62)
    print("Simple Talk - admin account tool")
    print("=" * 62)
    print(f"target: {target_description()}")
    print()

    await connect_db()
    try:
        if args.list:
            await list_admins()
            return

        # Guard against accidentally resetting a production password.
        if "REMOTE" in target_description() and not args.yes:
            confirm = input("This is a REMOTE database. Continue? (y/N): ").strip().lower()
            if confirm != "y":
                print("Cancelled.")
                return

        email = validate_email(args.email) if args.email else prompt_email()

        if args.password:
            password = validate_password(args.password)
            print("(password taken from the command line -- it is in your shell history)")
        else:
            existing = await get_db().users.find_one({"email": email}, {"_id": 0, "user_id": 1})
            if existing:
                print(f"Account {email} exists -- setting a new password.")
            password = prompt_password()

        name = args.name or "Simple Talk Admin"
        await upsert_admin(email, password, name)
        print()
        print("=" * 62)
        print("Done. Sign in at the ops dashboard with this email and password.")
        print("Keep ALLOW_ADMIN_BOOTSTRAP=false in production (render.yaml sets it).")
        print("=" * 62)
    finally:
        await close_db()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nCancelled.")
