"""Regression tests for the KwikUPI recharge integration.

Focus areas:
* 6% commission / 94% credit math,
* server-side minimum and invalid-amount handling,
* webhook HMAC verification,
* idempotent wallet credit (the critical double-credit failure mode),
* authoritative gateway amount validation.
"""

import asyncio
import copy
import hashlib
import hmac
import os
import sys
from datetime import datetime, timezone

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services import kwikupi_service, payment_service, wallet_service


def _values(doc, path):
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
    flat = []
    for value in current:
        if isinstance(value, list):
            flat.extend(value)
        else:
            flat.append(value)
    return flat


def _matches(doc, query):
    for key, expected in query.items():
        values = _values(doc, key)
        if isinstance(expected, dict):
            if "$ne" in expected and expected["$ne"] in values:
                return False
            if "$ne" in expected:
                continue
            if "$exists" in expected and bool(values) is not bool(expected["$exists"]):
                return False
            if "$exists" in expected:
                continue
            if "$in" in expected and not any(value in expected["$in"] for value in values):
                return False
            if "$in" in expected:
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
    def __init__(self, matched=0, modified=0):
        self.matched_count = matched
        self.modified_count = modified


class FakeCursor:
    def __init__(self, docs):
        self.docs = docs

    def sort(self, key, direction=1):
        self.docs.sort(key=lambda d: _get_path(d, key, None), reverse=direction < 0)
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

    async def update_one(self, query, update, array_filters=None, upsert=False):
        target = next((doc for doc in self.docs if _matches(doc, query)), None)
        created = False
        if target is None:
            if not upsert:
                return FakeResult()
            target = {
                k: copy.deepcopy(v) for k, v in query.items() if not isinstance(v, dict)
            }
            self.docs.append(target)
            created = True
        for key, value in (update.get("$inc") or {}).items():
            _set_path(target, key, _get_path(target, key, 0) + value)
        for key, value in (update.get("$set") or {}).items():
            _set_path(target, key, value)
        for key, value in (update.get("$setOnInsert") or {}).items():
            if created:
                _set_path(target, key, value)
        for key, value in (update.get("$push") or {}).items():
            existing = _get_path(target, key, None)
            if not isinstance(existing, list):
                _set_path(target, key, [])
            _get_path(target, key).append(copy.deepcopy(value))
        return FakeResult(1, 1)

    async def find_one_and_update(self, query, update, return_document=None, upsert=False):
        target = next((doc for doc in self.docs if _matches(doc, query)), None)
        created = False
        if target is None:
            if not upsert:
                return None
            target = {"_id": f"fake_{len(self.docs)}"}
            self.docs.append(target)
            created = True
        for key, value in (update.get("$inc") or {}).items():
            _set_path(target, key, _get_path(target, key, 0) + value)
        for key, value in (update.get("$set") or {}).items():
            _set_path(target, key, value)
        for key, value in (update.get("$setOnInsert") or {}).items():
            if created:
                _set_path(target, key, value)
        for key, value in (update.get("$push") or {}).items():
            existing = _get_path(target, key, None)
            if not isinstance(existing, list):
                _set_path(target, key, [])
            _get_path(target, key).append(copy.deepcopy(value))
        return copy.deepcopy(target)


class FakeDB:
    def __init__(self, transactions=None, wallets=None, commissions=None):
        self.transactions = FakeCollection(transactions)
        self.wallets = FakeCollection(wallets)
        self.platform_wallet = FakeCollection(
            [{"platform_id": "platform_001", "balance": 0.0}]
        )
        self.platform_commissions = FakeCollection(commissions)


def test_six_percent_split_is_rounded_to_paise():
    split = payment_service.split_recharge(50)
    assert split["original_amount"] == 50.0
    assert split["total_commission"] == 3.0
    assert split["credit_amount"] == 47.0
    assert split["credit_amount"] + split["total_commission"] == 50.0

    split = payment_service.split_recharge(99)
    assert split["total_commission"] == 5.94
    assert split["credit_amount"] == 93.06


def test_recharge_amount_validation():
    assert payment_service.normalize_recharge_amount(50) == 50.0
    assert payment_service.normalize_recharge_amount("99.99") == 99.99
    with pytest.raises(ValueError):
        payment_service.normalize_recharge_amount(49.99)
    with pytest.raises(ValueError):
        payment_service.normalize_recharge_amount("not-a-number")
    with pytest.raises(ValueError):
        payment_service.normalize_recharge_amount(float("nan"))
    with pytest.raises(ValueError):
        payment_service.normalize_recharge_amount(100000.01)


