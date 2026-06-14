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

class RequirementBase(BaseModel):
    title: str
    description: Optional[str] = None
    # Server-derived from the project sequence (REQ-NNN); optional on input so the
    # client no longer manages a separate identifier.
    requirement_id: Optional[str] = None
    status: RequirementStatus = RequirementStatus.DRAFT
    priority: Priority = Priority.MEDIUM
    parent_requirement_id: Optional[int] = None
    folder_id: Optional[int] = None
    assigned_to: Optional[int] = None
    tags: Optional[str] = None
    acceptance_criteria: Optional[str] = None
    estimated_effort: Optional[float] = None

    @model_validator(mode='before')
    @classmethod
    def sanitize_html(cls, data):
        """Sanitize HTML in string fields to prevent XSS attacks.

        Unescape first so the operation is idempotent: requirement content is
        loaded into the edit form and sent back on every save, so a plain
        ``html.escape`` would compound (``&lt;`` -> ``&amp;lt;``) each update.
        """
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, str) and key not in ['status', 'priority']:
                    data[key] = html.escape(html.unescape(value))
        return data


class RequirementCreate(RequirementBase):
    project_id: int
    created_by: int


class RequirementUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[RequirementStatus] = None
    priority: Optional[Priority] = None
    parent_requirement_id: Optional[int] = None
    folder_id: Optional[int] = None
    assigned_to: Optional[int] = None
    tags: Optional[str] = None
    acceptance_criteria: Optional[str] = None
    estimated_effort: Optional[float] = None

    @model_validator(mode='before')
    @classmethod
    def sanitize_html(cls, data):
        """Sanitize HTML in string fields to prevent XSS attacks.

        Unescape first so re-saving an already-escaped value is idempotent
        rather than compounding the escaping on every update.
        """
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, str) and key not in ['status', 'priority']:
                    data[key] = html.escape(html.unescape(value))
        return data


class Requirement(RequirementBase):
    id: int
    project_seq: Optional[int] = None  # per-project sequence (URLs/badges)
    project_id: int
    created_by: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class FeatureFileImportResult(BaseModel):
    """Outcome of importing one or more Gherkin ``.feature`` files."""
    created: List[Requirement] = []
    # Human-readable notes for files/features that were skipped (empty, unparsable).
    skipped: List[str] = []


