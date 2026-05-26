from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Enum, Boolean, Float, JSON, Table, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from typing import Optional
from .database import Base
import enum

# Import versioning models
from .models_versioning import (
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
    NOT_TESTED = "not_tested"


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
    is_required = Column(Boolean, default=False)
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


class SharedStep(Base):
    __tablename__ = "shared_steps"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False, index=True)
    description = Column(Text)
    action = Column(Text, nullable=False)  # The action to perform
    expected_result = Column(Text, nullable=False)  # Expected result
    project_id = Column(Integer, ForeignKey('projects.id'), nullable=False)
    created_by = Column(Integer, ForeignKey('users.id'), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    is_active = Column(Boolean, default=True)
    usage_count = Column(Integer, default=0)  # Track how many times this step is used

    # Relationships
    project = relationship("Project")
    creator = relationship("User", foreign_keys=[created_by])
    test_cases = relationship("TestCase", secondary=shared_step_usage, back_populates="shared_steps")


class GlobalParameter(Base):
    __tablename__ = "global_parameters"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False, unique=True, index=True)
    value = Column(Text, nullable=False)
    description = Column(Text)
    parameter_type = Column(String(50), default="string")  # string, number, boolean, json
    project_id = Column(Integer, ForeignKey('projects.id'), nullable=True)  # null for global, project_id for project-specific
    created_by = Column(Integer, ForeignKey('users.id'), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    is_active = Column(Boolean, default=True)
    is_encrypted = Column(Boolean, default=False)  # For sensitive data like passwords

    # Relationships
    project = relationship("Project")
    creator = relationship("User", foreign_keys=[created_by])


class TestTypeDefinition(Base):
    __tablename__ = "test_type_definitions"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False, unique=True, index=True)
    description = Column(Text)
    color = Column(String(7), nullable=False, default="#3B82F6")  # Hex color code
    icon = Column(String(10), nullable=False, default="🖱️")  # Emoji icon
    is_active = Column(Boolean, default=True)
    usage_count = Column(Integer, default=0)
    created_by = Column(Integer, ForeignKey('users.id'), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    creator = relationship("User", foreign_keys=[created_by])


class PriorityDefinition(Base):
    __tablename__ = "priority_definitions"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), nullable=False, unique=True, index=True)
    value = Column(Integer, nullable=False)  # Priority value (1-10)
    color = Column(String(7), nullable=False, default="#F59E0B")  # Hex color code
    description = Column(Text)
    is_default = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    created_by = Column(Integer, ForeignKey('users.id'), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    creator = relationship("User", foreign_keys=[created_by])


class SharedStepTemplate(Base):
    __tablename__ = "shared_step_templates"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False, index=True)
    description = Column(Text)
    category = Column(Enum(StepCategory, values_callable=lambda enum_class: [item.value for item in enum_class]), nullable=False)
    tags = Column(JSON)  # Array of tags as JSON
    complexity = Column(Enum(StepComplexity, values_callable=lambda enum_class: [item.value for item in enum_class]), nullable=False)
    estimated_time = Column(Integer, nullable=False, default=1)  # in minutes
    prerequisites = Column(JSON)  # Array of prerequisites as JSON
    related_steps = Column(JSON)  # Array of related step IDs as JSON
    usage_count = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_by = Column(Integer, ForeignKey('users.id'), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    creator = relationship("User", foreign_keys=[created_by])


class TestExecutionSettings(Base):
    __tablename__ = "test_execution_settings"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey('projects.id'), nullable=True)  # null for global settings
    auto_save_interval = Column(Integer, default=30)  # in seconds
    screenshot_on_failure = Column(Boolean, default=True)
    video_recording = Column(Boolean, default=False)
    step_timeout = Column(Integer, default=300)  # in seconds
    retry_attempts = Column(Integer, default=2)
    parallel_execution = Column(Boolean, default=True)
    max_parallel_threads = Column(Integer, default=4)
    cleanup_on_failure = Column(Boolean, default=True)
    require_defect_on_failure = Column(Boolean, default=False)  # Require a defect link to save failed/blocked results
    created_by = Column(Integer, ForeignKey('users.id'), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    project = relationship("Project")
    creator = relationship("User", foreign_keys=[created_by])


class NotificationSettings(Base):
    __tablename__ = "notification_settings"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey('projects.id'), nullable=True)  # null for global settings
    email_notifications = Column(Boolean, default=True)
    slack_notifications = Column(Boolean, default=False)
    test_failure_alerts = Column(Boolean, default=True)
    test_completion_reports = Column(Boolean, default=True)
    weekly_summary = Column(Boolean, default=True)
    real_time_updates = Column(Boolean, default=False)
    created_by = Column(Integer, ForeignKey('users.id'), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    project = relationship("Project")
    creator = relationship("User", foreign_keys=[created_by])


class AutomationSettings(Base):
    __tablename__ = "automation_settings"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey('projects.id'), nullable=True)  # null for global settings
    ai_suggestions = Column(Boolean, default=False)
    smart_step_recommendations = Column(Boolean, default=True)
    auto_categorization = Column(Boolean, default=False)
    duplicate_detection = Column(Boolean, default=True)
    performance_optimization = Column(Boolean, default=True)
    created_by = Column(Integer, ForeignKey('users.id'), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    project = relationship("Project")
    creator = relationship("User", foreign_keys=[created_by])


class SystemSettings(Base):
    __tablename__ = "system_settings"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(100), unique=True, nullable=False, index=True)
    value = Column(Text, nullable=True)
    description = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class OnboardingChecklist(Base):
    __tablename__ = "onboarding_checklist"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    task_key = Column(String(100), nullable=False, index=True)  # e.g., "change_password", "create_project"
    task_name = Column(String(255), nullable=False)
    description = Column(Text)
    is_completed = Column(Boolean, default=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    user = relationship("User", foreign_keys=[user_id])


class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False, unique=True, index=True)
    description = Column(Text)
    owner_id = Column(Integer, ForeignKey("users.id"))
    status = Column(Enum(Status), default=Status.ACTIVE)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    test_suites = relationship("TestSuite", back_populates="project")
    test_runs = relationship("TestRun", back_populates="project")
    test_plans = relationship("TestPlan", back_populates="project", cascade="save-update, merge, refresh-expire")
    milestones = relationship("Milestone", back_populates="project")
    requirements = relationship("Requirement", back_populates="project")
    defects = relationship("Defect", back_populates="project")
    coverage_reports = relationship("CoverageReport", back_populates="project")
    user_assignments = relationship("ProjectAssignment", back_populates="project")
    owner = relationship("User", back_populates="created_projects")
    custom_field_definitions = relationship("CustomFieldDefinition", back_populates="project")
    jira_integrations = relationship("JiraIntegration", back_populates="project")


