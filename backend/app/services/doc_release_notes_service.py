"""Living release notes for Doc Hub.

A release-notes document is generated deterministically from what actually
changed in a project over a window:

  changed docs        (DocVersion rows in the window, grouped per doc)
  → requirements      (linked via the converter's DocRequirementLink, plus
                       requirements created/updated in the window)
  → resolved defects  (defects moved to fixed/closed in the window)
  → known issues      (still-open defects tracing to the changed requirements)
  → test coverage     (coverage of the impacted requirements)

The service produces the structured source data *and* an editable Markdown
draft. An AI summary blurb is layered on by the route (best-effort), mirroring
``doc_impact_service`` — this module stays dependency-free so the draft is always
available even when AI is off.
"""

from __future__ import annotations

import html
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from .. import models
from ..routes._analytics_shared import (
    add_legacy_reference_links,
    get_linked_requirement_test_case_ids,
)
from .ai_prompt_service import strip_html
from .doc_impact_service import _headings

_DEFAULT_LOOKBACK_DAYS = 30

# A defect counts as "shipped in this release" once it reaches one of these.
_RESOLVED_DEFECT_STATUSES = (models.DefectStatus.FIXED, models.DefectStatus.CLOSED)
_OPEN_DEFECT_STATUSES = (
    models.DefectStatus.OPEN,
    models.DefectStatus.IN_PROGRESS,
    models.DefectStatus.REOPENED,
)

# Most-important-first ordering for "known issues" (the Enum is stored as a
# string, so a SQL ``ORDER BY severity`` would sort alphabetically, not by risk).
_SEVERITY_RANK = {"critical": 0, "high": 1, "medium": 2, "low": 3}


@dataclass
class ChangedDoc:
    doc_id: int
    title: str
    actions: List[str] = field(default_factory=list)
    versions: int = 0
    headings_added: List[str] = field(default_factory=list)
    last_changed_at: Optional[datetime] = None


@dataclass
class ReleaseEntry:
    type: str               # requirement | defect
    id: int
    key: str
    title: str
    status: Optional[str] = None
    severity: Optional[str] = None
    via_docs: List[str] = field(default_factory=list)


@dataclass
class Coverage:
    requirements_total: int = 0
    requirements_covered: int = 0
    requirements_uncovered: int = 0
    test_cases: int = 0
    coverage_pct: float = 0.0


@dataclass
class ReleaseSource:
    range_start: Optional[datetime]
    range_end: Optional[datetime]
    changed_docs: List[ChangedDoc] = field(default_factory=list)
    requirements: List[ReleaseEntry] = field(default_factory=list)
    resolved_defects: List[ReleaseEntry] = field(default_factory=list)
    open_defects: List[ReleaseEntry] = field(default_factory=list)
    coverage: Coverage = field(default_factory=Coverage)


def _aware(value: Optional[datetime]) -> Optional[datetime]:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _clean(value) -> str:
    # Requirement text is HTML-escaped; unescape + strip tags. Doc titles are plain.
    if not value:
        return ""
    return strip_html(html.unescape(str(value)))


def default_since(db: Session, project_id: int) -> datetime:
    """Where the next release picks up: the last published release note's end of
    range (so releases tile without gaps/overlaps), else 30 days back."""
    last = (
        db.query(models.DocReleaseNote)
        .filter(
            models.DocReleaseNote.project_id == project_id,
            models.DocReleaseNote.status == models.DocReleaseNoteStatus.PUBLISHED,
        )
        .order_by(models.DocReleaseNote.published_at.desc())
        .first()
    )
    if last is not None:
        anchor = _aware(last.range_end) or _aware(last.published_at)
        if anchor is not None:
            return anchor
    return datetime.now(timezone.utc) - timedelta(days=_DEFAULT_LOOKBACK_DAYS)


def _collect_changed_docs(
    db: Session, project_id: int, since: datetime, until: datetime
) -> List[ChangedDoc]:
    rows = (
        db.query(models.DocVersion, models.Doc)
        .join(models.Doc, models.DocVersion.doc_id == models.Doc.id)
        .filter(
            models.Doc.project_id == project_id,
            models.DocVersion.created_at > since,
            models.DocVersion.created_at <= until,
        )
        .order_by(models.DocVersion.created_at.asc())
        .all()
    )
    by_doc: Dict[int, ChangedDoc] = {}
    doc_obj: Dict[int, models.Doc] = {}
    for version, doc in rows:
        doc_obj[doc.id] = doc
        entry = by_doc.get(doc.id)
        if entry is None:
            entry = ChangedDoc(doc_id=doc.id, title=doc.title or f"Doc {doc.id}")
            by_doc[doc.id] = entry
        entry.versions += 1
        action = (version.action or "updated")
        if action not in entry.actions:
            entry.actions.append(action)
        created = _aware(version.created_at)
        if created and (entry.last_changed_at is None or created > entry.last_changed_at):
            entry.last_changed_at = created

    # Headings added: current doc headings minus those present just before the window.
    for doc_id, entry in by_doc.items():
        doc = doc_obj[doc_id]
        baseline = (
            db.query(models.DocVersion.content_markdown)
            .filter(
                models.DocVersion.doc_id == doc_id,
                models.DocVersion.created_at <= since,
            )
            .order_by(models.DocVersion.created_at.desc())
            .first()
        )
        baseline_headings = set(_headings(baseline[0]) if baseline else [])
        current_headings = _headings(doc.content_markdown)
        entry.headings_added = [h for h in current_headings if h not in baseline_headings][:15]

    return sorted(
        by_doc.values(),
        key=lambda d: d.last_changed_at or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )


