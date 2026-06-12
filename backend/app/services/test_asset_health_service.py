import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Dict, Iterable, Optional

from sqlalchemy import case, distinct, func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from ..config import settings
from ..models import (
    Requirement,
    TestCase,
    TestDebtItem,
    TestResult,
    TestSuite,
    TraceabilityMatrix,
    canonical_result_status,
    requirement_test_case_links,
)

logger = logging.getLogger(__name__)

DEBT_CONFIG = {
    "stale": {"severity": "medium", "suggested_action": "update"},
    "duplicate": {"severity": "high", "suggested_action": "merge"},
    "orphan": {"severity": "critical", "suggested_action": "archive"},
    "always_pass": {"severity": "low", "suggested_action": "review"},
    "never_run": {"severity": "high", "suggested_action": "archive"},
    "no_requirement_link": {"severity": "medium", "suggested_action": "link_req"},
}

REFERENCE_TOKEN_PATTERN = re.compile(r"^[a-z][a-z0-9]*-\d+$", flags=re.IGNORECASE)

# Relative weights used to turn a raw debt count into a severity-aware
# "health score". A single critical item hurts the score far more than a
# handful of low ones, which keeps the headline number honest.
SEVERITY_WEIGHTS = {"critical": 10, "high": 5, "medium": 2, "low": 1}
_MAX_SEVERITY_WEIGHT = max(SEVERITY_WEIGHTS.values())


def _compute_health_score(total_cases: int, by_severity: Dict[str, int]) -> int:
    """Return a 0-100 score: 100 means a pristine library, 0 means everything rotten.

    The penalty is the severity-weighted active-debt total normalised against the
    worst plausible case (every test case carrying a critical item), so the score
    scales sensibly whether a project has 10 cases or 10,000.
    """
    if total_cases <= 0:
        return 100
    penalty = sum(SEVERITY_WEIGHTS.get(sev, 1) * count for sev, count in by_severity.items())
    worst = total_cases * _MAX_SEVERITY_WEIGHT
    score = 100.0 * (1.0 - penalty / worst) if worst else 100.0
    return max(0, min(100, round(score)))


