"""
Remaining routes for execution environments, additional analytics endpoints, and audit trails.
"""

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from .. import crud, models, schemas, rbac
from ..feature_guard import require_project_feature
from ..database import get_db
from ..auth import get_current_active_user


def register_remaining_routes(app):
    """Register remaining routes with the FastAPI app."""

    def _readable_project_ids(current_user: schemas.User, db: Session) -> List[int]:
        return [project.id for project in rbac.get_accessible_projects(current_user, db)]

    def _get_authorized_environments(
        current_user: schemas.User,
        db: Session,
        project_id: int = None,
    ) -> List[models.ExecutionEnvironment]:
        if project_id is not None:
            if not rbac.has_permission(current_user, "read", project_id, db):
                raise HTTPException(status_code=403, detail="Insufficient permissions")
            return crud.get_execution_environments(db, project_id=project_id)

        project_ids = _readable_project_ids(current_user, db)
        if not project_ids:
            return []
        return db.query(models.ExecutionEnvironment).filter(
            models.ExecutionEnvironment.project_id.in_(project_ids)
        ).all()

    # Execution Environment Endpoints
    @app.get("/execution-environments/", response_model=List[schemas.ExecutionEnvironment])
    def get_execution_environments(
        project_id: int = None,
        skip: int = 0,
        limit: int = 100,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        environments = _get_authorized_environments(current_user, db, project_id)
        return environments[skip:skip+limit]

    @app.get("/execution-environments/{environment_id}", response_model=schemas.ExecutionEnvironment)
    def get_execution_environment(
        environment_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        environment = crud.get_execution_environment(db, environment_id=environment_id)
        if environment is None:
            raise HTTPException(status_code=404, detail="Environment not found")
        
        if not rbac.has_permission(current_user, "read", environment.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return environment

    @app.post("/execution-environments/", response_model=schemas.ExecutionEnvironment)
    def create_execution_environment(
        environment: schemas.ExecutionEnvironmentCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "write", environment.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        db_environment = crud.create_execution_environment(db, environment.model_dump())
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.CREATE.value,
                entity_type=EntityType.EXECUTION_ENVIRONMENT.value,
                entity_id=db_environment.id,
                project_id=db_environment.project_id,
                description=f"Execution environment created: {environment.name or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for execution environment creation: {e}")
        
        return db_environment

    @app.put("/execution-environments/{environment_id}", response_model=schemas.ExecutionEnvironment)
    def update_execution_environment(
        environment_id: int,
        environment: schemas.ExecutionEnvironmentUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_environment = crud.get_execution_environment(db, environment_id=environment_id)
        if db_environment is None:
            raise HTTPException(status_code=404, detail="Environment not found")
        
        if not rbac.has_permission(current_user, "write", db_environment.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        update_data = environment.model_dump(exclude_unset=True)
        db_environment = crud.update_execution_environment(db, environment_id, update_data)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.UPDATE.value,
                entity_type=EntityType.EXECUTION_ENVIRONMENT.value,
                entity_id=db_environment.id,
                project_id=db_environment.project_id,
                description=f"Execution environment updated: {db_environment.name or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for execution environment update: {e}")
        
        return db_environment

    @app.delete("/execution-environments/{environment_id}")
    def delete_execution_environment(
        environment_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_environment = crud.get_execution_environment(db, environment_id=environment_id)
        if db_environment is None:
            raise HTTPException(status_code=404, detail="Environment not found")
        
        if not rbac.has_permission(current_user, "delete", db_environment.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        # Store data for audit trail before deletion
        environment_id_val = db_environment.id
        environment_name = db_environment.name
        project_id = db_environment.project_id
        
        crud.delete_execution_environment(db, environment_id)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.DELETE.value,
                entity_type=EntityType.EXECUTION_ENVIRONMENT.value,
                entity_id=environment_id_val,
                project_id=project_id,
                description=f"Execution environment deleted: {environment_name or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for execution environment deletion: {e}")
        
        return {"message": "Environment deleted successfully"}

    # Environments Endpoints (for frontend compatibility)
    @app.get("/environments", response_model=List[schemas.ExecutionEnvironment],
             dependencies=[Depends(require_project_feature("environments"))])
    def get_environments(
        project_id: int = None,
        skip: int = 0,
        limit: int = 100,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Get environments - endpoint to match frontend expectations"""
        environments = _get_authorized_environments(current_user, db, project_id)
        return environments[skip:skip+limit]

    @app.get("/environments/{environment_id}", response_model=schemas.ExecutionEnvironment)
    def get_environment(
        environment_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Get environment by ID - endpoint to match frontend expectations"""
        environment = crud.get_execution_environment(db, environment_id=environment_id)
        if environment is None:
            raise HTTPException(status_code=404, detail="Environment not found")
        
        if not rbac.has_permission(current_user, "read", environment.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return environment

    @app.post("/environments", response_model=schemas.ExecutionEnvironment,
              dependencies=[Depends(require_project_feature("environments"))])
    def create_environment(
        environment: schemas.ExecutionEnvironmentCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Create environment - endpoint to match frontend expectations"""
        if not rbac.has_permission(current_user, "write", environment.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return crud.create_execution_environment(db, environment.model_dump())

    @app.put("/environments/{environment_id}", response_model=schemas.ExecutionEnvironment)
    def update_environment(
        environment_id: int,
        environment: schemas.ExecutionEnvironmentUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Update environment - endpoint to match frontend expectations"""
        db_environment = crud.get_execution_environment(db, environment_id=environment_id)
        if db_environment is None:
            raise HTTPException(status_code=404, detail="Environment not found")
        
        if not rbac.has_permission(current_user, "write", db_environment.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        update_data = environment.model_dump(exclude_unset=True)
        return crud.update_execution_environment(db, environment_id, update_data)

    @app.delete("/environments/{environment_id}")
    def delete_environment(
        environment_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Delete environment - endpoint to match frontend expectations"""
        db_environment = crud.get_execution_environment(db, environment_id=environment_id)
        if db_environment is None:
            raise HTTPException(status_code=404, detail="Environment not found")
        
        if not rbac.has_permission(current_user, "delete", db_environment.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        crud.delete_execution_environment(db, environment_id)
        return {"message": "Environment deleted successfully"}

    # Audit Endpoint
    @app.get("/audit/project-activity-summary")
    def get_project_activity_summary_direct(
        project_id: int,
        days: int = 7,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Get project activity summary - direct endpoint to match frontend expectations"""
        if days < 1 or days > 365:
            raise HTTPException(status_code=400, detail="days must be between 1 and 365")
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        # Import the audit service
        from ..services.audit_service import get_audit_service
        audit_service = get_audit_service(db)
        
        # Get the activity summary from the audit service
        summary = audit_service.get_project_activity_summary(project_id, days)
        return summary
