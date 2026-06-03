"""Add Doc Hub tables (doc_spaces, doc_folders, docs, doc_versions, doc_requirement_links)

Revision ID: add_doc_hub
Revises: add_requirement_folders
Create Date: 2026-06-02 12:00:00.000000

Introduces the Doc Hub: a Docs-as-Code documentation feature. A ``doc_space`` is
a repository of documents, either global (``project_id`` NULL) or project-scoped.
Docs store canonical Markdown, live in an optional folder tree, are versioned, and
can be converted into requirements (provenance via ``doc_requirement_links``).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text
import uuid

from app.services.migration_helpers import table_exists


revision = "add_doc_hub"
down_revision = "add_requirement_folders"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    inspector = inspect(connection)

    if not table_exists(connection, "doc_spaces"):
        op.create_table(
            "doc_spaces",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("uuid", sa.String(length=36), nullable=True),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("slug", sa.String(length=255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("project_id", sa.Integer(), nullable=True),
            sa.Column("classification", sa.String(length=100), nullable=True),
            sa.Column("icon", sa.String(length=50), nullable=True),
            sa.Column("color", sa.String(length=20), nullable=True),
            sa.Column("order_index", sa.Integer(), server_default="0", nullable=True),
            sa.Column("created_by", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True)),
            sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("project_id", "slug", name="uq_doc_spaces_project_slug"),
        )
        op.create_index("ix_doc_spaces_slug", "doc_spaces", ["slug"])
        op.create_index("ix_doc_spaces_uuid", "doc_spaces", ["uuid"], unique=True)
        op.create_index("ix_doc_spaces_project_id", "doc_spaces", ["project_id"])
    elif "uuid" not in {column["name"] for column in inspector.get_columns("doc_spaces")}:
        op.add_column("doc_spaces", sa.Column("uuid", sa.String(length=36), nullable=True))
        op.create_index("ix_doc_spaces_uuid", "doc_spaces", ["uuid"], unique=True)

    if not table_exists(connection, "doc_folders"):
        op.create_table(
            "doc_folders",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("uuid", sa.String(length=36), nullable=True),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("space_id", sa.Integer(), nullable=False),
            sa.Column("parent_folder_id", sa.Integer(), nullable=True),
            sa.Column("order_index", sa.Integer(), server_default="0", nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True)),
            sa.ForeignKeyConstraint(["space_id"], ["doc_spaces.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["parent_folder_id"], ["doc_folders.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_doc_folders_space_id", "doc_folders", ["space_id"])
        op.create_index("ix_doc_folders_uuid", "doc_folders", ["uuid"], unique=True)
    elif "uuid" not in {column["name"] for column in inspector.get_columns("doc_folders")}:
        op.add_column("doc_folders", sa.Column("uuid", sa.String(length=36), nullable=True))
        op.create_index("ix_doc_folders_uuid", "doc_folders", ["uuid"], unique=True)

    if not table_exists(connection, "docs"):
        op.create_table(
            "docs",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("uuid", sa.String(length=36), nullable=True),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("slug", sa.String(length=255), nullable=False),
            sa.Column("content_markdown", sa.Text(), nullable=True),
            sa.Column("space_id", sa.Integer(), nullable=False),
            sa.Column("folder_id", sa.Integer(), nullable=True),
            sa.Column("project_id", sa.Integer(), nullable=True),
            sa.Column("classification", sa.String(length=100), nullable=True),
            sa.Column("status", sa.String(length=50), server_default="DRAFT", nullable=False),
            sa.Column("tags", sa.String(length=500), nullable=True),
            sa.Column("dir", sa.String(length=10), server_default="auto", nullable=True),
            sa.Column("language", sa.String(length=20), nullable=True),
            sa.Column("current_version", sa.Integer(), server_default="0", nullable=True),
            sa.Column("public_id", sa.String(length=64), nullable=True),
            sa.Column("share_scope", sa.String(length=20), server_default="private", nullable=False),
            sa.Column("share_expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("view_count", sa.Integer(), server_default="0", nullable=True),
            sa.Column("last_viewed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_by", sa.Integer(), nullable=False),
            sa.Column("updated_by", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True)),
            sa.ForeignKeyConstraint(["space_id"], ["doc_spaces.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["folder_id"], ["doc_folders.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
            sa.ForeignKeyConstraint(["updated_by"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_docs_slug", "docs", ["slug"])
        op.create_index("ix_docs_uuid", "docs", ["uuid"], unique=True)
        op.create_index("ix_docs_space_id", "docs", ["space_id"])
        op.create_index("ix_docs_project_id", "docs", ["project_id"])
        op.create_index("ix_docs_public_id", "docs", ["public_id"], unique=True)
    else:
        doc_columns = {column["name"] for column in inspector.get_columns("docs")}
        if "uuid" not in doc_columns:
            op.add_column("docs", sa.Column("uuid", sa.String(length=36), nullable=True))
            op.create_index("ix_docs_uuid", "docs", ["uuid"], unique=True)
        if "view_count" not in doc_columns:
            op.add_column("docs", sa.Column("view_count", sa.Integer(), server_default="0", nullable=True))
        if "last_viewed_at" not in doc_columns:
            op.add_column("docs", sa.Column("last_viewed_at", sa.DateTime(timezone=True), nullable=True))

    if not table_exists(connection, "doc_versions"):
        op.create_table(
            "doc_versions",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("doc_id", sa.Integer(), nullable=False),
            sa.Column("version_number", sa.Integer(), nullable=False),
            sa.Column("action", sa.String(length=20), nullable=False, server_default="updated"),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("content_markdown", sa.Text(), nullable=True),
            sa.Column("status", sa.String(length=50), nullable=True),
            sa.Column("classification", sa.String(length=100), nullable=True),
            sa.Column("tags", sa.String(length=500), nullable=True),
            sa.Column("change_note", sa.String(length=500), nullable=True),
            sa.Column("created_by", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.ForeignKeyConstraint(["doc_id"], ["docs.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("doc_id", "version_number", name="uq_doc_version_number"),
        )
        op.create_index("ix_doc_versions_doc_id", "doc_versions", ["doc_id"])

    if not table_exists(connection, "doc_requirement_links"):
        op.create_table(
            "doc_requirement_links",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("doc_id", sa.Integer(), nullable=False),
            sa.Column("requirement_id", sa.Integer(), nullable=False),
            sa.Column("created_by", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.ForeignKeyConstraint(["doc_id"], ["docs.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["requirement_id"], ["requirements.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("doc_id", "requirement_id", name="uq_doc_requirement_link"),
        )
        op.create_index("ix_doc_requirement_links_doc_id", "doc_requirement_links", ["doc_id"])
        op.create_index("ix_doc_requirement_links_requirement_id", "doc_requirement_links", ["requirement_id"])

    if not table_exists(connection, "doc_visits"):
        op.create_table(
            "doc_visits",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("doc_id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("visit_count", sa.Integer(), server_default="1", nullable=False),
            sa.Column("first_visited_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("last_visited_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.ForeignKeyConstraint(["doc_id"], ["docs.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("doc_id", "user_id", name="uq_doc_visit_user"),
        )
        op.create_index("ix_doc_visits_doc_id", "doc_visits", ["doc_id"])
        op.create_index("ix_doc_visits_user_id", "doc_visits", ["user_id"])

    if not table_exists(connection, "doc_related_links"):
        op.create_table(
            "doc_related_links",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("doc_id", sa.Integer(), nullable=False),
            sa.Column("related_doc_id", sa.Integer(), nullable=False),
            sa.Column("created_by", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.ForeignKeyConstraint(["doc_id"], ["docs.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["related_doc_id"], ["docs.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("doc_id", "related_doc_id", name="uq_doc_related_link"),
        )
        op.create_index("ix_doc_related_links_doc_id", "doc_related_links", ["doc_id"])
        op.create_index("ix_doc_related_links_related_doc_id", "doc_related_links", ["related_doc_id"])

    for table in ("doc_spaces", "doc_folders", "docs"):
        if table_exists(connection, table):
            rows = connection.execute(text(f"SELECT id FROM {table} WHERE uuid IS NULL")).fetchall()
            for row in rows:
                connection.execute(
                    text(f"UPDATE {table} SET uuid = :uuid WHERE id = :id"),
                    {"uuid": str(uuid.uuid4()), "id": row.id},
                )


def downgrade() -> None:
    connection = op.get_bind()

    for table in ("doc_related_links", "doc_visits", "doc_requirement_links", "doc_versions", "docs", "doc_folders", "doc_spaces"):
        if table_exists(connection, table):
            op.drop_table(table)
