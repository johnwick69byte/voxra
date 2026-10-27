"""Regression tests for the PayQ recharge integration.

Focus areas:
* 6% commission / 94% credit math,
* server-side minimum and invalid-amount handling,
* PayQ's PHP-style form webhook HMAC verification,
* idempotent wallet credit (the critical double-credit failure mode),
* authoritative gateway amount/order validation.
"""

import asyncio
import copy
import hashlib
import hmac
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services import payment_service, payq_service, wallet_service


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
        for key in (update.get("$unset") or {}):
            parts = key.split(".")
            parent = target
            for part in parts[:-1]:
                parent = parent.get(part) if isinstance(parent, dict) else None
                if not isinstance(parent, dict):
                    break
            if isinstance(parent, dict):
                parent.pop(parts[-1], None)
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
        for key in (update.get("$unset") or {}):
            parts = key.split(".")
            parent = target
            for part in parts[:-1]:
                parent = parent.get(part) if isinstance(parent, dict) else None
                if not isinstance(parent, dict):
                    break
            if isinstance(parent, dict):
                parent.pop(parts[-1], None)
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


def test_recharge_page_has_custom_minimum_and_payq_checkout():
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
    assert "PayQ" in html
    assert "KwikUPI" not in html
    assert 'data-package="pkg_99"' in html


def test_payq_webhook_signature_matches_php_http_build_query(monkeypatch):
    secret = "test-webhook-secret"

    class Settings:
        payq_webhook_secret = secret

    monkeypatch.setattr(payq_service, "get_settings", lambda: Settings())

    items = [
        ("status", "SUCCESS"),
        ("order_id", "ORD_1"),
        ("amount", "50.00"),
        ("remark1", "Plan Subscription"),
        ("remark2", "user@example.com"),
        ("message", "Payment Successful"),
        ("utr", "425985112456"),
        ("result[txnStatus]", "COMPLETED"),
        ("result[orderId]", "ORD_1"),
        ("result[status]", "SUCCESS"),
        ("result[amount]", "50.00"),
        ("result[utr]", "425985112456"),
        ("hash", "ignored-for-signature"),
    ]
    expected_query = (
        "status=SUCCESS&order_id=ORD_1&amount=50.00"
        "&remark1=Plan+Subscription&remark2=user%40example.com"
        "&message=Payment+Successful&utr=425985112456"
        "&result%5BtxnStatus%5D=COMPLETED&result%5BorderId%5D=ORD_1"
        "&result%5Bstatus%5D=SUCCESS&result%5Bamount%5D=50.00"
        "&result%5Butr%5D=425985112456"
    )
    signature = hmac.new(
        secret.encode(), expected_query.encode(), hashlib.sha256
    ).hexdigest()

    assert payq_service.verify_webhook_signature(items, signature)
    assert not payq_service.verify_webhook_signature(
        items[:-1] + [("hash", "wrong"), ("message", "tampered")], signature
    )
    assert not payq_service.verify_webhook_signature(items, "")


def test_payq_status_classification_is_strict():
    success = {
        "status": "COMPLETED",
        "result": {"status": "SUCCESS", "txnStatus": "COMPLETED"},
    }
    assert payq_service.classify(success) == "SUCCESS"
    assert payq_service.classify(
        {"status": "COMPLETED", "result": {"status": "PENDING"}}
    ) == "PENDING"
    assert payq_service.classify(
        {"status": "COMPLETED", "result": {}}
    ) == "UNKNOWN"
    assert payq_service.classify(
        {"status": "FAILURE", "result": {"status": "FAILED"}}
    ) == "FAILED"
    assert payq_service.classify(
        {"status": "FAILURE", "message": "Too many requests"}
    ) == "PENDING"


