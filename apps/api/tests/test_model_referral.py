"""Regression tests for the creator (model) referral program.

Covers the failures found in the original hallucinated implementation:
* the API must import (the service had an IndentationError),
* referral code generation supports the MDL prefix and checks the right field,
* complete-profile accepts the model_referral_code field,
* a creator cannot refer themselves,
* every paid withdrawal credits 5% to the referrer exactly once per request.
"""

import asyncio
import copy
import inspect
import os
import sys
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _get_values(doc, path):
    current = [doc]
    for part in path.split("."):
        nxt = []
        for item in current:
            if isinstance(item, dict) and part in item:
                nxt.append(item[part])
            elif isinstance(item, list):
                for element in item:
                    if isinstance(element, dict) and part in element:
                        nxt.append(element[part])
        current = nxt
    return current


def _matches(doc, query):
    for key, expected in query.items():
        values = _get_values(doc, key)
        if isinstance(expected, dict) and "$ne" in expected:
            if expected["$ne"] in values:
                return False
            continue
        if isinstance(expected, dict) and "$exists" in expected:
            if bool(values) is not bool(expected["$exists"]):
                return False
            continue
        if isinstance(expected, dict) and "$in" in expected:
            if not any(value in expected["$in"] for value in values):
                return False
            continue
        if isinstance(expected, dict) and "$gte" in expected:
            if not any(value >= expected["$gte"] for value in values):
                return False
            continue
        if expected not in values:
            return False
    return True


class FakeResult:
    def __init__(self, matched=0, modified=0):
        self.matched_count = matched
        self.modified_count = modified


class FakeCursor:
    def __init__(self, docs):
        self.docs = docs

    def sort(self, key, direction=-1):
        return self

    async def to_list(self, length):
        return copy.deepcopy(self.docs[:length])


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

    async def count_documents(self, query):
        return sum(1 for doc in self.docs if _matches(doc, query))

    async def insert_one(self, doc):
        if "withdrawal_request_id" in doc and any(
            d.get("withdrawal_request_id") == doc["withdrawal_request_id"] for d in self.docs
        ):
            raise DuplicateKeyError("duplicate withdrawal_request_id")
        self.docs.append(copy.deepcopy(doc))

    async def delete_one(self, query):
        self.docs = [d for d in self.docs if not _matches(d, query)]

    async def update_one(self, query, update, array_filters=None, upsert=False):
        target = None
        for doc in self.docs:
            if _matches(doc, query):
                target = doc
                break
        if target is None:
            if not upsert:
                return FakeResult()
            target = {
                k: copy.deepcopy(v)
                for k, v in query.items()
                if not isinstance(v, dict)
            }
            self.docs.append(target)

        for key, value in (update.get("$inc") or {}).items():
            if "$." in key:
                array_name, _, field = key.partition(".$.")
                filters = array_filters
                if filters:
                    pairs = [(k.split(".")[-1], v) for k, v in filters[0].items()]
                else:
                    pairs = [
                        (k.split(".")[-1], v)
                        for k, v in query.items()
                        if k.startswith(f"{array_name}.")
                    ]
                for element in target.get(array_name, []):
                    if all(element.get(k) == v for k, v in pairs):
                        element[field] = element.get(field, 0) + value
            else:
                target[key] = target.get(key, 0) + value

        for key, value in (update.get("$set") or {}).items():
            if "$." in key:
                array_name, _, field = key.partition(".$.")
                filters = array_filters
                if filters:
                    pairs = [(k.split(".")[-1], v) for k, v in filters[0].items()]
                else:
                    pairs = [
                        (k.split(".")[-1], v)
                        for k, v in query.items()
                        if k.startswith(f"{array_name}.")
                    ]
                for element in target.get(array_name, []):
                    if all(element.get(k) == v for k, v in pairs):
                        element[field] = copy.deepcopy(value)
            else:
                target[key] = copy.deepcopy(value)

        for key, value in (update.get("$push") or {}).items():
            target.setdefault(key, []).append(copy.deepcopy(value))

        return FakeResult(matched=1, modified=1)

    async def find_one_and_update(self, query, update, return_document=None, upsert=False):
        target = None
        for doc in self.docs:
            if _matches(doc, query):
                target = doc
                break
        if target is None:
            if not upsert:
                return None
            target = {"_id": f"fake_{len(self.docs)}"}
            self.docs.append(target)

        for key, value in (update.get("$inc") or {}).items():
            target[key] = target.get(key, 0) + value
        for key, value in (update.get("$set") or {}).items():
            target[key] = copy.deepcopy(value)
        for key, value in (update.get("$setOnInsert") or {}).items():
            target.setdefault(key, copy.deepcopy(value))
        return copy.deepcopy(target)


