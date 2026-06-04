"""Advanced Search — run TQL queries across entities (defects, requirements,
test cases) within a project and get back a uniform results envelope.

This is the cross-entity home for TQL. The defects list endpoint also accepts a
raw ``?tql=`` for API callers, but the full UI (catalog, pagination, export,
share) lives here. See :mod:`app.services.tql` for the language, registries, and
entity dispatch.
"""

from __future__ import annotations

import csv
import io
import logging
from typing import Optional

from fastapi import Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import models, rbac, schemas
from ..feature_guard import require_project_feature
from ..features import is_feature_enabled
from ..auth import get_current_active_user
from ..crud import safe_commit
from ..database import get_db
from ..services.tql import (
    EvalContext,
    TQLError,
    ast_to_json,
    compile_tql,
    entity_catalog,
    execute_search,
    export_search,
    get_entity,
    parse,
    value_suggestions,
)

SAVED_SEARCH_SCOPE = "advanced_search"

# Advanced-search entity keys -> the project feature toggle that gates them.
# When that feature is disabled for a project the entity is hidden from the
# picker and any query/value/export request for it is rejected, so disabled
# modules stay fully inaccessible through search.
ENTITY_FEATURE = {
    "defects": "defects",
    "requirements": "requirements",
    "test_cases": "test_cases",
    "test_plans": "test_plans",
    "test_executions": "test_runs",
    "docs": "doc_hub",
}


def _entity_disabled(project, entity: str) -> bool:
    feature = ENTITY_FEATURE.get(entity)
    return feature is not None and not is_feature_enabled(project, feature)

# Leading characters a spreadsheet may interpret as a formula. Neutralized on
# CSV export so a stored value like ``=cmd|...`` can't execute on open.
_CSV_FORMULA_TRIGGERS = ("=", "+", "-", "@", "\t", "\r")


def _csv_safe(value):
    """Defang CSV formula injection by prefixing risky leading characters."""
    if isinstance(value, str) and value and value[0] in _CSV_FORMULA_TRIGGERS:
        return "'" + value
    return value


class SavedSearchCreate(BaseModel):
    project_id: int
    name: str = Field(min_length=1, max_length=120)
    entity: str
    tql: str = Field(default="", max_length=2000)
    is_shared: bool = False


def _saved_search_view(row: models.SavedFilter) -> dict:
    definition = row.definition or {}
    return {
        "id": row.id,
        "name": row.name,
        "entity": definition.get("entity"),
        "tql": definition.get("tql", ""),
        "is_shared": row.is_shared,
        "is_owner": True,
    }

logger = logging.getLogger(__name__)


