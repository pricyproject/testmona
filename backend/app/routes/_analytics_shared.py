"""
Shared helpers for the analytics, coverage, and traceability routes.

These were previously defined inline inside ``register_remaining_routes`` and are
used by both ``analytics_dashboard`` and ``traceability_coverage`` route modules,
so they live here as plain module-level functions to avoid duplication.
"""

import re
from datetime import datetime

from sqlalchemy.orm import Session

from .. import models


def normalize_result_status(status: str) -> str:
    status_map = {
        "pass": "passed",
        "passed": "passed",
        "fail": "failed",
        "failed": "failed",
        "block": "blocked",
        "blocked": "blocked",
        "skip": "skipped",
        "skipped": "skipped",
        "not_tested": "not_tested",
    }
    return status_map.get((status or "").lower(), (status or "").lower())


def enum_value(value):
    return getattr(value, "value", value)


def get_reference_tokens(value: str | None) -> list[str]:
    raw_value = value or ""
    tokens = [
        token.strip("()[]{}\"'.,").lower()
        for token in re.split(r"[\s,;|]+", raw_value)
        if token.strip("()[]{}\"'.,")
    ]
    tokens.extend(token.lower() for token in re.findall(r"[a-z]+-\d+", raw_value, flags=re.IGNORECASE))
    return list(dict.fromkeys(tokens))


def add_legacy_reference_links(linked_test_case_ids: dict[int, set[int]], requirements: list, test_cases: list) -> None:
    for requirement in requirements:
        requirement_key = str(requirement.requirement_id or "").lower()
        if not requirement_key:
            continue
        for test_case in test_cases:
            if requirement_key in get_reference_tokens(test_case.reference):
                linked_test_case_ids.setdefault(requirement.id, set()).add(test_case.id)


def get_linked_requirement_test_case_ids(db: Session, requirement_ids: list[int], project_test_case_ids: list[int]) -> dict[int, set[int]]:
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


def build_coverage_report(db: Session, project_id: int, generated: bool = False):
    from ..models import TestCase, TestSuite, TestResult, TestRun, Requirement

    test_suite_ids = [row.id for row in db.query(TestSuite.id).filter(TestSuite.project_id == project_id).all()]
    test_cases_query = db.query(TestCase).filter(TestCase.test_suite_id.in_(test_suite_ids), TestCase.is_deleted == False)
    test_cases = test_cases_query.all() if test_suite_ids else []
    test_case_ids = [test_case.id for test_case in test_cases]
    total_test_cases = len(test_cases)

    test_run_ids = [row.id for row in db.query(TestRun.id).filter(TestRun.project_id == project_id).all()]
    test_results = db.query(TestResult).filter(TestResult.test_run_id.in_(test_run_ids)).all() if test_run_ids else []
    latest_by_test_case = {}
    for result in test_results:
        current = latest_by_test_case.get(result.test_case_id)
        if current is None or (result.executed_at and current.executed_at and result.executed_at > current.executed_at):
            latest_by_test_case[result.test_case_id] = result
        elif current is None or (result.executed_at and not current.executed_at):
            latest_by_test_case[result.test_case_id] = result

    normalized_statuses = [normalize_result_status(result.status) for result in latest_by_test_case.values()]
    executed_statuses = {"passed", "failed", "blocked", "skipped"}
    executed_test_cases = len([status for status in normalized_statuses if status in executed_statuses])
    passed_test_cases = normalized_statuses.count("passed")
    failed_test_cases = normalized_statuses.count("failed")
    blocked_test_cases = normalized_statuses.count("blocked")
    skipped_test_cases = normalized_statuses.count("skipped")
    not_tested_cases = max(total_test_cases - executed_test_cases, 0)

    requirements = db.query(Requirement).filter(Requirement.project_id == project_id).all()
    total_requirements = len(requirements)
    requirement_ids = [requirement.id for requirement in requirements]
    linked_test_case_ids = get_linked_requirement_test_case_ids(db, requirement_ids, test_case_ids)
    add_legacy_reference_links(linked_test_case_ids, requirements, test_cases)
    covered_requirements = len([requirement_id for requirement_id, linked_ids in linked_test_case_ids.items() if linked_ids])
    coverage_percentage = (covered_requirements / total_requirements * 100) if total_requirements else 0

    # Build priority buckets from the priority values actually carried by the
    # project's requirements. The PriorityDefinition table is not authoritative
    # here: a requirement's priority (e.g. "high") may not exist as an active
    # PriorityDefinition, and keying off the definitions silently dropped those
    # requirements from the report. Fall back to the standard set when empty.
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
                "not_tested": round((not_tested_cases / total_test_cases * 100) if total_test_cases else 0, 2),
            },
        },
    }