class FakeDB:
    def __init__(
        self,
        users=None,
        bonuses=None,
        transactions=None,
        creator_profiles=None,
        notifications=None,
        push_tokens=None,
    ):
        self.users = FakeCollection(users)
        self.model_referral_bonuses = FakeCollection(bonuses)
        self.transactions = FakeCollection(transactions)
        self.creator_profiles = FakeCollection(creator_profiles)
        self.notifications = FakeCollection(notifications)
        self.push_tokens = FakeCollection(push_tokens)


# ── Service imports and helpers ─────────────────────────────────────────────


def test_api_imports_without_syntax_errors():
    import app.main  # noqa: F401


def test_mask_phone_keeps_last_four_digits():
    from app.services.model_referral_service import _mask_phone

    assert _mask_phone("9876543210") == "+91******3210"
    assert _mask_phone(None) == "Hidden"
    assert _mask_phone("12") == "Hidden"


def test_share_message_mentions_code_and_percentage():
    from app.services.model_referral_service import build_share_message

    message = build_share_message("MDLABC123", "simpletalk://login?model_ref=MDLABC123")
    assert "MDLABC123" in message
    assert "5%" in message
    assert "₹20" not in message
    assert "simpletalk://login?model_ref=MDLABC123" in message
    assert "4️⃣ Set your rates" not in message


def test_complete_profile_accepts_model_referral_code():
    from app.models.schemas import CompleteProfileRequest

    body = CompleteProfileRequest(
        name="Test Creator",
        user_type="creator",
        model_referral_code="MDLABC123",
    )
    assert body.model_referral_code == "MDLABC123"


def test_generate_referral_code_uses_prefix_and_field(monkeypatch):
    from app.services import auth_service

    db = FakeDB(users=[])
    monkeypatch.setattr(auth_service, "get_db", lambda: db)

    async def run():
        return await auth_service.generate_referral_code(
            prefix="MDL", length=6, field="model_referral_code"
        )

    code = asyncio.run(run())
    assert code.startswith("MDL")
    assert len(code) == 9

    default_code = asyncio.run(auth_service.generate_referral_code())
    assert len(default_code) == 8


# ── Applying a code ─────────────────────────────────────────────────────────


def test_creator_cannot_use_own_model_referral_code(monkeypatch):
    from app.services import model_referral_service

    me = {
        "user_id": "creator_1",
        "user_type": "creator",
        "name": "Me",
        "model_referral_code": "MDLAAA111",
    }
    db = FakeDB(users=[me])
    monkeypatch.setattr(model_referral_service, "get_db", lambda: db)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(model_referral_service.apply_model_referral_code(me, "MDLAAA111"))
    assert exc.value.status_code == 400


def test_apply_code_tracks_referral_on_referrer(monkeypatch):
    from app.services import model_referral_service

    me = {"user_id": "creator_1", "user_type": "creator", "name": "New Creator"}
    referrer = {
        "user_id": "creator_0",
        "user_type": "creator",
        "is_approved": True,
        "name": "Referrer",
        "model_referral_code": "MDLBBB222",
        "model_referrals": [],
    }
    db = FakeDB(
        users=[me, referrer],
        creator_profiles=[{"user_id": "creator_0", "is_approved": True}],
    )
    monkeypatch.setattr(model_referral_service, "get_db", lambda: db)

    result = asyncio.run(
        model_referral_service.apply_model_referral_code(me, "MDLBBB222")
    )
    assert result["success"] is True
    saved_me = next(u for u in db.users.docs if u["user_id"] == "creator_1")
    saved_referrer = next(u for u in db.users.docs if u["user_id"] == "creator_0")
    assert saved_me["model_referred_by"] == "creator_0"
    assert saved_referrer["model_referrals"][0]["user_id"] == "creator_1"


