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

def create_test_case_section(db: Session, section: TestCaseSectionCreate):
    db_section = TestCaseSection(**section.model_dump())
    db.add(db_section)
    safe_commit(db)
    db.refresh(db_section)
    return db_section


def get_test_case_sections(db: Session, test_suite_id: int = None, parent_section_id: int = None, skip: int = 0, limit: int = 100):
    query = db.query(TestCaseSection)
    if test_suite_id:
        query = query.filter(TestCaseSection.test_suite_id == test_suite_id)
    if parent_section_id is not None:
        query = query.filter(TestCaseSection.parent_section_id == parent_section_id)
    return query.offset(skip).limit(limit).all()


def get_test_case_section(db: Session, section_id: int):
    return db.query(TestCaseSection).filter(TestCaseSection.id == section_id).first()


def update_test_case_section(db: Session, section_id: int, section: TestCaseSectionUpdate):
    db_section = db.query(TestCaseSection).filter(TestCaseSection.id == section_id).first()
    if db_section:
        update_data = section.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_section, field, value)
        safe_commit(db)
        db.refresh(db_section)
    return db_section


def delete_test_case_section(db: Session, section_id: int):
    db_section = db.query(TestCaseSection).filter(TestCaseSection.id == section_id).first()
    if db_section:
        db.delete(db_section)
        safe_commit(db)
    return db_section


# Shared Step CRUD functions
def create_shared_step(db: Session, step: dict):
    db_step = SharedStep(**step)
    db.add(db_step)
    safe_commit(db)
    db.refresh(db_step)
    return db_step


def get_shared_steps(
    db: Session,
    project_id: Optional[int] = None,
    project_ids: Optional[List[int]] = None,
    skip: int = 0,
    limit: int = 100,
):
    query = db.query(SharedStep).filter(SharedStep.is_active == True)
    if project_id is not None:
        query = query.filter(SharedStep.project_id == project_id)
    elif project_ids is not None:
        if not project_ids:
            return []
        query = query.filter(SharedStep.project_id.in_(project_ids))
    return query.order_by(SharedStep.usage_count.desc()).offset(skip).limit(limit).all()


def get_shared_step(db: Session, step_id: int):
    return db.query(SharedStep).filter(SharedStep.id == step_id, SharedStep.is_active == True).first()


def update_shared_step(db: Session, step_id: int, step: dict):
    db_step = db.query(SharedStep).filter(SharedStep.id == step_id).first()
    if db_step:
        for key, value in step.items():
            setattr(db_step, key, value)
        safe_commit(db)
        db.refresh(db_step)
    return db_step


def delete_shared_step(db: Session, step_id: int):
    db_step = db.query(SharedStep).filter(SharedStep.id == step_id).first()
    if db_step:
        db_step.is_active = False
        safe_commit(db)
        db.refresh(db_step)
    return db_step


def increment_shared_step_usage(db: Session, step_id: int):
    db_step = db.query(SharedStep).filter(SharedStep.id == step_id, SharedStep.is_active == True).first()
    if db_step:
        db_step.usage_count += 1
        safe_commit(db)
        db.refresh(db_step)
    return db_step


# Global Parameter CRUD functions
def create_global_parameter(db: Session, parameter: dict):
    # Pop value and assign it last so ``is_encrypted`` is already set on the
    # instance when the value setter decides whether to encrypt.
    data = dict(parameter)
    raw_value = data.pop("value", None)
    db_param = GlobalParameter(**data)
    db_param.value = raw_value
    db.add(db_param)
    safe_commit(db)
    db.refresh(db_param)
    return db_param


def get_global_parameters(db: Session, project_id: int = None, skip: int = 0, limit: int = 100):
    query = db.query(GlobalParameter).filter(GlobalParameter.is_active == True)
    if project_id is None:
        # Global parameters (project_id is null)
        query = query.filter(GlobalParameter.project_id.is_(None))
    else:
        # Project-specific parameters
        query = query.filter(GlobalParameter.project_id == project_id)
    return query.order_by(GlobalParameter.name).offset(skip).limit(limit).all()


def get_global_parameter(db: Session, param_id: int):
    return db.query(GlobalParameter).filter(GlobalParameter.id == param_id, GlobalParameter.is_active == True).first()


def get_global_parameter_by_name(db: Session, name: str, project_id: int = None):
    query = db.query(GlobalParameter).filter(GlobalParameter.name == name, GlobalParameter.is_active == True)
    if project_id is None:
        query = query.filter(GlobalParameter.project_id.is_(None))
    else:
        query = query.filter(GlobalParameter.project_id == project_id)
    return query.first()