class TestSuite(Base):
    __tablename__ = "test_suites"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False, index=True)
    description = Column(Text)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    status = Column(Enum(Status), default=Status.ACTIVE)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    project = relationship("Project", back_populates="test_suites")
    test_cases = relationship("TestCase", back_populates="test_suite")
    sections = relationship("TestCaseSection", back_populates="test_suite")


class TestCaseSection(Base):
    __tablename__ = "test_case_sections"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text)
    test_suite_id = Column(Integer, ForeignKey("test_suites.id"), nullable=False)
    parent_section_id = Column(Integer, ForeignKey("test_case_sections.id"))
    order_index = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    test_suite = relationship("TestSuite", back_populates="sections")
    parent_section = relationship("TestCaseSection", remote_side=[id])
    child_sections = relationship("TestCaseSection", back_populates="parent_section")
    test_cases = relationship("TestCase", back_populates="section")


class TestCase(Base):
    __tablename__ = "test_cases"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False, index=True)
    description = Column(Text)
    test_type = Column(String(20), default='manual')
    preconditions = Column(Text)
    steps = Column(Text)  # Legacy simple text field - kept for backward compatibility
    expected_result = Column(Text)  # Legacy simple text field - kept for backward compatibility
    priority = Column(String(10), default='medium')
    status = Column(String(20), default='active')
    reference = Column(String(255), nullable=True)  # Reference field for requirements, JIRA tickets, etc.
    test_suite_id = Column(Integer, ForeignKey("test_suites.id"), nullable=False)
    section_id = Column(Integer, ForeignKey("test_case_sections.id"))
    tags = Column(String(500))
    order_index = Column(Integer, default=0)
    is_deleted = Column(Boolean, default=False)
    is_multistep = Column(Boolean, default=False)  # Flag to indicate multistep format
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    test_suite = relationship("TestSuite", back_populates="test_cases")
    section = relationship("TestCaseSection", back_populates="test_cases")
    test_results = relationship("TestResult", back_populates="test_case")
    custom_field_values = relationship("CustomFieldValue", back_populates="test_case")
    revisions = relationship("TestCaseRevision", back_populates="test_case")
    shared_steps = relationship("SharedStep", secondary=shared_step_usage, back_populates="test_cases")
    test_steps = relationship("TestCaseStep", back_populates="test_case", cascade="all, delete-orphan")
    creator = relationship("User", foreign_keys=[created_by])

    @property
    def project(self):
        """Get the project through the test suite relationship"""
        return self.test_suite.project if self.test_suite else None

    @property
    def project_id(self):
        """Get the project ID through the test suite relationship"""
        return self.test_suite.project_id if self.test_suite else None


class TestCaseStep(Base):
    __tablename__ = "test_case_steps"

    id = Column(Integer, primary_key=True, index=True)
    test_case_id = Column(Integer, ForeignKey("test_cases.id"), nullable=False)
    step_number = Column(Integer, nullable=False)
    action = Column(Text, nullable=False)  # The action to perform
    expected_result = Column(Text, nullable=False)  # Expected result for this step
    step_type = Column(String(20), default='manual')  # manual, automated, verification
    data = Column(JSON)  # Additional step data (test data, parameters, etc.)
    order_index = Column(Integer, default=0)  # For ordering steps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    test_case = relationship("TestCase", back_populates="test_steps")

    # Unique constraint on test_case_id and step_number
    __table_args__ = (
        {'sqlite_autoincrement': True}
    )


class TestCaseRevision(Base):
    __tablename__ = "test_case_revisions"

    id = Column(Integer, primary_key=True, index=True)
    test_case_id = Column(Integer, ForeignKey("test_cases.id"), nullable=False)
    revision_number = Column(Integer, nullable=False)
    title = Column(String(255), nullable=False)
    description = Column(Text)
    test_type = Column(Enum(TestType))
    preconditions = Column(Text)
    steps = Column(Text)
    expected_result = Column(Text)
    priority = Column(Enum(Priority))
    tags = Column(String(500))
    changed_fields = Column(JSON)  # Store which fields were changed
    change_reason = Column(Text)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    test_case = relationship("TestCase", back_populates="revisions")
    creator = relationship("User")


