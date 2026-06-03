"""Lightweight lexical retrieval over a project's requirements.

The platform has no embeddings/vector store (see ``similarity_service`` — the
matching layer is deliberately dependency-free), and ``generate_ai_completion``
caps the prompt at 12k chars. So to answer a question "across all docs" we
score every requirement against the question with token-overlap, then greedily
pack the most relevant ones into a character budget. Returns the selected
requirements plus whether anything had to be dropped.
"""

import html
import logging
from dataclasses import dataclass
from typing import Any, List, Optional

from .. import crud
from .ai_prompt_service import strip_html
from .similarity_service import normalize_text

logger = logging.getLogger(__name__)


@dataclass
class RetrievedRequirement:
    requirement: Any
    score: float


@dataclass
class RetrievalResult:
    selected: List[Any]
    considered: int
    truncated: bool


def _tokens(text: str) -> set[str]:
    return set(normalize_text(text).split())


def _clean(value: Any) -> str:
    # Stored content is HTML-escaped; unescape entities then strip tags so the
    # ranking sees real words, not noise tokens like "lt"/"gt"/"p".
    if not value:
        return ""
    return strip_html(html.unescape(str(value)))


def _searchable_blob(requirement: Any) -> str:
    parts = [
        requirement.requirement_id or "",
        _clean(requirement.title),
        _clean(requirement.description),
        _clean(requirement.acceptance_criteria),
        requirement.tags or "",
    ]
    return " ".join(part for part in parts if part)


def _score(query_tokens: set[str], doc_tokens: set[str]) -> float:
    """Overlap coefficient (intersection / query size). Better than Jaccard for
    retrieval because a short question shouldn't be penalised by a long doc."""
    if not query_tokens or not doc_tokens:
        return 0.0
    overlap = len(query_tokens & doc_tokens)
    if not overlap:
        return 0.0
    return overlap / len(query_tokens)


def _load_all_requirements(db, project_id: int, hard_cap: int = 2000) -> List[Any]:
    """Page through every requirement in the project (crud caps each call)."""
    collected: List[Any] = []
    page_size = 200
    skip = 0
    while len(collected) < hard_cap:
        page = crud.get_requirements(db, project_id=project_id, skip=skip, limit=page_size)
        if not page:
            break
        collected.extend(page)
        if len(page) < page_size:
            break
        skip += page_size
    return collected


def retrieve_relevant_requirements(
    db,
    project_id: int,
    query: str,
    char_budget: int = 9000,
    extra_context: Optional[str] = None,
    max_requirements: Optional[int] = None,
) -> RetrievalResult:
    """Rank project requirements against ``query`` (and any ``extra_context``
    such as the previous user turn) and greedily select until ``char_budget``
    of searchable text — or ``max_requirements`` rows — is reached."""
    requirements = _load_all_requirements(db, project_id)
    considered = len(requirements)
    if not requirements:
        return RetrievalResult(selected=[], considered=0, truncated=False)

    query_tokens = _tokens(f"{query} {extra_context or ''}")
    scored: List[RetrievedRequirement] = []
    for req in requirements:
        score = _score(query_tokens, _tokens(_searchable_blob(req)))
        scored.append(RetrievedRequirement(requirement=req, score=score))

    # If nothing matched lexically (e.g. "summarize the project"), fall back to
    # recency so the model still gets representative context to work with.
    if all(item.score == 0.0 for item in scored):
        scored.sort(key=lambda item: item.requirement.id, reverse=True)
    else:
        scored.sort(key=lambda item: item.score, reverse=True)

    cap = max_requirements if (max_requirements and max_requirements > 0) else len(scored)
    selected: List[Any] = []
    used = 0
    for item in scored:
        if len(selected) >= cap:
            break
        blob_len = len(_searchable_blob(item.requirement))
        # Always admit the single best match even if it alone exceeds the
        # budget, so a large lone requirement is never silently dropped.
        if selected and used + blob_len > char_budget:
            break
        selected.append(item.requirement)
        used += blob_len

    return RetrievalResult(
        selected=selected,
        considered=considered,
        truncated=len(selected) < considered,
    )


# --- Generic multi-type retrieval (requirements/defects/test plans/test cases)

SOURCE_TYPES = ("requirements", "defects", "test_plans", "test_cases")
_PER_TYPE_HARD_CAP = 1500


@dataclass
class RetrievedDoc:
    type: str          # singular: requirement | defect | test_plan | test_case
    id: int
    key: str
    title: str
    content: str       # full plain text used for both ranking and packing
    score: float = 0.0


@dataclass
class DocRetrievalResult:
    selected: List["RetrievedDoc"]
    considered: int
    truncated: bool
    source_counts: dict[str, int]
    selected_counts: dict[str, int]
    best_score: float = 0.0


def _join(*parts: Any) -> str:
    return " ".join(p for p in (_clean(x) for x in parts) if p)