def update_global_parameter(db: Session, param_id: int, parameter: dict):
    db_param = db.query(GlobalParameter).filter(GlobalParameter.id == param_id).first()
    if db_param:
        old_encrypted = bool(db_param.is_encrypted)
        # Snapshot current plaintext (getter decrypts using the OLD flag) before
        # any mutation, in case the encryption mode is being toggled.
        current_plain = db_param.value
        value_provided = "value" in parameter
        new_value = parameter.get("value")

        # Apply every field except value first, so ``is_encrypted`` is current
        # before the value setter runs.
        for key, val in parameter.items():
            if key == "value":
                continue
            setattr(db_param, key, val)

        new_encrypted = bool(db_param.is_encrypted)
        if value_provided:
            db_param.value = new_value
        elif new_encrypted != old_encrypted:
            # Encryption toggled without a new value — re-store the existing
            # plaintext under the new mode (encrypt it, or decrypt back to plain).
            db_param.value = current_plain

        safe_commit(db)
        db.refresh(db_param)
    return db_param


def delete_global_parameter(db: Session, param_id: int):
    db_param = db.query(GlobalParameter).filter(GlobalParameter.id == param_id).first()
    if db_param:
        # Hard delete so the (project_id, name) slot frees up for reuse. Nothing
        # references a parameter by FK, so this is safe.
        db.delete(db_param)
        safe_commit(db)
    return db_param


# Test Dataset (case-level parameterization) CRUD functions
def create_test_dataset(db: Session, dataset: dict):
    db_dataset = TestDataset(**dataset)
    db.add(db_dataset)
    safe_commit(db)
    db.refresh(db_dataset)
    return db_dataset


def get_test_datasets(db: Session, project_id: int, skip: int = 0, limit: int = 500):
    return (
        db.query(TestDataset)
        .filter(TestDataset.project_id == project_id, TestDataset.is_active == True)
        .order_by(TestDataset.name)
        .offset(skip)
        .limit(limit)
        .all()
    )


def get_test_dataset(db: Session, dataset_id: int):
    return (
        db.query(TestDataset)
        .filter(TestDataset.id == dataset_id, TestDataset.is_active == True)
        .first()
    )


def get_test_dataset_by_name(db: Session, name: str, project_id: int):
    return (
        db.query(TestDataset)
        .filter(
            TestDataset.name == name,
            TestDataset.project_id == project_id,
            TestDataset.is_active == True,
        )
        .first()
    )


def update_test_dataset(db: Session, dataset_id: int, dataset: dict):
    db_dataset = db.query(TestDataset).filter(TestDataset.id == dataset_id).first()
    if db_dataset:
        for key, value in dataset.items():
            setattr(db_dataset, key, value)
        safe_commit(db)
        db.refresh(db_dataset)
    return db_dataset


def delete_test_dataset(db: Session, dataset_id: int):
    db_dataset = db.query(TestDataset).filter(TestDataset.id == dataset_id).first()
    if db_dataset:
        # Detach from any cases pointing at it, then hard-delete. A hard delete
        # is safe because nothing else references a dataset (results snapshot
        # row values inline), and it frees the (project_id, name) unique slot so
        # the same name can be reused.
        db.query(TestCase).filter(TestCase.dataset_id == dataset_id).update(
            {TestCase.dataset_id: None}
        )
        db.delete(db_dataset)
        safe_commit(db)
    return db_dataset


# Test Mindmap CRUD functions
def create_test_mindmap(db: Session, mindmap: dict):
    db_mindmap = TestMindmap(**mindmap)
    db.add(db_mindmap)
    safe_commit(db)
    db.refresh(db_mindmap)
    return db_mindmap


def get_test_mindmaps(db: Session, project_id: int = None, skip: int = 0, limit: int = 100):
    query = db.query(TestMindmap).filter(TestMindmap.is_active == True)
    if project_id:
        query = query.filter(TestMindmap.project_id == project_id)
    return query.order_by(TestMindmap.name).offset(skip).limit(limit).all()


def get_test_mindmap(db: Session, mindmap_id: int):
    return db.query(TestMindmap).filter(TestMindmap.id == mindmap_id, TestMindmap.is_active == True).first()


def update_test_mindmap(db: Session, mindmap_id: int, mindmap: dict):
    db_mindmap = db.query(TestMindmap).filter(TestMindmap.id == mindmap_id).first()
    if db_mindmap:
        for key, value in mindmap.items():
            setattr(db_mindmap, key, value)
        safe_commit(db)
        db.refresh(db_mindmap)
    return db_mindmap


