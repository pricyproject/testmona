"""Language-aware date formatting for server-rendered, human-facing strings.

The backend stores and reasons about dates in the Gregorian calendar. When a
piece of text is *rendered for a person* and the target language is Persian
(``fa``), the date should instead read in the **Jalali/Shamsi** calendar with
Persian-Indic digits (e.g. ``۱۴۰۵/۰۳/۳۱``). Every other language keeps the
Gregorian rendering.

This module is the single choke point for that conversion so callers don't
sprinkle ``strftime`` / calendar logic around. Pass the caller's ``lang`` (the
frontend's current language) explicitly — there is no stored per-user language.

Filenames, IDs, API timestamps and machine-readable payloads must keep their
Gregorian form and should NOT go through here.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional, Union

try:  # jdatetime is an optional dependency; degrade to Gregorian if missing.
    import jdatetime
except Exception:  # pragma: no cover - defensive import
    jdatetime = None  # type: ignore

DateLike = Union[date, datetime, None]

# Latin → Persian-Indic digit mapping (used only for the fa rendering).
_PERSIAN_DIGITS = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")


def to_persian_digits(text: str) -> str:
    """Return ``text`` with Latin digits replaced by Persian-Indic digits."""
    return text.translate(_PERSIAN_DIGITS)


def _as_date(value: DateLike) -> Optional[date]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return None


def format_date(
    value: DateLike,
    lang: str = "en",
    *,
    gregorian_format: str = "%Y-%m-%d",
    jalali_format: str = "%Y/%m/%d",
    fallback: str = "—",
) -> str:
    """Format a date for display in the given language.

    - ``lang == 'fa'`` → Jalali calendar with Persian digits.
    - anything else → Gregorian via ``gregorian_format``.
    Returns ``fallback`` for a ``None``/unrecognized value.
    """
    d = _as_date(value)
    if d is None:
        return fallback
    if lang == "fa" and jdatetime is not None:
        jd = jdatetime.date.fromgregorian(date=d)
        return to_persian_digits(jd.strftime(jalali_format))
    return d.strftime(gregorian_format)
