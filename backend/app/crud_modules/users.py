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

def get_user(db: Session, user_id: int):
    return db.query(User).filter(User.id == user_id).first()


def get_user_by_username(db: Session, username: str):
    return db.query(User).filter(User.username == username).first()


def get_user_by_email(db: Session, email: str):
    return db.query(User).filter(User.email == email).first()


def get_users(db: Session, skip: int = 0, limit: int = 100):
    return db.query(User).offset(skip).limit(limit).all()


def create_user(db: Session, user: UserCreate):
    from ..auth import get_password_hash
    from ..rbac import role_value
    hashed_password = get_password_hash(user.password)
    db_user = User(
        username=user.username,
        email=user.email,
        full_name=user.full_name,
        hashed_password=hashed_password,
        role=role_value(user.role, Role.TESTER),
        is_active=user.is_active,
        force_password_change=user.force_password_change,
        two_factor_enabled=user.two_factor_enabled,
        session_version=user.session_version,
    )
    db.add(db_user)
    safe_commit(db)
    db.refresh(db_user)
    return db_user


def update_user(db: Session, user_id: int, user: UserUpdate):
    db_user = db.query(User).filter(User.id == user_id).first()
    if db_user:
        from ..rbac import role_value
        update_data = user.model_dump(exclude_unset=True)
        if "password" in update_data:
            from ..auth import get_password_hash
            update_data["hashed_password"] = get_password_hash(update_data.pop("password"))
        for key, value in update_data.items():
            # Convert Role enum to string value for database compatibility
            if key == "role":
                value = role_value(value)
            setattr(db_user, key, value)
        safe_commit(db)
        db.refresh(db_user)
    return db_user


def delete_user(db: Session, user_id: int):
    db_user = db.query(User).filter(User.id == user_id).first()
    if db_user:
        db.delete(db_user)
        safe_commit(db)
    return db_user
