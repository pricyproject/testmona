"""CRUD helpers for the Doc Hub (spaces, folders, docs, versions).

Kept separate from the large ``crud.py`` module. Docs store canonical Markdown;
each save snapshots a :class:`DocVersion` (mirrors the requirement version flow).
"""

from __future__ import annotations

import re
import uuid
from typing import Any, List, Optional

from sqlalchemy import desc, distinct, func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import models, schemas
from .crud import safe_commit


# --------------------------------------------------------------------------- #
# Slugs                                                                        #
# --------------------------------------------------------------------------- #

def slugify(value: str) -> str:
    """Produce a URL-friendly slug. Falls back to ``item`` for empty input."""
    text = (value or "").strip().lower()
    text = re.sub(r"[^\w\s-]", "", text, flags=re.UNICODE)
    text = re.sub(r"[\s_-]+", "-", text).strip("-")
    return text or "item"


def _unique_space_slug(db: Session, project_id: Optional[int], base: str) -> str:
    slug = base
    n = 2
    while (
        db.query(models.DocSpace)
        .filter(models.DocSpace.project_id.is_(project_id) if project_id is None
                else models.DocSpace.project_id == project_id)
        .filter(models.DocSpace.slug == slug)
        .first()
        is not None
    ):
        slug = f"{base}-{n}"
        n += 1
    return slug


def _unique_doc_slug(db: Session, space_id: int, base: str, exclude_id: Optional[int] = None) -> str:
    slug = base
    n = 2
    while True:
        q = db.query(models.Doc).filter(
            models.Doc.space_id == space_id, models.Doc.slug == slug
        )
        if exclude_id is not None:
            q = q.filter(models.Doc.id != exclude_id)
        if q.first() is None:
            return slug
        slug = f"{base}-{n}"
        n += 1


# --------------------------------------------------------------------------- #
# Spaces                                                                       #
# --------------------------------------------------------------------------- #

def get_space(db: Session, space_id: int) -> Optional[models.DocSpace]:
    return db.query(models.DocSpace).filter(models.DocSpace.id == space_id).first()


def list_spaces(
    db: Session,
    project_id: Optional[int] = None,
    include_global: bool = True,
) -> List[models.DocSpace]:
    """List spaces. When ``project_id`` is given, returns that project's spaces
    (plus global spaces when ``include_global``). When ``project_id`` is None,
    returns only global spaces."""
    q = db.query(models.DocSpace)
    if project_id is None:
        q = q.filter(models.DocSpace.project_id.is_(None))
    elif include_global:
        q = q.filter(
            or_(models.DocSpace.project_id == project_id, models.DocSpace.project_id.is_(None))
        )
    else:
        q = q.filter(models.DocSpace.project_id == project_id)
    return q.order_by(models.DocSpace.order_index, models.DocSpace.name).all()


def space_doc_counts(db: Session) -> dict:
    rows = (
        db.query(models.Doc.space_id, func.count(models.Doc.id))
        .group_by(models.Doc.space_id)
        .all()
    )
    return {space_id: count for space_id, count in rows}


def create_space(db: Session, payload: schemas.DocSpaceCreate, actor_id: int) -> models.DocSpace:
    space = models.DocSpace(
        uuid=str(uuid.uuid4()),
        name=payload.name,
        slug=_unique_space_slug(db, payload.project_id, slugify(payload.name)),
        description=payload.description,
        project_id=payload.project_id,
        classification=payload.classification,
        icon=payload.icon,
        color=payload.color,
        created_by=actor_id,
    )
    db.add(space)
    safe_commit(db)
    db.refresh(space)
    return space


def update_space(db: Session, space: models.DocSpace, payload: schemas.DocSpaceUpdate) -> models.DocSpace:
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(space, field, value)
    safe_commit(db)
    db.refresh(space)
    return space


def delete_space(db: Session, space: models.DocSpace) -> None:
    db.delete(space)
    safe_commit(db)


# --------------------------------------------------------------------------- #
# Folders                                                                      #
# --------------------------------------------------------------------------- #

def get_folder(db: Session, folder_id: int) -> Optional[models.DocFolder]:
    return db.query(models.DocFolder).filter(models.DocFolder.id == folder_id).first()


