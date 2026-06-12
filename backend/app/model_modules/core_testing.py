from .base import *
from .shared_assets import *

class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False, unique=True, index=True)
    description = Column(Text)
    owner_id = Column(Integer, ForeignKey("users.id"))
    status = Column(Enum(Status), default=Status.ACTIVE)
    # Per-project feature toggles: {feature_key: bool}. NULL/missing keys mean
    # enabled (see app.features). Lets admins/owners hide modules a project
    # doesn't use (Doc Hub, Ask AI, Reports, ...).
    features = Column(JSON, nullable=True)
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
    project_seq = Column(Integer, nullable=True, index=True)  # per-project sequence for URLs/badges
    status = Column(Enum(Status), default=Status.ACTIVE)
    __table_args__ = (
        Index("uq_test_suites_project_seq", "project_id", "project_seq", unique=True),
    )
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
    # Per-project sequence for URLs/badges. project_id is denormalised from the
    # suite (see below), so a unique (project_id, project_seq) index in
    # __table_args__ enforces per-project uniqueness.
    project_seq = Column(Integer, nullable=True)
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
    # Denormalised from the suite so test cases can be filtered/numbered per project
    # without a join. Kept in sync on create and whenever the suite changes.
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=True, index=True)
    tags = Column(String(500))
    order_index = Column(Integer, default=0)
    is_deleted = Column(Boolean, default=False)
    is_multistep = Column(Boolean, default=False)  # Flag to indicate multistep format
    # Optional reusable data set this case iterates over during a run. When set,
    # the execution screen walks the tester through each dataset row, substituting
    # ${param} placeholders in step text. SET NULL so deleting a dataset detaches.
    dataset_id = Column(Integer, ForeignKey("test_datasets.id", ondelete="SET NULL"), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    test_suite = relationship("TestSuite", back_populates="test_cases")
    section = relationship("TestCaseSection", back_populates="test_cases")
    test_results = relationship("TestResult", back_populates="test_case")
    debt_items = relationship("TestDebtItem", back_populates="test_case", cascade="all, delete-orphan")
    custom_field_values = relationship("CustomFieldValue", back_populates="test_case")
    revisions = relationship("TestCaseRevision", back_populates="test_case")
    versions = relationship("TestCaseVersion", back_populates="test_case")
    shared_steps = relationship("SharedStep", secondary=shared_step_usage, back_populates="test_cases")
    test_steps = relationship("TestCaseStep", back_populates="test_case", cascade="all, delete-orphan")
    dataset = relationship("TestDataset", foreign_keys=[dataset_id])
    creator = relationship("User", foreign_keys=[created_by])
    project = relationship("Project")

    __table_args__ = (
        Index("uq_test_cases_project_seq", "project_id", "project_seq", unique=True),
    )


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


class MatrixRun(Base):
    """A group of test runs executing the same case selection across N environments.

    Each child TestRun keeps its own environment_id/results; the matrix row only
    carries the shared identity so results can be pivoted case x environment.
    """
    __tablename__ = "matrix_runs"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False, index=True)
    description = Column(Text)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    project_seq = Column(Integer, nullable=True, index=True)  # per-project sequence for URLs/badges
    __table_args__ = (
        Index("uq_matrix_runs_project_seq", "project_id", "project_seq", unique=True),
    )
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    project = relationship("Project")
    creator = relationship("User", foreign_keys=[created_by])
    test_runs = relationship("TestRun", back_populates="matrix_run")


class TestRun(Base):
    __tablename__ = "test_runs"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False, index=True)
    description = Column(Text)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    project_seq = Column(Integer, nullable=True, index=True)  # per-project sequence for URLs/badges
    test_plan_id = Column(Integer, ForeignKey("test_plans.id"))
    matrix_run_id = Column(Integer, ForeignKey("matrix_runs.id", ondelete="SET NULL"), nullable=True, index=True)
    __table_args__ = (
        Index("uq_test_runs_project_seq", "project_id", "project_seq", unique=True),
    )
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
    matrix_run = relationship("MatrixRun", back_populates="test_runs")
    environment = relationship("ExecutionEnvironment", back_populates="test_runs")
    execution_engine = relationship("ExecutionEngine")
    assignee = relationship("User", foreign_keys=[assigned_to])


class TestResult(Base):
    __tablename__ = "test_results"
    __table_args__ = (
        Index("ix_test_results_test_run_id_status", "test_run_id", "status"),
        Index("ix_test_results_test_case_id_executed_at", "test_case_id", "executed_at"),
    )

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
    # Why a blocked execution couldn't be completed (environment, test_data,
    # dependency, access, awaiting_fix, other). Null for non-blocked results.
    blocker_reason = Column(String(50))

    # Per-iteration outcomes for data-driven cases. Null for non-parameterized
    # cases. Shape: [{"row_index": int, "values": {...}, "status": str,
    # "actual_result": str?, "comments": str?}]. The row-level `status` field
    # remains the derived overall outcome.
    iteration_results = Column(JSON, nullable=True)

    @validates("status")
    def _normalize_status(self, _key, value):
        """Canonicalize on write so every code path (routes, bulk seeding, CI
        ingestion, imports) stores one token per outcome — never pending vs
        not_started for the same "not started" state."""
        return canonical_result_status(value) if value is not None else value

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
    two_factor_enabled = Column(Boolean, default=False, nullable=False, server_default="0")
    two_factor_secret = Column(Text, nullable=True)
    two_factor_recovery_codes = Column(Text, nullable=True)
    session_version = Column(Integer, default=0, nullable=False, server_default="0")
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
