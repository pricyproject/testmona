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
from .defects_planning import *

def create_notification(db: Session, notification: NotificationCreate):
    db_notification = Notification(**notification.model_dump())
    db.add(db_notification)
    safe_commit(db)
    db.refresh(db_notification)
    return db_notification


def get_notifications(db: Session, user_id: int, skip: int = 0, limit: int = 100):
    return db.query(Notification).filter(Notification.user_id == user_id).order_by(Notification.created_at.desc()).offset(skip).limit(limit).all()


def get_notification(db: Session, notification_id: int):
    return db.query(Notification).filter(Notification.id == notification_id).first()


def update_notification(db: Session, notification_id: int, notification: NotificationUpdate):
    db_notification = db.query(Notification).filter(Notification.id == notification_id).first()
    if db_notification:
        update_data = notification.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_notification, field, value)
        safe_commit(db)
        db.refresh(db_notification)
    return db_notification


def delete_notification(db: Session, notification_id: int):
    db_notification = db.query(Notification).filter(Notification.id == notification_id).first()
    if db_notification:
        db.delete(db_notification)
        safe_commit(db)
    return db_notification


def get_unread_notification_count(db: Session, user_id: int):
    return db.query(Notification).filter(Notification.user_id == user_id, Notification.is_read == False).count()


def mark_all_notifications_as_read(db: Session, user_id: int):
    result = db.query(Notification).filter(Notification.user_id == user_id, Notification.is_read == False).update({"is_read": True})
    safe_commit(db)
    return result


def delete_old_notifications(db: Session, user_id: int, days_old: int = 30):
    """Delete notifications older than specified days for a user"""
    from datetime import datetime, timedelta
    cutoff_date = datetime.now() - timedelta(days=days_old)
    result = db.query(Notification).filter(
        Notification.user_id == user_id,
        Notification.created_at < cutoff_date,
        Notification.is_read == True  # Only delete read notifications
    ).delete()
    safe_commit(db)
    return result


def mark_notification_as_unread(db: Session, notification_id: int):
    """Mark a specific notification as unread"""
    db_notification = db.query(Notification).filter(Notification.id == notification_id).first()
    if db_notification:
        db_notification.is_read = False
        safe_commit(db)
        db.refresh(db_notification)
    return db_notification


def delete_all_notifications(db: Session, user_id: int):
    """Delete all notifications for a user"""
    result = db.query(Notification).filter(Notification.user_id == user_id).delete()
    safe_commit(db)
    return result


def get_notifications_filtered(db: Session, user_id: int, notification_type: str = None, skip: int = 0, limit: int = 100):
    """Get notifications filtered by type"""
    from ..models import NotificationType
    query = db.query(Notification).filter(Notification.user_id == user_id)
    if notification_type:
        # Validate the type against allowed values
        allowed_types = ['info', 'success', 'warning', 'error']
        if notification_type.lower() not in allowed_types:
            return []
        # Compare against uppercase since SQLite stores enums as uppercase strings
        query = query.filter(Notification.type == notification_type.upper())
    return query.order_by(Notification.created_at.desc()).offset(skip).limit(limit).all()


def search_notifications(db: Session, user_id: int, search_query: str, skip: int = 0, limit: int = 100):
    """Search notifications by title or message"""
    if not search_query or not search_query.strip():
        return []
    # Escape SQL wildcard characters to prevent SQL injection
    escaped_query = search_query.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
    query = db.query(Notification).filter(
        Notification.user_id == user_id,
        (Notification.title.ilike(f'%{escaped_query}%', escape='\\')) | (Notification.message.ilike(f'%{escaped_query}%', escape='\\'))
    )
    return query.order_by(Notification.created_at.desc()).offset(skip).limit(limit).all()


def get_notifications_filtered_and_searched(db: Session, user_id: int, notification_type: str = None, search_query: str = None, skip: int = 0, limit: int = 100):
    """Get notifications filtered by type and search query"""
    from ..models import NotificationType
    query = db.query(Notification).filter(Notification.user_id == user_id)
    
    if notification_type:
        # Validate the type against allowed values
        allowed_types = ['info', 'success', 'warning', 'error']
        if notification_type.lower() not in allowed_types:
            return []
        # Compare against uppercase since SQLite stores enums as uppercase strings
        query = query.filter(Notification.type == notification_type.upper())
    
    if search_query and search_query.strip():
        # Escape SQL wildcard characters to prevent SQL injection
        escaped_query = search_query.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
        query = query.filter(
            (Notification.title.ilike(f'%{escaped_query}%', escape='\\')) | (Notification.message.ilike(f'%{escaped_query}%', escape='\\'))
        )
    
    return query.order_by(Notification.created_at.desc()).offset(skip).limit(limit).all()


