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
from sqlalchemy.orm import Session

from .. import models


_MD_EXTENSIONS = ["fenced_code", "tables", "sane_lists", "nl2br"]

_ACCEPTANCE_HEADING_RE = re.compile(r"acceptance\s+criteria", re.IGNORECASE)


def markdown_to_html(md: str) -> str:
    """Render Markdown to HTML. Output is sanitized again at the schema/frontend
    layer, so this stays a plain renderer."""
    if not (md or "").strip():
        return ""
    return _markdown.markdown(md, extensions=_MD_EXTENSIONS, output_format="html5")


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


def build_plan(doc: models.Doc, mode: str, heading_level: int = 2) -> ConvertPlan:
    """Build the (non-persisted) conversion plan for preview or commit."""
    md = doc.content_markdown or ""
    if mode == "single":
        sections = _split_by_heading(md, heading_level)
        acceptance = next((s for s in sections if s.is_acceptance_criteria), None)
        if acceptance is not None:
            # Body = everything except the acceptance-criteria section.
            body_parts = [
                (f"{'#' * heading_level} {s.title}\n\n{s.body_md}" if s.title != "Untitled" else s.body_md)
                for s in sections
                if not s.is_acceptance_criteria
            ]
            body_md = "\n\n".join(p for p in body_parts if p.strip()) or md
            result = [
                ConvertSection(
                    index=0,
                    title=doc.title,
                    description_html=markdown_to_html(body_md),
                    is_acceptance_criteria=False,
                ),
                ConvertSection(
                    index=1,
                    title="Acceptance Criteria",
                    description_html=markdown_to_html(acceptance.body_md),
                    is_acceptance_criteria=True,
                ),
            ]
        else:
            result = [
                ConvertSection(
                    index=0,
                    title=doc.title,
                    description_html=markdown_to_html(md),
                    is_acceptance_criteria=False,
                )
            ]
        return ConvertPlan(mode="single", sections=result)

    # split mode
    sections = _split_by_heading(md, heading_level)
    # Drop an empty untitled preamble so we don't create a junk requirement.
    sections = [s for s in sections if not (s.title == "Untitled" and not s.body_md.strip())]
    if not sections:
        sections = [_Section(title=doc.title, body_md=md)]
    result = [
        ConvertSection(
            index=i,
            title=(s.title if s.title != "Untitled" else doc.title),
            description_html=markdown_to_html(s.body_md),
        )
        for i, s in enumerate(sections)
    ]
    return ConvertPlan(mode="split", sections=result)


def next_requirement_id(db: Session, project_id: int) -> str:
    """Next ``REQ-NNN`` id for a project (3+ digits, dense increment)."""
    rows = (
        db.query(models.Requirement.requirement_id)
        .filter(models.Requirement.project_id == project_id)
        .all()
    )
    max_n = 0
    pattern = re.compile(r"^REQ-(\d+)$", re.IGNORECASE)
    for (rid,) in rows:
        m = pattern.match((rid or "").strip())
        if m:
            max_n = max(max_n, int(m.group(1)))
    return f"REQ-{max_n + 1:03d}"