def list_folders(db: Session, space_id: int) -> List[models.DocFolder]:
    return (
        db.query(models.DocFolder)
        .filter(models.DocFolder.space_id == space_id)
        .order_by(models.DocFolder.order_index, models.DocFolder.name)
        .all()
    )


def create_folder(db: Session, payload: schemas.DocFolderCreate, commit: bool = True) -> models.DocFolder:
    folder = models.DocFolder(
        uuid=str(uuid.uuid4()),
        name=payload.name,
        space_id=payload.space_id,
        parent_folder_id=payload.parent_folder_id,
    )
    db.add(folder)
    if commit:
        safe_commit(db)
        db.refresh(folder)
    else:
        db.flush()
    return folder


def update_folder(db: Session, folder: models.DocFolder, payload: schemas.DocFolderUpdate) -> models.DocFolder:
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(folder, field, value)
    safe_commit(db)
    db.refresh(folder)
    return folder


def delete_folder(db: Session, folder: models.DocFolder) -> None:
    replacement_parent_id = folder.parent_folder_id
    (
        db.query(models.Doc)
        .filter(models.Doc.folder_id == folder.id)
        .update({models.Doc.folder_id: replacement_parent_id}, synchronize_session=False)
    )
    (
        db.query(models.DocFolder)
        .filter(models.DocFolder.parent_folder_id == folder.id)
        .update({models.DocFolder.parent_folder_id: replacement_parent_id}, synchronize_session=False)
    )
    db.delete(folder)
    safe_commit(db)


# --------------------------------------------------------------------------- #
# Versions                                                                     #
# --------------------------------------------------------------------------- #

def record_doc_version(
    db: Session,
    doc: models.Doc,
    action: str = "updated",
    actor_id: Optional[int] = None,
    change_note: Optional[str] = None,
    commit: bool = True,
) -> models.DocVersion:
    """Snapshot the doc's current content as a new dense, 1-based version row.

    Routine ``updated`` saves are skipped when nothing snapshotted changed.
    ``created``/``restored``/``published`` always record.
    """
    latest = (
        db.query(models.DocVersion)
        .filter(models.DocVersion.doc_id == doc.id)
        .order_by(models.DocVersion.version_number.desc())
        .first()
    )

    status_value = getattr(doc.status, "value", doc.status)
    if action == "updated" and latest is not None:
        unchanged = (
            latest.title == doc.title
            and latest.content_markdown == doc.content_markdown
            and latest.status == status_value
            and latest.classification == doc.classification
            and latest.tags == doc.tags
        )
        if unchanged:
            return latest

    last_number = latest.version_number if latest is not None else 0
    version = models.DocVersion(
        doc_id=doc.id,
        version_number=last_number + 1,
        action=action,
        title=doc.title,
        content_markdown=doc.content_markdown,
        status=status_value,
        classification=doc.classification,
        tags=doc.tags,
        change_note=change_note,
        created_by=actor_id,
    )
    db.add(version)
    doc.current_version = version.version_number
    if commit:
        safe_commit(db)
        db.refresh(version)
        db.refresh(doc)
    return version


def clear_doc_versions(db: Session, doc: models.Doc, actor_id: Optional[int] = None) -> models.DocVersion:
    """Delete a doc's entire revision history and re-seed a single baseline
    snapshot of the current content, so restore/compare stay coherent."""
    db.query(models.DocVersion).filter(models.DocVersion.doc_id == doc.id).delete(synchronize_session=False)
    doc.current_version = 0
    baseline = record_doc_version(
        db, doc, action="created", actor_id=actor_id,
        change_note="History cleared", commit=False,
    )
    safe_commit(db)
    db.refresh(doc)
    db.refresh(baseline)
    return baseline


def restore_doc_version(
    db: Session,
    doc: models.Doc,
    version: models.DocVersion,
    actor_id: Optional[int] = None,
    change_note: Optional[str] = None,
) -> models.Doc:
    doc.title = version.title
    doc.content_markdown = version.content_markdown or ""
    if version.status:
        doc.status = models.DocStatus(version.status)
    doc.classification = version.classification
    doc.tags = version.tags
    doc.updated_by = actor_id
    record_doc_version(
        db,
        doc,
        action="restored",
        actor_id=actor_id,
        change_note=change_note or f"Restored from v{version.version_number}",
        commit=False,
    )
    safe_commit(db)
    db.refresh(doc)
    return doc


