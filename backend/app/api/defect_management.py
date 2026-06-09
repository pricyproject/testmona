from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from app import crud, crud_defect_management, models, schemas
from app.database import get_db
from app.auth import get_current_user
from app.rbac import has_permission, require_permission
from app.security_utils import validate_file_size, MAX_ATTACHMENT_SIZE
import os
import uuid
from datetime import datetime
import re
import pathlib

router = APIRouter()

# Security utilities for file handling
def sanitize_filename(filename: str) -> str:
    """Sanitize filename to prevent path traversal attacks.
    
    Removes null bytes, path separators, and other dangerous characters.
    Only allows alphanumeric, hyphens, underscores, and periods.
    """
    if not filename:
        raise ValueError("Filename cannot be empty")
    
    # Remove null bytes
    filename = filename.replace('\x00', '')
    
    # Remove path separators and dangerous patterns
    filename = re.sub(r'[<>:"|?*\\/]', '', filename)
    
    # Remove leading/trailing dots and spaces to prevent hidden files
    filename = filename.strip('. ')
    
    # Limit filename length
    if len(filename) > 255:
        filename = filename[:255]
    
    # Ensure filename is not empty after sanitization
    if not filename:
        raise ValueError("Filename is invalid after sanitization")
    
    return filename

def validate_file_path(file_path: str, allowed_base_dir: str) -> bool:
    """Validate that a file path is within the allowed base directory.
    
    Returns True if the path is safe, False otherwise.
    This prevents path traversal attacks in file deletion.
    """
    if not file_path or not allowed_base_dir:
        return False
    
    # Resolve both paths to absolute paths
    try:
        abs_file_path = pathlib.Path(file_path).resolve()
        abs_base_dir = pathlib.Path(allowed_base_dir).resolve()
        
        # Check if the file path is within the base directory
        # by checking if the base directory is a parent of the file path
        try:
            abs_file_path.relative_to(abs_base_dir)
            return True
        except ValueError:
            # Path is outside the base directory
            return False
    except (OSError, RuntimeError):
        return False


def _get_project_defect_or_404(db: Session, project_id: int, defect_id: int):
    """Fetch a defect, ensuring it belongs to the given project.

    Prevents broken object-level authorization (IDOR): a user with access to
    one project must not be able to read or mutate defect sub-resources
    (comments, attachments, history, sync) belonging to another project just
    by guessing a defect_id.
    """
    defect = crud_defect_management.get_defect_management_detail(db, defect_id=defect_id)
    if not defect or defect.project_id != project_id:
        raise HTTPException(status_code=404, detail="Defect not found")
    return defect


def _get_project_integration_or_404(db: Session, project_id: int, integration_id: int):
    """Fetch an issue-tracker integration, ensuring it belongs to the project.

    Integrations store API credentials, so a user managing one project must not
    be able to read, mutate, test, or delete another project's integration by
    guessing an integration_id.
    """
    integration = crud_defect_management.get_issue_tracker_integration(db, integration_id=integration_id)
    if not integration or integration.project_id != project_id:
        raise HTTPException(status_code=404, detail="Integration not found")
    return integration


def _get_project_template_or_404(db: Session, project_id: int, template_id: int):
    """Fetch a defect template, ensuring it belongs to the given project."""
    template = db.query(models.DefectTemplate).filter(
        models.DefectTemplate.id == template_id
    ).first()
    if not template or template.project_id != project_id:
        raise HTTPException(status_code=404, detail="Template not found")
    return template

# Defect Management Endpoints

