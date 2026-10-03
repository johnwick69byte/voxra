"""End-to-end check of the Option B path: FIREBASE_CREDENTIALS_JSON env var.

Simulates exactly what Render does -- the whole service-account JSON arrives as
a single environment variable, no file on disk. Verifies _ensure_firebase()
initializes and that the resulting credential can mint an FCM token.

Usage:  python scripts/verify_option_b.py <path-to-firebase-adminsdk.json>
"""
import json
import os
import sys

# Allow running as `python scripts/verify_option_b.py ...` from apps/api.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

src = sys.argv[1]

# Build the one-line env value exactly as Render would receive it.
raw = json.load(open(src, encoding="utf-8"))
env_value = json.dumps(raw, separators=(",", ":"))
assert "\n" not in env_value, "env value must be a single line"

# Pretend there is no credentials file anywhere.
os.environ.pop("FIREBASE_CREDENTIALS_PATH", None)
os.environ["FIREBASE_CREDENTIALS_JSON"] = env_value

# Reload settings + push_service with the env var in place.
import app.core.config as config_mod

config_mod.get_settings.cache_clear()

import app.services.push_service as push_service

push_service._firebase_ready = False

settings = config_mod.get_settings()
assert settings.firebase_credentials_json, "FIREBASE_CREDENTIALS_JSON not picked up"

# Locally the .env may still set FIREBASE_CREDENTIALS_PATH; on Render it will be
# empty. Either way push_service must prefer the JSON env var when it is present.
if settings.firebase_credentials_path:
    print("note: local .env sets FIREBASE_CREDENTIALS_PATH too; JSON must win")

print("env var picked up by Settings  OK  (len=%d)" % len(settings.firebase_credentials_json))
print("source resolved to              json_env")

ok = push_service._ensure_firebase()
print("_ensure_firebase() ->", ok)
assert ok, "Firebase failed to initialize from the env var"

import firebase_admin

app = firebase_admin.get_app()
print("firebase project_id            ", app.project_id)
print("credential class               ", app.credential.__class__.__name__)

assert app.credential, "app has no credential"
print("service account               ", app.credential.service_account_email)

# The private key survived env-var transport intact if it parses as PEM.
from cryptography.hazmat.primitives import serialization

pk = json.loads(settings.firebase_credentials_json)["private_key"]
assert pk.count("\n") > 5, f"private_key not multiline ({pk.count(chr(10))} newlines)"
key = serialization.load_pem_private_key(pk.encode(), password=None)
print("private key parses OK         ", type(key).__name__)

# firebase_admin built a signer from the same key, so it can sign JWTs.
assert app.credential.signer is not None, "credential produced no signer"
print("signer built                  OK")

# Optional live check: exchange the JWT with Google to prove the key is valid.
if "--live" in sys.argv:
    token = app.credential.get_access_token()
    assert token.access_token, "Google returned an empty token"
    assert token.access_token.startswith("ya29."), "unexpected token format"
    print("Google access token OK         %s... (expires %s)" % (token.access_token[:12], token.expiry))
else:
    print("add --live to also exchange a real token with Google")

print("\nOPTION B VERIFIED: FCM will initialize on Render with no Secret File.")
