from sqlalchemy.orm import Session, joinedload, noload, selectinload
from sqlalchemy.orm.attributes import set_committed_value
from sqlalchemy import func, or_, select, text
from sqlalchemy.exc import IntegrityError, OperationalError
from typing import List, Optional
from datetime import datetime, timedelta, timezone
import logging
import re
from .. import schemas
from ..retry_utils import seq_conflict_retry
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
from ..models import Project, TestSuite, TestCase, TestCaseStep, TestRun, TestResult, User, Role, CustomFieldDefinition, CustomFieldValue, CustomFieldType, JiraIntegration, JiraIssue, Requirement, Defect, TestPlan, Milestone, TraceabilityMatrix, CoverageReport, Notification, TestCaseSection, SharedStep, GlobalParameter, TestDataset, TestMindmap, ImpactAnalysis, ExecutionEnvironment, ExecutionLog, TestSchedule, ExecutionEngine, TestRunEnvironment, DefectComment, DefectAttachment, DefectHistory, DefectWorkflow, DefectTemplate, TestResultDefectLink, DefectLinkType, DefectStatus, DefectSeverity, DefectPriority, IssueTrackerIntegration, SyncLog, KPIData, TestStepResult, ShareableReport, RootCauseAnalysis, DashboardWidget, TestCaseRevision, RequirementStatus, Priority, EntityType, TestTypeDefinition, PriorityDefinition, SharedStepTemplate, TestExecutionSettings, NotificationSettings, AutomationSettings, SystemSettings, requirement_test_case_links, requirement_test_plan_links, RequirementVersion, RequirementChatConversation, RequirementChatMessage, RequirementFolder
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

logger = logging.getLogger(__name__)


def get_test_suite(db: Session, test_suite_id: int):
    return db.query(TestSuite).filter(TestSuite.id == test_suite_id).first()


def get_test_suites(db: Session, project_id: Optional[int] = None, skip: int = 0, limit: int = 100):
    query = db.query(TestSuite)
    # Explicit None check so callers can scope to project_id=0 without it being silently ignored
    if project_id is not None:
        query = query.filter(TestSuite.project_id == project_id)
    return query.order_by(TestSuite.created_at.desc(), TestSuite.id.desc()).offset(skip).limit(limit).all()


def create_test_suite(db: Session, test_suite: TestSuiteCreate):
    payload = test_suite.model_dump()
    # test_case_ids is handled separately below; remove it before constructing the model
    requested_case_ids = payload.pop("test_case_ids", None) or []

    db_test_suite = TestSuite(**payload)
    db.add(db_test_suite)
    safe_commit(db)
    db.refresh(db_test_suite)

    if requested_case_ids:
        # Only move cases that live in the same project and aren't soft-deleted.
        valid_case_ids = [
            row[0]
            for row in db.query(TestCase.id)
            .join(TestSuite, TestCase.test_suite_id == TestSuite.id)
            .filter(
                TestCase.id.in_(requested_case_ids),
                TestSuite.project_id == db_test_suite.project_id,
                ((TestCase.is_deleted.is_(None)) | (TestCase.is_deleted.is_(False))),
            )
            .all()
        ]
        if valid_case_ids:
            db.query(TestCase).filter(TestCase.id.in_(valid_case_ids)).update(
                {"test_suite_id": db_test_suite.id, "section_id": None},
                synchronize_session=False,
            )
            safe_commit(db)
            db.refresh(db_test_suite)

    return db_test_suite


def get_test_case_counts_by_suite(db: Session, suite_ids: List[int]) -> dict:
    """Return {suite_id: count_of_non_deleted_test_cases} for a list of suite ids."""
    if not suite_ids:
        return {}
    rows = (
        db.query(TestCase.test_suite_id, func.count(TestCase.id))
        .filter(
            TestCase.test_suite_id.in_(suite_ids),
            ((TestCase.is_deleted.is_(None)) | (TestCase.is_deleted.is_(False))),
        )
        .group_by(TestCase.test_suite_id)
        .all()
    )
    return {sid: int(cnt or 0) for sid, cnt in rows}


def update_test_suite(db: Session, test_suite_id: int, test_suite: TestSuiteUpdate):
    db_test_suite = db.query(TestSuite).filter(TestSuite.id == test_suite_id).first()
    if db_test_suite:
        for key, value in test_suite.model_dump(exclude_unset=True).items():
            setattr(db_test_suite, key, value)
        safe_commit(db)
        db.refresh(db_test_suite)
    return db_test_suite


