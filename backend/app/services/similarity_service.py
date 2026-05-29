"""
Internal similarity detection for test cases.

Used by the AI "Generate Test Cases" flow to flag drafts that duplicate an
existing test case in the target suite/section, or that duplicate another draft
in the same batch, before they are persisted.

The implementation is intentionally dependency-free (no ML / embeddings): it
combines token-set overlap (Jaccard) with character-level sequence similarity
(difflib) over normalized text, so it is deterministic, fast and works for the
RTL locales (Arabic / Persian) the product ships.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Iterable, List, Optional

from .ai_prompt_service import strip_html

# Scores at or above this are treated as duplicates (block / auto-deselect).
DUPLICATE_THRESHOLD = 0.82
# Scores at or above this (but below duplicate) are surfaced as a soft warning.
SIMILAR_THRESHOLD = 0.6
# An exact normalized-title match is always treated as at least this similar,
# even when the bodies diverge, because two cases with the same title in the
# same suite are almost always duplicates.
EXACT_TITLE_SCORE = 0.95
# Cap on existing cases scanned per request to keep the check responsive on
# large suites. Comparison is O(candidates * existing) so this bounds work.
MAX_EXISTING_SCAN = 2000
# Number of matches returned per draft.
MAX_MATCHES_PER_DRAFT = 5

# Title contributes a little more than the body: testers usually express the
# intent of a case in its title, and many drafts share boilerplate steps.
_TITLE_WEIGHT = 0.55
_BODY_WEIGHT = 0.45

# Arabic / Persian glyph folding so visually identical text compares equal
# regardless of which keyboard produced it.
_AR_FA_FOLD = {
    "ي": "ی",  # Arabic yeh -> Farsi yeh
    "ى": "ی",  # Alef maksura -> Farsi yeh
    "ك": "ک",  # Arabic kaf -> Farsi keheh
    "ة": "ه",  # Teh marbuta -> heh
}
_AR_FA_FOLD_RE = re.compile("|".join(map(re.escape, _AR_FA_FOLD)))

# Map Arabic-Indic and Persian digits to ASCII.
_DIGIT_FOLD = {ord(c): str(i % 10) for i, c in enumerate(
    "٠١٢٣٤٥٦٧٨٩"
    "۰۱۲۳۴۵۶۷۸۹"
)}

# Keep letters/digits across scripts, drop everything else (punctuation, symbols).
_NON_WORD_RE = re.compile(r"[^\w؀-ۿ]+", flags=re.UNICODE)
_WS_RE = re.compile(r"\s+")


def normalize_text(value: Optional[str]) -> str:
    """Normalize free text for comparison.

    Strips HTML, unescapes entities, applies Unicode NFKC, folds case and
    Arabic/Persian glyph + digit variants, removes punctuation, and collapses
    whitespace. Returns ``""`` for empty / falsy input.
    """
    if not value:
        return ""
    text = strip_html(str(value))
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text)
    text = text.translate(_DIGIT_FOLD)
    text = _AR_FA_FOLD_RE.sub(lambda m: _AR_FA_FOLD[m.group()], text)
    text = text.casefold()
    text = _NON_WORD_RE.sub(" ", text)
    return _WS_RE.sub(" ", text).strip()


def _tokens(text: str) -> frozenset[str]:
    return frozenset(text.split())


def _jaccard(a: frozenset[str], b: frozenset[str]) -> float:
    if not a and not b:
        return 0.0
    if not a or not b:
        return 0.0
    intersection = len(a & b)
    if not intersection:
        return 0.0
    return intersection / len(a | b)


def _ratio(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def _text_similarity(a_text: str, a_tokens: frozenset[str], b_text: str, b_tokens: frozenset[str]) -> float:
    """Blend token-overlap and sequence similarity.

    Jaccard is order-insensitive and good for reworded text; the sequence ratio
    catches near-identical phrasing and short strings where token sets are tiny.
    The max of the two avoids a single weak signal dragging an obvious match down.
    """
    if not a_text or not b_text:
        return 0.0
    jaccard = _jaccard(a_tokens, b_tokens)
    ratio = _ratio(a_text, b_text)
    return max(jaccard, ratio) * 0.5 + (jaccard + ratio) / 2 * 0.5


@dataclass
class TestCaseSignature:
    """Normalized, comparison-ready view of a test case or draft."""

    title_norm: str = ""
    title_tokens: frozenset[str] = field(default_factory=frozenset)
    body_norm: str = ""
    body_tokens: frozenset[str] = field(default_factory=frozenset)

    @property
    def is_empty(self) -> bool:
        return not self.title_norm and not self.body_norm


def build_signature(
    title: Optional[str] = None,
    description: Optional[str] = None,
    preconditions: Optional[str] = None,
    steps: Optional[str] = None,
    expected_result: Optional[str] = None,
    step_lines: Optional[Iterable[str]] = None,
) -> TestCaseSignature:
    """Build a :class:`TestCaseSignature` from raw case/draft fields."""
    title_norm = normalize_text(title)
    body_parts: List[str] = []
    for part in (description, preconditions, steps, expected_result):
        normalized = normalize_text(part)
        if normalized:
            body_parts.append(normalized)
    if step_lines:
        for line in step_lines:
            normalized = normalize_text(line)
            if normalized:
                body_parts.append(normalized)
    body_norm = " ".join(body_parts)
    return TestCaseSignature(
        title_norm=title_norm,
        title_tokens=_tokens(title_norm),
        body_norm=body_norm,
        body_tokens=_tokens(body_norm),
    )


def score_signatures(candidate: TestCaseSignature, other: TestCaseSignature) -> tuple[float, float, float]:
    """Return ``(overall, title_score, body_score)`` for two signatures.

    Both values are in ``[0, 1]``. When either side has no body text the overall
    score falls back to the title score so cases without recorded steps still
    compare sensibly.
    """
    if candidate.is_empty or other.is_empty:
        return 0.0, 0.0, 0.0

    title_score = _text_similarity(
        candidate.title_norm, candidate.title_tokens, other.title_norm, other.title_tokens
    )
    body_score = _text_similarity(
        candidate.body_norm, candidate.body_tokens, other.body_norm, other.body_tokens
    )

    have_both_bodies = bool(candidate.body_norm) and bool(other.body_norm)
    if have_both_bodies and candidate.title_norm and other.title_norm:
        overall = _TITLE_WEIGHT * title_score + _BODY_WEIGHT * body_score
    elif candidate.title_norm and other.title_norm:
        # One side has no body: judge purely on titles.
        overall = title_score
    else:
        # One side has no title (rare): judge on bodies.
        overall = body_score

    # An identical normalized title is a strong duplicate signal on its own.
    if candidate.title_norm and candidate.title_norm == other.title_norm:
        overall = max(overall, EXACT_TITLE_SCORE)

    return round(overall, 4), round(title_score, 4), round(body_score, 4)


def status_for_score(score: float) -> str:
    if score >= DUPLICATE_THRESHOLD:
        return "duplicate"
    if score >= SIMILAR_THRESHOLD:
        return "similar"
    return "unique"