def delete_test_mindmap(db: Session, mindmap_id: int):
    db_mindmap = db.query(TestMindmap).filter(TestMindmap.id == mindmap_id).first()
    if db_mindmap:
        db_mindmap.is_active = False
        safe_commit(db)
        db.refresh(db_mindmap)
    return db_mindmap


# Impact Analysis CRUD functions
def create_impact_analysis(db: Session, analysis: dict):
    db_analysis = ImpactAnalysis(**analysis)
    db.add(db_analysis)
    safe_commit(db)
    db.refresh(db_analysis)
    return db_analysis


def get_impact_analyses(db: Session, project_id: int = None, entity_type: str = None, entity_id: int = None, skip: int = 0, limit: int = 100):
    query = db.query(ImpactAnalysis)
    if project_id:
        query = query.filter(ImpactAnalysis.project_id == project_id)
    if entity_type:
        query = query.filter(ImpactAnalysis.entity_type == entity_type)
    if entity_id:
        query = query.filter(ImpactAnalysis.entity_id == entity_id)
    return query.order_by(ImpactAnalysis.created_at.desc()).offset(skip).limit(limit).all()


def get_impact_analysis(db: Session, analysis_id: int):
    return db.query(ImpactAnalysis).filter(ImpactAnalysis.id == analysis_id).first()


def update_impact_analysis(db: Session, analysis_id: int, analysis: dict):
    db_analysis = db.query(ImpactAnalysis).filter(ImpactAnalysis.id == analysis_id).first()
    if db_analysis:
        for key, value in analysis.items():
            setattr(db_analysis, key, value)
        safe_commit(db)
        db.refresh(db_analysis)
    return db_analysis


def delete_impact_analysis(db: Session, analysis_id: int):
    db_analysis = db.query(ImpactAnalysis).filter(ImpactAnalysis.id == analysis_id).first()
    if db_analysis:
        db.delete(db_analysis)
        safe_commit(db)
    return db_analysis


# Execution Environment CRUD
def get_execution_environments(db: Session, project_id: int = None):
    query = db.query(ExecutionEnvironment)
    if project_id:
        query = query.filter(ExecutionEnvironment.project_id == project_id)
    return query.all()


def get_execution_environment(db: Session, environment_id: int):
    return db.query(ExecutionEnvironment).filter(ExecutionEnvironment.id == environment_id).first()


def create_execution_environment(db: Session, environment: dict):
    db_environment = ExecutionEnvironment(**environment)
    db.add(db_environment)
    safe_commit(db)
    db.refresh(db_environment)
    return db_environment


def update_execution_environment(db: Session, environment_id: int, environment: dict):
    db_environment = db.query(ExecutionEnvironment).filter(ExecutionEnvironment.id == environment_id).first()
    if db_environment:
        for key, value in environment.items():
            setattr(db_environment, key, value)
        safe_commit(db)
        db.refresh(db_environment)
    return db_environment


def delete_execution_environment(db: Session, environment_id: int):
    db_environment = db.query(ExecutionEnvironment).filter(ExecutionEnvironment.id == environment_id).first()
    if db_environment:
        db.delete(db_environment)
        safe_commit(db)
    return db_environment


# Test Schedule CRUD
def get_test_schedules(db: Session, project_id: int = None):
    query = db.query(TestSchedule)
    if project_id:
        query = query.filter(TestSchedule.project_id == project_id)
    return query.all()


def get_test_schedule(db: Session, schedule_id: int):
    return db.query(TestSchedule).filter(TestSchedule.id == schedule_id).first()


def create_test_schedule(db: Session, schedule: dict):
    db_schedule = TestSchedule(**schedule)
    db.add(db_schedule)
    safe_commit(db)
    db.refresh(db_schedule)
    return db_schedule


def update_test_schedule(db: Session, schedule_id: int, schedule: dict):
    db_schedule = db.query(TestSchedule).filter(TestSchedule.id == schedule_id).first()
    if db_schedule:
        for key, value in schedule.items():
            setattr(db_schedule, key, value)
        safe_commit(db)
        db.refresh(db_schedule)
    return db_schedule


def delete_test_schedule(db: Session, schedule_id: int):
    db_schedule = db.query(TestSchedule).filter(TestSchedule.id == schedule_id).first()
    if db_schedule:
        db.delete(db_schedule)
        safe_commit(db)
    return db_schedule


# Execution Engine CRUD
def get_execution_engines(db: Session):
    return db.query(ExecutionEngine).filter(ExecutionEngine.is_active == True).all()


