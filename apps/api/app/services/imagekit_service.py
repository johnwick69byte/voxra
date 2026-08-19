"""ImageKit upload helper — falls back to data-URL passthrough in local/dev."""

from __future__ import annotations

import base64
import logging
import uuid
from typing import Optional

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)


async def upload_base64_image(data_url: str, *, folder: str = "verification") -> str:
    """
    Accepts a data:image/...;base64,... string or https URL.
    Returns a public URL.
    """
    if data_url.startswith("http://") or data_url.startswith("https://"):
        return data_url

    settings = get_settings()
    raw = data_url
    if "," in data_url and data_url.startswith("data:"):
        raw = data_url.split(",", 1)[1]

    if not settings.imagekit_private_key or not settings.imagekit_public_key:
        # Dev: return opaque placeholder URL embedding id (client still stores reference)
        return f"https://placeholder.voxora.local/{folder}/{uuid.uuid4().hex}.jpg"

    try:
        # ImageKit REST upload
        auth = (settings.imagekit_private_key, "")
        files = {
            "file": (f"{folder}_{uuid.uuid4().hex}.jpg", base64.b64decode(raw), "image/jpeg"),
            "fileName": (None, f"{folder}_{uuid.uuid4().hex}.jpg"),
            "folder": (None, f"/voxora/{folder}"),
        }
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                "https://upload.imagekit.io/api/v1/files/upload",
                files=files,
                auth=auth,
            )
            data = resp.json()
            url = data.get("url")
            if not url:
                raise RuntimeError(data.get("message") or "ImageKit upload failed")
            return url
    except Exception:
        logger.exception("ImageKit upload failed")
        raise
