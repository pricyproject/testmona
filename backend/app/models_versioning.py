from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Enum, Boolean, JSON, Table
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from .database import Base
import enum


class VersionStatus(enum.Enum):
    DRAFT = "draft"
    PENDING_REVIEW = "pending_review"
    APPROVED = "approved"
    PUBLISHED = "published"
    ARCHIVED = "archived"


class VersionAction(enum.Enum):
    CREATE = "create"
    UPDATE = "update"
    ROLLBACK = "rollback"
    MERGE = "merge"
    BRANCH = "branch"


class TestCaseVersion(Base):
    """Enhanced version control for test cases with semantic versioning"""
    __tablename__ = "test_case_versions"

    id = Column(Integer, primary_key=True, index=True)
    test_case_id = Column(Integer, ForeignKey("test_cases.id"), nullable=False)
    
    # Semantic versioning
    version_major = Column(Integer, default=1)
    version_minor = Column(Integer, default=0)
    version_patch = Column(Integer, default=0)
    version_label = Column(String(50))  # e.g., "beta", "rc1", "stable"
    
    # Version metadata
    version_name = Column(String(255))  # e.g., "v1.2.0 - Login fix"
    description = Column(Text)
    status = Column(Enum(VersionStatus), default=VersionStatus.DRAFT)
    
    # Complete snapshot of test case at this version
    title = Column(String(255), nullable=False)
    test_type = Column(String(20))
    preconditions = Column(Text)
    steps = Column(Text)
    expected_result = Column(Text)
    priority = Column(String(10))
    tags = Column(String(500))
    
    # Custom fields snapshot
    custom_fields_data = Column(JSON)  # Snapshot of custom field values
    
    # Change tracking
    changed_fields = Column(JSON)  # Detailed field changes
    change_summary = Column(Text)  # Human-readable summary
    change_reason = Column(Text)    # Detailed reason for change
    
    # Branching support
    parent_version_id = Column(Integer, ForeignKey("test_case_versions.id"))
    branch_name = Column(String(100))  # For feature branches
    is_merged = Column(Boolean, default=False)
    merged_into_version_id = Column(Integer, ForeignKey("test_case_versions.id"))
    
    # Approval workflow
    reviewed_by = Column(Integer, ForeignKey("users.id"))
    reviewed_at = Column(DateTime(timezone=True))
    review_comments = Column(Text)
    approved_by = Column(Integer, ForeignKey("users.id"))
    approved_at = Column(DateTime(timezone=True))
    
    # Metadata
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    published_at = Column(DateTime(timezone=True))
    
    # Relationships
    test_case = relationship("TestCase", back_populates="versions")
    creator = relationship("User", foreign_keys=[created_by])
    reviewer = relationship("User", foreign_keys=[reviewed_by])
    approver = relationship("User", foreign_keys=[approved_by])
    parent_version = relationship("TestCaseVersion", remote_side=[id], foreign_keys=[parent_version_id])
    merged_into_version = relationship("TestCaseVersion", remote_side=[id], foreign_keys=[merged_into_version_id])
    child_versions = relationship("TestCaseVersion", foreign_keys=[parent_version_id], back_populates="parent_version")
    comparisons = relationship("VersionComparison", foreign_keys="VersionComparison.from_version_id")
    
    @property
    def version_string(self):
        """Generate semantic version string"""
        version = f"v{self.version_major}.{self.version_minor}.{self.version_patch}"
        if self.version_label:
            version += f"-{self.version_label}"
        return version
    
    def is_current_version(self, db) -> bool:
        """Check if this is the current published version.

        Requires a SQLAlchemy session; this is plain SQLAlchemy, so there is
        no Flask-style ``Model.query``.
        """
        current = db.query(TestCaseVersion).filter_by(
            test_case_id=self.test_case_id,
            status=VersionStatus.PUBLISHED
        ).order_by(
            TestCaseVersion.version_major.desc(),
            TestCaseVersion.version_minor.desc(),
            TestCaseVersion.version_patch.desc()
        ).first()
        return bool(current and current.id == self.id)


class VersionComparison(Base):
    """Store comparison results between versions"""
    __tablename__ = "version_comparisons"

    id = Column(Integer, primary_key=True, index=True)
    from_version_id = Column(Integer, ForeignKey("test_case_versions.id"), nullable=False)
    to_version_id = Column(Integer, ForeignKey("test_case_versions.id"), nullable=False)
    
    # Comparison results
    field_differences = Column(JSON)  # Detailed field-by-field differences
    added_fields = Column(JSON)       # Fields added in to_version
    removed_fields = Column(JSON)     # Fields removed in from_version
    modified_fields = Column(JSON)    # Fields with changes
    similarity_score = Column(Integer)  # 0-100 similarity score
    
    # Metadata
    comparison_type = Column(String(20), default="full")  # full, quick, custom
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    from_version = relationship("TestCaseVersion", back_populates="comparisons", foreign_keys=[from_version_id])
    to_version = relationship("TestCaseVersion", foreign_keys=[to_version_id])
    creator = relationship("User", foreign_keys=[created_by])


class VersionTag(Base):
    """Tags for marking important versions (releases, milestones, etc.)"""
    __tablename__ = "version_tags"

    id = Column(Integer, primary_key=True, index=True)
    version_id = Column(Integer, ForeignKey("test_case_versions.id"), nullable=False)
    tag_name = Column(String(100), nullable=False)  # e.g., "release-1.0", "milestone-A"
    tag_type = Column(String(50), default="release")  # release, milestone, checkpoint
    description = Column(Text)
    color = Column(String(7), default="#007bff")  # Hex color code
    
    # Metadata
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    version = relationship("TestCaseVersion")
    creator = relationship("User", foreign_keys=[created_by])


class VersionLock(Base):
    """Lock versions to prevent conflicts during editing"""
    __tablename__ = "version_locks"

    id = Column(Integer, primary_key=True, index=True)
    test_case_id = Column(Integer, ForeignKey("test_cases.id"), nullable=False)
    version_id = Column(Integer, ForeignKey("test_case_versions.id"))
    
    # Lock details
    lock_type = Column(String(20), default="edit")  # edit, review, approve
    lock_reason = Column(Text)
    
    # Lock ownership
    locked_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    locked_at = Column(DateTime(timezone=True), server_default=func.now())
    expires_at = Column(DateTime(timezone=True))
    
    # Status
    is_active = Column(Boolean, default=True)
    released_at = Column(DateTime(timezone=True))
    released_by = Column(Integer, ForeignKey("users.id"))
    
    # Relationships
    test_case = relationship("TestCase")
    version = relationship("TestCaseVersion")
    locker = relationship("User", foreign_keys=[locked_by])
    releaser = relationship("User", foreign_keys=[released_by])


class VersionWorkflow(Base):
    """Workflow configuration for version approval process"""
    __tablename__ = "version_workflows"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    
    # Workflow configuration
    workflow_name = Column(String(100), nullable=False)
    is_default = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    
    # Approval steps (JSON array of step configurations)
    approval_steps = Column(JSON)  # [{"step": 1, "role": "manager", "required": true}, ...]
    
    # Auto-approval rules
    auto_approve_minor_changes = Column(Boolean, default=False)
    auto_approve_patch_changes = Column(Boolean, default=True)
    require_review_for_priority_changes = Column(Boolean, default=True)
    
    # Metadata
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Relationships
    project = relationship("Project")
    creator = relationship("User", foreign_keys=[created_by])


# Note: Relationships to existing models are defined in models.py to avoid circular imports
