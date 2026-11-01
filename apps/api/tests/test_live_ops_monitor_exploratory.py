"""Regression tests for admin live-call monitoring.

The original bug was two-fold:

1. The token endpoint joined every spectator as uid 0, which Agora treats as
   "auto-assign" and can evict a real call participant.
2. The first fix switched everyone to one fixed uid (999999999), which made a
   second admin viewer evict the first viewer.

Every monitor session must therefore get its own nonzero uid. These tests call
the real endpoint logic with Agora token minting mocked out.

Run:  python -m pytest tests/test_live_ops_monitor_exploratory.py -v
"""

import asyncio
import os
import sys
from unittest.mock import AsyncMock, patch

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def call_generate_monitor_token(channel_name: str = "channel_call_abc"):
    """Call the endpoint function directly with a fake admin."""
    from app.routers import admin as admin_module
    from app.services import agora_service

    fake_tokens = {"token": "fake-rtc-token", "app_id": "test-app-id"}

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


class TestAdminMonitorToken:
    def test_uid_is_nonzero(self):
        response, _ = call_generate_monitor_token()
        assert response["uid"] != 0, (
            "A monitor must never join as uid 0; Agora treats it as auto-assign "
            "and can evict a call participant."
        )

    def test_uid_fits_agora_31_bit_range(self):
        response, _ = call_generate_monitor_token()
        assert 0 < response["uid"] < 2**31

    def test_each_monitor_session_gets_a_unique_uid(self):
        """Two devices watching the same call must not share a uid."""
        uids = {call_generate_monitor_token("same_channel")[0]["uid"] for _ in range(25)}
        assert len(uids) == 25, (
            "Two monitor sessions received the same uid. The second viewer will "
            "evict the first one from the Agora channel."
        )

    def test_token_is_minted_for_the_returned_uid(self):
        response, mock_build = call_generate_monitor_token("channel_call_xyz")
        args, kwargs = mock_build.call_args
        uid_passed = kwargs.get("uid", args[1] if len(args) > 1 else None)
        assert uid_passed == response["uid"]
        assert uid_passed != 0

    def test_token_is_minted_with_subscriber_role(self):
        _, mock_build = call_generate_monitor_token()
        args, kwargs = mock_build.call_args
        role_passed = kwargs.get("role", args[2] if len(args) > 2 else None)
        assert role_passed == "subscriber"

    def test_response_marks_the_session_as_subscriber(self):
        response, _ = call_generate_monitor_token()
        assert response["role"] == "subscriber"
        assert response["success"] is True
        assert response["channel_name"] == "channel_call_abc"

    def test_missing_channel_name_is_rejected(self):
        from fastapi import HTTPException
        from app.routers import admin as admin_module

        with pytest.raises(HTTPException) as exc:
            asyncio.run(
                admin_module.generate_monitor_token({}, {"user_id": "admin_1"})
            )
        assert exc.value.status_code == 400