def test_pending_referrer_code_is_rejected(monkeypatch):
    from app.services import model_referral_service

    me = {"user_id": "creator_1", "user_type": "creator", "name": "New Creator"}
    referrer = {
        "user_id": "creator_0",
        "user_type": "creator",
        "is_approved": False,
        "name": "Pending Referrer",
        "model_referral_code": "MDLPEND1",
    }
    # No approved creator_profiles row: the user-level flag alone must not pass.
    db = FakeDB(users=[me, referrer], creator_profiles=[])
    monkeypatch.setattr(model_referral_service, "get_db", lambda: db)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(model_referral_service.apply_model_referral_code(me, "MDLPEND1"))
    assert exc.value.status_code == 404
    assert "inactive" in exc.value.detail.lower()


def test_circular_model_referral_is_rejected(monkeypatch):
    from app.services import model_referral_service

    me = {"user_id": "creator_1", "user_type": "creator", "name": "Me"}
    referrer = {
        "user_id": "creator_0",
        "user_type": "creator",
        "is_approved": True,
        "name": "Referrer",
        "model_referral_code": "MDLBBB222",
        "model_referred_by": "creator_1",
    }
    db = FakeDB(
        users=[me, referrer],
        creator_profiles=[{"user_id": "creator_0", "is_approved": True}],
    )
    monkeypatch.setattr(model_referral_service, "get_db", lambda: db)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(model_referral_service.apply_model_referral_code(me, "MDLBBB222"))
    assert exc.value.status_code == 400
    assert "Circular" in exc.value.detail


# ── Bonus payout ────────────────────────────────────────────────────────────


def test_every_paid_withdrawal_pays_five_percent_once(monkeypatch):
    from app.services import model_referral_service

    referrer = {
        "user_id": "creator_0",
        "user_type": "creator",
        "name": "Referrer",
        "model_referral_earnings": 0.0,
        "model_referrals": [
            {
                "user_id": "creator_1",
                "name": "Referred",
                "total_withdrawals": 0.0,
                "total_bonus_from_them": 0.0,
                "status": "pending",
            }
        ],
    }
    referred = {
        "user_id": "creator_1",
        "user_type": "creator",
        "name": "Referred",
        "model_referred_by": "creator_0",
    }
    db = FakeDB(users=[referrer, referred])
    monkeypatch.setattr(model_referral_service, "get_db", lambda: db)

    credits = []

    async def credit(user_id, amount):
        credits.append((user_id, amount))

    transactions = []

    async def insert_tx(**kwargs):
        transactions.append(kwargs)

    async def wallet(user_id):
        return {"balance": 0}

    async def emit(*args, **kwargs):
        return None

    monkeypatch.setattr(model_referral_service.wallet_service, "credit_earnings", credit)
    monkeypatch.setattr(model_referral_service.wallet_service, "insert_transaction", insert_tx)
    monkeypatch.setattr(model_referral_service.wallet_service, "get_wallet", wallet)
    monkeypatch.setattr(model_referral_service, "emit_to_user", emit)

    first = asyncio.run(
        model_referral_service.process_model_referral_bonus("creator_1", 1000, "wd_1")
    )
    assert first is True
    assert credits == [("creator_0", 50.0)]
    assert transactions[0]["tx_type"] == "MODEL_REFERRAL_BONUS"
    assert len(db.model_referral_bonuses.docs) == 1
    assert len(db.notifications.docs) == 1
    assert db.notifications.docs[0]["type"] == "model_referral_bonus"
    assert db.notifications.docs[0]["user_id"] == "creator_0"

    # Retrying the same withdrawal must not pay again.
    retry = asyncio.run(
        model_referral_service.process_model_referral_bonus("creator_1", 1000, "wd_1")
    )
    assert retry is False
    assert credits == [("creator_0", 50.0)]

    # A later withdrawal pays again (5% of every withdrawal).
    second = asyncio.run(
        model_referral_service.process_model_referral_bonus("creator_1", 200, "wd_2")
    )
    assert second is True
    assert credits == [("creator_0", 50.0), ("creator_0", 10.0)]
    assert len(db.notifications.docs) == 2

    saved_referrer = next(u for u in db.users.docs if u["user_id"] == "creator_0")
    assert saved_referrer["model_referral_earnings"] == 60.0
    assert saved_referrer["model_referrals"][0]["total_bonus_from_them"] == 60.0
    assert saved_referrer["model_referrals"][0]["total_withdrawals"] == 1200.0
    assert saved_referrer["model_referrals"][0]["status"] == "active"


