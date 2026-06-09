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

def get_jira_integration(db: Session, integration_id: int):
    return db.query(JiraIntegration).filter(JiraIntegration.id == integration_id).first()


def get_jira_integrations(db: Session, project_id: int, skip: int = 0, limit: int = 100):
    return db.query(JiraIntegration).filter(JiraIntegration.project_id == project_id).offset(skip).limit(limit).all()


def create_jira_integration(db: Session, integration: JiraIntegrationCreate):
    db_integration = JiraIntegration(**integration.model_dump())
    db.add(db_integration)
    safe_commit(db)
    db.refresh(db_integration)
    return db_integration


def update_jira_integration(db: Session, integration_id: int, integration: JiraIntegrationUpdate):
    db_integration = db.query(JiraIntegration).filter(JiraIntegration.id == integration_id).first()
    if db_integration:
        for key, value in integration.model_dump(exclude_unset=True).items():
            setattr(db_integration, key, value)
        safe_commit(db)
        db.refresh(db_integration)
    return db_integration


def delete_jira_integration(db: Session, integration_id: int):
    db_integration = db.query(JiraIntegration).filter(JiraIntegration.id == integration_id).first()
    if db_integration:
        db.delete(db_integration)
        safe_commit(db)
    return db_integration


# Jira Issue CRUD
def get_jira_issue(db: Session, issue_id: int):
    return db.query(JiraIssue).filter(JiraIssue.id == issue_id).first()


def get_jira_issues(db: Session, integration_id: Optional[int] = None, test_case_id: Optional[int] = None, test_result_id: Optional[int] = None):
    query = db.query(JiraIssue)
    if integration_id:
        query = query.filter(JiraIssue.integration_id == integration_id)
    if test_case_id:
        query = query.filter(JiraIssue.test_case_id == test_case_id)
    if test_result_id:
        query = query.filter(JiraIssue.test_result_id == test_result_id)
    return query.all()


def create_jira_issue(db: Session, issue: JiraIssueCreate):
    db_issue = JiraIssue(**issue.model_dump())
    db.add(db_issue)
    safe_commit(db)
    db.refresh(db_issue)
    return db_issue


def update_jira_issue(db: Session, issue_id: int, issue: JiraIssueUpdate):
    db_issue = db.query(JiraIssue).filter(JiraIssue.id == issue_id).first()
    if db_issue:
        for key, value in issue.model_dump(exclude_unset=True).items():
            setattr(db_issue, key, value)
        safe_commit(db)
        db.refresh(db_issue)
    return db_issue


def delete_jira_issue(db: Session, issue_id: int):
    db_issue = db.query(JiraIssue).filter(JiraIssue.id == issue_id).first()
    if db_issue:
        db.delete(db_issue)
        safe_commit(db)
    return db_issue