def bulk_update_notifications(db: Session, user_id: int, notification_ids: List[int], is_read: bool = None):
    """Bulk update notifications (mark as read/unread)"""
    query = db.query(Notification).filter(
        Notification.user_id == user_id,
        Notification.id.in_(notification_ids)
    )
    result = 0
    if is_read is not None:
        result = query.update({"is_read": is_read}, synchronize_session=False)
    safe_commit(db)
    return result


def bulk_delete_notifications(db: Session, user_id: int, notification_ids: List[int]):
    """Bulk delete notifications"""
    result = db.query(Notification).filter(
        Notification.user_id == user_id,
        Notification.id.in_(notification_ids)
    ).delete()
    safe_commit(db)
    return result


# Analytics and Reporting CRUD functions

# KPI Data CRUD
def create_kpi_data(db: Session, kpi_data: KPIDataCreate):
    db_kpi = KPIData(**kpi_data.model_dump())
    db.add(db_kpi)
    safe_commit(db)
    db.refresh(db_kpi)
    return db_kpi


def get_kpi_data(db: Session, project_id: int, metric_type: str = None, time_period: str = None, skip: int = 0, limit: int = 100):
    query = db.query(KPIData).filter(KPIData.project_id == project_id)
    if metric_type:
        query = query.filter(KPIData.metric_type == metric_type)
    if time_period:
        query = query.filter(KPIData.time_period == time_period)
    return query.order_by(KPIData.recorded_at.desc()).offset(skip).limit(limit).all()


def get_latest_kpi_data(db: Session, project_id: int, metric_types: List[str] = None):
    query = db.query(KPIData).filter(KPIData.project_id == project_id)
    if metric_types:
        query = query.filter(KPIData.metric_type.in_(metric_types))
    
    # Get latest record for each metric type
    latest_records = []
    for metric_type in metric_types or ["coverage", "pass_rate", "failure_trends", "flakiness", "cycle_time"]:
        latest = query.filter(KPIData.metric_type == metric_type).order_by(KPIData.recorded_at.desc()).first()
        if latest:
            latest_records.append(latest)
    
    return latest_records


# Test Step Results CRUD
def create_test_step_result(db: Session, step_result: TestStepResultCreate):
    db_step = TestStepResult(**step_result.model_dump())
    db.add(db_step)
    safe_commit(db)
    db.refresh(db_step)
    return db_step


def get_test_step_results(db: Session, project_id: int = None, test_run_id: int = None, test_case_id: int = None, 
                         filter_type: str = "all", skip: int = 0, limit: int = 100):
    query = db.query(TestStepResult).join(TestResult).join(TestCase)
    
    if project_id:
        query = query.join(TestSuite).filter(TestSuite.project_id == project_id)
    if test_run_id:
        query = query.filter(TestResult.test_run_id == test_run_id)
    if test_case_id:
        query = query.filter(TestResult.test_case_id == test_case_id)
    
    if filter_type == "failed":
        query = query.filter(TestStepResult.step_status == "failed")
    elif filter_type == "slow":
        query = query.filter(TestStepResult.step_duration > 5.0)  # Steps taking more than 5 seconds
    
    return query.order_by(TestStepResult.created_at.desc()).offset(skip).limit(limit).all()


def get_test_step_results_by_test_result(db: Session, test_result_id: int):
    return db.query(TestStepResult).filter(TestStepResult.test_result_id == test_result_id).order_by(TestStepResult.step_number).all()


def replace_test_step_results(db: Session, test_result_id: int, step_results: list):
    """Replace all per-step results for a test result with the provided list.

    Used by the execution page to record each step's outcome in one shot.
    """
    db.query(TestStepResult).filter(TestStepResult.test_result_id == test_result_id).delete()
    for item in step_results:
        data = item.model_dump() if hasattr(item, "model_dump") else dict(item)
        data.pop("test_result_id", None)
        db.add(TestStepResult(test_result_id=test_result_id, **data))
    safe_commit(db)
    return get_test_step_results_by_test_result(db, test_result_id)


