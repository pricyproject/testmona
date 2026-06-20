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
from .notifications_analytics import *
from .assets_execution import *
import logging

logger = logging.getLogger(__name__)

def get_test_case_revisions(db: Session, test_case_id: int):
    return db.query(TestCaseRevision).filter(
        TestCaseRevision.test_case_id == test_case_id
    ).order_by(TestCaseRevision.revision_number.desc()).all()


def create_test_case_revision(db: Session, revision: TestCaseRevisionCreate):
    # Get the next revision number
    last_revision = db.query(TestCaseRevision).filter(
        TestCaseRevision.test_case_id == revision.test_case_id
    ).order_by(TestCaseRevision.revision_number.desc()).first()
    
    next_revision_number = (last_revision.revision_number + 1) if last_revision else 1
    
    # Convert enum values to proper enum types
    from ..models import TestType, Priority
    
    try:
        # Handle test_type conversion
        test_type_enum = None
        if revision.test_type:
            if isinstance(revision.test_type, str):
                test_type_enum = getattr(TestType, revision.test_type.upper())
            else:
                test_type_enum = revision.test_type
        
        # Handle priority conversion
        priority_enum = None
        if revision.priority:
            if isinstance(revision.priority, str):
                priority_enum = getattr(Priority, revision.priority.upper())
            else:
                priority_enum = revision.priority
        
        db_revision = TestCaseRevision(
            test_case_id=revision.test_case_id,
            revision_number=next_revision_number,
            title=revision.title,
            description=revision.description,
            test_type=test_type_enum,
            preconditions=revision.preconditions,
            steps=revision.steps,
            expected_result=revision.expected_result,
            priority=priority_enum,
            tags=revision.tags,
            changed_fields=revision.changed_fields,
            change_reason=revision.change_reason,
            created_by=revision.created_by
        )
        
        db.add(db_revision)
        safe_commit(db)
        db.refresh(db_revision)
        return db_revision
    except Exception as e:
        logger.warning(f"CRUD: Error creating revision: {e}")
        raise


# Test Management Settings CRUD functions

# Test Type Definition CRUD
def _normalize_definition_name(value: Optional[str]) -> str:
    return (value or "").strip().lower().replace("_", " ").replace("-", " ")


def _apply_test_type_usage_counts(db: Session, definitions: List[TestTypeDefinition]) -> List[TestTypeDefinition]:
    if not definitions:
        return definitions

    usage_rows = (
        db.query(TestCase.test_type, func.count(TestCase.id))
        .filter(TestCase.test_type.isnot(None))
        .group_by(TestCase.test_type)
        .all()
    )
    usage_by_name = {
        _normalize_definition_name(test_type): count
        for test_type, count in usage_rows
        if _normalize_definition_name(test_type)
    }

    for definition in definitions:
        set_committed_value(definition, "usage_count", usage_by_name.get(_normalize_definition_name(definition.name), 0))

    return definitions


def get_test_type_definitions(db: Session, skip: int = 0, limit: int = 100, project_id: Optional[int] = None):
    query = db.query(TestTypeDefinition).filter(TestTypeDefinition.is_active == True)
    if project_id is not None:
        query = query.filter(TestTypeDefinition.project_id == project_id)
    definitions = (
        query
        .order_by(TestTypeDefinition.project_seq, TestTypeDefinition.name)
        .offset(skip)
        .limit(limit)
        .all()
    )
    return _apply_test_type_usage_counts(db, definitions)


def get_test_type_definition(db: Session, test_type_id: int):
    definition = db.query(TestTypeDefinition).filter(TestTypeDefinition.id == test_type_id).first()
    if definition:
        _apply_test_type_usage_counts(db, [definition])
    return definition


def create_test_type_definition(db: Session, test_type: TestTypeDefinitionCreate):
    db_test_type = TestTypeDefinition(**test_type.model_dump())
    db.add(db_test_type)
    safe_commit(db)
    db.refresh(db_test_type)
    return db_test_type


def update_test_type_definition(db: Session, test_type_id: int, test_type: TestTypeDefinitionUpdate):
    db_test_type = db.query(TestTypeDefinition).filter(TestTypeDefinition.id == test_type_id).first()
    if db_test_type:
        update_data = test_type.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_test_type, field, value)
        safe_commit(db)
        db.refresh(db_test_type)
    return db_test_type


def delete_test_type_definition(db: Session, test_type_id: int):
    db_test_type = db.query(TestTypeDefinition).filter(TestTypeDefinition.id == test_type_id).first()
    if db_test_type:
        db_test_type.is_active = False
        safe_commit(db)
    return db_test_type


