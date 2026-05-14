import logging
from datetime import datetime, timezone
from typing import Iterable, List

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import (
    Defect,
    DefectSeverity,
    DefectStatus,
    Milestone,
    MilestoneStatus,
    Requirement,
    RequirementStatus,
    TestPlan,
    TestResult,
    TestRun,
)

logger = logging.getLogger(__name__)

OPEN_DEFECT_STATUSES = {
    DefectStatus.OPEN,
    DefectStatus.IN_PROGRESS,
    DefectStatus.REOPENED,
}
EXECUTED_RESULT_STATUSES = {"pass", "fail", "skip", "block", "passed", "failed", "skipped", "blocked"}
PASS_RESULT_STATUSES = {"pass", "passed"}
FAIL_RESULT_STATUSES = {"fail", "failed"}
BLOCKED_RESULT_STATUSES = {"block", "blocked"}
SKIPPED_RESULT_STATUSES = {"skip", "skipped"}
NOT_TESTED_RESULT_STATUSES = {"not_tested", "pending", "todo"}


def _percentage(part: int, total: int) -> int:
    if total <= 0:
        return 0
    return round((part / total) * 100)


def _normalize_status(value: object) -> str:
    if value is None:
        return ""
    if hasattr(value, "value"):
        return str(value.value).lower()
    return str(value).lower()


def _is_overdue(milestone: Milestone) -> bool:
    if not milestone.target_date or milestone.status in {MilestoneStatus.COMPLETED, MilestoneStatus.CANCELLED}:
        return False

    target_date = milestone.target_date
    if target_date.tzinfo is None:
        target_date = target_date.replace(tzinfo=timezone.utc)
    return target_date < datetime.now(timezone.utc)


def _derive_health(
    milestone: Milestone,
    *,
    open_defects: int,
    critical_defects: int,
    failed_results: int,
    blocked_results: int,
    progress: int,
) -> str:
    if milestone.status == MilestoneStatus.CANCELLED:
        return "cancelled"
    if milestone.status == MilestoneStatus.COMPLETED or progress >= 100:
        return "completed"
    if critical_defects > 0 or blocked_results > 0:
        return "blocked"
    if _is_overdue(milestone) or failed_results > 0 or open_defects >= 5:
        return "at_risk"
    if progress > 0 or milestone.status == MilestoneStatus.IN_PROGRESS:
        return "in_progress"
    return "planned"