def delete_test_suite(db: Session, test_suite_id: int):
    db_test_suite = db.query(TestSuite).filter(TestSuite.id == test_suite_id).first()
    if not db_test_suite:
        return None
    # Bare delete fails with an integrity error when test_cases/sections still
    # reference this suite — the route is expected to enforce the "must be empty"
    # rule via a 409 before we reach this point.
    db.delete(db_test_suite)
    safe_commit(db)
    return db_test_suite


def get_test_case(db: Session, test_case_id: int):
    return db.query(TestCase).options(
        joinedload(TestCase.test_suite).joinedload(TestSuite.project),
        joinedload(TestCase.section),
        joinedload(TestCase.creator),
        selectinload(TestCase.custom_field_values)
    ).filter(TestCase.id == test_case_id).first()


def get_test_cases(db: Session, test_suite_id: Optional[int] = None, section_id: Optional[int] = None, skip: int = 0, limit: int = 100):
    from sqlalchemy.orm import joinedload

    query = db.query(TestCase).options(
        joinedload(TestCase.test_suite).joinedload(TestSuite.project),
        joinedload(TestCase.section),
        joinedload(TestCase.creator),
        selectinload(TestCase.custom_field_values)
    ).filter(
        ((TestCase.is_deleted.is_(None)) | (TestCase.is_deleted.is_(False)))
    )
    if test_suite_id is not None:
        query = query.filter(TestCase.test_suite_id == test_suite_id)
    if section_id is not None:
        query = query.filter(TestCase.section_id == section_id)
    return query.offset(skip).limit(limit).all()


def create_test_case(db: Session, test_case: TestCaseCreate, created_by: int):
    # Extract test_steps from the create schema before creating the test case
    test_steps_data = test_case.test_steps
    test_case_dict = test_case.model_dump(exclude={'test_steps'})
    
    db_test_case = TestCase(**test_case_dict)
    db_test_case.created_by = created_by
    
    # If multi-step data is provided, set is_multistep flag
    if test_steps_data and len(test_steps_data) > 0:
        db_test_case.is_multistep = True
    
    db.add(db_test_case)
    safe_commit(db)
    db.refresh(db_test_case)
    
    # Create test steps if provided (multi-step support)
    if test_steps_data and len(test_steps_data) > 0:
        for step_data in test_steps_data:
            step_dict = step_data.model_dump(exclude={'test_case_id'})
            db_step = TestCaseStep(**step_dict, test_case_id=db_test_case.id)
            db.add(db_step)
        safe_commit(db)
        db.refresh(db_test_case)
    
    return db_test_case


def update_test_case(db: Session, test_case_id: int, test_case: TestCaseUpdate):
    db_test_case = db.query(TestCase).filter(TestCase.id == test_case_id).first()
    if db_test_case:
        for key, value in test_case.model_dump(exclude_unset=True).items():
            setattr(db_test_case, key, value)
        safe_commit(db)
        db.refresh(db_test_case)
    return db_test_case


def delete_test_case(db: Session, test_case_id: int):
    db_test_case = db.query(TestCase).filter(TestCase.id == test_case_id).first()
    if db_test_case:
        db_test_case.is_deleted = True
        safe_commit(db)
        db.refresh(db_test_case)
    return db_test_case


# Test Case Step CRUD functions
def get_test_case_steps(db: Session, test_case_id: int):
    return db.query(TestCaseStep).filter(TestCaseStep.test_case_id == test_case_id).order_by(TestCaseStep.step_number).all()


def get_test_case_step(db: Session, step_id: int):
    return db.query(TestCaseStep).filter(TestCaseStep.id == step_id).first()


def create_test_case_step(db: Session, step: schemas.TestCaseStepCreate):
    step_dict = step.model_dump()
    if not step_dict.get('test_case_id'):
        raise ValueError('test_case_id is required when creating a standalone test case step')

    db_step = TestCaseStep(**step_dict)
    db.add(db_step)
    safe_commit(db)
    db.refresh(db_step)
    return db_step


