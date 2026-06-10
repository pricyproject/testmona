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
import logging

logger = logging.getLogger(__name__)

def get_custom_field_definition(db: Session, field_id: int):
    return db.query(CustomFieldDefinition).filter(CustomFieldDefinition.id == field_id).first()


def get_custom_field_definitions(db: Session, project_id: int, skip: int = 0, limit: int = 100):
    return db.query(CustomFieldDefinition).filter(CustomFieldDefinition.project_id == project_id).offset(skip).limit(limit).all()


def create_custom_field_definition(db: Session, field: CustomFieldDefinitionCreate, user_id: Optional[int] = None):
    field_dict = field.model_dump()
    
    # Generate slug if not provided
    if not field_dict.get('slug'):
        import re
        slug = field_dict['name'].lower()
        slug = re.sub(r'[^a-z0-9]+', '_', slug)
        slug = slug.strip('_')
        field_dict['slug'] = slug
    
    db_field = CustomFieldDefinition(**field_dict)
    db.add(db_field)
    safe_commit(db)
    db.refresh(db_field)
    
    # Create audit trail
    try:
        from ..services.audit_service import get_audit_service
        from ..schemas_audit import AuditTrailCreate
        audit_service = get_audit_service(db)
        audit_data = AuditTrailCreate(
            user_id=user_id,
            action="create",
            entity_type=EntityType.CUSTOM_FIELD,
            entity_id=db_field.id,
            project_id=db_field.project_id,
            description=f"Created custom field definition '{db_field.name}' in project {db_field.project_id}",
            ip_address=None,
            user_agent=None
        )
        audit_service.create_audit_trail(audit_data)
    except Exception as e:
        logger.warning(f"Failed to create audit trail for custom field definition: {e}")
    
    return db_field


