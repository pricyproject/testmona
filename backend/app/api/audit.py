from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from typing import Optional, List
from pydantic import ValidationError

from ..database import get_db
from ..services.audit_service import AuditService, get_audit_service
from ..schemas_audit import (
    AuditTrailResponse, AuditTrailList, AuditTrailFilter,
    ActivitySummary, EntityHistory, AuditTrailUpdate
)
from .. import crud_rbac, rbac
from ..auth import get_current_user
from ..models import AuditAction, EntityType

router = APIRouter()

@router.get("", response_model=AuditTrailList)
async def get_audit_trails(
    user_id: Optional[int] = Query(None, ge=1, description="Filter by user ID"),
    action: Optional[AuditAction] = Query(None, description="Filter by action"),
    entity_type: Optional[EntityType] = Query(None, description="Filter by entity type"),
    entity_id: Optional[int] = Query(None, ge=1, description="Filter by entity ID"),
    project_id: Optional[int] = Query(None, ge=1, description="Filter by project ID"),
    date_from: Optional[str] = Query(None, description="Filter by date from (YYYY-MM-DD)"),
    date_to: Optional[str] = Query(None, description="Filter by date to (YYYY-MM-DD)"),
    search: Optional[str] = Query(None, description="Search in description, entity type, and action"),
    limit: int = Query(50, ge=1, le=1000, description="Number of items to return"),
    offset: int = Query(0, ge=0, description="Number of items to skip"),
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
    audit_service: AuditService = Depends(get_audit_service)
):
    """
    Get audit trails with filtering and pagination.
    Requires view permissions for the requested entities.
    """
    # Validate project_id exists if provided
    if project_id:
        from ..models import Project
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

    # Validate user_id exists if provided
    if user_id:
        from ..models import User
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

    # Build filter object
    try:
        filters = AuditTrailFilter(
            user_id=user_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            project_id=project_id,
            date_from=date_from,
            date_to=date_to,
            search=search,
            limit=limit,
            offset=offset
        )
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc

    if filters.date_from and filters.date_to and filters.date_from > filters.date_to:
        raise HTTPException(status_code=400, detail="date_from cannot be after date_to")

    # Check permissions - users can only see audit trails for entities they have access to
    if project_id and not crud_rbac.has_project_permission(db, current_user.id, project_id, "view"):
        raise HTTPException(status_code=403, detail="Not enough permissions to view audit trails for this project")

    accessible_project_ids = [project.id for project in rbac.get_accessible_projects(current_user, db)]
    audit_trails, total = audit_service.get_visible_audit_trails(
        filters,
        current_user_id=current_user.id,
        accessible_project_ids=accessible_project_ids,
        is_superuser=current_user.is_superuser,
    )

    return AuditTrailList(
        items=[AuditTrailResponse.from_orm(audit) for audit in audit_trails],
        total=total,
        limit=limit,
        offset=offset
    )

@router.get("/recent", response_model=List[AuditTrailResponse])
async def get_recent_activities(
    limit: int = Query(50, ge=1, le=1000, description="Number of items to return"),
    project_id: Optional[int] = Query(None, ge=1, description="Filter by project ID"),
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
    audit_service: AuditService = Depends(get_audit_service)
):
    """
    Get recent activities.
    Returns activities the current user has permission to see.
    """
    # Check project permissions if project_id is specified
    if project_id and not crud_rbac.has_project_permission(db, current_user.id, project_id, "view"):
        raise HTTPException(status_code=403, detail="Not enough permissions to view activities for this project")

    filters = AuditTrailFilter(limit=limit, project_id=project_id)
    accessible_project_ids = [project.id for project in rbac.get_accessible_projects(current_user, db)]
    activities, _ = audit_service.get_visible_audit_trails(
        filters,
        current_user_id=current_user.id,
        accessible_project_ids=accessible_project_ids,
        is_superuser=current_user.is_superuser,
    )

    return [AuditTrailResponse.from_orm(activity) for activity in activities]

@router.get("/{audit_id}", response_model=AuditTrailResponse)
async def get_audit_trail(
    audit_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
    audit_service: AuditService = Depends(get_audit_service)
):
    """
    Get a specific audit trail by ID.
    Requires view permissions for the related entity.
    """
    audit_trail = audit_service.get_audit_trail_by_id(audit_id)
    if not audit_trail:
        raise HTTPException(status_code=404, detail="Audit trail not found")

    # Check permissions
    if (audit_trail.user_id != current_user.id and 
        not (audit_trail.project_id and crud_rbac.has_project_permission(db, current_user.id, audit_trail.project_id, "view")) and
        not current_user.is_superuser):
        raise HTTPException(status_code=403, detail="Not enough permissions to view this audit trail")

    return AuditTrailResponse.from_orm(audit_trail)