def test_credit_failure_removes_marker_for_retry(monkeypatch):
    from app.services import model_referral_service

    referrer = {"user_id": "creator_0", "user_type": "creator", "name": "Referrer"}
    referred = {
        "user_id": "creator_1",
        "user_type": "creator",
        "name": "Referred",
        "model_referred_by": "creator_0",
    }
    db = FakeDB(users=[referrer, referred])
    monkeypatch.setattr(model_referral_service, "get_db", lambda: db)

    async def credit_boom(user_id, amount):
        raise RuntimeError("wallet unavailable")

    monkeypatch.setattr(
        model_referral_service.wallet_service, "credit_earnings", credit_boom
    )

    with pytest.raises(RuntimeError):
        asyncio.run(
            model_referral_service.process_model_referral_bonus(
                "creator_1", 1000, "wd_fail"
            )
        )
    assert db.model_referral_bonuses.docs == []


def test_ledger_failure_keeps_marker_and_never_double_pays(monkeypatch):
    from app.services import model_referral_service

    referrer = {"user_id": "creator_0", "user_type": "creator", "name": "Referrer"}
    referred = {
        "user_id": "creator_1",
        "user_type": "creator",
        "name": "Referred",
        "model_referred_by": "creator_0",
    }
    db = FakeDB(users=[referrer, referred])
    monkeypatch.setattr(model_referral_service, "get_db", lambda: db)

    credits = []

    async def credit(user_id, amount):
        credits.append((user_id, amount))

    async def tx_boom(**kwargs):
        raise RuntimeError("ledger unavailable")

    async def wallet(user_id):
        return {"balance": 0}

    async def emit(*args, **kwargs):
        return None

    monkeypatch.setattr(model_referral_service.wallet_service, "credit_earnings", credit)
    monkeypatch.setattr(
        model_referral_service.wallet_service, "insert_transaction", tx_boom
    )
    monkeypatch.setattr(model_referral_service.wallet_service, "get_wallet", wallet)
    monkeypatch.setattr(model_referral_service, "emit_to_user", emit)

    first = asyncio.run(
        model_referral_service.process_model_referral_bonus("creator_1", 1000, "wd_keep")
    )
    assert first is True
    assert len(db.model_referral_bonuses.docs) == 1

    # A retry after a partial bookkeeping failure must not credit again.
    retry = asyncio.run(
        model_referral_service.process_model_referral_bonus("creator_1", 1000, "wd_keep")
    )
    assert retry is False
    assert credits == [("creator_0", 50.0)]


def test_withdrawal_below_minimum_does_not_pay(monkeypatch):
    from app.services import model_referral_service

    referred = {
        "user_id": "creator_1",
        "user_type": "creator",
        "name": "Referred",
        "model_referred_by": "creator_0",
    }
    db = FakeDB(users=[referred])
    monkeypatch.setattr(model_referral_service, "get_db", lambda: db)

    credits = []

    async def credit(user_id, amount):
        credits.append((user_id, amount))

    monkeypatch.setattr(model_referral_service.wallet_service, "credit_earnings", credit)

    paid = asyncio.run(
        model_referral_service.process_model_referral_bonus("creator_1", 50, "wd_small")
    )
    assert paid is False
    assert credits == []


def test_withdrawal_split_charges_ten_percent_and_pays_five_percent():
    from app.services.wallet_service import calculate_withdrawal_split

    referred = calculate_withdrawal_split(1000, referral_eligible=True)
    assert referred["commission_amount"] == 100.0
    assert referred["payout_amount"] == 900.0
    assert referred["referral_bonus_amount"] == 50.0
    assert referred["platform_commission_amount"] == 50.0

    unreferred = calculate_withdrawal_split(1000, referral_eligible=False)
    assert unreferred["commission_amount"] == 100.0
    assert unreferred["payout_amount"] == 900.0
    assert unreferred["referral_bonus_amount"] == 0.0
    assert unreferred["platform_commission_amount"] == 100.0