@router.get("/projects/{project_id}/defects-management", response_model=List[schemas.DefectManagement])
def get_defects_management(
    project_id: int,
    skip: int = 0,
    limit: int = 100,
    status: Optional[str] = None,
    severity: Optional[str] = None,
    priority: Optional[str] = None,
    assigned_to: Optional[int] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """Get all defects for a project with advanced filtering"""
    # Check project access
    if not has_permission(current_user, "view", project_id, db):
        raise HTTPException(status_code=403, detail="Access denied")
    
    return crud_defect_management.get_defects_management(
        db=db,
        project_id=project_id,
        skip=skip,
        limit=limit,
        status=status,
        severity=severity,
        priority=priority,
        assigned_to=assigned_to,
        search=search
    )

@router.get("/projects/{project_id}/defects-management/{defect_id}", response_model=schemas.DefectManagementDetail)
def get_defect_management_detail(
    project_id: int,
    defect_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """Get detailed defect information with all related data"""
    # Check project access
    if not has_permission(current_user, "view", project_id, db):
        raise HTTPException(status_code=403, detail="Access denied")
    
    defect = crud_defect_management.get_defect_management_detail(db, defect_id=defect_id)
    if not defect or defect.project_id != project_id:
        raise HTTPException(status_code=404, detail="Defect not found")
    
    return defect

@router.post("/projects/{project_id}/defects-management", response_model=schemas.DefectManagement)
def create_defect_management(
    project_id: int,
    defect: schemas.DefectManagementCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """Create a new defect with enhanced fields"""
    # Check project access and write permission
    if not has_permission(current_user, "view", project_id, db):
        raise HTTPException(status_code=403, detail="Access denied")
    
    if not has_permission(current_user, "write", project_id, db):
        raise HTTPException(status_code=403, detail="Write permission required")
    
    return crud_defect_management.create_defect_management(
        db=db,
        defect=defect,
        project_id=project_id,
        reported_by=current_user.id
    )

@router.put("/projects/{project_id}/defects-management/{defect_id}", response_model=schemas.DefectManagement)
def update_defect_management(
    project_id: int,
    defect_id: int,
    defect_update: schemas.DefectManagementUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """Update defect with change tracking"""
    # Check project access and write permission
    if not has_permission(current_user, "view", project_id, db):
        raise HTTPException(status_code=403, detail="Access denied")
    
    if not has_permission(current_user, "write", project_id, db):
        raise HTTPException(status_code=403, detail="Write permission required")
    
    # Get existing defect for change tracking
    existing_defect = crud_defect_management.get_defect_management_detail(db, defect_id=defect_id)
    if not existing_defect or existing_defect.project_id != project_id:
        raise HTTPException(status_code=404, detail="Defect not found")
    
    # Update defect with history tracking
    updated_defect = crud_defect_management.update_defect_management(
        db=db,
        defect_id=defect_id,
        defect_update=defect_update,
        updated_by=current_user.id
    )
    
    return updated_defect

@router.delete("/projects/{project_id}/defects-management/{defect_id}")
def delete_defect_management(
    project_id: int,
    defect_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """Delete a defect"""
    # Check project access and delete permission
    if not has_permission(current_user, "view", project_id, db):
        raise HTTPException(status_code=403, detail="Access denied")
    
    if not has_permission(current_user, "delete", project_id, db):
        raise HTTPException(status_code=403, detail="Delete permission required")
    
    success = crud_defect_management.delete_defect_management(db, defect_id=defect_id)
    if not success:
        raise HTTPException(status_code=404, detail="Defect not found")
    
    return {"message": "Defect deleted successfully"}

# Defect Comments Endpoints

@router.get("/projects/{project_id}/defects-management/{defect_id}/comments", response_model=List[schemas.DefectComment])
def get_defect_comments(
    project_id: int,
    defect_id: int,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """Get all comments for a defect"""
    # Check project access
    if not has_permission(current_user, "view", project_id, db):
        raise HTTPException(status_code=403, detail="Access denied")

    # Ensure the defect belongs to this project
    _get_project_defect_or_404(db, project_id, defect_id)

    return crud_defect_management.get_defect_comments(db, defect_id=defect_id, skip=skip, limit=limit)

@router.post("/projects/{project_id}/defects-management/{defect_id}/comments", response_model=schemas.DefectComment)
def create_defect_comment(
    project_id: int,
    defect_id: int,
    comment: schemas.DefectCommentCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """Add a comment to a defect"""
    # Check project access and write permission
    if not has_permission(current_user, "view", project_id, db):
        raise HTTPException(status_code=403, detail="Access denied")
    
    if not has_permission(current_user, "write", project_id, db):
        raise HTTPException(status_code=403, detail="Write permission required")

    # Ensure the defect belongs to this project
    _get_project_defect_or_404(db, project_id, defect_id)

    return crud_defect_management.create_defect_comment(
        db=db,
        comment=comment,
        defect_id=defect_id,
        user_id=current_user.id
    )

@router.put("/projects/{project_id}/defects-management/{defect_id}/comments/{comment_id}", response_model=schemas.DefectComment)
def update_defect_comment(
    project_id: int,
    defect_id: int,
    comment_id: int,
    comment_update: schemas.DefectCommentUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """Update a comment"""
    # Check project access and write permission
    if not has_permission(current_user, "view", project_id, db):
        raise HTTPException(status_code=403, detail="Access denied")
    
    if not has_permission(current_user, "write", project_id, db):
        raise HTTPException(status_code=403, detail="Write permission required")

    # Ensure the defect belongs to this project
    _get_project_defect_or_404(db, project_id, defect_id)

    return crud_defect_management.update_defect_comment(
        db=db,
        comment_id=comment_id,
        comment_update=comment_update,
        user_id=current_user.id
    )

@router.delete("/projects/{project_id}/defects-management/{defect_id}/comments/{comment_id}")
def delete_defect_comment(
    project_id: int,
    defect_id: int,
    comment_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """Delete a comment"""
    # Check project access and delete permission
    if not has_permission(current_user, "view", project_id, db):
        raise HTTPException(status_code=403, detail="Access denied")
    
    if not has_permission(current_user, "delete", project_id, db):
        raise HTTPException(status_code=403, detail="Delete permission required")

    # Ensure the defect belongs to this project
    _get_project_defect_or_404(db, project_id, defect_id)

    success = crud_defect_management.delete_defect_comment(db, comment_id=comment_id, user_id=current_user.id)
    if not success:
        raise HTTPException(status_code=404, detail="Comment not found or access denied")
    
    return {"message": "Comment deleted successfully"}

# Defect Attachments Endpoints

@router.get("/projects/{project_id}/defects-management/{defect_id}/attachments", response_model=List[schemas.DefectAttachment])
def get_defect_attachments(
    project_id: int,
    defect_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """Get all attachments for a defect"""
    # Check project access
    if not has_permission(current_user, "view", project_id, db):
        raise HTTPException(status_code=403, detail="Access denied")

    # Ensure the defect belongs to this project
    _get_project_defect_or_404(db, project_id, defect_id)

    return crud_defect_management.get_defect_attachments(db, defect_id=defect_id)

@router.post("/projects/{project_id}/defects-management/{defect_id}/attachments", response_model=schemas.DefectAttachment)
async def upload_defect_attachment(
    project_id: int,
    defect_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """Upload an attachment to a defect"""
    # Check project access and write permission
    if not has_permission(current_user, "view", project_id, db):
        raise HTTPException(status_code=403, detail="Access denied")
    
    if not has_permission(current_user, "write", project_id, db):
        raise HTTPException(status_code=403, detail="Write permission required")

    # Ensure the defect exists and belongs to this project before writing any file
    _get_project_defect_or_404(db, project_id, defect_id)

    # Validate file size (10MB limit)
    content = await validate_file_size(file, MAX_ATTACHMENT_SIZE, "Attachment")
    file_size = len(content)
    
    # Validate defect ID before using it in a filesystem path
    if defect_id <= 0:
        raise HTTPException(status_code=400, detail="Invalid defect ID")
    safe_defect_id = str(defect_id)

    # Create upload directory if it doesn't exist
    base_upload_dir = pathlib.Path("uploads/defects").resolve()
    upload_dir_path = (base_upload_dir / safe_defect_id).resolve()
    try:
        upload_dir_path.relative_to(base_upload_dir)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid defect upload path")
    os.makedirs(upload_dir_path, exist_ok=True)
    
    # Sanitize the original filename to prevent path traversal
    try:
        sanitized_filename = sanitize_filename(file.filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid filename: {str(e)}")
    
    # Generate unique filename using sanitized extension
    file_extension = os.path.splitext(sanitized_filename)[1]
    unique_filename = f"{uuid.uuid4()}{file_extension}"
    file_path = str(upload_dir_path / unique_filename)
    
    # Save file
    with open(file_path, "wb") as buffer:
        buffer.write(content)
    
    # Create attachment record
    attachment = crud_defect_management.create_defect_attachment(
        db=db,
        defect_id=defect_id,
        filename=file.filename,
        file_path=file_path,
        file_size=file_size,
        mime_type=file.content_type,
        uploaded_by=current_user.id
    )
    
    return attachment

@router.delete("/projects/{project_id}/defects-management/{defect_id}/attachments/{attachment_id}")
def delete_defect_attachment(
    project_id: int,
    defect_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """Delete an attachment"""
    # Check project access and delete permission
    if not has_permission(current_user, "view", project_id, db):
        raise HTTPException(status_code=403, detail="Access denied")
    
    if not has_permission(current_user, "delete", project_id, db):
        raise HTTPException(status_code=403, detail="Delete permission required")

    # Ensure the defect belongs to this project
    _get_project_defect_or_404(db, project_id, defect_id)

    # Get attachment info for file deletion
    attachment = crud_defect_management.get_defect_attachment(db, attachment_id=attachment_id)
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    
    # Verify attachment belongs to the correct defect
    if attachment.defect_id != defect_id:
        raise HTTPException(status_code=404, detail="Attachment not found")
    
    # Validate file path is within allowed uploads directory to prevent path traversal
    allowed_base_dir = "uploads"
    if not validate_file_path(attachment.file_path, allowed_base_dir):
        raise HTTPException(status_code=403, detail="Invalid file path")
    
    # Delete file from filesystem
    if os.path.exists(attachment.file_path):
        try:
            os.remove(attachment.file_path)
        except OSError as e:
            raise HTTPException(status_code=500, detail=f"Failed to delete file: {str(e)}")
    
    # Delete database record
    success = crud_defect_management.delete_defect_attachment(db, attachment_id=attachment_id)
    if not success:
        raise HTTPException(status_code=404, detail="Attachment not found")
    
    return {"message": "Attachment deleted successfully"}

# Defect History Endpoints

@router.get("/projects/{project_id}/defects-management/{defect_id}/history", response_model=List[schemas.DefectHistory])
def get_defect_history(
    project_id: int,
    defect_id: int,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """Get change history for a defect"""
    # Check project access
    if not has_permission(current_user, "view", project_id, db):
        raise HTTPException(status_code=403, detail="Access denied")

    # Ensure the defect belongs to this project
    _get_project_defect_or_404(db, project_id, defect_id)

    return crud_defect_management.get_defect_history(db, defect_id=defect_id, skip=skip, limit=limit)

# Issue Tracker Integrations Endpoints

@router.get("/projects/{project_id}/issue-tracker-integrations", response_model=List[schemas.IssueTrackerIntegration])
def get_issue_tracker_integrations(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """Get all issue tracker integrations for a project"""
    # Check project access
    if not has_permission(current_user, "view", project_id, db):
        raise HTTPException(status_code=403, detail="Access denied")
    
    return crud_defect_management.get_issue_tracker_integrations(db, project_id=project_id)

@router.post("/projects/{project_id}/issue-tracker-integrations", response_model=schemas.IssueTrackerIntegration)
def create_issue_tracker_integration(
    project_id: int,
    integration: schemas.IssueTrackerIntegrationCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """Create a new issue tracker integration"""
    # Check project access and manage permission
    if not has_permission(current_user, "view", project_id, db):
        raise HTTPException(status_code=403, detail="Access denied")
    
    if not has_permission(current_user, "manage_projects", project_id, db):
        raise HTTPException(status_code=403, detail="Manage projects permission required")
    
    return crud_defect_management.create_issue_tracker_integration(
        db=db,
        integration=integration,
        project_id=project_id,
        created_by=current_user.id
    )

@router.put("/projects/{project_id}/issue-tracker-integrations/{integration_id}", response_model=schemas.IssueTrackerIntegration)
def update_issue_tracker_integration(
    project_id: int,
    integration_id: int,
    integration_update: schemas.IssueTrackerIntegrationUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """Update an issue tracker integration"""
    # Check project access and manage permission
    if not has_permission(current_user, "view", project_id, db):
        raise HTTPException(status_code=403, detail="Access denied")
    
    if not has_permission(current_user, "manage_projects", project_id, db):
        raise HTTPException(status_code=403, detail="Manage projects permission required")

    # Ensure the integration belongs to this project
    _get_project_integration_or_404(db, project_id, integration_id)

    return crud_defect_management.update_issue_tracker_integration(
        db=db,
        integration_id=integration_id,
        integration_update=integration_update
    )

@router.delete("/projects/{project_id}/issue-tracker-integrations/{integration_id}")
def delete_issue_tracker_integration(
    project_id: int,
    integration_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """Delete an issue tracker integration"""
    # Check project access and manage permission
    if not has_permission(current_user, "view", project_id, db):
        raise HTTPException(status_code=403, detail="Access denied")
    
    if not has_permission(current_user, "manage_projects", project_id, db):
        raise HTTPException(status_code=403, detail="Manage projects permission required")

    # Ensure the integration belongs to this project
    _get_project_integration_or_404(db, project_id, integration_id)

    success = crud_defect_management.delete_issue_tracker_integration(db, integration_id=integration_id)
    if not success:
        raise HTTPException(status_code=404, detail="Integration not found")
    
    return {"message": "Integration deleted successfully"}

@router.post("/projects/{project_id}/issue-tracker-integrations/{integration_id}/test-connection")
def test_issue_tracker_connection(
    project_id: int,
    integration_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """Test connection to an issue tracker integration"""
    # Check project access and manage permission
    if not has_permission(current_user, "view", project_id, db):
        raise HTTPException(status_code=403, detail="Access denied")
    
    if not has_permission(current_user, "manage_projects", project_id, db):
        raise HTTPException(status_code=403, detail="Manage projects permission required")

    # Get integration, ensuring it belongs to this project
    integration = _get_project_integration_or_404(db, project_id, integration_id)

    # Use sync service to test connection
    from app.sync_service import SyncService
    
    integration_dict = {
        'tracker_type': integration.tracker_type,
        'api_url': integration.api_url,
        'api_token': integration.api_token,  # This will be decrypted by the model
        'project_key': integration.project_key
    }
    
    result = SyncService.test_connection(integration_dict)
    return result

@router.post("/projects/{project_id}/defects-management/{defect_id}/sync-with-external")
def sync_defect_with_external(
    project_id: int,
    defect_id: int,
    sync_data: schemas.DefectSyncRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """Sync a defect with external issue tracker"""
    # Check project access and write permission
    if not has_permission(current_user, "view", project_id, db):
        raise HTTPException(status_code=403, detail="Access denied")
    
    if not has_permission(current_user, "write", project_id, db):
        raise HTTPException(status_code=403, detail="Write permission required")
    
    # Get defect, ensuring it belongs to this project
    defect = _get_project_defect_or_404(db, project_id, defect_id)

    # Get integration, ensuring it belongs to this project (it holds API credentials)
    integration = crud_defect_management.get_issue_tracker_integration(db, integration_id=sync_data.integration_id)
    if not integration or integration.project_id != project_id:
        raise HTTPException(status_code=404, detail="Integration not found")

    # Check if integration is active
    if not integration.is_active:
        raise HTTPException(status_code=400, detail="Integration is inactive. Please activate it first.")
    
    # Check for duplicate sync (if already synced and action is create)
    if sync_data.action == 'create' and defect.external_issue_id:
        return {
            "success": False,
            "message": "Defect already synced with external tracker. Use update action instead.",
            "issue_id": defect.external_issue_id,
            "issue_url": defect.external_issue_url
        }
    
    # Validate project key format
    if integration.project_key:
        project_key = integration.project_key
        
        # Validate based on tracker type
        if integration.tracker_type.lower() == 'github':
            if '/' not in project_key:
                raise HTTPException(status_code=400, detail="GitHub project key must be in format 'owner/repo'")
        elif integration.tracker_type.lower() == 'gitlab':
            if '/' not in project_key:
                raise HTTPException(status_code=400, detail="GitLab project key must be in format 'namespace/project'")
        elif integration.tracker_type.lower() == 'azure-devops':
            if '/' not in project_key:
                raise HTTPException(status_code=400, detail="Azure DevOps project key must be in format 'organization/project'")
        elif integration.tracker_type.lower() == 'asana':
            if '/' not in project_key:
                raise HTTPException(status_code=400, detail="Asana project key must be in format 'workspace_id/project_id'")
        elif integration.tracker_type.lower() == 'linear':
            if not project_key:
                raise HTTPException(status_code=400, detail="Linear project key must be a valid team key")
        elif integration.tracker_type.lower() == 'jira':
            if not project_key:
                raise HTTPException(status_code=400, detail="Jira project key must be a valid project key")
    
    # Use sync service to sync defect
    from app.sync_service import SyncService
    import logging
    
    logger = logging.getLogger(__name__)
    
    # Log sync attempt for audit
    logger.info(f"Sync attempt: User {current_user.id} syncing defect {defect.defect_id} with {integration.tracker_type} integration {integration.id}")
    
    try:
        app_name_setting = crud.get_system_setting(db, key="app_name")
        app_name = app_name_setting.value.strip() if app_name_setting and app_name_setting.value else "TestMona"

        defect_dict = {
            'defect_id': defect.defect_id,
            'app_name': app_name,
            'title': defect.title,
            'description': defect.description,
            'severity': defect.severity,
            'priority': defect.priority,
            'status': defect.status,
            'steps_to_reproduce': defect.steps_to_reproduce,
            'expected_result': defect.expected_result,
            'actual_result': defect.actual_result,
            'environment': defect.environment,
            'browser_info': defect.browser_info,
            'root_cause': defect.root_cause,
            'tags': defect.tags,
            'external_issue_id': defect.external_issue_id,
            'external_issue_url': defect.external_issue_url
        }
        
        integration_dict = {
            'id': integration.id,
            'tracker_type': integration.tracker_type,
            'api_url': integration.api_url,
            'api_token': integration.api_token,
            'project_key': integration.project_key,
            'name': integration.name
        }
        
        result = SyncService.sync_defect_to_external(defect_dict, integration_dict, action=sync_data.action or 'create')
        
        # Log sync result
        if result.get('success'):
            logger.info(f"Sync success: Defect {defect.defect_id} synced successfully. Issue ID: {result.get('issue_id')}")
        else:
            logger.error(f"Sync failure: Defect {defect.defect_id} sync failed. Error: {result.get('message')}")
        
        # Update defect with sync result
        defect.external_issue_id = result.get('issue_id')
        defect.external_issue_url = result.get('issue_url')
        defect.external_sync_status = 'synced'
        defect.sync_status = 'synced'
        defect.sync_error = None
        db.commit()
        
        return result
        
    except Exception as e:
        logger.error(f"Sync error: {str(e)}")
        # Update defect sync status to error
        defect.external_sync_status = 'error'
        defect.sync_status = 'error'
        defect.sync_error = str(e)
        db.commit()
        
        return {"success": False, "message": str(e)}

# Defect Templates Endpoints

@router.get("/projects/{project_id}/defect-templates", response_model=List[schemas.DefectTemplate])
def get_defect_templates(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """Get all defect templates for a project"""
    # Check project access
    if not has_permission(current_user, "view", project_id, db):
        raise HTTPException(status_code=403, detail="Access denied")
    
    return crud_defect_management.get_defect_templates(db, project_id=project_id)

@router.post("/projects/{project_id}/defect-templates", response_model=schemas.DefectTemplate)
def create_defect_template(
    project_id: int,
    template: schemas.DefectTemplateCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """Create a new defect template"""
    # Check project access and write permission
    if not has_permission(current_user, "view", project_id, db):
        raise HTTPException(status_code=403, detail="Access denied")
    
    if not has_permission(current_user, "write", project_id, db):
        raise HTTPException(status_code=403, detail="Write permission required")
    
    return crud_defect_management.create_defect_template(
        db=db,
        template=template,
        project_id=project_id,
        created_by=current_user.id
    )

@router.put("/projects/{project_id}/defect-templates/{template_id}", response_model=schemas.DefectTemplate)
def update_defect_template(
    project_id: int,
    template_id: int,
    template_update: schemas.DefectTemplateUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """Update a defect template"""
    # Check project access and write permission
    if not has_permission(current_user, "view", project_id, db):
        raise HTTPException(status_code=403, detail="Access denied")
    
    if not has_permission(current_user, "write", project_id, db):
        raise HTTPException(status_code=403, detail="Write permission required")

    # Ensure the template belongs to this project
    _get_project_template_or_404(db, project_id, template_id)

    return crud_defect_management.update_defect_template(
        db=db,
        template_id=template_id,
        template_update=template_update
    )

@router.delete("/projects/{project_id}/defect-templates/{template_id}")
def delete_defect_template(
    project_id: int,
    template_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """Delete a defect template"""
    # Check project access and delete permission
    if not has_permission(current_user, "view", project_id, db):
        raise HTTPException(status_code=403, detail="Access denied")
    
    if not has_permission(current_user, "delete", project_id, db):
        raise HTTPException(status_code=403, detail="Delete permission required")

    # Ensure the template belongs to this project
    _get_project_template_or_404(db, project_id, template_id)

    success = crud_defect_management.delete_defect_template(db, template_id=template_id)
    if not success:
        raise HTTPException(status_code=404, detail="Template not found")
    
    return {"message": "Template deleted successfully"}
