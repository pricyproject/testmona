"""
Definition routes for test type and priority definitions.

These catalogs are per-project: each project owns its own test types / priorities,
lazily seeded from sensible defaults on first read. Pass ``project_id`` to scope a
request to a project (the per-project UI always does); omitting it falls back to the
legacy unscoped listing for backwards compatibility.
"""

from fastapi import Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional

from .. import crud, schemas, auth, rbac
from ..database import get_db
from ..auth import get_current_active_user


def register_definitions_routes(app):
    """Register definition routes with the FastAPI app."""

    def _require_project_write(current_user, project_id, db):
        if project_id is not None and not rbac.has_permission(current_user, "write", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        if project_id is None and not rbac.has_permission(current_user, "write"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

    # Test Type Definition Endpoints
    @app.post("/test-type-definitions/", response_model=schemas.TestTypeDefinition)
    def create_test_type_definition(
        test_type: schemas.TestTypeDefinitionCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        _require_project_write(current_user, test_type.project_id, db)
        return crud.create_test_type_definition(db=db, test_type=test_type)

    @app.get("/test-type-definitions/", response_model=List[schemas.TestTypeDefinition])
    def read_test_type_definitions(
        project_id: Optional[int] = Query(None),
        skip: int = 0,
        limit: int = 100,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if project_id is not None:
            if not rbac.has_permission(current_user, "read", project_id, db):
                raise HTTPException(status_code=403, detail="Insufficient permissions")
            # Seed this project's defaults on first access.
            crud.ensure_default_priority_and_test_type_definitions(db, project_id, current_user.id)
        elif not rbac.has_permission(current_user, "read"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return crud.get_test_type_definitions(db, skip=skip, limit=limit, project_id=project_id)

    @app.get("/test-type-definitions/{test_type_id}", response_model=schemas.TestTypeDefinition)
    def read_test_type_definition(
        test_type_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        test_type = crud.get_test_type_definition(db, test_type_id=test_type_id)
        if test_type is None:
            raise HTTPException(status_code=404, detail="Test type definition not found")
        return test_type

    @app.put("/test-type-definitions/{test_type_id}", response_model=schemas.TestTypeDefinition)
    def update_test_type_definition(
        test_type_id: int,
        test_type: schemas.TestTypeDefinitionUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        existing = crud.get_test_type_definition(db, test_type_id=test_type_id)
        if existing is None:
            raise HTTPException(status_code=404, detail="Test type definition not found")
        _require_project_write(current_user, existing.project_id, db)
        return crud.update_test_type_definition(db, test_type_id=test_type_id, test_type=test_type)

    @app.delete("/test-type-definitions/{test_type_id}")
    def delete_test_type_definition(
        test_type_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        existing = crud.get_test_type_definition(db, test_type_id=test_type_id)
        if existing is None:
            raise HTTPException(status_code=404, detail="Test type definition not found")
        _require_project_write(current_user, existing.project_id, db)
        crud.delete_test_type_definition(db, test_type_id=test_type_id)
        return {"message": "Test type definition deleted successfully"}

    # Priority Definition Endpoints
    @app.post("/priority-definitions/", response_model=schemas.PriorityDefinition)
    def create_priority_definition(
        priority: schemas.PriorityDefinitionCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        _require_project_write(current_user, priority.project_id, db)
        return crud.create_priority_definition(db=db, priority=priority)

    @app.get("/priority-definitions/", response_model=List[schemas.PriorityDefinition])
    def read_priority_definitions(
        project_id: Optional[int] = Query(None),
        skip: int = 0,
        limit: int = 100,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if project_id is not None:
            if not rbac.has_permission(current_user, "read", project_id, db):
                raise HTTPException(status_code=403, detail="Insufficient permissions")
            crud.ensure_default_priority_and_test_type_definitions(db, project_id, current_user.id)
        elif not rbac.has_permission(current_user, "read"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return crud.get_priority_definitions(db, skip=skip, limit=limit, project_id=project_id)

    @app.get("/priority-definitions/{priority_id}", response_model=schemas.PriorityDefinition)
    def read_priority_definition(
        priority_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        priority = crud.get_priority_definition(db, priority_id=priority_id)
        if priority is None:
            raise HTTPException(status_code=404, detail="Priority definition not found")
        return priority

    @app.put("/priority-definitions/{priority_id}", response_model=schemas.PriorityDefinition)
    def update_priority_definition(
        priority_id: int,
        priority: schemas.PriorityDefinitionUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        existing = crud.get_priority_definition(db, priority_id=priority_id)
        if existing is None:
            raise HTTPException(status_code=404, detail="Priority definition not found")
        _require_project_write(current_user, existing.project_id, db)
        return crud.update_priority_definition(db, priority_id=priority_id, priority=priority)

    @app.delete("/priority-definitions/{priority_id}")
    def delete_priority_definition(
        priority_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        existing = crud.get_priority_definition(db, priority_id=priority_id)
        if existing is None:
            raise HTTPException(status_code=404, detail="Priority definition not found")
        _require_project_write(current_user, existing.project_id, db)
        crud.delete_priority_definition(db, priority_id=priority_id)
        return {"message": "Priority definition deleted successfully"}
