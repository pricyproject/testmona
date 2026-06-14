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

class NotificationBase(BaseModel):
    title: str
    message: str
    type: NotificationType = NotificationType.INFO
    related_entity_type: Optional[str] = None
    related_entity_id: Optional[int] = None

    @model_validator(mode='before')
    @classmethod
    def sanitize_html(cls, data):
        """Sanitize HTML in string fields to prevent XSS attacks"""
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, str) and key not in ['type']:
                    data[key] = html.escape(value)
        return data


class NotificationCreate(NotificationBase):
    user_id: int


class NotificationUpdate(BaseModel):
    is_read: Optional[bool] = None


class BulkNotificationUpdate(BaseModel):
    notification_ids: List[int]
    is_read: Optional[bool] = None


class BulkNotificationDelete(BaseModel):
    notification_ids: List[int]


class NotificationPreferencesUpdate(BaseModel):
    do_not_disturb: Optional[bool] = None
    notification_sound_enabled: Optional[bool] = None
    mute_duration_hours: Optional[int] = None


class Notification(NotificationBase):
    id: int
    user_id: int
    is_read: bool
    created_at: datetime

    class Config:
        from_attributes = True


class WatchStatus(BaseModel):
    """Whether the current user watches an entity, and how many users do."""
    watching: bool
    watcher_count: int


# Analytics and Reporting Schemas

class KPIDataBase(BaseModel):
    metric_type: str
    metric_value: float
    trend_direction: str = "neutral"
    trend_change: float = 0.0
    time_period: str
    additional_data: Optional[Dict[str, Any]] = None


class KPIDataCreate(KPIDataBase):
    project_id: int


class KPIData(KPIDataBase):
    id: int
    project_id: int
    recorded_at: datetime

    class Config:
        from_attributes = True


class TestStepResultBase(BaseModel):
    step_number: int
    step_name: str
    step_status: str
    step_duration: float = 0.0
    error_message: Optional[str] = None
    screenshot_path: Optional[str] = None
    step_data: Optional[Dict[str, Any]] = None


class TestStepResultCreate(TestStepResultBase):
    test_result_id: int


class TestStepResult(TestStepResultBase):
    id: int
    test_result_id: int
    created_at: datetime

    class Config:
        from_attributes = True


class ShareableReportBase(BaseModel):
    title: str
    report_type: str
    report_content: Dict[str, Any]
    access_level: str = "read-only"
    shared_with: Optional[List[Union[int, str]]] = None
    expires_at: Optional[datetime] = None


class ShareableReportCreate(ShareableReportBase):
    project_id: int


class ShareableReport(ShareableReportBase):
    id: int
    project_id: int
    share_token: str
    created_by: int
    created_by_display: Optional[str] = None
    view_count: int
    last_viewed: Optional[datetime]
    created_at: datetime
    is_active: bool

    class Config:
        from_attributes = True


class RootCauseAnalysisBase(BaseModel):
    analysis_title: str
    root_cause: str
    impact_assessment: Optional[str] = None
    resolution_time_hours: Optional[float] = None
    fix_commit_hash: Optional[str] = None
    assigned_to: Optional[int] = None
    status: str = "open"
    severity: str = "medium"
    analysis_data: Optional[Dict[str, Any]] = None


class RootCauseAnalysisCreate(RootCauseAnalysisBase):
    project_id: int
    requirement_id: Optional[int] = None
    test_case_id: Optional[int] = None
    defect_id: Optional[int] = None
    # Set server-side from the authenticated user; clients do not supply it.
    discovered_by: Optional[int] = None


class RootCauseAnalysis(RootCauseAnalysisBase):
    id: int
    project_id: int
    requirement_id: Optional[int]
    test_case_id: Optional[int]
    defect_id: Optional[int]
    discovered_by: Optional[int]
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


class DashboardWidgetBase(BaseModel):
    widget_type: str
    widget_title: str
    widget_config: Dict[str, Any]
    position_x: int = 0
    position_y: int = 0
    width: int = 1
    height: int = 1
    is_visible: bool = True


class DashboardWidgetCreate(DashboardWidgetBase):
    user_id: int
    project_id: Optional[int] = None


class DashboardWidget(DashboardWidgetBase):
    id: int
    user_id: int
    project_id: Optional[int]
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


# Analytics Request/Response Schemas

class DashboardAnalyticsRequest(BaseModel):
    project_id: int
    time_period: str = "7d"
    metrics: List[str] = ["coverage", "pass_rate", "failure_trends", "flakiness", "cycle_time"]


class DashboardAnalyticsResponse(BaseModel):
    project_id: int
    time_period: str
    kpi_data: List[KPIData]
    recent_activity: Dict[str, Any]
    team_performance: Dict[str, Any]
    upcoming_items: Dict[str, Any]


