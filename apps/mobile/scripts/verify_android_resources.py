"""Pre-flight validation of the Android native project.

Runs without the Android SDK or a Gradle build, so it catches resource-linking
and app-config mistakes in seconds instead of after a multi-minute EAS build.

Checks:
  1. app.json is valid JSON and carries no keys Expo now rejects.
  2. No compileSdk/targetSdk pins (they drift out of sync with dependencies --
     the cause of the "13 issues found when checking AAR metadata" failure).
  3. Notification drawables exist in every density, as white-on-transparent PNG.
  4. Every android:resource in the manifest is a real reference, and every
     reference resolves to a real resource. Catches both
     "'#0F766E' is incompatible with attribute resource (attr) reference"
     and a dangling @drawable/@color.
  5. Plugin files referenced by app.json are syntactically valid JS.

Usage:
    python scripts/verify_android_resources.py           # validate android/ if present
    python scripts/verify_android_resources.py --prebuild # run prebuild first
"""
import json
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANDROID = os.path.join(ROOT, "android")
APP_JSON = os.path.join(ROOT, "app.json")
RES = os.path.join(ANDROID, "app", "src", "main", "res")
MANIFEST = os.path.join(ANDROID, "app", "src", "main", "AndroidManifest.xml")

DENSITIES = ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]

# Keys current Expo rejects (hard error) or warns are obsolete.
BANNED_APP_CONFIG = {
    "notification": "rejected by withAndroidDangerousBaseMod; use expo-notifications plugin",
    "edgeToEdgeEnabled": "obsolete, Android 16 makes edge-to-edge mandatory",
    "newArchEnabled": "removed from schema; New Architecture is the only option in SDK 57",
}
BANNED_PATHS = {
    "android/jsEngine": "removed from schema; Hermes is the only engine in SDK 57",
}
# Pins that silently drift out of sync with the installed AndroidX versions.
SDK_PINS = {"android/compileSdkVersion", "android/targetSdkVersion"}

errors: list[str] = []
warnings: list[str] = []
notes: list[str] = []


def err(msg):
    errors.append(msg)


def warn(msg):
    warnings.append(msg)


def note(msg):
    notes.append(msg)


def _exe(name: str) -> str | None:
    """Resolve a CLI tool, picking the .cmd shim on Windows (npx has no .exe)."""
    found = shutil.which(name)
    if found:
        return found
    if os.name == "nt":
        for ext in (".cmd", ".bat", ".ps1"):
            alt = shutil.which(name + ext)
            if alt:
                return alt
    return None


# ── 1/2. app.json ────────────────────────────────────────────────────────────
def check_app_json():
    try:
        with open(APP_JSON, encoding="utf-8") as fh:
            cfg = json.load(fh)["expo"]
    except Exception as e:
        err(f"app.json is not valid JSON: {e}")
        return None

    for key, why in BANNED_APP_CONFIG.items():
        if key in cfg:
            err(f"app.json still sets '{key}' -- {why}")

    android = cfg.get("android", {})
    for key, why in BANNED_PATHS.items():
        short = key.split("/", 1)[1]
        if short in android:
            err(f"app.json android.{short} is set -- {why}")

    bp = next(
        (p[1] for p in cfg.get("plugins", [])
         if isinstance(p, list) and p[0] == "expo-build-properties"),
        None,
    )
    if bp:
        and_cfg = bp.get("android", {})
        for key in ("compileSdkVersion", "targetSdkVersion"):
            if key in and_cfg:
                err(
                    f"expo-build-properties pins android/{key}="
                    f"{and_cfg[key]} -- remove the pin and let Expo SDK 57 default "
                    f"(36); a stale pin breaks AAR metadata checking"
                )
        if and_cfg.get("enableProguardInReleaseBuilds"):
            warn(
                "enableProguardInReleaseBuilds is on -- ensure keep rules cover "
                "io.agora and com.callstack and re-test on a RELEASE build"
            )
    return cfg


