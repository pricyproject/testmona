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

class TestPlanBase(BaseModel):
    title: str
    description: Optional[str] = None
    milestone_id: Optional[int] = None
    assigned_to: Optional[int] = None
    status: TestStatus = TestStatus.PENDING
    target_start_date: Optional[datetime] = None
    target_end_date: Optional[datetime] = None
    actual_start_date: Optional[datetime] = None
    actual_end_date: Optional[datetime] = None
    test_objectives: Optional[str] = None
    scope_inclusions: Optional[str] = None
    scope_exclusions: Optional[str] = None
    test_environment: Optional[str] = None
    entry_criteria: Optional[str] = None
    exit_criteria: Optional[str] = None
    risks_assumptions: Optional[str] = None

    @model_validator(mode='before')
    @classmethod
    def sanitize_html(cls, data):
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, str) and key not in ['status']:
                    data[key] = html.escape(value)
        return data

    @field_validator('title')
    @classmethod
    def validate_title(cls, v: str) -> str:
        stripped = v.strip()
        if not stripped:
            raise ValueError('Title cannot be empty')
        if len(stripped) > 255:
            raise ValueError('Title cannot exceed 255 characters')
        return stripped

    @field_validator('description')
    @classmethod
    def validate_description(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and len(v) > 1000:
            raise ValueError('Description cannot exceed 1000 characters')
        return v

    @field_validator('test_objectives', 'scope_inclusions', 'scope_exclusions',
                     'test_environment', 'entry_criteria', 'exit_criteria', 'risks_assumptions')
    @classmethod
    def validate_text_fields(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and len(v) > 2000:
            raise ValueError('Field cannot exceed 2000 characters')
        return v

    @model_validator(mode='after')
    def validate_date_range(self) -> 'TestPlanBase':
        if self.target_start_date and self.target_end_date:
            if self.target_end_date < self.target_start_date:
                raise ValueError('target_end_date must be on or after target_start_date')
        return self


class TestPlanCreate(TestPlanBase):
    project_id: int
    created_by: int


class TestPlanUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    milestone_id: Optional[int] = None
    assigned_to: Optional[int] = None
    status: Optional[TestStatus] = None
    target_start_date: Optional[datetime] = None
    target_end_date: Optional[datetime] = None
    actual_start_date: Optional[datetime] = None
    actual_end_date: Optional[datetime] = None
    test_objectives: Optional[str] = None
    scope_inclusions: Optional[str] = None
    scope_exclusions: Optional[str] = None
    test_environment: Optional[str] = None
    entry_criteria: Optional[str] = None
    exit_criteria: Optional[str] = None
    risks_assumptions: Optional[str] = None

    @model_validator(mode='before')
    @classmethod
    def sanitize_html(cls, data):
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, str) and key not in ['status']:
                    data[key] = html.escape(value)
        return data

    @field_validator('title')
    @classmethod
    def validate_title(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            stripped = v.strip()
            if not stripped:
                raise ValueError('Title cannot be empty')
            if len(stripped) > 255:
                raise ValueError('Title cannot exceed 255 characters')
            return stripped
        return v

    @field_validator('description')
    @classmethod
    def validate_description(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and len(v) > 1000:
            raise ValueError('Description cannot exceed 1000 characters')
        return v

    @field_validator('test_objectives', 'scope_inclusions', 'scope_exclusions',
                     'test_environment', 'entry_criteria', 'exit_criteria', 'risks_assumptions')
    @classmethod
    def validate_text_fields(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and len(v) > 2000:
            raise ValueError('Field cannot exceed 2000 characters')
        return v

    @model_validator(mode='after')
    def validate_date_range(self) -> 'TestPlanUpdate':
        if self.target_start_date and self.target_end_date:
            if self.target_end_date < self.target_start_date:
                raise ValueError('target_end_date must be on or after target_start_date')
        return self


class TestPlan(TestPlanBase):
    id: int
    project_seq: Optional[int] = None  # per-project sequence (URLs/badges)
    project_id: int
    created_by: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# Milestone Schemas
class MilestoneBase(BaseModel):
    title: str
    description: Optional[str] = None
    status: MilestoneStatus = MilestoneStatus.PLANNED
    target_date: Optional[datetime] = None
    actual_date: Optional[datetime] = None
    progress_percentage: int = 0
    owner_id: Optional[int] = None

    @field_validator('title')
    @classmethod
    def validate_title(cls, v):
        if not v or not v.strip():
            raise ValueError('Title cannot be empty')
        if len(v.strip()) > 255:
            raise ValueError('Title cannot exceed 255 characters')
        return v.strip()
    
    @field_validator('description')
    @classmethod
    def validate_description(cls, v):
        if v and len(v) > 5000:
            raise ValueError('Description cannot exceed 5000 characters')
        return v
    
    @field_validator('progress_percentage')
    @classmethod
    def validate_progress(cls, v):
        if v < 0 or v > 100:
            raise ValueError('Progress percentage must be between 0 and 100')
        return v
    

class MilestoneCreate(MilestoneBase):
    project_id: int
    created_by: Optional[int] = None


class MilestoneUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[MilestoneStatus] = None
    target_date: Optional[datetime] = None
    actual_date: Optional[datetime] = None
    progress_percentage: Optional[int] = None
    owner_id: Optional[int] = None

    @field_validator('title')
    @classmethod
    def validate_title(cls, v):
        if v is not None:
            if not v or not v.strip():
                raise ValueError('Title cannot be empty')
            if len(v.strip()) > 255:
                raise ValueError('Title cannot exceed 255 characters')
            return v.strip()
        return v
    
    @field_validator('description')
    @classmethod
    def validate_description(cls, v):
        if v is not None and len(v) > 5000:
            raise ValueError('Description cannot exceed 5000 characters')
        return v
    
    @field_validator('progress_percentage')
    @classmethod
    def validate_progress(cls, v):
        if v is not None and (v < 0 or v > 100):
            raise ValueError('Progress percentage must be between 0 and 100')
        return v
    

class MilestoneLinkedTestPlan(BaseModel):
    id: int
    title: str
    status: Optional[str] = None
    target_start_date: Optional[datetime] = None
    target_end_date: Optional[datetime] = None


class Milestone(MilestoneBase):
    id: int
    project_seq: Optional[int] = None  # per-project sequence (URLs/badges)
    project_id: int
    created_by: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    test_plan_count: int = 0
    test_run_count: int = 0
    test_case_count: int = 0
    result_count: int = 0
    passed_count: int = 0
    failed_count: int = 0
    blocked_count: int = 0
    skipped_count: int = 0
    not_started_count: int = 0
    execution_progress: int = 0
    pass_rate: int = 0
    open_defect_count: int = 0
    critical_defect_count: int = 0
    requirement_count: int = 0
    verified_requirement_count: int = 0
    is_overdue: bool = False
    health: str = "planned"
    linked_test_plans: List[MilestoneLinkedTestPlan] = []

    class Config:
        from_attributes = True


# Traceability Matrix Schemas
class TraceabilityMatrixBase(BaseModel):
    requirement_id: int
    test_case_id: int
    coverage_type: str = "functional"
    coverage_percentage: float = 100.0


class TraceabilityMatrixCreate(TraceabilityMatrixBase):
    pass


class TraceabilityMatrix(TraceabilityMatrixBase):
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# Coverage Report Schemas
class CoverageReportBase(BaseModel):
    test_run_id: Optional[int] = None
    report_type: str = "summary"
    total_requirements: int = 0
    covered_requirements: int = 0
    coverage_percentage: float = 0.0
    total_test_cases: int = 0
    executed_test_cases: int = 0
    passed_test_cases: int = 0
    failed_test_cases: int = 0
    blocked_test_cases: int = 0
    report_data: Optional[Dict[str, Any]] = None


class CoverageReportCreate(CoverageReportBase):
    project_id: int
    generated_by: int


class CoverageReport(CoverageReportBase):
    id: int
    project_id: int
    generated_by: int
    generated_at: datetime

    class Config:
        from_attributes = True


# Enhanced schemas with relationships
class RequirementWithChildren(Requirement):
    child_requirements: List["RequirementWithChildren"] = []
    test_cases: List[TestCase] = []


class ProjectWithAdvancedFeatures(Project):
    requirements: List[Requirement] = []
    defects: List[Defect] = []
    milestones: List[Milestone] = []
    test_plans: List[TestPlan] = []
    coverage_reports: List[CoverageReport] = []
