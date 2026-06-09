from pydantic import AliasChoices, BaseModel, EmailStr, field_validator, HttpUrl, model_validator, Field
from typing import List, Optional, Dict, Any, Union
from datetime import datetime
from ..models import Priority, Status, TestStatus, ResultStatus, Role, Permission, CustomFieldType, TestType, RecycleBinType, RequirementStatus, DefectStatus, DefectSeverity, DefectPriority, DefectLinkType, MilestoneStatus, NotificationType, StepCategory, StepComplexity, DocStatus
import re
import html

from .versioning import (
    DateValidationRules,
    NumberValidationRules,
    SelectValidationRules,
    TestCaseVersionBase,
    TestCaseVersionCreate,
    TestCaseVersionUpdate,
    TextValidationRules,
    VersionComparisonBase,
    VersionComparisonCreate,
    VersionLockBase,
    VersionLockCreate,
    VersionTagBase,
    VersionTagCreate,
)
from ..services.webhook_security import normalize_webhook_url

from .core import *
from .custom_fields import *

class JiraIntegrationBase(BaseModel):
    jira_url: str
    username: str
    api_token: str
    project_key: str
    is_active: bool = True
    sync_test_cases: bool = True
    sync_test_results: bool = True


class JiraIntegrationCreate(JiraIntegrationBase):
    project_id: int


class JiraIntegrationUpdate(BaseModel):
    jira_url: Optional[str] = None
    username: Optional[str] = None
    api_token: Optional[str] = None
    project_key: Optional[str] = None
    is_active: Optional[bool] = None
    sync_test_cases: Optional[bool] = None
    sync_test_results: Optional[bool] = None


class JiraIntegration(JiraIntegrationBase):
    id: int
    project_id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class JiraIssueBase(BaseModel):
    jira_issue_key: str
    jira_issue_id: str
    issue_type: str
    status: str
    summary: Optional[str] = None
    description: Optional[str] = None
    assignee: Optional[str] = None
    reporter: Optional[str] = None
    priority: Optional[str] = None


class JiraIssueCreate(JiraIssueBase):
    integration_id: int
    test_case_id: Optional[int] = None
    test_result_id: Optional[int] = None


class JiraIssueUpdate(BaseModel):
    status: Optional[str] = None
    summary: Optional[str] = None
    description: Optional[str] = None
    assignee: Optional[str] = None
    priority: Optional[str] = None


class JiraIssue(JiraIssueBase):
    id: int
    integration_id: int
    test_case_id: Optional[int] = None
    test_result_id: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None


class TestTypeDefinitionBase(BaseModel):
    project_id: Optional[int] = None  # per-project catalog
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=1000)
    color: str = "#3B82F6"
    icon: str = Field("🖱️", min_length=1, max_length=10)
    is_active: bool = True

    @field_validator('name')
    @classmethod
    def validate_test_type_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError('Test type name is required')
        return cleaned

    @field_validator('color')
    @classmethod
    def validate_test_type_color(cls, value: str) -> str:
        if not re.fullmatch(r"#[0-9A-Fa-f]{6}", value):
            raise ValueError('Color must be a valid hex color')
        return value

class TestTypeDefinitionCreate(TestTypeDefinitionBase):
    created_by: int

class TestTypeDefinitionUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=1000)
    color: Optional[str] = None
    icon: Optional[str] = Field(None, min_length=1, max_length=10)
    is_active: Optional[bool] = None

    @field_validator('name')
    @classmethod
    def validate_test_type_update_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        cleaned = value.strip()
        if not cleaned:
            raise ValueError('Test type name is required')
        return cleaned

    @field_validator('color')
    @classmethod
    def validate_test_type_update_color(cls, value: Optional[str]) -> Optional[str]:
        if value is not None and not re.fullmatch(r"#[0-9A-Fa-f]{6}", value):
            raise ValueError('Color must be a valid hex color')
        return value

