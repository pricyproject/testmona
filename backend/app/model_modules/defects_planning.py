from .base import *
from .shared_assets import *
from .core_testing import *
from .integrations_requirements import *

class Defect(Base):
    __tablename__ = "defects"
    __table_args__ = (
        Index("ix_defects_project_id_status_severity", "project_id", "status", "severity"),
        Index("uq_defects_project_seq", "project_id", "project_seq", unique=True),
    )

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text)
    defect_id = Column(String(50), unique=True, nullable=False)  # DEF-001, etc.
    status = Column(Enum(DefectStatus), default=DefectStatus.OPEN)
    severity = Column(Enum(DefectSeverity), default=DefectSeverity.MEDIUM)
    priority = Column(Enum(DefectPriority), default=DefectPriority.MEDIUM)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    project_seq = Column(Integer, nullable=True, index=True)  # per-project sequence for URLs/badges
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
    project_seq = Column(Integer, nullable=True, index=True)  # per-project sequence for URLs/badges
    milestone_id = Column(Integer, ForeignKey("milestones.id"))
    __table_args__ = (
        Index("uq_test_plans_project_seq", "project_id", "project_seq", unique=True),
    )
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    # Loose reference (no DB FK), matching Notification.actor_id: keeps the
    # additive column portable across backends (inline FKs in ALTER ADD COLUMN
    # fail on MySQL/MariaDB) and avoids a second users FK to disambiguate.
    assigned_to = Column(Integer, nullable=True, index=True)
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
    project_seq = Column(Integer, nullable=True, index=True)  # per-project sequence for URLs/badges
    status = Column(Enum(MilestoneStatus), default=MilestoneStatus.PLANNED)
    __table_args__ = (
        Index("uq_milestones_project_seq", "project_id", "project_seq", unique=True),
    )
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