@dataclass(frozen=True)
class DebtCandidate:
    test_case_id: int
    debt_type: str
    severity: str
    suggested_action: str
    details: str


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _as_aware(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _case_changed_at(test_case: TestCase) -> datetime:
    return _as_aware(test_case.updated_at or test_case.created_at) or _utc_now()


def _reference_tokens(value: Optional[str]) -> set[str]:
    tokens: set[str] = set()
    for token in re.split(r"[\s,;|]+", value or ""):
        cleaned = token.strip("()[]{}\"'.,").lower()
        if cleaned and REFERENCE_TOKEN_PATTERN.match(cleaned):
            tokens.add(cleaned)
    return tokens


def _candidate(test_case_id: int, debt_type: str, details: str) -> DebtCandidate:
    config = DEBT_CONFIG[debt_type]
    return DebtCandidate(
        test_case_id=test_case_id,
        debt_type=debt_type,
        severity=config["severity"],
        suggested_action=config["suggested_action"],
        details=details,
    )


def _active_case_query(db: Session, project_id: int):
    return db.query(TestCase).outerjoin(TestSuite, TestCase.test_suite_id == TestSuite.id).filter(
        or_(TestCase.project_id == project_id, TestSuite.project_id == project_id),
        or_(TestCase.is_deleted.is_(None), TestCase.is_deleted.is_(False)),
    )


def get_test_debt_item(db: Session, project_id: int, item_id: int) -> Optional[TestDebtItem]:
    return db.query(TestDebtItem).options(joinedload(TestDebtItem.test_case)).filter(
        TestDebtItem.id == item_id,
        TestDebtItem.project_id == project_id,
    ).first()


def list_test_debt_items(
    db: Session,
    *,
    project_id: int,
    debt_type: Optional[str] = None,
    severity: Optional[str] = None,
    resolved: str = "active",
    skip: int = 0,
    limit: int = 100,
) -> tuple[list[TestDebtItem], int]:
    query = db.query(TestDebtItem).options(joinedload(TestDebtItem.test_case)).filter(TestDebtItem.project_id == project_id)
    if debt_type:
        query = query.filter(TestDebtItem.debt_type == debt_type)
    if severity:
        query = query.filter(TestDebtItem.severity == severity)
    if resolved == "active":
        query = query.filter(TestDebtItem.resolved_at.is_(None))
    elif resolved == "resolved":
        query = query.filter(TestDebtItem.resolved_at.is_not(None))
    total = query.count()
    severity_rank = case(
        (TestDebtItem.severity == "critical", 0),
        (TestDebtItem.severity == "high", 1),
        (TestDebtItem.severity == "medium", 2),
        (TestDebtItem.severity == "low", 3),
        else_=4,
    )
    items = query.order_by(
        TestDebtItem.resolved_at.is_not(None),
        severity_rank,
        TestDebtItem.created_at.desc(),
        TestDebtItem.id.desc(),
    ).offset(skip).limit(limit).all()
    return items, total


def get_health_summary(db: Session, project_id: int) -> dict:
    total_cases = _active_case_query(db, project_id).count()

    # One grouped pass yields every active-debt breakdown we need
    # (by type, severity, and suggested action) instead of three round-trips.
    active_rows = db.query(
        TestDebtItem.debt_type,
        TestDebtItem.severity,
        TestDebtItem.suggested_action,
        func.count(TestDebtItem.id),
    ).filter(
        TestDebtItem.project_id == project_id,
        TestDebtItem.resolved_at.is_(None),
    ).group_by(
        TestDebtItem.debt_type,
        TestDebtItem.severity,
        TestDebtItem.suggested_action,
    ).all()

    affected_cases = db.query(func.count(distinct(TestDebtItem.test_case_id))).filter(
        TestDebtItem.project_id == project_id,
        TestDebtItem.resolved_at.is_(None),
    ).scalar() or 0

    resolved_count = db.query(func.count(TestDebtItem.id)).filter(
        TestDebtItem.project_id == project_id,
        TestDebtItem.resolved_at.is_not(None),
    ).scalar() or 0

    last_detected_at = db.query(
        func.max(func.coalesce(TestDebtItem.updated_at, TestDebtItem.created_at))
    ).filter(
        TestDebtItem.project_id == project_id,
        TestDebtItem.auto_detected.is_(True),
    ).scalar()

    by_debt_type: Dict[str, int] = {}
    by_severity: Dict[str, int] = {}
    by_action: Dict[str, int] = {}
    active_count = 0
    for debt_type, severity, suggested_action, count in active_rows:
        count_value = int(count or 0)
        active_count += count_value
        by_debt_type[debt_type] = by_debt_type.get(debt_type, 0) + count_value
        by_severity[severity] = by_severity.get(severity, 0) + count_value
        by_action[suggested_action] = by_action.get(suggested_action, 0) + count_value

    return {
        "total_cases": total_cases,
        "active_debt_items": active_count,
        "resolved_debt_items": int(resolved_count),
        "affected_cases": int(affected_cases),
        "healthy_cases": max(0, total_cases - int(affected_cases)),
        "health_score": _compute_health_score(total_cases, by_severity),
        "by_debt_type": by_debt_type,
        "by_severity": by_severity,
        "by_action": by_action,
        "last_detected_at": _as_aware(last_detected_at),
    }


def create_test_debt_item(db: Session, *, project_id: int, payload) -> TestDebtItem:
    test_case = _active_case_query(db, project_id).filter(TestCase.id == payload.test_case_id).first()
    if test_case is None:
        raise ValueError("Test case not found in this project")

    item = TestDebtItem(
        project_id=project_id,
        test_case_id=payload.test_case_id,
        debt_type=payload.debt_type,
        severity=payload.severity,
        suggested_action=payload.suggested_action,
        details=payload.details,
        auto_detected=False,
    )
    db.add(item)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ValueError("A debt item of this type already exists for the test case") from exc
    db.refresh(item)
    return item


def update_test_debt_item(db: Session, item: TestDebtItem, payload) -> TestDebtItem:
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, key, value)
    db.commit()
    db.refresh(item)
    return item


def resolve_test_debt_item(db: Session, item: TestDebtItem) -> TestDebtItem:
    item.resolved_at = _utc_now()
    db.commit()
    db.refresh(item)
    return item