class TestTypeDefinition(TestTypeDefinitionBase):
    id: int
    project_seq: Optional[int] = None
    usage_count: int
    created_by: int
    created_at: datetime
    updated_at: Optional[datetime] = None


class PriorityDefinitionBase(BaseModel):
    project_id: Optional[int] = None  # per-project catalog
    name: str = Field(..., min_length=1, max_length=100)
    value: int = Field(..., ge=1, le=10)
    color: str = "#F59E0B"
    description: Optional[str] = Field(None, max_length=1000)
    is_default: bool = False
    is_active: bool = True

    @field_validator('name')
    @classmethod
    def validate_priority_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError('Priority name is required')
        return cleaned

    @field_validator('color')
    @classmethod
    def validate_priority_color(cls, value: str) -> str:
        if not re.fullmatch(r"#[0-9A-Fa-f]{6}", value):
            raise ValueError('Color must be a valid hex color')
        return value

class PriorityDefinitionCreate(PriorityDefinitionBase):
    created_by: int

class PriorityDefinitionUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    value: Optional[int] = Field(None, ge=1, le=10)
    color: Optional[str] = None
    description: Optional[str] = Field(None, max_length=1000)
    is_default: Optional[bool] = None
    is_active: Optional[bool] = None

    @field_validator('name')
    @classmethod
    def validate_priority_update_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        cleaned = value.strip()
        if not cleaned:
            raise ValueError('Priority name is required')
        return cleaned

    @field_validator('color')
    @classmethod
    def validate_priority_update_color(cls, value: Optional[str]) -> Optional[str]:
        if value is not None and not re.fullmatch(r"#[0-9A-Fa-f]{6}", value):
            raise ValueError('Color must be a valid hex color')
        return value

class PriorityDefinition(PriorityDefinitionBase):
    id: int
    project_seq: Optional[int] = None
    created_by: int
    created_at: datetime
    updated_at: Optional[datetime] = None