class RecycleBin(Base):
    __tablename__ = "recycle_bin"

    id = Column(Integer, primary_key=True, index=True)
    item_type = Column(Enum(RecycleBinType), nullable=False)
    item_id = Column(Integer, nullable=False)
    item_data = Column(JSON, nullable=False)  # Store the full item data as JSON
    deleted_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    deleted_at = Column(DateTime(timezone=True), server_default=func.now())
    restore_until = Column(DateTime(timezone=True))  # Optional expiration date

    # Relationships
    deleter = relationship("User")


class TestRun(Base):
    __tablename__ = "test_runs"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False, index=True)
    description = Column(Text)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    test_plan_id = Column(Integer, ForeignKey("test_plans.id"))
    schedule_id = Column(Integer, ForeignKey("test_schedules.id"))
    environment_id = Column(Integer, ForeignKey("execution_environments.id"))
    execution_engine_id = Column(Integer, ForeignKey("execution_engines.id"))
    assigned_to = Column(Integer, ForeignKey("users.id"))
    milestone_id = Column(Integer, ForeignKey("milestones.id"))
    priority = Column(String(20), default="medium")  # low, medium, high, critical
    estimated_duration = Column(Integer)  # in minutes
    # environment = Column(String(100))  # environment name (development, staging, production, etc.) - Temporarily disabled
    status = Column(String(20), default="pending")
    execution_mode = Column(String(50), default="sequential")  # sequential, parallel, distributed
    started_at = Column(DateTime(timezone=True))
    completed_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    project = relationship("Project", back_populates="test_runs")
    test_plan = relationship("TestPlan", back_populates="test_runs")
    test_results = relationship("TestResult", back_populates="test_run")
    schedule = relationship("TestSchedule", back_populates="test_runs")
    environment = relationship("ExecutionEnvironment", back_populates="test_runs")
    execution_engine = relationship("ExecutionEngine")
    assignee = relationship("User", foreign_keys=[assigned_to])


class TestResult(Base):
    __tablename__ = "test_results"

    id = Column(Integer, primary_key=True, index=True)
    test_case_id = Column(Integer, ForeignKey("test_cases.id"), nullable=False)
    test_run_id = Column(Integer, ForeignKey("test_runs.id"), nullable=False)
    executed_by = Column(Integer, ForeignKey("users.id"))
    status = Column(String(20), nullable=False)
    actual_result = Column(Text)
    comments = Column(Text)
    execution_time = Column(Float)
    execution_started_at = Column(DateTime(timezone=True))
    executed_at = Column(DateTime(timezone=True), server_default=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # New fields for pause/resume functionality
    execution_state = Column(String(20), default="idle")  # idle, running, paused, completed
    paused_at = Column(DateTime(timezone=True), nullable=True)
    total_paused_time = Column(Float, default=0.0)  # Total time spent in paused state
    manual_time_adjustment = Column(Float, default=0.0)  # Manual time adjustments added by user

    # Failure context for failed/blocked executions
    defect_link = Column(String(500))  # URL to a defect in an external tracker
    custom_link = Column(String(500))  # Free-form reference URL (logs, build, etc.)
    retest_needed = Column(Boolean, default=False)  # Set when a linked defect is resolved/reopened

    # Relationships
    test_case = relationship("TestCase", back_populates="test_results")
    test_run = relationship("TestRun", back_populates="test_results")
    executor = relationship("User", back_populates="test_results")
    defect_links = relationship(
        "TestResultDefectLink",
        back_populates="test_result",
        cascade="all, delete-orphan",
    )


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    email = Column(String(100), unique=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(100))
    role = Column(String(7), default="tester")
    is_active = Column(Boolean, default=True)
    is_superuser = Column(Boolean, default=False)
    force_password_change = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Notification preferences
    notifications_muted_until = Column(DateTime(timezone=True), nullable=True)
    do_not_disturb = Column(Boolean, default=False)
    notification_sound_enabled = Column(Boolean, default=True)

    # Relationships
    project_assignments = relationship("ProjectAssignment", back_populates="user", foreign_keys="ProjectAssignment.user_id")
    created_projects = relationship("Project", back_populates="owner")
    test_results = relationship("TestResult", back_populates="executor")
    notifications = relationship("Notification", back_populates="user")
    refresh_tokens = relationship("RefreshToken", back_populates="user", foreign_keys="RefreshToken.user_id")


class ProjectAssignment(Base):
    __tablename__ = "project_assignments"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    role = Column(Enum(Role), default=Role.TESTER)
    assigned_at = Column(DateTime(timezone=True), server_default=func.now())
    assigned_by = Column(Integer, ForeignKey("users.id"))

    # Relationships
    user = relationship("User", back_populates="project_assignments", foreign_keys=[user_id])
    project = relationship("Project", back_populates="user_assignments")
    assigner = relationship("User", foreign_keys=[assigned_by])


class UserInvitation(Base):
    __tablename__ = "user_invitations"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(100), nullable=False, index=True)
    token = Column(String(255), unique=True, nullable=False, index=True)
    role = Column(String(20), default="tester")
    project_ids = Column(String(500))  # Comma-separated project IDs
    invited_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    accepted_at = Column(DateTime(timezone=True))
    is_used = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id = Column(Integer, primary_key=True, index=True)
    token = Column(String(255), nullable=False)  # The actual refresh token
    token_hash = Column(String(255), unique=True, nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    is_revoked = Column(Boolean, default=False)
    revoked_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_used_at = Column(DateTime(timezone=True))
    device_info = Column(String(255))  # Optional device/browser fingerprint
    updated_by = Column(Integer, ForeignKey("users.id"))
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    user = relationship("User", back_populates="refresh_tokens", foreign_keys=[user_id])


class TestExecution(Base):
    __tablename__ = "test_executions"

    id = Column(Integer, primary_key=True, index=True)
    test_case_id = Column(Integer, ForeignKey("test_cases.id"), nullable=False)
    test_run_id = Column(Integer, ForeignKey("test_runs.id"), nullable=False)
    executor_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True))
    status = Column(Enum(TestStatus), default=TestStatus.PENDING)
    step_results = Column(Text)  # JSON string for step-by-step results
    screenshots = Column(Text)   # JSON array of screenshot paths
    logs = Column(Text)          # Execution logs
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    test_case = relationship("TestCase")
    test_run = relationship("TestRun")
    executor = relationship("User", foreign_keys=[executor_id])


