"""Reject phone numbers and social IDs in chat text.

Times are removed before the phone scan, so values such as 10:30, 10.30, and
5pm are not treated as contact details.
"""

from __future__ import annotations

import re
import unicodedata

from fastapi import HTTPException

CONTACT_DETAIL_MESSAGE = (
    "You can't share phone numbers or Instagram, Telegram, or WhatsApp IDs in chat."
)

_ZERO_WIDTH = re.compile(r"[\u200b-\u200d\ufeff]")
_ASCII_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
_NUMBER_WORDS = {
    "zero": "0",
    "oh": "0",
    "one": "1",
    "two": "2",
    "three": "3",
    "four": "4",
    "five": "5",
    "six": "6",
    "seven": "7",
    "eight": "8",
    "nine": "9",
}
_NUMBER_WORD_RE = re.compile(
    r"\b(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)\b",
    re.IGNORECASE,
)
# Clock times only. A dotted time must stand alone so 98.76.54.32.10 stays a phone.
_TIME_RE = re.compile(
    r"\b\d{1,2}:[0-5]\d(?::[0-5]\d)?\s*(?:a\.?\s*m\.?|p\.?\s*m\.?)?\b"
    r"|\b\d{1,2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?)\b"
    r"|\b\d{1,2}\s*o['’]?clock\b"
    r"|(?<![\d.])\b\d{1,2}\.[0-5]\d\b(?![\d.])(?:\s*(?:a\.?\s*m\.?|p\.?\s*m\.?))?",
    re.IGNORECASE,
)
# Ten or more digits, separators included. Colons count only after times are gone.
_PHONE_RE = re.compile(r"\d(?:[\s.\-():]*\d){9,}")
_SOCIAL_RE = re.compile(
    r"(?:https?://|www\.)?\s*"
    r"(?:instagram\.com|instagr\.am|ig\.me|t\.me|telegram\.me|telegram\.dog|wa\.me|whatsapp\.com)"
    r"|\b(?:ig|insta(?:\s*gram)?|tg|tele|telegram|whatsapp|wa)\b"
    r"(?:\s+(?:id|handle|user(?:name)?|account|is)){0,2}"
    r"\s*(?:[:\-/=@]+)\s*@?[a-z0-9._]{2,}"
    r"|\b(?:ig|insta(?:\s*gram)?|tg|telegram|whatsapp)\b"
    r"\s+(?:id|handle|user(?:name)?|account|is)\s+@?[a-z0-9._]{3,}"
    r"|(?<![\w.])@[a-z0-9_]{3,}\b(?!\.)",
    re.IGNORECASE,
)


def _normalize(text: str) -> str:
    cleaned = unicodedata.normalize("NFKC", text or "")
    cleaned = _ZERO_WIDTH.sub("", cleaned)
    return cleaned.translate(_ASCII_DIGITS)


def _digits_for_phone_scan(text: str) -> str:
    spelled = _NUMBER_WORD_RE.sub(lambda match: _NUMBER_WORDS[match.group().lower()], text)
    return _TIME_RE.sub(" ", spelled)


def _has_phone(text: str) -> bool:
    scanned = _digits_for_phone_scan(text)
    return _PHONE_RE.search(scanned) is not None


def _has_social_id(text: str) -> bool:
    squashed = re.sub(r"\s*\.\s*", ".", text)
    squashed = re.sub(r"\s*/\s*", "/", squashed)
    return _SOCIAL_RE.search(squashed) is not None


def contains_contact_details(text: str) -> bool:
    normalized = _normalize(text)
    return _has_phone(normalized) or _has_social_id(normalized)


def reject_contact_details(text: str) -> None:
    if contains_contact_details(text):
        raise HTTPException(400, CONTACT_DETAIL_MESSAGE)
