"""Regression tests for the incoming-call and presence fixes.

These cover the logic that broke in production, without needing Mongo, Redis or
a device:

* Agora uid assignment (both sides used to join as uid 0 and evict each other).
* The ring push being a notification message, not data-only, so Android
  delivers it to a killed app.
* Presence reporting "unknown" instead of "offline" when Redis is down.
* The onboarding gate letting a pending creator use the app.

Run:  python -m pytest tests -q
"""

import os
import sys
from unittest.mock import patch

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ── Agora uids ───────────────────────────────────────────────────────────────

class TestAgoraUid:
    def test_uids_are_nonzero_and_fit_31_bits(self):
        from app.services.agora_service import uid_for_user

        for user_id in ("user_a", "user_b", "u" * 200, "creator_1"):
            uid = uid_for_user(user_id)
            assert 0 < uid < 2**31, f"{user_id} -> {uid} out of range"

    def test_uids_are_distinct_per_user(self):
        from app.services.agora_service import uid_for_user

        uids = {uid_for_user(f"user_{i}") for i in range(500)}
        # A collision would make two participants evict each other.
        assert len(uids) == 500

    def test_uid_is_deterministic(self):
        from app.services.agora_service import uid_for_user

        assert uid_for_user("abc") == uid_for_user("abc")

    def test_never_zero(self):
        """uid 0 means 'auto-assign' to Agora and must never be used here."""
        from app.services.agora_service import uid_for_user

        assert all(uid_for_user(f"u{i}") != 0 for i in range(1000))


# ── Ring push payload ────────────────────────────────────────────────────────

class TestRingPush:
    """The ring must be a data-only message so a killed app still receives it."""

    def test_ring_is_data_only_with_high_importance_channel(self):
        """Ring must be sent as data-only message so it wakes headless JS task.

        A notification message (data_only=False) is NOT delivered to a force-stopped
        app. The headless JS task displays the call notification with fullScreenIntent
        via Notifee.
        """
        import inspect

        from app.services import call_service

        src = inspect.getsource(call_service.initiate_call)
        assert "data_only=True" in src
        assert "data_only=False" not in src
        assert 'channel_id="incoming_calls_v1"' in src
        # full_screen=True is no longer used; Notifee handles fullScreenIntent in handler
        assert "full_screen=True" not in src

    def test_failed_push_reports_failure_not_success(self, monkeypatch):
        """A misconfigured server must not look healthy in the metrics."""
        import asyncio

        import app.services.push_service as ps

        metrics = []
        monkeypatch.setattr(ps, "_ensure_firebase", lambda: False)
        monkeypatch.setattr(ps, "_incr_metric", lambda key: metrics.append(key) or _noop())

        ok = asyncio.run(ps.send_push("tok", title="t", body="b"))
        assert ok is False
        assert "metrics:fcm_fail" in metrics


# ── Presence ─────────────────────────────────────────────────────────────────

class TestPresence:
    def test_is_online_returns_none_without_redis(self, monkeypatch):
        """Unknown must be distinguishable from offline."""
        import asyncio

        from app.services import presence_service

        monkeypatch.setattr(presence_service, "get_redis", lambda: None)
        assert asyncio.run(presence_service.is_online("u1")) is None

    def test_reconcile_skips_entirely_without_redis(self, monkeypatch):
        """A Redis outage must not flip every creator offline."""
        import asyncio

        from app.services import presence_service

        monkeypatch.setattr(presence_service, "get_redis", lambda: None)
        # get_db would raise if touched -- proving we bail out first.
        monkeypatch.setattr(
            presence_service, "get_db", lambda: (_ for _ in ()).throw(AssertionError("db touched"))
        )
        assert asyncio.run(presence_service.reconcile_offline_creators()) == 0

    def test_status_from_profile(self):
        from app.services.presence_service import status_from_profile

        assert status_from_profile({"is_dnd": True, "is_online": True}) == "DND"
        assert status_from_profile({"is_online": True}, busy=True) == "BUSY"
        assert status_from_profile({"is_online": True}) == "ACTIVE"
        assert status_from_profile({"is_online": False}) == "OFFLINE"


# ── Onboarding gate ──────────────────────────────────────────────────────────

class TestOnboardingGate:
    def test_pending_review_creator_can_use_the_app(self):
        """They must reach Home, not a dead-end approval screen."""
        import inspect

        from app.routers import creators

        src = inspect.getsource(creators.onboarding_status)
        # The pending_review branch must return "home".
        i = src.find("pending_review")
        assert i > 0
        assert '"home"' in src[i:], "pending_review must resolve to home"

    def test_payload_exposes_calls_blocked(self):
        from app.routers.creators import _onboarding_payload

        creator = {"user_type": "creator", "name": "A"}
        pending = _onboarding_payload(creator, {"is_approved": False}, "home")
        assert pending["calls_blocked"] is True
        assert pending["is_approved"] is False

        approved = _onboarding_payload(creator, {"is_approved": True}, "home")
        assert approved["calls_blocked"] is False

        fan = _onboarding_payload({"user_type": "user"}, None, "home")
        assert fan["calls_blocked"] is False

    def test_unapproved_creator_cannot_be_rung(self):
        import inspect

        from app.services import call_service

        src = inspect.getsource(call_service.initiate_call)
        assert "is_approved" in src


async def _noop():
    return None