def create_test_case_steps(db: Session, test_case_id: int, steps: List[schemas.TestCaseStepCreate]):
    # Delete existing steps for this test case
    db.query(TestCaseStep).filter(TestCaseStep.test_case_id == test_case_id).delete()
    
    # Create new steps
    db_steps = []
    for step_data in steps:
        step_dict = step_data.model_dump(exclude={'test_case_id'})
        db_step = TestCaseStep(**step_dict, test_case_id=test_case_id)
        db.add(db_step)
        db_steps.append(db_step)
    
    safe_commit(db)
    for step in db_steps:
        db.refresh(step)
    return db_steps


def update_test_case_step(db: Session, step_id: int, step: schemas.TestCaseStepUpdate):
    db_step = db.query(TestCaseStep).filter(TestCaseStep.id == step_id).first()
    if db_step:
        for key, value in step.model_dump(exclude_unset=True).items():
            setattr(db_step, key, value)
        safe_commit(db)
        db.refresh(db_step)
    return db_step


def delete_test_case_step(db: Session, step_id: int):
    db_step = db.query(TestCaseStep).filter(TestCaseStep.id == step_id).first()
    if db_step:
        db.delete(db_step)
        safe_commit(db)
    return db_step


def get_test_case_with_steps(db: Session, test_case_id: int):
    test_case = db.query(TestCase).options(
        joinedload(TestCase.test_suite).joinedload(TestSuite.project),
        joinedload(TestCase.section),
        joinedload(TestCase.test_steps)
    ).filter(TestCase.id == test_case_id).first()
    return test_case


def get_test_run(db: Session, test_run_id: int):
    return db.query(TestRun).options(joinedload(TestRun.assignee)).filter(TestRun.id == test_run_id).first()


def get_test_runs(
    db: Session,
    project_id: Optional[int] = None,
    skip: int = 0,
    limit: int = 100,
    search: Optional[str] = None,
    status: Optional[str] = None,
    priority: Optional[str] = None,
    assigned_to: Optional[int] = None,
    test_plan_id: Optional[int] = None,
    milestone_id: Optional[int] = None,
    environment_id: Optional[int] = None,
):
    query = db.query(TestRun).options(joinedload(TestRun.assignee))
    if project_id:
        query = query.filter(TestRun.project_id == project_id)
    if search:
        search_pattern = f"%{search.strip()}%"
        query = query.filter(
            or_(
                TestRun.name.ilike(search_pattern),
                TestRun.description.ilike(search_pattern),
            )
        )
    if status:
        query = query.filter(TestRun.status == status)
    if priority:
        query = query.filter(TestRun.priority == priority)
    if assigned_to:
        query = query.filter(TestRun.assigned_to == assigned_to)
    if test_plan_id:
        query = query.filter(TestRun.test_plan_id == test_plan_id)
    if milestone_id:
        query = query.outerjoin(TestPlan, TestRun.test_plan_id == TestPlan.id).filter(
            or_(TestRun.milestone_id == milestone_id, TestPlan.milestone_id == milestone_id)
        )
    if environment_id is not None:
        query = query.filter(TestRun.environment_id == environment_id)
    query = query.order_by(TestRun.created_at.desc(), TestRun.id.desc())
    return query.offset(skip).limit(limit).all()


def create_test_run(db: Session, test_run: TestRunCreate):
    # Convert assigned_to from string to int if needed
    test_run_data = test_run.model_dump()
    if test_run_data.get('assigned_to') and isinstance(test_run_data['assigned_to'], str):
        test_run_data['assigned_to'] = int(test_run_data['assigned_to'])
    
    # Create TestRun without relationship handling
    db_test_run = TestRun(
        name=test_run_data['name'],
        description=test_run_data.get('description'),
        project_id=test_run_data['project_id'],
        test_plan_id=test_run_data.get('test_plan_id'),
        milestone_id=test_run_data.get('milestone_id'),
        status=test_run_data.get('status', 'pending'),
        # environment=test_run_data.get('environment'),  # Temporarily disabled
        environment_id=test_run_data.get('environment_id'),
        assigned_to=test_run_data.get('assigned_to'),
        priority=test_run_data.get('priority'),
        estimated_duration=test_run_data.get('estimated_duration'),
        schedule_id=test_run_data.get('schedule_id')
    )
    
    db.add(db_test_run)
    safe_commit(db)
    db.refresh(db_test_run)
    return db_test_run


