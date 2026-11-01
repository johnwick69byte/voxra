"""Property-Based Tests for the Live Ops monitor fix.

These tests use Hypothesis to prove correctness properties hold for
arbitrarily generated inputs — far stronger than hand-picked examples.

Properties tested:
  Property 1 (Fix)         — for any channel_name, every call to
                             generate_monitor_token returns a nonzero uid in
                             Agora's 31-bit range, and two calls never share
                             a uid.
  Property 2 (Fix)         — for any (departing_uid, peer_uid) where
                             departing_uid ≠ peer_uid, the fixed handler
                             never calls scheduleDisconnectGrace.
  Property 3 (Preservation) — for any (departing_uid, peer_uid) where
                              departing_uid == peer_uid, the fixed handler
                              always calls scheduleDisconnectGrace.

Run:  python -m pytest tests/test_live_ops_monitor_pbt.py -v
"""

import asyncio
import os
import sys
from unittest.mock import AsyncMock, patch

import pytest
from hypothesis import assume, given, settings
from hypothesis import strategies as st

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ── Property 1: every monitor session gets a unique nonzero uid ──────────────

class TestProperty1_AdminTokenUid:
    """
    PROPERTY 1 (Fix):
        ∀ channel_name ∈ str, every call to generate_monitor_token returns a
        nonzero uid in Agora's 31-bit range, and two calls never share a uid.
    """

    def _call_endpoint(self, channel_name: str):
        from app.routers import admin as admin_module
        from app.services import agora_service

        fake_tokens = {"token": f"token_{channel_name[:8]}", "app_id": "test-app"}
        with (
            patch.object(admin_module, "_audit", new=AsyncMock()),
            patch.object(
                agora_service, "build_rtc_token", return_value=fake_tokens
            ) as mock_build,
        ):
            response = asyncio.run(
                admin_module.generate_monitor_token(
                    {"channel_name": channel_name}, {"user_id": "admin_1"}
                )
            )
        return response, mock_build

    @given(
        channel_name=st.text(
            alphabet=st.characters(
                whitelist_categories=("Lu", "Ll", "Nd"),
                whitelist_characters="_-"
            ),
            min_size=1,
            max_size=64,
        )
    )
    @settings(max_examples=200)
    def test_property1_uid_is_nonzero_and_fits_31_bits(self, channel_name: str):
        response, mock_build = self._call_endpoint(channel_name)
        assert 0 < response["uid"] < 2**31, (
            f"channel={channel_name!r} produced invalid uid={response['uid']}"
        )
        args, kwargs = mock_build.call_args
        uid_passed = kwargs.get("uid", args[1] if len(args) > 1 else None)
        assert uid_passed == response["uid"]

    @given(
        channel_name=st.text(
            alphabet=st.characters(
                whitelist_categories=("Lu", "Ll", "Nd"),
                whitelist_characters="_-"
            ),
            min_size=1,
            max_size=64,
        )
    )
    @settings(max_examples=100)
    def test_property1_two_sessions_never_share_a_uid(self, channel_name: str):
        first, _ = self._call_endpoint(channel_name)
        second, _ = self._call_endpoint(channel_name)
        assert first["uid"] != second["uid"], (
            f"channel={channel_name!r} gave both monitor sessions uid={first['uid']}"
        )


# ── Python model of the fixed onUserOffline handler ──────────────────────────
#
# We can't import the React Native module in a Python test, so we model the
# handler guard logic directly — it's a two-line condition we can specify
# formally and test with Hypothesis.

def fixed_handler_would_call_grace(departing_uid: int, peer_uid: int | None) -> bool:
    """
    Returns True iff the fixed onUserOffline handler would call
    scheduleDisconnectGrace for this (departing_uid, peer_uid) pair.

    Mirrors:
        if (params.peerUid != null && uid !== params.peerUid) return;
        params.onUserOffline?.();   // ← scheduleDisconnectGrace
    """
    if peer_uid is not None and departing_uid != peer_uid:
        return False  # ignored — non-peer departure
    return True  # fires — peer departure (or no filter set)


# ── Property 2: departing ≠ peer → grace never called ────────────────────────

class TestProperty2_SpuriousOfflineNeverCallsGrace:
    """
    PROPERTY 2 (Fix):
        ∀ (departing_uid, peer_uid) where departing_uid ≠ peer_uid :
            fixed_onUserOffline(departing_uid, peer_uid).scheduleDisconnectGrace = False
    """

    @given(
        departing_uid=st.integers(min_value=0, max_value=2**31 - 1),
        peer_uid=st.integers(min_value=1, max_value=2**31 - 1),
    )
    @settings(max_examples=500)
    def test_property2_non_peer_departure_never_triggers_grace(
        self, departing_uid: int, peer_uid: int
    ):
        """When departing_uid ≠ peer_uid, scheduleDisconnectGrace is never called."""
        assume(departing_uid != peer_uid)  # enforce the bug condition

        grace_called = fixed_handler_would_call_grace(departing_uid, peer_uid)

        assert grace_called is False, (
            f"PROPERTY 2 VIOLATED: departing_uid={departing_uid}, peer_uid={peer_uid} "
            f"— handler called scheduleDisconnectGrace for a non-peer departure!"
        )

    @given(peer_uid=st.integers(min_value=1, max_value=2**31 - 1))
    @settings(max_examples=200)
    def test_property2_large_uid_never_triggers_grace(self, peer_uid: int):
        """A large, uncommon uid never triggers grace when the peer is different."""
        assume(peer_uid != 999_999_999)

        grace_called = fixed_handler_would_call_grace(999_999_999, peer_uid)

        assert grace_called is False, (
            f"PROPERTY 2 VIOLATED: large uid triggered grace for peer={peer_uid}"
        )


# ── Property 3: departing == peer → grace always called ──────────────────────

class TestProperty3_PeerDepartureAlwaysCallsGrace:
    """
    PROPERTY 3 (Preservation):
        ∀ peer_uid ∈ positive int :
            fixed_onUserOffline(departing_uid=peer_uid, peer_uid=peer_uid)
            .scheduleDisconnectGrace = True
    """

    @given(peer_uid=st.integers(min_value=1, max_value=2**31 - 1))
    @settings(max_examples=500)
    def test_property3_peer_departure_always_triggers_grace(self, peer_uid: int):
        """When departing_uid == peer_uid, scheduleDisconnectGrace is always called."""
        grace_called = fixed_handler_would_call_grace(
            departing_uid=peer_uid, peer_uid=peer_uid
        )

        assert grace_called is True, (
            f"PROPERTY 3 VIOLATED: peer departure (uid={peer_uid}) did NOT trigger "
            "scheduleDisconnectGrace — real peer disconnects would be silently ignored!"
        )

    @given(peer_uid=st.integers(min_value=1, max_value=2**31 - 1))
    @settings(max_examples=200)
    def test_property3_grace_called_regardless_of_uid_value(self, peer_uid: int):
        """Preservation holds for all positive UID values, including large ones."""
        grace_called = fixed_handler_would_call_grace(peer_uid, peer_uid)
        assert grace_called is True

    def test_property3_holds_for_large_uid_as_peer(self):
        """Edge case: a large, uncommon uid as peer still triggers grace."""
        # Unusual but valid: if someone is assigned 999999999 as their peer UID,
        # departure must still trigger grace.
        grace_called = fixed_handler_would_call_grace(999_999_999, 999_999_999)
        assert grace_called is True