def test_withdraw_records_ten_percent_split_and_referrer(monkeypatch):
    from app.models.schemas import BankDetails, WithdrawalRequest
    from app.routers import wallet as wallet_router
    from app.services import model_referral_service

    referrer = {"user_id": "creator_0", "name": "Referrer"}
    referred = {
        "user_id": "creator_1",
        "name": "Referred",
        "user_type": "creator",
        "model_referred_by": "creator_0",
    }
    db = FakeDB(users=[referrer, referred])
    db.wallets = FakeCollection(
        [{"user_id": "creator_1", "balance": 0.0, "earnings_balance": 1000.0}]
    )
    db.withdrawal_requests = FakeCollection([])
    monkeypatch.setattr(wallet_router, "get_db", lambda: db)
    monkeypatch.setattr(model_referral_service, "get_db", lambda: db)

    async def get_wallet(user_id):
        return copy.deepcopy(db.wallets.docs[0])

    transactions = []

    async def insert_tx(**kwargs):
        transactions.append(kwargs)

    monkeypatch.setattr(wallet_router.wallet_service, "get_wallet", get_wallet)
    monkeypatch.setattr(
        wallet_router.wallet_service, "insert_transaction", insert_tx
    )

    body = WithdrawalRequest(
        amount=1000,
        upi_id="creator@upi",
        account_name="Referred",
        bank_details=BankDetails(
            bank_name="Test Bank",
            account_number="1234567890",
            ifsc_code="TEST0001",
            account_holder_name="Referred",
        ),
    )
    result = asyncio.run(wallet_router.withdraw(body, user=referred))

    assert result["payout_amount"] == 900.0
    assert result["commission_amount"] == 100.0
    assert result["platform_commission_amount"] == 50.0
    assert result["referral_bonus_amount"] == 50.0

    saved = db.withdrawal_requests.docs[0]
    assert saved["amount"] == 1000.0
    assert saved["commission_amount"] == 100.0
    assert saved["payout_amount"] == 900.0
    assert saved["referral_bonus_amount"] == 50.0
    assert saved["platform_commission_amount"] == 50.0
    assert saved["referrer_id"] == "creator_0"
    assert saved["referral_status"] == "PENDING"
    assert db.wallets.docs[0]["earnings_balance"] == 0.0
    assert transactions[0]["metadata"]["payout_amount"] == 900.0


def test_referral_is_skipped_when_either_account_is_deleted(monkeypatch):
    from app.services import model_referral_service

    referrer = {"user_id": "creator_0", "name": "Referrer"}
    referred = {
        "user_id": "creator_1",
        "name": "Referred",
        "user_type": "creator",
        "model_referred_by": "creator_0",
    }

    active_db = FakeDB(users=[referrer, referred])
    monkeypatch.setattr(model_referral_service, "get_db", lambda: active_db)
    assert (
        asyncio.run(model_referral_service.resolve_withdrawal_referrer("creator_1"))[
            "referrer_id"
        ]
        == "creator_0"
    )

    deleted_referred = dict(referred, deleted=True)
    db = FakeDB(users=[referrer, deleted_referred])
    monkeypatch.setattr(model_referral_service, "get_db", lambda: db)
    assert (
        asyncio.run(model_referral_service.resolve_withdrawal_referrer("creator_1"))
        is None
    )

    deleted_referrer = dict(referrer, deleted=True)
    db = FakeDB(users=[deleted_referrer, referred])
    monkeypatch.setattr(model_referral_service, "get_db", lambda: db)
    assert (
        asyncio.run(model_referral_service.resolve_withdrawal_referrer("creator_1"))
        is None
    )

    credits = []

    async def credit(user_id, amount):
        credits.append((user_id, amount))

    monkeypatch.setattr(
        model_referral_service.wallet_service, "credit_earnings", credit
    )
    db = FakeDB(users=[referrer, deleted_referred])
    monkeypatch.setattr(model_referral_service, "get_db", lambda: db)
    paid = asyncio.run(
        model_referral_service.process_model_referral_bonus(
            "creator_1", 1000, "wd_deleted"
        )
    )
    assert paid is False
    assert credits == []


