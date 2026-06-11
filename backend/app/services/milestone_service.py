import logging
from datetime import datetime, time, timedelta, timezone
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
    TestCase,
    TestPlan,
    TestResult,
    TestRun,
    requirement_test_plan_links,
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
NOT_STARTED_RESULT_STATUSES = {"not_started"}


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

    # Targets stored at midnight UTC represent "by end of that day"; only flag overdue
    # once the entire target day has elapsed, so a milestone due today isn't marked overdue.
    if target_date.timetz() == time(0, 0, tzinfo=timezone.utc):
        target_date = target_date + timedelta(days=1)

    return target_date <= datetime.now(timezone.utc)


def _derive_health(
    milestone: Milestone,
    *,
    open_defects: int,
    critical_defects: int,
    failed_results: int,
    blocked_results: int,
    blocked_plans: int,
    progress: int,
) -> str:
    if milestone.status == MilestoneStatus.CANCELLED:
        return "cancelled"
    if critical_defects > 0 or blocked_results > 0 or blocked_plans > 0:
        return "blocked"
    if _is_overdue(milestone) or failed_results > 0 or open_defects >= 5:
        return "at_risk"
    if milestone.status == MilestoneStatus.COMPLETED or progress >= 100:
        return "completed"
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
    not_started_results = len([result for result in results if _normalize_status(result.status) in NOT_STARTED_RESULT_STATUSES])
    executed_results = len([result for result in results if _normalize_status(result.status) in EXECUTED_RESULT_STATUSES])

    test_case_count = 0
    if test_run_ids:
        test_case_count = (
            db.query(func.count(func.distinct(TestResult.test_case_id)))
            .join(TestCase, TestCase.id == TestResult.test_case_id)
            .filter(TestResult.test_run_id.in_(test_run_ids))
            .filter(TestCase.is_deleted == False)  # noqa: E712 - soft-deleted cases must not inflate the count
            .scalar()
            or 0
        )

    # Scope defects to this milestone's runs. Without a run link there is no
    # established relationship between the defect and the milestone, so we avoid
    # mixing in every defect in the project (which would inflate every
    # milestone's counts identically and mislead "quality risks").
    if test_run_ids:
        defects: List[Defect] = (
            db.query(Defect)
            .filter(Defect.project_id == milestone.project_id)
            .filter(Defect.test_run_id.in_(test_run_ids))
            .all()
        )
    else:
        defects = []
    open_defects = len([defect for defect in defects if defect.status in OPEN_DEFECT_STATUSES])
    critical_defects = len([defect for defect in defects if defect.severity == DefectSeverity.CRITICAL and defect.status in OPEN_DEFECT_STATUSES])

    requirements: List[Requirement] = []
    if test_plan_ids:
        requirements = (
            db.query(Requirement)
            .join(requirement_test_plan_links, requirement_test_plan_links.c.requirement_id == Requirement.id)
            .filter(requirement_test_plan_links.c.test_plan_id.in_(test_plan_ids))
            .filter(Requirement.project_id == milestone.project_id)
            .distinct()
            .all()
        )
    verified_requirements = len([requirement for requirement in requirements if requirement.status == RequirementStatus.VERIFIED])

    blocked_plans = len([plan for plan in test_plans if _normalize_status(plan.status) == "blocked"])

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
    milestone.not_started_count = not_started_results
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
        blocked_plans=blocked_plans,
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


def recompute_milestone_progress(db: Session, milestone: Milestone, *, commit: bool = True) -> bool:
    """Recalculate and persist a milestone's stored progress from its underlying
    test execution, and auto-advance a PLANNED milestone to IN_PROGRESS once
    execution starts.

    This is what keeps milestone progress live: callers invoke it from every
    execution mutation path (recording/editing/deleting results, updating or
    deleting runs, re-linking plans) so the stored ``progress_percentage`` and
    ``status`` always reflect reality instead of a value a user typed once.

    COMPLETED and CANCELLED milestones are left untouched on purpose: a late
    edit to a result must not silently reopen or regress a milestone someone has
    deliberately closed. Returns ``True`` when something actually changed.
    """
    if milestone is None or milestone.status in {MilestoneStatus.COMPLETED, MilestoneStatus.CANCELLED}:
        return False

    # enrich computes the per-status counts in one pass. We derive progress
    # directly from those counts rather than from execution_progress: that field
    # falls back to the *stored* value when a milestone has no results, which
    # would make progress sticky (e.g. a milestone keeps 100% after its only run
    # is unlinked). Computing straight from results means "no execution -> 0%",
    # while a milestone that is never linked to a run never reaches this code and
    # keeps whatever progress was set by hand.
    enrich_milestone(db, milestone)
    total = getattr(milestone, "result_count", 0) or 0
    executed = total - (getattr(milestone, "not_started_count", 0) or 0)
    new_progress = _percentage(executed, total)

    changed = False
    if new_progress != int(milestone.progress_percentage or 0):
        milestone.progress_percentage = new_progress
        changed = True
    # First executed result flips a planned milestone to in-progress so its
    # status stops lying while testing is underway.
    if milestone.status == MilestoneStatus.PLANNED and executed > 0:
        milestone.status = MilestoneStatus.IN_PROGRESS
        changed = True

    if changed and commit:
        from ..crud_modules.projects import safe_commit

        safe_commit(db)
    return changed


def _milestone_ids_for_test_run(db: Session, test_run: TestRun) -> set:
    """Resolve every milestone a run rolls up into: the directly linked one and
    the one inherited through its test plan."""
    ids: set = set()
    if test_run is None:
        return ids
    direct_id = getattr(test_run, "milestone_id", None)
    if direct_id:
        ids.add(direct_id)
    plan_id = getattr(test_run, "test_plan_id", None)
    if plan_id:
        plan = db.query(TestPlan.milestone_id).filter(TestPlan.id == plan_id).first()
        if plan and plan[0]:
            ids.add(plan[0])
    return ids


def recompute_milestones_for_test_run(db: Session, test_run: TestRun, *, commit: bool = True) -> None:
    """Refresh stored progress for whichever milestone(s) the given run feeds.

    Safe to call from any execution path; a run with no milestone linkage is a
    no-op. Never raises — progress upkeep must not break the execution write it
    is reacting to.
    """
    try:
        ids = _milestone_ids_for_test_run(db, test_run)
        if not ids:
            return
        milestones = db.query(Milestone).filter(Milestone.id.in_(ids)).all()
        changed = False
        for milestone in milestones:
            changed = recompute_milestone_progress(db, milestone, commit=False) or changed
        if changed and commit:
            from ..crud_modules.projects import safe_commit

            safe_commit(db)
    except Exception:
        logger.exception("Failed to recompute milestone progress for test run %s", getattr(test_run, "id", None))


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
