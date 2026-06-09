from .base import *
from .shared_assets import *
from .core_testing import *
from .integrations_requirements import *
from .defects_planning import *
from .analytics_execution import *
from .integrations_audit import *

class DocStatus(enum.Enum):
    DRAFT = "draft"
    PUBLISHED = "published"
    ARCHIVED = "archived"


class DocSpace(Base):
    """A repository of documents. Global when ``project_id`` is NULL, otherwise
    scoped to a project (mirrors how requirements are project-scoped)."""
    __tablename__ = "doc_spaces"

    id = Column(Integer, primary_key=True, index=True)
    uuid = Column(String(36), unique=True, index=True)
    name = Column(String(255), nullable=False)
    slug = Column(String(255), nullable=False, index=True)
    description = Column(Text)
    # NULL => global space available across the whole instance.
    project_id = Column(Integer, ForeignKey("projects.id"), index=True)
    project_seq = Column(Integer, nullable=True, index=True)  # per-project sequence for URLs/badges
    classification = Column(String(100))
    icon = Column(String(50))
    color = Column(String(20))
    order_index = Column(Integer, default=0)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("project_id", "slug", name="uq_doc_spaces_project_slug"),
        Index("uq_doc_spaces_project_seq", "project_id", "project_seq", unique=True),
    )

    project = relationship("Project")
    creator = relationship("User", foreign_keys=[created_by])
    folders = relationship("DocFolder", back_populates="space", cascade="all, delete-orphan")
    docs = relationship("Doc", back_populates="space", cascade="all, delete-orphan")


class DocFolder(Base):
    """Hierarchical folder within a :class:`DocSpace` (mirrors RequirementFolder)."""
    __tablename__ = "doc_folders"

    id = Column(Integer, primary_key=True, index=True)
    uuid = Column(String(36), unique=True, index=True)
    name = Column(String(255), nullable=False)
    space_id = Column(Integer, ForeignKey("doc_spaces.id", ondelete="CASCADE"), nullable=False, index=True)
    parent_folder_id = Column(Integer, ForeignKey("doc_folders.id", ondelete="SET NULL"))
    order_index = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    space = relationship("DocSpace", back_populates="folders")
    parent_folder = relationship("DocFolder", remote_side=[id])
    child_folders = relationship("DocFolder", back_populates="parent_folder")


class Doc(Base):
    """A document authored in canonical Markdown."""
    __tablename__ = "docs"

    id = Column(Integer, primary_key=True, index=True)
    uuid = Column(String(36), unique=True, index=True)
    title = Column(String(255), nullable=False)
    slug = Column(String(255), nullable=False, index=True)
    # Canonical Markdown source of truth.
    content_markdown = Column(Text, default="")
    space_id = Column(Integer, ForeignKey("doc_spaces.id", ondelete="CASCADE"), nullable=False, index=True)
    folder_id = Column(Integer, ForeignKey("doc_folders.id", ondelete="SET NULL"))
    # Denormalised from the space so project-scoped queries/AI retrieval are cheap.
    project_id = Column(Integer, ForeignKey("projects.id"), index=True)
    project_seq = Column(Integer, nullable=True, index=True)  # per-project sequence for URLs/badges
    classification = Column(String(100))
    status = Column(Enum(DocStatus), default=DocStatus.DRAFT, nullable=False)
    __table_args__ = (
        Index("uq_docs_project_seq", "project_id", "project_seq", unique=True),
    )
    tags = Column(String(500))
    # Text direction hint for rendering: ltr | rtl | auto.
    dir = Column(String(10), default="auto")
    language = Column(String(20))
    current_version = Column(Integer, default=0)
    # Public read-only sharing. ``public_id`` is the opaque link token; sharing is
    # off until ``share_scope`` is "public" (and the optional expiry has not passed).
    public_id = Column(String(64), unique=True, index=True)
    share_scope = Column(String(20), default="private", nullable=False)  # private | public
    share_expires_at = Column(DateTime(timezone=True))
    view_count = Column(Integer, default=0)
    last_viewed_at = Column(DateTime(timezone=True))
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    updated_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    space = relationship("DocSpace", back_populates="docs")
    folder = relationship("DocFolder")
    project = relationship("Project")
    creator = relationship("User", foreign_keys=[created_by])
    editor = relationship("User", foreign_keys=[updated_by])
    versions = relationship(
        "DocVersion",
        back_populates="doc",
        cascade="all, delete-orphan",
        order_by="DocVersion.version_number.desc()",
    )
    requirement_links = relationship(
        "DocRequirementLink",
        back_populates="doc",
        cascade="all, delete-orphan",
    )
    share_grants = relationship(
        "DocShareGrant",
        back_populates="doc",
        cascade="all, delete-orphan",
    )


