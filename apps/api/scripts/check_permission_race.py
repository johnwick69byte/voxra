"""Reproduce the unresponsive video-call button.

Sequence from the report:
  1. Fresh install, sign up. _layout fires ensureAllPermissions() -> prompts for
     camera/mic/notification/phone-account.
  2. User taps "Video call".
  3. Nothing happens. Reopening the app and tapping again works.

The `alreadyAsked` session guard returns false for permission requests that were
never actually granted, and 'denied' with canAskAgain=null (not yet decided) is
not distinguished from a real denial.
"""

import pathlib
import re

SRC = pathlib.Path(__file__).resolve().parents[2] / "mobile" / "src" / "services" / "permissions.ts"
src = SRC.read_text(encoding="utf-8")

print("=" * 70)
print("PERMISSION STATE MACHINE")
print("=" * 70)

for fn in ("ensureCameraPermission", "ensureMicPermission"):
    m = re.search(rf"export async function {fn}.*?\n\}}", src, re.S)
    body = m.group(0) if m else ""
    print(f"\n--- {fn} ---")
    print(body)

print("\n" + "=" * 70)
print("TRACE: user taps Video call after step 1 already asked")
print("=" * 70)
print("""
ensureAllPermissions() at login:
    ensureCameraPermission()
      existing = 'undetermined'  (or 'denied' before the dialog resolves)
      -> canAskAgain is UNDEFINED at this point on some devices
      -> alreadyAsked('camera') == false  => markAsked('camera'), request
      dialog shows; the user may grant LATER, or the promise may still be
      pending when they navigate away.

User taps Video call:
    ensureCallPermissions(needCamera=true)
      ensureMicPermission() -> granted -> true
      ensureCameraPermission()
        existing reads 'undetermined' or 'denied' while the FIRST dialog is
        still on screen / was dismissed
        -> alreadyAsked('camera') == TRUE  => returns FALSE
      => ensureCallPermissions returns false
      => startCall() does `if (!ok) return;`  <-- NOTHING HAPPENS

No toast, no alert, no spinner. That is the silent unresponsive button.
After a restart the session set is empty, so the second attempt prompts and
succeeds -- exactly as reported.
""")

print("=" * 70)
print("THE SILENT EARLY RETURN")
print("=" * 70)
CID = pathlib.Path(__file__).resolve().parents[2] / "mobile" / "app" / "creator" / "[id].tsx"
cid = CID.read_text(encoding="utf-8")
m = re.search(r"const ok = await ensureCallPermissions.*?\n.*?if \(!ok\) return;", cid)
print(m.group(0) if m else "not found")
print()
print("=> returns with no user-visible feedback whatsoever")