def create_test_suite_run(db: Session, test_suite: TestSuite, test_cases: List[TestCase], run_data: schemas.TestSuiteRunCreate):
    """Create a test run and its initial results atomically for a suite."""
    if not test_cases:
        raise ValueError("Cannot create a test run for a suite with no test cases")

    run_values = run_data.model_dump(exclude_unset=True)
    db_test_run = TestRun(
        name=run_values.get("name") or f"Test Run - {test_suite.name}",
        description=run_values.get("description") or f"Test run for {test_suite.name}",
        project_id=test_suite.project_id,
        status="pending",
        assigned_to=run_values.get("assigned_to"),
        priority=run_values.get("priority") or "medium",
        estimated_duration=run_values.get("estimated_duration"),
    )
    db.add(db_test_run)
    db.flush()

    test_results = [
        TestResult(
            test_run_id=db_test_run.id,
            test_case_id=test_case.id,
            status="not_started",
        )
        for test_case in test_cases
    ]
    db.add_all(test_results)
    safe_commit(db)
    db.refresh(db_test_run)
    for test_result in test_results:
        db.refresh(test_result)

    db_test_run.test_results = test_results
    return db_test_run


def _normalize_run_status(value) -> str:
    return str(value or "").strip().lower().replace("-", "_")


def update_test_run(db: Session, test_run_id: int, test_run: TestRunUpdate):
    db_test_run = db.query(TestRun).filter(TestRun.id == test_run_id).first()
    if db_test_run:
        prior_status = _normalize_run_status(db_test_run.status)
        prior_milestone_id = db_test_run.milestone_id
        prior_test_plan_id = db_test_run.test_plan_id
        for key, value in test_run.model_dump(exclude_unset=True).items():
            setattr(db_test_run, key, value)
        safe_commit(db)
        db.refresh(db_test_run)
        # Refresh both the new and any previous milestone so progress follows a
        # run when it is re-linked to a different milestone/plan (the old one
        # loses the run's contribution, the new one gains it).
        affected = {
            db_test_run.milestone_id,
            prior_milestone_id,
            _milestone_id_for_plan(db, db_test_run.test_plan_id),
            _milestone_id_for_plan(db, prior_test_plan_id),
        }
        _refresh_milestones_by_ids(db, affected)
        # Emit ``test_run.completed`` exactly once per transition into the
        # completed state. Failures are swallowed inside emit_event so we
        # never block the update path on webhook delivery.
        new_status = _normalize_run_status(db_test_run.status)
        if new_status == "completed" and prior_status != "completed":
            try:
                from ..services.webhook_service import emit_event
                emit_event(
                    db,
                    project_id=db_test_run.project_id,
                    event="test_run.completed",
                    payload={
                        "event": "test_run.completed",
                        "test_run": {
                            "id": db_test_run.id,
                            "name": db_test_run.name,
                            "project_id": db_test_run.project_id,
                            "test_plan_id": getattr(db_test_run, "test_plan_id", None),
                            "milestone_id": getattr(db_test_run, "milestone_id", None),
                            "status": db_test_run.status,
                            "started_at": getattr(db_test_run, "started_at", None).isoformat()
                            if getattr(db_test_run, "started_at", None) else None,
                            "completed_at": getattr(db_test_run, "completed_at", None).isoformat()
                            if getattr(db_test_run, "completed_at", None) else None,
                        },
                    },
                )
            except Exception:
                # Log but never propagate.
                import logging
                logging.getLogger(__name__).exception("Failed to emit test_run.completed")
    return db_test_run


def delete_test_run(db: Session, test_run_id: int):
    db_test_run = db.query(TestRun).filter(TestRun.id == test_run_id).first()
    if db_test_run:
        affected = {
            db_test_run.milestone_id,
            _milestone_id_for_plan(db, db_test_run.test_plan_id),
        }
        # Remove dependent rows first: test_results.test_run_id is NOT NULL, so
        # the ORM's default null-out cascade would fail the moment a run has
        # results; MariaDB additionally enforces the FKs on the other tables.
        from ..models import (
            CoverageReport,
            CustomFieldValue,
            Defect,
            ExecutionLog,
            JiraIssue,
            TestExecution,
            TestResultDefectLink,
            TestRunEnvironment,
            TestStepResult,
        )

        result_ids = select(TestResult.id).where(TestResult.test_run_id == test_run_id)
        for model in (TestResultDefectLink, TestStepResult):
            db.query(model).filter(model.test_result_id.in_(result_ids)).delete(
                synchronize_session=False
            )
        db.query(JiraIssue).filter(JiraIssue.test_result_id.in_(result_ids)).update(
            {JiraIssue.test_result_id: None}, synchronize_session=False
        )
        for model in (ExecutionLog, TestExecution, TestRunEnvironment, TestResult):
            db.query(model).filter(model.test_run_id == test_run_id).delete(synchronize_session=False)
        for model in (Defect, CoverageReport, CustomFieldValue):
            db.query(model).filter(model.test_run_id == test_run_id).update(
                {model.test_run_id: None}, synchronize_session=False
            )

        db.delete(db_test_run)
        safe_commit(db)
        _refresh_milestones_by_ids(db, affected)
    return db_test_run


