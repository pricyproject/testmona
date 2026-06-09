from sqlalchemy.orm import Session, joinedload, noload, selectinload
from sqlalchemy.orm.attributes import set_committed_value
from sqlalchemy import func, or_, text
from sqlalchemy.exc import IntegrityError, OperationalError
from typing import List, Optional
from datetime import datetime, timedelta, timezone
import re
from .. import schemas
from ..services.execution_timing import apply_test_result_execution_timing
from ..services.user_lifecycle import (
    create_user_invitation,
    delete_user_invitation,
    get_onboarding_checklist,
    get_user_invitation,
    get_user_invitation_by_token,
    get_user_invitations,
    initialize_onboarding_checklist,
    mark_invitation_as_used,
    update_onboarding_task,
)
from ..models import Project, TestSuite, TestCase, TestCaseStep, TestRun, TestResult, User, Role, CustomFieldDefinition, CustomFieldValue, CustomFieldType, JiraIntegration, JiraIssue, Requirement, Defect, TestPlan, Milestone, TraceabilityMatrix, CoverageReport, Notification, TestCaseSection, SharedStep, GlobalParameter, TestDataset, TestMindmap, ImpactAnalysis, ExecutionEnvironment, ExecutionLog, TestSchedule, ExecutionEngine, TestRunEnvironment, DefectComment, DefectAttachment, DefectHistory, DefectWorkflow, DefectTemplate, TestResultDefectLink, DefectLinkType, DefectStatus, IssueTrackerIntegration, SyncLog, KPIData, TestStepResult, ShareableReport, RootCauseAnalysis, DashboardWidget, TestCaseRevision, RequirementStatus, Priority, EntityType, TestTypeDefinition, PriorityDefinition, SharedStepTemplate, TestExecutionSettings, NotificationSettings, AutomationSettings, SystemSettings, requirement_test_case_links, requirement_test_plan_links, RequirementVersion, RequirementChatConversation, RequirementChatMessage, RequirementFolder
from ..schemas import (
    ProjectCreate, ProjectUpdate,
    TestSuiteCreate, TestSuiteUpdate,
    TestCaseCreate, TestCaseUpdate,
    TestRunCreate, TestRunUpdate,
    TestResultCreate, TestResultUpdate,
    UserCreate, UserUpdate,
    CustomFieldDefinitionCreate, CustomFieldDefinitionUpdate,
    CustomFieldValueCreate, CustomFieldValueUpdate,
    JiraIntegrationCreate, JiraIntegrationUpdate,
    JiraIssueCreate, JiraIssueUpdate,
    RequirementCreate, RequirementUpdate,
    DefectCreate, DefectUpdate,
    TestPlanCreate, TestPlanUpdate,
    MilestoneCreate, MilestoneUpdate,
    TraceabilityMatrixCreate,
    CoverageReportCreate,
    NotificationCreate, NotificationUpdate,
    TestCaseSectionCreate, TestCaseSectionUpdate,
    TestCaseRevisionCreate,
    TestCaseStepCreate, TestCaseStepUpdate,
    KPIDataCreate, TestStepResultCreate, ShareableReportCreate, RootCauseAnalysisCreate,
    DashboardWidgetCreate,
    TestTypeDefinitionCreate, TestTypeDefinitionUpdate,
    PriorityDefinitionCreate, PriorityDefinitionUpdate,
    SharedStepTemplateCreate, SharedStepTemplateUpdate,
    TestExecutionSettingsCreate, TestExecutionSettingsUpdate,
    NotificationSettingsCreate, NotificationSettingsUpdate,
    AutomationSettingsCreate, AutomationSettingsUpdate,
    SystemSettingsCreate, SystemSettingsUpdate
)

from .projects import *
from .test_management import *
from .users import *
from .custom_fields import *
from .integrations import *
from .requirements import *

def get_defect(db: Session, defect_id: int):
    return db.query(Defect).filter(Defect.id == defect_id).first()