# Priority Definition CRUD
def get_priority_definitions(db: Session, skip: int = 0, limit: int = 100, project_id: Optional[int] = None):
    query = db.query(PriorityDefinition).filter(PriorityDefinition.is_active == True)
    if project_id is not None:
        query = query.filter(PriorityDefinition.project_id == project_id)
    return query.order_by(PriorityDefinition.value.desc()).offset(skip).limit(limit).all()


def get_priority_definition(db: Session, priority_id: int):
    return db.query(PriorityDefinition).filter(PriorityDefinition.id == priority_id).first()


def ensure_default_priority_and_test_type_definitions(db: Session, project_id: int, created_by: int):
    """
    Ensure default priority and test type definitions exist in the database.

    Backfills the standard set by *name* rather than checking ``count == 0``
    so that a single ad-hoc entry (e.g. an imported ``Lowest`` priority)
    doesn't keep the rest of the standard set from being seeded — which is
    what previously caused list-page filters to show only one option.

    Behavior contract:
    - Idempotent on name. Already-present standards (any case) are left alone.
    - Concurrency-safe. The seeder runs on every ``create_test_case`` so two
      simultaneous calls can race on the unique-name index; that's swallowed
      and we move on without poisoning the caller's transaction.
    - Default-aware. Standard defaults (``Medium`` priority, ``Manual`` test
      type) are only inserted as defaults when no other default already
      exists for that table, so existing user choices win.
    """
    default_priorities = [
        {"name": "Critical", "value": 4, "color": "#DC2626", "description": "Critical priority - immediate attention required", "is_default": False},
        {"name": "High", "value": 3, "color": "#F97316", "description": "High priority - urgent attention required", "is_default": False},
        {"name": "Medium", "value": 2, "color": "#F59E0B", "description": "Medium priority - normal attention required", "is_default": True},
        {"name": "Low", "value": 1, "color": "#6B7280", "description": "Low priority - can be addressed later", "is_default": False},
    ]
    existing_priority_names = {
        (name or "").strip().lower()
        for (name,) in db.query(PriorityDefinition.name).filter(PriorityDefinition.project_id == project_id).all()
    }
    priority_default_taken = db.query(PriorityDefinition.id).filter(
        PriorityDefinition.project_id == project_id, PriorityDefinition.is_default == True  # noqa: E712
    ).first() is not None
    for priority_data in default_priorities:
        if priority_data["name"].strip().lower() in existing_priority_names:
            continue
        payload = dict(priority_data)
        if priority_default_taken:
            payload["is_default"] = False
        try:
            priority = PriorityDefinitionCreate(**payload, project_id=project_id, created_by=created_by)
            create_priority_definition(db, priority)
            if payload.get("is_default"):
                priority_default_taken = True
        except (IntegrityError, OperationalError):
            # A concurrent caller seeded this set first. Either the unique-name
            # insert collided (IntegrityError) or the clear-existing-default
            # UPDATE conflicted with that concurrent write (OperationalError,
            # e.g. MariaDB 1020 "record has changed since last read"). Roll back
            # the failed statement only — don't poison the surrounding
            # transaction — and let a later read finish the seed.
            db.rollback()
            existing_priority_names.add(priority_data["name"].strip().lower())

    default_test_types = [
        {"name": "Manual", "description": "Manual testing - executed by human testers", "color": "#3B82F6", "icon": "🖱️"},
        {"name": "Automated", "description": "Automated testing - executed by scripts/tools", "color": "#10B981", "icon": "🤖"},
        {"name": "Smoke", "description": "Smoke testing - basic functionality checks", "color": "#6B7280", "icon": "💨"},
        {"name": "Regression", "description": "Regression testing - verify existing functionality", "color": "#F97316", "icon": "🔄"},
        {"name": "Integration", "description": "Integration testing - test component interactions", "color": "#8B5CF6", "icon": "🔗"},
        {"name": "Security", "description": "Security testing - identify vulnerabilities", "color": "#EF4444", "icon": "🔒"},
        {"name": "Performance", "description": "Performance testing - measure system performance", "color": "#F59E0B", "icon": "⚡"},
        {"name": "Usability", "description": "Usability testing - evaluate user experience", "color": "#EC4899", "icon": "👥"},
    ]
    existing_test_type_names = {
        (name or "").strip().lower()
        for (name,) in db.query(TestTypeDefinition.name).filter(TestTypeDefinition.project_id == project_id).all()
    }
    for test_type_data in default_test_types:
        if test_type_data["name"].strip().lower() in existing_test_type_names:
            continue
        try:
            test_type = TestTypeDefinitionCreate(**test_type_data, project_id=project_id, created_by=created_by)
            create_test_type_definition(db, test_type)
        except (IntegrityError, OperationalError):
            db.rollback()
            existing_test_type_names.add(test_type_data["name"].strip().lower())


