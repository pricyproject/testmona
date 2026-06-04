"""CRUD endpoints for reusable, project-scoped test datasets.

A dataset is a small named table (``parameters`` columns + ``rows``) that a
test case can attach to and iterate over during a run. See
:class:`app.models.TestDataset`.
"""

from __future__ import annotations

import logging
from typing import List, Optional

from fastapi import Depends, HTTPException, Path, Query
from sqlalchemy.orm import Session

from .. import crud, models, rbac, schemas
from ..feature_guard import require_project_feature
from ..auth import get_current_active_user
from ..database import get_db

logger = logging.getLogger(__name__)


def register_dataset_routes(app) -> None:

    @app.get("/test-datasets", response_model=List[schemas.TestDataset],
             dependencies=[Depends(require_project_feature("test_data"))])
    def list_test_datasets(
        project_id: int = Query(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return crud.get_test_datasets(db, project_id=project_id)

    @app.get("/test-datasets/{dataset_id}", response_model=schemas.TestDataset)
    def read_test_dataset(
        dataset_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        dataset = crud.get_test_dataset(db, dataset_id=dataset_id)
        if dataset is None:
            raise HTTPException(status_code=404, detail="Dataset not found")
        if not rbac.has_permission(current_user, "read", dataset.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return dataset

    @app.post("/test-datasets", response_model=schemas.TestDataset, status_code=201,
              dependencies=[Depends(require_project_feature("test_data"))])
    def create_test_dataset(
        payload: schemas.TestDatasetCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        if not rbac.has_permission(current_user, "write", payload.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Dataset name cannot be empty")
        if crud.get_test_dataset_by_name(db, name=name, project_id=payload.project_id) is not None:
            raise HTTPException(status_code=400, detail="A dataset with that name already exists in this project")

        data = payload.model_dump()
        data["name"] = name
        data["created_by"] = current_user.id
        return crud.create_test_dataset(db, dataset=data)

    @app.put("/test-datasets/{dataset_id}", response_model=schemas.TestDataset)
    def update_test_dataset(
        payload: schemas.TestDatasetUpdate,
        dataset_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        dataset = crud.get_test_dataset(db, dataset_id=dataset_id)
        if dataset is None:
            raise HTTPException(status_code=404, detail="Dataset not found")
        if not rbac.has_permission(current_user, "write", dataset.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        changes = payload.model_dump(exclude_unset=True)
        if "name" in changes and changes["name"] is not None:
            new_name = changes["name"].strip()
            if not new_name:
                raise HTTPException(status_code=400, detail="Dataset name cannot be empty")
            existing = crud.get_test_dataset_by_name(db, name=new_name, project_id=dataset.project_id)
            if existing is not None and existing.id != dataset.id:
                raise HTTPException(status_code=400, detail="A dataset with that name already exists in this project")
            changes["name"] = new_name

        # The validator normalizes parameters + rows together, so persist them
        # as a pair: changing columns without resending rows must not leave
        # stale row keys behind.
        if "parameters" in changes or "rows" in changes:
            changes["parameters"] = payload.parameters
            changes["rows"] = payload.rows

        return crud.update_test_dataset(db, dataset_id=dataset_id, dataset=changes)

    @app.delete("/test-datasets/{dataset_id}", status_code=204)
    def delete_test_dataset(
        dataset_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        dataset = crud.get_test_dataset(db, dataset_id=dataset_id)
        if dataset is None:
            raise HTTPException(status_code=404, detail="Dataset not found")
        if not rbac.has_permission(current_user, "write", dataset.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        crud.delete_test_dataset(db, dataset_id=dataset_id)
        return