def test_initiate_recharge_creates_live_payq_order(monkeypatch):
    db = FakeDB()
    monkeypatch.setattr(payment_service, "get_db", lambda: db)
    monkeypatch.setattr(payq_service, "configured", lambda: True)

    created = {}

    async def create_order(**kwargs):
        created.update(kwargs)
        return {
            "order_id": kwargs["order_id"],
            "payment_url": "https://payq.cc/payment/instant-pay/test123",
        }

    monkeypatch.setattr(payq_service, "create_order", create_order)

    result = asyncio.run(
        payment_service.initiate_recharge(
            user={
                "user_id": "u1",
                "name": "Test User",
                "phone": "+918145344963",
                "email": "test@example.com",
            },
            amount=100,
        )
    )

    assert result["amount"] == 100.0
    assert result["credit_amount"] == 94.0
    assert result["commission"] == 6.0
    assert result["gateway_order_id"] == result["order_id"]
    assert created["amount"] == 100.0
    assert created["customer_mobile"] == "8145344963"
    assert "order_id=" in created["redirect_url"]
    stored = db.transactions.docs[0]
    assert stored["type"] == "RECHARGE_PENDING"
    assert stored["amount"] == 100.0
    assert stored["metadata"]["gateway_order_id"] == result["order_id"]
    assert stored["metadata"]["gateway"] == "payq"
    assert stored["metadata"]["payment_url"].startswith("https://payq.cc/")


def test_initiate_recharge_requires_mobile_number(monkeypatch):
    db = FakeDB()
    monkeypatch.setattr(payment_service, "get_db", lambda: db)
    monkeypatch.setattr(payq_service, "configured", lambda: True)

    async def create_order(**kwargs):
        raise AssertionError("gateway should not be called without a mobile number")

    monkeypatch.setattr(payq_service, "create_order", create_order)
    with pytest.raises(ValueError, match="mobile number"):
        asyncio.run(
            payment_service.initiate_recharge(
                user={"user_id": "u1", "name": "No Phone"}, amount=50
            )
        )
    assert db.transactions.docs == []


