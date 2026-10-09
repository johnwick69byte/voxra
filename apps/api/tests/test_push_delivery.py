"""Regression tests for push notification delivery.

Covers the bugs behind "no push for creator online / account approved":

* Foreground FCM `notification` messages are NOT auto-displayed by Android, so
  a non-call push produced nothing while the app was open.
* Tapping a notification did nothing for non-call types.
* A token registered while notifications were denied is undeliverable, and the
  server logged nothing when a user had no token at all.

Run:  python -m pytest tests -q
"""

import os
import pathlib
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

MOBILE = pathlib.Path(__file__).resolve().parents[2] / "mobile"


def read(rel: str) -> str:
    return (MOBILE / rel).read_text(encoding="utf-8")


# ── Foreground display ───────────────────────────────────────────────────────

class TestForegroundPush:
    def test_on_message_displays_general_notifications(self):
        """onMessage must draw non-call pushes; Android will not."""
        src = read("index.js")
        m = re.search(r"messaging\(\)\.onMessage\(async \(remoteMessage\) => \{(.*?)\n    \}\);", src, re.S)
        assert m, "onMessage handler not found"
        body = m.group(1)
        assert "displayGeneralNotification" in body, (
            "foreground pushes other than calls must be displayed explicitly"
        )

    def test_general_notification_helper_exists_and_skips_calls(self):
        src = read("src/services/inAppNotifications.ts")
        assert "export async function displayGeneralNotification" in src
        assert 'data?.type === "incoming_call"' in src, (
            "call notifications are owned by IncomingCallService and must not be drawn twice"
        )

    def test_uses_small_icon_and_default_channel(self):
        src = read("src/services/inAppNotifications.ts")
        assert "ic_notification" in src
        assert "app_notifications" in src


# ── Taps route somewhere ─────────────────────────────────────────────────────

class TestNotificationTaps:
    def test_background_tap_handled_for_non_call(self):
        src = read("index.js")
        assert "onNotificationOpenedApp(async (remoteMessage)" in src
        assert "routeGeneralNotification" in src

    def test_cold_start_tap_handled_for_non_call(self):
        src = read("index.js")
        m = re.search(r"getInitialNotification\(\)(.*?)\n      \.catch", src, re.S)
        assert m and "routeGeneralNotification" in m.group(1), (
            "a tap that cold-starts the app must route non-call notifications"
        )

    def test_navigation_is_buffered_until_router_mounts(self):
        src = read("src/services/navigationQueue.ts")
        assert "pending" in src and "subscribeNavigation" in src

    def test_layout_subscribes_to_navigation_queue(self):
        src = read("app/_layout.tsx")
        assert "subscribeNavigation" in src, (
            "without a subscriber a buffered tap never navigates"
        )


# ── Token registration ordering ──────────────────────────────────────────────

class TestPushToken:
    def test_permission_requested_before_token(self):
        """A token obtained while denied can never deliver anything."""
        src = read("src/services/pushRegistration.ts")
        perm = src.find("ensureNotificationPermission")
        gettok = src.find("getToken")
        assert perm != -1 and gettok != -1
        assert perm < gettok, "permission must be requested before getToken()"

    def test_skips_registration_when_permission_refused(self):
        src = read("src/services/pushRegistration.ts")
        assert "granted" in src and "skipping token registration" in src

    def test_token_refresh_is_uploaded(self):
        """FCM rotates tokens; a stale server token silently stops delivery."""
        src = read("src/services/pushRegistration.ts")
        assert "onTokenRefresh" in src

    def test_layout_awaits_permissions_before_registering(self):
        src = read("app/_layout.tsx")
        m = re.search(
            r"await ensureAllPermissions\(\);\s*\n\s*await registerDevicePushToken\(\)", src
        )
        assert m, "root layout must await permissions before registering the token"


# ── Server-side observability ────────────────────────────────────────────────

class TestServerPushLogging:
    def test_follower_notify_counts_missing_tokens(self):
        """sent=0 with no explanation made a missing token look like a broken feature."""
        from app.services import follower_notify_service

        src = pathlib.Path(follower_notify_service.__file__).read_text(encoding="utf-8")
        assert "no_token" in src
        assert "no followers" in src

    def test_admin_notify_warns_when_token_absent(self):
        from app.routers import admin

        src = pathlib.Path(admin.__file__).read_text(encoding="utf-8")
        assert "no push token registered" in src
        assert "push failed for user" in src

    def test_creator_online_still_uses_app_notifications_channel(self):
        from app.services import follower_notify_service

        src = pathlib.Path(follower_notify_service.__file__).read_text(encoding="utf-8")
        assert 'channel_id="app_notifications"' in src


# ── Signup must not ask for a photo ──────────────────────────────────────────

class TestSignupPhotoRemoved:
    def test_no_avatar_picker_in_complete_profile(self):
        src = read("app/(auth)/complete-profile.tsx")
        assert "launchImageLibraryAsync" not in src, (
            "signup must not ask for a profile photo"
        )
        assert "pickAvatar" not in src
        assert "Add photo" not in src

    def test_still_has_role_selection(self):
        src = read("app/(auth)/complete-profile.tsx")
        assert "setUserType" in src, "Fan/Creator selection must remain"


# ── Incoming call when app is closed ─────────────────────────────────────────

class TestKilledAppCall:
    def test_ring_is_data_only_with_fullscreen_intent(self):
        """Ring must be a data-only message; Notifee handles fullScreenIntent."""
        import inspect

        from app.services import call_service

        src = inspect.getsource(call_service.initiate_call)
        assert "data_only=True" in src
        assert "data_only=False" not in src
        # full_screen=True is no longer used; Notifee handles fullScreenIntent
        assert "full_screen=True" not in src

    def test_background_handler_persists_pending_call(self):
        """The headless task is a separate JS context; state must be persisted."""
        src = read("index.js")
        m = re.search(r"setBackgroundMessageHandler\(async \(remoteMessage\) => \{(.*?)\n    \}\);", src, re.S)
        assert m
        assert "savePendingCall" in m.group(1), (
            "pending call must survive the headless context boundary"
        )