# Shareable Reports CRUD
def create_shareable_report(db: Session, report: ShareableReportCreate, created_by: int):
    import secrets
    share_token = secrets.token_urlsafe(32)
    
    db_report = ShareableReport(**report.model_dump(), share_token=share_token, created_by=created_by)
    db.add(db_report)
    safe_commit(db)
    db.refresh(db_report)
    return db_report


def get_shareable_reports(db: Session, project_id: int, created_by: int = None, skip: int = 0, limit: int = 100):
    query = db.query(ShareableReport).filter(ShareableReport.project_id == project_id, ShareableReport.is_active == True)
    if created_by:
        query = query.filter(ShareableReport.created_by == created_by)
    return query.order_by(ShareableReport.created_at.desc()).offset(skip).limit(limit).all()


def get_shareable_report(db: Session, report_id: int):
    return db.query(ShareableReport).filter(ShareableReport.id == report_id).first()


def get_shareable_report_by_token(db: Session, share_token: str):
    report = db.query(ShareableReport).filter(ShareableReport.share_token == share_token, ShareableReport.is_active == True).first()
    return report


def record_shareable_report_view(db: Session, report: ShareableReport):
    if report:
        report.view_count = (report.view_count or 0) + 1
        report.last_viewed = func.now()
        safe_commit(db)
    return report


def update_shareable_report(db: Session, report_id: int, report_data: dict):
    db_report = db.query(ShareableReport).filter(ShareableReport.id == report_id).first()
    if db_report:
        for key, value in report_data.items():
            setattr(db_report, key, value)
        safe_commit(db)
        db.refresh(db_report)
    return db_report


def deactivate_shareable_report(db: Session, report_id: int):
    db_report = db.query(ShareableReport).filter(ShareableReport.id == report_id).first()
    if db_report:
        db_report.is_active = False
        safe_commit(db)
        db.refresh(db_report)
    return db_report


# Root Cause Analysis CRUD
def create_root_cause_analysis(db: Session, analysis: RootCauseAnalysisCreate):
    db_analysis = RootCauseAnalysis(**analysis.model_dump())
    db.add(db_analysis)
    safe_commit(db)
    db.refresh(db_analysis)
    return db_analysis


def get_root_cause_analyses(db: Session, project_id: int, requirement_id: int = None, test_case_id: int = None, 
                           defect_id: int = None, status: str = None, skip: int = 0, limit: int = 100):
    query = db.query(RootCauseAnalysis).filter(RootCauseAnalysis.project_id == project_id)
    if requirement_id:
        query = query.filter(RootCauseAnalysis.requirement_id == requirement_id)
    if test_case_id:
        query = query.filter(RootCauseAnalysis.test_case_id == test_case_id)
    if defect_id:
        query = query.filter(RootCauseAnalysis.defect_id == defect_id)
    if status:
        query = query.filter(RootCauseAnalysis.status == status)
    return query.order_by(RootCauseAnalysis.created_at.desc()).offset(skip).limit(limit).all()


def update_root_cause_analysis(db: Session, analysis_id: int, analysis_data: dict):
    db_analysis = db.query(RootCauseAnalysis).filter(RootCauseAnalysis.id == analysis_id).first()
    if db_analysis:
        for key, value in analysis_data.items():
            setattr(db_analysis, key, value)
        db_analysis.updated_at = func.now()
        safe_commit(db)
        db.refresh(db_analysis)
    return db_analysis


def get_root_cause_analysis(db: Session, analysis_id: int):
    return db.query(RootCauseAnalysis).filter(RootCauseAnalysis.id == analysis_id).first()


def delete_root_cause_analysis(db: Session, analysis_id: int):
    db_analysis = db.query(RootCauseAnalysis).filter(RootCauseAnalysis.id == analysis_id).first()
    if db_analysis:
        db.delete(db_analysis)
        safe_commit(db)
    return db_analysis


# Dashboard Widgets CRUD
def create_dashboard_widget(db: Session, widget: DashboardWidgetCreate):
    db_widget = DashboardWidget(**widget.model_dump())
    db.add(db_widget)
    safe_commit(db)
    db.refresh(db_widget)
    return db_widget