def test_admin_withdrawal_view_shows_referral_or_full_platform_share():
    from app.routers import admin

    referred = admin._withdrawal_view(
        {
            "request_id": "wd_1",
            "user_id": "creator_1",
            "amount": 1000,
            "status": "PENDING",
            "referral_status": "PENDING",
            "referrer_id": "creator_0",
            "referrer_name": "Referrer",
        },
        {"referrer_id": "creator_0", "referrer_name": "Referrer"},
    )
    assert referred["commission_amount"] == 100.0
    assert referred["payout_amount"] == 900.0
    assert referred["referral_bonus_amount"] == 50.0
    assert referred["platform_commission_amount"] == 50.0
    assert referred["referrer_name"] == "Referrer"

    deleted = admin._withdrawal_view(
        {
            "request_id": "wd_2",
            "user_id": "creator_1",
            "amount": 1000,
            "status": "PENDING",
            "referral_status": "PENDING",
            "referrer_id": "creator_0",
            "referrer_name": "Referrer",
        },
        None,
    )
    assert deleted["referral_status"] == "CANCELLED"
    assert deleted["referral_bonus_amount"] == 0.0
    assert deleted["platform_commission_amount"] == 100.0

    plain = admin._withdrawal_view(
        {
            "request_id": "wd_3",
            "user_id": "creator_3",
            "amount": 1000,
            "status": "PENDING",
            "referral_status": "PLATFORM",
        },
        None,
    )
    assert plain["referral_bonus_amount"] == 0.0
    assert plain["platform_commission_amount"] == 100.0


def test_admin_mark_paid_settles_ten_percent_and_pays_referral_once(monkeypatch):
    from app.routers import admin
    from app.services import model_referral_service

    referrer = {
        "user_id": "creator_0",
        "user_type": "creator",
        "name": "Referrer",
        "model_referral_earnings": 0.0,
        "model_referrals": [],
    }
    referred = {
        "user_id": "creator_1",
        "user_type": "creator",
        "name": "Referred",
        "model_referred_by": "creator_0",
    }
    db = FakeDB(users=[referrer, referred])
    db.withdrawal_requests = FakeCollection(
        [
            {
                "request_id": "wd_paid",
                "user_id": "creator_1",
                "amount": 1000.0,
                "commission_rate": 0.1,
                "commission_amount": 100.0,
                "payout_amount": 900.0,
                "referral_bonus_percentage": 5.0,
                "referral_bonus_amount": 50.0,
                "platform_commission_amount": 50.0,
                "referrer_id": "creator_0",
                "referrer_name": "Referrer",
                "referral_status": "PENDING",
                "upi_id": "creator@upi",
                "status": "PENDING",
            }
        ]
    )
    db.admin_audit = FakeCollection([])
    monkeypatch.setattr(admin, "get_db", lambda: db)
    monkeypatch.setattr(model_referral_service, "get_db", lambda: db)

    credits = []

    async def credit(user_id, amount):
        credits.append((user_id, amount))

    async def insert_tx(**kwargs):
        return None

    async def wallet(user_id):
        return {"balance": 0}

    async def emit(*args, **kwargs):
        return None

    monkeypatch.setattr(model_referral_service.wallet_service, "credit_earnings", credit)
    monkeypatch.setattr(model_referral_service.wallet_service, "insert_transaction", insert_tx)
    monkeypatch.setattr(model_referral_service.wallet_service, "get_wallet", wallet)
    monkeypatch.setattr(model_referral_service, "emit_to_user", emit)
    monkeypatch.setattr(admin, "emit_to_user", emit)

    result = asyncio.run(
        admin.mark_paid("wd_paid", admin={"user_id": "admin_1"})
    )
    saved = db.withdrawal_requests.docs[0]
    assert result["payout_amount"] == 900.0
    assert result["referral_bonus_paid"] is True
    assert saved["status"] == "PAID"
    assert saved["commission_amount"] == 100.0
    assert saved["payout_amount"] == 900.0
    assert saved["referral_bonus_amount"] == 50.0
    assert saved["platform_commission_amount"] == 50.0
    assert saved["referral_status"] == "PAID"
    assert credits == [("creator_0", 50.0)]

    retry = asyncio.run(
        admin.mark_paid("wd_paid", admin={"user_id": "admin_1"})
    )
    assert retry["referral_bonus_paid"] is True
    assert credits == [("creator_0", 50.0)]