def enrich_milestone(db: Session, milestone: Milestone) -> Milestone:
    """Attach process metrics to a milestone without changing the database schema."""
    test_plans: List[TestPlan] = (
        db.query(TestPlan)
        .filter(TestPlan.milestone_id == milestone.id)
        .order_by(TestPlan.target_end_date.asc().nullslast(), TestPlan.id.asc())
        .all()
    )
    test_plan_ids = [plan.id for plan in test_plans]

    plan_linked_runs: List[TestRun] = []
    if test_plan_ids:
        plan_linked_runs = db.query(TestRun).filter(TestRun.test_plan_id.in_(test_plan_ids)).all()
    direct_runs: List[TestRun] = db.query(TestRun).filter(TestRun.milestone_id == milestone.id).all()
    seen_ids: set = set()
    test_runs = []
    for run in plan_linked_runs + direct_runs:
        if run.id not in seen_ids:
            seen_ids.add(run.id)
            test_runs.append(run)
    test_run_ids = [run.id for run in test_runs]

    results: List[TestResult] = []
    if test_run_ids:
        results = db.query(TestResult).filter(TestResult.test_run_id.in_(test_run_ids)).all()

    total_results = len(results)
    passed_results = len([result for result in results if _normalize_status(result.status) in PASS_RESULT_STATUSES])
    failed_results = len([result for result in results if _normalize_status(result.status) in FAIL_RESULT_STATUSES])
    blocked_results = len([result for result in results if _normalize_status(result.status) in BLOCKED_RESULT_STATUSES])
    skipped_results = len([result for result in results if _normalize_status(result.status) in SKIPPED_RESULT_STATUSES])
    not_tested_results = len([result for result in results if _normalize_status(result.status) in NOT_TESTED_RESULT_STATUSES])
    executed_results = len([result for result in results if _normalize_status(result.status) in EXECUTED_RESULT_STATUSES])

    test_case_count = 0
    if test_run_ids:
        test_case_count = (
            db.query(func.count(func.distinct(TestResult.test_case_id)))
            .filter(TestResult.test_run_id.in_(test_run_ids))
            .scalar()
            or 0
        )

    defect_query = db.query(Defect).filter(Defect.project_id == milestone.project_id)
    if test_run_ids:
        defect_query = defect_query.filter(Defect.test_run_id.in_(test_run_ids))
    defects: List[Defect] = defect_query.all()
    open_defects = len([defect for defect in defects if defect.status in OPEN_DEFECT_STATUSES])
    critical_defects = len([defect for defect in defects if defect.severity == DefectSeverity.CRITICAL and defect.status in OPEN_DEFECT_STATUSES])

    requirements: List[Requirement] = db.query(Requirement).filter(Requirement.project_id == milestone.project_id).all()
    verified_requirements = len([requirement for requirement in requirements if requirement.status == RequirementStatus.VERIFIED])

    execution_progress = _percentage(executed_results, total_results) if total_results else int(milestone.progress_percentage or 0)
    pass_rate = _percentage(passed_results, executed_results) if executed_results else 0

    milestone.test_plan_count = len(test_plans)
    milestone.test_run_count = len(test_runs)
    milestone.test_case_count = test_case_count
    milestone.result_count = total_results
    milestone.passed_count = passed_results
    milestone.failed_count = failed_results
    milestone.blocked_count = blocked_results
    milestone.skipped_count = skipped_results
    milestone.not_tested_count = not_tested_results
    milestone.execution_progress = execution_progress
    milestone.pass_rate = pass_rate
    milestone.open_defect_count = open_defects
    milestone.critical_defect_count = critical_defects
    milestone.requirement_count = len(requirements)
    milestone.verified_requirement_count = verified_requirements
    milestone.is_overdue = _is_overdue(milestone)
    milestone.health = _derive_health(
        milestone,
        open_defects=open_defects,
        critical_defects=critical_defects,
        failed_results=failed_results,
        blocked_results=blocked_results,
        progress=execution_progress,
    )
    milestone.linked_test_plans = [
        {
            "id": plan.id,
            "title": plan.title,
            "status": plan.status.value if plan.status else None,
            "target_start_date": plan.target_start_date,
            "target_end_date": plan.target_end_date,
        }
        for plan in test_plans
    ]

    logger.debug(
        "Milestone %s enriched with %s plans, %s runs, %s results",
        milestone.id,
        len(test_plans),
        len(test_runs),
        total_results,
    )
    return milestone


def enrich_milestones(db: Session, milestones: Iterable[Milestone]) -> List[Milestone]:
    return [enrich_milestone(db, milestone) for milestone in milestones]


def get_project_milestone_stats(db: Session, project_id: int) -> dict:
    milestones = db.query(Milestone).filter(Milestone.project_id == project_id).all()
    enriched = enrich_milestones(db, milestones)

    return {
        "total": len(enriched),
        "planned": len([m for m in enriched if m.status == MilestoneStatus.PLANNED]),
        "inProgress": len([m for m in enriched if m.status == MilestoneStatus.IN_PROGRESS]),
        "completed": len([m for m in enriched if m.status == MilestoneStatus.COMPLETED]),
        "cancelled": len([m for m in enriched if m.status == MilestoneStatus.CANCELLED]),
        "overdue": len([m for m in enriched if getattr(m, "is_overdue", False)]),
        "atRisk": len([m for m in enriched if getattr(m, "health", "") in {"at_risk", "blocked"}]),
        "testPlans": sum(getattr(m, "test_plan_count", 0) for m in enriched),
        "testRuns": sum(getattr(m, "test_run_count", 0) for m in enriched),
        "testCases": sum(getattr(m, "test_case_count", 0) for m in enriched),
        "openDefects": sum(getattr(m, "open_defect_count", 0) for m in enriched),
        "averageExecutionProgress": round(
            sum(getattr(m, "execution_progress", 0) for m in enriched if m.status != MilestoneStatus.CANCELLED) /
            max(1, sum(1 for m in enriched if m.status != MilestoneStatus.CANCELLED))
        ) if enriched else 0,
    }
