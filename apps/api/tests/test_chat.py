"""Paid chat billing and the Discover following filter."""

import asyncio
import copy
import os
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.routers import creators as creators_router
from app.services import chat_service, wallet_service


def _values(doc, path):
    current = [doc]
    for part in path.split("."):
        nxt = []
        for item in current:
            if isinstance(item, dict) and part in item:
                nxt.append(item[part])
        current = nxt
    flat = []
    for value in current:
        if isinstance(value, list):
            flat.extend(value)
        else:
            flat.append(value)
    return flat


def _matches(doc, query):
    for key, expected in (query or {}).items():
        values = _values(doc, key)
        if isinstance(expected, dict):
            if "$ne" in expected and expected["$ne"] in values:
                return False
            if "$ne" in expected:
                continue
            if "$in" in expected and not any(value in expected["$in"] for value in values):
                return False
            if "$in" in expected:
                continue
            if "$nin" in expected and any(value in expected["$nin"] for value in values):
                return False
            if "$nin" in expected:
                continue
            if "$gte" in expected and not any(value >= expected["$gte"] for value in values):
                return False
            if "$gte" in expected:
                continue
            if "$lt" in expected and not any(value < expected["$lt"] for value in values):
                return False
            if "$lt" in expected:
                continue
        if expected not in values:
            return False
    return True


def _set_path(doc, key, value):
    parts = key.split(".")
    target = doc
    for part in parts[:-1]:
        nxt = target.get(part)
        if not isinstance(nxt, dict):
            nxt = {}
            target[part] = nxt
        target = nxt
    target[parts[-1]] = copy.deepcopy(value)


def _get_path(doc, key, default=0):
    target = doc
    for part in key.split("."):
        if not isinstance(target, dict) or part not in target:
            return default
        target = target[part]
    return target


class FakeResult:
    def __init__(self, matched=0):
        self.matched_count = matched


class FakeCursor:
    def __init__(self, docs):
        self.docs = docs

    def sort(self, key, direction=1):
        spec = key if isinstance(key, list) else [(key, direction)]
        for field, way in reversed(spec):
            self.docs.sort(
                key=lambda doc, field=field: (
                    _get_path(doc, field, None) is None,
                    str(_get_path(doc, field, "")),
                ),
                reverse=way < 0,
            )
        return self

    def skip(self, n):
        self.docs = self.docs[n:]
        return self

    def limit(self, n):
        self.docs = self.docs[:n]
        return self

    async def to_list(self, n):
        return copy.deepcopy(self.docs[:n])


class FakeCollection:
    def __init__(self, docs=None):
        self.docs = [copy.deepcopy(d) for d in (docs or [])]

    async def find_one(self, query, projection=None):
        for doc in self.docs:
            if _matches(doc, query):
                return copy.deepcopy(doc)
        return None

    def find(self, query=None, projection=None):
        return FakeCursor([doc for doc in self.docs if _matches(doc, query or {})])

    async def insert_one(self, doc):
        self.docs.append(copy.deepcopy(doc))

    async def delete_one(self, query):
        before = len(self.docs)
        self.docs = [doc for doc in self.docs if not _matches(doc, query)]
        return FakeResult(before - len(self.docs))

    async def count_documents(self, query):
        return sum(1 for doc in self.docs if _matches(doc, query))

    async def distinct(self, field, query=None):
        found = []
        for doc in self.docs:
            if _matches(doc, query or {}) and field in doc and doc[field] not in found:
                found.append(doc[field])
        return found

    def _apply(self, query, update, upsert=False):
        target = next((doc for doc in self.docs if _matches(doc, query)), None)
        created = False
        if target is None:
            if not upsert:
                return None
            target = {k: copy.deepcopy(v) for k, v in query.items() if not isinstance(v, dict)}
            self.docs.append(target)
            created = True
        for key, value in (update.get("$inc") or {}).items():
            _set_path(target, key, _get_path(target, key, 0) + value)
        for key, value in (update.get("$set") or {}).items():
            _set_path(target, key, value)
        for key, value in (update.get("$setOnInsert") or {}).items():
            if created:
                _set_path(target, key, value)
        return target

    async def update_one(self, query, update, upsert=False):
        target = self._apply(query, update, upsert=upsert)
        return FakeResult(1 if target is not None else 0)

    async def find_one_and_update(self, query, update, return_document=None, upsert=False):
        target = self._apply(query, update, upsert=upsert)
        return copy.deepcopy(target) if target is not None else None


class FakeDB:
    def __init__(self):
        self._collections = {}

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        if name not in self._collections:
            self._collections[name] = FakeCollection()
        return self._collections[name]


FAN = {"user_id": "fan_1", "user_type": "user", "name": "Fan"}
CREATOR = {"user_id": "creator_1", "user_type": "creator", "name": "Creator"}


def _profile(user_id, name):
    return {
        "user_id": user_id,
        "is_approved": True,
        "instant_call_enabled": True,
        "is_dnd": False,
        "is_online": True,
        "avg_rating": 5,
        "review_count": 1,
        "audio_rate_per_minute": 10,
        "video_rate_per_minute": 20,
        "images": [],
        "name": name,
    }


