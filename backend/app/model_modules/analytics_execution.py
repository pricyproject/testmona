from .base import *
from .shared_assets import *
from .core_testing import *
from .integrations_requirements import *
from .defects_planning import *

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
    # The matching User.notifications side is declared on the User class itself
    # (core_testing.py) — never monkey-patch mapped classes after definition.
    user = relationship("User", back_populates="notifications")


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


class TestDebtItem(Base):
    __tablename__ = "test_debt_items"

    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    test_case_id = Column(Integer, ForeignKey("test_cases.id", ondelete="CASCADE"), nullable=False, index=True)
    debt_type = Column(String(40), nullable=False)
    severity = Column(String(20), nullable=False, default="medium", server_default="medium")
    suggested_action = Column(String(40), nullable=False)
    details = Column(Text)
    auto_detected = Column(Boolean, default=True, server_default="1", nullable=False)
    resolved_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    project = relationship("Project")
    test_case = relationship("TestCase", back_populates="debt_items")

    __table_args__ = (
        UniqueConstraint("test_case_id", "debt_type", name="uq_test_debt_items_case_type"),
        Index("ix_test_debt_items_project_status", "project_id", "resolved_at"),
        Index("ix_test_debt_items_project_type", "project_id", "debt_type"),
    )


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
    project_seq = Column(Integer, nullable=True, index=True)  # per-project sequence for URLs/badges
    environment_type = Column(String(50), nullable=False)  # development, staging, production, custom
    __table_args__ = (
        Index("uq_execution_environments_project_seq", "project_id", "project_seq", unique=True),
    )
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