class DocVersion(Base):
    """Immutable snapshot of a doc's content. Written on create, every save,
    restore, and publish (mirrors :class:`RequirementVersion`)."""
    __tablename__ = "doc_versions"

    id = Column(Integer, primary_key=True, index=True)
    doc_id = Column(Integer, ForeignKey("docs.id", ondelete="CASCADE"), nullable=False, index=True)
    version_number = Column(Integer, nullable=False)
    action = Column(String(20), nullable=False, default="updated")  # created, updated, restored, published
    title = Column(String(255), nullable=False)
    content_markdown = Column(Text)
    status = Column(String(50))
    classification = Column(String(100))
    tags = Column(String(500))
    change_note = Column(String(500))
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    doc = relationship("Doc", back_populates="versions")
    author = relationship("User", foreign_keys=[created_by])

    __table_args__ = (
        UniqueConstraint("doc_id", "version_number", name="uq_doc_version_number"),
    )


class DocRequirementLink(Base):
    """Provenance: records that a requirement was generated from a doc by the
    converter, so both pages can show the relationship."""
    __tablename__ = "doc_requirement_links"

    id = Column(Integer, primary_key=True, index=True)
    doc_id = Column(Integer, ForeignKey("docs.id", ondelete="CASCADE"), nullable=False, index=True)
    requirement_id = Column(Integer, ForeignKey("requirements.id", ondelete="CASCADE"), nullable=False, index=True)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    doc = relationship("Doc", back_populates="requirement_links")
    requirement = relationship("Requirement")
    creator = relationship("User", foreign_keys=[created_by])

    __table_args__ = (
        UniqueConstraint("doc_id", "requirement_id", name="uq_doc_requirement_link"),
    )


class DocShareGrant(Base):
    """A granular share grant on a doc. Grants read access to a specific
    ``user``, everyone holding a project ``role``, or every member of a
    ``project`` ("project group"). Grants are only honored while the doc's
    ``share_scope`` is ``"restricted"``; each may carry its own expiry."""
    __tablename__ = "doc_share_grants"

    id = Column(Integer, primary_key=True, index=True)
    doc_id = Column(Integer, ForeignKey("docs.id", ondelete="CASCADE"), nullable=False, index=True)
    grant_type = Column(String(20), nullable=False)  # user | role | project
    # Exactly one subject column is set, depending on grant_type.
    subject_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    subject_role = Column(String(20))  # viewer | tester | manager | admin
    subject_project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"))
    expires_at = Column(DateTime(timezone=True))
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    doc = relationship("Doc", back_populates="share_grants")
    subject_user = relationship("User", foreign_keys=[subject_user_id])
    subject_project = relationship("Project", foreign_keys=[subject_project_id])
    creator = relationship("User", foreign_keys=[created_by])

    __table_args__ = (
        UniqueConstraint(
            "doc_id", "grant_type", "subject_user_id", "subject_role", "subject_project_id",
            name="uq_doc_share_grant",
        ),
    )


class DocShareAudit(Base):
    """Append-only audit trail for a doc's sharing: scope changes, grant
    add/remove, and access events (authenticated grant-based reads and
    anonymous public-link views). ``actor_id`` is NULL for anonymous viewers."""
    __tablename__ = "doc_share_audits"

    id = Column(Integer, primary_key=True, index=True)
    doc_id = Column(Integer, ForeignKey("docs.id", ondelete="CASCADE"), nullable=False, index=True)
    actor_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    # scope_changed | grant_added | grant_removed | accessed | public_accessed
    action = Column(String(40), nullable=False)
    detail = Column(String(500))
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    doc = relationship("Doc")
    actor = relationship("User")