def get_defects(
    db: Session,
    project_id: int = None,
    skip: int = 0,
    limit: int = 100,
    search: str = None,
    status: str = None,
    milestone_id: int = None,
):
    query = db.query(Defect)
    if project_id:
        query = query.filter(Defect.project_id == project_id)
    if status:
        query = query.filter(Defect.status == status)
    if milestone_id:
        milestone_plan_ids = (
            db.query(TestPlan.id)
            .filter(TestPlan.milestone_id == milestone_id)
            .subquery()
        )
        milestone_run_ids = (
            db.query(TestRun.id)
            .filter(
                or_(
                    TestRun.milestone_id == milestone_id,
                    TestRun.test_plan_id.in_(milestone_plan_ids),
                )
            )
            .subquery()
        )
        query = query.filter(Defect.test_run_id.in_(milestone_run_ids))
    if search:
        # Escape LIKE wildcards so user input is matched literally
        escaped = search.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
        pattern = f"%{escaped}%"
        query = query.filter(or_(
            Defect.title.ilike(pattern),
            Defect.description.ilike(pattern),
            Defect.defect_id.ilike(pattern),
        ))
    return query.order_by(Defect.created_at.desc()).offset(skip).limit(limit).all()


def create_defect(db: Session, defect: DefectCreate):
    db_defect = Defect(**defect.model_dump())
    db.add(db_defect)
    safe_commit(db)
    db.refresh(db_defect)
    try:
        from ..services.webhook_service import emit_event
        emit_event(
            db,
            project_id=db_defect.project_id,
            event="defect.created",
            payload={
                "event": "defect.created",
                "defect": {
                    "id": db_defect.id,
                    "defect_id": db_defect.defect_id,
                    "title": db_defect.title,
                    "status": getattr(db_defect.status, "value", db_defect.status),
                    "severity": getattr(db_defect.severity, "value", db_defect.severity),
                    "priority": getattr(db_defect.priority, "value", db_defect.priority),
                    "project_id": db_defect.project_id,
                    "test_case_id": db_defect.test_case_id,
                    "test_run_id": db_defect.test_run_id,
                    "requirement_id": db_defect.requirement_id,
                    "reported_by": db_defect.reported_by,
                    "assigned_to": db_defect.assigned_to,
                },
            },
        )
    except Exception:
        import logging
        logging.getLogger(__name__).exception("Failed to emit defect.created")
    return db_defect


def update_defect(db: Session, defect_id: int, defect: DefectUpdate):
    db_defect = db.query(Defect).filter(Defect.id == defect_id).first()
    if db_defect:
        update_data = defect.model_dump(exclude_unset=True)
        old_status = db_defect.status
        for key, value in update_data.items():
            setattr(db_defect, key, value)
        safe_commit(db)
        db.refresh(db_defect)
        # Lifecycle sync: a status change means every linked execution result
        # should be re-verified (fix landed, or the bug is back).
        if 'status' in update_data and db_defect.status != old_status:
            flag_linked_results_for_retest(db, defect_id)
        try:
            from ..services.webhook_service import emit_event
            emit_event(
                db,
                project_id=db_defect.project_id,
                event="defect.updated",
                payload={
                    "event": "defect.updated",
                    "changed_fields": sorted(update_data.keys()),
                    "defect": {
                        "id": db_defect.id,
                        "defect_id": db_defect.defect_id,
                        "title": db_defect.title,
                        "status": getattr(db_defect.status, "value", db_defect.status),
                        "severity": getattr(db_defect.severity, "value", db_defect.severity),
                        "priority": getattr(db_defect.priority, "value", db_defect.priority),
                        "project_id": db_defect.project_id,
                        "test_case_id": db_defect.test_case_id,
                        "test_run_id": db_defect.test_run_id,
                        "requirement_id": db_defect.requirement_id,
                        "reported_by": db_defect.reported_by,
                        "assigned_to": db_defect.assigned_to,
                    },
                },
            )
        except Exception:
            import logging
            logging.getLogger(__name__).exception("Failed to emit defect.updated")
    return db_defect


def delete_defect(db: Session, defect_id: int):
    db_defect = db.query(Defect).filter(Defect.id == defect_id).first()
    if db_defect:
        db.delete(db_defect)
        safe_commit(db)
    return db_defect


# Test Result <-> Defect link CRUD

