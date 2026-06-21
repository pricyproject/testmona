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

from .docs import *

class ReleaseNoteUser(BaseModel):
    id: int
    username: str
    full_name: Optional[str] = None

    class Config:
        from_attributes = True


class ReleaseNotesGenerateRequest(BaseModel):
    """Generate a release-notes *preview* (not persisted) for a project."""
    project_id: int = Field(ge=1)
    # The window the notes cover. When ``since`` is omitted it defaults to the
    # publish date of the project's last release note (or 30 days back).
    since: Optional[datetime] = None
    until: Optional[datetime] = None
    include_ai: bool = True
    # UI language; drives the calendar of human-facing dates in the draft
    # (Jalali/Persian digits for "fa", Gregorian otherwise).
    lang: str = "en"


class ReleaseNotesChangedDoc(BaseModel):
    doc_id: int
    title: str
    actions: List[str] = Field(default_factory=list)  # created | updated | published | restored
    versions: int = 0
    headings_added: List[str] = Field(default_factory=list)
    last_changed_at: Optional[datetime] = None


class ReleaseNotesEntry(BaseModel):
    """A requirement / defect / test row included in the notes."""
    type: str                       # requirement | defect
    id: int
    key: str
    title: str
    status: Optional[str] = None
    severity: Optional[str] = None
    via_docs: List[str] = Field(default_factory=list)  # titles of docs it traces to


class ReleaseNotesCoverage(BaseModel):
    requirements_total: int = 0
    requirements_covered: int = 0
    requirements_uncovered: int = 0
    test_cases: int = 0
    coverage_pct: float = 0.0


class ReleaseNotesSource(BaseModel):
    """The deterministic data the notes are generated from."""
    range_start: Optional[datetime] = None
    range_end: Optional[datetime] = None
    changed_docs: List[ReleaseNotesChangedDoc] = Field(default_factory=list)
    requirements: List[ReleaseNotesEntry] = Field(default_factory=list)
    resolved_defects: List[ReleaseNotesEntry] = Field(default_factory=list)
    open_defects: List[ReleaseNotesEntry] = Field(default_factory=list)
    coverage: ReleaseNotesCoverage = Field(default_factory=ReleaseNotesCoverage)


class ReleaseNotesPreview(BaseModel):
    project_id: int
    title: str
    content_markdown: str
    summary: Optional[str] = None
    source: ReleaseNotesSource
    # AI summary status (best-effort; mirrors the impact-analysis contract).
    ai_available: bool = False
    ai_skipped_reason: Optional[str] = None
    provider: Optional[str] = None
    model: Optional[str] = None


def _clean_release_title(v: str) -> str:
    cleaned = str(v or "").strip()
    if not cleaned:
        raise ValueError("title cannot be empty")
    return cleaned[:255]


def _clean_release_version(v: Optional[str]) -> Optional[str]:
    if v is None:
        return None
    cleaned = str(v).strip()
    return cleaned[:50] or None


class ReleaseNoteCreate(BaseModel):
    project_id: int = Field(ge=1)
    title: str = Field(max_length=255)
    version: Optional[str] = Field(default=None, max_length=50)
    content_markdown: str = Field(default="", max_length=400_000)
    summary: Optional[str] = Field(default=None, max_length=4000)
    range_start: Optional[datetime] = None
    range_end: Optional[datetime] = None
    source_data: Optional[dict] = None

    @field_validator("title")
    @classmethod
    def _v_title(cls, v: str) -> str:
        return _clean_release_title(v)

    @field_validator("version")
    @classmethod
    def _v_version(cls, v: Optional[str]) -> Optional[str]:
        return _clean_release_version(v)


class ReleaseNoteUpdate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=255)
    version: Optional[str] = Field(default=None, max_length=50)
    content_markdown: Optional[str] = Field(default=None, max_length=400_000)
    summary: Optional[str] = Field(default=None, max_length=4000)

    @field_validator("title")
    @classmethod
    def _v_title(cls, v: Optional[str]) -> Optional[str]:
        return None if v is None else _clean_release_title(v)

    @field_validator("version")
    @classmethod
    def _v_version(cls, v: Optional[str]) -> Optional[str]:
        return _clean_release_version(v)


class ReleaseNote(BaseModel):
    id: int
    uuid: Optional[str] = None
    project_id: int
    title: str
    version: Optional[str] = None
    status: str
    content_markdown: str = ""
    summary: Optional[str] = None
    range_start: Optional[datetime] = None
    range_end: Optional[datetime] = None
    source_data: Optional[dict] = None
    published_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    creator: Optional[ReleaseNoteUser] = None
    editor: Optional[ReleaseNoteUser] = None
    publisher: Optional[ReleaseNoteUser] = None

    class Config:
        from_attributes = True

    @field_validator("status", mode="before")
    @classmethod
    def _status_value(cls, v):
        return getattr(v, "value", v)


class ReleaseNoteListItem(BaseModel):
    id: int
    project_id: int
    title: str
    version: Optional[str] = None
    status: str
    summary: Optional[str] = None
    range_start: Optional[datetime] = None
    range_end: Optional[datetime] = None
    published_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True

    @field_validator("status", mode="before")
    @classmethod
    def _status_value(cls, v):
        return getattr(v, "value", v)