# --------------------------------------------------------------------------- #
# Docs                                                                         #
# --------------------------------------------------------------------------- #

def get_doc(db: Session, doc_id: int) -> Optional[models.Doc]:
    return db.query(models.Doc).filter(models.Doc.id == doc_id).first()


# Columns returned for list rows — everything DocListItem needs EXCEPT the full
# body, which is replaced by a short server-side substring so large documents
# don't bloat list responses.
_LIST_EXCERPT_CHARS = 400


def _list_columns():
    D = models.Doc
    return [
        D.id, D.uuid, D.title, D.slug, D.space_id, D.folder_id, D.project_id,
        D.classification, D.status, D.tags, D.dir, D.language, D.current_version,
        D.share_scope, D.view_count, D.last_viewed_at, D.created_by, D.updated_by,
        D.created_at, D.updated_at,
        func.substr(func.coalesce(D.content_markdown, ""), 1, _LIST_EXCERPT_CHARS).label("content_markdown"),
    ]


def _doc_filter_conditions(
    space_id, project_id, folder_id, classification, status, tag, q, include_global, global_only,
):
    """Build the WHERE conditions shared by the list and count queries."""
    D = models.Doc
    conds = []
    if space_id is not None:
        conds.append(D.space_id == space_id)
    if global_only:
        conds.append(D.project_id.is_(None))
    elif project_id is not None:
        if include_global:
            conds.append(or_(D.project_id == project_id, D.project_id.is_(None)))
        else:
            conds.append(D.project_id == project_id)
    if folder_id is not None:
        conds.append(D.folder_id == folder_id)
    if classification:
        conds.append(D.classification == classification.strip())
    if status:
        conds.append(D.status == models.DocStatus(status.strip().lower()))
    if tag:
        tag_value = tag.strip().replace(" ", "")
        normalized_tags = func.replace(D.tags, " ", "")
        conds.append(
            or_(
                normalized_tags.ilike(tag_value),
                normalized_tags.ilike(f"{tag_value},%"),
                normalized_tags.ilike(f"%,{tag_value},%"),
                normalized_tags.ilike(f"%,{tag_value}"),
            )
        )
    if q:
        like = f"%{q.strip()}%"
        conds.append(or_(D.title.ilike(like), D.content_markdown.ilike(like)))
    return conds


def list_docs(
    db: Session,
    space_id: Optional[int] = None,
    project_id: Optional[int] = None,
    folder_id: Optional[int] = None,
    classification: Optional[str] = None,
    status: Optional[str] = None,
    tag: Optional[str] = None,
    q: Optional[str] = None,
    include_global: bool = False,
    global_only: bool = False,
    pinned_only: bool = False,
    visited_only: bool = False,
    sort: str = "latest_edited",
    user_id: Optional[int] = None,
    skip: int = 0,
    limit: int = 200,
):
    """Return lightweight list rows (full body replaced by a short excerpt)."""
    D = models.Doc
    conds = _doc_filter_conditions(
        space_id, project_id, folder_id, classification, status, tag, q, include_global, global_only,
    )
    query = db.query(*_list_columns()).filter(*conds)
    if user_id is not None and (sort == "latest_visited" or visited_only):
        query = query.outerjoin(
            models.DocVisit,
            (models.DocVisit.doc_id == D.id) & (models.DocVisit.user_id == user_id),
        )
        if visited_only:
            query = query.filter(models.DocVisit.id.isnot(None))
    if user_id is not None and pinned_only:
        query = query.join(
            models.DocPin,
            (models.DocPin.doc_id == D.id) & (models.DocPin.user_id == user_id),
        )
    if sort == "latest_visited" and user_id is not None:
        query = query.order_by(desc(models.DocVisit.last_visited_at).nullslast(), D.updated_at.desc().nullslast(), D.id.desc())
    elif sort == "title":
        query = query.order_by(D.title.asc(), D.id.desc())
    elif sort == "created":
        query = query.order_by(D.created_at.desc().nullslast(), D.id.desc())
    else:
        query = query.order_by(D.updated_at.desc().nullslast(), D.id.desc())
    return query.offset(skip).limit(limit).all()