class SharedStepTemplateBase(BaseModel):
    project_id: Optional[int] = None  # per-project catalog
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=500)
    category: StepCategory
    tags: List[str] = Field(default_factory=list, max_length=50)
    complexity: StepComplexity
    estimated_time: int = Field(1, ge=1, le=1440)
    prerequisites: List[str] = Field(default_factory=list, max_length=50)
    related_steps: List[str] = Field(default_factory=list, max_length=50)
    is_active: bool = True

    @field_validator('name')
    @classmethod
    def validate_shared_step_template_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError('Shared step template name is required')
        return cleaned

    @field_validator('description')
    @classmethod
    def validate_shared_step_template_description(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        cleaned = value.strip()
        return cleaned or None

    @field_validator('tags', 'prerequisites', 'related_steps', mode='before')
    @classmethod
    def normalize_shared_step_template_list(cls, value: Optional[List[str]]) -> List[str]:
        if value is None:
            return []
        if not isinstance(value, list):
            raise ValueError('Value must be a list')

        normalized: List[str] = []
        seen = set()
        for item in value:
            if not isinstance(item, str):
                raise ValueError('List values must be strings')
            cleaned = item.strip()
            if not cleaned:
                continue
            if len(cleaned) > 100:
                raise ValueError('List values must be 100 characters or less')
            duplicate_key = cleaned.lower()
            if duplicate_key in seen:
                continue
            seen.add(duplicate_key)
            normalized.append(cleaned)
        return normalized

class SharedStepTemplateCreate(SharedStepTemplateBase):
    pass

class SharedStepTemplateUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=500)
    category: Optional[StepCategory] = None
    tags: Optional[List[str]] = Field(None, max_length=50)
    complexity: Optional[StepComplexity] = None
    estimated_time: Optional[int] = Field(None, ge=1, le=1440)
    prerequisites: Optional[List[str]] = Field(None, max_length=50)
    related_steps: Optional[List[str]] = Field(None, max_length=50)
    is_active: Optional[bool] = None

    @field_validator('name')
    @classmethod
    def validate_shared_step_template_update_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        cleaned = value.strip()
        if not cleaned:
            raise ValueError('Shared step template name is required')
        return cleaned

    @field_validator('description')
    @classmethod
    def validate_shared_step_template_update_description(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        cleaned = value.strip()
        return cleaned or None

    @field_validator('tags', 'prerequisites', 'related_steps', mode='before')
    @classmethod
    def normalize_shared_step_template_update_list(cls, value: Optional[List[str]]) -> Optional[List[str]]:
        if value is None:
            return value
        return SharedStepTemplateBase.normalize_shared_step_template_list(value)

class SharedStepTemplate(SharedStepTemplateBase):
    id: int
    project_seq: Optional[int] = None
    usage_count: int
    created_by: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class TestExecutionSettingsBase(BaseModel):
    auto_save_interval: int = 30
    screenshot_on_failure: bool = True
    video_recording: bool = False
    step_timeout: int = 300
    retry_attempts: int = 2
    parallel_execution: bool = True
    max_parallel_threads: int = 4
    cleanup_on_failure: bool = True
    require_defect_on_failure: bool = False

class TestExecutionSettingsCreate(TestExecutionSettingsBase):
    project_id: Optional[int] = None
    created_by: int

class TestExecutionSettingsUpdate(BaseModel):
    auto_save_interval: Optional[int] = None
    screenshot_on_failure: Optional[bool] = None
    video_recording: Optional[bool] = None
    step_timeout: Optional[int] = None
    retry_attempts: Optional[int] = None
    parallel_execution: Optional[bool] = None
    max_parallel_threads: Optional[int] = None
    cleanup_on_failure: Optional[bool] = None
    require_defect_on_failure: Optional[bool] = None

class TestExecutionSettings(TestExecutionSettingsBase):
    id: int
    project_id: Optional[int] = None
    created_by: int
    created_at: datetime
    updated_at: Optional[datetime] = None


class NotificationSettingsBase(BaseModel):
    email_notifications: bool = True
    slack_notifications: bool = False
    test_failure_alerts: bool = True
    test_completion_reports: bool = True
    weekly_summary: bool = True
    real_time_updates: bool = False

class NotificationSettingsCreate(NotificationSettingsBase):
    project_id: Optional[int] = None
    created_by: int

class NotificationSettingsUpdate(BaseModel):
    email_notifications: Optional[bool] = None
    slack_notifications: Optional[bool] = None
    test_failure_alerts: Optional[bool] = None
    test_completion_reports: Optional[bool] = None
    weekly_summary: Optional[bool] = None
    real_time_updates: Optional[bool] = None

class NotificationSettings(NotificationSettingsBase):
    id: int
    project_id: Optional[int] = None
    created_by: int
    created_at: datetime
    updated_at: Optional[datetime] = None


class AutomationSettingsBase(BaseModel):
    ai_suggestions: bool = False
    smart_step_recommendations: bool = True
    auto_categorization: bool = False
    duplicate_detection: bool = True
    performance_optimization: bool = True

class AutomationSettingsCreate(AutomationSettingsBase):
    project_id: Optional[int] = None
    created_by: int

class AutomationSettingsUpdate(BaseModel):
    ai_suggestions: Optional[bool] = None
    smart_step_recommendations: Optional[bool] = None
    auto_categorization: Optional[bool] = None
    duplicate_detection: Optional[bool] = None
    performance_optimization: Optional[bool] = None

class AutomationSettings(AutomationSettingsBase):
    id: int
    project_id: Optional[int] = None
    created_by: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class SystemSettingsBase(BaseModel):
    key: str
    value: Optional[str] = None
    description: Optional[str] = None


class SystemSettingsCreate(SystemSettingsBase):
    pass


class SystemSettingsUpdate(BaseModel):
    value: Optional[str] = None
    description: Optional[str] = None


class SystemSettings(SystemSettingsBase):
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# Audit Trail Configuration Schemas
class AuditTrailConfig(BaseModel):
    """Configuration for enabling/disabling audit trails per entity type"""
    enabled: bool = Field(default=True, description="Global enable/disable for audit trails")
    entity_settings: Dict[str, bool] = Field(
        default_factory=dict,
        description="Per-entity audit trail settings. Key is entity_type, value is enabled/disabled"
    )

    @field_validator('entity_settings')
    @classmethod
    def validate_entity_types(cls, v):
        """Validate that entity types are valid"""
        from ..models import EntityType
        valid_entities = {e.value for e in EntityType}
        for entity_type in v.keys():
            if entity_type not in valid_entities:
                raise ValueError(f"Invalid entity type: {entity_type}")
        return v


class AuditTrailConfigUpdate(BaseModel):
    """Update schema for audit trail configuration"""
    enabled: Optional[bool] = None
    entity_settings: Optional[Dict[str, bool]] = None

    @field_validator('entity_settings')
    @classmethod
    def validate_entity_types(cls, v):
        """Validate that entity types are valid"""
        if v is None:
            return v
        from ..models import EntityType
        valid_entities = {e.value for e in EntityType}
        for entity_type in v.keys():
            if entity_type not in valid_entities:
                raise ValueError(f"Invalid entity type: {entity_type}")
        return v


# Test Case Section Schemas
class TestCaseSectionBase(BaseModel):
    name: str
    description: Optional[str] = None
    parent_section_id: Optional[int] = None
    order_index: Optional[int] = 0
    is_active: Optional[bool] = True

    @model_validator(mode='before')
    @classmethod
    def sanitize_html(cls, data):
        """Sanitize HTML in string fields to prevent XSS attacks"""
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, str):
                    data[key] = html.escape(value)
        return data