def _collect_requirements(
    db: Session, project_id: int, changed_doc_ids: List[int], since: datetime, until: datetime
) -> List[ReleaseEntry]:
    via: Dict[int, List[str]] = {}
    if changed_doc_ids:
        link_rows = (
            db.query(models.DocRequirementLink.requirement_id, models.Doc.title)
            .join(models.Doc, models.DocRequirementLink.doc_id == models.Doc.id)
            .filter(models.DocRequirementLink.doc_id.in_(changed_doc_ids))
            .all()
        )
        for req_id, doc_title in link_rows:
            via.setdefault(req_id, [])
            if doc_title and doc_title not in via[req_id]:
                via[req_id].append(doc_title)

    linked_ids = set(via.keys())
    # Requirements linked to changed docs OR created/changed within the window.
    conditions = [
        models.Requirement.created_at > since,
        models.Requirement.updated_at > since,
    ]
    if linked_ids:
        conditions.append(models.Requirement.id.in_(linked_ids))
    candidates = (
        db.query(models.Requirement)
        .filter(
            models.Requirement.project_id == project_id,
            or_(*conditions),
        )
        .limit(500)
        .all()
    )
    entries: List[ReleaseEntry] = []
    for req in candidates:
        entries.append(ReleaseEntry(
            type="requirement",
            id=req.id,
            key=req.requirement_id or f"REQ-{req.id}",
            title=_clean(req.title),
            status=getattr(req.status, "value", req.status),
            via_docs=via.get(req.id, []),
        ))
    # Doc-linked first, then by key.
    entries.sort(key=lambda e: (not e.via_docs, e.key))
    return entries


def _defect_entry(d: models.Defect) -> ReleaseEntry:
    return ReleaseEntry(
        type="defect",
        id=d.id,
        key=d.defect_id or f"DEF-{d.id}",
        title=_clean(d.title),
        status=getattr(d.status, "value", d.status),
        severity=getattr(d.severity, "value", d.severity),
    )


def _collect_defects(
    db: Session, project_id: int, requirement_ids: List[int], since: datetime, until: datetime
):
    # ``Defect`` has no resolved-at timestamp; ``updated_at`` is the proxy for
    # "reached fixed/closed", but it is ``onupdate``-only so a defect inserted
    # already-resolved (or never edited since) has NULL there — fall back to
    # ``created_at`` so those still land in the window.
    resolved_ts = func.coalesce(models.Defect.updated_at, models.Defect.created_at)
    resolved = (
        db.query(models.Defect)
        .filter(
            models.Defect.project_id == project_id,
            models.Defect.status.in_(_RESOLVED_DEFECT_STATUSES),
            resolved_ts > since,
            resolved_ts <= until,
        )
        .order_by(resolved_ts.desc())
        .limit(200)
        .all()
    )
    open_defects: List[models.Defect] = []
    if requirement_ids:
        open_defects = (
            db.query(models.Defect)
            .filter(
                models.Defect.project_id == project_id,
                models.Defect.status.in_(_OPEN_DEFECT_STATUSES),
                models.Defect.requirement_id.in_(requirement_ids),
            )
            .limit(100)
            .all()
        )
    open_entries = [_defect_entry(d) for d in open_defects]
    # Surface the riskiest known issues first.
    open_entries.sort(key=lambda e: _SEVERITY_RANK.get(e.severity or "", 99))
    return [_defect_entry(d) for d in resolved], open_entries


def _compute_coverage(db: Session, project_id: int, requirement_ids: List[int]) -> Coverage:
    if not requirement_ids:
        return Coverage()
    requirements = (
        db.query(models.Requirement)
        .filter(models.Requirement.id.in_(requirement_ids))
        .all()
    )
    test_cases = (
        db.query(models.TestCase)
        .join(models.TestSuite, models.TestCase.test_suite_id == models.TestSuite.id)
        .filter(
            models.TestSuite.project_id == project_id,
            ((models.TestCase.is_deleted.is_(None)) | (models.TestCase.is_deleted.is_(False))),
        )
        .limit(5000)
        .all()
    )
    tc_ids = [tc.id for tc in test_cases]
    linked = get_linked_requirement_test_case_ids(db, requirement_ids, tc_ids)
    add_legacy_reference_links(linked, requirements, test_cases)
    covered_ids = {rid for rid, ids in linked.items() if ids}
    all_linked_tc: set = set()
    for ids in linked.values():
        all_linked_tc.update(ids)
    total = len(requirement_ids)
    covered = len(covered_ids)
    return Coverage(
        requirements_total=total,
        requirements_covered=covered,
        requirements_uncovered=total - covered,
        test_cases=len(all_linked_tc),
        coverage_pct=round((covered / total) * 100, 1) if total else 0.0,
    )


