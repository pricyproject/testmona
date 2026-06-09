from .base import *
from .shared_assets import *
from .core_testing import *

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
        from ..crypto import decrypt_data
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
        from ..crypto import encrypt_data
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


class RequirementFolder(Base):
    """Hierarchical folder / category used to organise requirements within a
    project (mirrors the test-suite section tree)."""
    __tablename__ = "requirement_folders"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    project_seq = Column(Integer, nullable=True, index=True)  # per-project sequence for URLs/badges
    parent_folder_id = Column(Integer, ForeignKey("requirement_folders.id"))
    __table_args__ = (
        Index("uq_requirement_folders_project_seq", "project_id", "project_seq", unique=True),
    )
    order_index = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    project = relationship("Project")
    parent_folder = relationship("RequirementFolder", remote_side=[id])
    child_folders = relationship("RequirementFolder", back_populates="parent_folder")


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
    project_seq = Column(Integer, nullable=True, index=True)  # per-project sequence for URLs/badges
    # Optional folder/category this requirement is filed under.
    folder_id = Column(Integer, ForeignKey("requirement_folders.id"))
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
        Index("ix_requirements_project_id_status_priority", "project_id", "status", "priority"),
        Index("uq_requirements_project_seq", "project_id", "project_seq", unique=True),
    )

    # Relationships
    project = relationship("Project")
    creator = relationship("User", foreign_keys=[created_by])
    assignee = relationship("User", foreign_keys=[assigned_to])
    parent_requirement = relationship("Requirement", remote_side=[id])
    child_requirements = relationship("Requirement", back_populates="parent_requirement")
    test_cases = relationship("TestCase", secondary="requirement_test_case_links")
    test_plans = relationship("TestPlan", secondary="requirement_test_plan_links", back_populates="requirements")
    versions = relationship(
        "RequirementVersion",
        back_populates="requirement",
        cascade="all, delete-orphan",
        order_by="RequirementVersion.version_number.desc()",
    )
    comments = relationship(
        "RequirementComment",
        back_populates="requirement",
        cascade="all, delete-orphan",
    )


class RequirementVersion(Base):
    """Immutable snapshot of a requirement's content at a point in time.

    A row is written on create, on every save, and on restore, so the full
    edit history is reconstructable and any prior state can be restored.
    """
    __tablename__ = "requirement_versions"

    id = Column(Integer, primary_key=True, index=True)
    requirement_id = Column(Integer, ForeignKey("requirements.id", ondelete="CASCADE"), nullable=False, index=True)
    version_number = Column(Integer, nullable=False)
    action = Column(String(20), nullable=False, default="updated")  # created, updated, restored
    # Snapshot of the editable content at this version.
    title = Column(String(255), nullable=False)
    description = Column(Text)
    acceptance_criteria = Column(Text)
    status = Column(String(50))
    priority = Column(String(50))
    tags = Column(String(500))
    estimated_effort = Column(Float)
    # Free-text note (e.g. "restored from v3").
    change_note = Column(String(500))
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    requirement = relationship("Requirement", back_populates="versions")
    author = relationship("User", foreign_keys=[created_by])

    __table_args__ = (
        UniqueConstraint("requirement_id", "version_number", name="uq_requirement_version_number"),
    )


class RequirementComment(Base):
    """Threaded comment / review note on a requirement.

    A ``parent_id`` of ``None`` is a top-level thread; replies point at their
    root comment. ``is_resolved`` lets a thread be marked done during review.
    """
    __tablename__ = "requirement_comments"

    id = Column(Integer, primary_key=True, index=True)
    requirement_id = Column(Integer, ForeignKey("requirements.id", ondelete="CASCADE"), nullable=False, index=True)
    parent_id = Column(Integer, ForeignKey("requirement_comments.id", ondelete="CASCADE"), index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    body = Column(Text, nullable=False)
    is_resolved = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    requirement = relationship("Requirement", back_populates="comments")
    author = relationship("User", foreign_keys=[user_id])
    replies = relationship(
        "RequirementComment",
        cascade="all, delete-orphan",
        backref=backref("parent", remote_side=[id]),
    )


class RequirementChatConversation(Base):
    """A saved, project-scoped AI chat thread asking questions across a
    project's requirements. Messages hang off it in creation order."""
    __tablename__ = "requirement_chat_conversations"

    id = Column(Integer, primary_key=True, index=True)
    # Unguessable identifier used in share links (never expose the numeric id).
    public_id = Column(String(32), nullable=False, unique=True, index=True, default=lambda: uuid.uuid4().hex)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(255), nullable=False, default="New conversation")
    archived = Column(Boolean, default=False, nullable=False)
    pinned = Column(Boolean, default=False, nullable=False)
    # 'private' = owner only; 'project' = any project member with read access.
    share_scope = Column(String(16), nullable=False, default="private")
    share_expires_at = Column(DateTime(timezone=True), nullable=True)
    share_allowed_user_ids = Column(JSON, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    project = relationship("Project")
    author = relationship("User", foreign_keys=[created_by])
    messages = relationship(
        "RequirementChatMessage",
        back_populates="conversation",
        cascade="all, delete-orphan",
        # id is the tiebreaker: a user turn and its reply can share a
        # second-resolution created_at, and must still sort in insert order.
        order_by="RequirementChatMessage.created_at, RequirementChatMessage.id",
    )


class RequirementChatMessage(Base):
    """One turn in a :class:`RequirementChatConversation`. Assistant turns may
    carry ``sources`` (the requirements cited) and the prompt token count."""
    __tablename__ = "requirement_chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    conversation_id = Column(Integer, ForeignKey("requirement_chat_conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(String(16), nullable=False)  # "user" | "assistant"
    content = Column(Text, nullable=False)
    sources = Column(JSON)  # list of {requirement_id, key, title} for assistant turns
    prompt_tokens = Column(Integer)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    conversation = relationship("RequirementChatConversation", back_populates="messages")