def register_advanced_search_routes(app) -> None:

    def _require_project_access(current_user, project_id: int, db: Session):
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        project = db.query(models.Project).filter(models.Project.id == project_id).first()
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        return project

    def _require_entity_enabled(project, entity: str) -> None:
        if _entity_disabled(project, entity):
            raise HTTPException(
                status_code=403,
                detail=f"The '{entity}' entity is disabled for this project",
            )

    @app.get("/advanced-search/entities", tags=["Advanced Search"])
    def get_advanced_search_entities(
        project_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """List searchable entities (excluding modules disabled for this project)."""
        project = _require_project_access(current_user, project_id, db)
        entities = [e for e in entity_catalog() if not _entity_disabled(project, e["key"])]
        return {"entities": entities}

    @app.get("/advanced-search/values", tags=["Advanced Search"])
    def get_advanced_search_values(
        project_id: int,
        entity: str = Query(...),
        field: str = Query(..., description="Field name to suggest values for"),
        q: str = Query("", max_length=200, description="Partial value being typed"),
        limit: int = Query(15, ge=1, le=50),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Distinct existing values of a field (for value autocomplete)."""
        project = _require_project_access(current_user, project_id, db)
        _require_entity_enabled(project, entity)
        try:
            return {"values": value_suggestions(db, entity, field, project_id, q, limit)}
        except TQLError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    @app.get("/advanced-search", tags=["Advanced Search"],
             dependencies=[Depends(require_project_feature("advanced_search"))])
    def run_advanced_search(
        project_id: int,
        entity: str = Query(..., description="Entity to search: defects | requirements | test_cases"),
        tql: Optional[str] = Query(
            None,
            max_length=2000,
            description="TQL expression, e.g. status = OPEN AND priority IN (HIGH, URGENT)",
        ),
        limit: int = Query(50, ge=1, le=200),
        offset: int = Query(0, ge=0),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Run a paginated TQL query for one entity within one project."""
        project = _require_project_access(current_user, project_id, db)
        _require_entity_enabled(project, entity)
        try:
            return execute_search(
                db=db,
                entity_key=entity,
                project_id=project_id,
                tql=tql,
                context=EvalContext(current_user_id=current_user.id),
                limit=limit,
                offset=offset,
            )
        except TQLError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    @app.get("/advanced-search/export", tags=["Advanced Search"])
    def export_advanced_search(
        project_id: int,
        entity: str = Query(...),
        tql: Optional[str] = Query(None, max_length=2000),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Export all matching rows (capped) for the query as a CSV download."""
        project = _require_project_access(current_user, project_id, db)
        _require_entity_enabled(project, entity)
        try:
            entity_key, rows = export_search(
                db=db,
                entity_key=entity,
                project_id=project_id,
                tql=tql,
                context=EvalContext(current_user_id=current_user.id),
            )
        except TQLError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

        buffer = io.StringIO()
        if rows:
            writer = csv.DictWriter(buffer, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            writer.writerows({k: _csv_safe(v) for k, v in row.items()} for row in rows)
        return Response(
            content=buffer.getvalue(),
            media_type="text/csv",
            headers={
                "Content-Disposition": f'attachment; filename="{entity_key}-search.csv"',
            },
        )

    # --- saved searches (persisted as SavedFilter, scope=advanced_search) -----

    @app.get("/advanced-search/saved", tags=["Advanced Search"])
    def list_saved_searches(
        project_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """List the user's saved searches (plus shared ones) for a project."""
        _require_project_access(current_user, project_id, db)
        rows = (
            db.query(models.SavedFilter)
            .filter(
                models.SavedFilter.project_id == project_id,
                models.SavedFilter.scope == SAVED_SEARCH_SCOPE,
                (models.SavedFilter.user_id == current_user.id)
                | (models.SavedFilter.is_shared.is_(True)),
            )
            .order_by(models.SavedFilter.name.asc())
            .all()
        )
        out = []
        for row in rows:
            view = _saved_search_view(row)
            view["is_owner"] = row.user_id == current_user.id
            out.append(view)
        return {"saved": out}

    @app.post("/advanced-search/saved", status_code=201, tags=["Advanced Search"])
    def create_saved_search(
        payload: SavedSearchCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Validate a query and persist it (text + structured AST) for reuse."""
        _require_project_access(current_user, payload.project_id, db)
        try:
            spec = get_entity(payload.entity)
            # Validate the query against the entity, and capture the AST.
            compile_tql(payload.tql, spec.registry, EvalContext(current_user_id=current_user.id))
            ast = ast_to_json(parse(payload.tql))
        except TQLError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

        name = payload.name.strip()
        existing = (
            db.query(models.SavedFilter)
            .filter(
                models.SavedFilter.user_id == current_user.id,
                models.SavedFilter.project_id == payload.project_id,
                models.SavedFilter.scope == SAVED_SEARCH_SCOPE,
                models.SavedFilter.name == name,
            )
            .first()
        )
        definition = {"entity": payload.entity, "tql": payload.tql, "ast": ast}
        if existing is not None:
            existing.definition = definition
            existing.is_shared = payload.is_shared
            row = existing
        else:
            row = models.SavedFilter(
                user_id=current_user.id,
                project_id=payload.project_id,
                scope=SAVED_SEARCH_SCOPE,
                name=name,
                definition=definition,
                is_shared=payload.is_shared,
            )
            db.add(row)
        safe_commit(db)
        db.refresh(row)
        view = _saved_search_view(row)
        view["is_owner"] = True
        return view

    @app.delete("/advanced-search/saved/{saved_id}", status_code=204, tags=["Advanced Search"])
    def delete_saved_search(
        saved_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Delete one of the user's own saved searches."""
        row = (
            db.query(models.SavedFilter)
            .filter(
                models.SavedFilter.id == saved_id,
                models.SavedFilter.scope == SAVED_SEARCH_SCOPE,
            )
            .first()
        )
        if row is None:
            raise HTTPException(status_code=404, detail="Saved search not found")
        if row.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="You can only delete your own saved searches")
        db.delete(row)
        safe_commit(db)
        return Response(status_code=204)