def _bind(monkeypatch, db):
    async def _noop(*args, **kwargs):
        return None

    monkeypatch.setattr(chat_service, "get_db", lambda: db)
    monkeypatch.setattr(wallet_service, "get_db", lambda: db)
    monkeypatch.setattr(chat_service, "emit_to_user", _noop)
    monkeypatch.setattr(chat_service.push_service, "send_to_user", _noop)


def _seed_chat(balance=10.0):
    db = FakeDB()
    db.users.docs = [
        {"user_id": "fan_1", "user_type": "user", "name": "Fan"},
        {"user_id": "creator_1", "user_type": "creator", "name": "Creator"},
    ]
    db.creator_profiles.docs = [_profile("creator_1", "Creator")]
    db.wallets.docs = [
        {"user_id": "fan_1", "balance": balance, "earnings_balance": 0.0},
        {"user_id": "creator_1", "balance": 0.0, "earnings_balance": 0.0},
    ]
    db.platform_wallet.docs = [{"platform_id": "platform_001", "balance": 0.0}]
    return db


def _wallet(db, user_id):
    return next(doc for doc in db.wallets.docs if doc["user_id"] == user_id)


def test_fan_message_splits_one_rupee(monkeypatch):
    db = _seed_chat()
    _bind(monkeypatch, db)

    opened = asyncio.run(chat_service.open_conversation(FAN, "creator_1"))
    conversation_id = opened["conversation"]["conversation_id"]
    result = asyncio.run(
        chat_service.send_message(FAN, conversation_id, "hello", "client-1")
    )

    assert result["message"]["price"] == 1.0
    assert _wallet(db, "fan_1")["balance"] == 9.0
    assert _wallet(db, "creator_1")["earnings_balance"] == 0.5
    assert db.platform_wallet.docs[0]["balance"] == 0.5
    types = {tx["type"]: tx["amount"] for tx in db.transactions.docs}
    assert types["CHAT_DEBIT"] == 1.0
    assert types["CHAT_CREDIT"] == 0.5
    assert db.platform_commissions.docs[0]["type"] == "CHAT_COMMISSION"
    assert db.platform_commissions.docs[0]["amount"] == 0.5
    assert len(db.chat_messages.docs) == 1


def test_repeat_client_id_does_not_charge_again(monkeypatch):
    db = _seed_chat()
    _bind(monkeypatch, db)
    opened = asyncio.run(chat_service.open_conversation(FAN, "creator_1"))
    conversation_id = opened["conversation"]["conversation_id"]

    first = asyncio.run(chat_service.send_message(FAN, conversation_id, "hello", "client-1"))
    second = asyncio.run(chat_service.send_message(FAN, conversation_id, "hello", "client-1"))

    assert second["duplicate"] is True
    assert second["message"]["message_id"] == first["message"]["message_id"]
    assert _wallet(db, "fan_1")["balance"] == 9.0
    assert _wallet(db, "creator_1")["earnings_balance"] == 0.5
    assert db.platform_wallet.docs[0]["balance"] == 0.5
    assert len(db.chat_messages.docs) == 1


def test_low_balance_does_not_create_a_message(monkeypatch):
    db = _seed_chat(balance=0.5)
    _bind(monkeypatch, db)
    opened = asyncio.run(chat_service.open_conversation(FAN, "creator_1"))
    conversation_id = opened["conversation"]["conversation_id"]

    with pytest.raises(HTTPException) as exc:
        asyncio.run(chat_service.send_message(FAN, conversation_id, "hello", "client-1"))

    assert exc.value.status_code == 402
    assert db.chat_messages.docs == []
    assert _wallet(db, "fan_1")["balance"] == 0.5
    assert db.platform_wallet.docs[0]["balance"] == 0.0


def test_creator_cannot_start_a_chat(monkeypatch):
    db = _seed_chat()
    _bind(monkeypatch, db)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(chat_service.open_conversation(CREATOR, "fan_1"))
    assert exc.value.status_code == 403

    with pytest.raises(HTTPException) as missing:
        asyncio.run(chat_service.send_message(CREATOR, "chat_missing", "hi", "client-1"))
    assert missing.value.status_code == 404


def test_creator_reply_is_free(monkeypatch):
    db = _seed_chat()
    _bind(monkeypatch, db)
    opened = asyncio.run(chat_service.open_conversation(FAN, "creator_1"))
    conversation_id = opened["conversation"]["conversation_id"]
    asyncio.run(chat_service.send_message(FAN, conversation_id, "hello", "client-1"))

    reply = asyncio.run(
        chat_service.send_message(CREATOR, conversation_id, "hey", "client-2")
    )

    assert reply["message"]["price"] == 0.0
    assert _wallet(db, "fan_1")["balance"] == 9.0
    assert _wallet(db, "creator_1")["earnings_balance"] == 0.5
    assert db.platform_wallet.docs[0]["balance"] == 0.5
    assert len(db.chat_messages.docs) == 2