def bulk_resolve_test_debt_items(db: Session, project_id: int, item_ids: Iterable[int]) -> int:
    """Resolve many active debt items in a single statement and return the count touched."""
    ids = {int(item_id) for item_id in item_ids}
    if not ids:
        return 0
    resolved = (
        db.query(TestDebtItem)
        .filter(
            TestDebtItem.project_id == project_id,
            TestDebtItem.id.in_(ids),
            TestDebtItem.resolved_at.is_(None),
        )
        .update({TestDebtItem.resolved_at: _utc_now()}, synchronize_session=False)
    )
    db.commit()
    return int(resolved or 0)


def _detect_duplicate_cases(cases: Iterable[TestCase], now: datetime) -> list[DebtCandidate]:
    duplicate_cutoff = now - timedelta(days=max(0, settings.test_asset_duplicate_grace_days))
    titles: Dict[str, list[TestCase]] = {}
    for test_case in cases:
        created_at = _as_aware(test_case.created_at)
        if created_at is not None and created_at > duplicate_cutoff:
            continue
        normalized = " ".join((test_case.title or "").strip().lower().split())
        if normalized:
            titles.setdefault(normalized, []).append(test_case)

    candidates: list[DebtCandidate] = []
    for duplicates in titles.values():
        if len(duplicates) < 2:
            continue
        case_refs = ", ".join(str(case.project_seq or case.id) for case in duplicates)
        for test_case in duplicates:
            candidates.append(_candidate(test_case.id, "duplicate", f"Similar title appears in cases {case_refs}. New cases are given a {settings.test_asset_duplicate_grace_days}-day grace period before duplicate debt is opened."))
    return candidates


def _detect_requirement_links(db: Session, project_id: int, cases: list[TestCase]) -> list[DebtCandidate]:
    case_ids = [case.id for case in cases]
    if not case_ids:
        return []

    linked_case_ids = {
        row[0]
        for row in db.query(requirement_test_case_links.c.test_case_id)
        .join(Requirement, requirement_test_case_links.c.requirement_id == Requirement.id)
        .filter(requirement_test_case_links.c.test_case_id.in_(case_ids))
        .filter(Requirement.project_id == project_id)
        .all()
    }
    linked_case_ids.update(
        row[0]
        for row in db.query(TraceabilityMatrix.test_case_id)
        .join(Requirement, TraceabilityMatrix.requirement_id == Requirement.id)
        .filter(TraceabilityMatrix.test_case_id.in_(case_ids))
        .filter(Requirement.project_id == project_id)
        .all()
    )

    requirement_tokens = {
        row[0]
        for row in db.query(func.lower(Requirement.requirement_id))
        .filter(Requirement.project_id == project_id)
        .all()
        if row[0]
    }

    candidates: list[DebtCandidate] = []
    for test_case in cases:
        if test_case.id in linked_case_ids:
            continue
        if _reference_tokens(test_case.reference) & requirement_tokens:
            continue
        candidates.append(_candidate(test_case.id, "no_requirement_link", "No requirement link, traceability entry, or matching requirement reference was found."))
    return candidates


def _detect_execution_debt(db: Session, case_ids: list[int]) -> tuple[list[DebtCandidate], dict[int, datetime]]:
    if not case_ids:
        return [], {}

    rows = db.query(
        TestResult.test_case_id,
        TestResult.status,
        func.count(TestResult.id),
        func.max(TestResult.executed_at),
    ).filter(TestResult.test_case_id.in_(case_ids)).group_by(TestResult.test_case_id, TestResult.status).all()

    stats: dict[int, dict[str, int]] = {case_id: {} for case_id in case_ids}
    last_executed_at: dict[int, datetime] = {}
    for test_case_id, raw_status, count, executed_at in rows:
        status = canonical_result_status(raw_status)
        stats.setdefault(test_case_id, {})[status] = stats.setdefault(test_case_id, {}).get(status, 0) + int(count or 0)
        aware_executed_at = _as_aware(executed_at) if status != "not_started" else None
        if aware_executed_at and (test_case_id not in last_executed_at or aware_executed_at > last_executed_at[test_case_id]):
            last_executed_at[test_case_id] = aware_executed_at

    candidates: list[DebtCandidate] = []
    min_results = max(1, settings.test_asset_always_pass_min_results)
    for test_case_id, status_counts in stats.items():
        completed_total = sum(count for status, count in status_counts.items() if status != "not_started")
        if completed_total == 0:
            candidates.append(_candidate(test_case_id, "never_run", "No completed execution result exists for this test case."))
            continue
        pass_count = status_counts.get("pass", 0)
        if completed_total >= min_results and pass_count == completed_total:
            candidates.append(_candidate(test_case_id, "always_pass", f"The last {completed_total} completed results all passed."))

    return candidates, last_executed_at


