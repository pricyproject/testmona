import logging
from typing import Optional

from fastapi import Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from .. import models, rbac, schemas
from ..auth import get_current_active_user
from ..database import get_db
from ..feature_guard import require_project_feature
from ..services import test_asset_health_service as health_service

logger = logging.getLogger(__name__)

DEBT_TYPE_PATTERN = "^(stale|duplicate|orphan|always_pass|never_run|no_requirement_link)$"
SEVERITY_PATTERN = "^(low|medium|high|critical)$"


def _ensure_project_access(db: Session, current_user, project_id: int, permission: str) -> models.Project:
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    if not rbac.has_permission(current_user, permission, project_id, db):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    return project


def register_test_asset_health_routes(app):
    dependencies = [Depends(require_project_feature("test_asset_health"))]

    @app.get(
        "/projects/{project_id}/test-asset-health/summary",
        response_model=schemas.TestAssetHealthSummary,
        dependencies=dependencies,
    )
    def read_test_asset_health_summary(
        project_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        _ensure_project_access(db, current_user, project_id, "read")
        return health_service.get_health_summary(db, project_id)

    @app.get(
        "/projects/{project_id}/test-asset-health/debt-items",
        response_model=list[schemas.TestDebtItem],
        dependencies=dependencies,
    )
    def read_test_debt_items(
        project_id: int,
        response: Response,
        debt_type: Optional[str] = Query(None, pattern=DEBT_TYPE_PATTERN),
        severity: Optional[str] = Query(None, pattern=SEVERITY_PATTERN),
        resolved: str = Query("active", pattern="^(active|resolved|all)$"),
        skip: int = Query(0, ge=0),
        limit: int = Query(100, ge=1, le=500),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        _ensure_project_access(db, current_user, project_id, "read")
        items, total = health_service.list_test_debt_items(
            db,
            project_id=project_id,
            debt_type=debt_type,
            severity=severity,
            resolved=resolved,
            skip=skip,
            limit=limit,
        )
        response.headers["X-Total-Count"] = str(total)
        return items

    @app.post(
        "/projects/{project_id}/test-asset-health/debt-items",
        response_model=schemas.TestDebtItem,
        dependencies=dependencies,
    )
    def create_test_debt_item(
        project_id: int,
        payload: schemas.TestDebtItemCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        _ensure_project_access(db, current_user, project_id, "write")
        try:
            return health_service.create_test_debt_item(db, project_id=project_id, payload=payload)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.patch(
        "/projects/{project_id}/test-asset-health/debt-items/{item_id}",
        response_model=schemas.TestDebtItem,
        dependencies=dependencies,
    )
    def update_test_debt_item(
        project_id: int,
        item_id: int,
        payload: schemas.TestDebtItemUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        _ensure_project_access(db, current_user, project_id, "write")
        item = health_service.get_test_debt_item(db, project_id, item_id)
        if item is None:
            raise HTTPException(status_code=404, detail="Test debt item not found")
        return health_service.update_test_debt_item(db, item, payload)

    @app.post(
        "/projects/{project_id}/test-asset-health/debt-items/{item_id}/resolve",
        response_model=schemas.TestDebtItem,
        dependencies=dependencies,
    )
    def resolve_test_debt_item(
        project_id: int,
        item_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        _ensure_project_access(db, current_user, project_id, "write")
        item = health_service.get_test_debt_item(db, project_id, item_id)
        if item is None:
            raise HTTPException(status_code=404, detail="Test debt item not found")
        return health_service.resolve_test_debt_item(db, item)

    @app.post(
        "/projects/{project_id}/test-asset-health/debt-items/bulk-resolve",
        response_model=schemas.TestDebtBulkResolveResult,
        dependencies=dependencies,
    )
    def bulk_resolve_test_debt_items(
        project_id: int,
        payload: schemas.TestDebtBulkResolve,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        _ensure_project_access(db, current_user, project_id, "write")
        resolved = health_service.bulk_resolve_test_debt_items(db, project_id, payload.item_ids)
        return {"resolved": resolved, "summary": health_service.get_health_summary(db, project_id)}

    @app.post(
        "/projects/{project_id}/test-asset-health/detect",
        response_model=schemas.TestAssetDebtDetectionResult,
        dependencies=dependencies,
    )
    def detect_test_asset_debt(
        project_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        _ensure_project_access(db, current_user, project_id, "write")
        try:
            return health_service.detect_test_asset_debt(db, project_id)
        except Exception:
            logger.exception("Failed to detect test asset debt", extra={"project_id": project_id})
            raise HTTPException(status_code=500, detail="Failed to detect test asset debt")