def _load_requirement_docs(db, project_id: int) -> List[RetrievedDoc]:
    docs = []
    for r in crud.get_requirements(db, project_id=project_id, skip=0, limit=_PER_TYPE_HARD_CAP):
        docs.append(RetrievedDoc(
            type="requirement", id=r.id, key=r.requirement_id or f"REQ-{r.id}",
            title=_clean(r.title),
            content=_join(r.requirement_id, r.title, r.description, r.acceptance_criteria, r.tags),
        ))
    return docs


def _load_defect_docs(db, project_id: int) -> List[RetrievedDoc]:
    docs = []
    for d in crud.get_defects(db, project_id=project_id, skip=0, limit=_PER_TYPE_HARD_CAP):
        docs.append(RetrievedDoc(
            type="defect", id=d.id, key=d.defect_id or f"DEF-{d.id}",
            title=_clean(d.title),
            content=_join(d.defect_id, d.title, d.description, d.steps_to_reproduce,
                          d.expected_result, d.actual_result, d.root_cause, d.resolution,
                          getattr(d.status, "value", d.status), getattr(d.severity, "value", d.severity)),
        ))
    return docs


def _load_test_plan_docs(db, project_id: int) -> List[RetrievedDoc]:
    docs = []
    for p in crud.get_test_plans(db, project_id=project_id, skip=0, limit=_PER_TYPE_HARD_CAP):
        docs.append(RetrievedDoc(
            type="test_plan", id=p.id, key=f"PLAN-{p.id}",
            title=_clean(p.title),
            content=_join(p.title, p.description, p.test_objectives, p.scope_inclusions,
                          p.scope_exclusions, p.entry_criteria, p.exit_criteria, p.risks_assumptions),
        ))
    return docs


def _load_test_case_docs(db, project_id: int) -> List[RetrievedDoc]:
    # Test cases are scoped to a project via their suite; query directly.
    from ..models import TestCase, TestSuite
    rows = (
        db.query(TestCase)
        .join(TestSuite, TestCase.test_suite_id == TestSuite.id)
        .filter(
            TestSuite.project_id == project_id,
            ((TestCase.is_deleted.is_(None)) | (TestCase.is_deleted.is_(False))),
        )
        .limit(_PER_TYPE_HARD_CAP)
        .all()
    )
    return [
        RetrievedDoc(
            type="test_case", id=tc.id, key=tc.reference or f"TC-{tc.id}",
            title=_clean(tc.title),
            content=_join(tc.reference, tc.title, tc.description, tc.preconditions,
                          tc.steps, tc.expected_result, tc.tags),
        )
        for tc in rows
    ]


_LOADERS = {
    "requirements": _load_requirement_docs,
    "defects": _load_defect_docs,
    "test_plans": _load_test_plan_docs,
    "test_cases": _load_test_case_docs,
}


def retrieve_relevant_docs(
    db,
    project_id: int,
    query: str,
    source_types: List[str],
    char_budget: int = 9000,
    max_docs: Optional[int] = None,
    extra_context: Optional[str] = None,
) -> DocRetrievalResult:
    """Rank docs across the requested ``source_types`` by token-overlap with the
    query and greedily select within ``char_budget`` / ``max_docs``."""
    types = [t for t in (source_types or []) if t in _LOADERS] or ["requirements"]
    candidates: List[RetrievedDoc] = []
    source_counts = {t: 0 for t in SOURCE_TYPES}
    for t in types:
        try:
            loaded = _LOADERS[t](db, project_id)
            source_counts[t] = len(loaded)
            candidates.extend(loaded)
        except Exception:  # a single type's loader must not break the whole answer
            logger.warning("Source loader for %r failed in project %s", t, project_id, exc_info=True)
            continue

    considered = len(candidates)
    if not candidates:
        return DocRetrievalResult(
            selected=[],
            considered=0,
            truncated=False,
            source_counts=source_counts,
            selected_counts={t: 0 for t in SOURCE_TYPES},
            best_score=0.0,
        )

    query_tokens = _tokens(f"{query} {extra_context or ''}")
    for doc in candidates:
        doc.score = _score(query_tokens, _tokens(doc.content))
    best_score = max((doc.score for doc in candidates), default=0.0)

    if all(doc.score == 0.0 for doc in candidates):
        candidates.sort(key=lambda d: d.id, reverse=True)  # recency fallback
    else:
        candidates.sort(key=lambda d: d.score, reverse=True)

    cap = max_docs if (max_docs and max_docs > 0) else len(candidates)
    selected: List[RetrievedDoc] = []
    used = 0
    for doc in candidates:
        if len(selected) >= cap:
            break
        if selected and used + len(doc.content) > char_budget:
            break
        selected.append(doc)
        used += len(doc.content)

    selected_counts = {t: 0 for t in SOURCE_TYPES}
    plural_type = {"requirement": "requirements", "defect": "defects", "test_plan": "test_plans", "test_case": "test_cases"}
    for doc in selected:
        selected_counts[plural_type.get(doc.type, doc.type)] = selected_counts.get(plural_type.get(doc.type, doc.type), 0) + 1

    return DocRetrievalResult(
        selected=selected,
        considered=considered,
        truncated=len(selected) < considered,
        source_counts=source_counts,
        selected_counts=selected_counts,
        best_score=best_score,
    )