class DocVisit(Base):
    """Per-user visit tracking for latest-visited sorting and admin statistics."""
    __tablename__ = "doc_visits"

    id = Column(Integer, primary_key=True, index=True)
    doc_id = Column(Integer, ForeignKey("docs.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    visit_count = Column(Integer, default=1, nullable=False)
    first_visited_at = Column(DateTime(timezone=True), server_default=func.now())
    last_visited_at = Column(DateTime(timezone=True), server_default=func.now())

    doc = relationship("Doc")
    user = relationship("User")

    __table_args__ = (
        UniqueConstraint("doc_id", "user_id", name="uq_doc_visit_user"),
        Index("ix_doc_visits_user_id_last_visited_at", "user_id", "last_visited_at"),
    )


class DocPin(Base):
    """Per-user pinned docs for quick access in the Doc Hub."""
    __tablename__ = "doc_pins"

    id = Column(Integer, primary_key=True, index=True)
    doc_id = Column(Integer, ForeignKey("docs.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    doc = relationship("Doc")
    user = relationship("User")

    __table_args__ = (
        UniqueConstraint("doc_id", "user_id", name="uq_doc_pin_user"),
    )


class DocRelatedLink(Base):
    """Directed related-doc edge, stored once per direction requested by users."""
    __tablename__ = "doc_related_links"

    id = Column(Integer, primary_key=True, index=True)
    doc_id = Column(Integer, ForeignKey("docs.id", ondelete="CASCADE"), nullable=False, index=True)
    related_doc_id = Column(Integer, ForeignKey("docs.id", ondelete="CASCADE"), nullable=False, index=True)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    doc = relationship("Doc", foreign_keys=[doc_id])
    related_doc = relationship("Doc", foreign_keys=[related_doc_id])
    creator = relationship("User", foreign_keys=[created_by])

    __table_args__ = (
        UniqueConstraint("doc_id", "related_doc_id", name="uq_doc_related_link"),
    )


class DocFeedback(Base):
    """Per-user reader feedback for a document."""
    __tablename__ = "doc_feedback"

    id = Column(Integer, primary_key=True, index=True)
    doc_id = Column(Integer, ForeignKey("docs.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    feedback_type = Column(String(30), nullable=False)  # helpful | not_helpful | clarification | outdated
    comment = Column(Text)
    section_text = Column(Text)
    resolved = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    doc = relationship("Doc")
    user = relationship("User")

    __table_args__ = (
        UniqueConstraint("doc_id", "user_id", name="uq_doc_feedback_user"),
    )


class DocReleaseNoteStatus(enum.Enum):
    DRAFT = "draft"
    PUBLISHED = "published"


class DocReleaseNote(Base):
    """Living release notes generated from doc changes, linked requirements,
    defects, and test coverage over a time window. Authored as an editable draft,
    reviewed/approved, then published (mirrors the Doc draft→published lifecycle).

    Project-scoped: release notes draw on a project's requirements/defects/tests,
    so unlike :class:`Doc` there is no global variant."""
    __tablename__ = "doc_release_notes"

    id = Column(Integer, primary_key=True, index=True)
    uuid = Column(String(36), unique=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    # Optional human version/tag, e.g. "v1.4.0".
    version = Column(String(50))
    status = Column(Enum(DocReleaseNoteStatus), default=DocReleaseNoteStatus.DRAFT, nullable=False)
    # Canonical editable Markdown body (rendered for readers; users edit before publishing).
    content_markdown = Column(Text, default="")
    # Optional AI-written summary blurb shown above the body.
    summary = Column(Text)
    # The window the notes were generated from (used to recompute / show coverage).
    range_start = Column(DateTime(timezone=True))
    range_end = Column(DateTime(timezone=True))
    # Structured snapshot of the generated source data (changed docs, requirements,
    # defects, coverage) so the draft can show provenance and be regenerated.
    source_data = Column(JSON)
    published_at = Column(DateTime(timezone=True))
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    updated_by = Column(Integer, ForeignKey("users.id"))
    published_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    project = relationship("Project")
    creator = relationship("User", foreign_keys=[created_by])
    editor = relationship("User", foreign_keys=[updated_by])
    publisher = relationship("User", foreign_keys=[published_by])
