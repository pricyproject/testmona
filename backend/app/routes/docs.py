"""Doc Hub routes — Docs-as-Code documentation.

Spaces (repositories), folders, docs (canonical Markdown), version history,
the doc→requirement converter, and Markdown import/export (single file + zip
bundle).

Route ordering matters: literal paths (``/docs/spaces``, ``/docs/folders``,
``/docs/import``) are registered before the dynamic ``/docs/{doc_id}`` routes so
they are never parsed as an integer id (the documented FastAPI gotcha).
"""

from __future__ import annotations

import io
import logging
import os
import re
import uuid
import zipfile
from datetime import datetime, timezone
from typing import List, Optional

import yaml
from fastapi import Depends, File, Form, HTTPException, Path, Query, Request, Response, UploadFile
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from .. import crud, crud_docs, models, rbac, schemas
from ..feature_guard import require_project_feature
from ..features import is_feature_enabled
from ..auth import get_current_active_user
from ..database import get_db
from ..services import doc_conversion_service as conv
from ..services import doc_impact_service
from ..services import doc_release_notes_service as release_notes
from .project_ai_chat import _cancel_on_disconnect
from ..services.ai_manager import AICompletionRequest, generate_ai_completion, get_ai_manager_status
from ..services.ai_prompt_service import (
    build_doc_impact_prompt,
    build_release_notes_prompt,
    clean_ai_text,
    extract_json_object,
)
from ..services.mentions import project_member_users, resolve_mentions

logger = logging.getLogger(__name__)