def count_docs(
    db: Session,
    space_id: Optional[int] = None,
    project_id: Optional[int] = None,
    folder_id: Optional[int] = None,
    classification: Optional[str] = None,
    status: Optional[str] = None,
    tag: Optional[str] = None,
    q: Optional[str] = None,
    include_global: bool = False,
    global_only: bool = False,
    pinned_only: bool = False,
    visited_only: bool = False,
    user_id: Optional[int] = None,
) -> int:
    conds = _doc_filter_conditions(
        space_id, project_id, folder_id, classification, status, tag, q, include_global, global_only,
    )
    query = db.query(func.count(models.Doc.id)).filter(*conds)
    if user_id is not None and pinned_only:
        query = query.join(
            models.DocPin,
            (models.DocPin.doc_id == models.Doc.id) & (models.DocPin.user_id == user_id),
        )
    if user_id is not None and visited_only:
        query = query.join(
            models.DocVisit,
            (models.DocVisit.doc_id == models.Doc.id) & (models.DocVisit.user_id == user_id),
        )
    return query.scalar() or 0


def set_doc_pin(db: Session, doc_id: int, user_id: int, pinned: bool) -> bool:
    pin = (
        db.query(models.DocPin)
        .filter(models.DocPin.doc_id == doc_id, models.DocPin.user_id == user_id)
        .first()
    )
    if pinned and pin is None:
        db.add(models.DocPin(doc_id=doc_id, user_id=user_id))
    elif not pinned and pin is not None:
        db.delete(pin)
    safe_commit(db)
    return pinned


def _doc_tag_set(value: Optional[str]) -> set:
    return {t.strip().lower() for t in (value or "").split(",") if t.strip()}


_DOC_TOPIC_STOPWORDS: set[str] = {
    "a", "an", "and", "are", "as", "at", "be", "by", "can", "for", "from",
    "how", "in", "into", "is", "it", "of", "on", "or", "that", "the", "this",
    "to", "with", "when", "where", "will",
}


def _doc_topic_tokens(value: Optional[str]) -> set[str]:
    from .services.similarity_service import normalize_text, _tokens

    return {
        token for token in _tokens(normalize_text(value or ""))
        if len(token) > 2 and token not in _DOC_TOPIC_STOPWORDS
    }


def _doc_topic_score(source_tokens: set[str], candidate_tokens: set[str]) -> float:
    if not source_tokens or not candidate_tokens:
        return 0.0
    overlap = source_tokens & candidate_tokens
    if not overlap:
        return 0.0
    coverage = len(overlap) / min(len(source_tokens), len(candidate_tokens))
    jaccard = len(overlap) / len(source_tokens | candidate_tokens)
    return max(jaccard, coverage * 0.72)