# Test result statuses (any casing/variant) that represent a failed/blocked run
_FAILED_BLOCKED_STATUSES = {"fail", "failed", "block", "blocked"}
# Defect statuses still considered "open" for coverage reporting
_OPEN_DEFECT_STATUSES = [DefectStatus.OPEN, DefectStatus.IN_PROGRESS, DefectStatus.REOPENED]


def get_test_result_defect_links(db: Session, test_result_id: int):
    return db.query(TestResultDefectLink).options(
        joinedload(TestResultDefectLink.defect)
    ).filter(
        TestResultDefectLink.test_result_id == test_result_id
    ).order_by(TestResultDefectLink.created_at.desc()).all()


def get_test_result_defect_link(db: Session, link_id: int):
    return db.query(TestResultDefectLink).options(
        joinedload(TestResultDefectLink.defect)
    ).filter(TestResultDefectLink.id == link_id).first()


def link_defect_to_test_result(
    db: Session,
    test_result_id: int,
    defect_id: int,
    link_type: str = None,
    created_by: int = None,
    result_snapshot: dict = None,
    failing_step_snapshot: dict = None,
):
    """Link a defect to a test result. Idempotent on (test_result_id, defect_id)."""
    link_type = link_type or DefectLinkType.FOUND.value
    existing = db.query(TestResultDefectLink).filter(
        TestResultDefectLink.test_result_id == test_result_id,
        TestResultDefectLink.defect_id == defect_id,
    ).first()
    if existing:
        changed = False
        if existing.link_type != link_type:
            existing.link_type = link_type
            changed = True
        # Legacy links created before snapshots existed can be initialized once,
        # but existing immutable snapshots are never overwritten.
        if existing.result_snapshot is None and result_snapshot is not None:
            existing.result_snapshot = result_snapshot
            existing.snapshot_created_at = existing.snapshot_created_at or datetime.now(timezone.utc)
            changed = True
        if existing.failing_step_snapshot is None and failing_step_snapshot is not None:
            existing.failing_step_snapshot = failing_step_snapshot
            changed = True
        if changed:
            safe_commit(db)
        db.refresh(existing)
        return existing
    link = TestResultDefectLink(
        test_result_id=test_result_id,
        defect_id=defect_id,
        link_type=link_type,
        result_snapshot=result_snapshot,
        failing_step_snapshot=failing_step_snapshot,
        created_by=created_by,
    )
    db.add(link)
    safe_commit(db)
    db.refresh(link)
    return link


def unlink_defect_from_test_result(db: Session, link_id: int):
    link = db.query(TestResultDefectLink).filter(TestResultDefectLink.id == link_id).first()
    if link:
        db.delete(link)
        safe_commit(db)
        return True
    return False


def flag_linked_results_for_retest(db: Session, defect_id: int):
    """Mark every test result linked to this defect as needing a retest."""
    result_ids = [
        row[0] for row in db.query(TestResultDefectLink.test_result_id).filter(
            TestResultDefectLink.defect_id == defect_id
        ).all()
    ]
    if not result_ids:
        return 0
    updated = db.query(TestResult).filter(TestResult.id.in_(result_ids)).update(
        {TestResult.retest_needed: True}, synchronize_session=False
    )
    safe_commit(db)
    return updated


def get_test_run_defect_coverage(db: Session, test_run_id: int):
    """Return a defect-linking rollup for a test run (traceability reporting)."""
    results = db.query(TestResult).filter(TestResult.test_run_id == test_run_id).all()
    failed_or_blocked = [
        r for r in results if str(r.status or "").strip().lower() in _FAILED_BLOCKED_STATUSES
    ]
    fb_ids = [r.id for r in failed_or_blocked]

    links = []
    if fb_ids:
        links = db.query(TestResultDefectLink).filter(
            TestResultDefectLink.test_result_id.in_(fb_ids)
        ).all()
    linked_result_ids = {link.test_result_id for link in links}
    linked = len(linked_result_ids)

    defect_ids = {link.defect_id for link in links}
    open_defects = 0
    if defect_ids:
        open_defects = db.query(Defect).filter(
            Defect.id.in_(defect_ids),
            Defect.status.in_(_OPEN_DEFECT_STATUSES),
        ).count()

    return {
        "test_run_id": test_run_id,
        "total_results": len(results),
        "failed_or_blocked": len(failed_or_blocked),
        "linked": linked,
        "unlinked": len(failed_or_blocked) - linked,
        "open_defects": open_defects,
        "retest_needed": sum(1 for r in results if r.retest_needed),
    }