def test_admin_mark_paid_keeps_full_ten_percent_after_referred_deletion(monkeypatch):
    from app.routers import admin
    from app.services import model_referral_service

    referrer = {"user_id": "creator_0", "name": "Referrer"}
    referred = {
        "user_id": "creator_1",
        "name": "Referred",
        "user_type": "creator",
        "model_referred_by": "creator_0",
        "deleted": True,
    }
    db = FakeDB(users=[referrer, referred])
    db.withdrawal_requests = FakeCollection(
        [
            {
                "request_id": "wd_deleted",
                "user_id": "creator_1",
                "amount": 1000.0,
                "commission_rate": 0.1,
                "commission_amount": 100.0,
                "payout_amount": 900.0,
                "referral_bonus_percentage": 5.0,
                "referral_bonus_amount": 50.0,
                "platform_commission_amount": 50.0,
                "referrer_id": "creator_0",
                "referrer_name": "Referrer",
                "referral_status": "PENDING",
                "upi_id": "creator@upi",
                "status": "PENDING",
            }
        ]
    )
    db.admin_audit = FakeCollection([])
    monkeypatch.setattr(admin, "get_db", lambda: db)
    monkeypatch.setattr(model_referral_service, "get_db", lambda: db)

    credits = []

    async def credit(user_id, amount):
        credits.append((user_id, amount))

    async def insert_tx(**kwargs):
        return None

    async def wallet(user_id):
        return {"balance": 0}

    async def emit(*args, **kwargs):
        return None

    monkeypatch.setattr(model_referral_service.wallet_service, "credit_earnings", credit)
    monkeypatch.setattr(model_referral_service.wallet_service, "insert_transaction", insert_tx)
    monkeypatch.setattr(model_referral_service.wallet_service, "get_wallet", wallet)
    monkeypatch.setattr(model_referral_service, "emit_to_user", emit)
    monkeypatch.setattr(admin, "emit_to_user", emit)

    result = asyncio.run(
        admin.mark_paid("wd_deleted", admin={"user_id": "admin_1"})
    )
    saved = db.withdrawal_requests.docs[0]
    assert result["referral_bonus_paid"] is False
    assert credits == []
    assert saved["status"] == "PAID"
    assert saved["payout_amount"] == 900.0
    assert saved["referral_bonus_amount"] == 0.0
    assert saved["platform_commission_amount"] == 100.0
    assert saved["referral_status"] == "CANCELLED"


def test_admin_mark_paid_triggers_bonus():
    from app.routers import admin

    source = inspect.getsource(admin.mark_paid)
    assert "process_model_referral_bonus" in source
    assert "withdrawal_request_id=request_id" in source
    assert "referral_bonus_paid" in source


def test_approval_syncs_user_level_flag():
    from app.routers import admin

    approve_source = inspect.getsource(admin.approve_creator)
    assert "users.update_one" in approve_source
    assert '"is_approved": True' in approve_source

    reject_source = inspect.getsource(admin.reject_creator)
    assert "users.update_one" in reject_source
    assert '"is_approved": False' in reject_source


# ── Router and profile integration ─────────────────────────────────────────


def test_model_referral_routes_are_registered():
    from app.main import app

    paths = {route.path for route in app.routes}
    assert "/api/model-referral/overview" in paths
    assert "/api/model-referral/apply" in paths
    assert "/api/model-referral/earnings" in paths
    assert "/api/model-referral/referrals" in paths
    assert "/api/admin/model-referrals" in paths