def suggest_docs(
    db: Session,
    doc: models.Doc,
    exclude_ids: Optional[List[int]] = None,
    limit: int = 6,
    candidate_cap: int = 400,
) -> List[tuple]:
    """Rank docs similar to ``doc`` by blending tag overlap, title similarity and
    body similarity (reuses the test-case similarity helpers). Candidates are the
    doc's project + global docs (all readable by anyone who can read the source),
    capped for scalability. Returns ``[(score, row, matched_tags), …]``."""
    from .services.similarity_service import normalize_text, _tokens, _jaccard

    src_title = _tokens(normalize_text(doc.title))
    src_tags = _doc_tag_set(doc.tags)
    src_content = _tokens(normalize_text((doc.content_markdown or "")[:4000]))

    D = models.Doc
    scope = (
        or_(D.project_id == doc.project_id, D.project_id.is_(None))
        if doc.project_id is not None
        else D.project_id.is_(None)
    )
    rows = (
        db.query(
            D.id, D.uuid, D.title, D.slug, D.space_id, D.project_id,
            D.classification, D.status, D.tags, D.current_version,
            func.substr(func.coalesce(D.content_markdown, ""), 1, 2000).label("content"),
        )
        .filter(scope, D.id != doc.id)
        .filter(D.status != models.DocStatus.ARCHIVED)
        .limit(candidate_cap)
        .all()
    )

    excluded = set(exclude_ids or [])
    src_tags_fs = frozenset(src_tags)
    scored: List[tuple] = []
    for r in rows:
        if r.id in excluded:
            continue
        cand_tags = _doc_tag_set(r.tags)
        tag_score = _jaccard(src_tags_fs, frozenset(cand_tags)) if (src_tags or cand_tags) else 0.0
        title_score = _jaccard(src_title, _tokens(normalize_text(r.title)))
        content_score = _jaccard(src_content, _tokens(normalize_text(r.content or "")))
        score = 0.45 * tag_score + 0.30 * title_score + 0.25 * content_score
        if score <= 0.0:
            continue
        matched_tags = sorted(src_tags & cand_tags)
        scored.append((score, r, matched_tags))

    scored.sort(key=lambda item: item[0], reverse=True)
    return scored[:limit]


def find_duplicate_docs(
    db: Session,
    doc: models.Doc,
    limit: int = 5,
    min_score: float = 0.42,
) -> List[tuple]:
    """Find likely duplicate docs covering the same topic under different
    titles. Uses the same cheap similarity inputs as related suggestions, but
    applies a stricter threshold and hides already-related docs."""
    from .services.similarity_service import normalize_text, _jaccard

    if doc.status == models.DocStatus.ARCHIVED:
        return []
    related_ids = {
        row.related_doc_id
        for row in db.query(models.DocRelatedLink.related_doc_id)
        .filter(models.DocRelatedLink.doc_id == doc.id)
        .all()
    }
    related_ids.update(
        row.doc_id
        for row in db.query(models.DocRelatedLink.doc_id)
        .filter(models.DocRelatedLink.related_doc_id == doc.id)
        .all()
    )
    normalized_title = normalize_text(doc.title)
    source_title_tokens = _doc_topic_tokens(doc.title)
    source_body_tokens = _doc_topic_tokens((doc.content_markdown or "")[:6000])
    source_topic_tokens = source_title_tokens | source_body_tokens | _doc_tag_set(doc.tags)
    candidates = suggest_docs(db, doc, exclude_ids=list(related_ids), limit=250)
    result: List[tuple] = []
    for score, row, matched_tags in candidates:
        if normalize_text(row.title) == normalized_title:
            continue
        candidate_title_tokens = _doc_topic_tokens(row.title)
        candidate_body_tokens = _doc_topic_tokens(row.content or "")
        topic_score = _doc_topic_score(
            source_topic_tokens,
            candidate_title_tokens | candidate_body_tokens | _doc_tag_set(row.tags),
        )
        body_score = _jaccard(source_body_tokens, candidate_body_tokens) if (source_body_tokens or candidate_body_tokens) else 0.0
        title_score = _jaccard(source_title_tokens, candidate_title_tokens) if (source_title_tokens or candidate_title_tokens) else 0.0
        final_score = max(score, (0.58 * topic_score) + (0.28 * body_score) + (0.14 * title_score))
        if final_score < min_score:
            continue
        reasons = []
        if matched_tags:
            reasons.append("shared_tags")
        if topic_score >= 0.5 or body_score >= 0.45:
            reasons.append("same_topic")
        if title_score < 0.2:
            reasons.append("different_title")
        if final_score >= 0.65:
            reasons.append("high_similarity")
        elif final_score >= 0.5:
            reasons.append("similar_topic")
        else:
            reasons.append("possible_overlap")
        result.append((final_score, row, matched_tags, reasons))
        if len(result) >= limit:
            break
    return result


def _split_tags(value: Optional[str]) -> List[str]:
    seen = set()
    tags = []
    for tag in (value or "").split(","):
        cleaned = tag.strip()
        key = cleaned.lower()
        if cleaned and key not in seen:
            seen.add(key)
            tags.append(cleaned)
    return tags


