"""Add doc review rounds + per-reviewer assignments.

Backs the doc review workflow: ``request-review`` opens a :class:`DocReviewRound`
with one :class:`DocReviewAssignment` per reviewer; reviewers record approve /
request-changes decisions; the rolled-up round status gates publishing. Status
columns are plain VARCHARs (the ORM stores the enum member name), mirroring how
``docs.status`` is persisted.

Revision ID: add_doc_review_rounds
Revises: add_notification_inbox_indexes
"""
from alembic import op
import sqlalchemy as sa


revision = "add_doc_review_rounds"
down_revision = "add_notification_inbox_indexes"
branch_labels = None
depends_on = None


def _has_table(bind, name: str) -> bool:
    return name in sa.inspect(bind).get_table_names()


def upgrade() -> None:
    bind = op.get_bind()

    if not _has_table(bind, "doc_review_rounds"):
        op.create_table(
            "doc_review_rounds",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("doc_id", sa.Integer(), sa.ForeignKey("docs.id", ondelete="CASCADE"), nullable=False),
            sa.Column("requested_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("note", sa.String(length=500), nullable=True),
            sa.Column("status", sa.String(length=30), server_default="OPEN", nullable=False),
            sa.Column("resolution_note", sa.String(length=500), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_doc_review_rounds_doc_id", "doc_review_rounds", ["doc_id"])
        op.create_index("ix_doc_review_rounds_status", "doc_review_rounds", ["status"])

    if not _has_table(bind, "doc_review_assignments"):
        op.create_table(
            "doc_review_assignments",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("round_id", sa.Integer(), sa.ForeignKey("doc_review_rounds.id", ondelete="CASCADE"), nullable=False),
            sa.Column("reviewer_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("decision", sa.String(length=30), server_default="PENDING", nullable=False),
            sa.Column("comment", sa.String(length=2000), nullable=True),
            sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.UniqueConstraint("round_id", "reviewer_id", name="uq_doc_review_assignment"),
        )
        op.create_index("ix_doc_review_assignments_round_id", "doc_review_assignments", ["round_id"])
        op.create_index("ix_doc_review_assignments_reviewer_id", "doc_review_assignments", ["reviewer_id"])


def downgrade() -> None:
    bind = op.get_bind()
    if _has_table(bind, "doc_review_assignments"):
        op.drop_table("doc_review_assignments")
    if _has_table(bind, "doc_review_rounds"):
        op.drop_table("doc_review_rounds")
