from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Enum, Boolean, Float, JSON, Table, UniqueConstraint, Index
from sqlalchemy.orm import relationship, backref, validates
from sqlalchemy.sql import func
from typing import Optional
from ..database import Base
import enum
import uuid

# Import versioning models
from ..models_versioning import (
    TestCaseVersion, VersionComparison, VersionTag, VersionLock, VersionWorkflow,
    VersionStatus, VersionAction
)


class Priority(enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class Status(enum.Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    ARCHIVED = "archived"


class TestStatus(enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    PASSED = "passed"
    FAILED = "failed"
    SKIPPED = "skipped"
    BLOCKED = "blocked"
    COMPLETED = "completed"


class ResultStatus(enum.Enum):
    PASS = "pass"
    FAIL = "fail"
    SKIP = "skip"
    BLOCK = "block"
    NOT_STARTED = "not_started"


# Test-result status has accumulated several spellings over time: the enum's
# short tokens (pass/fail/skip/block), the execution UI's full words
# (passed/failed/blocked/skipped), and the "not executed yet" state. This maps
# every spelling to one canonical token so storage, search, and analytics never
# treat the same outcome as two different things. The canonical "not executed
# yet" token is not_started (shown as "Not Started"); the legacy not_tested and
# pending spellings are accepted as input aliases but never stored.
_RESULT_STATUS_SYNONYMS = {
    "pass": "pass", "passed": "pass",
    "fail": "fail", "failed": "fail",
    "skip": "skip", "skipped": "skip",
    "block": "block", "blocked": "block",
    "not_started": "not_started", "notstarted": "not_started", "not started": "not_started",
    # Legacy input aliases for the not-started state (old data, shared links,
    # external writers). Normalized to not_started; never stored as-is.
    "not_tested": "not_started", "nottested": "not_started", "untested": "not_started",
    "pending": "not_started",
}


def canonical_result_status(value) -> str:
    """Normalize any test-result status spelling to its canonical token.

    Accepts a ``ResultStatus`` member, its value, or a free string. Unknown
    values pass through lowercased/trimmed (the column is free-form, so we never
    drop a value we don't recognize — we just stop it from being a duplicate of a
    value we do)."""
    token = getattr(value, "value", value)
    token = str(token or "").strip().lower()
    return _RESULT_STATUS_SYNONYMS.get(token, token)


class Role(enum.Enum):
    ADMIN = "admin"
    MANAGER = "manager"
    TESTER = "tester"
    VIEWER = "viewer"


class Permission(enum.Enum):
    READ = "read"
    WRITE = "write"
    DELETE = "delete"
    EXECUTE = "execute"
    MANAGE_USERS = "manage_users"
    MANAGE_PROJECTS = "manage_projects"


class CustomFieldType(enum.Enum):
    TEXT = "text"
    NUMBER = "number"
    DATE = "date"
    BOOLEAN = "boolean"
    SELECT = "select"
    MULTISELECT = "multiselect"


class TestType(enum.Enum):
    MANUAL = "manual"
    AUTOMATED = "automated"
    SMOKE = "smoke"
    REGRESSION = "regression"
    INTEGRATION = "integration"
    SECURITY = "security"
    PERFORMANCE = "performance"
    USABILITY = "usability"


class StepCategory(enum.Enum):
    AUTHENTICATION = "authentication"
    DATABASE = "database"
    API = "api"
    UI = "ui"
    SETUP = "setup"
    CLEANUP = "cleanup"
    VALIDATION = "validation"
    REPORTING = "reporting"


class StepComplexity(enum.Enum):
    SIMPLE = "simple"
    MEDIUM = "medium"
    COMPLEX = "complex"


class RecycleBinType(enum.Enum):
    TEST_CASE = "test_case"
    TEST_SUITE = "test_suite"
    PROJECT = "project"


class RequirementStatus(enum.Enum):
    DRAFT = "draft"
    REVIEWED = "reviewed"
    APPROVED = "approved"
    IMPLEMENTED = "implemented"
    VERIFIED = "verified"
    DEPRECATED = "deprecated"


class DefectStatus(enum.Enum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    FIXED = "fixed"
    REOPENED = "reopened"
    CLOSED = "closed"
    REJECTED = "rejected"


class DefectSeverity(enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class DefectPriority(enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    URGENT = "urgent"


class DefectLinkType(enum.Enum):
    FOUND = "found"          # The execution surfaced this defect (typically a failed test)
    BLOCKED_BY = "blocked_by"  # The execution is blocked by this defect (typically a blocked test)
    RELATED = "related"      # The defect is related but neither caused nor blocked the execution


class AuditAction(enum.Enum):
    CREATE = "create"
    UPDATE = "update"
    DELETE = "delete"
    LOGIN = "login"
    LOGOUT = "logout"
    EXECUTE = "execute"
    ASSIGN = "assign"
    UNASSIGN = "unassign"
    APPROVE = "approve"
    REJECT = "reject"
    ARCHIVE = "archive"
    RESTORE = "restore"
    EXPORT = "export"
    IMPORT = "import"
    SYNC = "sync"


class EntityType(enum.Enum):
    USER = "user"
    PROJECT = "project"
    TEST_CASE = "test_case"
    TEST_SUITE = "test_suite"
    TEST_RUN = "test_run"
    TEST_RESULT = "test_result"
    TEST_PLAN = "test_plan"
    REQUIREMENT = "requirement"
    DEFECT = "defect"
    MILESTONE = "milestone"
    CUSTOM_FIELD = "custom_field"
    JIRA_INTEGRATION = "jira_integration"
    NOTIFICATION = "notification"
    TEST_CASE_SECTION = "test_case_section"
    TEST_SCHEDULE = "test_schedule"
    TEST_EXECUTION = "test_execution"
    INVITATION = "invitation"
    SHARED_STEP = "shared_step"
    SHARED_STEP_TEMPLATE = "shared_step_template"
    SYSTEM_SETTING = "system_setting"
    GLOBAL_PARAMETER = "global_parameter"
    TEST_EXECUTION_SETTINGS = "test_execution_settings"
    AUTOMATION_SETTINGS = "automation_settings"
    KPI_DATA = "kpi_data"
    TEST_STEP_RESULT = "test_step_result"
    SHAREABLE_REPORT = "shareable_report"
    ROOT_CAUSE_ANALYSIS = "root_cause_analysis"
    DASHBOARD_WIDGET = "dashboard_widget"
    TRACEABILITY_ENTRY = "traceability_entry"
    COVERAGE_REPORT = "coverage_report"
    JIRA_ISSUE = "jira_issue"
    EXECUTION_ENVIRONMENT = "execution_environment"


class MilestoneStatus(enum.Enum):
    PLANNED = "planned"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class CustomFieldDefinition(Base):
    __tablename__ = "custom_field_definitions"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False, index=True)
    slug = Column(String(255), nullable=True, index=True)
    field_type = Column(Enum(CustomFieldType), nullable=False)
    description = Column(Text)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    project_seq = Column(Integer, nullable=True, index=True)  # per-project sequence for URLs/badges
    is_required = Column(Boolean, default=False)
    __table_args__ = (
        Index("uq_custom_field_definitions_project_seq", "project_id", "project_seq", unique=True),
    )
    default_value = Column(Text)
    options = Column(JSON)  # For select/multiselect fields
    validation_rules = Column(JSON)  # Validation rules like min_length, max_length, etc.
    # Which entity types this definition applies to. Stored as a JSON list of
    # short keys (``test_case``, ``test_run``, ``defect``, ``requirement``).
    # Empty/None means legacy behavior: applies to test cases only.
    entity_types = Column(JSON)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    project = relationship("Project")
    values = relationship("CustomFieldValue", back_populates="field_definition")


# Allowed entity types for the unified custom-field engine. Kept here as a
# module constant so backend validation and the frontend admin form agree.
CUSTOM_FIELD_ENTITY_TYPES = ("test_case", "test_run", "defect", "requirement")


class CustomFieldValue(Base):
    __tablename__ = "custom_field_values"

    id = Column(Integer, primary_key=True, index=True)
    field_definition_id = Column(Integer, ForeignKey("custom_field_definitions.id"), nullable=False)
    # Polymorphic ownership: exactly one of the following FKs is set. Real
    # FKs (rather than (entity_type, entity_id) strings) so that deleting a
    # test case / run / defect / requirement cascades to its custom values.
    test_case_id = Column(Integer, ForeignKey("test_cases.id"), nullable=True)
    test_run_id = Column(Integer, ForeignKey("test_runs.id"), nullable=True)
    defect_id = Column(Integer, ForeignKey("defects.id"), nullable=True)
    requirement_id = Column(Integer, ForeignKey("requirements.id"), nullable=True)
    value = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    field_definition = relationship("CustomFieldDefinition", back_populates="values")
    test_case = relationship("TestCase", foreign_keys=[test_case_id])
    test_run = relationship("TestRun", foreign_keys=[test_run_id])
    defect = relationship("Defect", foreign_keys=[defect_id])
    requirement = relationship("Requirement", foreign_keys=[requirement_id])

    # Index the polymorphic owner FKs (names match the unify_custom_fields_engine migration).
    __table_args__ = (
        Index("ix_cfv_test_run_id", "test_run_id"),
        Index("ix_cfv_defect_id", "defect_id"),
        Index("ix_cfv_requirement_id", "requirement_id"),
    )

    @property
    def entity_type(self) -> Optional[str]:
        if self.test_case_id is not None:
            return "test_case"
        if self.test_run_id is not None:
            return "test_run"
        if self.defect_id is not None:
            return "defect"
        if self.requirement_id is not None:
            return "requirement"
        return None

    @property
    def entity_id(self) -> Optional[int]:
        return (
            self.test_case_id
            or self.test_run_id
            or self.defect_id
            or self.requirement_id
        )


# Association table for requirement-test case links
requirement_test_case_links = Table('requirement_test_case_links', Base.metadata,
    Column('requirement_id', Integer, ForeignKey('requirements.id'), nullable=False),
    Column('test_case_id', Integer, ForeignKey('test_cases.id'), nullable=False),
    UniqueConstraint('requirement_id', 'test_case_id', name='uq_requirement_test_case_links_requirement_test_case')
)


# Association table for requirement-test plan scope links
requirement_test_plan_links = Table('requirement_test_plan_links', Base.metadata,
    Column('requirement_id', Integer, ForeignKey('requirements.id'), nullable=False),
    Column('test_plan_id', Integer, ForeignKey('test_plans.id'), nullable=False),
    UniqueConstraint('requirement_id', 'test_plan_id', name='uq_requirement_test_plan_links_requirement_test_plan')
)


# Association table for shared step usage in test cases
shared_step_usage = Table('shared_step_usage', Base.metadata,
    Column('shared_step_id', Integer, ForeignKey('shared_steps.id')),
    Column('test_case_id', Integer, ForeignKey('test_cases.id')),
    Column('step_order', Integer, default=0)  # Order of the shared step in the test case
)