class RequirementReviewRequest(BaseModel):
    """Ask one or more teammates to review a requirement.

    Drives the engine's REVIEW notification (Work Inbox "Reviews"). ``reviewer_ids``
    are the people whose review is requested; ``note`` is an optional message shown
    in the notification.
    """
    reviewer_ids: List[int] = Field(..., min_length=1, max_length=50)
    note: Optional[str] = Field(default=None, max_length=500)

    @field_validator("reviewer_ids")
    @classmethod
    def _dedupe_reviewers(cls, v: List[int]) -> List[int]:
        seen: set[int] = set()
        ordered: List[int] = []
        for uid in v:
            if uid in seen:
                continue
            seen.add(uid)
            ordered.append(uid)
        return ordered

    @field_validator("note")
    @classmethod
    def _clean_note(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        cleaned = v.strip()
        return cleaned or None


class RequirementReviewRequestResult(BaseModel):
    """Outcome of a review request: who was actually notified."""
    message: str
    requirement_id: int
    notified_count: int
    reviewer_ids: List[int] = []


# --- Requirement folders / categories --------------------------------------

class RequirementFolderBase(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: Optional[str] = None
    parent_folder_id: Optional[int] = None

    @field_validator('name')
    @classmethod
    def validate_name(cls, v: str) -> str:
        cleaned = (v or '').strip()
        if not cleaned:
            raise ValueError('Folder name cannot be empty')
        if len(cleaned) > 255:
            raise ValueError('Folder name cannot exceed 255 characters')
        return cleaned


class RequirementFolderCreate(RequirementFolderBase):
    project_id: int


class RequirementFolderUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=255)
    description: Optional[str] = None
    parent_folder_id: Optional[int] = None

    @field_validator('name')
    @classmethod
    def validate_name(cls, v):
        if v is None:
            return v
        cleaned = v.strip()
        if not cleaned:
            raise ValueError('Folder name cannot be empty')
        return cleaned


class RequirementFolder(RequirementFolderBase):
    id: int
    project_seq: Optional[int] = None  # per-project sequence (URLs/badges)
    project_id: int
    requirement_count: int = 0
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# --- Requirement version history -------------------------------------------

class RequirementVersionAuthor(BaseModel):
    id: int
    username: str
    full_name: Optional[str] = None

    class Config:
        from_attributes = True


class RequirementVersionView(BaseModel):
    id: int
    requirement_id: int
    version_number: int
    action: str
    title: str
    description: Optional[str] = None
    acceptance_criteria: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    tags: Optional[str] = None
    estimated_effort: Optional[float] = None
    change_note: Optional[str] = None
    created_at: datetime
    author: Optional[RequirementVersionAuthor] = None

    class Config:
        from_attributes = True


class RequirementVersionRestore(BaseModel):
    change_note: Optional[str] = Field(default=None, max_length=500)


# --- Requirement comments / review threads ---------------------------------

REQUIREMENT_COMMENT_BODY_MAX_LENGTH = 10000


def _normalize_requirement_comment_body(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    body = value.strip()
    if not body:
        raise ValueError("Comment body cannot be empty")
    if len(body) > REQUIREMENT_COMMENT_BODY_MAX_LENGTH:
        raise ValueError(f"Comment body cannot exceed {REQUIREMENT_COMMENT_BODY_MAX_LENGTH} characters")
    return body


class RequirementCommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=REQUIREMENT_COMMENT_BODY_MAX_LENGTH)
    parent_id: Optional[int] = Field(default=None, ge=1)

    @field_validator("body")
    @classmethod
    def validate_body(cls, value: str) -> str:
        return _normalize_requirement_comment_body(value) or ""


class RequirementCommentUpdate(BaseModel):
    body: Optional[str] = Field(default=None, min_length=1, max_length=REQUIREMENT_COMMENT_BODY_MAX_LENGTH)
    is_resolved: Optional[bool] = None

    @field_validator("body")
    @classmethod
    def validate_body(cls, value: Optional[str]) -> Optional[str]:
        return _normalize_requirement_comment_body(value)


class RequirementCommentView(BaseModel):
    id: int
    requirement_id: int
    parent_id: Optional[int] = None
    body: str
    is_resolved: bool
    created_at: datetime
    updated_at: Optional[datetime] = None
    author: Optional[RequirementVersionAuthor] = None
    replies: List["RequirementCommentView"] = Field(default_factory=list)

    class Config:
        from_attributes = True


# --- Requirement project-wide AI chat --------------------------------------

class RequirementChatSource(BaseModel):
    type: str = "requirement"
    id: Optional[int] = None
    requirement_id: Optional[int] = None  # legacy field (pre multi-source rows)
    key: str
    title: str
    excerpt: Optional[str] = None


class RequirementChatMessageView(BaseModel):
    id: int
    role: str
    content: str
    sources: List[RequirementChatSource] = Field(default_factory=list)
    prompt_tokens: Optional[int] = None
    created_at: datetime

    @field_validator("sources", mode="before")
    @classmethod
    def coerce_sources(cls, value):
        # User turns persist sources as NULL; default_factory only fills a
        # missing key, not an explicit None, so coerce it here.
        return value or []

    class Config:
        from_attributes = True


CHAT_SHARE_SCOPES = {"private", "project", "restricted"}


class RequirementChatConversationView(BaseModel):
    id: int
    public_id: str
    project_id: int
    title: str
    archived: bool = False
    pinned: bool = False
    share_scope: str = "private"
    share_expires_at: Optional[datetime] = None
    share_allowed_user_ids: List[int] = Field(default_factory=list)
    created_at: datetime
    updated_at: Optional[datetime] = None
    messages: List[RequirementChatMessageView] = Field(default_factory=list)

    @field_validator("share_allowed_user_ids", mode="before")
    @classmethod
    def coerce_share_allowed_user_ids(cls, value):
        return value or []

    class Config:
        from_attributes = True


class RequirementChatSharedView(BaseModel):
    """A conversation fetched via its share link; read_only when the requester
    is not the owner."""
    conversation: RequirementChatConversationView
    read_only: bool = False


class RequirementChatConversationUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=255)
    archived: Optional[bool] = None
    pinned: Optional[bool] = None
    share_scope: Optional[str] = None
    share_expires_at: Optional[datetime] = None
    share_allowed_user_ids: Optional[List[int]] = None

    @field_validator("title")
    @classmethod
    def validate_title(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Title must not be empty")
        return cleaned

    @field_validator("share_scope")
    @classmethod
    def validate_share_scope(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = value.strip().lower()
        if normalized not in CHAT_SHARE_SCOPES:
            raise ValueError("Invalid share scope")
        return normalized

    @field_validator("share_allowed_user_ids")
    @classmethod
    def validate_share_allowed_user_ids(cls, value: Optional[List[int]]) -> Optional[List[int]]:
        if value is None:
            return None
        seen: List[int] = []
        for user_id in value:
            if user_id <= 0:
                raise ValueError("Share recipients must be valid users")
            if user_id not in seen:
                seen.append(user_id)
        if len(seen) > 100:
            raise ValueError("Share recipients cannot exceed 100 users")
        return seen


_CHAT_SOURCE_TYPES = {"requirements", "defects", "test_plans", "test_cases"}


def _clean_source_types(value: Optional[List[str]]) -> Optional[List[str]]:
    if value is None:
        return None
    invalid = [v for v in value if v not in _CHAT_SOURCE_TYPES]
    if invalid:
        raise ValueError(f"Invalid source type: {invalid[0]}")
    cleaned = [v for v in value if v in _CHAT_SOURCE_TYPES]
    # de-duplicate while preserving order
    seen: List[str] = []
    for v in cleaned:
        if v not in seen:
            seen.append(v)
    return seen


class RequirementChatAsk(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    conversation_id: Optional[int] = Field(default=None, ge=1)
    # Optional per-ask scope override; intersected server-side with the
    # admin-enabled scopes so a user can only narrow, never broaden.
    source_types: Optional[List[str]] = None

    @field_validator("question")
    @classmethod
    def validate_question(cls, value: str) -> str:
        cleaned = (value or "").strip()
        if not cleaned:
            raise ValueError("Question must not be empty")
        return cleaned

    @field_validator("source_types")
    @classmethod
    def validate_source_types(cls, value: Optional[List[str]]) -> Optional[List[str]]:
        return _clean_source_types(value)


class RequirementChatRegenerate(BaseModel):
    source_types: Optional[List[str]] = None

    @field_validator("source_types")
    @classmethod
    def validate_source_types(cls, value: Optional[List[str]]) -> Optional[List[str]]:
        return _clean_source_types(value)


class RequirementChatAskResponse(BaseModel):
    conversation_id: int
    message: RequirementChatMessageView
    retrieval_truncated: bool = False
    requirements_considered: int = 0
    requirements_used: int = 0
    items_considered: int = 0
    items_used: int = 0
    source_counts: Dict[str, int] = Field(default_factory=dict)
    selected_source_counts: Dict[str, int] = Field(default_factory=dict)
    confidence: str = "low"
    insufficient_context: bool = False
    coverage_note: Optional[str] = None


# --- Coverage badges (batched per project) ---------------------------------

class RequirementCoverageItem(BaseModel):
    requirement_id: int
    linked_count: int = 0
    active_count: int = 0
    failed_related_runs: int = 0
    blocked_related_runs: int = 0
    # Derived rollup: covered | partial | failing | blocked | uncovered
    status: str = "uncovered"


class RequirementCoverageList(BaseModel):
    items: List[RequirementCoverageItem] = Field(default_factory=list)


# --- Bulk requirement actions ----------------------------------------------

class BulkRequirementUpdate(BaseModel):
    ids: List[int] = Field(min_length=1, max_length=2000)
    status: Optional[RequirementStatus] = None
    priority: Optional[Priority] = None
    assigned_to: Optional[int] = None
    clear_assignee: bool = False
    tags: Optional[str] = Field(default=None, max_length=500)
    add_tags: Optional[str] = Field(default=None, max_length=500)
    remove_tags: Optional[str] = Field(default=None, max_length=500)


class BulkRequirementDelete(BaseModel):
    ids: List[int] = Field(min_length=1, max_length=2000)


class RequirementExternalDocumentRequest(BaseModel):
    project_id: int
    url: str = Field(..., min_length=8, max_length=2000)


class RequirementTrackerImportRequest(BaseModel):
    project_id: int
    source: str = Field(..., pattern="^(asana|linear|monday)$")
    url: str = Field(..., min_length=8, max_length=2000)


class RequirementExternalDocumentResponse(BaseModel):
    source_type: str
    title: str
    description: Optional[str] = None
    acceptance_criteria: Optional[str] = None
    external_key: Optional[str] = None
    url: str


class RequirementTraceabilitySummary(BaseModel):
    linked_count: int = 0
    active_count: int = 0
    missing_coverage: int = 1
    failed_related_runs: int = 0
    blocked_related_runs: int = 0


class RequirementLinkedTestCase(BaseModel):
    id: int
    title: str
    priority: str
    status: str
    test_suite_id: int
    section_id: Optional[int] = None
    reference: Optional[str] = None
    tags: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    suite_name: Optional[str] = None
    section_name: Optional[str] = None
    linked: bool = False
    link_id: Optional[int] = None
    latest_run_status: Optional[str] = None
    latest_run_at: Optional[datetime] = None


class RequirementLinkedTestCaseList(BaseModel):
    items: List[RequirementLinkedTestCase]
    total: int
    skip: int
    limit: int
    summary: RequirementTraceabilitySummary


class RequirementLinkedTestCaseBulkRequest(BaseModel):
    test_case_ids: List[int] = Field(..., min_length=1, max_length=500)
    action: str = Field(..., pattern="^(link|unlink)$")


class RequirementLinkedTestCaseBulkResponse(BaseModel):
    linked_count: int = 0
    unlinked_count: int = 0
    skipped_count: int = 0
    items: List[RequirementLinkedTestCase]
    summary: RequirementTraceabilitySummary


class RequirementLinkedTestCaseCreate(TestCaseCreate):
    pass


class RequirementLinkedTestCaseHistoryItem(BaseModel):
    id: int
    action: str
    test_case_id: Optional[int] = None
    test_case_title: Optional[str] = None
    user_id: int
    username: Optional[str] = None
    full_name: Optional[str] = None
    created_at: datetime
    description: Optional[str] = None


class RequirementLinkedTestCaseHistory(BaseModel):
    items: List[RequirementLinkedTestCaseHistoryItem]
    total: int
    limit: int
    offset: int


class RequirementLinkedTestPlan(BaseModel):
    id: int
    title: str
    status: Optional[str] = None
    milestone_id: Optional[int] = None
    milestone_title: Optional[str] = None
    target_start_date: Optional[datetime] = None
    target_end_date: Optional[datetime] = None
    linked: bool = False


class RequirementLinkedTestPlanList(BaseModel):
    items: List[RequirementLinkedTestPlan]
    total: int
    skip: int
    limit: int


class RequirementLinkedTestPlanBulkRequest(BaseModel):
    test_plan_ids: List[int] = Field(..., min_length=1, max_length=200)
    action: str = Field(..., pattern="^(link|unlink)$")

    @field_validator('test_plan_ids')
    @classmethod
    def validate_test_plan_ids(cls, v: List[int]) -> List[int]:
        if any(test_plan_id <= 0 for test_plan_id in v):
            raise ValueError('test_plan_ids must contain positive integers')
        return v


class RequirementLinkedTestPlanBulkResponse(BaseModel):
    linked_count: int = 0
    unlinked_count: int = 0
    skipped_count: int = 0
    items: List[RequirementLinkedTestPlan]


# --- Test plan -> requirement linking (the inverse of the above) ---
class TestPlanLinkedRequirement(BaseModel):
    id: int
    requirement_id: str
    title: str
    status: Optional[str] = None
    priority: Optional[str] = None
    linked: bool = False


class TestPlanLinkedRequirementList(BaseModel):
    items: List[TestPlanLinkedRequirement]
    total: int
    skip: int
    limit: int


class TestPlanLinkedRequirementBulkRequest(BaseModel):
    requirement_ids: List[int] = Field(..., min_length=1, max_length=200)
    action: str = Field(..., pattern="^(link|unlink)$")

    @field_validator('requirement_ids')
    @classmethod
    def validate_requirement_ids(cls, v: List[int]) -> List[int]:
        if any(requirement_id <= 0 for requirement_id in v):
            raise ValueError('requirement_ids must contain positive integers')
        return v


class TestPlanLinkedRequirementBulkResponse(BaseModel):
    linked_count: int = 0
    unlinked_count: int = 0
    skipped_count: int = 0
    items: List[TestPlanLinkedRequirement]


class RequirementRelationshipCount(BaseModel):
    total: int = 0
    items: List[Dict[str, Any]] = Field(default_factory=list)


class RequirementRelationshipSummary(BaseModel):
    test_cases: RequirementTraceabilitySummary
    defects: RequirementRelationshipCount
    test_plans: RequirementRelationshipCount
    milestones: RequirementRelationshipCount
    test_runs: RequirementRelationshipCount
    coverage_reports: RequirementRelationshipCount