class JiraIntegration(Base):
    __tablename__ = "jira_integrations"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    jira_url = Column(String(500), nullable=False)
    username = Column(String(255), nullable=False)
    _api_token = Column("api_token", String(500), nullable=False)  # Encrypted in database
    project_key = Column(String(10), nullable=False)  # e.g., "PROJ"
    is_active = Column(Boolean, default=True)
    sync_test_cases = Column(Boolean, default=True)
    sync_test_results = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    project = relationship("Project")
    jira_issues = relationship("JiraIssue", back_populates="integration")
    
    @property
    def api_token(self):
        """Decrypt api_token when accessed"""
        from .crypto import decrypt_data
        if self._api_token:
            try:
                return decrypt_data(self._api_token)
            except Exception:
                # If decryption fails, return as-is (for backward compatibility)
                return self._api_token
        return self._api_token
    
    @api_token.setter
    def api_token(self, value):
        """Encrypt api_token when set"""
        from .crypto import encrypt_data
        if value:
            self._api_token = encrypt_data(value)
        else:
            self._api_token = value


class JiraIssue(Base):
    __tablename__ = "jira_issues"

    id = Column(Integer, primary_key=True, index=True)
    integration_id = Column(Integer, ForeignKey("jira_integrations.id"), nullable=False)
    test_case_id = Column(Integer, ForeignKey("test_cases.id"), nullable=True)
    test_result_id = Column(Integer, ForeignKey("test_results.id"), nullable=True)
    jira_issue_key = Column(String(50), nullable=False)  # e.g., "PROJ-123"
    jira_issue_id = Column(String(50), nullable=False)  # Jira's internal ID
    issue_type = Column(String(50), nullable=False)  # Bug, Task, Story, etc.
    status = Column(String(100), nullable=False)
    summary = Column(String(500))
    description = Column(Text)
    assignee = Column(String(255))
    reporter = Column(String(255))
    priority = Column(String(50))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    integration = relationship("JiraIntegration", back_populates="jira_issues")
    test_case = relationship("TestCase")
    test_result = relationship("TestResult")


class Requirement(Base):
    __tablename__ = "requirements"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text)
    # Human-facing ID (REQ-001, etc.) — unique per project, not globally.
    requirement_id = Column(String(50), nullable=False)
    status = Column(Enum(RequirementStatus), default=RequirementStatus.DRAFT)
    priority = Column(Enum(Priority), default=Priority.MEDIUM)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    parent_requirement_id = Column(Integer, ForeignKey("requirements.id"))
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    assigned_to = Column(Integer, ForeignKey("users.id"))
    tags = Column(String(500))
    acceptance_criteria = Column(Text)
    estimated_effort = Column(Float)  # in hours
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint('project_id', 'requirement_id', name='uq_requirements_project_requirement_id'),
    )

    # Relationships
    project = relationship("Project")
    creator = relationship("User", foreign_keys=[created_by])
    assignee = relationship("User", foreign_keys=[assigned_to])
    parent_requirement = relationship("Requirement", remote_side=[id])
    child_requirements = relationship("Requirement", back_populates="parent_requirement")
    test_cases = relationship("TestCase", secondary="requirement_test_case_links")
    test_plans = relationship("TestPlan", secondary="requirement_test_plan_links", back_populates="requirements")


class Defect(Base):
    __tablename__ = "defects"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text)
    defect_id = Column(String(50), unique=True, nullable=False)  # DEF-001, etc.
    status = Column(Enum(DefectStatus), default=DefectStatus.OPEN)
    severity = Column(Enum(DefectSeverity), default=DefectSeverity.MEDIUM)
    priority = Column(Enum(DefectPriority), default=DefectPriority.MEDIUM)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    test_case_id = Column(Integer, ForeignKey("test_cases.id"))
    test_run_id = Column(Integer, ForeignKey("test_runs.id"))
    requirement_id = Column(Integer, ForeignKey("requirements.id"))
    reported_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    assigned_to = Column(Integer, ForeignKey("users.id"))
    tags = Column(String(500))
    steps_to_reproduce = Column(Text)
    expected_result = Column(Text)
    actual_result = Column(Text)
    environment = Column(String(255))
    browser_info = Column(String(255))
    attachments = Column(Text)  # JSON array of file paths
    estimated_fix_time = Column(Float)  # in hours
    actual_fix_time = Column(Float)  # in hours
    external_issue_id = Column(String(100))  # For Jira integration
    external_issue_url = Column(String(500))  # Link to external issue
    external_sync_status = Column(String(50), default="not_synced")  # not_synced, synced, error
    external_last_sync = Column(DateTime(timezone=True))
    resolution = Column(Text)  # Resolution details
    root_cause = Column(Text)  # Root cause analysis
    fix_version = Column(String(50))  # Version where fix is applied
    found_in_version = Column(String(50))  # Version where defect was found
    duplicate_of = Column(Integer, ForeignKey("defects.id"))  # Link to duplicate defect
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    project = relationship("Project")
    test_case = relationship("TestCase")
    test_run = relationship("TestRun")
    requirement = relationship("Requirement")
    reporter = relationship("User", foreign_keys=[reported_by])
    assignee = relationship("User", foreign_keys=[assigned_to])
    duplicate = relationship("Defect", remote_side=[id])
    comments = relationship("DefectComment", back_populates="defect", cascade="all, delete-orphan")
    attachments_files = relationship("DefectAttachment", back_populates="defect", cascade="all, delete-orphan")
    history = relationship("DefectHistory", back_populates="defect", cascade="all, delete-orphan")
    test_result_links = relationship(
        "TestResultDefectLink",
        back_populates="defect",
        cascade="all, delete-orphan",
    )


