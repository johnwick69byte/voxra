"""Generate Android notification small icons (white silhouette on transparent).

A notification status-bar icon must be a flat white glyph on transparency --
Android tints it and discards colour. Using the launcher icon (full colour,
opaque) produces the classic unreadable white blob.

The glyph is the standard Material Design "call" icon, so it matches the
platform's own call affordance. Writes drawable-{m,h,xh,xxh,xxxh}dpi/
ic_notification.png for plugins/withAndroidNotificationIcon.js to install.

Usage:  python scripts/gen_notification_icons.py
"""
import os

from PIL import Image, ImageDraw
from svgelements import Path as SvgPath

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "notification")

# Android status-bar icons: 24dp baseline, xxxhdpi = 96px is the safe max.
DENSITIES = {"mdpi": 24, "hdpi": 36, "xhdpi": 48, "xxhdpi": 72, "xxxhdpi": 96}

SS = 16  # supersample factor, flattened curves look smooth after downscaling

# Material Design "call" icon, 24x24 viewport, Apache-2.0.
CALL_PATH = (
    "M20.01,15.38c-1.23,0 -2.42,-0.2 -3.53,-0.56 -0.35,-0.11 -0.74,-0.03 -1.02,"
    "0.24l-1.57,1.97c-2.83,-1.35 -5.48,-3.9 -6.89,-6.83l1.95,-1.66c0.28,-"
    "0.26 0.36,-0.65 0.25,-1C8.7,10.32 8.5,9.12 8.5,7.89 8.5,7.27 7.97,6.75 "
    "7.35,6.75L3.8,6.75c-0.61,0 -1.12,0.5 -1.12,1.11 0,4.89 3.98,8.88 "
    "8.88,8.88 0.61,0 1.11,-0.5 1.11,-1.11l0,-3.25z"
)


def _call_polygons():
    """Flatten the 24x24 Material path into polygons (cubic curves included)."""
    svg = SvgPath(d=CALL_PATH)
    polys = []
    for seg in svg.segments():
        if len(seg) < 3:
            continue
        pts = [(p.x, p.y) for p in seg]
        if len(pts) >= 3:
            polys.append(pts)
    return polys


def build(size_px: int) -> Image.Image:
    big = size_px * SS
    scale = big / 24.0
    polys = _call_polygons()

    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for poly in polys:
        pts = [(x * scale, y * scale) for x, y in poly]
        if len(pts) >= 3:
            d.polygon(pts, fill=(255, 255, 255, 255))
    return img.resize((size_px, size_px), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    for bucket, px in DENSITIES.items():
        d = os.path.join(OUT, bucket)
        os.makedirs(d, exist_ok=True)
        path = os.path.join(d, "ic_notification.png")
        build(px).save(path, "PNG", optimize=True)
        print(f"{bucket:8} {px:3}px -> {os.path.relpath(path, ROOT)}")
    print("\nDone. Reference from app code as smallIcon: 'ic_notification'.")


if __name__ == "__main__":
    main()
