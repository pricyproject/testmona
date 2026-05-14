"""
Requirements, defects, test plans, and milestones routes for test planning and quality management.
"""

from fastapi import Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from typing import List, Optional
from datetime import datetime, timezone

from .. import crud, schemas, auth, rbac
from ..database import get_db
from ..auth import get_current_active_user
from ..services.milestone_service import enrich_milestone, enrich_milestones, get_project_milestone_stats
from ..crud import (
    create_requirement, get_requirements, get_requirement, update_requirement, delete_requirement,
    create_defect, get_defects, get_defect, update_defect, delete_defect,
    create_test_plan, get_test_plans, get_test_plan, update_test_plan, delete_test_plan,
    create_milestone, get_milestones, get_milestone, update_milestone, delete_milestone
)


def register_requirements_defects_plans_routes(app):
    """Register requirements, defects, test plans, and milestones routes with the FastAPI app."""
    
    # Requirements Endpoints
    @app.post("/requirements", response_model=schemas.Requirement)
    def create_requirement_endpoint(
        requirement: schemas.RequirementCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "write", requirement.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        try:
            db_requirement = create_requirement(db=db, requirement=requirement)
            
            # Create audit trail
            try:
                from ..services.audit_service import get_audit_service
                from ..schemas_audit import AuditTrailCreate
                from ..models import AuditAction, EntityType
                audit_service = get_audit_service(db)
                audit_data = AuditTrailCreate(
                    user_id=current_user.id if current_user else None,
                    action=AuditAction.CREATE.value,
                    entity_type=EntityType.REQUIREMENT.value,
                    entity_id=db_requirement.id,
                    project_id=db_requirement.project_id,
                    description=f"Requirement created: {db_requirement.title or 'Untitled'}",
                )
                audit_service.create_audit_trail(audit_data)
            except Exception as e:
                print(f"Failed to create audit trail for requirement creation: {e}")
            
            return db_requirement
        except IntegrityError as e:
            db.rollback()
            if "requirements.requirement_id" in str(e):
                raise HTTPException(status_code=400, detail="Requirement ID already exists. Please use a unique ID.")
            raise HTTPException(status_code=400, detail="Failed to create requirement due to a database constraint violation.")
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    @app.get("/requirements", response_model=List[schemas.Requirement])
    def read_requirements(
        project_id: int,
        skip: int = 0,
        limit: int = 100,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        return get_requirements(db, project_id=project_id, skip=skip, limit=limit)

    @app.get("/requirements/{requirement_id}", response_model=schemas.Requirement)
    def read_requirement(
        requirement_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        requirement = get_requirement(db, requirement_id=requirement_id)
        if requirement is None:
            raise HTTPException(status_code=404, detail="Requirement not found")

        if not rbac.has_permission(current_user, "read", requirement.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        return requirement

    @app.put("/requirements/{requirement_id}", response_model=schemas.Requirement)
    def update_requirement_endpoint(
        requirement_id: int,
        requirement: schemas.RequirementUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_requirement = get_requirement(db, requirement_id=requirement_id)
        if db_requirement is None:
            raise HTTPException(status_code=404, detail="Requirement not found")

        if not rbac.has_permission(current_user, "write", db_requirement.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        try:
            db_requirement = update_requirement(db, requirement_id=requirement_id, requirement=requirement)
            
            # Create audit trail
            try:
                from ..services.audit_service import get_audit_service
                from ..schemas_audit import AuditTrailCreate
                from ..models import AuditAction, EntityType
                audit_service = get_audit_service(db)
                audit_data = AuditTrailCreate(
                    user_id=current_user.id if current_user else None,
                    action=AuditAction.UPDATE.value,
                    entity_type=EntityType.REQUIREMENT.value,
                    entity_id=db_requirement.id,
                    project_id=db_requirement.project_id,
                    description=f"Requirement updated: {db_requirement.title or 'Untitled'}",
                )
                audit_service.create_audit_trail(audit_data)
            except Exception as e:
                print(f"Failed to create audit trail for requirement update: {e}")
            
            return db_requirement
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    @app.delete("/requirements/{requirement_id}")
    def delete_requirement_endpoint(
        requirement_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_requirement = get_requirement(db, requirement_id=requirement_id)
        if db_requirement is None:
            raise HTTPException(status_code=404, detail="Requirement not found")

        if not rbac.has_permission(current_user, "delete", db_requirement.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        # Store data for audit trail before deletion
        req_id = db_requirement.id
        req_title = db_requirement.title
        project_id = db_requirement.project_id
        
        delete_requirement(db, requirement_id=requirement_id)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.DELETE.value,
                entity_type=EntityType.REQUIREMENT.value,
                entity_id=req_id,
                project_id=project_id,
                description=f"Requirement deleted: {req_title or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for requirement deletion: {e}")
        
        return {"message": "Requirement deleted successfully"}

    # Defects Endpoints
    @app.post("/defects", response_model=schemas.Defect)
    def create_defect_endpoint(
        defect: schemas.DefectCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "write", defect.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        defect = defect.model_copy(update={"reported_by": current_user.id})
        db_defect = create_defect(db=db, defect=defect)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.CREATE.value,
                entity_type=EntityType.DEFECT.value,
                entity_id=db_defect.id,
                project_id=db_defect.project_id,
                description=f"Defect created: {db_defect.title or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for defect creation: {e}")
        
        return db_defect

    @app.get("/defects", response_model=List[schemas.Defect])
    def read_defects(
        project_id: int,
        skip: int = 0,
        limit: int = 100,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        return get_defects(db, project_id=project_id, skip=skip, limit=limit)

    @app.get("/defects/{defect_id}", response_model=schemas.Defect)
    def read_defect(
        defect_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        defect = get_defect(db, defect_id=defect_id)
        if defect is None:
            raise HTTPException(status_code=404, detail="Defect not found")

        if not rbac.has_permission(current_user, "read", defect.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        return defect

    @app.put("/defects/{defect_id}", response_model=schemas.Defect)
    def update_defect_endpoint(
        defect_id: int,
        defect: schemas.DefectUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_defect = get_defect(db, defect_id=defect_id)
        if db_defect is None:
            raise HTTPException(status_code=404, detail="Defect not found")

        if not rbac.has_permission(current_user, "write", db_defect.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        db_defect = update_defect(db, defect_id=defect_id, defect=defect)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.UPDATE.value,
                entity_type=EntityType.DEFECT.value,
                entity_id=db_defect.id,
                project_id=db_defect.project_id,
                description=f"Defect updated: {db_defect.title or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for defect update: {e}")
        
        return db_defect

    @app.delete("/defects/{defect_id}")
    def delete_defect_endpoint(
        defect_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_defect = get_defect(db, defect_id=defect_id)
        if db_defect is None:
            raise HTTPException(status_code=404, detail="Defect not found")

        if not rbac.has_permission(current_user, "delete", db_defect.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        # Store data for audit trail before deletion
        defect_id_val = db_defect.id
        defect_title = db_defect.title
        project_id = db_defect.project_id
        
        delete_defect(db, defect_id=defect_id)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.DELETE.value,
                entity_type=EntityType.DEFECT.value,
                entity_id=defect_id_val,
                project_id=project_id,
                description=f"Defect deleted: {defect_title or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for defect deletion: {e}")
        
        return {"message": "Defect deleted successfully"}

    # Test Plans Endpoints
    @app.post("/test-plans", response_model=schemas.TestPlan)
    def create_test_plan_endpoint(
        test_plan: schemas.TestPlanCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "write", test_plan.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        db_test_plan = create_test_plan(db=db, test_plan=test_plan)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.CREATE.value,
                entity_type=EntityType.TEST_PLAN.value,
                entity_id=db_test_plan.id,
                project_id=db_test_plan.project_id,
                description=f"Test plan created: {db_test_plan.title or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for test plan creation: {e}")
        
        return db_test_plan

    @app.get("/test-plans")
    def read_test_plans(
        project_id: Optional[int] = None,
        milestone_id: Optional[int] = None,
        skip: int = 0,
        limit: int = 100,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if project_id is not None and not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        test_plans = get_test_plans(db, project_id=project_id, skip=skip, limit=limit)
        if milestone_id is not None:
            test_plans = [tp for tp in test_plans if tp.milestone_id == milestone_id]
        return [
            {
                "id": tp.id,
                "title": tp.title,
                "description": tp.description,
                "project_id": tp.project_id,
                "milestone_id": tp.milestone_id,
                "created_by": tp.created_by,
                "status": tp.status.value if tp.status else None,
                "target_start_date": tp.target_start_date,
                "target_end_date": tp.target_end_date,
                "actual_start_date": tp.actual_start_date,
                "actual_end_date": tp.actual_end_date,
                "test_objectives": tp.test_objectives,
                "scope_inclusions": tp.scope_inclusions,
                "scope_exclusions": tp.scope_exclusions,
                "test_environment": tp.test_environment,
                "entry_criteria": tp.entry_criteria,
                "exit_criteria": tp.exit_criteria,
                "risks_assumptions": tp.risks_assumptions,
                "created_at": tp.created_at,
                "updated_at": tp.updated_at
            }
            for tp in test_plans
        ]

    @app.get("/test-plans/{test_plan_id}")
    def read_test_plan_endpoint(
        test_plan_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        test_plan = get_test_plan(db, test_plan_id=test_plan_id)
        if test_plan is None:
            raise HTTPException(status_code=404, detail="Test plan not found")

        if not rbac.has_permission(current_user, "read", test_plan.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        return {
            "id": test_plan.id,
            "title": test_plan.title,
            "description": test_plan.description,
            "project_id": test_plan.project_id,
            "milestone_id": test_plan.milestone_id,
            "created_by": test_plan.created_by,
            "status": test_plan.status.value if test_plan.status else None,
            "target_start_date": test_plan.target_start_date,
            "target_end_date": test_plan.target_end_date,
            "actual_start_date": test_plan.actual_start_date,
            "actual_end_date": test_plan.actual_end_date,
            "test_objectives": test_plan.test_objectives,
            "scope_inclusions": test_plan.scope_inclusions,
            "scope_exclusions": test_plan.scope_exclusions,
            "test_environment": test_plan.test_environment,
            "entry_criteria": test_plan.entry_criteria,
            "exit_criteria": test_plan.exit_criteria,
            "risks_assumptions": test_plan.risks_assumptions,
            "created_at": test_plan.created_at,
            "updated_at": test_plan.updated_at
        }

    @app.put("/test-plans/{test_plan_id}", response_model=schemas.TestPlan)
    def update_test_plan_endpoint(
        test_plan_id: int,
        test_plan: schemas.TestPlanUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_test_plan = get_test_plan(db, test_plan_id=test_plan_id)
        if db_test_plan is None:
            raise HTTPException(status_code=404, detail="Test plan not found")

        if not rbac.has_permission(current_user, "write", db_test_plan.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        db_test_plan = update_test_plan(db, test_plan_id=test_plan_id, test_plan=test_plan)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.UPDATE.value,
                entity_type=EntityType.TEST_PLAN.value,
                entity_id=db_test_plan.id,
                project_id=db_test_plan.project_id,
                description=f"Test plan updated: {db_test_plan.title or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for test plan update: {e}")
        
        return db_test_plan

    @app.delete("/test-plans/{test_plan_id}")
    def delete_test_plan_endpoint(
        test_plan_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_test_plan = get_test_plan(db, test_plan_id=test_plan_id)
        if db_test_plan is None:
            raise HTTPException(status_code=404, detail="Test plan not found")

        if not rbac.has_permission(current_user, "delete", db_test_plan.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        # Store data for audit trail before deletion
        plan_id = db_test_plan.id
        plan_title = db_test_plan.title
        project_id = db_test_plan.project_id
        
        delete_test_plan(db, test_plan_id=test_plan_id)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.DELETE.value,
                entity_type=EntityType.TEST_PLAN.value,
                entity_id=plan_id,
                project_id=project_id,
                description=f"Test plan deleted: {plan_title or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for test plan deletion: {e}")
        
        return {"message": "Test plan deleted successfully"}

    # Milestones Endpoints
    @app.post("/milestones", response_model=schemas.Milestone)
    def create_milestone_endpoint(
        milestone: schemas.MilestoneCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if milestone.project_id <= 0:
            raise HTTPException(status_code=400, detail="Invalid project_id")

        if not rbac.has_permission(current_user, "write", milestone.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        milestone_data = milestone.model_copy(update={"created_by": current_user.id})
        db_milestone = create_milestone(db=db, milestone=milestone_data)

        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.CREATE.value,
                entity_type=EntityType.MILESTONE.value,
                entity_id=db_milestone.id,
                project_id=db_milestone.project_id,
                description=f"Milestone created: {db_milestone.title or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for milestone creation: {e}")

        return enrich_milestone(db, db_milestone)

    @app.get("/milestones", response_model=List[schemas.Milestone])
    def read_milestones(
        project_id: int,
        skip: int = Query(0, ge=0),
        limit: int = Query(100, ge=1, le=500),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        milestones = get_milestones(db, project_id=project_id, skip=skip, limit=limit)
        return enrich_milestones(db, milestones)

    @app.get("/milestones/{milestone_id}", response_model=schemas.Milestone)
    def read_milestone_endpoint(
        milestone_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        milestone = get_milestone(db, milestone_id=milestone_id)
        if milestone is None:
            raise HTTPException(status_code=404, detail="Milestone not found")

        if not rbac.has_permission(current_user, "read", milestone.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        return enrich_milestone(db, milestone)

    @app.put("/milestones/{milestone_id}", response_model=schemas.Milestone)
    def update_milestone_endpoint(
        milestone_id: int,
        milestone: schemas.MilestoneUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_milestone = get_milestone(db, milestone_id=milestone_id)
        if db_milestone is None:
            raise HTTPException(status_code=404, detail="Milestone not found")

        if not rbac.has_permission(current_user, "write", db_milestone.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        update_data = milestone.model_dump(exclude_unset=True)
        if update_data.get("status") == schemas.MilestoneStatus.COMPLETED:
            update_data.setdefault("progress_percentage", 100)
            if not update_data.get("actual_date") and not db_milestone.actual_date:
                update_data["actual_date"] = datetime.now(timezone.utc)
        db_milestone = update_milestone(
            db,
            milestone_id=milestone_id,
            milestone=schemas.MilestoneUpdate(**update_data),
        )

        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.UPDATE.value,
                entity_type=EntityType.MILESTONE.value,
                entity_id=db_milestone.id,
                project_id=db_milestone.project_id,
                description=f"Milestone updated: {db_milestone.title or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for milestone update: {e}")

        return enrich_milestone(db, db_milestone)

    @app.delete("/milestones/{milestone_id}")
    def delete_milestone_endpoint(
        milestone_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_milestone = get_milestone(db, milestone_id=milestone_id)
        if db_milestone is None:
            raise HTTPException(status_code=404, detail="Milestone not found")

        if not rbac.has_permission(current_user, "delete", db_milestone.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        if db_milestone.test_plans:
            raise HTTPException(
                status_code=409,
                detail="Milestone has linked test plans. Unlink or move those plans before deleting it.",
            )

        milestone_id_val = db_milestone.id
        milestone_title = db_milestone.title
        project_id = db_milestone.project_id

        delete_milestone(db, milestone_id=milestone_id)

        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.DELETE.value,
                entity_type=EntityType.MILESTONE.value,
                entity_id=milestone_id_val,
                project_id=project_id,
                description=f"Milestone deleted: {milestone_title or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for milestone deletion: {e}")

        return {"message": "Milestone deleted successfully"}

    @app.get("/milestones/stats/{project_id}")
    def get_milestone_stats(
        project_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        return get_project_milestone_stats(db, project_id)

    @app.get("/milestones/{milestone_id}/test-plans")
    def get_milestone_test_plans(
        milestone_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        from ..models import Milestone, TestPlan

        milestone = db.query(Milestone).filter(Milestone.id == milestone_id).first()
        if not milestone:
            raise HTTPException(status_code=404, detail="Milestone not found")

        if not rbac.has_permission(current_user, "read", milestone.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        test_plans = db.query(TestPlan).filter(TestPlan.milestone_id == milestone_id).all()
        return [
            {
                "id": tp.id,
                "title": tp.title,
                "description": tp.description,
                "status": tp.status.value if tp.status else None,
                "target_start_date": tp.target_start_date,
                "target_end_date": tp.target_end_date
            }
            for tp in test_plans
        ]