def get_execution_engine(db: Session, engine_id: int):
    return db.query(ExecutionEngine).filter(ExecutionEngine.id == engine_id).first()


def create_execution_engine(db: Session, engine: dict):
    db_engine = ExecutionEngine(**engine)
    db.add(db_engine)
    safe_commit(db)
    db.refresh(db_engine)
    return db_engine


def update_execution_engine(db: Session, engine_id: int, engine: dict):
    db_engine = db.query(ExecutionEngine).filter(ExecutionEngine.id == engine_id).first()
    if db_engine:
        for key, value in engine.items():
            setattr(db_engine, key, value)
        safe_commit(db)
        db.refresh(db_engine)
    return db_engine


def delete_execution_engine(db: Session, engine_id: int):
    db_engine = db.query(ExecutionEngine).filter(ExecutionEngine.id == engine_id).first()
    if db_engine:
        db.delete(db_engine)
        safe_commit(db)
    return db_engine


# Execution Log CRUD
def get_execution_logs(db: Session, test_run_id: int = None, test_result_id: int = None):
    query = db.query(ExecutionLog)
    if test_run_id:
        query = query.filter(ExecutionLog.test_run_id == test_run_id)
    if test_result_id:
        query = query.filter(ExecutionLog.test_result_id == test_result_id)
    return query.order_by(ExecutionLog.timestamp.desc()).all()


def create_execution_log(db: Session, log: dict):
    db_log = ExecutionLog(**log)
    db.add(db_log)
    safe_commit(db)
    db.refresh(db_log)
    return db_log


# Test Run Environment CRUD
def get_test_run_environments(db: Session, test_run_id: int):
    return db.query(TestRunEnvironment).filter(TestRunEnvironment.test_run_id == test_run_id).all()


def create_test_run_environment(db: Session, test_run_environment: dict):
    db_test_run_env = TestRunEnvironment(**test_run_environment)
    db.add(db_test_run_env)
    safe_commit(db)
    db.refresh(db_test_run_env)
    return db_test_run_env


# Enhanced Defect Management CRUD

# Defect Comments
def get_defect_comments(db: Session, defect_id: int):
    return db.query(DefectComment).filter(DefectComment.defect_id == defect_id).order_by(DefectComment.created_at.desc()).all()


def create_defect_comment(db: Session, comment: dict):
    db_comment = DefectComment(**comment)
    db.add(db_comment)
    safe_commit(db)
    db.refresh(db_comment)
    return db_comment


def update_defect_comment(db: Session, comment_id: int, comment: dict):
    db_comment = db.query(DefectComment).filter(DefectComment.id == comment_id).first()
    if db_comment:
        for key, value in comment.items():
            setattr(db_comment, key, value)
        safe_commit(db)
        db.refresh(db_comment)
    return db_comment


def delete_defect_comment(db: Session, comment_id: int):
    db_comment = db.query(DefectComment).filter(DefectComment.id == comment_id).first()
    if db_comment:
        db.delete(db_comment)
        safe_commit(db)
    return db_comment


# Defect Attachments
def get_defect_attachments(db: Session, defect_id: int):
    return db.query(DefectAttachment).filter(DefectAttachment.defect_id == defect_id).order_by(DefectAttachment.uploaded_at.desc()).all()


def create_defect_attachment(db: Session, attachment: dict):
    db_attachment = DefectAttachment(**attachment)
    db.add(db_attachment)
    safe_commit(db)
    db.refresh(db_attachment)
    return db_attachment


def delete_defect_attachment(db: Session, attachment_id: int):
    db_attachment = db.query(DefectAttachment).filter(DefectAttachment.id == attachment_id).first()
    if db_attachment:
        db.delete(db_attachment)
        safe_commit(db)
    return db_attachment


# Defect History
def get_defect_history(db: Session, defect_id: int):
    return db.query(DefectHistory).filter(DefectHistory.defect_id == defect_id).order_by(DefectHistory.created_at.desc()).all()


def create_defect_history(db: Session, history: dict):
    db_history = DefectHistory(**history)
    db.add(db_history)
    safe_commit(db)
    db.refresh(db_history)
    return db_history


# Defect Workflows
def get_defect_workflows(db: Session, project_id: int):
    return db.query(DefectWorkflow).filter(DefectWorkflow.project_id == project_id).all()


def get_default_defect_workflow(db: Session, project_id: int):
    return db.query(DefectWorkflow).filter(DefectWorkflow.project_id == project_id, DefectWorkflow.is_default == True).first()


