"""Normalize test-case tags into Tag entities + a join table.

Replaces the freeform comma string ``test_cases.tags`` with:
  * a per-project ``tags`` catalog (name/slug/color), and
  * a ``test_case_tags`` many-to-many join.

The old column is renamed to ``test_cases.tags_cache`` and kept as a denormalized
search/export cache (rewritten by the app on every tag change). Existing comma
values are backfilled into Tag rows + join rows for cases that have a project.

Revision ID: add_normalized_test_case_tags
Revises: add_doc_review_rounds
"""
from alembic import op
import sqlalchemy as sa


revision = "add_normalized_test_case_tags"
down_revision = "add_doc_review_rounds"
branch_labels = None
depends_on = None


_PALETTE = [
    "#6366F1", "#EC4899", "#F59E0B", "#10B981", "#3B82F6",
    "#8B5CF6", "#EF4444", "#14B8A6", "#F97316", "#06B6D4",
]


def _slugify(name: str) -> str:
    return " ".join((name or "").strip().lower().split())


def _has_table(bind, name: str) -> bool:
    return name in sa.inspect(bind).get_table_names()


def _has_column(bind, table: str, column: str) -> bool:
    if not _has_table(bind, table):
        return False
    return any(c["name"] == column for c in sa.inspect(bind).get_columns(table))


def upgrade() -> None:
    bind = op.get_bind()

    if not _has_table(bind, "tags"):
        op.create_table(
            "tags",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id"), nullable=True, index=True),
            sa.Column("name", sa.String(length=100), nullable=False, index=True),
            sa.Column("slug", sa.String(length=100), nullable=False, index=True),
            sa.Column("color", sa.String(length=7), server_default="#6366F1", nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=True),
            sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.UniqueConstraint("project_id", "slug", name="uq_tags_project_slug"),
        )

    if not _has_table(bind, "test_case_tags"):
        op.create_table(
            "test_case_tags",
            sa.Column("test_case_id", sa.Integer(), sa.ForeignKey("test_cases.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("tag_id", sa.Integer(), sa.ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
        )

    # Rename the legacy comma column to the denormalized cache.
    if _has_column(bind, "test_cases", "tags") and not _has_column(bind, "test_cases", "tags_cache"):
        with op.batch_alter_table("test_cases") as batch_op:
            batch_op.alter_column(
                "tags",
                new_column_name="tags_cache",
                existing_type=sa.String(length=500),
                existing_nullable=True,
            )

    _backfill_tags(bind)


def _backfill_tags(bind) -> None:
    """Split each case's cached comma string into Tag rows + join rows."""
    tags_tbl = sa.table(
        "tags",
        sa.column("id", sa.Integer),
        sa.column("project_id", sa.Integer),
        sa.column("name", sa.String),
        sa.column("slug", sa.String),
        sa.column("color", sa.String),
    )
    join_tbl = sa.table(
        "test_case_tags",
        sa.column("test_case_id", sa.Integer),
        sa.column("tag_id", sa.Integer),
    )

    cases = bind.execute(
        sa.text(
            "SELECT id, project_id, tags_cache FROM test_cases "
            "WHERE tags_cache IS NOT NULL AND tags_cache != '' AND project_id IS NOT NULL"
        )
    ).fetchall()

    # (project_id, slug) -> tag_id, seeded with any tags that already exist.
    tag_ids: dict = {}
    for row in bind.execute(sa.text("SELECT id, project_id, slug FROM tags")).fetchall():
        tag_ids[(row[1], row[2])] = row[0]

    seen_links = set()
    for case_id, project_id, raw in cases:
        names = [part.strip() for part in str(raw).split(",") if part.strip()]
        for name in names:
            slug = _slugify(name)
            if not slug:
                continue
            key = (project_id, slug)
            tag_id = tag_ids.get(key)
            if tag_id is None:
                color = _PALETTE[hash(slug) % len(_PALETTE)]
                res = bind.execute(
                    tags_tbl.insert().values(
                        project_id=project_id, name=name, slug=slug, color=color
                    )
                )
                tag_id = res.inserted_primary_key[0] if res.inserted_primary_key else res.lastrowid
                tag_ids[key] = tag_id
            link = (case_id, tag_id)
            if link in seen_links:
                continue
            seen_links.add(link)
            bind.execute(join_tbl.insert().values(test_case_id=case_id, tag_id=tag_id))


def downgrade() -> None:
    bind = op.get_bind()

    if _has_column(bind, "test_cases", "tags_cache") and not _has_column(bind, "test_cases", "tags"):
        with op.batch_alter_table("test_cases") as batch_op:
            batch_op.alter_column(
                "tags_cache",
                new_column_name="tags",
                existing_type=sa.String(length=500),
                existing_nullable=True,
            )

    if _has_table(bind, "test_case_tags"):
        op.drop_table("test_case_tags")
    if _has_table(bind, "tags"):
        op.drop_table("tags")