def test_overview_totals_and_can_apply(monkeypatch):
    from app.services import model_referral_service as service

    now = datetime.now(timezone.utc)
    referrer = {
        "user_id": "ref1",
        "user_type": "creator",
        "name": "Referrer",
        "model_referral_code": "MDLREF1",
    }
    referred = {
        "user_id": "m1",
        "name": "Referred",
        "phone": "9876543210",
        "created_at": now,
        "is_approved": True,
        "model_referred_by": "ref1",
    }
    bonuses = [
        {
            "referrer_id": "ref1",
            "referred_user_id": "m1",
            "referred_model_name": "Referred",
            "withdrawal_amount": 1000.0,
            "bonus_amount": 50.0,
            "bonus_percentage": 5.0,
            "created_at": now,
        }
    ]
    db = FakeDB(
        users=[referrer, referred],
        bonuses=bonuses,
        creator_profiles=[{"user_id": "ref1", "is_approved": True}],
    )
    monkeypatch.setattr(service, "get_db", lambda: db)

    data = asyncio.run(service.get_model_referral_overview(referrer))
    assert data["code"] == "MDLREF1"
    assert data["referred_count"] == 1
    assert data["earned_total"] == 50.0
    assert data["this_month_earnings"] == 50.0
    assert data["is_approved"] is True
    assert data["can_apply"] is True
    assert data["referrals"][0]["total_bonus_from_them"] == 50.0
    assert data["referrals"][0]["total_withdrawals"] == 1000.0
    assert data["referrals"][0]["status"] == "active"


def test_admin_summary_totals(monkeypatch):
    from app.services import model_referral_service as service

    now = datetime.now(timezone.utc)
    referrer = {
        "user_id": "ref1",
        "user_type": "creator",
        "name": "Referrer",
        "phone": "9876543210",
    }
    referred = {
        "user_id": "m1",
        "name": "Referred",
        "model_referred_by": "ref1",
        "is_approved": True,
    }
    bonuses = [
        {
            "withdrawal_request_id": "wd1",
            "referrer_id": "ref1",
            "referred_user_id": "m1",
            "referred_model_name": "Referred",
            "withdrawal_amount": 1000.0,
            "bonus_amount": 50.0,
            "bonus_percentage": 5.0,
            "created_at": now,
        }
    ]
    db = FakeDB(users=[referrer, referred], bonuses=bonuses)
    monkeypatch.setattr(service, "get_db", lambda: db)

    data = asyncio.run(service.get_admin_model_referral_summary())
    assert data["total_bonuses_paid"] == 50.0
    assert data["bonus_count"] == 1
    assert data["this_month_bonus"] == 50.0
    assert data["active_referrers"] == 1
    assert data["referred_models"] == 1
    assert data["approved_referred_models"] == 1
    assert data["models_with_paid_withdrawals"] == 1
    assert data["conversion_rate"] == 100.0
    assert data["top_referrers"][0]["name"] == "Referrer"
    assert data["top_referrers"][0]["total_bonus"] == 50.0
    assert data["recent_bonuses"][0]["withdrawal_request_id"] == "wd1"


def test_complete_profile_persists_model_referral(monkeypatch):
    from app.models.schemas import CATEGORIES, CompleteProfileRequest
    from app.routers import auth, creators
    from app.services import auth_service

    referrer = {
        "user_id": "ref1",
        "user_type": "creator",
        "is_approved": True,
        "name": "Referrer",
        "model_referral_code": "MDLREF1",
        "model_referrals": [],
    }
    new_creator = {"user_id": "new1", "user_type": "creator"}
    db = FakeDB(
        users=[referrer, new_creator],
        creator_profiles=[{"user_id": "ref1", "is_approved": True}],
    )
    monkeypatch.setattr(auth, "get_db", lambda: db)
    monkeypatch.setattr(auth_service, "get_db", lambda: db)

    async def noop(*args, **kwargs):
        return None

    monkeypatch.setattr(creators, "refresh_search_text", noop)

    body = CompleteProfileRequest(
        name="New Creator",
        username="newcreator",
        user_type="creator",
        gender="Female",
        category=CATEGORIES[0],
        languages=["English"],
        model_referral_code="MDLREF1",
    )
    result = asyncio.run(auth.complete_profile(body, new_creator))

    saved = next(u for u in db.users.docs if u["user_id"] == "new1")
    assert saved["profile_complete"] is True
    assert saved["model_referral_code"].startswith("MDL")
    assert saved["model_referred_by"] == "ref1"
    assert result["success"] is True

    saved_referrer = next(u for u in db.users.docs if u["user_id"] == "ref1")
    assert saved_referrer["model_referrals"][0]["user_id"] == "new1"
