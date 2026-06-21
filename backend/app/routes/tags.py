"""Tag management routes for normalized test-case tags.

Tags are per-project: each project owns its own tag catalog. The chip input on the
test-case form auto-creates tags by name; these endpoints back the management UI
(list with usage counts, rename/recolor, delete, merge).
"""

from fastapi import Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from typing import List, Optional

from .. import crud, models, schemas, rbac
from ..database import get_db
from ..auth import get_current_active_user


def register_tags_routes(app):
    """Register tag management routes with the FastAPI app."""

    def _require_project_write(current_user, project_id, db):
        if project_id is not None and not rbac.has_permission(current_user, "write", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        if project_id is None and not rbac.has_permission(current_user, "write"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

    def _require_project_manage(current_user, project_id, db):
        # Deleting/merging tags rewrites every linked case — a manager+ action.
        if project_id is not None and not rbac.has_permission(current_user, "manage_projects", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        if project_id is None and not rbac.has_permission(current_user, "manage_projects"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

    def _duplicate_error() -> HTTPException:
        return HTTPException(status_code=409, detail="A tag with this name already exists in this project")

    @app.get("/tags", response_model=List[schemas.TagWithUsage], tags=["Tags"])
    def list_tags(
        project_id: Optional[int] = Query(None),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        if project_id is not None:
            if not rbac.has_permission(current_user, "read", project_id, db):
                raise HTTPException(status_code=403, detail="Insufficient permissions")
        elif not rbac.has_permission(current_user, "read"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        rows = crud.list_project_tags_with_usage(db, project_id)
        return [
            schemas.TagWithUsage(
                id=tag.id, name=tag.name, slug=tag.slug, color=tag.color,
                project_id=tag.project_id, description=tag.description,
                is_active=tag.is_active, usage_count=count,
            )
            for tag, count in rows
        ]

    @app.post("/tags", response_model=schemas.TagOut, tags=["Tags"])
    def create_tag(
        tag: schemas.TagCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        _require_project_write(current_user, tag.project_id, db)
        slug = crud.slugify_tag(tag.name)
        if not slug:
            raise HTTPException(status_code=400, detail="Tag name cannot be empty")
        if crud.get_tag_by_slug(db, tag.project_id, slug) is not None:
            raise _duplicate_error()
        db_tag = models.Tag(
            project_id=tag.project_id, name=tag.name.strip(), slug=slug,
            color=tag.color, description=tag.description, created_by=current_user.id,
        )
        db.add(db_tag)
        try:
            crud.safe_commit(db)
        except IntegrityError:
            db.rollback()
            raise _duplicate_error()
        db.refresh(db_tag)
        return db_tag

    @app.put("/tags/{tag_id}", response_model=schemas.TagOut, tags=["Tags"])
    def update_tag(
        tag_id: int,
        payload: schemas.TagUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        tag = crud.get_tag(db, tag_id)
        if tag is None:
            raise HTTPException(status_code=404, detail="Tag not found")
        _require_project_write(current_user, tag.project_id, db)
        # Guard the unique (project_id, slug) constraint before mutating.
        if payload.name is not None:
            new_slug = crud.slugify_tag(payload.name)
            existing = crud.get_tag_by_slug(db, tag.project_id, new_slug)
            if existing is not None and existing.id != tag.id:
                raise _duplicate_error()
        crud.update_tag(
            db, tag, name=payload.name, color=payload.color,
            description=payload.description, is_active=payload.is_active,
        )
        try:
            crud.safe_commit(db)
        except IntegrityError:
            db.rollback()
            raise _duplicate_error()
        db.refresh(tag)
        return tag

    @app.delete("/tags/{tag_id}", response_model=schemas.MessageResponse, tags=["Tags"])
    def delete_tag(
        tag_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        tag = crud.get_tag(db, tag_id)
        if tag is None:
            raise HTTPException(status_code=404, detail="Tag not found")
        _require_project_manage(current_user, tag.project_id, db)
        crud.delete_tag(db, tag)
        crud.safe_commit(db)
        return {"message": "Tag deleted successfully"}

    @app.post("/tags/{tag_id}/merge", response_model=schemas.TagOut, tags=["Tags"])
    def merge_tag(
        tag_id: int,
        payload: schemas.TagMerge,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        source = crud.get_tag(db, tag_id)
        target = crud.get_tag(db, payload.target_id)
        if source is None or target is None:
            raise HTTPException(status_code=404, detail="Tag not found")
        if source.id == target.id:
            raise HTTPException(status_code=400, detail="Cannot merge a tag into itself")
        if source.project_id != target.project_id:
            raise HTTPException(status_code=400, detail="Tags must belong to the same project")
        _require_project_manage(current_user, source.project_id, db)
        crud.merge_tags(db, source, target)
        crud.safe_commit(db)
        db.refresh(target)
        return target