def _merge_tags(a: Optional[str], b: Optional[str]) -> Optional[str]:
    tags = _split_tags(a)
    seen = {tag.lower() for tag in tags}
    for tag in _split_tags(b):
        if tag.lower() not in seen:
            seen.add(tag.lower())
            tags.append(tag)
    return ", ".join(tags) if tags else None


def _append_merged_content(target: models.Doc, source: models.Doc, note: Optional[str]) -> str:
    parts = [(target.content_markdown or "").rstrip()]
    source_body = (source.content_markdown or "").strip()
    safe_source_title = (source.title or f"Document #{source.id}").strip()
    if source_body:
        heading = f"## Merged from {safe_source_title}"
        block = f"{heading}\n\n{source_body}"
        if note:
            block = f"{heading}\n\n> Merge note: {note.strip()}\n\n{source_body}"
        parts.append(block)
    elif note:
        parts.append(f"## Merged from {safe_source_title}\n\n> Merge note: {note.strip()}")
    return "\n\n".join(part for part in parts if part).strip()


def _archive_source_content(source: models.Doc, target: models.Doc, note: Optional[str]) -> str:
    lines = [
        f"> This document was merged into [{target.title}](../{target.id}).",
    ]
    if note:
        lines.append(f"> Merge note: {note.strip()}")
    previous = (source.content_markdown or "").strip()
    if previous:
        lines.extend(["", "## Previous content", "", previous])
    return "\n".join(lines).strip()


def _transfer_unique_link(
    db: Session,
    model: Any,
    source_doc_id: int,
    target_doc_id: int,
    source_field: str,
    target_field: str,
) -> dict[str, int]:
    moved = 0
    skipped = 0
    rows = db.query(model).filter(getattr(model, source_field) == source_doc_id).all()
    for row in rows:
        other_id = getattr(row, target_field)
        if other_id == target_doc_id:
            db.delete(row)
            skipped += 1
            continue
        exists = (
            db.query(model.id)
            .filter(getattr(model, source_field) == target_doc_id, getattr(model, target_field) == other_id)
            .first()
        )
        if exists:
            db.delete(row)
            skipped += 1
            continue
        setattr(row, source_field, target_doc_id)
        moved += 1
    return {"moved": moved, "skipped": skipped}


def _preserved_reference_count(transferred: dict[str, int]) -> int:
    return sum(value for key, value in transferred.items() if key != "skipped_duplicates")


