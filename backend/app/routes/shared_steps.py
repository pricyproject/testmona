"""
Shared steps and shared step templates routes.
"""

from fastapi import Depends, HTTPException, Path, Query
from sqlalchemy.orm import Session
from typing import List, Optional
import logging

from .. import crud, schemas, auth, rbac
from ..feature_guard import require_project_feature
from ..database import get_db
from ..auth import get_current_active_user

logger = logging.getLogger(__name__)


def register_shared_steps_routes(app):
    """Register shared steps routes with the FastAPI app."""

    def require_project_exists(db: Session, project_id: int):
        from ..models import Project
        project = db.query(Project).filter(Project.id == project_id).first()
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        return project
    
    # Shared Steps Endpoints
    @app.post("/shared-steps/", response_model=schemas.SharedStep,
              dependencies=[Depends(require_project_feature("shared_steps"))])
    def create_shared_step(
        step: schemas.SharedStepCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        require_project_exists(db, step.project_id)
        if not rbac.has_permission(current_user, "write", step.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        step_data = step.model_dump()
        step_data["created_by"] = current_user.id
        step_data["is_active"] = True
        step_data["usage_count"] = 0
        db_step = crud.create_shared_step(db=db, step=step_data)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.CREATE.value,
                entity_type=EntityType.SHARED_STEP.value,
                entity_id=db_step.id,
                project_id=db_step.project_id,
                description=f"Shared step created: {db_step.name or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception:
            logger.exception("Failed to create audit trail for shared step creation")
        
        return db_step

    @app.get("/shared-steps/", response_model=List[schemas.SharedStep],
             dependencies=[Depends(require_project_feature("shared_steps"))])
    def read_shared_steps(
        project_id: Optional[int] = Query(None, ge=1),
        skip: int = Query(0, ge=0),
        limit: int = Query(100, ge=1, le=1000),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if project_id is not None:
            require_project_exists(db, project_id)
            if not rbac.has_permission(current_user, "read", project_id, db):
                raise HTTPException(status_code=403, detail="Insufficient permissions")
            return crud.get_shared_steps(db, project_id=project_id, skip=skip, limit=limit)

        accessible_project_ids = [project.id for project in rbac.get_accessible_projects(current_user, db)]
        return crud.get_shared_steps(db, project_ids=accessible_project_ids, skip=skip, limit=limit)

    @app.get("/shared-steps/{step_id}", response_model=schemas.SharedStep)
    def read_shared_step(
        step_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        step = crud.get_shared_step(db, step_id=step_id)
        if step is None:
            raise HTTPException(status_code=404, detail="Shared step not found")
        
        if not rbac.has_permission(current_user, "read", step.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return step

    @app.put("/shared-steps/{step_id}", response_model=schemas.SharedStep)
    def update_shared_step(
        step: schemas.SharedStepUpdate,
        step_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_step = crud.get_shared_step(db, step_id=step_id)
        if db_step is None:
            raise HTTPException(status_code=404, detail="Shared step not found")
        
        if not rbac.has_permission(current_user, "write", db_step.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        db_step = crud.update_shared_step(db, step_id=step_id, step=step.model_dump(exclude_unset=True))
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.UPDATE.value,
                entity_type=EntityType.SHARED_STEP.value,
                entity_id=db_step.id,
                project_id=db_step.project_id,
                description=f"Shared step updated: {db_step.name or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception:
            logger.exception("Failed to create audit trail for shared step update")
        
        return db_step

    @app.delete("/shared-steps/{step_id}")
    def delete_shared_step(
        step_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_step = crud.get_shared_step(db, step_id=step_id)
        if db_step is None:
            raise HTTPException(status_code=404, detail="Shared step not found")
        
        if not rbac.has_permission(current_user, "delete", db_step.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        # Store data for audit trail before deletion
        step_id_val = db_step.id
        step_name = db_step.name
        project_id = db_step.project_id
        
        crud.delete_shared_step(db, step_id=step_id)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.DELETE.value,
                entity_type=EntityType.SHARED_STEP.value,
                entity_id=step_id_val,
                project_id=project_id,
                description=f"Shared step deleted: {step_name or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception:
            logger.exception("Failed to create audit trail for shared step deletion")
        
        return {"message": "Shared step deleted successfully"}

    @app.post("/shared-steps/{step_id}/increment-usage")
    def increment_shared_step_usage(
        step_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_step = crud.get_shared_step(db, step_id=step_id)
        if db_step is None:
            raise HTTPException(status_code=404, detail="Shared step not found")

        if not rbac.has_permission(current_user, "write", db_step.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        step = crud.increment_shared_step_usage(db, step_id=step_id)
        if step is None:
            raise HTTPException(status_code=404, detail="Shared step not found")
        
        return {"message": "Usage count incremented", "usage_count": step.usage_count}

    # Shared Step Templates Endpoints
    @app.post("/shared-step-templates/", response_model=schemas.SharedStepTemplate)
    def create_shared_step_template(
        template: schemas.SharedStepTemplateCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "write"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        existing_template = crud.get_shared_step_template_by_name(db, template.name)
        if existing_template is not None:
            raise HTTPException(status_code=400, detail="Shared step template name already exists")

        template_data = template.model_dump()
        template_data["created_by"] = current_user.id
        db_template = crud.create_shared_step_template(db=db, template=template_data)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.CREATE.value,
                entity_type=EntityType.SHARED_STEP_TEMPLATE.value,
                entity_id=db_template.id,
                project_id=None,
                description=f"Shared step template created: {db_template.name or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception:
            logger.exception("Failed to create audit trail for shared step template creation")
        
        return db_template

    @app.get("/shared-step-templates/", response_model=List[schemas.SharedStepTemplate])
    def read_shared_step_templates(
        skip: int = Query(0, ge=0),
        limit: int = Query(100, ge=1, le=1000),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "read"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        return crud.get_shared_step_templates(db, skip=skip, limit=limit)

    @app.get("/shared-step-templates/{template_id}", response_model=schemas.SharedStepTemplate)
    def read_shared_step_template(
        template_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        template = crud.get_shared_step_template(db, template_id=template_id)
        if template is None:
            raise HTTPException(status_code=404, detail="Shared step template not found")
        
        if not rbac.has_permission(current_user, "read"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return template

    @app.put("/shared-step-templates/{template_id}", response_model=schemas.SharedStepTemplate)
    def update_shared_step_template(
        template: schemas.SharedStepTemplateUpdate,
        template_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_template = crud.get_shared_step_template(db, template_id=template_id)
        if db_template is None:
            raise HTTPException(status_code=404, detail="Shared step template not found")
        
        if not rbac.has_permission(current_user, "write"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        if template.name is not None:
            existing_template = crud.get_shared_step_template_by_name(db, template.name)
            if existing_template is not None and existing_template.id != template_id:
                raise HTTPException(status_code=400, detail="Shared step template name already exists")

        db_template = crud.update_shared_step_template(
            db,
            template_id=template_id,
            template=template.model_dump(exclude_unset=True),
        )
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.UPDATE.value,
                entity_type=EntityType.SHARED_STEP_TEMPLATE.value,
                entity_id=db_template.id,
                project_id=None,
                description=f"Shared step template updated: {db_template.name or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception:
            logger.exception("Failed to create audit trail for shared step template update")
        
        return db_template

    @app.delete("/shared-step-templates/{template_id}")
    def delete_shared_step_template(
        template_id: int = Path(..., ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_template = crud.get_shared_step_template(db, template_id=template_id)
        if db_template is None:
            raise HTTPException(status_code=404, detail="Shared step template not found")
        
        if not rbac.has_permission(current_user, "delete"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        # Store data for audit trail before deletion
        template_id_val = db_template.id
        template_name = db_template.name

        crud.delete_shared_step_template(db, template_id=template_id)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.DELETE.value,
                entity_type=EntityType.SHARED_STEP_TEMPLATE.value,
                entity_id=template_id_val,
                project_id=None,
                description=f"Shared step template deleted: {template_name or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception:
            logger.exception("Failed to create audit trail for shared step template deletion")
        
        return {"message": "Shared step template deleted successfully"}