def test_recharge_page_has_custom_minimum_and_kwikupi_checkout():
    from app.core.config import get_settings
    from app.routers.wallet import _recharge_page_html

    settings = get_settings()
    min_amount = f"₹{float(settings.min_recharge_amount):.0f}"
    packs = "".join(
        f'<button class="pack" data-amount="{p["amount"]}" '
        f'data-package="{p["id"]}">{p["label"]}</button>'
        for p in wallet_service.RECHARGE_PACKAGES
    )
    html = _recharge_page_html(
        token="test-token", balance=12.5, packs=packs, name="Test User"
    )

    assert 'id="custom"' in html
    assert f"Minimum {min_amount}" in html
    assert "KwikUPI" in html
    assert "Cashfree" not in html
    assert 'data-package="pkg_99"' in html


def test_kwikupi_webhook_signature_verification(monkeypatch):
    secret = "test-secret"

    class Settings:
        kwikupi_api_secret = secret

    monkeypatch.setattr(kwikupi_service, "get_settings", lambda: Settings())
    raw = b'{"order_id":"ord_1","status":"TXN_SUCCESS"}'
    signature = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()

    assert kwikupi_service.verify_webhook_signature(raw, signature)
    assert not kwikupi_service.verify_webhook_signature(raw + b"x", signature)
    assert not kwikupi_service.verify_webhook_signature(raw, "")


def test_initiate_recharge_creates_live_kwikupi_order(monkeypatch):
    db = FakeDB()
    monkeypatch.setattr(payment_service, "get_db", lambda: db)
    monkeypatch.setattr(kwikupi_service, "configured", lambda: True)

    created = {}

    async def create_payment(**kwargs):
        created.update(kwargs)
        return {
            "payment_id": "pay_test_123",
            "payment_page": "https://kwikupi.com/pay/pay_test_123",
        }

    monkeypatch.setattr(kwikupi_service, "create_payment", create_payment)

    result = asyncio.run(
        payment_service.initiate_recharge(
            user={"user_id": "u1", "name": "Test User"},
            amount=100,
        )
    )

    assert result["amount"] == 100.0
    assert result["credit_amount"] == 94.0
    assert result["commission"] == 6.0
    assert result["payment_id"] == "pay_test_123"
    assert created["amount"] == 100.0
    stored = db.transactions.docs[0]
    assert stored["type"] == "RECHARGE_PENDING"
    assert stored["amount"] == 100.0
    assert stored["metadata"]["payment_id"] == "pay_test_123"
    assert stored["metadata"]["gateway"] == "kwikupi"
    assert stored["metadata"]["payment_url"].startswith("https://kwikupi.com/")


def test_initiate_recharge_rejects_below_minimum_before_gateway(monkeypatch):
    db = FakeDB()
    monkeypatch.setattr(payment_service, "get_db", lambda: db)
    monkeypatch.setattr(kwikupi_service, "configured", lambda: True)

    async def create_payment(**kwargs):
        raise AssertionError("gateway should not be called")

    monkeypatch.setattr(kwikupi_service, "create_payment", create_payment)
    with pytest.raises(ValueError, match="Minimum recharge"):
        asyncio.run(
            payment_service.initiate_recharge(
                user={"user_id": "u1", "name": "Test"}, amount=10
            )
        )
    assert db.transactions.docs == []


def test_wallet_credit_is_applied_only_once(monkeypatch):
    db = FakeDB(wallets=[{"user_id": "u1", "balance": 0.0, "earnings_balance": 0.0}])
    monkeypatch.setattr(wallet_service, "get_db", lambda: db)

    first, wallet = asyncio.run(wallet_service.credit_balance_once("u1", 94.0, "ord_1"))
    second, wallet2 = asyncio.run(wallet_service.credit_balance_once("u1", 94.0, "ord_1"))

    assert first is True
    assert second is False
    assert wallet["balance"] == 94.0
    assert wallet2["balance"] == 94.0
    assert db.wallets.docs[0]["balance"] == 94.0
    assert db.wallets.docs[0]["credited_recharge_order_ids"] == ["ord_1"]