def test_initiate_recharge_rejects_below_minimum_before_gateway(monkeypatch):
    db = FakeDB()
    monkeypatch.setattr(payment_service, "get_db", lambda: db)
    monkeypatch.setattr(payq_service, "configured", lambda: True)

    async def create_order(**kwargs):
        raise AssertionError("gateway should not be called")

    monkeypatch.setattr(payq_service, "create_order", create_order)
    with pytest.raises(ValueError, match="Minimum recharge"):
        asyncio.run(
            payment_service.initiate_recharge(
                user={
                    "user_id": "u1",
                    "name": "Test",
                    "phone": "+918145344963",
                },
                amount=10,
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


def test_payq_pending_order_expires_after_grace(monkeypatch):
    tx = {
        "transaction_id": "tx_recharge_ord_expired",
        "user_id": "u1",
        "type": "RECHARGE_PENDING",
        "amount": 50.0,
        "created_at": datetime.now(timezone.utc) - timedelta(hours=3),
        "metadata": {
            "order_id": "ord_expired",
            "status": "PENDING",
            "gateway": "payq",
        },
    }
    db = FakeDB(transactions=[tx])
    monkeypatch.setattr(payment_service, "get_db", lambda: db)

    async def status(order_id):
        return {
            "status": "PENDING",
            "message": "Transaction is still pending",
            "result": {
                "orderId": "ord_expired",
                "status": "PENDING",
                "amount": "50.00",
            },
        }

    monkeypatch.setattr(payq_service, "get_order_status", status)

    result = asyncio.run(payment_service.verify_with_gateway("ord_expired"))

    assert result["status"] == "FAILED"
    stored = db.transactions.docs[0]
    assert stored["metadata"]["status"] == "FAILED"
    assert stored["metadata"]["failure_reason"] == "GATEWAY_TIMEOUT"


def test_late_success_for_expired_order_still_settles(monkeypatch):
    tx = {
        "transaction_id": "tx_recharge_ord_late",
        "user_id": "u1",
        "type": "RECHARGE_PENDING",
        "amount": 50.0,
        "created_at": datetime.now(timezone.utc) - timedelta(hours=3),
        "metadata": {
            "order_id": "ord_late",
            "status": "FAILED",
            "failure_reason": "GATEWAY_TIMEOUT",
            "gateway": "payq",
        },
    }
    db = FakeDB(transactions=[tx])
    monkeypatch.setattr(payment_service, "get_db", lambda: db)
    monkeypatch.setattr(payment_service, "get_redis", lambda: None)

    async def status(order_id):
        return {
            "status": "COMPLETED",
            "message": "Transaction completed successfully",
            "result": {
                "orderId": "ord_late",
                "status": "SUCCESS",
                "amount": "50.00",
                "utr": "utr_late",
            },
        }

    credits = []

    async def credit_once(user_id, amount, order_id):
        credits.append((user_id, amount, order_id))
        return True, {"balance": amount}

    async def noop(*args, **kwargs):
        return None

    async def get_wallet(user_id):
        return {"user_id": user_id, "balance": 47.0}

    from app.services import referral_service

    monkeypatch.setattr(payq_service, "get_order_status", status)
    monkeypatch.setattr(wallet_service, "credit_balance_once", credit_once)
    monkeypatch.setattr(wallet_service, "add_platform_balance_once", noop)
    monkeypatch.setattr(wallet_service, "record_platform_commission", noop)
    monkeypatch.setattr(wallet_service, "get_wallet", get_wallet)
    monkeypatch.setattr(payment_service, "emit_to_user", noop)
    monkeypatch.setattr(referral_service, "maybe_pay_first_recharge_bonus", noop)

    result = asyncio.run(payment_service.verify_with_gateway("ord_late"))

    assert result["status"] == "SUCCESS"
    assert credits == [("u1", 47.0, "ord_late")]
    stored = db.transactions.docs[0]
    assert stored["type"] == "RECHARGE"
    assert stored["metadata"]["status"] == "SUCCESS"
    assert stored["metadata"].get("failure_reason") is None


def test_process_order_success_credits_once_and_marks_platform_commission(monkeypatch):
    tx = {
        "transaction_id": "tx_recharge_ord_1",
        "user_id": "u1",
        "type": "RECHARGE_PENDING",
        "amount": 100.0,
        "metadata": {
            "order_id": "ord_1",
            "status": "PENDING",
            "gateway": "payq",
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
        "status": "COMPLETED",
        "result": {
            "orderId": "ord_1",
            "status": "SUCCESS",
            "txnStatus": "COMPLETED",
            "amount": "100.00",
            "utr": "utr_1",
        },
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
    assert stored["metadata"]["gateway_order_id"] == "ord_1"
    assert stored["metadata"]["gateway_transaction_id"] == "utr_1"


def test_webhook_verifies_status_and_credits_only_once(monkeypatch):
    tx = {
        "transaction_id": "tx_recharge_ord_3",
        "user_id": "u3",
        "type": "RECHARGE_PENDING",
        "amount": 50.0,
        "metadata": {
            "order_id": "ord_3",
            "status": "PENDING",
            "gateway": "payq",
        },
    }
    db = FakeDB(transactions=[tx])
    monkeypatch.setattr(payment_service, "get_db", lambda: db)
    monkeypatch.setattr(payment_service, "get_redis", lambda: None)

    async def status(order_id):
        assert order_id == "ord_3"
        return {
            "status": "COMPLETED",
            "message": "Transaction completed successfully",
            "result": {
                "orderId": "ord_3",
                "status": "SUCCESS",
                "txnStatus": "COMPLETED",
                "amount": "50.00",
                "utr": "utr_3",
            },
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

    monkeypatch.setattr(payq_service, "get_order_status", status)
    monkeypatch.setattr(wallet_service, "credit_balance_once", credit_once)
    monkeypatch.setattr(wallet_service, "add_platform_balance_once", noop)
    monkeypatch.setattr(wallet_service, "record_platform_commission", noop)
    monkeypatch.setattr(wallet_service, "get_wallet", get_wallet)
    monkeypatch.setattr(payment_service, "emit_to_user", noop)
    monkeypatch.setattr(referral_service, "maybe_pay_first_recharge_bonus", noop)

    body = {
        "order_id": "ord_3",
        "status": "SUCCESS",
        "amount": "50.00",
        "utr": "utr_3",
        "result[status]": "SUCCESS",
    }
    first = asyncio.run(payment_service.handle_webhook_payload(body))
    second = asyncio.run(payment_service.handle_webhook_payload(body))

    assert first["status"] == "SUCCESS"
    assert first["credited"] == 47.0
    assert second["status"] == "SUCCESS"
    assert credits == [("u3", 47.0, "ord_3")]
    stored = db.transactions.docs[0]
    assert stored["metadata"]["status"] == "SUCCESS"
    assert stored["metadata"]["gateway_transaction_id"] == "utr_3"


def test_webhook_success_status_is_not_trusted(monkeypatch):
    tx = {
        "transaction_id": "tx_recharge_ord_6",
        "user_id": "u6",
        "type": "RECHARGE_PENDING",
        "amount": 50.0,
        "created_at": datetime.now(timezone.utc),
        "metadata": {
            "order_id": "ord_6",
            "status": "PENDING",
            "gateway": "payq",
        },
    }
    db = FakeDB(transactions=[tx])
    monkeypatch.setattr(payment_service, "get_db", lambda: db)

    credits = []

    async def credit_once(*args, **kwargs):
        credits.append(args)
        return True, {"balance": 0}

    async def status(order_id):
        assert order_id == "ord_6"
        return {
            "status": "PENDING",
            "message": "Transaction is still pending",
            "result": {
                "orderId": "ord_6",
                "status": "PENDING",
                "amount": "50.00",
            },
        }

    monkeypatch.setattr(wallet_service, "credit_balance_once", credit_once)
    monkeypatch.setattr(payq_service, "get_order_status", status)

    result = asyncio.run(
        payment_service.handle_webhook_payload(
            {
                "order_id": "ord_6",
                "status": "SUCCESS",
                "amount": "50.00",
                "utr": "utr_6",
            }
        )
    )

    assert result["status"] == "PENDING"
    assert credits == []
    stored = db.transactions.docs[0]
    assert stored["metadata"]["status"] == "PENDING"
    assert stored["metadata"]["utr"] == "utr_6"


def test_status_check_failure_keeps_order_pending(monkeypatch):
    tx = {
        "transaction_id": "tx_recharge_ord_new",
        "user_id": "u1",
        "type": "RECHARGE_PENDING",
        "amount": 50.0,
        "created_at": datetime.now(timezone.utc),
        "metadata": {
            "order_id": "ord_new",
            "status": "PENDING",
            "gateway": "payq",
        },
    }
    db = FakeDB(transactions=[tx])
    monkeypatch.setattr(payment_service, "get_db", lambda: db)

    async def unavailable(order_id):
        raise RuntimeError("gateway timeout")

    monkeypatch.setattr(payq_service, "get_order_status", unavailable)

    result = asyncio.run(payment_service.verify_with_gateway("ord_new"))
    assert result["status"] == "PENDING"
    assert result["retryable"] is True
    stored = db.transactions.docs[0]
    assert stored["metadata"]["status"] == "PENDING"
    assert stored["metadata"]["gateway_status"] == "STATUS_CHECK_FAILED"


@pytest.mark.parametrize("gateway", ["kwikupi", "cashfree"])
def test_legacy_orders_are_not_polled_through_payq(monkeypatch, gateway):
    tx = {
        "transaction_id": "tx_recharge_ord_legacy",
        "user_id": "u1",
        "type": "RECHARGE_PENDING",
        "amount": 100.0,
        "metadata": {
            "order_id": "ord_legacy",
            "status": "PENDING",
            "gateway": gateway,
        },
    }
    db = FakeDB(transactions=[tx])
    monkeypatch.setattr(payment_service, "get_db", lambda: db)

    async def should_not_call(order_id):
        raise AssertionError("legacy orders must not call PayQ")

    monkeypatch.setattr(payq_service, "get_order_status", should_not_call)

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
            "status": "PENDING",
            "gateway": "payq",
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
                "status": "COMPLETED",
                "result": {
                    "orderId": "ord_2",
                    "status": "SUCCESS",
                    "amount": "99.00",
                },
            },
        )
    )

    assert result["status"] == "REVIEW"
    assert credits == []
    stored = db.transactions.docs[0]
    assert stored["metadata"]["status"] == "REVIEW"
    assert stored["metadata"]["review_reason"] == "AMOUNT_MISMATCH"
    assert stored["metadata"]["gateway_amount"] == 99.0


def test_process_order_success_rejects_wrong_gateway_order_id(monkeypatch):
    tx = {
        "transaction_id": "tx_recharge_ord_4",
        "user_id": "u1",
        "type": "RECHARGE_PENDING",
        "amount": 100.0,
        "metadata": {
            "order_id": "ord_4",
            "status": "PENDING",
            "gateway": "payq",
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
            "ord_4",
            verified_payment={
                "status": "COMPLETED",
                "result": {
                    "orderId": "ord_other",
                    "status": "SUCCESS",
                    "amount": "100.00",
                },
            },
        )
    )

    assert result["status"] == "REVIEW"
    assert result["reason"] == "ORDER_ID_MISMATCH"
    assert credits == []
    assert db.transactions.docs[0]["metadata"]["review_reason"] == "ORDER_ID_MISMATCH"


def test_verify_with_gateway_reviews_mismatched_status_order_id(monkeypatch):
    tx = {
        "transaction_id": "tx_recharge_ord_5",
        "user_id": "u1",
        "type": "RECHARGE_PENDING",
        "amount": 100.0,
        "metadata": {
            "order_id": "ord_5",
            "gateway_order_id": "ord_5",
            "status": "PENDING",
            "gateway": "payq",
        },
    }
    db = FakeDB(transactions=[tx])
    monkeypatch.setattr(payment_service, "get_db", lambda: db)

    async def status(order_id):
        return {
            "status": "COMPLETED",
            "result": {
                "orderId": "ord_someone_else",
                "status": "SUCCESS",
                "amount": "100.00",
                "utr": "utr_5",
            },
        }

    monkeypatch.setattr(payq_service, "get_order_status", status)

    result = asyncio.run(payment_service.verify_with_gateway("ord_5"))
    assert result["status"] == "REVIEW"
    stored = db.transactions.docs[0]
    assert stored["metadata"]["status"] == "REVIEW"
    assert stored["metadata"]["review_reason"] == "STATUS_ORDER_ID_MISMATCH"
    assert stored["metadata"]["gateway_order_id"] == "ord_5"
    assert stored["metadata"]["gateway_reported_order_id"] == "ord_someone_else"


def test_php_query_serialization_places_nested_block_at_parent_position():
    items = [
        ("a", "1"),
        ("result[x]", "2"),
        ("b", "~*"),
        ("result[y]", "3"),
        ("hash", "ignored"),
    ]
    data = payq_service._php_post_data(items)
    assert payq_service._php_build_query(data) == (
        "a=1&result%5Bx%5D=2&result%5By%5D=3&b=%7E%2A"
    )


def test_payq_create_order_sends_form_encoded_fields(monkeypatch):
    captured = {}

    class FakeResponse:
        status_code = 200
        is_error = False
        text = '{"status":true}'

        def json(self):
            return {
                "status": True,
                "message": "Order Created Successfully",
                "result": {
                    "orderId": "ord_test",
                    "payment_url": "https://payq.cc/payment/instant-pay/abc",
                },
            }

    class FakeClient:
        def __init__(self, timeout):
            captured["timeout"] = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, data=None, headers=None):
            captured["url"] = url
            captured["data"] = data
            captured["headers"] = headers
            return FakeResponse()

    class Settings:
        payq_base_url = "https://payq.cc/api"
        payq_user_token = "merchant-token"
        payq_webhook_secret = "webhook-secret"
        payq_return_url = ""

    monkeypatch.setattr(payq_service, "get_settings", lambda: Settings())
    monkeypatch.setattr(payq_service.httpx, "AsyncClient", FakeClient)

    result = asyncio.run(
        payq_service.create_order(
            order_id="ord_test",
            amount=50,
            customer_mobile="+91 81453 44963",
            redirect_url="https://api.example.com/api/wallet/recharge/return?order_id=ord_test",
            remark1="Simple Talk wallet recharge",
            remark2="user@example.com",
        )
    )

    assert result == {
        "order_id": "ord_test",
        "payment_url": "https://payq.cc/payment/instant-pay/abc",
    }
    assert captured["url"] == "https://payq.cc/api/create-order"
    assert captured["data"] == {
        "customer_mobile": "8145344963",
        "user_token": "merchant-token",
        "amount": "50.00",
        "order_id": "ord_test",
        "redirect_url": "https://api.example.com/api/wallet/recharge/return?order_id=ord_test",
        "remark1": "Simple Talk wallet recharge",
        "remark2": "user@example.com",
    }
    assert captured["headers"]["Content-Type"] == "application/x-www-form-urlencoded"


def test_payq_get_order_status_sends_form_fields(monkeypatch):
    captured = {}

    class FakeResponse:
        status_code = 200
        is_error = False
        text = '{"status":"PENDING"}'

        def json(self):
            return {
                "status": "PENDING",
                "message": "Transaction is still pending",
                "result": {
                    "orderId": "ord_test",
                    "status": "PENDING",
                    "amount": "50.00",
                },
            }

    class FakeClient:
        def __init__(self, timeout):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, data=None, headers=None):
            captured["url"] = url
            captured["data"] = data
            captured["headers"] = headers
            return FakeResponse()

    class Settings:
        payq_base_url = "https://payq.cc/api"
        payq_user_token = "merchant-token"
        payq_webhook_secret = "webhook-secret"
        payq_return_url = ""

    monkeypatch.setattr(payq_service, "get_settings", lambda: Settings())
    monkeypatch.setattr(payq_service.httpx, "AsyncClient", FakeClient)

    result = asyncio.run(payq_service.get_order_status("ord_test"))

    assert result["status"] == "PENDING"
    assert captured["url"] == "https://payq.cc/api/check-order-status"
    assert captured["data"] == {
        "user_token": "merchant-token",
        "order_id": "ord_test",
    }
    assert captured["headers"]["Content-Type"] == "application/x-www-form-urlencoded"


def test_payq_create_order_rejects_false_status(monkeypatch):
    class FakeResponse:
        status_code = 200
        is_error = False
        text = '{"status":false}'

        def json(self):
            return {"status": False, "message": "Invalid Amount"}

    class FakeClient:
        def __init__(self, timeout):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, *args, **kwargs):
            return FakeResponse()

    class Settings:
        payq_base_url = "https://payq.cc/api"
        payq_user_token = "merchant-token"
        payq_webhook_secret = "webhook-secret"
        payq_return_url = ""

    monkeypatch.setattr(payq_service, "get_settings", lambda: Settings())
    monkeypatch.setattr(payq_service.httpx, "AsyncClient", FakeClient)

    with pytest.raises(payq_service.PayQError, match="Invalid Amount"):
        asyncio.run(
            payq_service.create_order(
                order_id="ord_test",
                amount=50,
                customer_mobile="8145344963",
                redirect_url="https://api.example.com/return",
            )
        )
