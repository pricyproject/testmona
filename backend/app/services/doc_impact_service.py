"""Change impact analysis for Doc Hub documents.

When a doc changes, an author wants to see what it ripples out to *before*
saving/publishing. Requirements, test cases, and defects all trace back to docs
(directly via the converter's :class:`DocRequirementLink`, and indirectly through
the traceability links), so this service derives the impacted artifacts
deterministically:

  doc → requirements      (DocRequirementLink provenance + lexical similarity)
  requirements → tests    (requirement_test_case_links + TraceabilityMatrix + legacy refs)
  requirements/tests → defects (Defect.requirement_id / Defect.test_case_id)

The matching is intentionally dependency-free (token overlap, no embeddings),
mirroring ``requirement_retrieval`` / ``similarity_service``. The AI risk
assessment is layered on top by the route — this module only produces the
deterministic graph plus heuristic risk signals that are always available.
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass, field
from typing import Any, List, Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from .. import models
from ..routes._analytics_shared import (
    add_legacy_reference_links,
    get_linked_requirement_test_case_ids,
)
from .ai_prompt_service import strip_html
from .requirement_retrieval import _score, _tokens

# Strip the heaviest Markdown punctuation so doc content scores as prose
# (mirrors ``requirement_retrieval._load_doc_hub_docs``).
_MD_STRIP_RE = re.compile(r"[#*_`>~\[\]\(\)!]|https?://\S+")
_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")

# A requirement is admitted as "similar" only above this token-overlap score, so
# a doc edit doesn't drag in every loosely-worded requirement in the project.
_SIMILARITY_THRESHOLD = 0.12

_OPEN_DEFECT_STATUSES = (
    models.DefectStatus.OPEN,
    models.DefectStatus.IN_PROGRESS,
    models.DefectStatus.REOPENED,
)


@dataclass
class ImpactItem:
    type: str           # requirement | test_case | defect
    id: int
    key: str
    title: str
    reason: str         # linked | similar
    score: float = 0.0
    status: Optional[str] = None
    severity: Optional[str] = None
    is_open: Optional[bool] = None
    # For test cases / defects: the requirement key(s) this item was pulled in
    # through, so the reader can see *why* it is here (e.g. ["REQ-001"]).
    via: List[str] = field(default_factory=list)


@dataclass
class ChangeSummary:
    changed: bool
    headings_added: List[str] = field(default_factory=list)
    headings_removed: List[str] = field(default_factory=list)
    char_delta: int = 0
    note: str = ""


@dataclass
class RiskSignals:
    impacted_requirements: int = 0
    impacted_test_cases: int = 0
    impacted_defects: int = 0
    open_defects: int = 0
    high_severity_defects: int = 0
    uncovered_requirements: int = 0


@dataclass
class DocImpactGraph:
    requirements: List[ImpactItem]
    test_cases: List[ImpactItem]
    defects: List[ImpactItem]
    change_summary: ChangeSummary
    risk_signals: RiskSignals


def _doc_blob(markdown: Optional[str]) -> str:
    """Plain-text-ish view of a doc body for token matching."""
    return _MD_STRIP_RE.sub(" ", markdown or "")


def _req_clean(value: Any) -> str:
    # Requirement text is HTML-*escaped* (unlike doc bodies); unescape then strip
    # tags so matching sees real words. See [[requirement-content-html-escaped]].
    if not value:
        return ""
    return strip_html(html.unescape(str(value)))


def _req_blob(req: models.Requirement) -> str:
    parts = [
        req.requirement_id or "",
        _req_clean(req.title),
        _req_clean(req.description),
        _req_clean(req.acceptance_criteria),
        req.tags or "",
    ]
    return " ".join(p for p in parts if p)


def _headings(markdown: Optional[str]) -> List[str]:
    headings: List[str] = []
    in_fence = False
    for line in (markdown or "").splitlines():
        stripped = line.lstrip()
        if stripped.startswith("```") or stripped.startswith("~~~"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        m = _HEADING_RE.match(line)
        if m:
            headings.append(m.group(2).strip())
    return headings


def _build_change_summary(doc: models.Doc, candidate_markdown: Optional[str]) -> ChangeSummary:
    baseline = doc.content_markdown or ""
    if candidate_markdown is None or candidate_markdown == baseline:
        return ChangeSummary(changed=False, char_delta=0, note="Analyzing the current document content.")
    old_headings = _headings(baseline)
    new_headings = _headings(candidate_markdown)
    old_set = set(old_headings)
    new_set = set(new_headings)
    added = [h for h in new_headings if h not in old_set]
    removed = [h for h in old_headings if h not in new_set]
    return ChangeSummary(
        changed=True,
        headings_added=added[:25],
        headings_removed=removed[:25],
        char_delta=len(candidate_markdown) - len(baseline),
        note="Analyzing unsaved draft changes against the current document.",
    )


def _load_project_requirements(db: Session, project_id: int, hard_cap: int = 2000) -> List[models.Requirement]:
    return (
        db.query(models.Requirement)
        .filter(models.Requirement.project_id == project_id)
        .limit(hard_cap)
        .all()
    )


def _project_test_cases(db: Session, project_id: int, hard_cap: int = 5000) -> List[models.TestCase]:
    return (
        db.query(models.TestCase)
        .join(models.TestSuite, models.TestCase.test_suite_id == models.TestSuite.id)
        .filter(
            models.TestSuite.project_id == project_id,
            ((models.TestCase.is_deleted.is_(None)) | (models.TestCase.is_deleted.is_(False))),
        )
        .limit(hard_cap)
        .all()
    )


def analyze_doc_impact(
    db: Session,
    doc: models.Doc,
    candidate_markdown: Optional[str] = None,
    max_requirements: int = 15,
) -> DocImpactGraph:
    """Derive the requirements / test cases / defects a doc change impacts.

    Linked requirements (converter provenance) are always included; additional
    requirements are admitted by lexical similarity to the (candidate or stored)
    doc body, capped at ``max_requirements`` total.
    """
    change_summary = _build_change_summary(doc, candidate_markdown)

    # Global docs have no project artifacts to impact.
    if doc.project_id is None:
        empty_note = "This is a global document with no project requirements, tests, or defects to impact."
        return DocImpactGraph(
            requirements=[], test_cases=[], defects=[],
            change_summary=ChangeSummary(
                changed=change_summary.changed,
                headings_added=change_summary.headings_added,
                headings_removed=change_summary.headings_removed,
                char_delta=change_summary.char_delta,
                note=empty_note,
            ),
            risk_signals=RiskSignals(),
        )

    project_id = doc.project_id
    body = candidate_markdown if candidate_markdown is not None else doc.content_markdown
    query_tokens = _tokens(f"{doc.title or ''} {_doc_blob(body)}")

    linked_ids = {
        rid for (rid,) in db.query(models.DocRequirementLink.requirement_id)
        .filter(models.DocRequirementLink.doc_id == doc.id).all()
    }

    all_requirements = _load_project_requirements(db, project_id)
    req_by_id = {r.id: r for r in all_requirements}

    # Score every requirement; linked ones are kept regardless of score.
    scored: List[tuple[models.Requirement, float]] = []
    for req in all_requirements:
        if req.id in linked_ids:
            continue
        score = _score(query_tokens, _tokens(_req_blob(req)))
        if score >= _SIMILARITY_THRESHOLD:
            scored.append((req, score))
    scored.sort(key=lambda item: item[1], reverse=True)

    impacted_requirements: List[ImpactItem] = []
    for rid in sorted(linked_ids):
        req = req_by_id.get(rid)
        if req is None:
            continue
        impacted_requirements.append(ImpactItem(
            type="requirement", id=req.id,
            key=req.requirement_id or f"REQ-{req.id}",
            title=_req_clean(req.title), reason="linked",
            score=round(_score(query_tokens, _tokens(_req_blob(req))), 4),
        ))
    remaining = max(0, max_requirements - len(impacted_requirements))
    for req, score in scored[:remaining]:
        impacted_requirements.append(ImpactItem(
            type="requirement", id=req.id,
            key=req.requirement_id or f"REQ-{req.id}",
            title=_req_clean(req.title), reason="similar", score=round(score, 4),
        ))

    impacted_req_ids = [item.id for item in impacted_requirements]
    # How each impacted requirement reached the doc, so we can propagate that
    # confidence down to its tests/defects rather than calling everything "linked".
    req_reason_by_id = {item.id: item.reason for item in impacted_requirements}
    req_key_by_id = {item.id: item.key for item in impacted_requirements}

    # Requirements → test cases (traceability matrix + association + legacy refs).
    test_cases = _project_test_cases(db, project_id)
    tc_by_id = {tc.id: tc for tc in test_cases}
    project_tc_ids = list(tc_by_id.keys())
    linked_tc_map = get_linked_requirement_test_case_ids(db, impacted_req_ids, project_tc_ids)
    impacted_reqs = [req_by_id[i] for i in impacted_req_ids if i in req_by_id]
    add_legacy_reference_links(linked_tc_map, impacted_reqs, test_cases)
    covered_req_ids = {rid for rid, ids in linked_tc_map.items() if ids}

    # Invert requirement→test-case to find each test case's parent requirement(s).
    tc_parent_reqs: dict[int, set[int]] = {}
    for rid, tc_ids in linked_tc_map.items():
        for tc_id in tc_ids:
            tc_parent_reqs.setdefault(tc_id, set()).add(rid)
    impacted_tc_ids = set(tc_parent_reqs.keys())

    def _provenance(req_ids: set[int]) -> tuple[str, List[str]]:
        """Derive a (reason, via-keys) pair from the parent requirements: a child
        is only as strong as its strongest parent — ``linked`` if any parent is
        directly linked to the doc, otherwise ``similar``."""
        reason = "linked" if any(req_reason_by_id.get(r) == "linked" for r in req_ids) else "similar"
        via = sorted(req_key_by_id[r] for r in req_ids if r in req_key_by_id)
        return reason, via

    impacted_test_cases: List[ImpactItem] = []
    for tc_id in sorted(impacted_tc_ids):
        tc = tc_by_id.get(tc_id)
        if tc is None:
            continue
        reason, via = _provenance(tc_parent_reqs.get(tc_id, set()))
        impacted_test_cases.append(ImpactItem(
            type="test_case", id=tc.id,
            # The test case's own identifier — NOT ``tc.reference``, which in this
            # schema is a free-text field that often holds the requirement code.
            key=f"TC-{tc.id}",
            title=tc.title or "", reason=reason, via=via,
        ))

    # Requirements / test cases → defects.
    impacted_defects: List[ImpactItem] = []
    open_defects = 0
    high_severity_defects = 0
    if impacted_req_ids or impacted_tc_ids:
        defect_filters = []
        if impacted_req_ids:
            defect_filters.append(models.Defect.requirement_id.in_(impacted_req_ids))
        if impacted_tc_ids:
            defect_filters.append(models.Defect.test_case_id.in_(list(impacted_tc_ids)))
        defects = (
            db.query(models.Defect)
            .filter(models.Defect.project_id == project_id, or_(*defect_filters))
            .all()
        )
        for d in defects:
            status = getattr(d.status, "value", d.status)
            severity = getattr(d.severity, "value", d.severity)
            is_open = d.status in _OPEN_DEFECT_STATUSES
            if is_open:
                open_defects += 1
            if severity in ("high", "critical") and is_open:
                high_severity_defects += 1
            # A defect traces to the doc through its requirement and/or its test
            # case's requirement(s); inherit the strongest of those.
            parent_reqs: set[int] = set()
            if d.requirement_id in req_reason_by_id:
                parent_reqs.add(d.requirement_id)
            parent_reqs.update(tc_parent_reqs.get(d.test_case_id, set()))
            reason, via = _provenance(parent_reqs)
            impacted_defects.append(ImpactItem(
                type="defect", id=d.id, key=d.defect_id or f"DEF-{d.id}",
                title=d.title or "", reason=reason,
                status=status, severity=severity, is_open=is_open, via=via,
            ))
        # Open + high-severity first, so the most actionable defects lead.
        impacted_defects.sort(key=lambda i: (not i.is_open, i.severity != "critical", i.severity != "high"))

    uncovered = sum(1 for rid in impacted_req_ids if rid not in covered_req_ids)
    risk_signals = RiskSignals(
        impacted_requirements=len(impacted_requirements),
        impacted_test_cases=len(impacted_test_cases),
        impacted_defects=len(impacted_defects),
        open_defects=open_defects,
        high_severity_defects=high_severity_defects,
        uncovered_requirements=uncovered,
    )

    return DocImpactGraph(
        requirements=impacted_requirements,
        test_cases=impacted_test_cases,
        defects=impacted_defects,
        change_summary=change_summary,
        risk_signals=risk_signals,
    )