def test_platform_commission_balance_is_applied_only_once(monkeypatch):
    db = FakeDB()
    monkeypatch.setattr(wallet_service, "get_db", lambda: db)

    first = asyncio.run(wallet_service.add_platform_balance_once(6.0, "ord_1"))
    second = asyncio.run(wallet_service.add_platform_balance_once(6.0, "ord_1"))

    assert first is True
    assert second is False
    wallet = db.platform_wallet.docs[0]
    assert wallet["balance"] == 6.0
    assert wallet["credited_recharge_order_ids"] == ["ord_1"]


def test_process_order_success_credits_once_and_marks_platform_commission(monkeypatch):
    tx = {
        "transaction_id": "tx_recharge_ord_1",
        "user_id": "u1",
        "type": "RECHARGE_PENDING",
        "amount": 100.0,
        "metadata": {
            "order_id": "ord_1",
            "payment_id": "pay_1",
            "status": "PENDING",
            "gateway": "kwikupi",
        },
    }
    db = FakeDB(transactions=[tx])
    monkeypatch.setattr(payment_service, "get_db", lambda: db)
    monkeypatch.setattr(payment_service, "get_redis", lambda: None)

    credits = []

    async def credit_once(user_id, amount, order_id):
        credits.append((user_id, amount, order_id))
        return True, {"balance": amount}

    async def platform_once(amount, order_id):
        return True

    async def record_commission(**kwargs):
        return kwargs

    async def get_wallet(user_id):
        return {"user_id": user_id, "balance": 94.0}

    async def emit(*args, **kwargs):
        return None

    async def no_referral(user_id):
        return None

    monkeypatch.setattr(wallet_service, "credit_balance_once", credit_once)
    monkeypatch.setattr(wallet_service, "add_platform_balance_once", platform_once)
    monkeypatch.setattr(wallet_service, "record_platform_commission", record_commission)
    monkeypatch.setattr(wallet_service, "get_wallet", get_wallet)
    monkeypatch.setattr(payment_service, "emit_to_user", emit)
    from app.services import referral_service

    monkeypatch.setattr(referral_service, "maybe_pay_first_recharge_bonus", no_referral)

    payment = {
        "payment_id": "pay_1",
        "order_id": "ord_1",
        "status": "TXN_SUCCESS",
        "amount": "100.00",
    }

    first = asyncio.run(
        payment_service.process_order_success(
            "ord_1", verified_payment=payment, gateway_transaction_id="gw_1"
        )
    )
    second = asyncio.run(
        payment_service.process_order_success(
            "ord_1", verified_payment=payment, gateway_transaction_id="gw_1"
        )
    )

    assert first["status"] == "SUCCESS"
    assert first["credited"] == 94.0
    assert second["status"] == "SUCCESS"
    assert second.get("already") is True
    assert credits == [("u1", 94.0, "ord_1")]
    stored = db.transactions.docs[0]
    assert stored["type"] == "RECHARGE"
    assert stored["metadata"]["status"] == "SUCCESS"
    assert stored["metadata"]["credit_amount"] == 94.0
    assert stored["metadata"]["payment_id"] == "pay_1"


def test_webhook_verifies_status_and_credits_only_once(monkeypatch):
    tx = {
        "transaction_id": "tx_recharge_ord_3",
        "user_id": "u3",
        "type": "RECHARGE_PENDING",
        "amount": 50.0,
        "metadata": {
            "order_id": "ord_3",
            "payment_id": "pay_3",
            "status": "PENDING",
            "gateway": "kwikupi",
        },
    }
    db = FakeDB(transactions=[tx])
    monkeypatch.setattr(payment_service, "get_db", lambda: db)
    monkeypatch.setattr(payment_service, "get_redis", lambda: None)

    async def status(payment_id):
        assert payment_id == "pay_3"
        return {
            "payment_id": "pay_3",
            "order_id": "ord_3",
            "status": "TXN_SUCCESS",
            "amount": "50.00",
        }

    credits = []

    async def credit_once(user_id, amount, order_id):
        credits.append((user_id, amount, order_id))
        return True, {"balance": 47.0}

    async def noop(*args, **kwargs):
        return None

    async def get_wallet(user_id):
        return {"user_id": user_id, "balance": 47.0}

    from app.services import referral_service

    monkeypatch.setattr(kwikupi_service, "get_payment_status", status)
    monkeypatch.setattr(wallet_service, "credit_balance_once", credit_once)
    monkeypatch.setattr(wallet_service, "add_platform_balance_once", noop)
    monkeypatch.setattr(wallet_service, "record_platform_commission", noop)
    monkeypatch.setattr(wallet_service, "get_wallet", get_wallet)
    monkeypatch.setattr(payment_service, "emit_to_user", noop)
    monkeypatch.setattr(referral_service, "maybe_pay_first_recharge_bonus", noop)

    body = {
        "order_id": "ord_3",
        "status": "TXN_SUCCESS",
        "transaction_id": "gw_txn_3",
    }
    first = asyncio.run(payment_service.handle_webhook_payload(body))
    second = asyncio.run(payment_service.handle_webhook_payload(body))

    assert first["status"] == "SUCCESS"
    assert first["credited"] == 47.0
    assert second["status"] == "SUCCESS"
    assert credits == [("u3", 47.0, "ord_3")]
    stored = db.transactions.docs[0]
    assert stored["metadata"]["status"] == "SUCCESS"
    assert stored["metadata"]["gateway_transaction_id"] == "gw_txn_3"