def _positive_int_env(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        logger.warning("Invalid %s value; using default %s", name, default)
        return default
    if value <= 0:
        logger.warning("Non-positive %s value; using default %s", name, default)
        return default
    return value


DOC_IMPORT_MAX_BYTES = _positive_int_env("DOC_IMPORT_MAX_BYTES", 10 * 1024 * 1024)
DOC_IMPORT_MAX_FILES = _positive_int_env("DOC_IMPORT_MAX_FILES", 200)
_MARKDOWN_EXTENSIONS = (".md", ".markdown")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_aware(value: Optional[datetime]) -> Optional[datetime]:
    """Treat naive DB timestamps as UTC so expiry comparisons are correct."""
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


# --------------------------------------------------------------------------- #
# Access helpers                                                              #
# --------------------------------------------------------------------------- #

def _can_access(user: models.User, project_id: Optional[int], permission: str, db: Session) -> bool:
    """Authorize an action on a doc/space. Global (``project_id`` None) items are
    readable by any authenticated user and writable per the user's global role;
    project items defer to the project's RBAC."""
    if project_id is None:
        if permission == "read":
            return True
        return rbac.has_global_permission(user, "manage_projects")
    return rbac.has_permission(user, permission, project_id, db)


def _require(user: models.User, project_id: Optional[int], permission: str, db: Session) -> None:
    if not _can_access(user, project_id, permission, db):
        raise HTTPException(status_code=403, detail="Insufficient permissions")


def _is_admin(user: models.User) -> bool:
    return bool(getattr(user, "is_superuser", False)) or rbac.is_role(user, models.Role.ADMIN)


def _notify_doc_mentions(
    db: Session,
    doc: models.Doc,
    actor: models.User,
    previous_markdown: Optional[str],
) -> None:
    """Best-effort notifications for @mentions added to a doc's body.

    Only project-scoped docs notify (global docs have no member audience). We
    diff against the previous content so the frequent autosaves from the editor
    never re-notify a user who was already mentioned. Never raises into the
    request — mirrors ``_notify_comment`` in the requirements feature."""
    if doc.project_id is None:
        return
    try:
        members = project_member_users(db, doc.project_id)
        if not members:
            return
        new_ids = resolve_mentions(doc.content_markdown or "", members)
        already = resolve_mentions(previous_markdown or "", members)
        recipients = new_ids - already - {actor.id}
        if not recipients:
            return

        actor_name = actor.full_name or actor.username
        title = "You were mentioned"
        for uid in recipients:
            crud.create_notification(
                db,
                schemas.NotificationCreate(
                    user_id=uid,
                    title=title,
                    message=f'{actor_name} mentioned you in "{doc.title}"',
                    type=models.NotificationType.INFO,
                    related_entity_type="doc",
                    related_entity_id=doc.id,
                ),
            )
    except Exception:
        logger.exception("Failed to create doc mention notifications for doc %s", doc.id)


def _notify_doc_feedback(
    db: Session,
    doc: models.Doc,
    actor: models.User,
    feedback_type: str,
    comment: Optional[str],
) -> None:
    """Notify the doc's responsible editors about actionable reader feedback."""
    if feedback_type == "helpful":
        return
    try:
        recipients = {uid for uid in (doc.created_by, doc.updated_by) if uid and uid != actor.id}
        if not recipients:
            return
        actor_name = actor.full_name or actor.username or actor.email
        labels = {
            "not_helpful": "not helpful",
            "clarification": "needs clarification",
            "outdated": "may be outdated",
        }
        feedback_label = labels.get(feedback_type, feedback_type.replace("_", " "))
        detail = f": {comment[:180]}" if comment else ""
        for uid in recipients:
            crud.create_notification(
                db,
                schemas.NotificationCreate(
                    user_id=uid,
                    title="Document feedback",
                    message=f'{actor_name} marked "{doc.title}" as {feedback_label}{detail}',
                    type=models.NotificationType.INFO,
                    related_entity_type="doc",
                    related_entity_id=doc.id,
                ),
            )
    except Exception:
        logger.exception("Failed to create doc feedback notifications for doc %s", doc.id)


def _get_space_or_404(db: Session, space_id: int) -> models.DocSpace:
    space = crud_docs.get_space(db, space_id)
    if space is None:
        raise HTTPException(status_code=404, detail="Doc space not found")
    return space


def _get_doc_or_404(db: Session, doc_id: int) -> models.Doc:
    doc = crud_docs.get_doc(db, doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Doc not found")
    return doc


def _author(user: Optional[models.User]) -> Optional[schemas.DocVersionAuthor]:
    if user is None:
        return None
    return schemas.DocVersionAuthor(id=user.id, username=user.username, full_name=user.full_name)


def _doc_out(doc: models.Doc, user: models.User, db: Session) -> schemas.Doc:
    """Serialize a doc with the current user's capability flags."""
    out = schemas.Doc.model_validate(doc)
    visit = (
        db.query(models.DocVisit)
        .filter(models.DocVisit.doc_id == doc.id, models.DocVisit.user_id == user.id)
        .first()
    )
    out.my_last_visited_at = visit.last_visited_at if visit else None
    out.is_pinned = (
        db.query(models.DocPin.id)
        .filter(models.DocPin.doc_id == doc.id, models.DocPin.user_id == user.id)
        .first()
        is not None
    )
    out.can_edit = _can_access(user, doc.project_id, "write", db)
    out.can_delete = _can_access(user, doc.project_id, "delete", db)
    out.can_share = out.can_edit
    out.can_view_stats = _is_admin(user)
    if not out.can_view_stats:
        out.view_count = None
        out.last_viewed_at = None
    return out


def _feedback_view(feedback: models.DocFeedback) -> schemas.DocFeedbackView:
    user = getattr(feedback, "user", None)
    return schemas.DocFeedbackView(
        id=feedback.id,
        doc_id=feedback.doc_id,
        user_id=feedback.user_id,
        feedback_type=feedback.feedback_type,
        comment=feedback.comment,
        section_text=feedback.section_text,
        resolved=bool(feedback.resolved),
        created_at=feedback.created_at,
        updated_at=feedback.updated_at,
        user=schemas.DocFeedbackUser.model_validate(user) if user is not None else None,
    )


def _feedback_summary(db: Session, doc_id: int, user_id: int) -> schemas.DocFeedbackSummary:
    rows = (
        db.query(models.DocFeedback.feedback_type, func.count(models.DocFeedback.id))
        .filter(models.DocFeedback.doc_id == doc_id)
        .group_by(models.DocFeedback.feedback_type)
        .all()
    )
    counts = {key: int(value or 0) for key, value in rows}
    unresolved = (
        db.query(func.count(models.DocFeedback.id))
        .filter(
            models.DocFeedback.doc_id == doc_id,
            models.DocFeedback.resolved.is_(False),
            models.DocFeedback.feedback_type.in_(["not_helpful", "clarification", "outdated"]),
        )
        .scalar()
        or 0
    )
    mine = (
        db.query(models.DocFeedback)
        .options(joinedload(models.DocFeedback.user))
        .filter(models.DocFeedback.doc_id == doc_id, models.DocFeedback.user_id == user_id)
        .first()
    )
    return schemas.DocFeedbackSummary(
        doc_id=doc_id,
        helpful=counts.get("helpful", 0),
        not_helpful=counts.get("not_helpful", 0),
        clarification=counts.get("clarification", 0),
        outdated=counts.get("outdated", 0),
        unresolved=unresolved,
        my_feedback=_feedback_view(mine) if mine else None,
    )


def _apply_feedback_payload(feedback: models.DocFeedback, payload: schemas.DocFeedbackCreate) -> None:
    feedback.feedback_type = payload.feedback_type
    feedback.comment = payload.comment
    feedback.section_text = payload.section_text
    feedback.resolved = False


def _record_visit(db: Session, doc: models.Doc, user: models.User) -> None:
    now = _utcnow()
    doc.view_count = (doc.view_count or 0) + 1
    doc.last_viewed_at = now
    visit = (
        db.query(models.DocVisit)
        .filter(models.DocVisit.doc_id == doc.id, models.DocVisit.user_id == user.id)
        .first()
    )
    if visit is None:
        visit = models.DocVisit(doc_id=doc.id, user_id=user.id, visit_count=1, first_visited_at=now, last_visited_at=now)
        db.add(visit)
    else:
        visit.visit_count = (visit.visit_count or 0) + 1
        visit.last_visited_at = now
    try:
        crud.safe_commit(db)
        db.refresh(doc)
    except Exception as exc:
        db.rollback()
        logger.warning("Could not record doc visit for doc %s/user %s: %s", doc.id, user.id, exc)


def _validate_folder_in_space(db: Session, folder_id: Optional[int], space_id: int) -> None:
    """A doc's (or sub-folder's) folder must belong to the same space."""
    if folder_id is None:
        return
    folder = crud_docs.get_folder(db, folder_id)
    if folder is None or folder.space_id != space_id:
        raise HTTPException(status_code=400, detail="Folder does not belong to this space")


def _validate_folder_parent(
    db: Session,
    folder: models.DocFolder,
    parent_folder_id: Optional[int],
) -> None:
    if parent_folder_id is None:
        return
    if parent_folder_id == folder.id:
        raise HTTPException(status_code=400, detail="Folder cannot be its own parent")
    parent = crud_docs.get_folder(db, parent_folder_id)
    if parent is None or parent.space_id != folder.space_id:
        raise HTTPException(status_code=400, detail="Parent folder must belong to the same space")

    seen = {folder.id}
    current = parent
    while current is not None:
        if current.id in seen:
            raise HTTPException(status_code=400, detail="Folder parent would create a cycle")
        seen.add(current.id)
        current = crud_docs.get_folder(db, current.parent_folder_id) if current.parent_folder_id else None


def _share_active(doc: models.Doc) -> bool:
    if doc.share_scope != "public" or not doc.public_id:
        return False
    expires = _as_aware(doc.share_expires_at)
    return expires is None or expires > _utcnow()


_HTML_TAG_RE = re.compile(r"<[^>]+>")
_TABLE_SEP_RE = re.compile(r"^\s*\|?[\s:|-]*-{2,}[\s:|-]*\|?\s*$", re.MULTILINE)
_MD_STRIP_RE = re.compile(r"[#*_`>~\-\[\]\(\)!]|https?://\S+")


def _excerpt(md: Optional[str], limit: int = 200) -> str:
    """Plain-text preview for hub cards: strip raw HTML (e.g. resized tables),
    Markdown table scaffolding, and leftover Markdown punctuation."""
    text = _HTML_TAG_RE.sub(" ", md or "")   # drop raw HTML blocks (tables, etc.)
    text = _TABLE_SEP_RE.sub(" ", text)      # drop GFM separator rows (|---|---|)
    text = text.replace("|", " ")            # flatten remaining table cell pipes
    text = _MD_STRIP_RE.sub(" ", text)       # strip Markdown punctuation
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit]


def _space_view(space: models.DocSpace, doc_count: int = 0) -> schemas.DocSpace:
    return schemas.DocSpace(
        id=space.id,
        uuid=space.uuid,
        name=space.name,
        slug=space.slug,
        description=space.description,
        classification=space.classification,
        icon=space.icon,
        color=space.color,
        project_id=space.project_id,
        order_index=space.order_index or 0,
        doc_count=doc_count,
        created_by=space.created_by,
        created_at=space.created_at,
        updated_at=space.updated_at,
    )


def _list_item(doc: models.Doc) -> schemas.DocListItem:
    return schemas.DocListItem(
        id=doc.id,
        uuid=doc.uuid,
        title=doc.title,
        slug=doc.slug,
        space_id=doc.space_id,
        folder_id=doc.folder_id,
        project_id=doc.project_id,
        classification=doc.classification,
        status=doc.status,
        tags=doc.tags,
        dir=doc.dir,
        language=doc.language,
        excerpt=_excerpt(doc.content_markdown),
        current_version=doc.current_version or 0,
        share_scope=doc.share_scope or "private",
        view_count=None,
        last_viewed_at=None,
        is_pinned=False,
        created_by=doc.created_by,
        updated_by=doc.updated_by,
        created_at=doc.created_at,
        updated_at=doc.updated_at,
    )


# --------------------------------------------------------------------------- #
# Markdown front-matter (import/export)                                        #
# --------------------------------------------------------------------------- #

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", re.DOTALL)


def _parse_frontmatter(text: str) -> tuple[dict, str]:
    m = _FRONTMATTER_RE.match(text or "")
    if not m:
        return {}, text or ""
    try:
        meta = yaml.safe_load(m.group(1)) or {}
        if not isinstance(meta, dict):
            meta = {}
    except Exception:
        meta = {}
    return meta, m.group(2)


def _first_h1(md: str) -> Optional[str]:
    for line in (md or "").splitlines():
        m = re.match(r"^#\s+(.+?)\s*#*\s*$", line)
        if m:
            return m.group(1).strip()
    return None


def _build_markdown_export(doc: models.Doc) -> str:
    meta = {
        "title": doc.title,
        "status": getattr(doc.status, "value", doc.status),
        "version": doc.current_version or 0,
    }
    if doc.classification:
        meta["classification"] = doc.classification
    if doc.tags:
        meta["tags"] = doc.tags
    if doc.dir and doc.dir != "auto":
        meta["dir"] = doc.dir
    front = yaml.safe_dump(meta, sort_keys=False, allow_unicode=True).strip()
    return f"---\n{front}\n---\n\n{doc.content_markdown or ''}\n"


def _safe_filename(name: str) -> str:
    base = crud_docs.slugify(name) or "doc"
    return f"{base}.md"


def _is_markdown_filename(filename: str) -> bool:
    return filename.lower().endswith(_MARKDOWN_EXTENSIONS)


def _validate_import_size(raw: bytes) -> None:
    if len(raw) > DOC_IMPORT_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Import file is too large")


def _safe_zip_member_name(filename: str) -> str:
    raw = filename or ""
    if raw.startswith(("/", "\\")) or re.match(r"^[A-Za-z]:[\\/]", raw):
        raise HTTPException(status_code=400, detail="Zip contains an unsafe file path")
    normalized = raw.replace("\\", "/").strip("/")
    parts = [part for part in normalized.split("/") if part]
    if not parts or any(part in {".", ".."} for part in parts):
        raise HTTPException(status_code=400, detail="Zip contains an unsafe file path")
    return "/".join(parts)


# --------------------------------------------------------------------------- #
# Change impact analysis helpers                                              #
# --------------------------------------------------------------------------- #

_IMPACT_AREAS = {"requirements", "tests", "defects", "general"}
_IMPACT_SEVERITIES = {"low", "medium", "high"}
_IMPACT_RECOMMENDATIONS = {"publish", "review", "hold"}


def _impact_item(item: doc_impact_service.ImpactItem) -> schemas.DocImpactItem:
    return schemas.DocImpactItem(
        type=item.type, id=item.id, key=item.key, title=item.title,
        reason=item.reason, score=item.score, status=item.status,
        severity=item.severity, is_open=item.is_open, via=item.via,
    )


def _parse_impact_ai(content: str) -> tuple[str, str, List[schemas.DocImpactRisk]]:
    """Parse + clamp the AI risk JSON. Raises on unparseable content so the
    caller can record the failure and fall back to the deterministic graph."""
    parsed = extract_json_object(content)
    summary = clean_ai_text(parsed.get("summary"), 1000)
    recommendation = str(parsed.get("recommendation") or "review").strip().lower()
    if recommendation not in _IMPACT_RECOMMENDATIONS:
        recommendation = "review"
    risks: List[schemas.DocImpactRisk] = []
    for raw in (parsed.get("risks") or [])[:20]:
        if not isinstance(raw, dict):
            continue
        title = clean_ai_text(raw.get("title"), 200)
        if not title:
            continue
        area = str(raw.get("area") or "general").strip().lower()
        severity = str(raw.get("severity") or "medium").strip().lower()
        risks.append(schemas.DocImpactRisk(
            area=area if area in _IMPACT_AREAS else "general",
            severity=severity if severity in _IMPACT_SEVERITIES else "medium",
            title=title,
            detail=clean_ai_text(raw.get("detail"), 1000),
            mitigation=clean_ai_text(raw.get("mitigation"), 1000),
        ))
    return summary, recommendation, risks


def _audit_doc_impact(db: Session, actor: models.User, doc: models.Doc) -> None:
    """Best-effort audit row for a change-impact analysis run.

    ``EntityType`` has no ``doc`` member, so the event is attributed to the
    project (mirroring the project AI chat audit), with the doc identified in
    the description. Global docs have no project to attribute to, so are skipped."""
    if doc.project_id is None:
        return
    try:
        from ..models import AuditAction, EntityType
        from ..schemas_audit import AuditTrailCreate
        from ..services.audit_service import get_audit_service

        get_audit_service(db).create_audit_trail(
            AuditTrailCreate(
                user_id=actor.id,
                action=AuditAction.EXECUTE.value,
                entity_type=EntityType.PROJECT.value,
                entity_id=doc.project_id,
                project_id=doc.project_id,
                description=f'Ran change impact analysis on doc {doc.id} "{doc.title}"',
            )
        )
    except Exception:  # pragma: no cover - audit must never break the request
        logger.exception("Failed to audit doc impact analysis for doc %s", doc.id)


def _release_entry(entry: release_notes.ReleaseEntry) -> schemas.ReleaseNotesEntry:
    return schemas.ReleaseNotesEntry(
        type=entry.type, id=entry.id, key=entry.key, title=entry.title,
        status=entry.status, severity=entry.severity, via_docs=entry.via_docs,
    )


def _release_source_schema(source: release_notes.ReleaseSource) -> schemas.ReleaseNotesSource:
    return schemas.ReleaseNotesSource(
        range_start=source.range_start,
        range_end=source.range_end,
        changed_docs=[
            schemas.ReleaseNotesChangedDoc(
                doc_id=d.doc_id, title=d.title, actions=d.actions, versions=d.versions,
                headings_added=d.headings_added, last_changed_at=d.last_changed_at,
            )
            for d in source.changed_docs
        ],
        requirements=[_release_entry(e) for e in source.requirements],
        resolved_defects=[_release_entry(e) for e in source.resolved_defects],
        open_defects=[_release_entry(e) for e in source.open_defects],
        coverage=schemas.ReleaseNotesCoverage(
            requirements_total=source.coverage.requirements_total,
            requirements_covered=source.coverage.requirements_covered,
            requirements_uncovered=source.coverage.requirements_uncovered,
            test_cases=source.coverage.test_cases,
            coverage_pct=source.coverage.coverage_pct,
        ),
    )


def _parse_release_summary(content: str) -> str:
    """Parse the AI summary JSON, clamped; raises on unparseable content."""
    parsed = extract_json_object(content)
    return clean_ai_text(parsed.get("summary"), 4000)


# --------------------------------------------------------------------------- #
# Routes                                                                       #
# --------------------------------------------------------------------------- #

def register_docs_routes(app) -> None:

    # ── Spaces ──────────────────────────────────────────────────────────────
    @app.get("/docs/spaces", response_model=List[schemas.DocSpace], tags=["Docs"])
    def list_doc_spaces(
        project_id: Optional[int] = Query(None, ge=1),
        include_global: bool = Query(True),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        if project_id is not None:
            _require(current_user, project_id, "read", db)
        spaces = crud_docs.list_spaces(db, project_id=project_id, include_global=include_global)
        counts = crud_docs.space_doc_counts(db)
        return [_space_view(s, counts.get(s.id, 0)) for s in spaces]

    @app.post("/docs/spaces", response_model=schemas.DocSpace, status_code=201, tags=["Docs"])
    def create_doc_space(
        payload: schemas.DocSpaceCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        if payload.project_id is not None:
            project = crud.get_project(db, payload.project_id)
            if project is None:
                raise HTTPException(status_code=404, detail="Project not found")
        _require(current_user, payload.project_id, "write", db)
        space = crud_docs.create_space(db, payload, actor_id=current_user.id)
        return _space_view(space, 0)

    @app.get("/docs/spaces/{space_id}", response_model=schemas.DocSpace, tags=["Docs"])
    def get_doc_space(
        space_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        space = _get_space_or_404(db, space_id)
        _require(current_user, space.project_id, "read", db)
        counts = crud_docs.space_doc_counts(db)
        return _space_view(space, counts.get(space.id, 0))

    @app.put("/docs/spaces/{space_id}", response_model=schemas.DocSpace, tags=["Docs"])
    def update_doc_space(
        payload: schemas.DocSpaceUpdate,
        space_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        space = _get_space_or_404(db, space_id)
        _require(current_user, space.project_id, "write", db)
        space = crud_docs.update_space(db, space, payload)
        counts = crud_docs.space_doc_counts(db)
        return _space_view(space, counts.get(space.id, 0))

    @app.delete("/docs/spaces/{space_id}", status_code=204, tags=["Docs"])
    def delete_doc_space(
        space_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        space = _get_space_or_404(db, space_id)
        _require(current_user, space.project_id, "delete", db)
        crud_docs.delete_space(db, space)
        return Response(status_code=204)

    # ── Folders ─────────────────────────────────────────────────────────────
    @app.get("/docs/folders", response_model=List[schemas.DocFolder], tags=["Docs"])
    def list_doc_folders(
        space_id: int = Query(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        space = _get_space_or_404(db, space_id)
        _require(current_user, space.project_id, "read", db)
        return crud_docs.list_folders(db, space_id)

    @app.post("/docs/folders", response_model=schemas.DocFolder, status_code=201, tags=["Docs"])
    def create_doc_folder(
        payload: schemas.DocFolderCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        space = _get_space_or_404(db, payload.space_id)
        _require(current_user, space.project_id, "write", db)
        # A parent folder, when given, must live in the same space.
        if payload.parent_folder_id is not None:
            parent = crud_docs.get_folder(db, payload.parent_folder_id)
            if parent is None or parent.space_id != space.id:
                raise HTTPException(status_code=400, detail="Parent folder must belong to the same space")
        return crud_docs.create_folder(db, payload)

    @app.put("/docs/folders/{folder_id}", response_model=schemas.DocFolder, tags=["Docs"])
    def update_doc_folder(
        payload: schemas.DocFolderUpdate,
        folder_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        folder = crud_docs.get_folder(db, folder_id)
        if folder is None:
            raise HTTPException(status_code=404, detail="Folder not found")
        space = _get_space_or_404(db, folder.space_id)
        _require(current_user, space.project_id, "write", db)
        if "parent_folder_id" in payload.model_fields_set:
            _validate_folder_parent(db, folder, payload.parent_folder_id)
        return crud_docs.update_folder(db, folder, payload)

    @app.delete("/docs/folders/{folder_id}", status_code=204, tags=["Docs"])
    def delete_doc_folder(
        folder_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        folder = crud_docs.get_folder(db, folder_id)
        if folder is None:
            raise HTTPException(status_code=404, detail="Folder not found")
        space = _get_space_or_404(db, folder.space_id)
        _require(current_user, space.project_id, "delete", db)
        crud_docs.delete_folder(db, folder)
        return Response(status_code=204)

    # ── Import (literal path, before /docs/{doc_id}) ────────────────────────
    @app.post("/docs/import", response_model=List[schemas.DocListItem], tags=["Docs"])
    async def import_docs(
        space_id: int = Form(...),
        folder_id: Optional[int] = Form(None),
        file: UploadFile = File(...),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        space = _get_space_or_404(db, space_id)
        _require(current_user, space.project_id, "write", db)
        _validate_folder_in_space(db, folder_id, space.id)
        raw = await file.read()
        _validate_import_size(raw)
        name = file.filename or "import.md"
        created: List[models.Doc] = []

        if name.lower().endswith(".zip"):
            try:
                created = _import_zip(db, space, raw, current_user.id)
                crud.safe_commit(db)
                for doc in created:
                    db.refresh(doc)
            except HTTPException:
                db.rollback()
                raise
            except Exception as exc:
                db.rollback()
                logger.exception("Unexpected doc import failure: %s", exc)
                raise HTTPException(status_code=500, detail="Could not import documents")
        elif _is_markdown_filename(name):
            created.append(_import_single_md(db, space, name, raw, folder_id, current_user.id))
        else:
            raise HTTPException(status_code=400, detail="Only Markdown files and zip bundles can be imported")

        return [_list_item(d) for d in created]

    # ── Public share viewer (no auth; literal path before /docs/{doc_id}) ────
    @app.get("/docs/public/{public_id}", response_model=schemas.DocPublicView, tags=["Docs"])
    def get_public_doc(
        public_id: str = Path(..., min_length=8, max_length=64),
        db: Session = Depends(get_db),
    ):
        doc = db.query(models.Doc).filter(models.Doc.public_id == public_id).first()
        if doc is None or not _share_active(doc):
            raise HTTPException(status_code=404, detail="This shared document is unavailable")
        return schemas.DocPublicView.model_validate(doc)

    # ── Facets (literal path, before /docs/{doc_id}) ────────────────────────
    @app.get("/docs/facets", response_model=schemas.DocFacets, tags=["Docs"])
    def get_doc_facets(
        space_id: Optional[int] = Query(None, ge=1),
        project_id: Optional[int] = Query(None, ge=1),
        include_global: bool = Query(False),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Distinct tag/classification values (with counts) for the filter panel,
        computed server-side so the client never downloads every doc."""
        if space_id is not None:
            space = _get_space_or_404(db, space_id)
            _require(current_user, space.project_id, "read", db)
        elif project_id is not None:
            _require(current_user, project_id, "read", db)
        return crud_docs.doc_facets(
            db, space_id=space_id, project_id=project_id,
            include_global=include_global,
            global_only=(space_id is None and project_id is None),
        )

    # ── Admin stats overview (literal path, before /docs/{doc_id}) ──────────
    @app.get("/docs/stats/overview", response_model=schemas.DocStatsOverview, tags=["Docs"])
    def get_doc_stats_overview(
        space_id: Optional[int] = Query(None, ge=1),
        project_id: Optional[int] = Query(None, ge=1),
        include_global: bool = Query(False),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Aggregate read statistics for the current scope. Admin-only, matching
        the per-doc statistics gate."""
        if space_id is not None:
            space = _get_space_or_404(db, space_id)
            _require(current_user, space.project_id, "read", db)
        elif project_id is not None:
            _require(current_user, project_id, "read", db)
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Only admins can view document statistics")
        return crud_docs.stats_overview(
            db, space_id=space_id, project_id=project_id,
            include_global=include_global,
            global_only=(space_id is None and project_id is None),
        )

    # ── Docs list/create (literal /docs) ────────────────────────────────────
    @app.get("/docs", response_model=List[schemas.DocListItem], tags=["Docs"],
             dependencies=[Depends(require_project_feature("doc_hub"))])
    def list_docs(
        response: Response,
        space_id: Optional[int] = Query(None, ge=1),
        project_id: Optional[int] = Query(None, ge=1),
        folder_id: Optional[int] = Query(None, ge=1),
        classification: Optional[str] = Query(None),
        status: Optional[models.DocStatus] = Query(None),
        tag: Optional[str] = Query(None),
        q: Optional[str] = Query(None),
        include_global: bool = Query(False),
        pinned_only: bool = Query(False),
        visited_only: bool = Query(False),
        sort: str = Query("latest_edited", pattern="^(latest_edited|latest_visited|created|title)$"),
        skip: int = Query(0, ge=0),
        limit: int = Query(50, ge=1, le=200),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        effective_space_id = space_id
        if folder_id is not None:
            folder = crud_docs.get_folder(db, folder_id)
            if folder is None:
                raise HTTPException(status_code=404, detail="Folder not found")
            if space_id is not None and folder.space_id != space_id:
                raise HTTPException(status_code=400, detail="Folder does not belong to this space")
            effective_space_id = folder.space_id
            folder_space = _get_space_or_404(db, folder.space_id)
            _require(current_user, folder_space.project_id, "read", db)
        elif space_id is not None:
            space = _get_space_or_404(db, space_id)
            _require(current_user, space.project_id, "read", db)
        elif project_id is not None:
            _require(current_user, project_id, "read", db)
        else:
            project_id = None

        normalized_q = q.strip() if q and q.strip() else None
        normalized_tag = tag.strip() if tag and tag.strip() else None
        normalized_classification = classification.strip() if classification and classification.strip() else None
        global_only = effective_space_id is None and project_id is None
        filter_kwargs = dict(
            space_id=effective_space_id, project_id=project_id, folder_id=folder_id,
            classification=normalized_classification,
            status=(status.value if status else None),
            tag=normalized_tag,
            q=normalized_q,
            include_global=include_global,
            global_only=global_only,
            pinned_only=pinned_only,
            visited_only=visited_only,
            user_id=current_user.id,
        )
        # Total for pagination — exposed as a header so the body stays a plain list.
        total = crud_docs.count_docs(db, **filter_kwargs)
        response.headers["X-Total-Count"] = str(total)
        docs = crud_docs.list_docs(
            db, **filter_kwargs, sort=sort, skip=skip, limit=limit,
        )
        visit_rows = (
            db.query(models.DocVisit)
            .filter(models.DocVisit.user_id == current_user.id, models.DocVisit.doc_id.in_([d.id for d in docs] or [0]))
            .all()
        )
        visits = {visit.doc_id: visit.last_visited_at for visit in visit_rows}
        pin_rows = (
            db.query(models.DocPin.doc_id)
            .filter(models.DocPin.user_id == current_user.id, models.DocPin.doc_id.in_([d.id for d in docs] or [0]))
            .all()
        )
        pinned_ids = {row.doc_id for row in pin_rows}
        items = []
        for d in docs:
            item = _list_item(d)
            item.my_last_visited_at = visits.get(d.id)
            item.is_pinned = d.id in pinned_ids
            if _is_admin(current_user):
                item.view_count = d.view_count or 0
                item.last_viewed_at = d.last_viewed_at
            items.append(item)
        return items

    @app.post("/docs", response_model=schemas.Doc, status_code=201, tags=["Docs"],
              dependencies=[Depends(require_project_feature("doc_hub"))])
    def create_doc(
        payload: schemas.DocCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        space = _get_space_or_404(db, payload.space_id)
        _require(current_user, space.project_id, "write", db)
        _validate_folder_in_space(db, payload.folder_id, space.id)
        # A new doc inherits its space's classification by default.
        if not payload.classification and space.classification:
            payload.classification = space.classification
        doc = crud_docs.create_doc(db, payload, actor_id=current_user.id)
        _notify_doc_mentions(db, doc, current_user, "")
        return _doc_out(doc, current_user, db)

    @app.get("/docs/spaces/{space_id}/export", tags=["Docs"])
    def export_space(
        space_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Export a whole space as a zip of Markdown files mirroring the folder
        tree, plus a manifest.json (docs-as-code round-trip)."""
        space = _get_space_or_404(db, space_id)
        _require(current_user, space.project_id, "read", db)
        buf = _build_space_zip(db, space)
        return Response(
            content=buf,
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{crud_docs.slugify(space.name)}.zip"'},
        )

    # ── Living release notes ─────────────────────────────────────────────────
    # Registered before the dynamic ``/docs/{doc_id}`` routes so the literal
    # ``/docs/release-notes`` path is never parsed as a doc id.

    @app.post("/docs/release-notes/generate", response_model=schemas.ReleaseNotesPreview, tags=["Docs"])
    async def generate_release_notes(
        payload: schemas.ReleaseNotesGenerateRequest,
        request: Request,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Generate a release-notes *preview* (not persisted) from what changed in
        a project over a window: changed docs, linked requirements, resolved/known
        defects, and test coverage. The editable Markdown draft is always returned;
        the AI summary blurb is best-effort and degrades gracefully."""
        project = crud.get_project(db, payload.project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        _require(current_user, payload.project_id, "write", db)
        if not is_feature_enabled(project, "doc_hub"):
            raise HTTPException(status_code=403, detail="The 'doc_hub' feature is disabled for this project")

        source = release_notes.gather_release_data(
            db, payload.project_id, since=payload.since, until=payload.until,
        )
        title = release_notes.default_title(source)
        content_markdown = release_notes.render_markdown(source, title)

        result = schemas.ReleaseNotesPreview(
            project_id=payload.project_id,
            title=title,
            content_markdown=content_markdown,
            source=_release_source_schema(source),
        )

        has_content = bool(
            source.changed_docs or source.requirements
            or source.resolved_defects or source.open_defects
        )
        if not payload.include_ai:
            result.ai_skipped_reason = "disabled_by_request"
        elif not has_content:
            result.ai_skipped_reason = "no_changes"
        elif not is_feature_enabled(project, "ask_ai"):
            result.ai_skipped_reason = "ask_ai_disabled"
        elif not get_ai_manager_status(db).get("available"):
            result.ai_skipped_reason = "ai_unavailable"
        else:
            try:
                completion = await _cancel_on_disconnect(
                    request,
                    generate_ai_completion(
                        db,
                        AICompletionRequest(
                            prompt=build_release_notes_prompt(title, release_notes.ai_payload(source)),
                            max_tokens=900, temperature=0.3, timeout_seconds=120,
                        ),
                        operation="doc_release_notes",
                        project_id=payload.project_id, user_id=current_user.id,
                    ),
                )
                summary = _parse_release_summary(completion.content)
                if summary:
                    result.summary = summary
                    result.content_markdown = release_notes.render_markdown(
                        source, title, summary=summary,
                    )
                    result.ai_available = True
                    result.provider = completion.provider
                    result.model = completion.model
                else:
                    result.ai_skipped_reason = "ai_error"
            except HTTPException as exc:
                logger.warning("Release notes AI summary failed for project %s: %s", payload.project_id, exc.detail)
                result.ai_skipped_reason = "ai_error"
            except Exception as exc:
                logger.warning("Release notes AI summary errored for project %s: %s", payload.project_id, exc)
                result.ai_skipped_reason = "ai_error"

        return result

    @app.get("/docs/release-notes", response_model=List[schemas.ReleaseNoteListItem], tags=["Docs"])
    def list_release_notes(
        project_id: int = Query(..., ge=1),
        status: Optional[str] = Query(None),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        _require(current_user, project_id, "read", db)
        if status is not None and status not in ("draft", "published"):
            raise HTTPException(status_code=400, detail="status must be draft or published")
        notes = crud_docs.list_release_notes(db, project_id, status=status)
        return [schemas.ReleaseNoteListItem.model_validate(n) for n in notes]

    @app.post("/docs/release-notes", response_model=schemas.ReleaseNote, status_code=201, tags=["Docs"])
    def create_release_note(
        payload: schemas.ReleaseNoteCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Save a (reviewed/edited) release-notes draft."""
        project = crud.get_project(db, payload.project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        _require(current_user, payload.project_id, "write", db)
        if not is_feature_enabled(project, "doc_hub"):
            raise HTTPException(status_code=403, detail="The 'doc_hub' feature is disabled for this project")
        note = crud_docs.create_release_note(db, payload, actor_id=current_user.id)
        return schemas.ReleaseNote.model_validate(note)

    def _get_release_note_or_404(note_id: int, db: Session) -> models.DocReleaseNote:
        note = crud_docs.get_release_note(db, note_id)
        if note is None:
            raise HTTPException(status_code=404, detail="Release note not found")
        return note

    @app.get("/docs/release-notes/{note_id}", response_model=schemas.ReleaseNote, tags=["Docs"])
    def get_release_note(
        note_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        note = _get_release_note_or_404(note_id, db)
        _require(current_user, note.project_id, "read", db)
        return schemas.ReleaseNote.model_validate(note)

    @app.put("/docs/release-notes/{note_id}", response_model=schemas.ReleaseNote, tags=["Docs"])
    def update_release_note(
        payload: schemas.ReleaseNoteUpdate,
        note_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        note = _get_release_note_or_404(note_id, db)
        _require(current_user, note.project_id, "write", db)
        note = crud_docs.update_release_note(db, note, payload, actor_id=current_user.id)
        return schemas.ReleaseNote.model_validate(note)

    @app.post("/docs/release-notes/{note_id}/publish", response_model=schemas.ReleaseNote, tags=["Docs"])
    def publish_release_note(
        note_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        note = _get_release_note_or_404(note_id, db)
        _require(current_user, note.project_id, "write", db)
        note = crud_docs.publish_release_note(db, note, actor_id=current_user.id)
        return schemas.ReleaseNote.model_validate(note)

    @app.post("/docs/release-notes/{note_id}/unpublish", response_model=schemas.ReleaseNote, tags=["Docs"])
    def unpublish_release_note(
        note_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        note = _get_release_note_or_404(note_id, db)
        _require(current_user, note.project_id, "write", db)
        note = crud_docs.unpublish_release_note(db, note, actor_id=current_user.id)
        return schemas.ReleaseNote.model_validate(note)

    @app.delete("/docs/release-notes/{note_id}", status_code=204, tags=["Docs"])
    def delete_release_note(
        note_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        note = _get_release_note_or_404(note_id, db)
        _require(current_user, note.project_id, "write", db)
        crud_docs.delete_release_note(db, note)
        return Response(status_code=204)

    # ── Single doc ──────────────────────────────────────────────────────────
    @app.get("/docs/{doc_id}", response_model=schemas.Doc, tags=["Docs"])
    def get_doc(
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "read", db)
        _record_visit(db, doc, current_user)
        return _doc_out(doc, current_user, db)

    @app.put("/docs/{doc_id}/pin", response_model=schemas.DocListItem, tags=["Docs"])
    def set_doc_pin(
        payload: schemas.DocPinUpdate,
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "read", db)
        try:
            crud_docs.set_doc_pin(db, doc.id, current_user.id, payload.pinned)
        except Exception as exc:
            db.rollback()
            logger.exception("Could not update doc pin for doc %s/user %s", doc.id, current_user.id)
            raise HTTPException(status_code=500, detail="Could not update document pin") from exc

        item = _list_item(doc)
        item.is_pinned = payload.pinned
        visit = (
            db.query(models.DocVisit)
            .filter(models.DocVisit.doc_id == doc.id, models.DocVisit.user_id == current_user.id)
            .first()
        )
        item.my_last_visited_at = visit.last_visited_at if visit else None
        if _is_admin(current_user):
            item.view_count = doc.view_count or 0
            item.last_viewed_at = doc.last_viewed_at
        return item

    @app.put("/docs/{doc_id}", response_model=schemas.Doc, tags=["Docs"])
    def update_doc(
        payload: schemas.DocUpdate,
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "write", db)
        # Snapshot before the update so mention notifications only fire for users
        # newly added since the last save (the editor autosaves frequently).
        previous_markdown = doc.content_markdown
        target_space_id = doc.space_id
        if payload.space_id is not None and payload.space_id != doc.space_id:
            new_space = _get_space_or_404(db, payload.space_id)
            _require(current_user, new_space.project_id, "write", db)
            target_space_id = new_space.id
        # Validate the (possibly new) folder against the (possibly new) space.
        if "folder_id" in payload.model_fields_set:
            _validate_folder_in_space(db, payload.folder_id, target_space_id)
        doc = crud_docs.update_doc(db, doc, payload, actor_id=current_user.id)
        _notify_doc_mentions(db, doc, current_user, previous_markdown)
        return _doc_out(doc, current_user, db)

    @app.delete("/docs/{doc_id}", status_code=204, tags=["Docs"])
    def delete_doc(
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "delete", db)
        crud_docs.delete_doc(db, doc)
        return Response(status_code=204)

    @app.get("/docs/{doc_id}/markdown", tags=["Docs"])
    def get_doc_markdown(
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Clean canonical Markdown + metadata for AI/export consumers."""
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "read", db)
        return {
            "id": doc.id,
            "title": doc.title,
            "slug": doc.slug,
            "classification": doc.classification,
            "status": getattr(doc.status, "value", doc.status),
            "tags": doc.tags,
            "markdown": doc.content_markdown or "",
        }

    @app.get("/docs/{doc_id}/export", tags=["Docs"])
    def export_doc(
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "read", db)
        body = _build_markdown_export(doc)
        return Response(
            content=body,
            media_type="text/markdown; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{_safe_filename(doc.title)}"'},
        )

    # ── Version history ─────────────────────────────────────────────────────
    @app.get("/docs/{doc_id}/versions", response_model=List[schemas.DocVersionView], tags=["Docs"])
    def list_doc_versions(
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "read", db)
        versions = (
            db.query(models.DocVersion)
            .options(joinedload(models.DocVersion.author))
            .filter(models.DocVersion.doc_id == doc_id)
            .order_by(models.DocVersion.version_number.desc())
            .all()
        )
        return [
            schemas.DocVersionView(
                id=v.id, doc_id=v.doc_id, version_number=v.version_number, action=v.action,
                title=v.title, content_markdown=v.content_markdown, status=v.status,
                classification=v.classification, tags=v.tags, change_note=v.change_note,
                created_at=v.created_at, author=_author(v.author),
            )
            for v in versions
        ]

    @app.post("/docs/{doc_id}/versions/{version_id}/restore", response_model=schemas.Doc, tags=["Docs"])
    def restore_doc_version(
        payload: schemas.DocVersionRestore,
        doc_id: int = Path(..., ge=1),
        version_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "write", db)
        version = (
            db.query(models.DocVersion)
            .filter(models.DocVersion.id == version_id, models.DocVersion.doc_id == doc_id)
            .first()
        )
        if version is None:
            raise HTTPException(status_code=404, detail="Version not found")
        doc = crud_docs.restore_doc_version(
            db, doc, version, actor_id=current_user.id, change_note=payload.change_note
        )
        return _doc_out(doc, current_user, db)

    @app.delete("/docs/{doc_id}/versions", response_model=schemas.Doc, tags=["Docs"])
    def clear_doc_versions(
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Remove the doc's entire revision history, keeping the current content
        as a fresh baseline. Destructive, so gated on the delete permission."""
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "delete", db)
        crud_docs.clear_doc_versions(db, doc, actor_id=current_user.id)
        return _doc_out(doc, current_user, db)

    # ── Sharing ─────────────────────────────────────────────────────────────
    @app.get("/docs/{doc_id}/share", response_model=schemas.DocShareInfo, tags=["Docs"])
    def get_doc_share(
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "read", db)
        return schemas.DocShareInfo(
            share_scope=doc.share_scope or "private",
            public_id=doc.public_id if _share_active(doc) else None,
            share_expires_at=doc.share_expires_at,
            share_url=(f"/docs/public/{doc.public_id}" if _share_active(doc) else None),
        )

    @app.put("/docs/{doc_id}/share", response_model=schemas.DocShareInfo, tags=["Docs"])
    def update_doc_share(
        payload: schemas.DocShareUpdate,
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        # Sharing a doc publicly is an edit-level action.
        _require(current_user, doc.project_id, "write", db)
        if payload.share_expires_at is not None and _as_aware(payload.share_expires_at) <= _utcnow():
            raise HTTPException(status_code=400, detail="Share expiry must be in the future")
        doc.share_scope = payload.share_scope
        if payload.share_scope == "public":
            if not doc.public_id:
                doc.public_id = uuid.uuid4().hex
            doc.share_expires_at = payload.share_expires_at
        else:
            doc.share_expires_at = None
        crud.safe_commit(db)
        db.refresh(doc)
        return schemas.DocShareInfo(
            share_scope=doc.share_scope,
            public_id=doc.public_id if _share_active(doc) else None,
            share_expires_at=doc.share_expires_at,
            share_url=(f"/docs/public/{doc.public_id}" if _share_active(doc) else None),
        )

    @app.get("/docs/{doc_id}/stats", response_model=schemas.DocStats, tags=["Docs"])
    def get_doc_stats(
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "read", db)
        if not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Only admins can view document statistics")
        unique_visitors = db.query(func.count(models.DocVisit.id)).filter(models.DocVisit.doc_id == doc.id).scalar() or 0
        latest = (
            db.query(models.DocVisit, models.User)
            .join(models.User, models.User.id == models.DocVisit.user_id)
            .filter(models.DocVisit.doc_id == doc.id)
            .order_by(models.DocVisit.last_visited_at.desc())
            .limit(10)
            .all()
        )
        return schemas.DocStats(
            doc_id=doc.id,
            view_count=doc.view_count or 0,
            unique_visitors=unique_visitors,
            last_viewed_at=doc.last_viewed_at,
            latest_visits=[
                {
                    "user_id": user.id,
                    "name": user.full_name or user.username or user.email,
                    "visit_count": visit.visit_count,
                    "last_visited_at": visit.last_visited_at,
                }
                for visit, user in latest
            ],
        )

    @app.get("/docs/{doc_id}/feedback", response_model=schemas.DocFeedbackSummary, tags=["Docs"])
    def get_doc_feedback_summary(
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "read", db)
        return _feedback_summary(db, doc.id, current_user.id)

    @app.get("/docs/{doc_id}/feedback/items", response_model=List[schemas.DocFeedbackView], tags=["Docs"])
    def list_doc_feedback(
        doc_id: int = Path(..., ge=1),
        include_resolved: bool = Query(False),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "write", db)
        query = (
            db.query(models.DocFeedback)
            .options(joinedload(models.DocFeedback.user))
            .filter(models.DocFeedback.doc_id == doc.id)
            .filter(models.DocFeedback.feedback_type.in_(["not_helpful", "clarification", "outdated"]))
        )
        if not include_resolved:
            query = query.filter(models.DocFeedback.resolved.is_(False))
        items = query.order_by(models.DocFeedback.updated_at.desc().nullslast(), models.DocFeedback.created_at.desc()).all()
        return [_feedback_view(item) for item in items]

    @app.put("/docs/{doc_id}/feedback", response_model=schemas.DocFeedbackSummary, tags=["Docs"])
    def submit_doc_feedback(
        payload: schemas.DocFeedbackCreate,
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "read", db)
        feedback = (
            db.query(models.DocFeedback)
            .filter(models.DocFeedback.doc_id == doc.id, models.DocFeedback.user_id == current_user.id)
            .first()
        )
        should_notify = payload.feedback_type != "helpful"
        if feedback is None:
            feedback = models.DocFeedback(
                doc_id=doc.id,
                user_id=current_user.id,
            )
            _apply_feedback_payload(feedback, payload)
            db.add(feedback)
        else:
            should_notify = should_notify and (
                feedback.feedback_type != payload.feedback_type
                or (feedback.comment or "") != (payload.comment or "")
                or (feedback.section_text or "") != (payload.section_text or "")
                or bool(feedback.resolved)
            )
            _apply_feedback_payload(feedback, payload)
        try:
            crud.safe_commit(db)
            db.refresh(feedback)
        except IntegrityError as exc:
            db.rollback()
            feedback = (
                db.query(models.DocFeedback)
                .filter(models.DocFeedback.doc_id == doc.id, models.DocFeedback.user_id == current_user.id)
                .first()
            )
            if feedback is None:
                logger.exception("Could not resolve duplicate doc feedback for doc %s/user %s", doc.id, current_user.id)
                raise HTTPException(status_code=500, detail="Could not save document feedback") from exc
            should_notify = should_notify and (
                feedback.feedback_type != payload.feedback_type
                or (feedback.comment or "") != (payload.comment or "")
                or (feedback.section_text or "") != (payload.section_text or "")
                or bool(feedback.resolved)
            )
            _apply_feedback_payload(feedback, payload)
            try:
                crud.safe_commit(db)
                db.refresh(feedback)
            except Exception as retry_exc:
                db.rollback()
                logger.exception("Could not save duplicate doc feedback for doc %s/user %s", doc.id, current_user.id)
                raise HTTPException(status_code=500, detail="Could not save document feedback") from retry_exc
        except Exception as exc:
            db.rollback()
            logger.exception("Could not save doc feedback for doc %s/user %s", doc.id, current_user.id)
            raise HTTPException(status_code=500, detail="Could not save document feedback") from exc
        if should_notify:
            _notify_doc_feedback(db, doc, current_user, feedback.feedback_type, feedback.comment)
        return _feedback_summary(db, doc.id, current_user.id)

    @app.delete("/docs/{doc_id}/feedback", response_model=schemas.DocFeedbackSummary, tags=["Docs"])
    def delete_my_doc_feedback(
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "read", db)
        feedback = (
            db.query(models.DocFeedback)
            .filter(models.DocFeedback.doc_id == doc.id, models.DocFeedback.user_id == current_user.id)
            .first()
        )
        if feedback is not None:
            try:
                db.delete(feedback)
                crud.safe_commit(db)
            except Exception as exc:
                db.rollback()
                logger.exception("Could not delete doc feedback for doc %s/user %s", doc.id, current_user.id)
                raise HTTPException(status_code=500, detail="Could not delete document feedback") from exc
        return _feedback_summary(db, doc.id, current_user.id)

    @app.put("/docs/{doc_id}/feedback/{feedback_id}", response_model=schemas.DocFeedbackView, tags=["Docs"])
    def resolve_doc_feedback(
        payload: schemas.DocFeedbackResolve,
        doc_id: int = Path(..., ge=1),
        feedback_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "write", db)
        feedback = (
            db.query(models.DocFeedback)
            .options(joinedload(models.DocFeedback.user))
            .filter(models.DocFeedback.id == feedback_id, models.DocFeedback.doc_id == doc.id)
            .first()
        )
        if feedback is None:
            raise HTTPException(status_code=404, detail="Document feedback not found")
        if feedback.feedback_type == "helpful":
            raise HTTPException(status_code=400, detail="Helpful votes do not require resolution")
        feedback.resolved = payload.resolved
        try:
            crud.safe_commit(db)
            db.refresh(feedback)
        except Exception as exc:
            db.rollback()
            logger.exception("Could not update doc feedback %s", feedback.id)
            raise HTTPException(status_code=500, detail="Could not update document feedback") from exc
        return _feedback_view(feedback)

    @app.get("/docs/{doc_id}/related", response_model=List[schemas.DocRelatedLinkView], tags=["Docs"])
    def list_related_docs(
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "read", db)
        links = (
            db.query(models.DocRelatedLink)
            .options(joinedload(models.DocRelatedLink.related_doc))
            .filter(models.DocRelatedLink.doc_id == doc.id)
            .order_by(models.DocRelatedLink.created_at.desc())
            .all()
        )
        result = []
        for link in links:
            related = link.related_doc
            if related is None or not _can_access(current_user, related.project_id, "read", db):
                continue
            result.append(schemas.DocRelatedLinkView(
                id=link.id,
                doc_id=link.doc_id,
                related_doc_id=link.related_doc_id,
                related_doc_title=related.title,
                related_doc_project_id=related.project_id,
                created_at=link.created_at,
            ))
        return result

    @app.get("/docs/{doc_id}/suggestions", response_model=List[schemas.DocSuggestion], tags=["Docs"])
    def list_doc_suggestions(
        doc_id: int = Path(..., ge=1),
        limit: int = Query(6, ge=1, le=20),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Smart suggestions: docs similar to this one (tag/title/body overlap),
        excluding the doc itself and ones already manually related."""
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "read", db)
        related_ids = [
            rid for (rid,) in db.query(models.DocRelatedLink.related_doc_id)
            .filter(models.DocRelatedLink.doc_id == doc.id).all()
        ]
        scored = crud_docs.suggest_docs(db, doc, exclude_ids=related_ids, limit=limit)
        return [
            schemas.DocSuggestion(
                id=r.id, uuid=r.uuid, title=r.title, slug=r.slug, space_id=r.space_id,
                project_id=r.project_id, classification=r.classification, status=r.status,
                tags=r.tags, excerpt=_excerpt(r.content), current_version=r.current_version or 0,
                score=round(float(score), 4), matched_tags=matched,
            )
            for score, r, matched in scored
        ]

    @app.get("/docs/{doc_id}/duplicates", response_model=List[schemas.DocDuplicateCandidate], tags=["Docs"])
    def list_doc_duplicates(
        doc_id: int = Path(..., ge=1),
        limit: int = Query(5, ge=1, le=10),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Likely duplicate docs: stricter same-topic matches with different
        titles, excluding already-related docs."""
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "read", db)
        scored = crud_docs.find_duplicate_docs(db, doc, limit=limit)
        return [
            schemas.DocDuplicateCandidate(
                id=r.id, uuid=r.uuid, title=r.title, slug=r.slug, space_id=r.space_id,
                project_id=r.project_id, classification=r.classification, status=r.status,
                tags=r.tags, excerpt=_excerpt(r.content), current_version=r.current_version or 0,
                score=round(float(score), 4), matched_tags=matched, reasons=reasons,
            )
            for score, r, matched, reasons in scored
            if _can_access(current_user, r.project_id, "read", db)
        ]

    @app.post("/docs/{doc_id}/merge", response_model=schemas.DocMergeResult, tags=["Docs"])
    def merge_duplicate_doc(
        payload: schemas.DocMergeRequest,
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        target = _get_doc_or_404(db, doc_id)
        source = _get_doc_or_404(db, payload.source_doc_id)
        _require(current_user, target.project_id, "write", db)
        _require(current_user, source.project_id, "write", db)
        if target.id == source.id:
            raise HTTPException(status_code=400, detail="A document cannot be merged into itself")
        try:
            result = crud_docs.merge_duplicate_doc(
                db, target=target, source=source, actor_id=current_user.id, note=payload.note,
            )
        except IntegrityError as exc:
            raise HTTPException(status_code=409, detail="Could not merge because a preserved reference already exists") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            logger.exception("Could not merge duplicate doc %s into %s", source.id, target.id)
            raise HTTPException(status_code=500, detail="Could not merge duplicate document") from exc
        return schemas.DocMergeResult(
            target_doc=_doc_out(result["target"], current_user, db),
            archived_source_doc=_doc_out(result["source"], current_user, db),
            transferred=result["transferred"],
            preserved_reference_count=result["preserved_reference_count"],
        )

    @app.post("/docs/{doc_id}/related", response_model=schemas.DocRelatedLinkView, status_code=201, tags=["Docs"])
    def add_related_doc(
        payload: schemas.DocRelatedLinkCreate,
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        related = _get_doc_or_404(db, payload.related_doc_id)
        _require(current_user, doc.project_id, "write", db)
        _require(current_user, related.project_id, "read", db)
        if doc.id == related.id:
            raise HTTPException(status_code=400, detail="A document cannot be related to itself")
        link = models.DocRelatedLink(doc_id=doc.id, related_doc_id=related.id, created_by=current_user.id)
        db.add(link)
        try:
            crud.safe_commit(db)
            db.refresh(link)
        except IntegrityError:
            db.rollback()
            raise HTTPException(status_code=409, detail="Related document already exists")
        return schemas.DocRelatedLinkView(
            id=link.id,
            doc_id=link.doc_id,
            related_doc_id=related.id,
            related_doc_title=related.title,
            related_doc_project_id=related.project_id,
            created_at=link.created_at,
        )

    @app.delete("/docs/{doc_id}/related/{related_doc_id}", status_code=204, tags=["Docs"])
    def delete_related_doc(
        doc_id: int = Path(..., ge=1),
        related_doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "write", db)
        link = (
            db.query(models.DocRelatedLink)
            .filter(models.DocRelatedLink.doc_id == doc.id, models.DocRelatedLink.related_doc_id == related_doc_id)
            .first()
        )
        if link is None:
            raise HTTPException(status_code=404, detail="Related document not found")
        db.delete(link)
        crud.safe_commit(db)
        return Response(status_code=204)

    # ── Requirement links ───────────────────────────────────────────────────
    @app.get("/docs/{doc_id}/requirement-links", response_model=List[schemas.DocRequirementLinkView], tags=["Docs"])
    def list_doc_requirement_links(
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "read", db)
        links = (
            db.query(models.DocRequirementLink)
            .options(joinedload(models.DocRequirementLink.requirement))
            .filter(models.DocRequirementLink.doc_id == doc_id)
            .order_by(models.DocRequirementLink.id.desc())
            .all()
        )
        return [
            schemas.DocRequirementLinkView(
                id=l.id, doc_id=l.doc_id, requirement_id=l.requirement_id,
                requirement_key=(l.requirement.requirement_id if l.requirement else None),
                requirement_title=(l.requirement.title if l.requirement else None),
                created_at=l.created_at,
            )
            for l in links
        ]

    @app.post("/docs/{doc_id}/requirement-links", response_model=schemas.DocRequirementLinkView,
              status_code=201, tags=["Docs"])
    def create_doc_requirement_link(
        payload: schemas.DocRequirementLinkCreate,
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Manually link an existing project requirement to this document.

        Idempotent: re-linking an already-linked requirement returns the existing
        link rather than erroring."""
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "write", db)
        if doc.project_id is None:
            raise HTTPException(status_code=400, detail="Global documents cannot be linked to requirements")
        requirement = (
            db.query(models.Requirement)
            .filter(models.Requirement.id == payload.requirement_id)
            .first()
        )
        if requirement is None:
            raise HTTPException(status_code=404, detail="Requirement not found")
        if requirement.project_id != doc.project_id:
            raise HTTPException(status_code=400, detail="Requirement belongs to a different project")
        link = (
            db.query(models.DocRequirementLink)
            .filter(
                models.DocRequirementLink.doc_id == doc.id,
                models.DocRequirementLink.requirement_id == requirement.id,
            )
            .first()
        )
        if link is None:
            link = models.DocRequirementLink(
                doc_id=doc.id, requirement_id=requirement.id, created_by=current_user.id,
            )
            db.add(link)
            crud.safe_commit(db)
            db.refresh(link)
        return schemas.DocRequirementLinkView(
            id=link.id, doc_id=link.doc_id, requirement_id=link.requirement_id,
            requirement_key=requirement.requirement_id, requirement_title=requirement.title,
            created_at=link.created_at,
        )

    @app.delete("/docs/{doc_id}/requirement-links/{requirement_id}", status_code=204, tags=["Docs"])
    def delete_doc_requirement_link(
        doc_id: int = Path(..., ge=1),
        requirement_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "write", db)
        link = (
            db.query(models.DocRequirementLink)
            .filter(
                models.DocRequirementLink.doc_id == doc.id,
                models.DocRequirementLink.requirement_id == requirement_id,
            )
            .first()
        )
        if link is None:
            raise HTTPException(status_code=404, detail="Requirement link not found")
        db.delete(link)
        crud.safe_commit(db)
        return Response(status_code=204)

    # ── Converter: doc → requirements ───────────────────────────────────────
    @app.post("/docs/{doc_id}/convert-to-requirements/preview", response_model=schemas.DocConvertPreview, tags=["Docs"])
    def preview_convert(
        payload: schemas.DocConvertRequest,
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "read", db)
        plan = conv.build_plan(doc, payload.mode, payload.heading_level)
        return schemas.DocConvertPreview(
            mode=plan.mode,
            items=[
                schemas.DocConvertPreviewItem(
                    index=s.index, title=s.title,
                    description_html=s.description_html,
                    is_acceptance_criteria=s.is_acceptance_criteria,
                )
                for s in plan.sections
            ],
        )

    @app.post("/docs/{doc_id}/convert-to-requirements", response_model=schemas.DocConvertResult, tags=["Docs"])
    def convert_to_requirements(
        payload: schemas.DocConvertRequest,
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "read", db)

        target_project_id = doc.project_id or payload.target_project_id
        if target_project_id is None:
            raise HTTPException(
                status_code=400,
                detail="target_project_id is required when converting a global doc",
            )
        _require(current_user, target_project_id, "write", db)
        if doc.project_id is None and crud.get_project(db, target_project_id) is None:
            raise HTTPException(status_code=404, detail="Target project not found")

        if payload.folder_id is not None:
            folder = crud.get_requirement_folder(db, payload.folder_id)
            if folder is None or folder.project_id != target_project_id:
                raise HTTPException(status_code=400, detail="Folder not found in target project")

        plan = conv.build_plan(doc, payload.mode, payload.heading_level)

        # Apply per-item overrides / inclusion from the preview, keyed by index.
        overrides = {it.index: it for it in (payload.items or [])}

        created: List[models.Requirement] = []
        links: List[models.DocRequirementLink] = []

        try:
            if payload.mode == "single":
                ac_section = next((s for s in plan.sections if s.is_acceptance_criteria), None)
                main = next((s for s in plan.sections if not s.is_acceptance_criteria), plan.sections[0])
                ov = overrides.get(main.index)
                if ov is not None and not ov.include:
                    raise HTTPException(status_code=400, detail="At least one requirement must be selected")
                title = _conversion_title((ov.title if ov else None) or main.title)
                req = _create_requirement(
                    db, doc, target_project_id, title, main.description_html,
                    acceptance_html=(ac_section.description_html if ac_section else None),
                    payload=payload, actor_id=current_user.id,
                )
                created.append(req)
                links.append(_link_doc_requirement(db, doc, req, current_user.id))
            else:
                for s in plan.sections:
                    ov = overrides.get(s.index)
                    if ov is not None and not ov.include:
                        continue
                    title = _conversion_title((ov.title if ov else None) or s.title)
                    req = _create_requirement(
                        db, doc, target_project_id, title, s.description_html,
                        acceptance_html=None, payload=payload, actor_id=current_user.id,
                    )
                    created.append(req)
                    links.append(_link_doc_requirement(db, doc, req, current_user.id))
            if not created:
                raise HTTPException(status_code=400, detail="At least one requirement must be selected")
            crud.safe_commit(db)
        except HTTPException:
            db.rollback()
            raise
        except IntegrityError as exc:
            db.rollback()
            logger.warning("Doc conversion failed due to an integrity error: %s", exc)
            raise HTTPException(status_code=409, detail="Could not convert document because generated requirements conflict with existing data")
        except Exception as exc:
            db.rollback()
            logger.exception("Unexpected doc conversion failure: %s", exc)
            raise HTTPException(status_code=500, detail="Could not convert document to requirements")

        link_views = [
            schemas.DocRequirementLinkView(
                id=l.id, doc_id=l.doc_id, requirement_id=l.requirement_id,
                requirement_key=created[i].requirement_id, requirement_title=created[i].title,
                created_at=l.created_at,
            )
            for i, l in enumerate(links)
        ]
        return schemas.DocConvertResult(created=created, links=link_views)

    # ── Change impact analysis ──────────────────────────────────────────────
    @app.post("/docs/{doc_id}/impact-analysis", response_model=schemas.DocImpactAnalysis, tags=["Docs"],
              dependencies=[Depends(require_project_feature("doc_hub"))])
    async def analyze_doc_impact(
        payload: schemas.DocImpactRequest,
        request: Request,
        doc_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Show the requirements, test cases, and defects a doc change impacts,
        plus an AI risk assessment — so authors can review before publishing.

        The deterministic impact graph is always returned; the AI risk block is
        best-effort and degrades gracefully when AI is off/unavailable."""
        doc = _get_doc_or_404(db, doc_id)
        _require(current_user, doc.project_id, "read", db)

        # The ``require_project_feature`` dependency can't resolve a project from
        # this route (no project_id in the path/body), so enforce the Doc Hub
        # toggle explicitly for project docs. Global docs have no project toggle.
        project = crud.get_project(db, doc.project_id) if doc.project_id is not None else None
        if project is not None and not is_feature_enabled(project, "doc_hub"):
            raise HTTPException(status_code=403, detail="The 'doc_hub' feature is disabled for this project")

        graph = doc_impact_service.analyze_doc_impact(
            db, doc, candidate_markdown=payload.candidate_markdown,
        )
        result = schemas.DocImpactAnalysis(
            doc_id=doc.id,
            project_id=doc.project_id,
            change_summary=schemas.DocImpactChangeSummary(
                changed=graph.change_summary.changed,
                headings_added=graph.change_summary.headings_added,
                headings_removed=graph.change_summary.headings_removed,
                char_delta=graph.change_summary.char_delta,
                note=graph.change_summary.note,
            ),
            requirements=[_impact_item(i) for i in graph.requirements],
            test_cases=[_impact_item(i) for i in graph.test_cases],
            defects=[_impact_item(i) for i in graph.defects],
            risk_signals=schemas.DocImpactRiskSignals(
                impacted_requirements=graph.risk_signals.impacted_requirements,
                impacted_test_cases=graph.risk_signals.impacted_test_cases,
                impacted_defects=graph.risk_signals.impacted_defects,
                open_defects=graph.risk_signals.open_defects,
                high_severity_defects=graph.risk_signals.high_severity_defects,
                uncovered_requirements=graph.risk_signals.uncovered_requirements,
            ),
        )

        # The deterministic graph above always runs. The (paid) AI risk
        # assessment only fires when there is something worth spending tokens on:
        # an actual change to assess, a project with artifacts, the project's
        # ask_ai feature on, a configured provider, and at least one impacted
        # item. When the editor re-analyzes an unchanged draft, ``candidate_markdown``
        # equals the stored content (``changed`` is False) — so no AI request is sent.
        total_items = len(graph.requirements) + len(graph.test_cases) + len(graph.defects)
        if not payload.include_ai:
            result.ai_skipped_reason = "disabled_by_request"
        elif doc.project_id is None:
            result.ai_skipped_reason = "global_doc"
        elif payload.candidate_markdown is not None and not graph.change_summary.changed:
            result.ai_skipped_reason = "no_changes"
        elif total_items == 0:
            result.ai_skipped_reason = "no_impacted_items"
        else:
            if project is not None and not is_feature_enabled(project, "ask_ai"):
                result.ai_skipped_reason = "ask_ai_disabled"
            elif not get_ai_manager_status(db).get("available"):
                result.ai_skipped_reason = "ai_unavailable"
            else:
                result.ai_available = True
                impacted_items = [
                    {"type": i.type, "key": i.key, "title": i.title, "reason": i.reason,
                     "severity": i.severity, "status": i.status,
                     "via": ", ".join(i.via) if i.via else ""}
                    for i in (graph.requirements + graph.test_cases + graph.defects)
                ]
                change_summary = {
                    "changed": graph.change_summary.changed,
                    "note": graph.change_summary.note,
                    "headings_added": graph.change_summary.headings_added,
                    "headings_removed": graph.change_summary.headings_removed,
                    "char_delta": graph.change_summary.char_delta,
                }
                try:
                    # Cancel the (paid) AI call if the client disconnects — e.g.
                    # the user closes the dialog — so it doesn't keep running.
                    completion = await _cancel_on_disconnect(
                        request,
                        generate_ai_completion(
                            db,
                            AICompletionRequest(
                                prompt=build_doc_impact_prompt(doc.title, change_summary, impacted_items),
                                max_tokens=1200, temperature=0.2, timeout_seconds=120,
                            ),
                            operation="doc_change_impact",
                            project_id=doc.project_id, user_id=current_user.id,
                            entity_type="doc", entity_id=doc.id,
                        ),
                    )
                    summary, recommendation, risks = _parse_impact_ai(completion.content)
                    result.ai_summary = summary
                    result.recommendation = recommendation
                    result.risks = risks
                    result.provider = completion.provider
                    result.model = completion.model
                except HTTPException as exc:
                    logger.warning("Doc impact AI assessment failed for doc %s: %s", doc.id, exc.detail)
                    result.ai_available = False
                    result.ai_skipped_reason = "ai_error"
                except Exception as exc:  # parsing or unexpected provider error
                    logger.warning("Doc impact AI assessment errored for doc %s: %s", doc.id, exc)
                    result.ai_available = False
                    result.ai_skipped_reason = "ai_error"

        _audit_doc_impact(db, current_user, doc)
        return result

    # --- internal helpers bound to the request scope -----------------------

    def _conversion_title(title: str) -> str:
        cleaned = (title or "").strip()
        if not cleaned:
            raise HTTPException(status_code=400, detail="Requirement title cannot be empty")
        return cleaned[:255]

    def _create_requirement(db, doc, project_id, title, description_html,
                            acceptance_html, payload, actor_id) -> models.Requirement:
        req_create = schemas.RequirementCreate(
            title=title,
            description=description_html,
            acceptance_criteria=acceptance_html,
            requirement_id=conv.next_requirement_id(db, project_id),
            status=payload.default_status,
            priority=payload.default_priority,
            folder_id=payload.folder_id,
            tags=doc.tags,
            project_id=project_id,
            created_by=actor_id,
        )
        requirement = models.Requirement(
            title=req_create.title,
            description=req_create.description,
            acceptance_criteria=req_create.acceptance_criteria,
            requirement_id=req_create.requirement_id,
            status=models.RequirementStatus(req_create.status),
            priority=models.Priority(req_create.priority),
            folder_id=req_create.folder_id,
            tags=req_create.tags,
            project_id=req_create.project_id,
            created_by=req_create.created_by,
        )
        db.add(requirement)
        db.flush()
        return requirement

    def _link_doc_requirement(db, doc, requirement, actor_id) -> models.DocRequirementLink:
        link = models.DocRequirementLink(
            doc_id=doc.id, requirement_id=requirement.id, created_by=actor_id
        )
        db.add(link)
        db.flush()
        return link

    # --- import/export internals -------------------------------------------

    def _import_single_md(db, space, filename, raw, folder_id, actor_id, commit: bool = True) -> models.Doc:
        text = raw.decode("utf-8", errors="replace")
        meta, body = _parse_frontmatter(text)
        title = (meta.get("title") or _first_h1(body)
                 or os.path.splitext(os.path.basename(filename))[0] or "Untitled")
        status = str(meta.get("status") or "draft").lower()
        try:
            status_enum = models.DocStatus(status)
        except ValueError:
            status_enum = models.DocStatus.DRAFT
        tags = meta.get("tags")
        if isinstance(tags, list):
            tags = ",".join(str(t) for t in tags)
        payload = schemas.DocCreate(
            title=str(title)[:255],
            content_markdown=body,
            space_id=space.id,
            folder_id=folder_id,
            classification=(str(meta["classification"]) if meta.get("classification") else None),
            status=status_enum,
            tags=(str(tags) if tags else None),
            dir=(str(meta.get("dir")) if meta.get("dir") in {"ltr", "rtl", "auto"} else "auto"),
        )
        return crud_docs.create_doc(db, payload, actor_id=actor_id, commit=commit)

    def _import_zip(db, space, raw, actor_id) -> List[models.Doc]:
        created: List[models.Doc] = []
        folder_cache: dict[str, int] = {}

        def ensure_folder(rel_dir: str) -> Optional[int]:
            rel_dir = rel_dir.strip("/")
            if not rel_dir:
                return None
            if rel_dir in folder_cache:
                return folder_cache[rel_dir]
            parts = rel_dir.split("/")
            parent_id: Optional[int] = None
            path_so_far = ""
            for part in parts:
                path_so_far = f"{path_so_far}/{part}" if path_so_far else part
                if path_so_far in folder_cache:
                    parent_id = folder_cache[path_so_far]
                    continue
                folder = crud_docs.create_folder(
                    db,
                    schemas.DocFolderCreate(name=part, space_id=space.id, parent_folder_id=parent_id),
                    commit=False,
                )
                folder_cache[path_so_far] = folder.id
                parent_id = folder.id
            return parent_id

        try:
            zf = zipfile.ZipFile(io.BytesIO(raw))
        except zipfile.BadZipFile:
            raise HTTPException(status_code=400, detail="Invalid zip file")

        with zf:
            markdown_entries = []
            total_size = 0
            for info in zf.infolist():
                if info.is_dir():
                    continue
                safe_name = _safe_zip_member_name(info.filename)
                if not _is_markdown_filename(safe_name):
                    continue
                total_size += info.file_size
                if total_size > DOC_IMPORT_MAX_BYTES:
                    raise HTTPException(status_code=413, detail="Imported Markdown content is too large")
                markdown_entries.append((info, safe_name))
                if len(markdown_entries) > DOC_IMPORT_MAX_FILES:
                    raise HTTPException(status_code=413, detail="Zip contains too many Markdown files")

            if not markdown_entries:
                raise HTTPException(status_code=400, detail="Zip does not contain any Markdown files")

            for info, safe_name in markdown_entries:
                rel_dir = os.path.dirname(safe_name)
                folder_id = ensure_folder(rel_dir)
                with zf.open(info) as fh:
                    doc = _import_single_md(
                        db,
                        space,
                        os.path.basename(safe_name),
                        fh.read(),
                        folder_id,
                        actor_id,
                        commit=False,
                    )
                created.append(doc)
        return created

    def _build_space_zip(db, space) -> bytes:
        folders = {f.id: f for f in crud_docs.list_folders(db, space.id)}

        def folder_path(folder_id: Optional[int]) -> str:
            parts: List[str] = []
            seen = set()
            while folder_id is not None and folder_id in folders and folder_id not in seen:
                seen.add(folder_id)
                f = folders[folder_id]
                parts.append(crud_docs.slugify(f.name))
                folder_id = f.parent_folder_id
            return "/".join(reversed(parts))

        docs = crud_docs.list_docs(db, space_id=space.id, limit=500)
        manifest = {"space": space.name, "slug": space.slug, "docs": []}
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
            for d in docs:
                rel = folder_path(d.folder_id)
                fname = _safe_filename(d.title)
                arc = f"{rel}/{fname}" if rel else fname
                zf.writestr(arc, _build_markdown_export(d))
                manifest["docs"].append({"title": d.title, "path": arc, "status": getattr(d.status, "value", d.status)})
            import json
            zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        return out.getvalue()