def get_test_run_flakiness(db: Session, test_run_id: int, history: int = 10):
    """For each test case in a run, inspect its recent results across all runs
    and flag cases whose outcomes flip-flop between pass and fail (flaky)."""
    case_ids = [
        row[0] for row in db.query(TestResult.test_case_id).filter(
            TestResult.test_run_id == test_run_id,
            TestResult.test_case_id.isnot(None),
        ).distinct().all()
    ]
    if not case_ids:
        return {}

    rows = db.query(
        TestResult.test_case_id, TestResult.status
    ).filter(
        TestResult.test_case_id.in_(case_ids)
    ).order_by(TestResult.executed_at.desc()).all()

    pass_set = {"pass", "passed"}
    fail_set = {"fail", "failed", "block", "blocked"}

    by_case: dict[int, list[str]] = {}
    for case_id, status in rows:
        bucket = by_case.setdefault(case_id, [])
        if len(bucket) < history:
            bucket.append(str(status or "").strip().lower())

    flakiness = {}
    for case_id in case_ids:
        statuses = by_case.get(case_id, [])
        completed = [s for s in statuses if s in pass_set or s in fail_set]
        fails = sum(1 for s in completed if s in fail_set)
        passes = sum(1 for s in completed if s in pass_set)
        flakiness[case_id] = {
            "runs": len(completed),
            "fails": fails,
            "flaky": len(completed) >= 3 and fails > 0 and passes > 0,
        }
    return flakiness


# Test Plan CRUD
def get_test_plan(db: Session, test_plan_id: int):
    return db.query(TestPlan).filter(TestPlan.id == test_plan_id).first()


def get_test_plans(
    db: Session,
    project_id: int = None,
    milestone_id: int = None,
    status: str = None,
    search: str = None,
    sort_by: str = "created_at",
    sort_order: str = "desc",
    skip: int = 0,
    limit: int = 100,
):
    from ..models import TestStatus as TS

    query = db.query(TestPlan).options(joinedload(TestPlan.milestone))
    # Use explicit None check so project_id=0 is treated as a filter, not as "no filter"
    if project_id is not None:
        query = query.filter(TestPlan.project_id == project_id)
    if milestone_id is not None:
        query = query.filter(TestPlan.milestone_id == milestone_id)
    if status:
        try:
            query = query.filter(TestPlan.status == TS(status))
        except ValueError:
            pass
    if search:
        term = f"%{search}%"
        query = query.filter(
            or_(
                TestPlan.title.ilike(term),
                TestPlan.description.ilike(term),
                TestPlan.test_objectives.ilike(term),
            )
        )
    _allowed_sorts = {"title", "created_at", "updated_at", "status", "target_start_date", "target_end_date"}
    col_name = sort_by if sort_by in _allowed_sorts else "created_at"
    col = getattr(TestPlan, col_name)
    query = query.order_by(col.asc() if sort_order == "asc" else col.desc())
    return query.offset(skip).limit(limit).all()


def create_test_plan(db: Session, test_plan: TestPlanCreate):
    db_test_plan = TestPlan(**test_plan.model_dump())
    db.add(db_test_plan)
    safe_commit(db)
    db.refresh(db_test_plan)
    return db_test_plan


def update_test_plan(db: Session, test_plan_id: int, test_plan: TestPlanUpdate):
    db_test_plan = db.query(TestPlan).filter(TestPlan.id == test_plan_id).first()
    if db_test_plan:
        for key, value in test_plan.model_dump(exclude_unset=True).items():
            setattr(db_test_plan, key, value)
        safe_commit(db)
        db.refresh(db_test_plan)
    return db_test_plan


def delete_test_plan(db: Session, test_plan_id: int):
    db_test_plan = db.query(TestPlan).filter(TestPlan.id == test_plan_id).first()
    if db_test_plan:
        db.execute(
            requirement_test_plan_links.delete().where(
                requirement_test_plan_links.c.test_plan_id == test_plan_id
            )
        )
        db.delete(db_test_plan)
        safe_commit(db)
    return db_test_plan