def test_block_rejects_send(monkeypatch):
    db = _seed_chat()
    _bind(monkeypatch, db)
    opened = asyncio.run(chat_service.open_conversation(FAN, "creator_1"))
    conversation_id = opened["conversation"]["conversation_id"]
    db.blocks.docs.append({"blocker_id": "creator_1", "blocked_id": "fan_1"})

    with pytest.raises(HTTPException) as exc:
        asyncio.run(chat_service.send_message(FAN, conversation_id, "hello", "client-1"))

    assert exc.value.status_code == 403
    assert db.chat_messages.docs == []
    assert _wallet(db, "fan_1")["balance"] == 10.0


def test_failed_settlement_refunds_the_fan(monkeypatch):
    db = _seed_chat()
    _bind(monkeypatch, db)

    async def _boom(*args, **kwargs):
        raise RuntimeError("credit failed")

    monkeypatch.setattr(wallet_service, "credit_earnings", _boom)
    opened = asyncio.run(chat_service.open_conversation(FAN, "creator_1"))
    conversation_id = opened["conversation"]["conversation_id"]

    with pytest.raises(HTTPException) as exc:
        asyncio.run(chat_service.send_message(FAN, conversation_id, "hello", "client-1"))

    assert exc.value.status_code == 500
    assert db.chat_messages.docs == []
    assert _wallet(db, "fan_1")["balance"] == 10.0


def _browse(db, user, following):
    return asyncio.run(
        creators_router.browse_creators(
            sort="recommended",
            q="",
            status="all",
            gender="",
            language="",
            category="",
            page=1,
            limit=20,
            following=following,
            user=user,
        )
    )


def test_contact_details_are_rejected_and_times_are_allowed(monkeypatch):
    from app.services.chat_filter import contains_contact_details

    blocked = [
        "call me 9876543210",
        "my number is +91 98765 43210",
        "reach me at 098765-43210",
        "9 8 7 6 5 4 3 2 1 0",
        "nine eight seven six five four three two one zero",
        "https://instagram.com/cool.name",
        "insta is cool_name",
        "telegram: star_girl",
        "t.me/star_girl",
        "t . me / star_girl",
        "wa.me/919876543210",
        "ping me @star_girl",
        "free at 10:30, number 9876543210",
    ]
    allowed = [
        "see you at 10:30",
        "I am free at 10:30 pm",
        "let's talk at 5pm",
        "around 10.30 or 18:05",
        "between 3 and 4",
        "five thirty works",
        "the call rate is 1500",
        "hello there",
    ]
    for sample in blocked:
        assert contains_contact_details(sample), sample
    for sample in allowed:
        assert not contains_contact_details(sample), sample

    db = _seed_chat()
    _bind(monkeypatch, db)
    opened = asyncio.run(chat_service.open_conversation(FAN, "creator_1"))
    conversation_id = opened["conversation"]["conversation_id"]

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            chat_service.send_message(FAN, conversation_id, "call 9876543210", "client-phone")
        )
    assert exc.value.status_code == 400
    assert db.chat_messages.docs == []
    assert _wallet(db, "fan_1")["balance"] == 10.0

    sent = asyncio.run(
        chat_service.send_message(FAN, conversation_id, "see you at 10:30", "client-time")
    )
    assert sent["message"]["text"] == "see you at 10:30"
    assert _wallet(db, "fan_1")["balance"] == 9.0

    with pytest.raises(HTTPException) as creator_exc:
        asyncio.run(
            chat_service.send_message(CREATOR, conversation_id, "insta is cool_name", "client-ig")
        )
    assert creator_exc.value.status_code == 400
    assert len(db.chat_messages.docs) == 1


def test_following_browse_returns_only_followed_creators(monkeypatch):
    db = FakeDB()
    db.creator_profiles.docs = [
        _profile("creator_a", "Ava"),
        _profile("creator_b", "Bea"),
        _profile("creator_c", "Cia"),
    ]
    db.users.docs = [
        {"user_id": "fan_1", "name": "Fan"},
        {"user_id": "creator_a", "name": "Ava"},
        {"user_id": "creator_b", "name": "Bea"},
        {"user_id": "creator_c", "name": "Cia"},
    ]
    db.follows.docs = [
        {"follower_id": "fan_1", "creator_id": "creator_a"},
        {"follower_id": "fan_1", "creator_id": "creator_c"},
    ]
    db.blocks.docs = [{"blocker_id": "fan_1", "blocked_id": "creator_c"}]
    monkeypatch.setattr(creators_router, "get_db", lambda: db)

    followed = _browse(db, FAN, True)
    ids = [row["user_id"] for row in followed["creators"]]
    assert ids == ["creator_a"]

    empty = FakeDB()
    empty.creator_profiles.docs = [_profile("creator_a", "Ava")]
    empty.users.docs = [{"user_id": "creator_a", "name": "Ava"}]
    monkeypatch.setattr(creators_router, "get_db", lambda: empty)
    nobody = _browse(empty, FAN, True)
    assert nobody["creators"] == []
    assert nobody["total"] == 0
