"""Regression tests for the second round of production bugs.

Each test pins a specific failure that actually shipped:

* socket.io rejecting every WebSocket with 403 (the ["*"] vs "*" CORS trap)
* Agora token minting raising ImportError -> 500 on /calls/{id}/accept
* accept_call leaving the row ACCEPTED when token minting failed -> stuck BUSY
* a stale call row keeping a creator BUSY forever

Run:  python -m pytest tests -q
"""

import inspect
import os
import sys
from unittest.mock import patch

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ── socket.io CORS ───────────────────────────────────────────────────────────

class TestSocketCors:
    """engine.io only treats the bare string "*" as "allow all".

    Passing ["*"] is matched by exact membership, so every real Origin is
    rejected and the WebSocket upgrade returns 403. That silently broke
    presence, live signalling and call status.
    """

    def test_wildcard_resolves_to_string_not_list(self):
        from app.core.config import Settings

        s = Settings(socketio_cors_origins="*")
        assert s.socketio_cors_list == "*", (
            'SOCKETIO_CORS_ORIGINS="*" must yield the string "*"; a list '
            "rejects every Origin in engine.io"
        )

    def test_real_origins_are_preserved_as_list(self):
        from app.core.config import Settings

        s = Settings(socketio_cors_origins="https://a.com, https://b.com")
        assert s.socketio_cors_list == ["https://a.com", "https://b.com"]

    def test_engineio_accepts_a_real_origin(self):
        """Drive engine.io's own logic to prove the wildcard works."""
        from app.core.config import Settings
        import socketio

        allowed = Settings(socketio_cors_origins="*").socketio_cors_list
        srv = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins=allowed)
        value = srv.eio.cors_allowed_origins

        # Mirrors engineio.base_server._cors_headers
        origin = "http://localhost"
        if value is None or value == "*":
            accepted = True
        else:
            accepted = origin in value
        assert accepted, f"origin {origin} rejected (cors_allowed_origins={value!r})"

    def test_server_is_built_with_the_wildcard_string(self):
        from app.core.socket import sio

        v = sio.eio.cors_allowed_origins
        assert v == "*" or v is None, f"expected wildcard, got {v!r}"


# ── Agora token minting ──────────────────────────────────────────────────────

class TestAgoraToken:
    def test_builder_exports_no_role_constants(self):
        """Guard the assumption that broke production.

        If a future version starts exporting Role_Publisher we may switch back,
        but this documents why we use plain integers.
        """
        import agora_token_builder as pkg

        assert not hasattr(pkg, "Role_Publisher")
        assert not hasattr(pkg, "Role_Subscriber")

    def test_roles_are_plain_integers(self):
        from app.services import agora_service

        assert agora_service.ROLE_PUBLISHER == 1
        assert agora_service.ROLE_SUBSCRIBER == 2

    def test_token_mints_without_importerror(self):
        """The exact call that raised ImportError and 500'd the accept endpoint."""
        from app.services import agora_service

        class S:
            agora_app_id = "a" * 32
            agora_app_certificate = "b" * 32

        with patch.object(agora_service, "get_settings", lambda: S()):
            out = agora_service.build_rtc_token("chan", uid=12345)
        assert out["token"], "no token produced"
        assert out["uid"] == 12345
        assert out["app_id"] == "a" * 32

    def test_missing_certificate_fails_loudly(self):
        """A missing cert must be a clear 500, not a client-side join failure."""
        from fastapi import HTTPException

        from app.services import agora_service

        class S:
            agora_app_id = "a" * 32
            agora_app_certificate = ""

        with patch.object(agora_service, "get_settings", lambda: S()):
            with pytest.raises(HTTPException) as ei:
                agora_service.build_rtc_token("chan", uid=1)
        assert ei.value.status_code == 500

    def test_distinct_uids_produce_distinct_tokens(self):
        from app.services import agora_service

        class S:
            agora_app_id = "a" * 32
            agora_app_certificate = "b" * 32

        with patch.object(agora_service, "get_settings", lambda: S()):
            t1 = agora_service.build_rtc_token("chan", uid=1)["token"]
            t2 = agora_service.build_rtc_token("chan", uid=2)["token"]
        assert t1 != t2


# ── accept_call must not poison the call state ───────────────────────────────

class TestAcceptCallSafety:
    def test_tokens_are_minted_before_status_change(self):
        """A failure while minting must leave the call RINGING, not ACCEPTED.

        Previously the row was set to ACCEPTED first; when token minting 500'd,
        the row stayed ACCEPTED and the creator read as BUSY indefinitely.
        """
        from app.services import call_service

        src = inspect.getsource(call_service.accept_call)
        mint = src.find("build_rtc_token")
        flip = src.find('"status": "ACCEPTED"')
        assert mint != -1 and flip != -1
        assert mint < flip, (
            "build_rtc_token must run before the status flips to ACCEPTED"
        )

    def test_accept_call_wraps_mint_in_try(self):
        from app.services import call_service

        src = inspect.getsource(call_service.accept_call)
        assert "except Exception" in src
        assert "HTTPException(500" in src


# ── stale calls must not hold BUSY ───────────────────────────────────────────

class TestBusySelfHeal:
    def test_get_creator_status_uses_time_bounded_check(self):
        from app.services import presence_service

        src = inspect.getsource(presence_service.get_creator_status)
        assert "_has_live_call" in src, (
            "get_creator_status must use the self-healing check, not a raw "
            "status query that counts stale rows as BUSY"
        )

    def test_self_heal_finalises_stale_rows(self):
        from app.services import presence_service

        src = inspect.getsource(presence_service._has_live_call)
        assert "miss_call" in src and "finalize_call" in src

    def test_sweeper_clears_stale_accepted_quickly(self):
        """Two minutes, not the previous three hours."""
        from app.services import call_service

        src = inspect.getsource(call_service.sweep_stuck_calls)
        assert "ACCEPTED" in src
        assert "minutes=2" in src, "stale ACCEPTED rows must clear within minutes"
        assert "hours=3" not in src.split("ancient")[0], (
            "the 3-hour window must not be the only recovery path"
        )

    def test_sweeper_checks_live_billing_heartbeat(self):
        from app.services import call_service

        src = inspect.getsource(call_service.sweep_stuck_calls)
        assert "call_billing_key" in src