# Milestone CRUD
def get_milestone(db: Session, milestone_id: int):
    return db.query(Milestone).filter(Milestone.id == milestone_id).first()


def get_milestones(db: Session, project_id: int = None, skip: int = 0, limit: int = 100):
    query = db.query(Milestone)
    # Filter on any explicit project_id (including 0), only skip filter when caller passes None
    if project_id is not None:
        query = query.filter(Milestone.project_id == project_id)
    return query.offset(skip).limit(limit).all()


def create_milestone(db: Session, milestone: MilestoneCreate):
    db_milestone = Milestone(**milestone.model_dump())
    db.add(db_milestone)
    safe_commit(db)
    db.refresh(db_milestone)
    return db_milestone


def update_milestone(db: Session, milestone_id: int, milestone: MilestoneUpdate):
    db_milestone = db.query(Milestone).filter(Milestone.id == milestone_id).first()
    if db_milestone:
        for key, value in milestone.model_dump(exclude_unset=True).items():
            setattr(db_milestone, key, value)
        safe_commit(db)
        db.refresh(db_milestone)
    return db_milestone


def delete_milestone(db: Session, milestone_id: int):
    db_milestone = db.query(Milestone).filter(Milestone.id == milestone_id).first()
    if db_milestone:
        db.delete(db_milestone)
        safe_commit(db)
    return db_milestone


# Traceability Matrix CRUD
def get_traceability_matrix(db: Session, matrix_id: int):
    return db.query(TraceabilityMatrix).filter(TraceabilityMatrix.id == matrix_id).first()


def get_traceability_matrix_entries(db: Session, requirement_id: int = None, test_case_id: int = None):
    query = db.query(TraceabilityMatrix)
    if requirement_id:
        query = query.filter(TraceabilityMatrix.requirement_id == requirement_id)
    if test_case_id:
        query = query.filter(TraceabilityMatrix.test_case_id == test_case_id)
    return query.all()


def create_traceability_matrix_entry(db: Session, entry: TraceabilityMatrixCreate):
    db_entry = TraceabilityMatrix(**entry.model_dump())
    db.add(db_entry)
    safe_commit(db)
    db.refresh(db_entry)
    return db_entry


def update_traceability_matrix_entry(db: Session, entry_id: int, entry: dict):
    db_entry = db.query(TraceabilityMatrix).filter(TraceabilityMatrix.id == entry_id).first()
    if db_entry:
        for key, value in entry.items():
            setattr(db_entry, key, value)
        safe_commit(db)
        db.refresh(db_entry)
    return db_entry


def delete_traceability_matrix_entry(db: Session, entry_id: int):
    db_entry = db.query(TraceabilityMatrix).filter(TraceabilityMatrix.id == entry_id).first()
    if db_entry:
        db.delete(db_entry)
        safe_commit(db)
    return db_entry


# Coverage Report CRUD
def get_coverage_report(db: Session, report_id: int):
    return db.query(CoverageReport).filter(CoverageReport.id == report_id).first()


def get_coverage_reports(db: Session, project_id: int = None, test_run_id: int = None, skip: int = 0, limit: int = 100):
    query = db.query(CoverageReport)
    if project_id:
        query = query.filter(CoverageReport.project_id == project_id)
    if test_run_id:
        query = query.filter(CoverageReport.test_run_id == test_run_id)
    return query.offset(skip).limit(limit).all()


def create_coverage_report(db: Session, report: CoverageReportCreate):
    db_report = CoverageReport(**report.model_dump())
    db.add(db_report)
    safe_commit(db)
    db.refresh(db_report)
    return db_report


def update_coverage_report(db: Session, report_id: int, report: dict):
    db_report = db.query(CoverageReport).filter(CoverageReport.id == report_id).first()
    if db_report:
        for key, value in report.items():
            setattr(db_report, key, value)
        safe_commit(db)
        db.refresh(db_report)
    return db_report


def delete_coverage_report(db: Session, report_id: int):
    db_report = db.query(CoverageReport).filter(CoverageReport.id == report_id).first()
    if db_report:
        db.delete(db_report)
        safe_commit(db)
    return db_report