def update_custom_field_definition(db: Session, field_id: int, field: CustomFieldDefinitionUpdate, user_id: Optional[int] = None):
    db_field = db.query(CustomFieldDefinition).filter(CustomFieldDefinition.id == field_id).first()
    if db_field:
        update_data = field.model_dump(exclude_unset=True)
        
        # Check if is_required is being changed from False to True
        if 'is_required' in update_data and update_data['is_required'] == True and db_field.is_required == False:
            # Validate that all test cases in the project have values for this field
            from ..models import TestCase
            test_cases = db.query(TestCase).filter(TestCase.project_id == db_field.project_id).all()
            
            # If there are no test cases, allow the change
            if test_cases:
                # Get all test case IDs that have values for this field
                test_case_ids_with_values = db.query(CustomFieldValue.test_case_id).filter(
                    CustomFieldValue.field_definition_id == field_id
                ).all()
                test_case_ids_with_values = set([tc_id[0] for tc_id in test_case_ids_with_values])
                
                # Find test cases without values
                test_cases_without_values = [tc for tc in test_cases if tc.id not in test_case_ids_with_values]
                
                if test_cases_without_values:
                    raise ValueError(
                        f"Cannot make field required. {len(test_cases_without_values)} test case(s) lack values for this field. "
                        f"Please provide values for all test cases before making the field required."
                    )
        
        # If name is being updated but slug is not provided, regenerate slug
        if 'name' in update_data and 'slug' not in update_data:
            import re
            slug = update_data['name'].lower()
            slug = re.sub(r'[^a-z0-9]+', '_', slug)
            slug = slug.strip('_')
            update_data['slug'] = slug
        
        for key, value in update_data.items():
            setattr(db_field, key, value)
        safe_commit(db)
        db.refresh(db_field)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            audit_service = get_audit_service(db)
            changes = ', '.join([f"{k}={v}" for k, v in update_data.items()])
            audit_data = AuditTrailCreate(
                user_id=user_id,
                action="update",
                entity_type=EntityType.CUSTOM_FIELD,
                entity_id=db_field.id,
                project_id=db_field.project_id,
                description=f"Updated custom field definition '{db_field.name}' in project {db_field.project_id}. Changes: {changes}",
                ip_address=None,
                user_agent=None
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            logger.warning(f"Failed to create audit trail for custom field definition update: {e}")
        
        return db_field


def delete_custom_field_definition(db: Session, field_id: int, user_id: Optional[int] = None):
    db_field = db.query(CustomFieldDefinition).filter(CustomFieldDefinition.id == field_id).first()
    if db_field:
        field_name = db_field.name
        project_id = db_field.project_id
        db.delete(db_field)
        safe_commit(db)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=user_id,
                action="delete",
                entity_type=EntityType.CUSTOM_FIELD,
                entity_id=field_id,
                project_id=project_id,
                description=f"Deleted custom field definition '{field_name}' from project {project_id}",
                ip_address=None,
                user_agent=None
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            logger.warning(f"Failed to create audit trail for custom field definition delete: {e}")
    
    return db_field


# Custom Field Value CRUD
def get_custom_field_value(db: Session, value_id: int):
    return db.query(CustomFieldValue).filter(CustomFieldValue.id == value_id).first()


_CUSTOM_FIELD_ENTITY_COLUMNS = {
    "test_case": "test_case_id",
    "test_run": "test_run_id",
    "defect": "defect_id",
    "requirement": "requirement_id",
}


def get_custom_field_values(
    db: Session,
    test_case_id: Optional[int] = None,
    field_definition_id: Optional[int] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[int] = None,
    test_run_id: Optional[int] = None,
    defect_id: Optional[int] = None,
    requirement_id: Optional[int] = None,
):
    """Fetch custom field values, filterable by any of the four entity owners.

    Callers can use either the legacy keyword (``test_case_id``) or the
    polymorphic pair (``entity_type``, ``entity_id``).
    """
    query = db.query(CustomFieldValue)
    if test_case_id is not None:
        query = query.filter(CustomFieldValue.test_case_id == test_case_id)
    if test_run_id is not None:
        query = query.filter(CustomFieldValue.test_run_id == test_run_id)
    if defect_id is not None:
        query = query.filter(CustomFieldValue.defect_id == defect_id)
    if requirement_id is not None:
        query = query.filter(CustomFieldValue.requirement_id == requirement_id)
    if entity_type and entity_id is not None:
        column_name = _CUSTOM_FIELD_ENTITY_COLUMNS.get(entity_type)
        if column_name:
            query = query.filter(getattr(CustomFieldValue, column_name) == entity_id)
    if field_definition_id:
        query = query.filter(CustomFieldValue.field_definition_id == field_definition_id)
    return query.all()


def _resolve_custom_field_owner(db: Session, value):
    """Return ``(entity_type, project_id)`` for whichever entity owns the
    value. Raises ``ValueError`` if no owner or the owner can't be
    resolved to a project.
    """
    from ..models import TestCase, TestRun, Defect, Requirement, TestSuite

    if value.test_case_id is not None:
        owner = db.query(TestCase).filter(TestCase.id == value.test_case_id).first()
        if not owner:
            raise ValueError(f"Test case {value.test_case_id} not found")
        suite = db.query(TestSuite).filter(TestSuite.id == owner.test_suite_id).first()
        return "test_case", (suite.project_id if suite else None)
    if value.test_run_id is not None:
        owner = db.query(TestRun).filter(TestRun.id == value.test_run_id).first()
        if not owner:
            raise ValueError(f"Test run {value.test_run_id} not found")
        return "test_run", owner.project_id
    if value.defect_id is not None:
        owner = db.query(Defect).filter(Defect.id == value.defect_id).first()
        if not owner:
            raise ValueError(f"Defect {value.defect_id} not found")
        return "defect", owner.project_id
    if value.requirement_id is not None:
        owner = db.query(Requirement).filter(Requirement.id == value.requirement_id).first()
        if not owner:
            raise ValueError(f"Requirement {value.requirement_id} not found")
        return "requirement", owner.project_id
    raise ValueError("Custom field value has no entity owner")


def _format_custom_field_value_owner(value: CustomFieldValue) -> str:
    if value.test_case_id is not None:
        return f"test_case={value.test_case_id}"
    if value.test_run_id is not None:
        return f"test_run={value.test_run_id}"
    if value.defect_id is not None:
        return f"defect={value.defect_id}"
    if value.requirement_id is not None:
        return f"requirement={value.requirement_id}"
    return "unknown entity"


def field_definition_applies_to(field_definition: CustomFieldDefinition, entity_type: str) -> bool:
    """Whether a definition is applicable to the given entity type.

    Legacy definitions (``entity_types`` NULL/empty) implicitly apply to
    test cases only, matching the pre-unification behavior so existing
    data and queries keep working.
    """
    if not field_definition.entity_types:
        return entity_type == "test_case"
    return entity_type in field_definition.entity_types


def validate_custom_field_value(value: Optional[str], field_definition: CustomFieldDefinition) -> Optional[str]:
    """
    Validate a custom field value against its definition's validation rules.
    Returns error message if validation fails, None if valid.
    """
    value_str = "" if value is None else str(value)
    normalized_value = value_str.strip()

    # For boolean fields, "true"/"false" are both valid explicit values.
    if field_definition.field_type == CustomFieldType.BOOLEAN:
        if normalized_value == "":
            return None if not field_definition.is_required else f"Field '{field_definition.name}' is required"
        if normalized_value.lower() not in {"true", "false"}:
            return f"Field '{field_definition.name}' must be either true or false"
        return None

    if normalized_value == "":
        return None if not field_definition.is_required else f"Field '{field_definition.name}' is required"
    
    # Apply validation rules
    if field_definition.validation_rules:
        rules = field_definition.validation_rules
        field_type = field_definition.field_type
        
        if field_type == CustomFieldType.TEXT:
            min_length = rules.get('min_length')
            max_length = rules.get('max_length')
            regex_pattern = rules.get('regex_pattern')
            
            if min_length and len(value_str) < min_length:
                return f"Field '{field_definition.name}' too short. Minimum length: {min_length}"
            
            if max_length and len(value_str) > max_length:
                return f"Field '{field_definition.name}' too long. Maximum length: {max_length}"
            
            if regex_pattern:
                try:
                    if not re.match(regex_pattern, value_str):
                        return f"Field '{field_definition.name}' does not match required pattern"
                except re.error:
                    pass  # Pattern validation already done at definition level
        
        elif field_type == CustomFieldType.NUMBER:
            try:
                num_value = float(value_str)
                min_value = rules.get('min_value')
                max_value = rules.get('max_value')
                integer_only = rules.get('integer_only', False)
                
                if integer_only and not value_str.isdigit() and not (value_str.startswith('-') and value_str[1:].isdigit()):
                    return f"Field '{field_definition.name}' must be an integer"
                
                if min_value is not None and num_value < min_value:
                    return f"Field '{field_definition.name}' too small. Minimum value: {min_value}"
                
                if max_value is not None and num_value > max_value:
                    return f"Field '{field_definition.name}' too large. Maximum value: {max_value}"
            except ValueError:
                return f"Field '{field_definition.name}' must be a valid number"
        
        elif field_type == CustomFieldType.DATE:
            try:
                from datetime import datetime
                date_value = datetime.fromisoformat(value_str)
                min_date = rules.get('min_date')
                max_date = rules.get('max_date')
                future_only = rules.get('future_only', False)
                past_only = rules.get('past_only', False)
                
                if min_date:
                    min_dt = datetime.fromisoformat(min_date)
                    if date_value < min_dt:
                        return f"Field '{field_definition.name}' must be after {min_date}"
                
                if max_date:
                    max_dt = datetime.fromisoformat(max_date)
                    if date_value > max_dt:
                        return f"Field '{field_definition.name}' must be before {max_date}"
                
                if future_only and date_value <= datetime.now():
                    return f"Field '{field_definition.name}' must be a future date"
                
                if past_only and date_value >= datetime.now():
                    return f"Field '{field_definition.name}' must be a past date"
            except ValueError:
                return f"Field '{field_definition.name}' must be a valid date in ISO format (YYYY-MM-DD)"
        
        elif field_type in [CustomFieldType.SELECT, CustomFieldType.MULTISELECT]:
            min_length = rules.get('min_length')
            max_length = rules.get('max_length')
            
            if min_length and len(value_str) < min_length:
                return f"Field '{field_definition.name}' too short. Minimum length: {min_length}"
            
            if max_length and len(value_str) > max_length:
                return f"Field '{field_definition.name}' too long. Maximum length: {max_length}"
            
            # Validate against field options
            if field_definition.options:
                if field_type == CustomFieldType.SELECT:
                    if value_str not in field_definition.options:
                        return f"Invalid option for field '{field_definition.name}': {value_str}. Valid options: {field_definition.options}"
                elif field_type == CustomFieldType.MULTISELECT:
                    # Parse comma-separated values
                    selected_values = [v.strip() for v in value_str.split(',') if v.strip()]
                    invalid_values = [v for v in selected_values if v not in field_definition.options]
                    if invalid_values:
                        return f"Invalid options for field '{field_definition.name}': {invalid_values}. Valid options: {field_definition.options}"
    
    return None


def create_custom_field_value(db: Session, value: CustomFieldValueCreate, user_id: Optional[int] = None):
    # Get field definition to validate against
    field_definition = db.query(CustomFieldDefinition).filter(
        CustomFieldDefinition.id == value.field_definition_id
    ).first()
    if not field_definition:
        raise ValueError(f"Custom field definition with id {value.field_definition_id} does not exist")

    # Resolve which entity owns this value and the project it lives in.
    entity_type, owner_project_id = _resolve_custom_field_owner(db, value)
    if owner_project_id is None:
        raise ValueError("Could not resolve project for the entity that owns this custom field value")

    if field_definition.project_id != owner_project_id:
        raise ValueError(
            f"Field definition belongs to project {field_definition.project_id} but the target "
            f"{entity_type} belongs to project {owner_project_id}. Cross-project field assignment is not allowed."
        )
    if not field_definition_applies_to(field_definition, entity_type):
        raise ValueError(
            f"Custom field '{field_definition.name}' does not apply to {entity_type}. "
            "Update the definition's entity_types to include it."
        )

    # Validate value against field definition rules
    validation_error = validate_custom_field_value(value.value, field_definition)
    if validation_error:
        raise ValueError(validation_error)

    db_value = CustomFieldValue(**value.model_dump(exclude_none=True))
    db.add(db_value)
    safe_commit(db)
    db.refresh(db_value)
    
    # Create audit trail
    try:
        from ..services.audit_service import get_audit_service
        from ..schemas_audit import AuditTrailCreate
        audit_service = get_audit_service(db)
        owner_summary = _format_custom_field_value_owner(db_value)
        audit_data = AuditTrailCreate(
            user_id=user_id,
            action="create",
            entity_type=EntityType.CUSTOM_FIELD,
            entity_id=db_value.id,
            project_id=field_definition.project_id,
            description=f"Created custom field value for field '{field_definition.name}' on {owner_summary} in project {field_definition.project_id}",
            ip_address=None,
            user_agent=None
        )
        audit_service.create_audit_trail(audit_data)
    except Exception as e:
        logger.warning(f"Failed to create audit trail for custom field value: {e}")
    
    return db_value


def update_custom_field_value(db: Session, value_id: int, value: CustomFieldValueUpdate, user_id: Optional[int] = None):
    db_value = db.query(CustomFieldValue).filter(CustomFieldValue.id == value_id).first()
    if not db_value:
        raise ValueError(f"Custom field value with id {value_id} does not exist")
    
    # Get field definition to validate against
    field_definition = db.query(CustomFieldDefinition).filter(
        CustomFieldDefinition.id == db_value.field_definition_id
    ).first()
    
    if not field_definition:
        raise ValueError(f"Custom field definition with id {db_value.field_definition_id} does not exist")
    
    # Updates only touch ``value``. Re-assigning ownership across entity
    # types would break referential semantics — callers create a new row
    # against the new entity and delete the old one.
    value_data = value.model_dump(exclude_unset=True)
    if "value" in value_data:
        validation_error = validate_custom_field_value(value_data.get("value"), field_definition)
        if validation_error:
            raise ValueError(validation_error)

    for key, val in value_data.items():
        setattr(db_value, key, val)
    safe_commit(db)
    db.refresh(db_value)

    try:
        from ..services.audit_service import get_audit_service
        from ..schemas_audit import AuditTrailCreate
        audit_service = get_audit_service(db)
        changes = ', '.join([f"{k}={v}" for k, v in value_data.items()])
        owner_summary = _format_custom_field_value_owner(db_value)
        audit_data = AuditTrailCreate(
            user_id=user_id,
            action="update",
            entity_type=EntityType.CUSTOM_FIELD,
            entity_id=value_id,
            project_id=field_definition.project_id,
            description=f"Updated custom field value for '{field_definition.name}' on {owner_summary}. Changes: {changes}",
            ip_address=None,
            user_agent=None
        )
        audit_service.create_audit_trail(audit_data)
    except Exception as e:
        logger.warning(f"Failed to create audit trail for custom field value update: {e}")

    return db_value


def delete_custom_field_value(db: Session, value_id: int, user_id: Optional[int] = None):
    db_value = db.query(CustomFieldValue).filter(CustomFieldValue.id == value_id).first()
    if db_value:
        # Get field definition for audit trail
        field_definition = db.query(CustomFieldDefinition).filter(
            CustomFieldDefinition.id == db_value.field_definition_id
        ).first()
        
        field_name = field_definition.name if field_definition else "unknown"
        project_id = field_definition.project_id if field_definition else None
        owner_summary = _format_custom_field_value_owner(db_value)
        
        db.delete(db_value)
        safe_commit(db)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=user_id,
                action="delete",
                entity_type=EntityType.CUSTOM_FIELD,
                entity_id=value_id,
                project_id=project_id,
                description=f"Deleted custom field value for field '{field_name}' on {owner_summary}",
                ip_address=None,
                user_agent=None
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            logger.warning(f"Failed to create audit trail for custom field value delete: {e}")
    
    return db_value


def get_test_case_with_custom_fields(db: Session, test_case_id: int):
    test_case = db.query(TestCase).options(
        selectinload(TestCase.custom_field_values).joinedload(CustomFieldValue.field_definition)
    ).filter(TestCase.id == test_case_id).first()
    return test_case
