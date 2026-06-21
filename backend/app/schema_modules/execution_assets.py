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
from .integrations_settings import *
from .requirements import *
from .defects import *
from .planning import *
from .notifications_analytics import *


TEST_DEBT_TYPES = {"stale", "duplicate", "orphan", "always_pass", "never_run", "no_requirement_link"}
TEST_DEBT_SEVERITIES = {"low", "medium", "high", "critical"}
TEST_DEBT_ACTIONS = {"update", "merge", "archive", "link_req", "review"}


class TestDebtItemBase(BaseModel):
    test_case_id: int = Field(..., ge=1)
    debt_type: str = Field(..., min_length=1, max_length=40)
    severity: str = Field("medium", min_length=1, max_length=20)
    suggested_action: str = Field(..., min_length=1, max_length=40)
    details: Optional[str] = Field(None, max_length=2000)

    @field_validator("debt_type")
    @classmethod
    def validate_debt_type(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in TEST_DEBT_TYPES:
            raise ValueError("Unsupported debt type")
        return normalized

    @field_validator("severity")
    @classmethod
    def validate_severity(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in TEST_DEBT_SEVERITIES:
            raise ValueError("Unsupported severity")
        return normalized

    @field_validator("suggested_action")
    @classmethod
    def validate_suggested_action(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in TEST_DEBT_ACTIONS:
            raise ValueError("Unsupported suggested action")
        return normalized

    @field_validator("details")
    @classmethod
    def validate_details(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class TestDebtItemCreate(TestDebtItemBase):
    pass


class TestDebtItemUpdate(BaseModel):
    severity: Optional[str] = Field(None, min_length=1, max_length=20)
    suggested_action: Optional[str] = Field(None, min_length=1, max_length=40)
    details: Optional[str] = Field(None, max_length=2000)
    resolved_at: Optional[datetime] = None

    @field_validator("severity")
    @classmethod
    def validate_update_severity(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = value.strip().lower()
        if normalized not in TEST_DEBT_SEVERITIES:
            raise ValueError("Unsupported severity")
        return normalized

    @field_validator("suggested_action")
    @classmethod
    def validate_update_suggested_action(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = value.strip().lower()
        if normalized not in TEST_DEBT_ACTIONS:
            raise ValueError("Unsupported suggested action")
        return normalized

    @field_validator("details")
    @classmethod
    def validate_update_details(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class TestDebtItemTestCase(BaseModel):
    id: int
    project_seq: Optional[int] = None
    title: str
    priority: Optional[str] = None
    status: Optional[str] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class TestDebtItem(TestDebtItemBase):
    id: int
    project_id: int
    auto_detected: bool
    resolved_at: Optional[datetime] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    test_case: Optional[TestDebtItemTestCase] = None

    class Config:
        from_attributes = True


class TestAssetHealthSummary(BaseModel):
    total_cases: int
    active_debt_items: int
    resolved_debt_items: int
    affected_cases: int = 0
    healthy_cases: int = 0
    health_score: int = 100
    by_debt_type: Dict[str, int]
    by_severity: Dict[str, int]
    by_action: Dict[str, int] = {}
    last_detected_at: Optional[datetime] = None


class TestAssetDebtDetectionResult(BaseModel):
    created: int
    updated: int
    auto_resolved: int
    active_debt_items: int
    summary: TestAssetHealthSummary


class TestDebtBulkResolve(BaseModel):
    item_ids: List[int] = Field(..., min_length=1, max_length=500)


class TestDebtBulkResolveResult(BaseModel):
    resolved: int
    summary: TestAssetHealthSummary

class SharedStepBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=500)
    action: str = Field(..., min_length=1, max_length=1000)
    expected_result: str = Field(..., min_length=1, max_length=1000)
    project_id: int = Field(..., ge=1)
    is_active: bool = True
    usage_count: int = 0

    @field_validator('name', 'action', 'expected_result')
    @classmethod
    def validate_shared_step_required_text(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError('Field is required')
        return cleaned

    @field_validator('description')
    @classmethod
    def validate_shared_step_description(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        cleaned = value.strip()
        return cleaned or None


class SharedStepCreate(SharedStepBase):
    pass


class SharedStepUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=500)
    action: Optional[str] = Field(None, min_length=1, max_length=1000)
    expected_result: Optional[str] = Field(None, min_length=1, max_length=1000)
    is_active: Optional[bool] = None

    @field_validator('name', 'action', 'expected_result')
    @classmethod
    def validate_shared_step_update_required_text(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        cleaned = value.strip()
        if not cleaned:
            raise ValueError('Field is required')
        return cleaned

    @field_validator('description')
    @classmethod
    def validate_shared_step_update_description(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        cleaned = value.strip()
        return cleaned or None


class SharedStep(SharedStepBase):
    id: int
    project_seq: Optional[int] = None  # per-project sequence (URLs/badges)
    created_by: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# Global Parameter Schemas
class GlobalParameterBase(BaseModel):
    name: str
    value: str
    description: Optional[str] = None
    parameter_type: str = "string"
    project_id: Optional[int] = None
    is_active: bool = True
    is_encrypted: bool = False


class GlobalParameterCreate(GlobalParameterBase):
    # Set server-side from the authenticated user; never trusted from the client.
    created_by: Optional[int] = None


class GlobalParameterUpdate(BaseModel):
    name: Optional[str] = None
    value: Optional[str] = None
    description: Optional[str] = None
    parameter_type: Optional[str] = None
    project_id: Optional[int] = None
    is_active: Optional[bool] = None
    is_encrypted: Optional[bool] = None


class GlobalParameter(GlobalParameterBase):
    id: int
    project_seq: Optional[int] = None  # per-project sequence (URLs/badges)
    created_by: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# Test Dataset (case-level parameterization) Schemas
def _normalize_dataset(parameters, rows):
    """Validate a dataset's columns + rows.

    ``parameters`` must be a non-empty list of unique, trimmed column names.
    Every row key must be one of those columns; missing keys default to "".
    Returns the cleaned ``(parameters, rows)`` tuple.
    """
    if not isinstance(parameters, list) or not parameters:
        raise ValueError("parameters must be a non-empty list of column names")
    cleaned_params: List[str] = []
    for raw in parameters:
        name = str(raw).strip()
        if not name:
            raise ValueError("parameter names cannot be empty")
        if name in cleaned_params:
            raise ValueError(f"duplicate parameter name: {name}")
        cleaned_params.append(name)
    param_set = set(cleaned_params)

    if rows is None:
        rows = []
    if not isinstance(rows, list):
        raise ValueError("rows must be a list of objects")
    cleaned_rows: List[Dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("each row must be an object mapping parameter -> value")
        unknown = set(row.keys()) - param_set
        if unknown:
            raise ValueError(f"row has unknown parameters: {sorted(unknown)}")
        cleaned_rows.append({p: ("" if row.get(p) is None else str(row.get(p))) for p in cleaned_params})
    return cleaned_params, cleaned_rows


class TestDatasetBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=150)
    description: Optional[str] = None
    parameters: List[str] = Field(default_factory=list)
    rows: List[Dict[str, Any]] = Field(default_factory=list)
    is_active: bool = True


class TestDatasetCreate(TestDatasetBase):
    project_id: int

    @model_validator(mode="after")
    def _validate(self):
        self.parameters, self.rows = _normalize_dataset(self.parameters, self.rows)
        return self


class TestDatasetUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=150)
    description: Optional[str] = None
    parameters: Optional[List[str]] = None
    rows: Optional[List[Dict[str, Any]]] = None
    is_active: Optional[bool] = None

    @model_validator(mode="after")
    def _validate(self):
        # Only validate when either side of the table is being changed; the
        # caller may PATCH just the name/description.
        if self.parameters is not None or self.rows is not None:
            if self.parameters is None:
                raise ValueError("parameters is required when rows are provided")
            self.parameters, self.rows = _normalize_dataset(self.parameters, self.rows or [])
        return self


class TestDataset(TestDatasetBase):
    id: int
    project_seq: Optional[int] = None  # per-project sequence (URLs/badges)
    project_id: int
    created_by: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# Test Mindmap Schemas
class TestMindmapBase(BaseModel):
    name: str
    description: Optional[str] = None
    project_id: int
    mindmap_data: Optional[dict] = None
    is_active: bool = True


class TestMindmapCreate(TestMindmapBase):
    created_by: int


class TestMindmapUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    mindmap_data: Optional[dict] = None
    is_active: Optional[bool] = None


class TestMindmap(TestMindmapBase):
    id: int
    created_by: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# Impact Analysis Schemas
class ImpactAnalysisBase(BaseModel):
    title: str
    description: Optional[str] = None
    entity_type: str
    entity_id: int
    change_type: str
    project_id: int
    impact_data: Optional[dict] = None
    status: str = "pending"


class ImpactAnalysisCreate(ImpactAnalysisBase):
    created_by: int


class ImpactAnalysisUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    impact_data: Optional[dict] = None
    status: Optional[str] = None


class ImpactAnalysis(ImpactAnalysisBase):
    id: int
    created_by: int
    created_at: datetime

    class Config:
        from_attributes = True


# Execution Environment Schemas
class ExecutionEnvironmentBase(BaseModel):
    name: str
    description: Optional[str] = None
    environment_type: str
    config_data: Optional[dict] = None
    build_info: Optional[dict] = None
    is_active: bool = True


class ExecutionEnvironmentCreate(ExecutionEnvironmentBase):
    project_id: int


class ExecutionEnvironmentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    environment_type: Optional[str] = None
    config_data: Optional[dict] = None
    build_info: Optional[dict] = None
    is_active: Optional[bool] = None


class ExecutionEnvironment(ExecutionEnvironmentBase):
    id: int
    project_seq: Optional[int] = None  # per-project sequence (URLs/badges)
    project_id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# Test Schedule Schemas
class TestScheduleBase(BaseModel):
    name: str
    description: Optional[str] = None
    schedule_type: str
    schedule_config: Optional[dict] = None
    is_active: bool = True


class TestScheduleCreate(TestScheduleBase):
    project_id: int
    test_suite_id: Optional[int] = None
    environment_id: Optional[int] = None
    created_by: int


class TestScheduleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    schedule_type: Optional[str] = None
    schedule_config: Optional[dict] = None
    is_active: Optional[bool] = None
    test_suite_id: Optional[int] = None
    environment_id: Optional[int] = None


class TestSchedule(TestScheduleBase):
    id: int
    project_id: int
    test_suite_id: Optional[int] = None
    environment_id: Optional[int] = None
    created_by: int
    last_run: Optional[datetime] = None
    next_run: Optional[datetime] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# Execution Engine Schemas
class ExecutionEngineBase(BaseModel):
    name: str
    engine_type: str
    config_data: Optional[dict] = None
    max_concurrent_runs: int = 10
    is_active: bool = True


class ExecutionEngineCreate(ExecutionEngineBase):
    pass


class ExecutionEngineUpdate(BaseModel):
    name: Optional[str] = None
    engine_type: Optional[str] = None
    config_data: Optional[dict] = None
    max_concurrent_runs: Optional[int] = None
    is_active: Optional[bool] = None


class ExecutionEngine(ExecutionEngineBase):
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# Execution Log Schemas
class ExecutionLogBase(BaseModel):
    log_level: str
    message: str
    metadata: Optional[dict] = None


class ExecutionLogCreate(ExecutionLogBase):
    test_run_id: int
    test_result_id: Optional[int] = None


class ExecutionLog(ExecutionLogBase):
    id: int
    test_run_id: int
    test_result_id: Optional[int] = None
    timestamp: datetime

    class Config:
        from_attributes = True


# Test Run Environment Schemas
class TestRunEnvironmentBase(BaseModel):
    config_snapshot: Optional[dict] = None
    build_snapshot: Optional[dict] = None


class TestRunEnvironmentCreate(TestRunEnvironmentBase):
    test_run_id: int
    environment_id: int


class TestRunEnvironment(TestRunEnvironmentBase):
    id: int
    test_run_id: int
    environment_id: int
    created_at: datetime

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# API tokens
# ---------------------------------------------------------------------------


class ApiTokenCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    expires_at: Optional[datetime] = None


class ApiTokenView(BaseModel):
    """Token view safe to expose — never includes the raw secret."""
    id: int
    name: str
    prefix: str
    last_used_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    revoked_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


class ApiTokenCreated(ApiTokenView):
    """One-time response that includes the raw secret."""
    token: str


# ---------------------------------------------------------------------------
# Webhooks
# ---------------------------------------------------------------------------


class WebhookSubscriptionBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    url: str = Field(min_length=1, max_length=2048)
    events: List[str] = Field(min_length=1)
    is_active: bool = True

    @field_validator("url")
    @classmethod
    def _validate_url(cls, value: str) -> str:
        return normalize_webhook_url(value)


class WebhookSubscriptionCreate(WebhookSubscriptionBase):
    project_id: int


class WebhookSubscriptionUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=120)
    url: Optional[str] = Field(default=None, max_length=2048)
    events: Optional[List[str]] = None
    is_active: Optional[bool] = None
    rotate_secret: bool = False

    @field_validator("url")
    @classmethod
    def _validate_url(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        return normalize_webhook_url(value)


class WebhookSubscriptionView(BaseModel):
    """Public view of a subscription — never includes the secret."""
    id: int
    project_id: int
    name: str
    url: str
    events: List[str]
    is_active: bool
    created_by: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class WebhookSubscriptionCreated(WebhookSubscriptionView):
    """One-time response that includes the secret so the user can copy it."""
    secret: str


class SavedFilterBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    scope: str = Field(min_length=1, max_length=32)
    definition: Dict[str, Any]
    is_default: bool = False
    is_shared: bool = False


class SavedFilterCreate(SavedFilterBase):
    project_id: int


class SavedFilterUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=120)
    definition: Optional[Dict[str, Any]] = None
    is_default: Optional[bool] = None
    is_shared: Optional[bool] = None


class SavedFilterView(SavedFilterBase):
    id: int
    user_id: int
    project_id: int
    created_at: datetime
    updated_at: Optional[datetime] = None
    owned_by_current_user: bool = False

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Bulk edit
# ---------------------------------------------------------------------------


class BulkTestCaseUpdate(BaseModel):
    ids: List[int] = Field(min_length=1, max_length=2000)
    priority: Optional[Priority] = None
    status: Optional[str] = Field(default=None, max_length=20)
    test_type: Optional[str] = Field(default=None, max_length=20)
    section_id: Optional[int] = None
    # Normalized tag names. ``tags`` replaces the whole set; add/remove patch it.
    tags: Optional[List[str]] = None
    add_tags: Optional[List[str]] = None
    remove_tags: Optional[List[str]] = None

    @field_validator("status")
    @classmethod
    def _status_lower(cls, value):
        if value is None:
            return value
        v = value.strip().lower()
        return v or None

    @field_validator("test_type")
    @classmethod
    def _type_lower(cls, value):
        if value is None:
            return value
        v = value.strip().lower()
        return v or None


class BulkDefectUpdate(BaseModel):
    ids: List[int] = Field(min_length=1, max_length=2000)
    status: Optional[DefectStatus] = None
    severity: Optional[DefectSeverity] = None
    priority: Optional[DefectPriority] = None
    assigned_to: Optional[int] = None
    clear_assignee: bool = False


class BulkUpdateResult(BaseModel):
    updated: int
    skipped_ids: List[int] = Field(default_factory=list)
    reason: Optional[str] = None


class WebhookDeliveryView(BaseModel):
    id: int
    subscription_id: int
    event: str
    status: str
    attempts: int
    response_status: Optional[int] = None
    response_body: Optional[str] = None
    error: Optional[str] = None
    delivered_at: Optional[datetime] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
