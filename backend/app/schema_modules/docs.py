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
from .execution_assets import *

# ===========================================================================
# Doc Hub — Docs-as-Code documentation
# ===========================================================================

DOC_TITLE_MAX = 255
DOC_TAGS_MAX = 500


def _clean_plain_text(value: Optional[str], *, max_len: Optional[int] = None) -> Optional[str]:
    """Strip and HTML-escape a short plain-text field (title/tags/classification).

    Unescape first so re-saving an already-escaped value stays idempotent. The
    canonical ``content_markdown`` is intentionally NOT escaped here — it is
    sanitized on render by the frontend so Markdown stays clean and diffable.
    """
    if value is None:
        return None
    cleaned = html.escape(html.unescape(value)).strip()
    if max_len is not None and len(cleaned) > max_len:
        cleaned = cleaned[:max_len]
    return cleaned


class DocSpaceBase(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: Optional[str] = None
    classification: Optional[str] = Field(default=None, max_length=100)
    icon: Optional[str] = Field(default=None, max_length=50)
    color: Optional[str] = Field(default=None, max_length=20)

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: str) -> str:
        cleaned = (v or "").strip()
        if not cleaned:
            raise ValueError("Space name cannot be empty")
        return cleaned

    @field_validator("classification", "icon", "color")
    @classmethod
    def _strip_optional_short_text(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        cleaned = v.strip()
        return cleaned or None


class DocSpaceCreate(DocSpaceBase):
    # NULL => a global space, otherwise project-scoped.
    project_id: Optional[int] = None


class DocSpaceUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = None
    classification: Optional[str] = Field(default=None, max_length=100)
    icon: Optional[str] = Field(default=None, max_length=50)
    color: Optional[str] = Field(default=None, max_length=20)
    order_index: Optional[int] = None

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Space name cannot be empty")
        return cleaned

    @field_validator("classification", "icon", "color")
    @classmethod
    def _strip_optional_short_text(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        cleaned = v.strip()
        return cleaned or None


class DocSpace(DocSpaceBase):
    id: int
    project_seq: Optional[int] = None  # per-project sequence (URLs/badges)
    uuid: Optional[str] = None
    slug: str
    project_id: Optional[int] = None
    order_index: int = 0
    doc_count: int = 0
    created_by: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class DocFolderBase(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    parent_folder_id: Optional[int] = None

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: str) -> str:
        cleaned = (v or "").strip()
        if not cleaned:
            raise ValueError("Folder name cannot be empty")
        return cleaned


class DocFolderCreate(DocFolderBase):
    space_id: int


class DocFolderUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    parent_folder_id: Optional[int] = None
    order_index: Optional[int] = None

    @field_validator("name")
    @classmethod
    def _validate_name(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Folder name cannot be empty")
        return cleaned


class DocFolder(DocFolderBase):
    id: int
    uuid: Optional[str] = None
    space_id: int
    order_index: int = 0
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class DocBase(BaseModel):
    title: str = Field(min_length=1, max_length=DOC_TITLE_MAX)
    content_markdown: Optional[str] = ""
    classification: Optional[str] = Field(default=None, max_length=100)
    status: DocStatus = DocStatus.DRAFT
    tags: Optional[str] = Field(default=None, max_length=DOC_TAGS_MAX)
    dir: Optional[str] = "auto"
    language: Optional[str] = Field(default=None, max_length=20)
    folder_id: Optional[int] = None

    @field_validator("title")
    @classmethod
    def _validate_title(cls, v: str) -> str:
        cleaned = (v or "").strip()
        if not cleaned:
            raise ValueError("Title cannot be empty")
        return cleaned

    @field_validator("content_markdown", mode="before")
    @classmethod
    def _normalize_content(cls, v: Optional[str]) -> str:
        return v or ""

    @field_validator("classification", "tags", "language")
    @classmethod
    def _strip_optional_text(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        cleaned = v.strip()
        return cleaned or None

    @field_validator("dir")
    @classmethod
    def _validate_dir(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return "auto"
        if v not in {"ltr", "rtl", "auto"}:
            raise ValueError("dir must be one of: ltr, rtl, auto")
        return v


class DocCreate(DocBase):
    space_id: int


class DocUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=DOC_TITLE_MAX)
    content_markdown: Optional[str] = None
    classification: Optional[str] = Field(default=None, max_length=100)
    status: Optional[DocStatus] = None
    tags: Optional[str] = Field(default=None, max_length=DOC_TAGS_MAX)
    dir: Optional[str] = None
    language: Optional[str] = Field(default=None, max_length=20)
    folder_id: Optional[int] = None
    space_id: Optional[int] = None
    # Optional note stored on the version snapshot created by this save.
    change_note: Optional[str] = Field(default=None, max_length=500)

    @field_validator("dir")
    @classmethod
    def _validate_dir(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in {"ltr", "rtl", "auto"}:
            raise ValueError("dir must be one of: ltr, rtl, auto")
        return v

    @field_validator("title")
    @classmethod
    def _validate_title(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Title cannot be empty")
        return cleaned

    @field_validator("content_markdown", mode="before")
    @classmethod
    def _normalize_content(cls, v: Optional[str]) -> Optional[str]:
        return "" if v is None else v

    @field_validator("classification", "tags", "language", "change_note")
    @classmethod
    def _strip_optional_text(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        cleaned = v.strip()
        return cleaned or None


class DocSuggestion(BaseModel):
    """A smart, auto-computed "you might also want" document suggestion."""
    id: int
    uuid: Optional[str] = None
    title: str
    slug: str
    space_id: int
    project_id: Optional[int] = None
    classification: Optional[str] = None
    status: DocStatus
    tags: Optional[str] = None
    excerpt: Optional[str] = None
    current_version: int = 0
    score: float = 0.0
    matched_tags: List[str] = Field(default_factory=list)


class DocDuplicateCandidate(DocSuggestion):
    reasons: List[str] = Field(default_factory=list)


class DocMergeRequest(BaseModel):
    source_doc_id: int = Field(ge=1)
    note: Optional[str] = Field(default=None, max_length=500)

    @field_validator("note")
    @classmethod
    def _strip_note(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        cleaned = v.strip()
        return cleaned or None


class DocFacetValue(BaseModel):
    value: str
    count: int


class DocFacets(BaseModel):
    tags: List[DocFacetValue] = Field(default_factory=list)
    classifications: List[DocFacetValue] = Field(default_factory=list)


class DocListItem(BaseModel):
    """Lightweight doc row for the hub list (excludes full content)."""
    id: int
    project_seq: Optional[int] = None  # per-project sequence (URLs/badges)
    uuid: Optional[str] = None
    title: str
    slug: str
    space_id: int
    folder_id: Optional[int] = None
    project_id: Optional[int] = None
    classification: Optional[str] = None
    status: DocStatus
    tags: Optional[str] = None
    dir: Optional[str] = None
    language: Optional[str] = None
    excerpt: Optional[str] = None
    current_version: int = 0
    share_scope: str = "private"
    view_count: Optional[int] = None
    last_viewed_at: Optional[datetime] = None
    my_last_visited_at: Optional[datetime] = None
    is_pinned: bool = False
    created_by: int
    updated_by: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class Doc(DocBase):
    id: int
    project_seq: Optional[int] = None  # per-project sequence (URLs/badges)
    uuid: Optional[str] = None
    slug: str
    space_id: int
    project_id: Optional[int] = None
    current_version: int = 0
    public_id: Optional[str] = None
    share_scope: str = "private"
    share_expires_at: Optional[datetime] = None
    view_count: Optional[int] = None
    last_viewed_at: Optional[datetime] = None
    my_last_visited_at: Optional[datetime] = None
    is_pinned: bool = False
    created_by: int
    updated_by: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    # Per-request capability flags for the current user (set by the route).
    can_edit: bool = False
    can_delete: bool = False
    can_share: bool = False
    can_view_stats: bool = False

    class Config:
        from_attributes = True


class DocMergeResult(BaseModel):
    target_doc: Doc
    archived_source_doc: Doc
    transferred: Dict[str, int] = Field(default_factory=dict)
    preserved_reference_count: int = 0


DOC_SHARE_SCOPES = {"private", "restricted", "public"}
DOC_SHARE_GRANT_TYPES = {"user", "role", "project"}
DOC_SHARE_ROLES = {"viewer", "tester", "manager", "admin"}


class DocShareUpdate(BaseModel):
    share_scope: str = "private"  # private | restricted | public
    share_expires_at: Optional[datetime] = None

    @field_validator("share_scope", mode="before")
    @classmethod
    def _validate_scope(cls, v: str) -> str:
        normalized = str(v or "").strip().lower()
        if normalized not in DOC_SHARE_SCOPES:
            raise ValueError("share_scope must be 'private', 'restricted', or 'public'")
        return normalized


class DocShareGrantCreate(BaseModel):
    """Add a granular grant to a doc. Exactly one subject is required,
    matching ``grant_type``."""
    grant_type: str  # user | role | project
    subject_user_id: Optional[int] = None
    subject_role: Optional[str] = None
    subject_project_id: Optional[int] = None
    expires_at: Optional[datetime] = None

    @field_validator("grant_type", mode="before")
    @classmethod
    def _validate_type(cls, v: str) -> str:
        normalized = str(v or "").strip().lower()
        if normalized not in DOC_SHARE_GRANT_TYPES:
            raise ValueError("grant_type must be 'user', 'role', or 'project'")
        return normalized

    @field_validator("subject_role", mode="before")
    @classmethod
    def _validate_role(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        normalized = str(v).strip().lower()
        if normalized and normalized not in DOC_SHARE_ROLES:
            raise ValueError("subject_role must be one of: viewer, tester, manager, admin")
        return normalized or None

    @model_validator(mode="after")
    def _check_subject(self) -> "DocShareGrantCreate":
        # Require the subject matching the grant type, and null out the others so
        # a stray field (e.g. a role sent on a 'user' grant) can't pollute the
        # stored row, the uniqueness key, or access matching.
        if self.grant_type == "user":
            if not self.subject_user_id:
                raise ValueError("subject_user_id is required for a 'user' grant")
            self.subject_role = None
            self.subject_project_id = None
        elif self.grant_type == "role":
            if not self.subject_role:
                raise ValueError("subject_role is required for a 'role' grant")
            self.subject_user_id = None
            self.subject_project_id = None
        elif self.grant_type == "project":
            if not self.subject_project_id:
                raise ValueError("subject_project_id is required for a 'project' grant")
            self.subject_user_id = None
            self.subject_role = None
        return self


class DocShareGrantView(BaseModel):
    id: int
    grant_type: str
    subject_user_id: Optional[int] = None
    subject_role: Optional[str] = None
    subject_project_id: Optional[int] = None
    # Display labels resolved by the route for the UI.
    subject_label: Optional[str] = None
    subject_sublabel: Optional[str] = None
    expires_at: Optional[datetime] = None
    is_expired: bool = False
    created_by: Optional[int] = None
    created_at: Optional[datetime] = None


class DocShareAuditView(BaseModel):
    id: int
    action: str
    detail: Optional[str] = None
    actor_id: Optional[int] = None
    actor_name: Optional[str] = None
    created_at: Optional[datetime] = None


class DocPinUpdate(BaseModel):
    pinned: bool = False


class DocShareInfo(BaseModel):
    share_scope: str
    public_id: Optional[str] = None
    share_expires_at: Optional[datetime] = None
    share_url: Optional[str] = None
    grants: List[DocShareGrantView] = Field(default_factory=list)


class DocPublicView(BaseModel):
    """Read-only doc payload served over a public share link (no auth)."""
    id: int
    uuid: Optional[str] = None
    title: str
    slug: str
    content_markdown: str = ""
    classification: Optional[str] = None
    tags: Optional[str] = None
    dir: Optional[str] = "auto"
    status: DocStatus
    current_version: int = 0
    updated_at: Optional[datetime] = None

    @field_validator("content_markdown", mode="before")
    @classmethod
    def _normalize_content(cls, v: Optional[str]) -> str:
        return v or ""

    class Config:
        from_attributes = True


class DocVersionAuthor(BaseModel):
    id: int
    username: str
    full_name: Optional[str] = None

    class Config:
        from_attributes = True


class DocVersionView(BaseModel):
    id: int
    doc_id: int
    version_number: int
    action: str
    title: str
    content_markdown: Optional[str] = None
    status: Optional[str] = None
    classification: Optional[str] = None
    tags: Optional[str] = None
    change_note: Optional[str] = None
    created_at: datetime
    author: Optional[DocVersionAuthor] = None

    class Config:
        from_attributes = True


class DocVersionRestore(BaseModel):
    change_note: Optional[str] = Field(default=None, max_length=500)


class DocRequirementLinkCreate(BaseModel):
    requirement_id: int = Field(ge=1)


class DocRequirementLinkView(BaseModel):
    id: int
    doc_id: int
    requirement_id: int
    requirement_key: Optional[str] = None
    requirement_title: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class DocRelatedLinkCreate(BaseModel):
    related_doc_id: int = Field(ge=1)


class DocRelatedLinkView(BaseModel):
    id: int
    doc_id: int
    related_doc_id: int
    related_doc_title: Optional[str] = None
    related_doc_project_id: Optional[int] = None
    created_at: datetime


DOC_FEEDBACK_TYPES = {"helpful", "not_helpful", "clarification", "outdated"}


class DocFeedbackCreate(BaseModel):
    feedback_type: str
    comment: Optional[str] = Field(default=None, max_length=2000)
    section_text: Optional[str] = Field(default=None, max_length=1000)

    @field_validator("feedback_type", mode="before")
    @classmethod
    def _validate_feedback_type(cls, v: str) -> str:
        normalized = str(v or "").strip().lower()
        if normalized not in DOC_FEEDBACK_TYPES:
            raise ValueError("feedback_type must be helpful, not_helpful, clarification, or outdated")
        return normalized

    @field_validator("comment", "section_text")
    @classmethod
    def _strip_optional_feedback_text(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        cleaned = v.strip()
        return cleaned or None

    @model_validator(mode="after")
    def _require_actionable_comment(self):
        if self.feedback_type in {"clarification", "outdated"} and not self.comment:
            raise ValueError("A comment is required for clarification and outdated feedback")
        return self


class DocFeedbackResolve(BaseModel):
    resolved: bool = False


class DocFeedbackUser(BaseModel):
    id: int
    username: str
    full_name: Optional[str] = None
    email: Optional[str] = None

    class Config:
        from_attributes = True


class DocFeedbackView(BaseModel):
    id: int
    doc_id: int
    user_id: int
    feedback_type: str
    comment: Optional[str] = None
    section_text: Optional[str] = None
    resolved: bool = False
    created_at: datetime
    updated_at: Optional[datetime] = None
    user: Optional[DocFeedbackUser] = None

    class Config:
        from_attributes = True


class DocFeedbackSummary(BaseModel):
    doc_id: int
    helpful: int = 0
    not_helpful: int = 0
    clarification: int = 0
    outdated: int = 0
    unresolved: int = 0
    my_feedback: Optional[DocFeedbackView] = None


class DocStats(BaseModel):
    doc_id: int
    view_count: int = 0
    unique_visitors: int = 0
    last_viewed_at: Optional[datetime] = None
    latest_visits: List[Dict[str, Any]] = Field(default_factory=list)


class DocStatsMostViewed(BaseModel):
    id: int
    title: str
    space_id: int
    project_id: Optional[int] = None
    status: str
    view_count: int = 0
    last_viewed_at: Optional[datetime] = None


class DocStatsOverview(BaseModel):
    total_docs: int = 0
    total_views: int = 0
    unique_visitors: int = 0
    by_status: Dict[str, int] = Field(default_factory=dict)
    most_viewed: List[DocStatsMostViewed] = Field(default_factory=list)


# --- Doc -> Requirement converter ------------------------------------------

# A requirement's rich-text body can be sizeable; cap overrides defensively.
_CONVERT_HTML_MAX = 60_000


class DocConvertRequest(BaseModel):
    mode: str = "single"  # single | split
    # 0 = auto-detect the split level from the document structure.
    heading_level: int = Field(default=2, ge=0, le=3)  # used by split mode
    target_project_id: Optional[int] = None  # required when the doc is global
    folder_id: Optional[int] = None  # requirement folder
    default_status: RequirementStatus = RequirementStatus.DRAFT
    default_priority: Priority = Priority.MEDIUM
    # Optional per-item overrides keyed by section index (from the preview /
    # AI enhancement). When omitted, the server-built plan is used as-is.
    items: Optional[List["DocConvertItem"]] = None
    # Brand-new requirements the user accepted from the AI gap analysis — created
    # in addition to the doc-derived sections.
    extra_items: Optional[List["DocConvertExtraItem"]] = Field(default=None, max_length=50)

    @field_validator("mode")
    @classmethod
    def _validate_mode(cls, v: str) -> str:
        if v not in {"single", "split"}:
            raise ValueError("mode must be 'single' or 'split'")
        return v


class DocConvertItem(BaseModel):
    index: int
    title: str = Field(min_length=1, max_length=255)
    include: bool = True
    # Optional HTML overrides applied when the user accepts an AI suggestion for
    # this section. ``None`` keeps the server-rendered plan content.
    description_html: Optional[str] = Field(default=None, max_length=_CONVERT_HTML_MAX)
    acceptance_html: Optional[str] = Field(default=None, max_length=_CONVERT_HTML_MAX)

    @field_validator("title")
    @classmethod
    def _validate_title(cls, v: str) -> str:
        cleaned = (v or "").strip()
        if not cleaned:
            raise ValueError("Requirement title cannot be empty")
        return cleaned


class DocConvertExtraItem(BaseModel):
    """A new requirement (not derived from a doc section) accepted from the AI
    gap analysis."""
    title: str = Field(min_length=1, max_length=255)
    description_html: str = Field(default="", max_length=_CONVERT_HTML_MAX)
    acceptance_html: Optional[str] = Field(default=None, max_length=_CONVERT_HTML_MAX)

    @field_validator("title")
    @classmethod
    def _validate_title(cls, v: str) -> str:
        cleaned = (v or "").strip()
        if not cleaned:
            raise ValueError("Requirement title cannot be empty")
        return cleaned


class DocConvertPreviewItem(BaseModel):
    index: int
    title: str
    description_html: str
    is_acceptance_criteria: bool = False
    # Split-mode sections may carry their own extracted acceptance criteria.
    acceptance_html: str = ""


class DocConvertPreview(BaseModel):
    mode: str
    items: List[DocConvertPreviewItem]


class DocConvertResult(BaseModel):
    created: List["Requirement"]
    links: List[DocRequirementLinkView]


# --- AI conversion enhancement ----------------------------------------------

class DocConvertEnhanceRequest(BaseModel):
    mode: str = "single"
    heading_level: int = Field(default=2, ge=0, le=3)
    # Optional edited preview rows. When provided, AI reviews exactly what the user
    # is about to convert instead of the raw server extraction.
    items: Optional[List["DocConvertItem"]] = None

    @field_validator("mode")
    @classmethod
    def _validate_mode(cls, v: str) -> str:
        if v not in {"single", "split"}:
            raise ValueError("mode must be 'single' or 'split'")
        return v


class DocConvertEnhanceItem(BaseModel):
    index: int
    # 0–100 quality score the model assigned to the draft requirement.
    quality_score: int = 0
    issues: List[str] = Field(default_factory=list)
    edge_cases: List[str] = Field(default_factory=list)
    suggested_title: str = ""
    # Pre-rendered HTML so the client can preview/apply the suggestion directly.
    suggested_description_html: str = ""
    suggested_acceptance_html: str = ""


class DocConvertSuggestedRequirement(BaseModel):
    title: str
    description_html: str = ""
    acceptance_html: str = ""
    rationale: str = ""


class DocConvertEnhanceResult(BaseModel):
    ai_available: bool = False
    ai_skipped_reason: Optional[str] = None
    summary: Optional[str] = None
    items: List[DocConvertEnhanceItem] = Field(default_factory=list)
    suggested_requirements: List[DocConvertSuggestedRequirement] = Field(default_factory=list)
    provider: Optional[str] = None
    model: Optional[str] = None


DocConvertRequest.model_rebuild()
DocConvertResult.model_rebuild()
DocConvertEnhanceRequest.model_rebuild()


# --- Change impact analysis ------------------------------------------------- #

class DocImpactRequest(BaseModel):
    # The unsaved editor draft, so the editor can analyze *before* saving. When
    # omitted, the doc's currently-stored content is analyzed.
    candidate_markdown: Optional[str] = Field(default=None, max_length=200_000)
    include_ai: bool = True


class DocImpactItem(BaseModel):
    type: str                       # requirement | test_case | defect
    id: int
    key: str
    title: str
    reason: str                     # linked | similar
    score: float = 0.0
    status: Optional[str] = None
    severity: Optional[str] = None
    is_open: Optional[bool] = None
    # Requirement key(s) a test case / defect was reached through.
    via: List[str] = Field(default_factory=list)


class DocImpactChangeSummary(BaseModel):
    changed: bool = False
    headings_added: List[str] = Field(default_factory=list)
    headings_removed: List[str] = Field(default_factory=list)
    char_delta: int = 0
    note: str = ""


class DocImpactRiskSignals(BaseModel):
    impacted_requirements: int = 0
    impacted_test_cases: int = 0
    impacted_defects: int = 0
    open_defects: int = 0
    high_severity_defects: int = 0
    uncovered_requirements: int = 0


class DocImpactRisk(BaseModel):
    area: str = "general"           # requirements | tests | defects | general
    severity: str = "medium"        # low | medium | high
    title: str
    detail: str = ""
    mitigation: str = ""


class DocImpactAnalysis(BaseModel):
    doc_id: int
    project_id: Optional[int] = None
    change_summary: DocImpactChangeSummary
    requirements: List[DocImpactItem] = Field(default_factory=list)
    test_cases: List[DocImpactItem] = Field(default_factory=list)
    defects: List[DocImpactItem] = Field(default_factory=list)
    risk_signals: DocImpactRiskSignals
    # AI risk assessment (best-effort; absent when AI is off/unavailable).
    ai_available: bool = False
    ai_skipped_reason: Optional[str] = None
    ai_summary: Optional[str] = None
    recommendation: Optional[str] = None  # publish | review | hold
    risks: List[DocImpactRisk] = Field(default_factory=list)
    provider: Optional[str] = None
    model: Optional[str] = None


# --------------------------------------------------------------------------- #
# Living release notes                                                         #
# --------------------------------------------------------------------------- #