# ── 3. notification drawables ────────────────────────────────────────────────
def check_notification_icons():
    try:
        from PIL import Image
    except ImportError:
        warn("Pillow not installed -- skipping icon pixel checks")
        return

    for density in DENSITIES:
        path = os.path.join(ROOT, "assets", "notification", density, "ic_notification.png")
        if not os.path.exists(path):
            err(f"missing notification icon: assets/notification/{density}/ic_notification.png")
            continue
        with Image.open(path) as im:
            if im.mode != "RGBA":
                err(f"{density}: icon must be RGBA, got {im.mode}")
                continue
            alpha = im.getchannel("A")
            if alpha.getbbox() is None:
                err(f"{density}: icon is fully transparent")
                continue
            # Only visible pixels matter; transparent ones carry no colour and
            # would otherwise be counted as "not white".
            rgba = im.getdata()
            visible = [(r, g, b) for r, g, b, a in rgba if a > 200]
            if not visible:
                err(f"{density}: icon has no visible pixels")
                continue
            non_white = sum(
                1 for r, g, b in visible if not (r > 240 and g > 240 and b > 240)
            )
            pct = non_white / len(visible)
            if pct > 0.10:
                err(
                    f"{density}: {pct:.0%} of visible pixels are not white. "
                    "Android discards colour, so the glyph must be pure white"
                )


# ── 4. manifest resources ────────────────────────────────────────────────────
def collect_resources():
    """Names of every resource actually present in res/."""
    names = set()
    if not os.path.isdir(RES):
        return names
    for entry in os.listdir(RES):
        full = os.path.join(RES, entry)
        if os.path.isfile(full):
            continue
        if entry.startswith("drawable"):
            names.update(os.path.splitext(f)[0] for f in os.listdir(full))
        elif entry.startswith("values"):
            with open(os.path.join(full, "colors.xml"), encoding="utf-8") as fh:
                body = fh.read()
            names.update(re.findall(r'<color\s+name="([^"]+)"', body))
            names.update(re.findall(r'<string\s+name="([^"]+)"', body))
        elif entry.startswith("mipmap"):
            names.update(os.path.splitext(f)[0] for f in os.listdir(full))
    return names


def check_manifest():
    if not os.path.exists(MANIFEST):
        note("android/ not present -- run with --prebuild to validate the manifest")
        return

    with open(MANIFEST, encoding="utf-8") as fh:
        body = fh.read()

    available = collect_resources()
    refs = re.findall(r'android:resource="([^"]+)"', body)

    for ref in refs:
        if not ref.startswith("@"):
            err(
                f'android:resource="{ref}" is not a reference. AAPT requires '
                '"@color/name" / "@drawable/name"; a literal fails with '
                "\"'#...' is incompatible with attribute resource (attr) reference\""
            )
            continue
        kind, _, name = ref[1:].partition("/")
        if kind == "android":
            continue
        if name and name not in available:
            err(f'android:resource="{ref}" does not resolve -- no such resource')

    if "android.default_notification_icon" not in body:
        warn("manifest has no android.default_notification_icon")


# ── 5. plugin syntax ─────────────────────────────────────────────────────────
def check_plugins(cfg):
    if not cfg:
        return
    for plugin in cfg.get("plugins", []):
        name = plugin[0] if isinstance(plugin, list) else plugin
        if not str(name).startswith("."):
            continue
        path = os.path.join(ROOT, str(name))
        if not os.path.exists(path):
            err(f"app.json references missing plugin {name}")
        elif _exe("node"):
            res = subprocess.run(
                [_exe("node"), "--check", path], capture_output=True, text=True
            )
            if res.returncode != 0:
                err(f"{name} is not valid JS: {res.stderr.strip().splitlines()[-1]}")


# ── main ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    if "--prebuild" in sys.argv or not os.path.isdir(ANDROID):
        print("Running expo prebuild...")
        npx = _exe("npx")
        if not npx:
            print("ERROR npx not found on PATH -- cannot prebuild.")
            sys.exit(1)
        res = subprocess.run(
            [npx, "expo", "prebuild", "--no-install", "--platform", "android"],
            cwd=ROOT,
        )
        if res.returncode != 0:
            print("\nprebuild FAILED -- fix that before anything else.")
            sys.exit(1)

    cfg = check_app_json()
    check_notification_icons()
    check_manifest()
    check_plugins(cfg)

    for m in notes:
        print(f"note  {m}")
    for m in warnings:
        print(f"WARN  {m}")
    for m in errors:
        print(f"ERROR {m}")

    if errors:
        print(f"\n{len(errors)} error(s) -- these would fail or corrupt the EAS build.")
        sys.exit(1)
    print("\nAll checks passed.")