def merge_duplicate_doc(
    db: Session,
    target: models.Doc,
    source: models.Doc,
    actor_id: int,
    note: Optional[str] = None,
) -> dict:
    """Merge ``source`` into ``target`` and archive the source while preserving
    references as much as possible. Caller owns permission checks."""
    if target.id == source.id:
        raise ValueError("Cannot merge a document into itself")
    if target.status == models.DocStatus.ARCHIVED:
        raise ValueError("Cannot merge into an archived document")
    if source.status == models.DocStatus.ARCHIVED:
        raise ValueError("Cannot merge an already archived document")

    transferred = {
        "requirement_links": 0,
        "related_links": 0,
        "pins": 0,
        "visits": 0,
        "feedback": 0,
        "skipped_duplicates": 0,
    }

    target.content_markdown = _append_merged_content(target, source, note)
    target.tags = _merge_tags(target.tags, source.tags)
    if not target.classification and source.classification:
        target.classification = source.classification
    target.updated_by = actor_id

    for link in db.query(models.DocRequirementLink).filter(models.DocRequirementLink.doc_id == source.id).all():
        exists = (
            db.query(models.DocRequirementLink.id)
            .filter(
                models.DocRequirementLink.doc_id == target.id,
                models.DocRequirementLink.requirement_id == link.requirement_id,
            )
            .first()
        )
        if exists:
            db.delete(link)
            transferred["skipped_duplicates"] += 1
            continue
        link.doc_id = target.id
        transferred["requirement_links"] += 1

    related_outgoing = _transfer_unique_link(
        db, models.DocRelatedLink, source.id, target.id, "doc_id", "related_doc_id",
    )
    related_incoming = _transfer_unique_link(
        db, models.DocRelatedLink, source.id, target.id, "related_doc_id", "doc_id",
    )
    transferred["related_links"] += related_outgoing["moved"] + related_incoming["moved"]
    transferred["skipped_duplicates"] += related_outgoing["skipped"] + related_incoming["skipped"]

    for pin in db.query(models.DocPin).filter(models.DocPin.doc_id == source.id).all():
        existing = (
            db.query(models.DocPin)
            .filter(models.DocPin.doc_id == target.id, models.DocPin.user_id == pin.user_id)
            .first()
        )
        if existing:
            db.delete(pin)
            transferred["skipped_duplicates"] += 1
            continue
        pin.doc_id = target.id
        transferred["pins"] += 1

    for visit in db.query(models.DocVisit).filter(models.DocVisit.doc_id == source.id).all():
        existing = (
            db.query(models.DocVisit)
            .filter(models.DocVisit.doc_id == target.id, models.DocVisit.user_id == visit.user_id)
            .first()
        )
        if existing:
            existing.visit_count = (existing.visit_count or 0) + (visit.visit_count or 0)
            if visit.first_visited_at and (not existing.first_visited_at or visit.first_visited_at < existing.first_visited_at):
                existing.first_visited_at = visit.first_visited_at
            if visit.last_visited_at and (not existing.last_visited_at or visit.last_visited_at > existing.last_visited_at):
                existing.last_visited_at = visit.last_visited_at
            db.delete(visit)
            transferred["visits"] += 1
            continue
        visit.doc_id = target.id
        transferred["visits"] += 1

    for feedback in db.query(models.DocFeedback).filter(models.DocFeedback.doc_id == source.id).all():
        existing = (
            db.query(models.DocFeedback)
            .filter(models.DocFeedback.doc_id == target.id, models.DocFeedback.user_id == feedback.user_id)
            .first()
        )
        if existing:
            db.delete(feedback)
            transferred["skipped_duplicates"] += 1
            continue
        feedback.doc_id = target.id
        transferred["feedback"] += 1

    source.status = models.DocStatus.ARCHIVED
    source.content_markdown = _archive_source_content(source, target, note)
    source.updated_by = actor_id

    record_doc_version(db, target, action="updated", actor_id=actor_id, change_note=f"Merged duplicate doc #{source.id}", commit=False)
    record_doc_version(db, source, action="updated", actor_id=actor_id, change_note=f"Merged into doc #{target.id}", commit=False)

    try:
        safe_commit(db)
    except IntegrityError:
        db.rollback()
        raise
    db.refresh(target)
    db.refresh(source)
    return {
        "target": target,
        "source": source,
        "transferred": transferred,
        "preserved_reference_count": _preserved_reference_count(transferred),
    }


def doc_facets(
    db: Session,
    space_id: Optional[int] = None,
    project_id: Optional[int] = None,
    include_global: bool = False,
    global_only: bool = False,
) -> dict:
    """Distinct tag + classification counts for the scope, without loading bodies.

    Only the small ``tags`` / ``classification`` columns are read, so this stays
    cheap even with many large documents."""
    conds = _doc_filter_conditions(
        space_id, project_id, None, None, None, None, None, include_global, global_only,
    )
    tag_counts: dict = {}
    for (tags,) in db.query(models.Doc.tags).filter(*conds).all():
        for tag in (tags or "").split(","):
            cleaned = tag.strip()
            if cleaned:
                tag_counts[cleaned] = tag_counts.get(cleaned, 0) + 1
    class_rows = (
        db.query(models.Doc.classification, func.count(models.Doc.id))
        .filter(*conds, models.Doc.classification.isnot(None), models.Doc.classification != "")
        .group_by(models.Doc.classification)
        .all()
    )
    sort_key = lambda kv: (-kv[1], kv[0].lower())
    return {
        "tags": [{"value": k, "count": v} for k, v in sorted(tag_counts.items(), key=sort_key)],
        "classifications": [{"value": c, "count": n} for c, n in sorted(class_rows, key=sort_key)],
    }


