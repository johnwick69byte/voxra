"""Copy the one-line FIREBASE_CREDENTIALS_JSON value to the clipboard.

json.dumps already escapes real newlines in private_key to the two characters
\\n, so the whole service-account JSON fits on a single env-var line and
json.loads on the server restores real newlines. Nothing is written to disk.

Usage (from apps/api):
    python scripts/copy_firebase_env.py
    python scripts/copy_firebase_env.py --print     # show it instead
"""
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SRC = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "firebase-adminsdk.json"
)

with open(SRC, encoding="utf-8") as fh:
    info = json.load(fh)

value = json.dumps(info, separators=(",", ":"))

# Self-check: the line must be single-line and must round-trip to a real key.
assert "\n" not in value, "value must be a single line"
back = json.loads(value)
assert "-----BEGIN PRIVATE KEY-----" in back["private_key"], "private key lost"
assert back["private_key"].count("\n") > 5, "private key is not multiline"

if "--print" in sys.argv:
    print(value)
    sys.exit(0)

# Put the whole value on the Windows clipboard so it can be pasted into Render.
proc = subprocess.run(["clip"], input=value.encode("utf-16-le"), capture_output=True)
if proc.returncode == 0:
    print("Copied FIREBASE_CREDENTIALS_JSON to the clipboard (%d chars)." % len(value))
    print("Paste it into Render: voxora-api -> Environment -> Add Environment Variable")
    print("  Key:   FIREBASE_CREDENTIALS_JSON")
    print("  Value: (already pasted)")
else:
    print("clip failed (%s) - rerun with --print and copy manually." % proc.stderr.decode())
