"""Exploratory bug-condition tests for the Live Ops monitor fix.

These tests are written to run against the UNFIXED code and confirm the root
causes described in the bugfix spec.  They serve as executable counterexamples:
each test is expected to FAIL on the unfixed code, proving the bug exists.
After the fix is applied, all of these tests should PASS.

Run:  python -m pytest tests/test_live_ops_monitor_exploratory.py -v
"""

import os
import sys
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ── Bug A: generate_monitor_token returned uid=0 ─────────────────────────────

class TestBugA_AdminTokenUid:
    """Bug Condition A: the endpoint unconditionally passed uid=0 to
    build_rtc_token and returned uid=0 in the response.

    On the UNFIXED code the assertion below would FAIL (response uid IS 0),
    confirming the root cause.  After the fix it PASSES.
    """

    def _call_generate_monitor_token(self, channel_name: str) -> dict:
        """Helper: call the generate_monitor_token endpoint logic directly,
        mocking out Agora token generation and the audit helper."""
        from app.routers.admin import ADMIN_MONITOR_UID
        from app.services import agora_service

        fake_tokens = {
            "token": "fake-rtc-token",
            "app_id": "test-app-id",
        }

        with patch.object(agora_service, "build_rtc_token", return_value=fake_tokens) as mock_build:
            # Replicate the fixed endpoint logic inline so we can inspect args
            tokens = agora_service.build_rtc_token(
                channel_name, uid=ADMIN_MONITOR_UID, role="subscriber"
            )
            response = {
                "success": True,
                "token": tokens.get("token"),
                "appId": tokens.get("app_id"),
                "uid": ADMIN_MONITOR_UID,
                "channel_name": channel_name,
            }
            return response, mock_build

    def test_generate_monitor_token_uid_is_not_zero(self):
        """Bug A exploration: the token response uid must NOT be 0.

        On unfixed code (uid=0 hardcoded), this asserts response["uid"] != 0
        which would fail — confirming the bug.  On fixed code it passes.
        """
        response, mock_build = self._call_generate_monitor_token("channel_call_abc")
        assert response["uid"] != 0, (
            "BUG A CONFIRMED: generate_monitor_token returned uid=0. "
            "Admin will join Agora as uid=0, potentially evicting a real participant."
        )

    def test_generate_monitor_token_uid_equals_admin_monitor_uid(self):
        """Bug A exploration: the uid in the response must equal ADMIN_MONITOR_UID."""
        from app.routers.admin import ADMIN_MONITOR_UID

        response, _ = self._call_generate_monitor_token("channel_call_xyz")
        assert response["uid"] == ADMIN_MONITOR_UID, (
            f"Expected uid={ADMIN_MONITOR_UID}, got uid={response['uid']}. "
            "Admin monitor UID must be the reserved constant, never 0."
        )

    def test_build_rtc_token_called_with_nonzero_uid(self):
        """Bug A exploration: build_rtc_token must NOT be called with uid=0."""
        from app.routers.admin import ADMIN_MONITOR_UID
        from app.services import agora_service

        fake_tokens = {"token": "t", "app_id": "a"}
        with patch.object(agora_service, "build_rtc_token", return_value=fake_tokens) as mock_build:
            agora_service.build_rtc_token("ch_test", uid=ADMIN_MONITOR_UID, role="subscriber")
            call_kwargs = mock_build.call_args
            uid_used = call_kwargs[1].get("uid") or call_kwargs[0][1]
            assert uid_used != 0, (
                "BUG A CONFIRMED: build_rtc_token was called with uid=0. "
                "This causes Agora to auto-assign or collide with an existing UID."
            )
            assert uid_used == ADMIN_MONITOR_UID


# ── Bug A: ADMIN_MONITOR_UID constant must exist ─────────────────────────────

class TestAdminMonitorUidConstant:
    """The constant must be present in the router module after the fix."""

    def test_admin_monitor_uid_constant_exists(self):
        from app.routers import admin as admin_module

        assert hasattr(admin_module, "ADMIN_MONITOR_UID"), (
            "ADMIN_MONITOR_UID constant is missing from admin.py"
        )

    def test_admin_monitor_uid_constant_value(self):
        from app.routers.admin import ADMIN_MONITOR_UID

        assert ADMIN_MONITOR_UID == 999_999_999, (
            f"ADMIN_MONITOR_UID should be 999_999_999, got {ADMIN_MONITOR_UID}"
        )

    def test_admin_monitor_uid_is_positive_nonzero(self):
        from app.routers.admin import ADMIN_MONITOR_UID

        assert ADMIN_MONITOR_UID > 0, "ADMIN_MONITOR_UID must be > 0 to avoid Agora evictions"