def stats_overview(
    db: Session,
    space_id: Optional[int] = None,
    project_id: Optional[int] = None,
    include_global: bool = False,
    global_only: bool = False,
    most_viewed_limit: int = 8,
) -> dict:
    """Aggregate read statistics for an admin dashboard, scoped exactly like
    ``list_docs``/``doc_facets``. Returns totals, a per-status breakdown and the
    most-viewed docs — all from the small metadata columns (no bodies loaded)."""
    D = models.Doc
    conds = _doc_filter_conditions(
        space_id, project_id, None, None, None, None, None, include_global, global_only,
    )

    total_docs = db.query(func.count(D.id)).filter(*conds).scalar() or 0
    total_views = db.query(func.coalesce(func.sum(D.view_count), 0)).filter(*conds).scalar() or 0
    unique_visitors = (
        db.query(func.count(distinct(models.DocVisit.user_id)))
        .join(D, D.id == models.DocVisit.doc_id)
        .filter(*conds)
        .scalar()
        or 0
    )

    status_rows = (
        db.query(D.status, func.count(D.id))
        .filter(*conds)
        .group_by(D.status)
        .all()
    )
    by_status = {getattr(s, "value", s): n for s, n in status_rows}

    most_viewed_rows = (
        db.query(
            D.id, D.title, D.space_id, D.project_id, D.status,
            D.view_count, D.last_viewed_at,
        )
        .filter(*conds, func.coalesce(D.view_count, 0) > 0)
        .order_by(desc(D.view_count), D.id.desc())
        .limit(most_viewed_limit)
        .all()
    )
    most_viewed = [
        {
            "id": r.id,
            "title": r.title,
            "space_id": r.space_id,
            "project_id": r.project_id,
            "status": getattr(r.status, "value", r.status),
            "view_count": r.view_count or 0,
            "last_viewed_at": r.last_viewed_at,
        }
        for r in most_viewed_rows
    ]

    return {
        "total_docs": total_docs,
        "total_views": int(total_views),
        "unique_visitors": unique_visitors,
        "by_status": by_status,
        "most_viewed": most_viewed,
    }


def create_doc(db: Session, payload: schemas.DocCreate, actor_id: int, commit: bool = True) -> models.Doc:
    space = get_space(db, payload.space_id)
    project_id = space.project_id if space else None
    doc = models.Doc(
        uuid=str(uuid.uuid4()),
        title=payload.title,
        slug=_unique_doc_slug(db, payload.space_id, slugify(payload.title)),
        content_markdown=payload.content_markdown or "",
        space_id=payload.space_id,
        folder_id=payload.folder_id,
        project_id=project_id,
        classification=payload.classification,
        status=payload.status,
        tags=payload.tags,
        dir=payload.dir or "auto",
        language=payload.language,
        created_by=actor_id,
        updated_by=actor_id,
    )
    db.add(doc)
    db.flush()
    record_doc_version(db, doc, action="created", actor_id=actor_id, change_note="Created", commit=False)
    if commit:
        safe_commit(db)
        db.refresh(doc)
    return doc


def update_doc(db: Session, doc: models.Doc, payload: schemas.DocUpdate, actor_id: int) -> models.Doc:
    data = payload.model_dump(exclude_unset=True)
    change_note = data.pop("change_note", None)

    # Moving to a different space re-homes the doc and refreshes project scope/slug.
    if "space_id" in data and data["space_id"] != doc.space_id:
        new_space = get_space(db, data["space_id"])
        if new_space is not None:
            doc.project_id = new_space.project_id
            doc.slug = _unique_doc_slug(db, new_space.id, slugify(doc.title), exclude_id=doc.id)
            if "folder_id" not in data:
                data["folder_id"] = None

    if "title" in data and data["title"] and data["title"] != doc.title:
        doc.slug = _unique_doc_slug(db, data.get("space_id", doc.space_id), slugify(data["title"]), exclude_id=doc.id)

    for field, value in data.items():
        setattr(doc, field, value)
    doc.updated_by = actor_id
    record_doc_version(db, doc, action="updated", actor_id=actor_id, change_note=change_note, commit=False)
    safe_commit(db)
    db.refresh(doc)
    return doc


def delete_doc(db: Session, doc: models.Doc) -> None:
    db.delete(doc)
    safe_commit(db)