class GranularInsightsRequest(BaseModel):
    project_id: Optional[int] = None
    test_run_id: Optional[int] = None
    test_case_id: Optional[int] = None
    filter_type: str = "all"  # all, failed, slow


class GranularInsightsResponse(BaseModel):
    test_step_results: List[TestStepResult]
    summary: Dict[str, Any]


class ShareableReportRequest(BaseModel):
    project_id: int
    title: str
    report_type: str
    shared_with: List[Union[int, str]] = Field(default_factory=list)
    access_level: str = "public"
    expires_in_days: Optional[int] = None
    time_range: str = "30d"
    period_start: Optional[datetime] = None
    period_end: Optional[datetime] = None
    snapshot_mode: str = "snapshot"
    include_sections: List[str] = Field(default_factory=list)
    export_formats: List[str] = Field(default_factory=lambda: ["json", "csv"])

    @field_validator('title')
    @classmethod
    def validate_shareable_report_title(cls, v):
        title = (v or "").strip()
        if not title:
            raise ValueError('Report title is required')
        if len(title) > 200:
            raise ValueError('Report title cannot exceed 200 characters')
        return title

    @field_validator('report_type')
    @classmethod
    def validate_shareable_report_type(cls, v):
        value = (v or "").strip().lower()
        allowed = {
            "summary", "executive", "technical",
            "release-readiness", "execution-summary", "defect-quality",
            "coverage-traceability", "flaky-tests", "team-activity",
            "audit-compliance", "milestone", "sprint-qa", "customer-quality",
        }
        if value not in allowed:
            raise ValueError('Invalid report type')
        return value

    @field_validator('access_level')
    @classmethod
    def validate_shareable_access_level(cls, v):
        value = (v or "public").strip().lower()
        if value not in {"public", "restricted", "read-only"}:
            raise ValueError('Invalid access level')
        return value

    @field_validator('time_range')
    @classmethod
    def validate_shareable_time_range(cls, v):
        value = (v or "30d").strip().lower()
        if value not in {"24h", "7d", "30d", "90d", "custom"}:
            raise ValueError('time_range must be one of 24h, 7d, 30d, 90d, or custom')
        return value

    @field_validator('snapshot_mode')
    @classmethod
    def validate_shareable_snapshot_mode(cls, v):
        value = (v or "snapshot").strip().lower()
        if value not in {"snapshot", "live"}:
            raise ValueError('snapshot_mode must be snapshot or live')
        return value

    @field_validator('include_sections')
    @classmethod
    def validate_shareable_sections(cls, v):
        allowed = {"kpis", "summary", "recent_activity", "trends", "team_performance", "upcoming"}
        sections = [str(item).strip().lower() for item in (v or []) if str(item).strip()]
        invalid = [item for item in sections if item not in allowed]
        if invalid:
            raise ValueError(f"Invalid report sections: {', '.join(invalid)}")
        return list(dict.fromkeys(sections))

    @field_validator('export_formats')
    @classmethod
    def validate_shareable_export_formats(cls, v):
        allowed = {"json", "csv"}
        formats = [str(item).strip().lower() for item in (v or []) if str(item).strip()]
        invalid = [item for item in formats if item not in allowed]
        if invalid:
            raise ValueError(f"Invalid export formats: {', '.join(invalid)}")
        return list(dict.fromkeys(formats or ["json", "csv"]))

    @field_validator('shared_with')
    @classmethod
    def validate_shareable_recipients(cls, v):
        recipients = []
        email_pattern = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
        for item in v or []:
            if isinstance(item, int):
                if item <= 0:
                    raise ValueError('Recipient user IDs must be positive')
                recipients.append(item)
                continue
            value = str(item).strip()
            if not value:
                continue
            if not email_pattern.match(value):
                raise ValueError(f"Invalid recipient email: {value}")
            recipients.append(value.lower())
        return list(dict.fromkeys(recipients))

    @model_validator(mode='after')
    def validate_shareable_period(self):
        if self.time_range == "custom":
            if not self.period_start or not self.period_end:
                raise ValueError('Custom reports require period_start and period_end')
            if self.period_start >= self.period_end:
                raise ValueError('period_start must be before period_end')
        if self.access_level == "restricted" and not self.shared_with:
            raise ValueError('Restricted reports require at least one recipient')
        return self


class RootCauseAnalysisRequest(BaseModel):
    project_id: int
    requirement_id: Optional[int] = None
    test_case_id: Optional[int] = None
    defect_id: Optional[int] = None


class ReportGenerationRequest(BaseModel):
    project_id: int
    report_type: str
    time_period: str = "7d"
    include_sections: List[str] = []
    format: str = "json"  # json, pdf, excel