def create_defect_workflow(db: Session, workflow: dict):
    db_workflow = DefectWorkflow(**workflow)
    db.add(db_workflow)
    safe_commit(db)
    db.refresh(db_workflow)
    return db_workflow


def update_defect_workflow(db: Session, workflow_id: int, workflow: dict):
    db_workflow = db.query(DefectWorkflow).filter(DefectWorkflow.id == workflow_id).first()
    if db_workflow:
        for key, value in workflow.items():
            setattr(db_workflow, key, value)
        safe_commit(db)
        db.refresh(db_workflow)
    return db_workflow


def delete_defect_workflow(db: Session, workflow_id: int):
    db_workflow = db.query(DefectWorkflow).filter(DefectWorkflow.id == workflow_id).first()
    if db_workflow:
        db.delete(db_workflow)
        safe_commit(db)
    return db_workflow


# Defect Templates
def get_defect_templates(db: Session, project_id: int):
    return db.query(DefectTemplate).filter(DefectTemplate.project_id == project_id, DefectTemplate.is_active == True).all()


def get_defect_template(db: Session, template_id: int):
    return db.query(DefectTemplate).filter(DefectTemplate.id == template_id).first()


def create_defect_template(db: Session, template: dict):
    db_template = DefectTemplate(**template)
    db.add(db_template)
    safe_commit(db)
    db.refresh(db_template)
    return db_template


def update_defect_template(db: Session, template_id: int, template: dict):
    db_template = db.query(DefectTemplate).filter(DefectTemplate.id == template_id).first()
    if db_template:
        for key, value in template.items():
            setattr(db_template, key, value)
        safe_commit(db)
        db.refresh(db_template)
    return db_template


def delete_defect_template(db: Session, template_id: int):
    db_template = db.query(DefectTemplate).filter(DefectTemplate.id == template_id).first()
    if db_template:
        db.delete(db_template)
        safe_commit(db)
    return db_template


# Issue Tracker Integrations
def get_issue_tracker_integrations(db: Session, project_id: int):
    return db.query(IssueTrackerIntegration).filter(IssueTrackerIntegration.project_id == project_id).all()


def get_issue_tracker_integration(db: Session, integration_id: int):
    return db.query(IssueTrackerIntegration).filter(IssueTrackerIntegration.id == integration_id).first()


def create_issue_tracker_integration(db: Session, integration: dict):
    db_integration = IssueTrackerIntegration(**integration)
    db.add(db_integration)
    safe_commit(db)
    db.refresh(db_integration)
    return db_integration


def update_issue_tracker_integration(db: Session, integration_id: int, integration: dict):
    db_integration = db.query(IssueTrackerIntegration).filter(IssueTrackerIntegration.id == integration_id).first()
    if db_integration:
        for key, value in integration.items():
            setattr(db_integration, key, value)
        safe_commit(db)
        db.refresh(db_integration)
    return db_integration


def delete_issue_tracker_integration(db: Session, integration_id: int):
    db_integration = db.query(IssueTrackerIntegration).filter(IssueTrackerIntegration.id == integration_id).first()
    if db_integration:
        db.delete(db_integration)
        safe_commit(db)
    return db_integration


# Sync Logs
def get_sync_logs(db: Session, integration_id: int = None, limit: int = 100):
    query = db.query(SyncLog)
    if integration_id:
        query = query.filter(SyncLog.integration_id == integration_id)
    return query.order_by(SyncLog.started_at.desc()).limit(limit).all()


def create_sync_log(db: Session, log: dict):
    db_log = SyncLog(**log)
    db.add(db_log)
    safe_commit(db)
    db.refresh(db_log)
    return db_log


# Enhanced Defect Functions
def get_defects_with_relations(db: Session, project_id: int = None):
    query = db.query(Defect)
    if project_id:
        query = query.filter(Defect.project_id == project_id)
    return query.all()


def update_defect_with_history(db: Session, defect_id: int, defect_data: dict, user_id: int, change_reason: str = None):
    db_defect = db.query(Defect).filter(Defect.id == defect_id).first()
    if db_defect:
        # Track changes
        for field, new_value in defect_data.items():
            old_value = getattr(db_defect, field, None)
            if old_value != new_value:
                history = {
                    'defect_id': defect_id,
                    'user_id': user_id,
                    'field_name': field,
                    'old_value': str(old_value) if old_value is not None else None,
                    'new_value': str(new_value) if new_value is not None else None,
                    'change_reason': change_reason
                }
                create_defect_history(db, history)
        
        # Update defect
        for key, value in defect_data.items():
            setattr(db_defect, key, value)
        
        safe_commit(db)
        db.refresh(db_defect)
    return db_defect