def detect_test_asset_debt(db: Session, project_id: int, retry_on_integrity: bool = True) -> dict:
    now = _utc_now()
    stale_cutoff = now - timedelta(days=max(1, settings.test_asset_stale_days))
    cases = _active_case_query(db, project_id).all()
    case_ids = [case.id for case in cases]

    candidates: dict[tuple[int, str], DebtCandidate] = {}
    execution_candidates, last_executed_at = _detect_execution_debt(db, case_ids)
    for candidate in execution_candidates:
        candidates[(candidate.test_case_id, candidate.debt_type)] = candidate

    for candidate in _detect_duplicate_cases(cases, now):
        candidates[(candidate.test_case_id, candidate.debt_type)] = candidate

    for candidate in _detect_requirement_links(db, project_id, cases):
        candidates[(candidate.test_case_id, candidate.debt_type)] = candidate


    suite_ids = {case.test_suite_id for case in cases if case.test_suite_id is not None}
    existing_suite_ids = {row[0] for row in db.query(TestSuite.id).filter(TestSuite.id.in_(suite_ids)).all()} if suite_ids else set()
    for test_case in cases:
        if test_case.test_suite_id not in existing_suite_ids:
            candidate = _candidate(test_case.id, "orphan", "The linked test suite is missing or inaccessible.")
            candidates[(candidate.test_case_id, candidate.debt_type)] = candidate

        last_content_change = _case_changed_at(test_case)
        last_execution = last_executed_at.get(test_case.id)
        if last_content_change < stale_cutoff and (last_execution is None or last_execution < stale_cutoff):
            candidate = _candidate(test_case.id, "stale", f"No test case update or execution in the last {settings.test_asset_stale_days} days.")
            candidates[(candidate.test_case_id, candidate.debt_type)] = candidate

    existing_items = db.query(TestDebtItem).filter(TestDebtItem.project_id == project_id).all()
    existing_by_key = {(item.test_case_id, item.debt_type): item for item in existing_items}

    created = 0
    updated = 0
    for key, candidate in candidates.items():
        item = existing_by_key.get(key)
        if item is None:
            db.add(TestDebtItem(
                project_id=project_id,
                test_case_id=candidate.test_case_id,
                debt_type=candidate.debt_type,
                severity=candidate.severity,
                suggested_action=candidate.suggested_action,
                details=candidate.details,
                auto_detected=True,
                resolved_at=None,
            ))
            created += 1
            continue
        if not item.auto_detected:
            if item.resolved_at is not None:
                item.resolved_at = None
                updated += 1
            continue
        if (
            item.severity != candidate.severity
            or item.suggested_action != candidate.suggested_action
            or item.details != candidate.details
            or item.resolved_at is not None
        ):
            item.severity = candidate.severity
            item.suggested_action = candidate.suggested_action
            item.details = candidate.details
            item.resolved_at = None
            updated += 1

    auto_resolved = 0
    for key, item in existing_by_key.items():
        if item.auto_detected and key not in candidates and item.resolved_at is None:
            item.resolved_at = now
            auto_resolved += 1

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        if not retry_on_integrity:
            raise
        logger.warning("Retrying test asset debt detection after concurrent write", extra={"project_id": project_id})
        return detect_test_asset_debt(db, project_id, retry_on_integrity=False)
    logger.info(
        "Detected test asset debt",
        extra={
            "project_id": project_id,
            "debt_created": created,
            "debt_updated": updated,
            "debt_auto_resolved": auto_resolved,
        },
    )
    summary = get_health_summary(db, project_id)
    return {
        "created": created,
        "updated": updated,
        "auto_resolved": auto_resolved,
        "active_debt_items": summary["active_debt_items"],
        "summary": summary,
    }