@router.get("/entity/{entity_type}/{entity_id}", response_model=EntityHistory)
async def get_entity_history(
    entity_type: EntityType,
    entity_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
    audit_service: AuditService = Depends(get_audit_service)
):
    """
    Get complete history for a specific entity.
    Requires view permissions for the entity.
    """
    # Check if user has permission to view this entity type and ID
    if not current_user.is_superuser:
        # Check based on entity type
        entity_type_value = entity_type.value
        if entity_type_value == "project":
            if not crud_rbac.has_project_permission(db, current_user.id, entity_id, "view"):
                raise HTTPException(status_code=403, detail="Not enough permissions to view this entity history")
        elif entity_type_value in ["test_case", "test_suite", "test_run", "test_result", "test_plan", "requirement", "defect", "milestone"]:
            # For project-related entities, check if user has view permission on the project
            # First, get the project_id from the entity
            from ..models import TestCase, TestSuite, TestRun, TestResult, TestPlan, Requirement, Defect, Milestone
            entity_map = {
                "test_case": TestCase,
                "test_suite": TestSuite,
                "test_run": TestRun,
                "test_result": TestResult,
                "test_plan": TestPlan,
                "requirement": Requirement,
                "defect": Defect,
                "milestone": Milestone
            }
            model_class = entity_map.get(entity_type_value)
            if model_class:
                entity = db.query(model_class).filter(model_class.id == entity_id).first()
                if not entity:
                    raise HTTPException(status_code=404, detail="Entity not found")
                if hasattr(entity, 'project_id') and entity.project_id:
                    if not crud_rbac.has_project_permission(db, current_user.id, entity.project_id, "view"):
                        raise HTTPException(status_code=403, detail="Not enough permissions to view this entity history")
        elif entity_type_value == "user":
            # Users can only view their own user history
            if entity_id != current_user.id:
                raise HTTPException(status_code=403, detail="Not enough permissions to view this entity history")

    history = audit_service.get_entity_history(entity_type.value, entity_id)

    # Filter history based on permissions
    filtered_history = []
    for audit in history.history:
        if (audit.user_id == current_user.id or 
            (audit.project_id and crud_rbac.has_project_permission(db, current_user.id, audit.project_id, "view")) or
            current_user.is_superuser):
            filtered_history.append(audit)

    return EntityHistory(
        entity_type=history.entity_type,
        entity_id=history.entity_id,
        total_changes=len(filtered_history),
        history=filtered_history
    )

@router.get("/user/{user_id}/summary", response_model=ActivitySummary)
async def get_user_activity_summary(
    user_id: int,
    days: int = Query(30, ge=1, le=365, description="Number of days to look back"),
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
    audit_service: AuditService = Depends(get_audit_service)
):
    """
    Get activity summary for a specific user.
    Users can only see their own summary unless they're admin.
    """
    if user_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions to view user activity summary")

    summary = audit_service.get_user_activity_summary(user_id, days)
    return summary

@router.get("/project/{project_id}/summary", response_model=ActivitySummary)
async def get_project_activity_summary(
    project_id: int,
    days: int = Query(30, ge=1, le=365, description="Number of days to look back"),
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
    audit_service: AuditService = Depends(get_audit_service)
):
    """
    Get activity summary for a specific project.
    Requires view permissions for the project.
    """
    if not crud_rbac.has_project_permission(db, current_user.id, project_id, "view"):
        raise HTTPException(status_code=403, detail="Not enough permissions to view project activity summary")

    summary = audit_service.get_project_activity_summary(project_id, days)
    return summary

@router.put("/{audit_id}", response_model=AuditTrailResponse)
async def update_audit_trail(
    audit_id: int,
    update_data: AuditTrailUpdate,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
    audit_service: AuditService = Depends(get_audit_service)
):
    """
    Update audit trail metadata (limited fields for security).
    Only admins can update audit trails.
    """
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Only admins can update audit trails")

    audit_trail = audit_service.update_audit_trail(audit_id, update_data)
    if not audit_trail:
        raise HTTPException(status_code=404, detail="Audit trail not found")

    return AuditTrailResponse.from_orm(audit_trail)

@router.delete("/{audit_id}")
async def delete_audit_trail(
    audit_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
    audit_service: AuditService = Depends(get_audit_service)
):
    """
    Delete audit trail.
    Only admins can delete audit trails.
    """
    if not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Only admins can delete audit trails")

    success = audit_service.delete_audit_trail(audit_id)
    if not success:
        raise HTTPException(status_code=404, detail="Audit trail not found")

    return {"message": "Audit trail deleted successfully"}

# Endpoint to create audit trails (used by other services)
@router.post("", response_model=AuditTrailResponse)
async def create_audit_trail(
    audit_data: dict,
    request: Request,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user),
    audit_service: AuditService = Depends(get_audit_service)
):
    """
    Create a new audit trail entry.
    This endpoint is typically used by other services to log actions.
    """
    # Extract client information
    client_ip = request.client.host
    user_agent = request.headers.get("user-agent")
    
    # Add client info to audit data
    audit_data["ip_address"] = client_ip
    audit_data["user_agent"] = user_agent
    audit_data["user_id"] = current_user.id

    from ..schemas_audit import AuditTrailCreate
    try:
        audit_create = AuditTrailCreate(**audit_data)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc
    
    audit_trail = audit_service.create_audit_trail(audit_create)
    if audit_trail is None:
        raise HTTPException(status_code=409, detail="Audit trail logging is disabled for this entity type")
    return AuditTrailResponse.from_orm(audit_trail)


async def log_audit_event(
    db: Session,
    user_id: int,
    action: str,
    entity_type: str,
    entity_id: int = None,
    description: str = None,
    project_id: int = None,
    ip_address: str = None,
    user_agent: str = None
):
    """Helper function to log audit events"""
    try:
        from ..services.audit_service import AuditService
        from ..schemas_audit import AuditTrailCreate
        import logging
        
        logger = logging.getLogger(__name__)
        
        audit_service = AuditService(db)
        audit_data = AuditTrailCreate(
            user_id=user_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            description=description,
            project_id=project_id,
            ip_address=ip_address,
            user_agent=user_agent
        )
        audit_service.create_audit_trail(audit_data)
    except Exception as e:
        # Log error but don't fail the operation
        import logging
        logger = logging.getLogger(__name__)
        logger.error(f"Failed to create audit trail: {str(e)}", exc_info=True)
