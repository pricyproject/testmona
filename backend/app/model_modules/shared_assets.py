from .base import *

class SharedStep(Base):
    __tablename__ = "shared_steps"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False, index=True)
    description = Column(Text)
    action = Column(Text, nullable=False)  # The action to perform
    expected_result = Column(Text, nullable=False)  # Expected result
    project_id = Column(Integer, ForeignKey('projects.id'), nullable=False)
    project_seq = Column(Integer, nullable=True, index=True)  # per-project sequence for URLs/badges
    created_by = Column(Integer, ForeignKey('users.id'), nullable=False)

    __table_args__ = (
        Index("uq_shared_steps_project_seq", "project_id", "project_seq", unique=True),
    )
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
    # Unique per scope (project_id, name) — not globally — so different projects
    # can reuse the same parameter name. Enforced via __table_args__ below.
    name = Column(String(100), nullable=False, index=True)
    # Stored encrypted-at-rest when ``is_encrypted`` is set. The DB column stays
    # ``value``; access goes through the ``value`` property below.
    _value = Column("value", Text, nullable=False)
    description = Column(Text)
    parameter_type = Column(String(50), default="string")  # string, number, boolean, json
    project_id = Column(Integer, ForeignKey('projects.id'), nullable=True)  # null for global, project_id for project-specific
    project_seq = Column(Integer, nullable=True, index=True)  # per-project sequence for URLs/badges
    created_by = Column(Integer, ForeignKey('users.id'), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    is_active = Column(Boolean, default=True)
    is_encrypted = Column(Boolean, default=False)  # For sensitive data like passwords

    # Relationships
    project = relationship("Project")
    creator = relationship("User", foreign_keys=[created_by])

    __table_args__ = (
        UniqueConstraint("project_id", "name", name="uq_global_parameter_project_name"),
        Index("uq_global_parameters_project_seq", "project_id", "project_seq", unique=True),
    )

    @property
    def value(self):
        """Decrypt on read when the parameter is marked encrypted.

        Falls back to the raw stored value if decryption fails — this keeps
        rows written before encryption was enabled (plaintext) readable.
        """
        if self.is_encrypted and self._value:
            from ..crypto import decrypt_data
            try:
                return decrypt_data(self._value)
            except Exception:
                return self._value
        return self._value

    @value.setter
    def value(self, plaintext):
        """Encrypt on write when ``is_encrypted`` is set.

        Callers must set ``is_encrypted`` before assigning ``value`` so the
        flag is current at encryption time (see ``crud.create_global_parameter``
        / ``crud.update_global_parameter``).
        """
        if self.is_encrypted and plaintext is not None:
            from ..crypto import encrypt_data
            self._value = encrypt_data(plaintext)
        else:
            self._value = plaintext


class TestDataset(Base):
    """A reusable, named table of test data scoped to a project.

    Unlike :class:`GlobalParameter` (a single key→value), a dataset is a small
    table: ``parameters`` is the ordered list of column names and ``rows`` is a
    list of ``{param: value}`` dicts — one row per iteration. A test case can
    attach one dataset (``TestCase.dataset_id``); during a run the execution
    screen iterates over each row, substituting ``${param}`` placeholders in the
    step text. Datasets are reusable across many cases.
    """
    __tablename__ = "test_datasets"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    project_seq = Column(Integer, nullable=True, index=True)  # per-project sequence for URLs/badges
    name = Column(String(150), nullable=False)
    description = Column(Text)
    parameters = Column(JSON, nullable=False, default=list)  # ordered list of column names
    rows = Column(JSON, nullable=False, default=list)        # list of {param: value} dicts
    is_active = Column(Boolean, default=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    project = relationship("Project")
    creator = relationship("User", foreign_keys=[created_by])

    __table_args__ = (
        UniqueConstraint("project_id", "name", name="uq_test_dataset_project_name"),
        Index("uq_test_datasets_project_seq", "project_id", "project_seq", unique=True),
    )


class TestTypeDefinition(Base):
    __tablename__ = "test_type_definitions"

    id = Column(Integer, primary_key=True, index=True)
    # Per-project catalog: each project owns its own test types (seeded from defaults).
    project_id = Column(Integer, ForeignKey('projects.id'), nullable=True, index=True)
    project_seq = Column(Integer, nullable=True, index=True)  # per-project sequence
    name = Column(String(100), nullable=False, index=True)
    description = Column(Text)
    color = Column(String(7), nullable=False, default="#3B82F6")  # Hex color code
    icon = Column(String(10), nullable=False, default="🖱️")  # Emoji icon
    is_active = Column(Boolean, default=True)
    usage_count = Column(Integer, default=0)
    created_by = Column(Integer, ForeignKey('users.id'), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint('project_id', 'name', name='uq_test_type_definitions_project_name'),
    )

    # Relationships
    creator = relationship("User", foreign_keys=[created_by])
    project = relationship("Project")


class PriorityDefinition(Base):
    __tablename__ = "priority_definitions"

    id = Column(Integer, primary_key=True, index=True)
    # Per-project catalog: each project owns its own priorities (seeded from defaults).
    project_id = Column(Integer, ForeignKey('projects.id'), nullable=True, index=True)
    project_seq = Column(Integer, nullable=True, index=True)  # per-project sequence
    name = Column(String(50), nullable=False, index=True)
    value = Column(Integer, nullable=False)  # Priority value (1-10)
    color = Column(String(7), nullable=False, default="#F59E0B")  # Hex color code
    description = Column(Text)
    is_default = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    created_by = Column(Integer, ForeignKey('users.id'), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint('project_id', 'name', name='uq_priority_definitions_project_name'),
    )

    # Relationships
    creator = relationship("User", foreign_keys=[created_by])
    project = relationship("Project")


class Tag(Base):
    """Project-scoped, normalized label for test cases.

    Replaces the legacy comma-separated ``TestCase.tags`` string. ``slug`` is the
    lowercased/normalized form of ``name`` and is what uniqueness and lookups key
    on, so "Smoke" and "smoke" collapse to one tag per project.
    """
    __tablename__ = "tags"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey('projects.id'), nullable=True, index=True)
    name = Column(String(100), nullable=False, index=True)
    slug = Column(String(100), nullable=False, index=True)  # normalized lookup key (lowercased name)
    color = Column(String(7), nullable=False, default="#6366F1")  # Hex color code
    description = Column(Text)
    is_active = Column(Boolean, default=True)
    created_by = Column(Integer, ForeignKey('users.id'), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint('project_id', 'slug', name='uq_tags_project_slug'),
    )

    # Relationships
    creator = relationship("User", foreign_keys=[created_by])
    project = relationship("Project")
    test_cases = relationship("TestCase", secondary="test_case_tags", back_populates="tags")


class SharedStepTemplate(Base):
    __tablename__ = "shared_step_templates"

    id = Column(Integer, primary_key=True, index=True)
    # Per-project catalog: each project owns its own step templates (seeded from defaults).
    project_id = Column(Integer, ForeignKey('projects.id'), nullable=True, index=True)
    project_seq = Column(Integer, nullable=True, index=True)  # per-project sequence
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
    project = relationship("Project")


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