def get_dashboard_widgets(db: Session, user_id: int, project_id: int = None):
    query = db.query(DashboardWidget).filter(DashboardWidget.user_id == user_id, DashboardWidget.is_visible == True)
    if project_id:
        query = query.filter(DashboardWidget.project_id == project_id)
    return query.order_by(DashboardWidget.position_y, DashboardWidget.position_x).all()


def get_dashboard_widget(db: Session, widget_id: int):
    return db.query(DashboardWidget).filter(DashboardWidget.id == widget_id).first()


def update_dashboard_widget(db: Session, widget_id: int, widget_data: dict):
    db_widget = db.query(DashboardWidget).filter(DashboardWidget.id == widget_id).first()
    if db_widget:
        for key, value in widget_data.items():
            setattr(db_widget, key, value)
        db_widget.updated_at = func.now()
        safe_commit(db)
        db.refresh(db_widget)
    return db_widget


def delete_dashboard_widget(db: Session, widget_id: int):
    db_widget = db.query(DashboardWidget).filter(DashboardWidget.id == widget_id).first()
    if db_widget:
        db.delete(db_widget)
        safe_commit(db)
    return db_widget


# Analytics aggregation functions
def _normalized_result_status(status: str) -> str:
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
    return status_map.get((status or "").lower(), (status or "").lower())


def calculate_project_kpis(db: Session, project_id: int, time_period: str = "7d"):
    from datetime import datetime, timedelta
    from ..models import Defect, TestRun, TestResult, TestCase, TestSuite
    from sqlalchemy import func
    
    time_mapping = {"24h": 1, "7d": 7, "30d": 30, "90d": 90}
    days = time_mapping.get(time_period, 7)
    current_start_date = datetime.now() - timedelta(days=days)

    total_test_cases = db.query(TestCase).join(TestSuite).filter(
        TestSuite.project_id == project_id,
        TestCase.is_deleted == False,
    ).count()

    current_results = db.query(TestResult).join(TestRun).filter(
        TestRun.project_id == project_id,
        TestResult.executed_at >= current_start_date,
    ).all()

    current_statuses = [_normalized_result_status(result.status) for result in current_results]
    executed_statuses = {"passed", "failed", "blocked", "skipped"}
    executed_results = [result for result in current_results if _normalized_result_status(result.status) in executed_statuses]
    
    total_tests = len(executed_results)
    passed_tests = current_statuses.count("passed")
    failed_tests = current_statuses.count("failed")
    blocked_tests = current_statuses.count("blocked")
    skipped_tests = current_statuses.count("skipped")
    pass_rate = (passed_tests / total_tests * 100) if total_tests > 0 else 0
    
    executed_test_cases = len({result.test_case_id for result in executed_results})
    coverage = (executed_test_cases / total_test_cases * 100) if total_test_cases > 0 else 0
    
    execution_times = [result.execution_time for result in executed_results if result.execution_time is not None]
    avg_execution_time = (sum(execution_times) / len(execution_times) / 3600) if execution_times else 0
    
    completed_runs = db.query(TestRun).filter(
        TestRun.project_id == project_id,
        TestRun.status.in_(["completed", "passed", "failed"]),
        TestRun.created_at >= current_start_date,
        TestRun.completed_at.isnot(None),
    ).all()
    cycle_times = [
        (run.completed_at - run.created_at).total_seconds() / 3600
        for run in completed_runs
        if run.created_at and run.completed_at
    ]
    cycle_time = sum(cycle_times) / len(cycle_times) if cycle_times else 0
    
    test_case_results = {}
    for result in current_results:
        normalized_status = _normalized_result_status(result.status)
        if normalized_status in {"passed", "failed"}:
            test_case_results.setdefault(result.test_case_id, set()).add(normalized_status)
    flaky_tests = len([
        test_case_id for test_case_id, statuses in test_case_results.items()
        if {"passed", "failed"}.issubset(statuses)
    ])
    flakiness = (flaky_tests / len(test_case_results) * 100) if test_case_results else 0
    
    current_failure_rate = (failed_tests / total_tests * 100) if total_tests else 0
    
    total_defects = db.query(Defect).filter(Defect.project_id == project_id).count()
    defect_density = (total_defects / total_test_cases) if total_test_cases > 0 else 0
    productivity_score = min(100, (total_tests / days) * 10) if days > 0 else 0
    
    return {
        "coverage": round(coverage, 1),
        "pass_rate": round(pass_rate, 1),
        "failure_trends": round(current_failure_rate, 1),
        "flakiness": round(flakiness, 1),
        "cycle_time": round(cycle_time, 2),
        "defect_density": round(defect_density, 2),
        "total_tests": total_tests,
        "passed_tests": passed_tests,
        "failed_tests": failed_tests,
        "blocked_tests": blocked_tests,
        "skipped_tests": skipped_tests,
        "avg_execution_time": round(avg_execution_time, 2),
        "productivity_score": round(productivity_score, 1)
    }