def get_test_result(db: Session, test_result_id: int):
    return db.query(TestResult).options(
        joinedload(TestResult.test_case).joinedload(TestCase.section),
        joinedload(TestResult.executor),
    ).filter(TestResult.id == test_result_id).first()


def get_test_results(db: Session, test_run_id: Optional[int] = None, test_case_id: Optional[int] = None, skip: int = 0, limit: int = 100):
    query = db.query(TestResult).options(
        joinedload(TestResult.test_case).joinedload(TestCase.section),
        joinedload(TestResult.test_case).selectinload(TestCase.custom_field_values),
        joinedload(TestResult.executor),
        selectinload(TestResult.defect_links).joinedload(TestResultDefectLink.defect),
    ).filter(
        TestResult.test_case_id.isnot(None),
        TestResult.test_run_id.isnot(None),
        # Exclude results whose test case has been soft-deleted (or no longer
        # exists). Keeping them surfaces "ghost" cases in run listings and feeds
        # deleted cases into the execution prev/next navigation, which then 404
        # on load.
        TestResult.test_case.has(
            (TestCase.is_deleted.is_(None)) | (TestCase.is_deleted.is_(False))
        ),
    )
    if test_run_id:
        query = query.filter(TestResult.test_run_id == test_run_id)
    if test_case_id:
        query = query.filter(TestResult.test_case_id == test_case_id)
    return query.offset(skip).limit(limit).all()


def _refresh_milestone_progress_for_run(db: Session, test_run_id):
    """Keep the milestone(s) behind a run's progress in sync after an execution
    write. Lazy import avoids a module-load cycle (service <- crud)."""
    if not test_run_id:
        return
    from ..services.milestone_service import recompute_milestones_for_test_run
    test_run = db.query(TestRun).filter(TestRun.id == test_run_id).first()
    recompute_milestones_for_test_run(db, test_run)


def _refresh_milestones_by_ids(db: Session, milestone_ids):
    """Recompute stored progress for an explicit set of milestone ids. Used when
    a run is re-linked and we must refresh both the milestone it left and the one
    it joined."""
    ids = {mid for mid in milestone_ids if mid}
    if not ids:
        return
    from ..services.milestone_service import recompute_milestone_progress
    changed = False
    # Lock the milestone rows (ordered for a deterministic lock order) so the
    # read-modify-write recompute can't lose an update against a concurrent
    # execution write. No-op on SQLite.
    milestones = (
        db.query(Milestone)
        .filter(Milestone.id.in_(ids))
        .order_by(Milestone.id.asc())
        .with_for_update()
        .all()
    )
    for milestone in milestones:
        changed = recompute_milestone_progress(db, milestone, commit=False) or changed
    if changed:
        safe_commit(db)


def _milestone_id_for_plan(db: Session, test_plan_id):
    if not test_plan_id:
        return None
    row = db.query(TestPlan.milestone_id).filter(TestPlan.id == test_plan_id).first()
    return row[0] if row else None


