from .base import *
from .shared_assets import *
from .core_testing import *
from .integrations_requirements import *
from .defects_planning import *
from .analytics_execution import *

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
    __table_args__ = (
        Index("ix_audit_trails_user_id_created_at", "user_id", "created_at"),
    )

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
