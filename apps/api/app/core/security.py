from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import bcrypt
from fastapi import Depends, Header, HTTPException
from jose import JWTError, jwt

from app.core.config import get_settings
from app.core.database import get_db


def create_access_token(user_id: str, user_type: str, *, admin: bool = False) -> str:
    settings = get_settings()
    secret = settings.admin_jwt_secret if admin else settings.jwt_secret
    expire = datetime.now(timezone.utc) + timedelta(days=settings.jwt_expire_days)
    payload = {
        "sub": user_id,
        "user_type": user_type,
        "admin": admin,
        "exp": expire,
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def decode_token(token: str, *, admin: bool = False) -> dict:
    settings = get_settings()
    secret = settings.admin_jwt_secret if admin else settings.jwt_secret
    try:
        return jwt.decode(token, secret, algorithms=["HS256"])
    except JWTError as e:
        raise HTTPException(status_code=401, detail="Invalid or expired token") from e


async def get_current_user(
    authorization: Optional[str] = Header(default=None),
) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.split(" ", 1)[1]
    payload = decode_token(token)
    db = get_db()
    user = await db.users.find_one({"user_id": payload["sub"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if user.get("is_suspended"):
        raise HTTPException(status_code=403, detail="Account suspended")
    return user


async def require_user(user: dict = Depends(get_current_user)) -> dict:
    return user


async def require_creator(user: dict = Depends(require_user)) -> dict:
    if user.get("user_type") != "creator":
        raise HTTPException(status_code=403, detail="Creator access required")
    return user


async def require_admin(
    authorization: Optional[str] = Header(default=None),
) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.split(" ", 1)[1]
    payload = decode_token(token, admin=True)
    if not payload.get("admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    db = get_db()
    user = await db.users.find_one({"user_id": payload["sub"]}, {"_id": 0})
    if not user or user.get("user_type") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())