def ensure_default_environment_definitions(db: Session, project_id: int, created_by: int):
    """
    Ensure default execution environments exist for a project.
    If they don't exist, create them automatically.
    """
    # Check if any environments exist for this project
    environment_count = db.query(ExecutionEnvironment).filter(ExecutionEnvironment.project_id == project_id).count()
    if environment_count == 0:
        # Create default execution environments
        default_environments = [
            {
                "name": "Development",
                "description": "Development environment for testing",
                "environment_type": "development",
                "config_data": {"url": "http://localhost:3000"},
                "build_info": {"version": "dev"},
                "is_active": True,
                "project_id": project_id
            },
            {
                "name": "Staging",
                "description": "Staging environment for pre-production testing",
                "environment_type": "staging",
                "config_data": {"url": "https://staging.example.com"},
                "build_info": {"version": "staging"},
                "is_active": True,
                "project_id": project_id
            },
            {
                "name": "Production",
                "description": "Production environment for live testing",
                "environment_type": "production",
                "config_data": {"url": "https://example.com"},
                "build_info": {"version": "prod"},
                "is_active": True,
                "project_id": project_id
            }
        ]
        for env_data in default_environments:
            create_execution_environment(db, env_data)


def create_priority_definition(db: Session, priority: PriorityDefinitionCreate):
    # If this is set as default, remove default from others in the same project
    if priority.is_default:
        db.query(PriorityDefinition).filter(
            PriorityDefinition.project_id == priority.project_id,
            PriorityDefinition.is_default == True,  # noqa: E712
        ).update({"is_default": False})
    
    db_priority = PriorityDefinition(**priority.model_dump())
    db.add(db_priority)
    safe_commit(db)
    db.refresh(db_priority)
    return db_priority


def update_priority_definition(db: Session, priority_id: int, priority: PriorityDefinitionUpdate):
    db_priority = db.query(PriorityDefinition).filter(PriorityDefinition.id == priority_id).first()
    if db_priority:
        update_data = priority.model_dump(exclude_unset=True)
        
        # If this is set as default, remove default from others *in the same
        # project*. Scoping to project_id is essential: priority catalogs are
        # per-project, so clearing the flag globally would wipe every other
        # project's default (matching create_priority_definition's behavior).
        if update_data.get("is_default", False):
            db.query(PriorityDefinition).filter(
                PriorityDefinition.project_id == db_priority.project_id,
                PriorityDefinition.is_default == True,  # noqa: E712
                PriorityDefinition.id != priority_id,
            ).update({"is_default": False})
        
        for field, value in update_data.items():
            setattr(db_priority, field, value)
        safe_commit(db)
        db.refresh(db_priority)
    return db_priority


def delete_priority_definition(db: Session, priority_id: int):
    db_priority = db.query(PriorityDefinition).filter(PriorityDefinition.id == priority_id).first()
    if db_priority:
        db_priority.is_active = False
        safe_commit(db)
    return db_priority


# Shared Step Template CRUD
def get_shared_step_templates(db: Session, skip: int = 0, limit: int = 100, project_id: Optional[int] = None):
    query = db.query(SharedStepTemplate).filter(SharedStepTemplate.is_active == True)
    if project_id is not None:
        query = query.filter(SharedStepTemplate.project_id == project_id)
    return query.offset(skip).limit(limit).all()


def get_shared_step_template(db: Session, template_id: int):
    return db.query(SharedStepTemplate).filter(
        SharedStepTemplate.id == template_id,
        SharedStepTemplate.is_active == True
    ).first()


def get_shared_step_template_by_name(db: Session, name: str):
    normalized_name = name.strip().lower()
    return db.query(SharedStepTemplate).filter(
        SharedStepTemplate.is_active == True,
        func.lower(SharedStepTemplate.name) == normalized_name
    ).first()


def create_shared_step_template(db: Session, template: dict):
    db_template = SharedStepTemplate(**template)
    db.add(db_template)
    safe_commit(db)
    db.refresh(db_template)
    return db_template


def update_shared_step_template(db: Session, template_id: int, template: dict):
    db_template = db.query(SharedStepTemplate).filter(
        SharedStepTemplate.id == template_id,
        SharedStepTemplate.is_active == True
    ).first()
    if db_template:
        for field, value in template.items():
            setattr(db_template, field, value)
        safe_commit(db)
        db.refresh(db_template)
    return db_template