def _auto_create_defect_for_failed_result(db: Session, test_result: TestResult, result_data: dict):
    """Auto-create a defect if test result is marked as failed and no defect exists."""
    new_status = result_data.get('status')
    if not new_status:
        return

    # Normalize status to lowercase
    normalized_status = str(new_status).lower().strip()
    is_failed = normalized_status in ('fail', 'failed')

    if not is_failed:
        return

    # Check if a defect already exists for this test result
    existing_defect_link = db.query(TestResultDefectLink).filter(
        TestResultDefectLink.test_result_id == test_result.id
    ).first()

    if existing_defect_link:
        return  # Defect already exists for this result

    try:
        # Get test case and test run info for context
        test_case = db.query(TestCase).filter(TestCase.id == test_result.test_case_id).first()
        test_run = db.query(TestRun).filter(TestRun.id == test_result.test_run_id).first()

        if not test_case or not test_run:
            return

        # Generate defect title and description
        case_name = test_case.title or f"Test Case {test_case.id}"
        defect_title = f"Failed: {case_name}"
        defect_description = f"Test case '{case_name}' failed in test run '{test_run.name}'.\n\nActual Result:\n{test_result.actual_result or 'No details provided'}"

        # Get project_id from test run
        project_id = test_run.project_id

        # Numbering is owned centrally by the project_seq before_insert listener
        # (services/sequence_service.py), which derives defect_id as
        # P{project_id}-DEF-{seq:03d}. Don't recompute it here: a second, manual
        # max-scan (the old full-table SELECT-all) is a divergent source of truth
        # that can disagree with the URL/badge number. We leave defect_id unset
        # and let the listener allocate it.
        #
        # MAX(project_seq)+1 can still race two concurrent failed-result inserts
        # into a unique-index (project_id, project_seq) collision — surfaced as an
        # IntegrityError on commit. Retry the whole build+commit so a fresh
        # instance re-runs allocation and picks the next free number.
        @seq_conflict_retry()
        def _insert_defect() -> Defect:
            new_defect = Defect(
                title=defect_title,
                description=defect_description,
                status=DefectStatus.OPEN,
                severity=DefectSeverity.MEDIUM,
                priority=DefectPriority.MEDIUM,
                project_id=project_id,
                test_case_id=test_case.id,
                test_run_id=test_run.id,
                reported_by=test_result.executed_by or 1,  # executor or fallback to user 1
                actual_result=test_result.actual_result,
            )
            db.add(new_defect)
            safe_commit(db)
            db.refresh(new_defect)
            return new_defect

        new_defect = _insert_defect()

        # Create a link between the test result and the new defect
        defect_link = TestResultDefectLink(
            test_result_id=test_result.id,
            defect_id=new_defect.id,
            link_type=DefectLinkType.FOUND.value,
            result_snapshot={
                "status": test_result.status,
                "executed_by": test_result.executed_by,
                "executed_at": test_result.executed_at.isoformat() if test_result.executed_at else None,
            },
            created_by=test_result.executed_by or 1,
        )

        db.add(defect_link)
        safe_commit(db)

    except Exception as e:
        # Log the error but don't fail the test result update
        logger.error(f"Failed to auto-create defect for failed test result {test_result.id}: {e}")


def create_test_result(db: Session, test_result: TestResultCreate):
    test_result_data = test_result.model_dump()
    db_test_result = TestResult(**test_result_data)
    apply_test_result_execution_timing(db_test_result, test_result_data)
    db.add(db_test_result)
    safe_commit(db)
    db.refresh(db_test_result)
    _refresh_milestone_progress_for_run(db, db_test_result.test_run_id)
    return db_test_result


def update_test_result(db: Session, test_result_id: int, test_result: TestResultUpdate):
    db_test_result = db.query(TestResult).filter(TestResult.id == test_result_id).first()
    if db_test_result:
        test_result_data = test_result.model_dump(exclude_unset=True)
        for key, value in test_result_data.items():
            setattr(db_test_result, key, value)
        # Re-executing a result clears any pending retest flag, unless the
        # caller set it explicitly.
        if 'status' in test_result_data and 'retest_needed' not in test_result_data:
            db_test_result.retest_needed = False
        apply_test_result_execution_timing(db_test_result, test_result_data)
        safe_commit(db)
        db.refresh(db_test_result)
        # Only the status drives milestone progress; skip the recompute for the
        # timing/state-only updates (pause, resume, add-time) sharing this path.
        if 'status' in test_result_data:
            _refresh_milestone_progress_for_run(db, db_test_result.test_run_id)
            # Auto-create defect if test result changed to failed
            _auto_create_defect_for_failed_result(db, db_test_result, test_result_data)
    return db_test_result


def delete_test_result(db: Session, test_result_id: int):
    db_test_result = db.query(TestResult).filter(TestResult.id == test_result_id).first()
    if db_test_result:
        run_id = db_test_result.test_run_id
        db.delete(db_test_result)
        safe_commit(db)
        _refresh_milestone_progress_for_run(db, run_id)
    return db_test_result