def generate_dashboard_analytics(db: Session, project_id: int, time_period: str = "7d"):
    from datetime import datetime, timedelta
    import sqlalchemy as sa
    from ..models import TestRun, TestResult, TestCase, TestSuite
    
    # Get current KPI data
    kpis = calculate_project_kpis(db, project_id, time_period)
    
    # Calculate previous period data for trends
    time_mapping = {"24h": 1, "7d": 7, "30d": 30, "90d": 90}
    days = time_mapping.get(time_period, 7)
    
    # Get previous period data by doubling the days lookback
    start_date = datetime.now() - timedelta(days=days * 2)
    end_date = datetime.now() - timedelta(days=days)
    
    # Get test results from previous period
    previous_results = db.query(TestResult).join(TestRun).filter(
        TestRun.project_id == project_id,
        TestResult.executed_at >= start_date,
        TestResult.executed_at < end_date
    ).all()
    
    # Calculate previous period metrics
    prev_total_tests = len(previous_results)
    prev_statuses = [_normalized_result_status(r.status) for r in previous_results]
    prev_passed_tests = prev_statuses.count('passed')
    prev_failed_tests = prev_statuses.count('failed')
    
    prev_pass_rate = (prev_passed_tests / prev_total_tests * 100) if prev_total_tests > 0 else 0
    
    # Calculate previous coverage
    total_test_cases = db.query(TestCase).join(TestSuite).filter(TestSuite.project_id == project_id, TestCase.is_deleted == False).count()
    prev_executed_test_cases = len(set([r.test_case_id for r in previous_results]))
    prev_coverage = (prev_executed_test_cases / total_test_cases * 100) if total_test_cases > 0 else 0
    
    # Calculate previous flakiness
    prev_test_case_results = {}
    for result in previous_results:
        if result.test_case_id not in prev_test_case_results:
            prev_test_case_results[result.test_case_id] = set()
        prev_test_case_results[result.test_case_id].add(_normalized_result_status(result.status))
    
    prev_flaky_tests = len([tc_id for tc_id, statuses in prev_test_case_results.items() 
                           if len(statuses) > 1 and ('passed' in statuses and 'failed' in statuses)])
    prev_flakiness = (prev_flaky_tests / len(prev_test_case_results) * 100) if prev_test_case_results else 0
    
    prev_failure_trends = (prev_failed_tests / prev_total_tests * 100) if prev_total_tests > 0 else 0
    
    # Previous cycle time
    prev_test_runs = db.query(TestRun).filter(
        TestRun.project_id == project_id,
        TestRun.created_at >= start_date,
        TestRun.created_at < end_date
    ).all()
    
    prev_completed_runs = [run for run in prev_test_runs if run.status in ('completed', 'passed', 'failed')]
    prev_cycle_times = []
    for run in prev_completed_runs:
        if hasattr(run, 'completed_at') and run.completed_at:
            duration = (run.completed_at - run.created_at).total_seconds() / 3600
            prev_cycle_times.append(duration)
    
    prev_cycle_time = sum(prev_cycle_times) / len(prev_cycle_times) if prev_cycle_times else 0
    
    # Calculate previous defect density.
    # Defect density is a cumulative metric (all defects / all test cases), so the
    # previous-period baseline must also be cumulative: every defect created before
    # the current period began. Comparing cumulative-now vs cumulative-then yields a
    # meaningful trend instead of mixing an all-time count with a single-period count.
    from ..models import Defect
    prev_defects = db.query(Defect).filter(
        Defect.project_id == project_id,
        Defect.created_at < end_date
    ).count()
    prev_defect_density = (prev_defects / total_test_cases) if total_test_cases > 0 else 0
    
    previous_kpis = {
        "coverage": prev_coverage,
        "pass_rate": prev_pass_rate,
        "failure_trends": prev_failure_trends,
        "flakiness": prev_flakiness,
        "cycle_time": prev_cycle_time,
        "defect_density": prev_defect_density
    }
    
    # Calculate trends
    def calculate_trend(current, previous):
        if previous == 0:
            return {"current": current, "trend": "up" if current > 0 else "stable", "change": current}
        change = current - previous
        trend = "up" if change > 0 else "down" if change < 0 else "stable"
        return {"current": current, "trend": trend, "change": round(change, 1)}
    
    # Get recent activity data
    today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    test_runs_today = db.query(TestRun).filter(
        TestRun.project_id == project_id,
        TestRun.created_at >= today_start
    ).count()
    
    # Get tests executed today
    tests_executed_today = db.query(TestResult).join(TestRun).filter(
        TestRun.project_id == project_id,
        TestResult.executed_at >= today_start
    ).count()
    
    # Get defects logged today from the defects table (actual defects, not failed runs)
    defects_found_today = db.query(Defect).filter(
        Defect.project_id == project_id,
        Defect.created_at >= today_start
    ).count()
    
    # Get team performance data for the selected period. Prefer actual executors; fallback to assigned runs.
    current_period_start = datetime.now() - timedelta(days=days)
    active_testers = db.query(TestResult.executed_by).join(TestRun).filter(
        TestRun.project_id == project_id,
        TestResult.executed_at >= current_period_start,
        TestResult.executed_by.isnot(None)
    ).distinct().count()
    if active_testers == 0:
        active_testers = db.query(TestRun.assigned_to).filter(
            TestRun.project_id == project_id,
            TestRun.created_at >= current_period_start,
            TestRun.assigned_to.isnot(None)
        ).distinct().count()
    
    # Get upcoming items
    scheduled_runs = db.query(TestRun).filter(
        TestRun.project_id == project_id,
        TestRun.status == 'scheduled'
    ).count()
    
    # Get pending reviews (test cases with status 'pending_review' or similar)
    # TestCase doesn't have direct project_id, need to join through TestSuite
    pending_reviews = db.query(TestCase).join(TestSuite).filter(
        TestSuite.project_id == project_id,
        TestCase.status.in_(['pending_review', 'draft'])
    ).count()
    
    # Release deadline - derived from the nearest upcoming, not-yet-finished milestone.
    release_deadline = "N/A"
    try:
        from ..models import Milestone, MilestoneStatus
        upcoming_milestone = db.query(Milestone).filter(
            Milestone.project_id == project_id,
            Milestone.target_date.isnot(None),
            Milestone.target_date >= datetime.now(),
            Milestone.status.notin_([MilestoneStatus.COMPLETED, MilestoneStatus.CANCELLED]),
        ).order_by(Milestone.target_date.asc()).first()
        if upcoming_milestone and upcoming_milestone.target_date:
            release_deadline = upcoming_milestone.target_date.strftime("%Y-%m-%d")
    except Exception as exc:
        print(f"Could not determine release deadline for project {project_id}: {exc}")
        release_deadline = "N/A"
    
    return {
        "project_id": project_id,
        "time_period": time_period,
        "generated_at": datetime.now().isoformat(),
        "kpi_data": {
            "coverage": calculate_trend(kpis["coverage"], previous_kpis["coverage"]),
            "passRate": calculate_trend(kpis["pass_rate"], previous_kpis["pass_rate"]),
            "failureTrends": calculate_trend(kpis["failure_trends"], previous_kpis["failure_trends"]),
            "flakiness": calculate_trend(kpis["flakiness"], previous_kpis["flakiness"]),
            "cycleTime": calculate_trend(kpis["cycle_time"], previous_kpis["cycle_time"]),
            "defectDensity": calculate_trend(kpis["defect_density"], previous_kpis["defect_density"])
        },
        "recent_activity": {
            "test_runs_today": test_runs_today,
            "tests_executed": tests_executed_today,
            "defects_found": defects_found_today
        },
        "team_performance": {
            "active_testers": active_testers,
            "avg_execution_time": kpis["avg_execution_time"],
            "productivity_score": kpis["productivity_score"]
        },
        "upcoming_items": {
            "scheduled_runs": scheduled_runs,
            "pending_reviews": pending_reviews,
            "release_deadline": release_deadline
        }
    }
