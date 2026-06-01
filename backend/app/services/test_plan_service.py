"""Derived execution metrics for test plans.

A test plan's stored ``status`` is set by hand and can drift from reality (a
plan marked "passed" whose runs all failed). These helpers derive an execution
rollup from the plan's linked test runs / results so the UI can show the truth
alongside the manual status, mirroring how ``milestone_service`` enriches
milestones.
"""

from typing import Dict, Iterable, List

from sqlalchemy.orm import Session

from ..models import TestResult, TestRun
from .milestone_service import (
    BLOCKED_RESULT_STATUSES,
    EXECUTED_RESULT_STATUSES,
    FAIL_RESULT_STATUSES,
    NOT_TESTED_RESULT_STATUSES,
    PASS_RESULT_STATUSES,
    SKIPPED_RESULT_STATUSES,
    _normalize_status,
    _percentage,
)

# Keys returned for a plan with no runs at all, so callers always get a
# stable shape.
_EMPTY_ROLLUP = {
    "run_count": 0,
    "result_count": 0,
    "passed_count": 0,
    "failed_count": 0,
    "blocked_count": 0,
    "skipped_count": 0,
    "not_tested_count": 0,
    "executed_count": 0,
    "execution_progress": 0,
    "pass_rate": 0,
    "execution_status": "not_started",
}


def _derive_execution_status(
    *, run_count: int, total: int, executed: int, passed: int, failed: int, blocked: int
) -> str:
    if run_count == 0:
        return "not_started"
    if total == 0 or executed == 0:
        # Runs exist but nothing has been executed yet.
        return "in_progress"
    if failed > 0:
        return "failed"
    if blocked > 0:
        return "blocked"
    if executed < total:
        return "in_progress"
    # Everything executed, nothing failed or blocked.
    return "passed" if passed > 0 else "in_progress"


def compute_plan_executions(db: Session, plan_ids: Iterable[int]) -> Dict[int, dict]:
    """Return a per-plan execution rollup keyed by test plan id.

    Aggregates in two batched queries (runs, then their results) regardless of
    how many plans are passed, so it is safe to call for a whole list page.
    """
    plan_ids = [pid for pid in plan_ids if pid is not None]
    if not plan_ids:
        return {}

    rollups: Dict[int, dict] = {pid: dict(_EMPTY_ROLLUP) for pid in plan_ids}

    runs: List[TestRun] = db.query(TestRun).filter(TestRun.test_plan_id.in_(plan_ids)).all()
    if not runs:
        return rollups

    run_to_plan: Dict[int, int] = {}
    for run in runs:
        run_to_plan[run.id] = run.test_plan_id
        rollups[run.test_plan_id]["run_count"] += 1

    run_ids = list(run_to_plan.keys())
    results: List[TestResult] = (
        db.query(TestResult).filter(TestResult.test_run_id.in_(run_ids)).all()
    )
    for result in results:
        plan_id = run_to_plan.get(result.test_run_id)
        if plan_id is None:
            continue
        bucket = rollups[plan_id]
        status = _normalize_status(result.status)
        bucket["result_count"] += 1
        if status in PASS_RESULT_STATUSES:
            bucket["passed_count"] += 1
        elif status in FAIL_RESULT_STATUSES:
            bucket["failed_count"] += 1
        elif status in BLOCKED_RESULT_STATUSES:
            bucket["blocked_count"] += 1
        elif status in SKIPPED_RESULT_STATUSES:
            bucket["skipped_count"] += 1
        elif status in NOT_TESTED_RESULT_STATUSES:
            bucket["not_tested_count"] += 1
        if status in EXECUTED_RESULT_STATUSES:
            bucket["executed_count"] += 1

    for bucket in rollups.values():
        total = bucket["result_count"]
        executed = bucket["executed_count"]
        bucket["execution_progress"] = _percentage(executed, total)
        bucket["pass_rate"] = _percentage(bucket["passed_count"], executed) if executed else 0
        bucket["execution_status"] = _derive_execution_status(
            run_count=bucket["run_count"],
            total=total,
            executed=executed,
            passed=bucket["passed_count"],
            failed=bucket["failed_count"],
            blocked=bucket["blocked_count"],
        )

    return rollups


def compute_plan_execution(db: Session, plan_id: int) -> dict:
    """Single-plan convenience wrapper around :func:`compute_plan_executions`."""
    return compute_plan_executions(db, [plan_id]).get(plan_id, dict(_EMPTY_ROLLUP))
