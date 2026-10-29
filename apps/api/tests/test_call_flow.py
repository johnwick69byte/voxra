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
    """The ring must be a notification message, not data-only.

    Data-only messages are only delivered to an already-alive JS process. A
    killed/swiped app may never run the headless task, so an offline creator
    with working internet received no notification at all. A notification
    message is drawn by the OS and uses the custom incoming-calls channel.
    """

    def test_ring_is_notification_message_with_custom_sound(self):
        import inspect

        from app.services import call_service

        src = inspect.getsource(call_service.initiate_call)
        assert "data_only=False" in src
        assert "data_only=True" not in src
        assert 'channel_id="incoming_calls_v2"' in src
        assert 'sound="sound_effect"' in src
        # Uses send_to_user so a dead token is purged instead of retried forever.
        assert "send_to_user" in src

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

class TestSingleIncomingScreen:
    """One call must produce one incoming screen, whichever path delivered it."""

    def test_layout_has_one_incoming_route_gate(self):
        import pathlib

        mobile = pathlib.Path(__file__).resolve().parents[2] / "mobile"
        src = (mobile / "app" / "_layout.tsx").read_text(encoding="utf-8")
        assert src.count('pathname: "/incoming-call"') == 1, (
            "socket/push/pending/active paths must all use openIncoming()"
        )
        assert "if (store.incomingOpen) return;" in src
        assert "callsAPI.active({" in src

    def test_incoming_screen_removes_duplicate_routes(self):
        import pathlib

        mobile = pathlib.Path(__file__).resolve().parents[2] / "mobile"
        src = (mobile / "app" / "incoming-call.tsx").read_text(encoding="utf-8")
        assert "visibleIncomingCallId" in src
        assert "navigation.isFocused()" in src
        assert "activeCallId !== callId" in src, (
            "a stale lower screen must not pop the live call screen"
        )

    def test_call_screen_owns_one_agora_join_per_call(self):
        import pathlib

        mobile = pathlib.Path(__file__).resolve().parents[2] / "mobile"
        src = (mobile / "app" / "call-screen.tsx").read_text(encoding="utf-8")
        assert "mountedCallScreenId" in src
        assert "lastHandledCallIdRef.current === callId" in src


class TestAcceptRetry:
    def test_accept_is_idempotent_for_already_accepted_calls(self):
        """A duplicate Accept returns join credentials instead of 409."""
        import inspect

        from app.services import call_service

        src = inspect.getsource(call_service.accept_call)
        assert '("RINGING", "ACCEPTED", "LIVE")' in src
        assert "already_accepted" in src
        assert "Call already handled" in src  # still used for terminal states


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
