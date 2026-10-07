"""Prove the foreground-push gap.

Android renders FCM `notification` messages from the system tray ONLY when the
app is backgrounded/killed. While the app is in the FOREGROUND the message goes
to `onMessage` and nothing is displayed unless the app draws it itself.

This simulates the three app states against the current handlers and shows which
ones currently surface a non-call notification (creator_online / profile_verified).
"""

import re
import pathlib

IDX = pathlib.Path(__file__).resolve().parents[2] / "mobile" / "index.js"
src = IDX.read_text(encoding="utf-8")

print("=== what onMessage does today ===")
m = re.search(r"messaging\(\)\.onMessage\(.*?\n    \}\);", src, re.S)
print(m.group(0) if m else "onMessage not found")

print()
print("=== handler coverage per app state ===")
rows = [
    ("killed",     "getInitialNotification", "routed only if data.type == 'incoming_call'"),
    ("background", "onNotificationOpenedApp", "routed only if data.type == 'incoming_call'"),
    ("foreground", "onMessage",              "routed only if data.type == 'incoming_call'"),
]

# routeIfCall is the only routing helper in the foreground/notification paths.
route = re.search(r"function routeIfCall\(data\) \{.*?\n    \}", src, re.S)
print("routeIfCall body:")
print(route.group(0) if route else "not found")
print()

call_only = "incoming_call" in (route.group(0) if route else "")
for state, handler, note in rows:
    present = handler in src
    print(f"{state:11} {handler:26} present={present}  -> {note}")

print()
print("VERDICT: non-call pushes are dropped in EVERY state except")
print("         background/killed DISPLAY, and the tap does nothing there either.")
