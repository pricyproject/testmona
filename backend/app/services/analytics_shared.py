"""Shared analytics, coverage, and traceability helpers."""

import re
from datetime import datetime
from typing import Any, Iterable

from sqlalchemy.orm import Session

from .. import models


def normalize_result_status(status: str | None) -> str:
    status_map = {
        "pass": "passed",
        "passed": "passed",
        "fail": "failed",
        "failed": "failed",
        "block": "blocked",
        "blocked": "blocked",
        "skip": "skipped",
        "skipped": "skipped",
        "not_started": "not_started",
    }
    normalized = str(status or "").strip().lower()
    return status_map.get(normalized, normalized)


def enum_value(value: Any) -> Any:
    return getattr(value, "value", value)


def get_reference_tokens(value: str | None) -> list[str]:
    raw_value = str(value or "")
    tokens = [
        token.strip("()[]{}\"'.,").lower()
        for token in re.split(r"[\s,;|]+", raw_value)
        if token.strip("()[]{}\"'.,")
    ]
    tokens.extend(token.lower() for token in re.findall(r"[a-z]+-\d+", raw_value, flags=re.IGNORECASE))
    return list(dict.fromkeys(tokens))


def add_legacy_reference_links(linked_test_case_ids: dict[int, set[int]], requirements: list, test_cases: list) -> None:
    for requirement in requirements:
        requirement_id = getattr(requirement, "id", None)
        requirement_key = str(getattr(requirement, "requirement_id", None) or "").lower()
        if requirement_id is None:
            continue
        if not requirement_key:
            continue
        for test_case in test_cases:
            test_case_id = getattr(test_case, "id", None)
            if test_case_id is None:
                continue
            if requirement_key in get_reference_tokens(getattr(test_case, "reference", None)):
                linked_test_case_ids.setdefault(requirement_id, set()).add(test_case_id)


def _unique_ids(ids: Iterable[int | None]) -> list[int]:
    return list(dict.fromkeys(value for value in ids if value is not None))


def _datetime_sort_value(value: Any) -> float:
    if value is None:
        return 0.0
    if hasattr(value, "timestamp"):
        return float(value.timestamp())
    return 0.0


def _result_sort_key(result: Any) -> tuple[float, float, int]:
    return (
        _datetime_sort_value(getattr(result, "executed_at", None)),
        _datetime_sort_value(getattr(result, "created_at", None)),
        int(getattr(result, "id", 0) or 0),
    )


def get_linked_requirement_test_case_ids(db: Session, requirement_ids: list[int], project_test_case_ids: list[int]) -> dict[int, set[int]]:
    requirement_ids = _unique_ids(requirement_ids)
    project_test_case_ids = _unique_ids(project_test_case_ids)
    linked_test_case_ids = {requirement_id: set() for requirement_id in requirement_ids}
    if not requirement_ids or not project_test_case_ids:
        return linked_test_case_ids

    traceability_rows = db.query(
        models.TraceabilityMatrix.requirement_id,
        models.TraceabilityMatrix.test_case_id,
    ).filter(
        models.TraceabilityMatrix.requirement_id.in_(requirement_ids),
        models.TraceabilityMatrix.test_case_id.in_(project_test_case_ids),
    ).all()
    association_rows = db.query(
        models.requirement_test_case_links.c.requirement_id,
        models.requirement_test_case_links.c.test_case_id,
    ).filter(
        models.requirement_test_case_links.c.requirement_id.in_(requirement_ids),
        models.requirement_test_case_links.c.test_case_id.in_(project_test_case_ids),
    ).all()

    for requirement_id, test_case_id in traceability_rows + association_rows:
        linked_test_case_ids.setdefault(requirement_id, set()).add(test_case_id)

    return linked_test_case_ids