def gather_release_data(
    db: Session,
    project_id: int,
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
) -> ReleaseSource:
    """Collect everything that changed for the project in ``[since, until]``."""
    until = _aware(until) or datetime.now(timezone.utc)
    since = _aware(since) or default_since(db, project_id)
    if since > until:
        since, until = until, since

    changed_docs = _collect_changed_docs(db, project_id, since, until)
    changed_doc_ids = [d.doc_id for d in changed_docs]
    requirements = _collect_requirements(db, project_id, changed_doc_ids, since, until)
    requirement_ids = [r.id for r in requirements]
    resolved_defects, open_defects = _collect_defects(db, project_id, requirement_ids, since, until)
    coverage = _compute_coverage(db, project_id, requirement_ids)

    return ReleaseSource(
        range_start=since,
        range_end=until,
        changed_docs=changed_docs,
        requirements=requirements,
        resolved_defects=resolved_defects,
        open_defects=open_defects,
        coverage=coverage,
    )


def _fmt_date(value: Optional[datetime]) -> str:
    return value.strftime("%Y-%m-%d") if value else "—"


def render_markdown(
    source: ReleaseSource,
    title: str,
    version: Optional[str] = None,
    summary: Optional[str] = None,
) -> str:
    """Render an editable Markdown draft from the gathered source data."""
    lines: List[str] = []
    heading = title
    if version:
        heading = f"{title} ({version})"
    lines.append(f"# {heading}")
    lines.append("")
    lines.append(f"_Covering changes from {_fmt_date(source.range_start)} to {_fmt_date(source.range_end)}._")
    lines.append("")

    if summary:
        lines.append("## Summary")
        lines.append("")
        lines.append(summary.strip())
        lines.append("")

    if source.changed_docs:
        lines.append("## What's changed")
        lines.append("")
        for doc in source.changed_docs:
            actions = ", ".join(doc.actions) if doc.actions else "updated"
            lines.append(f"- **{doc.title}** — {actions}")
            for h in doc.headings_added:
                lines.append(f"  - New section: {h}")
        lines.append("")

    if source.requirements:
        lines.append("## Requirements")
        lines.append("")
        for req in source.requirements:
            status = f" _({req.status})_" if req.status else ""
            lines.append(f"- `{req.key}` {req.title}{status}")
        lines.append("")

    if source.resolved_defects:
        lines.append("## Fixed issues")
        lines.append("")
        for d in source.resolved_defects:
            sev = f" [{d.severity}]" if d.severity else ""
            lines.append(f"- `{d.key}`{sev} {d.title}")
        lines.append("")

    if source.open_defects:
        lines.append("## Known issues")
        lines.append("")
        for d in source.open_defects:
            sev = f" [{d.severity}]" if d.severity else ""
            lines.append(f"- `{d.key}`{sev} {d.title} _({d.status})_")
        lines.append("")

    cov = source.coverage
    if cov.requirements_total:
        lines.append("## Test coverage")
        lines.append("")
        lines.append(
            f"- {cov.requirements_covered}/{cov.requirements_total} requirements covered "
            f"({cov.coverage_pct}%) across {cov.test_cases} test cases."
        )
        if cov.requirements_uncovered:
            lines.append(f"- ⚠️ {cov.requirements_uncovered} requirement(s) have no test coverage.")
        lines.append("")

    if not (source.changed_docs or source.requirements or source.resolved_defects or source.open_defects):
        lines.append("_No documented changes in this period._")
        lines.append("")

    return "\n".join(lines).strip() + "\n"


def default_title(source: ReleaseSource) -> str:
    return f"Release notes — {_fmt_date(source.range_end)}"


def ai_payload(source: ReleaseSource) -> dict:
    """Compact dict handed to the AI prompt builder for the summary blurb."""
    return {
        "range_start": _fmt_date(source.range_start),
        "range_end": _fmt_date(source.range_end),
        "changed_docs": [
            {"title": d.title, "actions": d.actions, "new_sections": d.headings_added}
            for d in source.changed_docs[:30]
        ],
        "requirements": [
            {"key": r.key, "title": r.title, "status": r.status}
            for r in source.requirements[:40]
        ],
        "fixed_defects": [
            {"key": d.key, "title": d.title, "severity": d.severity}
            for d in source.resolved_defects[:40]
        ],
        "known_issues": [
            {"key": d.key, "title": d.title, "severity": d.severity}
            for d in source.open_defects[:20]
        ],
        "coverage": {
            "covered": source.coverage.requirements_covered,
            "total": source.coverage.requirements_total,
            "pct": source.coverage.coverage_pct,
        },
    }
