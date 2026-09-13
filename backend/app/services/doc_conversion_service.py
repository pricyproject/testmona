"""Convert a Doc (canonical Markdown) into one or many Requirements.

Two modes:
  * ``single`` — the whole doc becomes one requirement (a top-level
    ``## Acceptance Criteria`` section, if present, is routed to that field).
  * ``split``  — the doc is split by heading level into one requirement per
    section (heading text => title, section body => description).

The preview step renders the proposed requirements without writing anything so
the UI can show an editable mapping before committing.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List, Optional

import markdown as _markdown

from .. import models


_MD_EXTENSIONS = ["fenced_code", "tables", "sane_lists", "nl2br"]

# A heading is treated as acceptance criteria when its text matches any of these
# common phrasings (kept deliberately broad — authors title this section many
# ways, and a missed match just means the criteria become prose instead of the
# dedicated field).
_ACCEPTANCE_HEADING_RE = re.compile(
    r"\b("
    r"acceptance\s+criteria|acceptance\s+tests?|acceptance\s+conditions?|"
    r"success\s+criteria|definition\s+of\s+done|done\s+criteria|"
    r"acceptance(?:\s|$)"
    r")",
    re.IGNORECASE,
)

# Any ATX heading (used for in-section acceptance extraction and auto-levelling).
_ANY_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")

# Leading list/section numbering an author may have baked into a heading
# ("1.", "1.2.", "3)", "a)", "- ", "• ") — stripped so titles read cleanly.
_TITLE_NUMBERING_RE = re.compile(r"^\s*(?:\d+(?:\.\d+)*[.)]?|[a-zA-Z][.)]|[-*+•])\s+")


def markdown_to_html(md: str) -> str:
    """Render Markdown to HTML. Output is sanitized again at the schema/frontend
    layer, so this stays a plain renderer."""
    if not (md or "").strip():
        return ""
    return _markdown.markdown(md, extensions=_MD_EXTENSIONS, output_format="html5")


def clean_title(title: str) -> str:
    """Normalise a heading into a requirement title: drop inline Markdown markup
    and any leading numbering/bullet, collapse whitespace."""
    text = (title or "").strip()
    if not text:
        return "Untitled"
    text = re.sub(r"`([^`]*)`", r"\1", text)               # inline code
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)          # **bold**
    text = re.sub(r"__([^_]+)__", r"\1", text)              # __bold__
    text = re.sub(r"\*([^*]+)\*", r"\1", text)              # *italic*
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)    # [text](url)
    text = _TITLE_NUMBERING_RE.sub("", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text or "Untitled"


@dataclass
class _Section:
    title: str
    body_md: str
    is_acceptance_criteria: bool = False


@dataclass
class ConvertSection:
    index: int
    title: str
    description_html: str
    is_acceptance_criteria: bool = False
    # In split mode, a section can carry its own acceptance criteria (extracted
    # from a nested "Acceptance Criteria" subsection); empty otherwise.
    acceptance_html: str = ""


@dataclass
class ConvertPlan:
    mode: str
    sections: List[ConvertSection] = field(default_factory=list)


def _split_by_heading(md: str, level: int) -> List[_Section]:
    """Split markdown into sections at ATX headings of exactly ``level`` (``#``*level).

    Content before the first matching heading is kept as an untitled preamble.
    """
    heading_re = re.compile(rf"^{'#' * level}\s+(.+?)\s*#*\s*$")
    lines = (md or "").splitlines()
    sections: List[_Section] = []
    current_title: Optional[str] = None
    buffer: List[str] = []

    def flush():
        body = "\n".join(buffer).strip()
        title = current_title
        if title is None and not body:
            return
        sections.append(
            _Section(
                title=title or "Untitled",
                body_md=body,
                is_acceptance_criteria=bool(title and _ACCEPTANCE_HEADING_RE.search(title)),
            )
        )

    in_fence = False
    for line in lines:
        stripped = line.lstrip()
        if stripped.startswith("```") or stripped.startswith("~~~"):
            in_fence = not in_fence
        m = None if in_fence else heading_re.match(line)
        if m:
            flush()
            current_title = m.group(1).strip()
            buffer = []
        else:
            buffer.append(line)
    flush()
    return sections


def _extract_acceptance(body_md: str) -> tuple[str, Optional[str]]:
    """Split a section body into (remaining_body, acceptance) by pulling out the
    first nested heading whose text reads as acceptance criteria.

    The acceptance block runs from that heading to the next heading of equal or
    shallower level (or end of section). Returns ``(body, None)`` when none is
    found. Fenced code is skipped so a ``#`` inside a code block is never read as
    a heading."""
    lines = (body_md or "").splitlines()
    in_fence = False
    ac_start: Optional[int] = None
    ac_level = 0
    ac_end = len(lines)
    for i, line in enumerate(lines):
        stripped = line.lstrip()
        if stripped.startswith("```") or stripped.startswith("~~~"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        m = _ANY_HEADING_RE.match(line)
        if not m:
            continue
        level = len(m.group(1))
        text = m.group(2).strip()
        if ac_start is None:
            if _ACCEPTANCE_HEADING_RE.search(text):
                ac_start, ac_level = i, level
        elif level <= ac_level:
            ac_end = i
            break
    if ac_start is None:
        return body_md, None
    acceptance_md = "\n".join(lines[ac_start + 1:ac_end]).strip()
    remaining = "\n".join(lines[:ac_start] + lines[ac_end:]).strip()
    return remaining, (acceptance_md or None)


def _auto_heading_level(md: str) -> int:
    """Pick the shallowest heading level (1→3) that yields at least two titled
    sections, so "split" works without the author hand-picking a level. Falls
    back to H2 when no level produces a clean split."""
    for level in (1, 2, 3):
        titled = [
            s for s in _split_by_heading(md, level)
            if s.title != "Untitled" and not s.is_acceptance_criteria
        ]
        if len(titled) >= 2:
            return level
    return 2


def build_plan(doc: models.Doc, mode: str, heading_level: int = 2) -> ConvertPlan:
    """Build the (non-persisted) conversion plan for preview or commit.

    ``heading_level`` of ``0`` means "auto": the split level is detected from the
    document structure."""
    md = doc.content_markdown or ""
    effective_level = _auto_heading_level(md) if heading_level == 0 else heading_level

    if mode == "single":
        sections = _split_by_heading(md, effective_level)
        acceptance = next((s for s in sections if s.is_acceptance_criteria), None)
        if acceptance is not None:
            # Body = everything except the acceptance-criteria section.
            body_parts = [
                (f"{'#' * effective_level} {s.title}\n\n{s.body_md}" if s.title != "Untitled" else s.body_md)
                for s in sections
                if not s.is_acceptance_criteria
            ]
            body_md = "\n\n".join(p for p in body_parts if p.strip()) or md
            acceptance_md = acceptance.body_md
        else:
            # No top-level AC section — fall back to a nested one anywhere in the doc.
            body_md, acceptance_md = _extract_acceptance(md)
            body_md = body_md or md

        # Acceptance criteria are surfaced as their own preview item (index 1)
        # below, so the main section does not also carry them inline.
        result = [
            ConvertSection(
                index=0,
                title=clean_title(doc.title),
                description_html=markdown_to_html(body_md),
                is_acceptance_criteria=False,
            )
        ]
        if acceptance_md:
            result.append(
                ConvertSection(
                    index=1,
                    title="Acceptance Criteria",
                    description_html=markdown_to_html(acceptance_md),
                    is_acceptance_criteria=True,
                )
            )
        return ConvertPlan(mode="single", sections=result)

    # split mode
    sections = _split_by_heading(md, effective_level)
    # Drop an empty untitled preamble so we don't create a junk requirement.
    sections = [s for s in sections if not (s.title == "Untitled" and not s.body_md.strip())]
    if not sections:
        sections = [_Section(title=doc.title, body_md=md)]

    # Build draft tuples first so a same-level "Acceptance Criteria" section can be
    # folded into the preceding requirement (the common ``## Feature`` / ``##
    # Acceptance Criteria`` layout) rather than becoming a standalone requirement.
    drafts: List[dict] = []
    for s in sections:
        body_md, acceptance_md = _extract_acceptance(s.body_md)
        if s.is_acceptance_criteria and drafts:
            prev = drafts[-1]
            prev["acceptance_md"] = "\n\n".join(
                p for p in (prev.get("acceptance_md"), s.body_md.strip()) if p
            ) or None
            continue
        title = clean_title(s.title) if s.title != "Untitled" else clean_title(doc.title)
        drafts.append({"title": title, "body_md": body_md, "acceptance_md": acceptance_md})

    # Everything collapsed (e.g. a lone leading acceptance section) — fall back to
    # one requirement from the whole document.
    if not drafts:
        drafts = [{"title": clean_title(doc.title), "body_md": md, "acceptance_md": None}]

    result = [
        ConvertSection(
            index=i,
            title=d["title"],
            description_html=markdown_to_html(d["body_md"]),
            acceptance_html=markdown_to_html(d["acceptance_md"]) if d["acceptance_md"] else "",
        )
        for i, d in enumerate(drafts)
    ]
    return ConvertPlan(mode="split", sections=result)