def test_fresh_order_without_payment_id_is_retried_not_frozen(monkeypatch):
    tx = {
        "transaction_id": "tx_recharge_ord_new",
        "user_id": "u1",
        "type": "RECHARGE_PENDING",
        "amount": 50.0,
        "created_at": datetime.now(timezone.utc),
        "metadata": {
            "order_id": "ord_new",
            "status": "PENDING",
            "gateway": "kwikupi",
        },
    }
    db = FakeDB(transactions=[tx])
    monkeypatch.setattr(payment_service, "get_db", lambda: db)

    async def should_not_call(payment_id):
        raise AssertionError("no status call without a payment id")

    monkeypatch.setattr(kwikupi_service, "get_payment_status", should_not_call)

    result = asyncio.run(payment_service.verify_with_gateway("ord_new"))
    assert result["status"] == "PENDING"
    assert result["retryable"] is True
    assert db.transactions.docs[0]["metadata"]["status"] == "PENDING"


def test_legacy_cashfree_order_is_not_polled_through_kwikupi(monkeypatch):
    tx = {
        "transaction_id": "tx_recharge_ord_legacy",
        "user_id": "u1",
        "type": "RECHARGE_PENDING",
        "amount": 100.0,
        "metadata": {
            "order_id": "ord_legacy",
            "payment_session_id": "cashfree_session",
            "status": "PENDING",
            "gateway": "cashfree",
        },
    }
    db = FakeDB(transactions=[tx])
    monkeypatch.setattr(payment_service, "get_db", lambda: db)

    async def should_not_call(payment_id):
        raise AssertionError("legacy orders must not call KwikUPI")

    monkeypatch.setattr(kwikupi_service, "get_payment_status", should_not_call)

    result = asyncio.run(payment_service.verify_with_gateway("ord_legacy"))
    assert result["status"] == "LEGACY"
    assert db.transactions.docs[0]["metadata"]["status"] == "PENDING"


def test_process_order_success_rejects_wrong_gateway_amount(monkeypatch):
    tx = {
        "transaction_id": "tx_recharge_ord_2",
        "user_id": "u1",
        "type": "RECHARGE_PENDING",
        "amount": 100.0,
        "metadata": {
            "order_id": "ord_2",
            "payment_id": "pay_2",
            "status": "PENDING",
        },
    }
    db = FakeDB(transactions=[tx])
    monkeypatch.setattr(payment_service, "get_db", lambda: db)

    credits = []

    async def credit_once(*args, **kwargs):
        credits.append(args)
        return True, {"balance": 0}

    monkeypatch.setattr(wallet_service, "credit_balance_once", credit_once)

    result = asyncio.run(
        payment_service.process_order_success(
            "ord_2",
            verified_payment={
                "payment_id": "pay_2",
                "order_id": "ord_2",
                "status": "TXN_SUCCESS",
                "amount": "99.00",
            },
        )
    )

    assert result["status"] == "REVIEW"
    assert credits == []
    stored = db.transactions.docs[0]
    assert stored["metadata"]["status"] == "REVIEW"
    assert stored["metadata"]["review_reason"] == "AMOUNT_MISMATCH"
    assert stored["metadata"]["gateway_amount"] == 99.0
