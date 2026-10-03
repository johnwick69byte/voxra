"""Verify the one-line FIREBASE_CREDENTIALS_JSON value parses and initializes."""
import json
import sys

raw = open(sys.argv[1], encoding="utf-8").read().strip()
info = json.loads(raw)

pk = info["private_key"]
assert "\\n" not in pk, "escaped newlines still present in private_key"
assert "-----BEGIN PRIVATE KEY-----" in pk, "private key header missing"
assert pk.count("\n") > 5, f"private_key is not multiline (newlines={pk.count(chr(10))})"

print("JSON parses OK")
print("private_key newlines:", pk.count("\n"))
print("project_id:", info["project_id"])
print("client_email:", info["client_email"])
print("length:", len(raw))
