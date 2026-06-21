"""CRUD helpers for normalized test-case tags.

The ``Tag`` model is the source of truth; ``TestCase.tags_cache`` is a denormalized
comma-string kept in sync via :func:`sync_tags_cache` so TQL/search/CSV stay
column-based. All lookups key on ``slug`` (normalized name) so casing/whitespace
variants collapse to a single project tag.
"""
from typing import List, Optional, Sequence, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models

# Palette used to auto-assign a stable color when a tag is created implicitly
# (typed in the chip input / imported) without an explicit color.
_TAG_PALETTE = [
    "#6366F1", "#EC4899", "#F59E0B", "#10B981", "#3B82F6",
    "#8B5CF6", "#EF4444", "#14B8A6", "#F97316", "#06B6D4",
]


def slugify_tag(name: str) -> str:
    """Normalize a tag name into its lookup slug (lowercased, collapsed spaces)."""
    return " ".join((name or "").strip().lower().split())


def _palette_color(slug: str) -> str:
    return _TAG_PALETTE[hash(slug) % len(_TAG_PALETTE)] if slug else _TAG_PALETTE[0]


def get_tag(db: Session, tag_id: int) -> Optional[models.Tag]:
    return db.query(models.Tag).filter(models.Tag.id == tag_id).first()


def get_tag_by_slug(db: Session, project_id: Optional[int], slug: str) -> Optional[models.Tag]:
    return (
        db.query(models.Tag)
        .filter(models.Tag.project_id == project_id, models.Tag.slug == slug)
        .first()
    )


def get_or_create_tag(
    db: Session,
    project_id: Optional[int],
    name: str,
    created_by: Optional[int] = None,
    color: Optional[str] = None,
) -> Optional[models.Tag]:
    """Return the project tag matching ``name`` (by slug), creating it if missing.

    Returns ``None`` for blank names so callers can filter them out cheaply.
    """
    slug = slugify_tag(name)
    if not slug:
        return None
    tag = get_tag_by_slug(db, project_id, slug)
    if tag is not None:
        return tag
    tag = models.Tag(
        project_id=project_id,
        name=name.strip(),
        slug=slug,
        color=color or _palette_color(slug),
        created_by=created_by,
    )
    db.add(tag)
    db.flush()  # assign id without committing the surrounding transaction
    return tag


def resolve_or_create_tags(
    db: Session,
    project_id: Optional[int],
    names: Sequence[str],
    created_by: Optional[int] = None,
) -> List[models.Tag]:
    """Resolve a list of tag names to ``Tag`` rows, deduped by slug and order-preserving."""
    resolved: List[models.Tag] = []
    seen = set()
    for name in names or []:
        slug = slugify_tag(name)
        if not slug or slug in seen:
            continue
        seen.add(slug)
        tag = get_or_create_tag(db, project_id, name, created_by=created_by)
        if tag is not None:
            resolved.append(tag)
    return resolved


def sync_tags_cache(test_case: "models.TestCase") -> None:
    """Rewrite the denormalized ``tags_cache`` string from the tag relationship."""
    test_case.tags_cache = ",".join(tag.name for tag in test_case.tags)


def split_tag_names(value: Optional[str]) -> List[str]:
    """Split a comma-separated tag string (cache/CSV/legacy) into a name list."""
    if not value:
        return []
    return [part.strip() for part in value.split(",") if part.strip()]


def tags_cache_from_names(names: Sequence[str]) -> str:
    """Comma-join names (used for revision snapshots), deduped by slug."""
    out: List[str] = []
    seen = set()
    for name in names or []:
        slug = slugify_tag(name)
        if not slug or slug in seen:
            continue
        seen.add(slug)
        out.append(name.strip())
    return ",".join(out)


def list_project_tags_with_usage(
    db: Session, project_id: Optional[int]
) -> List[Tuple[models.Tag, int]]:
    """Return ``(Tag, usage_count)`` for a project's tags, ordered by name."""
    usage = (
        db.query(
            models.test_case_tags.c.tag_id.label("tag_id"),
            func.count(models.test_case_tags.c.test_case_id).label("cnt"),
        )
        .group_by(models.test_case_tags.c.tag_id)
        .subquery()
    )
    rows = (
        db.query(models.Tag, func.coalesce(usage.c.cnt, 0))
        .outerjoin(usage, usage.c.tag_id == models.Tag.id)
        .filter(models.Tag.project_id == project_id)
        .order_by(models.Tag.name)
        .all()
    )
    return [(tag, int(cnt)) for tag, cnt in rows]


def _resync_caches_for_tag(db: Session, tag: models.Tag) -> None:
    """Refresh ``tags_cache`` on every test case currently linked to ``tag``."""
    for tc in tag.test_cases:
        sync_tags_cache(tc)


def update_tag(
    db: Session,
    tag: models.Tag,
    *,
    name: Optional[str] = None,
    color: Optional[str] = None,
    description: Optional[str] = None,
    is_active: Optional[bool] = None,
) -> models.Tag:
    """Rename/recolor a tag. A rename re-syncs the cache of every linked case."""
    renamed = False
    if name is not None and name.strip() and name.strip() != tag.name:
        tag.name = name.strip()
        tag.slug = slugify_tag(name)
        renamed = True
    if color is not None:
        tag.color = color
    if description is not None:
        tag.description = description
    if is_active is not None:
        tag.is_active = is_active
    db.flush()
    if renamed:
        _resync_caches_for_tag(db, tag)
    return tag


def delete_tag(db: Session, tag: models.Tag) -> None:
    """Delete a tag, detaching it from cases and refreshing their caches first."""
    affected = list(tag.test_cases)
    for tc in affected:
        tc.tags = [t for t in tc.tags if t.id != tag.id]
        sync_tags_cache(tc)
    db.flush()
    db.delete(tag)


def merge_tags(db: Session, source: models.Tag, target: models.Tag) -> models.Tag:
    """Repoint every case on ``source`` to ``target`` (deduped), then delete ``source``."""
    for tc in list(source.test_cases):
        if target not in tc.tags:
            tc.tags.append(target)
        tc.tags = [t for t in tc.tags if t.id != source.id]
        sync_tags_cache(tc)
    db.flush()
    db.delete(source)
    return target