def build_coverage_report(db: Session, project_id: int, generated: bool = False) -> dict[str, Any]:
    from ..models import TestCase, TestSuite, TestResult, TestRun, Requirement

    test_suite_ids = _unique_ids(row.id for row in db.query(TestSuite.id).filter(TestSuite.project_id == project_id).all())
    test_cases_query = db.query(TestCase).filter(TestCase.test_suite_id.in_(test_suite_ids), TestCase.is_deleted == False)
    test_cases = test_cases_query.all() if test_suite_ids else []
    test_case_ids = _unique_ids(test_case.id for test_case in test_cases)
    total_test_cases = len(test_cases)

    test_run_ids = _unique_ids(row.id for row in db.query(TestRun.id).filter(TestRun.project_id == project_id).all())
    test_results = db.query(TestResult).filter(TestResult.test_run_id.in_(test_run_ids)).all() if test_run_ids else []
    latest_by_test_case: dict[int, Any] = {}
    for result in test_results:
        test_case_id = getattr(result, "test_case_id", None)
        if test_case_id is None:
            continue
        current = latest_by_test_case.get(test_case_id)
        if current is None or _result_sort_key(result) > _result_sort_key(current):
            latest_by_test_case[test_case_id] = result

    normalized_statuses = [normalize_result_status(result.status) for result in latest_by_test_case.values()]
    executed_statuses = {"passed", "failed", "blocked", "skipped"}
    executed_test_cases = len([status for status in normalized_statuses if status in executed_statuses])
    passed_test_cases = normalized_statuses.count("passed")
    failed_test_cases = normalized_statuses.count("failed")
    blocked_test_cases = normalized_statuses.count("blocked")
    skipped_test_cases = normalized_statuses.count("skipped")
    not_started_cases = max(total_test_cases - executed_test_cases, 0)

    blocker_reason_counts: dict[str, int] = {}
    for result in latest_by_test_case.values():
        if normalize_result_status(result.status) != "blocked":
            continue
        reason = (getattr(result, "blocker_reason", None) or "unspecified").strip().lower() or "unspecified"
        blocker_reason_counts[reason] = blocker_reason_counts.get(reason, 0) + 1

    requirements = db.query(Requirement).filter(Requirement.project_id == project_id).all()
    total_requirements = len(requirements)
    requirement_ids = _unique_ids(requirement.id for requirement in requirements)
    linked_test_case_ids = get_linked_requirement_test_case_ids(db, requirement_ids, test_case_ids)
    add_legacy_reference_links(linked_test_case_ids, requirements, test_cases)
    covered_requirements = len([requirement_id for requirement_id, linked_ids in linked_test_case_ids.items() if linked_ids])
    coverage_percentage = (covered_requirements / total_requirements * 100) if total_requirements else 0

    linked_requirement_ids = {requirement_id for requirement_id, linked_ids in linked_test_case_ids.items() if linked_ids}
    priority_order = ["critical", "high", "medium", "low"]
    present_priorities = []
    for requirement in requirements:
        name = str(enum_value(requirement.priority) or "").strip().lower()
        if name and name not in present_priorities:
            present_priorities.append(name)
    priority_names = sorted(
        present_priorities,
        key=lambda name: priority_order.index(name) if name in priority_order else len(priority_order),
    ) or priority_order
    priority_coverage = {}
    for priority_name in priority_names:
        priority_requirements = [
            requirement for requirement in requirements
            if str(enum_value(requirement.priority) or "").strip().lower() == priority_name
        ]
        covered_priority = len([
            requirement for requirement in priority_requirements
            if requirement.id in linked_requirement_ids
        ])
        total_priority = len(priority_requirements)
        priority_coverage[priority_name] = {
            "coverage": round((covered_priority / total_priority) * 100, 2) if total_priority else 0,
            "covered": covered_priority,
            "total": total_priority,
        }

    return {
        "id": f"COV-{datetime.now().strftime('%Y%m%d%H%M%S')}" if generated else "COV-DYNAMIC",
        "title": f"Coverage Report - {datetime.now().strftime('%Y-%m-%d')}" if generated else "Current Coverage Report",
        "generated_at": datetime.now().isoformat(),
        "coverage_percentage": round(coverage_percentage, 2),
        "total_requirements": total_requirements,
        "covered_requirements": covered_requirements,
        "test_cases_count": total_test_cases,
        "executed_tests": executed_test_cases,
        "report_data": {
            "by_priority": priority_coverage,
            "by_status": {
                "passed": round((passed_test_cases / executed_test_cases * 100) if executed_test_cases else 0, 2),
                "failed": round((failed_test_cases / executed_test_cases * 100) if executed_test_cases else 0, 2),
                "blocked": round((blocked_test_cases / executed_test_cases * 100) if executed_test_cases else 0, 2),
                "skipped": round((skipped_test_cases / executed_test_cases * 100) if executed_test_cases else 0, 2),
                "not_started": round((not_started_cases / total_test_cases * 100) if total_test_cases else 0, 2),
            },
            "blocked_count": blocked_test_cases,
            "blocker_reasons": blocker_reason_counts,
        },
    }
