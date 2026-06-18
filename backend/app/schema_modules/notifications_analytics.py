from pydantic import AliasChoices, BaseModel, EmailStr, field_validator, HttpUrl, model_validator, Field
from typing import List, Optional, Dict, Any, Union
from datetime import datetime, timezone
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


def _ensure_future(value: datetime) -> datetime:
    """Reject a snooze target that is not in the future.

    Naive datetimes are treated as UTC so a client that omits an offset can't
    accidentally land a snooze in the past (or smuggle one through).
    """
    aware = value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
    if aware <= datetime.now(timezone.utc):
        raise ValueError("snooze time must be in the future")
    return value


class InboxSnoozeRequest(BaseModel):
    """Defer a single inbox item until ``until`` (must be in the future)."""
    until: datetime

    @field_validator("until")
    @classmethod
    def _future(cls, v: datetime) -> datetime:
        return _ensure_future(v)


# The triage actions the Work Inbox can apply to a selection of items at once.
INBOX_BULK_ACTIONS = ("archive", "unarchive", "read", "unread", "snooze")


class InboxBulkAction(BaseModel):
    """Apply one triage action to a set of the current user's inbox items.

    ``snooze`` requires ``until``; the other actions ignore it. ``ids`` is capped
    to keep a single request bounded (mirrors the notification bulk endpoints).
    """
    ids: List[int] = Field(..., min_length=1, max_length=200)
    action: str
    until: Optional[datetime] = None

    @field_validator("action")
    @classmethod
    def _valid_action(cls, v: str) -> str:
        if v not in INBOX_BULK_ACTIONS:
            raise ValueError(f"action must be one of {list(INBOX_BULK_ACTIONS)}")
        return v

    @model_validator(mode="after")
    def _check_until(self):
        if self.action == "snooze":
            if self.until is None:
                raise ValueError("until is required when action is 'snooze'")
            _ensure_future(self.until)
        return self


class InboxBulkResult(BaseModel):
    """How many items a bulk inbox action actually touched."""
    affected_count: int


class InboxActorOption(BaseModel):
    """One actor available for the current Work Inbox filter."""
    id: int
    name: str


class InboxProjectOption(BaseModel):
    """One project available for the current Work Inbox filter."""
    id: int
    name: str


class NotificationPreferencesUpdate(BaseModel):
    do_not_disturb: Optional[bool] = None
    notification_sound_enabled: Optional[bool] = None
    mute_duration_hours: Optional[int] = None


class NotificationCategoryInfo(BaseModel):
    """One row of the preferences grid: a category and its current delivery flags.

    ``key``/``label`` come from the engine's category registry; ``actionable`` lets
    the Settings page group inbox categories apart from purely informational ones.
    ``in_app``/``email`` reflect the user's saved preference, defaulting on for any
    category they have never customised.
    """
    key: str
    label: str
    actionable: bool
    in_app: bool = True
    email: bool = True


class NotificationPreferencesResponse(BaseModel):
    """The full preferences grid for the current user (one entry per category)."""
    categories: List[NotificationCategoryInfo]


class NotificationCategoryPreference(BaseModel):
    """A single category's desired delivery flags in a preferences update."""
    category: str
    in_app: bool = True
    email: bool = True


class NotificationPreferencesPut(BaseModel):
    """Replace the current user's preference rows with the supplied set.

    Each entry names a category and its desired in-app/email flags. Unknown
    categories are rejected server-side against the engine registry so the table
    never accumulates dead keys.
    """
    preferences: List[NotificationCategoryPreference] = Field(..., max_length=50)


class AnnouncementCreate(BaseModel):
    """An admin broadcast emitted as a bell-only SYSTEM notification.

    ``audience`` is either ``"all"`` (every active user) or ``"project"`` (members
    of ``project_id`` — its owner plus assignees). ``project_id`` is required when
    and only when the audience is a project.
    """
    title: str = Field(..., min_length=1, max_length=200)
    message: str = Field(..., min_length=1, max_length=2000)
    audience: str = Field(default="all")
    project_id: Optional[int] = None

    @field_validator("title", "message")
    @classmethod
    def _strip_required(cls, v: str) -> str:
        cleaned = (v or "").strip()
        if not cleaned:
            raise ValueError("must not be empty")
        return cleaned

    @field_validator("audience")
    @classmethod
    def _validate_audience(cls, v: str) -> str:
        value = (v or "all").strip().lower()
        if value not in {"all", "project"}:
            raise ValueError("audience must be 'all' or 'project'")
        return value

    @model_validator(mode="after")
    def _check_project(self):
        if self.audience == "project" and not self.project_id:
            raise ValueError("project_id is required when audience is 'project'")
        if self.audience == "all":
            self.project_id = None
        return self


class AnnouncementResult(BaseModel):
    """Outcome of an announcement broadcast: how many users were notified."""
    message: str
    audience: str
    project_id: Optional[int] = None
    notified_count: int


class Notification(NotificationBase):
    id: int
    user_id: int
    is_read: bool
    category: Optional[str] = None
    archived: bool = False
    # Inbox triage lifecycle (Plan B / W0): snooze hides a row from the open inbox
    # until it elapses; done_at records when it was archived. Both null by default.
    snoozed_until: Optional[datetime] = None
    done_at: Optional[datetime] = None
    actor_id: Optional[int] = None
    # Resolved display name of the actor, attached by the inbox route for the
    # avatar/byline. Not a stored column, so it is optional and defaults to None.
    actor_name: Optional[str] = None
    # Owning project, resolved per page by the inbox route (group-by-project view).
    # Not stored on the row; None when the entity has no project or was deleted.
    project_id: Optional[int] = None
    project_name: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class InboxCategorySummary(BaseModel):
    """Per-category open/snoozed/done/unread counts for the Work Inbox rail."""
    key: str
    label: str
    open: int
    snoozed: int = 0
    done: int
    unread: int


class InboxSummary(BaseModel):
    """Aggregate counts that drive the Work Inbox header and the navbar badge."""
    total_open: int
    total_unread: int
    total_snoozed: int = 0
    categories: List[InboxCategorySummary]


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