class TestResultDefectLink(Base):
    """Structured link between a single test execution result and a defect.

    Unlike the loose ``Defect.test_case_id``/``test_run_id`` columns, this ties a
    defect to the *specific* execution result and records whether the test
    found the defect or was blocked by it.
    """
    __tablename__ = "test_result_defect_links"
    __table_args__ = (
        UniqueConstraint(
            "test_result_id", "defect_id",
            name="uq_test_result_defect_links_result_defect",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    test_result_id = Column(Integer, ForeignKey("test_results.id"), nullable=False, index=True)
    defect_id = Column(Integer, ForeignKey("defects.id"), nullable=False, index=True)
    link_type = Column(String(20), default=DefectLinkType.FOUND.value)  # found, blocked_by, related
    result_snapshot = Column(JSON)  # Immutable execution snapshot captured when the link is created
    failing_step_snapshot = Column(JSON)  # Optional immutable failed/blocked step details
    snapshot_created_at = Column(DateTime(timezone=True), server_default=func.now())
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    test_result = relationship("TestResult", back_populates="defect_links")
    defect = relationship("Defect", back_populates="test_result_links")
    creator = relationship("User", foreign_keys=[created_by])


class TestPlan(Base):
    __tablename__ = "test_plans"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    milestone_id = Column(Integer, ForeignKey("milestones.id"))
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    status = Column(Enum(TestStatus), default=TestStatus.PENDING)
    target_start_date = Column(DateTime(timezone=True))
    target_end_date = Column(DateTime(timezone=True))
    actual_start_date = Column(DateTime(timezone=True))
    actual_end_date = Column(DateTime(timezone=True))
    test_objectives = Column(Text)
    scope_inclusions = Column(Text)
    scope_exclusions = Column(Text)
    test_environment = Column(Text)
    entry_criteria = Column(Text)
    exit_criteria = Column(Text)
    risks_assumptions = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    project = relationship("Project")
    milestone = relationship("Milestone", back_populates="test_plans")
    creator = relationship("User")
    test_runs = relationship("TestRun", back_populates="test_plan")
    requirements = relationship("Requirement", secondary="requirement_test_plan_links", back_populates="test_plans")


class Milestone(Base):
    __tablename__ = "milestones"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    status = Column(Enum(MilestoneStatus), default=MilestoneStatus.PLANNED)
    target_date = Column(DateTime(timezone=True), nullable=True)
    actual_date = Column(DateTime(timezone=True), nullable=True)
    progress_percentage = Column(Integer, default=0)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    project = relationship("Project")
    test_plans = relationship("TestPlan", back_populates="milestone")
    creator = relationship("User", foreign_keys=[created_by])


class TraceabilityMatrix(Base):
    __tablename__ = "traceability_matrix"
    __table_args__ = (
        UniqueConstraint("requirement_id", "test_case_id", name="uq_traceability_matrix_requirement_test_case"),
    )

    id = Column(Integer, primary_key=True, index=True)
    requirement_id = Column(Integer, ForeignKey("requirements.id"), nullable=False)
    test_case_id = Column(Integer, ForeignKey("test_cases.id"), nullable=False)
    coverage_type = Column(String(50), default="functional")  # functional, non-functional, etc.
    coverage_percentage = Column(Float, default=100.0)  # 0-100
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    requirement = relationship("Requirement")
    test_case = relationship("TestCase")


class CoverageReport(Base):
    __tablename__ = "coverage_reports"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    test_run_id = Column(Integer, ForeignKey("test_runs.id"))
    report_type = Column(String(50), default="summary")  # summary, detailed, etc.
    total_requirements = Column(Integer, default=0)
    covered_requirements = Column(Integer, default=0)
    coverage_percentage = Column(Float, default=0.0)
    total_test_cases = Column(Integer, default=0)
    executed_test_cases = Column(Integer, default=0)
    passed_test_cases = Column(Integer, default=0)
    failed_test_cases = Column(Integer, default=0)
    blocked_test_cases = Column(Integer, default=0)
    generated_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    generated_at = Column(DateTime(timezone=True), server_default=func.now())
    report_data = Column(JSON)  # Detailed coverage data

    # Relationships
    project = relationship("Project")
    test_run = relationship("TestRun")
    generator = relationship("User")


class NotificationType(enum.Enum):
    INFO = "info"
    SUCCESS = "success"
    WARNING = "warning"
    ERROR = "error"


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False)
    title = Column(String(200), nullable=False)
    message = Column(Text, nullable=False)
    type = Column(Enum(NotificationType), default=NotificationType.INFO)
    is_read = Column(Boolean, default=False)
    related_entity_type = Column(String(50))  # e.g., 'test_case', 'defect', 'project'
    related_entity_id = Column(Integer)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    user = relationship("User", back_populates="notifications")


# Add notifications relationship to User model
User.notifications = relationship("Notification", back_populates="user")


# Analytics and Reporting Models

class KPIData(Base):
    __tablename__ = "kpi_data"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    metric_type = Column(String(50), nullable=False)  # coverage, pass_rate, failure_trends, flakiness, cycle_time
    metric_value = Column(Float, nullable=False)
    trend_direction = Column(String(10), default="neutral")  # up, down, neutral
    trend_change = Column(Float, default=0.0)
    time_period = Column(String(20), nullable=False)  # 24h, 7d, 30d, 90d
    recorded_at = Column(DateTime(timezone=True), server_default=func.now())
    additional_data = Column(JSON)  # Additional context or breakdown data

    # Relationships
    project = relationship("Project")


class TestStepResult(Base):
    __tablename__ = "test_step_results"

    id = Column(Integer, primary_key=True, index=True)
    test_result_id = Column(Integer, ForeignKey("test_results.id"), nullable=False)
    step_number = Column(Integer, nullable=False)
    step_name = Column(String(500), nullable=False)
    step_status = Column(String(20), nullable=False)  # passed, failed, skipped, blocked
    step_duration = Column(Float, default=0.0)  # Duration in seconds
    error_message = Column(Text)
    screenshot_path = Column(String(500))
    step_data = Column(JSON)  # Additional step-specific data
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    test_result = relationship("TestResult")


class ShareableReport(Base):
    __tablename__ = "shareable_reports"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    title = Column(String(200), nullable=False)
    report_type = Column(String(50), nullable=False)  # executive, technical, summary
    report_content = Column(JSON, nullable=False)  # Full report data
    access_level = Column(String(20), default="read-only")  # read-only, edit
    share_token = Column(String(100), unique=True, nullable=False)  # Unique share token
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    shared_with = Column(JSON)  # Array of user IDs or emails
    view_count = Column(Integer, default=0)
    last_viewed = Column(DateTime(timezone=True))
    expires_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    is_active = Column(Boolean, default=True)

    # Relationships
    project = relationship("Project")
    creator = relationship("User")


class RootCauseAnalysis(Base):
    __tablename__ = "root_cause_analysis"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    requirement_id = Column(Integer, ForeignKey("requirements.id"))
    test_case_id = Column(Integer, ForeignKey("test_cases.id"))
    defect_id = Column(Integer, ForeignKey("defects.id"))
    analysis_title = Column(String(200), nullable=False)
    root_cause = Column(Text, nullable=False)
    impact_assessment = Column(Text)
    resolution_time_hours = Column(Float)
    fix_commit_hash = Column(String(100))
    discovered_by = Column(Integer, ForeignKey("users.id"))
    assigned_to = Column(Integer, ForeignKey("users.id"))
    status = Column(String(20), default="open")  # open, in_progress, resolved, closed
    severity = Column(String(20), default="medium")  # low, medium, high, critical
    analysis_data = Column(JSON)  # Additional analysis context
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    project = relationship("Project")
    requirement = relationship("Requirement")
    test_case = relationship("TestCase")
    defect = relationship("Defect")
    discoverer = relationship("User", foreign_keys=[discovered_by])
    assignee = relationship("User", foreign_keys=[assigned_to])


class DashboardWidget(Base):
    __tablename__ = "dashboard_widgets"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    project_id = Column(Integer, ForeignKey("projects.id"))
    widget_type = Column(String(50), nullable=False)  # kpi, chart, table, etc.
    widget_title = Column(String(100), nullable=False)
    widget_config = Column(JSON, nullable=False)  # Widget configuration
    position_x = Column(Integer, default=0)
    position_y = Column(Integer, default=0)
    width = Column(Integer, default=1)  # Grid width (1-4)
    height = Column(Integer, default=1)  # Grid height (1-4)
    is_visible = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    user = relationship("User")
    project = relationship("Project")


class TestMindmap(Base):
    __tablename__ = "test_mindmaps"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    description = Column(Text)
    project_id = Column(Integer, ForeignKey('projects.id'), nullable=False)
    mindmap_data = Column(JSON)  # JSON structure representing the mindmap nodes and connections
    created_by = Column(Integer, ForeignKey('users.id'), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    is_active = Column(Boolean, default=True)

    # Relationships
    project = relationship("Project")
    creator = relationship("User", foreign_keys=[created_by])


class ImpactAnalysis(Base):
    __tablename__ = "impact_analyses"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    description = Column(Text)
    entity_type = Column(String(50), nullable=False)  # requirement, test_case, test_suite
    entity_id = Column(Integer, nullable=False)
    change_type = Column(String(50), nullable=False)  # create, update, delete
    project_id = Column(Integer, ForeignKey('projects.id'), nullable=False)
    impact_data = Column(JSON)  # JSON structure containing impact analysis results
    created_by = Column(Integer, ForeignKey('users.id'), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    status = Column(String(50), default="pending")  # pending, in_progress, completed

    # Relationships
    project = relationship("Project")
    creator = relationship("User", foreign_keys=[created_by])


class ExecutionEnvironment(Base):
    __tablename__ = "execution_environments"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    description = Column(Text)
    project_id = Column(Integer, ForeignKey('projects.id'), nullable=False)
    environment_type = Column(String(50), nullable=False)  # development, staging, production, custom
    config_data = Column(JSON)  # Environment configuration (URLs, credentials, etc.)
    build_info = Column(JSON)   # Build information and artifacts
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    project = relationship("Project")
    test_runs = relationship("TestRun", back_populates="environment")


class ExecutionLog(Base):
    __tablename__ = "execution_logs"

    id = Column(Integer, primary_key=True, index=True)
    test_run_id = Column(Integer, ForeignKey('test_runs.id'), nullable=False)
    test_result_id = Column(Integer, ForeignKey('test_results.id'))
    log_level = Column(String(20), nullable=False)  # DEBUG, INFO, WARNING, ERROR, CRITICAL
    message = Column(Text, nullable=False)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())
    log_metadata = Column(JSON)  # Additional log metadata (stack traces, etc.)

    # Relationships
    test_run = relationship("TestRun")
    test_result = relationship("TestResult")


class TestSchedule(Base):
    __tablename__ = "test_schedules"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    description = Column(Text)
    project_id = Column(Integer, ForeignKey('projects.id'), nullable=False)
    test_suite_id = Column(Integer, ForeignKey('test_suites.id'))
    environment_id = Column(Integer, ForeignKey('execution_environments.id'))
    schedule_type = Column(String(50), nullable=False)  # daily, weekly, monthly, cron
    schedule_config = Column(JSON)  # Schedule configuration (time, days, cron expression)
    is_active = Column(Boolean, default=True)
    last_run = Column(DateTime(timezone=True))
    next_run = Column(DateTime(timezone=True))
    created_by = Column(Integer, ForeignKey('users.id'), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    project = relationship("Project")
    test_suite = relationship("TestSuite")
    environment = relationship("ExecutionEnvironment")
    creator = relationship("User", foreign_keys=[created_by])
    test_runs = relationship("TestRun", back_populates="schedule")


class ExecutionEngine(Base):
    __tablename__ = "execution_engines"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    engine_type = Column(String(50), nullable=False)  # sequential, parallel, distributed
    config_data = Column(JSON)  # Engine configuration (thread count, batch size, etc.)
    max_concurrent_runs = Column(Integer, default=10)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class TestRunEnvironment(Base):
    __tablename__ = "test_run_environments"

    id = Column(Integer, primary_key=True, index=True)
    test_run_id = Column(Integer, ForeignKey('test_runs.id'), nullable=False)
    environment_id = Column(Integer, ForeignKey('execution_environments.id'), nullable=False)
    config_snapshot = Column(JSON)  # Snapshot of environment config at run time
    build_snapshot = Column(JSON)   # Snapshot of build info at run time
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    test_run = relationship("TestRun")
    environment = relationship("ExecutionEnvironment")


class DefectComment(Base):
    __tablename__ = "defect_comments"

    id = Column(Integer, primary_key=True, index=True)
    defect_id = Column(Integer, ForeignKey("defects.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    comment = Column(Text, nullable=False)
    is_internal = Column(Boolean, default=False)  # Internal comments not visible to customers
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    defect = relationship("Defect", back_populates="comments")
    author = relationship("User")


class DefectAttachment(Base):
    __tablename__ = "defect_attachments"

    id = Column(Integer, primary_key=True, index=True)
    defect_id = Column(Integer, ForeignKey("defects.id"), nullable=False)
    filename = Column(String(255), nullable=False)
    file_path = Column(String(500), nullable=False)
    file_size = Column(Integer)
    mime_type = Column(String(100))
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    defect = relationship("Defect", back_populates="attachments_files")
    uploader = relationship("User")


class DefectHistory(Base):
    __tablename__ = "defect_history"

    id = Column(Integer, primary_key=True, index=True)
    defect_id = Column(Integer, ForeignKey("defects.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    field_name = Column(String(100), nullable=False)  # status, priority, assignee, etc.
    old_value = Column(Text)
    new_value = Column(Text)
    change_reason = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    defect = relationship("Defect", back_populates="history")
    changed_by = relationship("User")


class DefectWorkflow(Base):
    __tablename__ = "defect_workflows"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    description = Column(Text)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    is_default = Column(Boolean, default=False)
    workflow_config = Column(JSON)  # JSON defining workflow states and transitions
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    project = relationship("Project")
    creator = relationship("User")


class DefectTemplate(Base):
    __tablename__ = "defect_templates"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    description = Column(Text)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    template_data = Column(JSON)  # JSON with default values, required fields, etc.
    is_active = Column(Boolean, default=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    project = relationship("Project")
    creator = relationship("User")


class IssueTrackerIntegration(Base):
    __tablename__ = "issue_tracker_integrations"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    tracker_type = Column(String(50), nullable=False)  # jira, github, gitlab, etc.
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    api_url = Column(String(500), nullable=False)
    _api_token = Column("api_token", String(500))  # Encrypted in database
    username = Column(String(255))
    project_key = Column(String(50))  # JIRA project key, etc.
    sync_direction = Column(String(20), default="bidirectional")  # import, export, bidirectional
    sync_config = Column(JSON)  # Field mappings, sync rules, etc.
    is_active = Column(Boolean, default=True)
    last_sync = Column(DateTime(timezone=True))
    sync_status = Column(String(50), default="not_synced")  # not_synced, syncing, synced, error
    sync_error = Column(Text)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    project = relationship("Project")
    
    @property
    def api_token(self):
        """Decrypt api_token when accessed"""
        from .crypto import decrypt_data
        if self._api_token:
            try:
                return decrypt_data(self._api_token)
            except Exception:
                # If decryption fails, return as-is (for backward compatibility)
                return self._api_token
        return self._api_token
    
    @api_token.setter
    def api_token(self, value):
        """Encrypt api_token when set"""
        from .crypto import encrypt_data
        if value:
            self._api_token = encrypt_data(value)
        else:
            self._api_token = value
    creator = relationship("User")
    sync_logs = relationship("SyncLog", back_populates="integration", cascade="all, delete-orphan")


class SyncLog(Base):
    __tablename__ = "sync_logs"

    id = Column(Integer, primary_key=True, index=True)
    integration_id = Column(Integer, ForeignKey("issue_tracker_integrations.id"), nullable=False)
    sync_type = Column(String(50), nullable=False)  # full, incremental, manual
    entity_type = Column(String(50), nullable=False)  # defect, requirement, etc.
    entity_id = Column(Integer)
    action = Column(String(50), nullable=False)  # created, updated, deleted, synced
    status = Column(String(50), nullable=False)  # success, error, warning
    message = Column(Text)
    details = Column(JSON)  # Detailed sync information
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True))

    # Relationships
    integration = relationship("IssueTrackerIntegration", back_populates="sync_logs")


class AuditTrail(Base):
    __tablename__ = "audit_trails"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    action = Column(Enum(AuditAction), nullable=False)
    entity_type = Column(Enum(EntityType), nullable=False)
    entity_id = Column(Integer, nullable=True)  # Can be null for actions like login/logout
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=True)  # Null for global actions
    old_values = Column(JSON)  # Previous state before update
    new_values = Column(JSON)  # New state after update/create
    field_changes = Column(JSON)  # Specific fields that changed
    ip_address = Column(String(45))  # IPv4 or IPv6
    user_agent = Column(Text)
    session_id = Column(String(255))
    description = Column(Text)  # Human-readable description of the action
    additional_metadata = Column(JSON)  # Additional context
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    user = relationship("User", foreign_keys=[user_id])
    project = relationship("Project")

    @property
    def username(self):
        return self.user.username if self.user else None

    @property
    def user_full_name(self):
        return self.user.full_name if self.user else None


class ImportOperation(Base):
    __tablename__ = "import_operations"

    id = Column(Integer, primary_key=True, index=True)
    idempotency_key = Column(String(255), unique=True, nullable=False, index=True)
    operation = Column(String(100), nullable=False)
    lock_key = Column(String(255), index=True)
    status = Column(String(20), nullable=False, default="processing")
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    project_id = Column(Integer, ForeignKey("projects.id"))
    test_suite_id = Column(Integer, ForeignKey("test_suites.id"))
    filename = Column(String(255))
    response_data = Column(JSON)
    error_message = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    completed_at = Column(DateTime(timezone=True))

    user = relationship("User")
    project = relationship("Project")
    test_suite = relationship("TestSuite")


class SavedFilter(Base):
    """User-owned saved filter for list pages.

    ``scope`` namespaces filters per page (``test_cases``, ``defects``, …),
    ``definition`` is whatever JSON shape the page understands. Filters are
    private to the owning user unless ``is_shared`` is true, in which case
    project members with read access can also apply them.
    """
    __tablename__ = "saved_filters"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    scope = Column(String(32), nullable=False, index=True)
    name = Column(String(120), nullable=False)
    definition = Column(JSON, nullable=False)
    is_default = Column(Boolean, default=False, nullable=False)
    is_shared = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    user = relationship("User", foreign_keys=[user_id])
    project = relationship("Project", foreign_keys=[project_id])

    __table_args__ = (
        UniqueConstraint("user_id", "project_id", "scope", "name", name="uq_saved_filter_owner_scope_name"),
    )


class ApiToken(Base):
    """Personal access tokens for CI/CD and scripted integrations.

    We never store the raw token — only its sha256 hash. The ``prefix`` is a
    short identifying snippet of the raw token kept so the UI can show a
    recognizable handle ("tmona_xKf3…") for management.
    """
    __tablename__ = "api_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(120), nullable=False)
    prefix = Column(String(16), nullable=False, index=True)
    token_hash = Column(String(64), unique=True, nullable=False, index=True)
    last_used_at = Column(DateTime(timezone=True))
    expires_at = Column(DateTime(timezone=True))
    revoked_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", foreign_keys=[user_id])


class WebhookSubscription(Base):
    """Outbound webhook target scoped to a project."""
    __tablename__ = "webhook_subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    created_by = Column(Integer, ForeignKey("users.id"))
    name = Column(String(120), nullable=False)
    url = Column(String(2048), nullable=False)
    secret = Column(String(128), nullable=False)
    # JSON list of subscribed event names, e.g. ["test_run.completed", "defect.created"].
    # Stored as JSON for portability across SQLite/Postgres.
    events = Column(JSON, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    project = relationship("Project", foreign_keys=[project_id])
    creator = relationship("User", foreign_keys=[created_by])


class WebhookDelivery(Base):
    """One attempted delivery of an event to a subscription. We persist these
    so users can audit and redeliver failed events."""
    __tablename__ = "webhook_deliveries"

    id = Column(Integer, primary_key=True, index=True)
    subscription_id = Column(Integer, ForeignKey("webhook_subscriptions.id", ondelete="CASCADE"), nullable=False, index=True)
    event = Column(String(64), nullable=False, index=True)
    payload = Column(JSON, nullable=False)
    status = Column(String(20), nullable=False, default="pending")  # pending|success|failed
    attempts = Column(Integer, nullable=False, default=0)
    response_status = Column(Integer)
    response_body = Column(Text)  # truncated
    error = Column(Text)
    delivered_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    subscription = relationship("WebhookSubscription")


# Add relationships to versioning models (avoiding circular imports)
TestCase.versions = relationship("TestCaseVersion", back_populates="test_case")
TestCase.current_version = relationship(
    "TestCaseVersion",
    primaryjoin="and_(TestCase.id==TestCaseVersion.test_case_id, "
                 "TestCaseVersion.status=='published')",
    uselist=False,
    viewonly=True
)