def delete_shared_step_template(db: Session, template_id: int):
    db_template = db.query(SharedStepTemplate).filter(
        SharedStepTemplate.id == template_id,
        SharedStepTemplate.is_active == True
    ).first()
    if db_template:
        db_template.is_active = False
        safe_commit(db)
    return db_template


def increment_shared_step_template_usage(db: Session, template_id: int):
    db_template = db.query(SharedStepTemplate).filter(SharedStepTemplate.id == template_id).first()
    if db_template:
        db_template.usage_count += 1
        safe_commit(db)
    return db_template


# Test Execution Settings CRUD
def get_test_execution_settings(db: Session, project_id: Optional[int] = None):
    query = db.query(TestExecutionSettings)
    if project_id:
        query = query.filter(TestExecutionSettings.project_id == project_id)
    else:
        query = query.filter(TestExecutionSettings.project_id.is_(None))
    return query.first()


def create_test_execution_settings(db: Session, settings: TestExecutionSettingsCreate):
    db_settings = TestExecutionSettings(**settings.model_dump())
    db.add(db_settings)
    safe_commit(db)
    db.refresh(db_settings)
    return db_settings


def update_test_execution_settings(db: Session, settings_id: int, settings: TestExecutionSettingsUpdate):
    db_settings = db.query(TestExecutionSettings).filter(TestExecutionSettings.id == settings_id).first()
    if db_settings:
        update_data = settings.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_settings, field, value)
        safe_commit(db)
        db.refresh(db_settings)
    return db_settings


# Notification Settings CRUD
def get_notification_settings(db: Session, user_id: Optional[int] = None, project_id: Optional[int] = None):
    query = db.query(NotificationSettings)
    if user_id:
        query = query.filter(NotificationSettings.created_by == user_id)
    if project_id:
        query = query.filter(NotificationSettings.project_id == project_id)
    elif not user_id:
        query = query.filter(NotificationSettings.project_id.is_(None))
    return query.first()


def create_notification_settings(db: Session, settings: NotificationSettingsCreate):
    settings_dict = settings.model_dump()
    db_settings = NotificationSettings(**settings_dict)
    db.add(db_settings)
    safe_commit(db)
    db.refresh(db_settings)
    return db_settings


def update_notification_settings(db: Session, settings_id: int, settings: NotificationSettingsUpdate):
    db_settings = db.query(NotificationSettings).filter(NotificationSettings.id == settings_id).first()
    if db_settings:
        update_data = settings.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_settings, field, value)
        safe_commit(db)
        db.refresh(db_settings)
    return db_settings


# Automation Settings CRUD
def get_automation_settings(db: Session, project_id: Optional[int] = None):
    query = db.query(AutomationSettings)
    if project_id:
        query = query.filter(AutomationSettings.project_id == project_id)
    else:
        query = query.filter(AutomationSettings.project_id.is_(None))
    return query.first()


def create_automation_settings(db: Session, settings: AutomationSettingsCreate):
    settings_dict = settings.model_dump()
    db_settings = AutomationSettings(**settings_dict)
    db.add(db_settings)
    safe_commit(db)
    db.refresh(db_settings)
    return db_settings


def update_automation_settings(db: Session, settings_id: int, settings: AutomationSettingsUpdate):
    db_settings = db.query(AutomationSettings).filter(AutomationSettings.id == settings_id).first()
    if db_settings:
        update_data = settings.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_settings, field, value)
        safe_commit(db)
        db.refresh(db_settings)
    return db_settings


# System Settings CRUD
def get_system_setting(db: Session, key: str):
    return db.query(SystemSettings).filter(SystemSettings.key == key).first()


def get_system_settings(db: Session, skip: int = 0, limit: int = 100):
    return db.query(SystemSettings).offset(skip).limit(limit).all()


def create_system_setting(db: Session, setting: SystemSettingsCreate):
    # Check if setting with this key already exists
    existing = db.query(SystemSettings).filter(SystemSettings.key == setting.key).first()
    if existing:
        return None  # Return None to indicate duplicate key
    
    setting_dict = setting.model_dump()
    db_setting = SystemSettings(**setting_dict)
    db.add(db_setting)
    safe_commit(db)
    db.refresh(db_setting)
    return db_setting


def update_system_setting(db: Session, key: str, setting: SystemSettingsUpdate):
    db_setting = db.query(SystemSettings).filter(SystemSettings.key == key).first()
    if db_setting:
        update_data = setting.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_setting, field, value)
        safe_commit(db)
        db.refresh(db_setting)
    return db_setting


def delete_system_setting(db: Session, key: str):
    db_setting = db.query(SystemSettings).filter(SystemSettings.key == key).first()
    if db_setting:
        db.delete(db_setting)
        safe_commit(db)
    return db_setting