class TestCaseSectionCreate(TestCaseSectionBase):
    test_suite_id: int


class TestCaseSectionUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    parent_section_id: Optional[int] = None
    order_index: Optional[int] = None
    is_active: Optional[bool] = None

    @model_validator(mode='before')
    @classmethod
    def sanitize_html(cls, data):
        """Sanitize HTML in string fields to prevent XSS attacks"""
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, str):
                    data[key] = html.escape(value)
        return data


class TestCaseSection(TestCaseSectionBase):
    id: int
    test_suite_id: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# Test Case Revision Schemas
class TestCaseRevisionBase(BaseModel):
    revision_number: Optional[int] = None
    title: str
    description: Optional[str] = None
    test_type: Optional[str] = None
    preconditions: Optional[str] = None
    steps: Optional[str] = None
    expected_result: Optional[str] = None
    priority: Optional[Priority] = None
    tags: Optional[str] = Field(None, max_length=500)
    changed_fields: Optional[Dict[str, Any]] = None
    change_reason: Optional[str] = None


class TestCaseRevisionCreate(TestCaseRevisionBase):
    test_case_id: int
    created_by: int


class TestCaseRevision(TestCaseRevisionBase):
    id: int
    test_case_id: int
    created_by: int
    created_at: datetime

    class Config:
        from_attributes = True


# Recycle Bin Schemas
class RecycleBinBase(BaseModel):
    item_type: RecycleBinType
    item_id: int
    item_data: Dict[str, Any]
    restore_until: Optional[datetime] = None


class RecycleBinCreate(RecycleBinBase):
    deleted_by: int


class RecycleBin(RecycleBinBase):
    id: int
    deleted_by: int
    deleted_at: datetime

    class Config:
        from_attributes = True


# Export Schemas
class TestCaseExport(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    test_type: str
    preconditions: Optional[str] = None
    steps: Optional[str] = None
    expected_result: Optional[str] = None
    priority: str
    tags: Optional[str] = None
    created_at: datetime


class TestSuiteWithSections(TestSuite):
    sections: List[TestCaseSection] = []


class TestCaseSectionWithCases(TestCaseSection):
    test_cases: List[TestCase] = []
