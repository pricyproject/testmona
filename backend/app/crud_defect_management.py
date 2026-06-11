from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_, desc, func
from sqlalchemy.exc import IntegrityError
from app import models, schemas
from datetime import datetime, UTC
import requests
import json
import re
from urllib.parse import urlparse
import ipaddress


def is_safe_url(url: str) -> bool:
    """
    Validate URL to prevent SSRF attacks.
    Only allows http/https to public IPs.
    Blocks localhost, private IPs, and internal networks.
    """
    try:
        parsed = urlparse(url)
        
        # Only allow http and https
        if parsed.scheme not in ['http', 'https']:
            return False
        
        # Must have a hostname
        if not parsed.hostname:
            return False
        
        # Block localhost variants
        hostname = parsed.hostname.lower()
        if hostname in ['localhost', '127.0.0.1', '::1', '0.0.0.0']:
            return False
        
        # Block private IP ranges
        try:
            ip = ipaddress.ip_address(hostname)
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                return False
        except ValueError:
            # Not an IP address, check hostname
            pass
        
        # Block metadata services
        if 'metadata' in hostname or '169.254.169.254' in url:
            return False
        
        # Block internal network hostnames
        internal_patterns = [
            r'.*\.local$',
            r'.*\.internal$',
            r'.*\.corp$',
            r'.*\.private$',
        ]
        for pattern in internal_patterns:
            if re.match(pattern, hostname):
                return False
        
        return True
    except Exception:
        return False

# Import existing CRUD functions for project access
from app import crud

# Defect Management CRUD Functions

def get_defects_management(
    db: Session,
    project_id: int,
    skip: int = 0,
    limit: int = 100,
    status: Optional[str] = None,
    severity: Optional[str] = None,
    priority: Optional[str] = None,
    assigned_to: Optional[int] = None,
    search: Optional[str] = None
):
    """Get defects with advanced filtering"""
    query = db.query(models.Defect).filter(models.Defect.project_id == project_id)
    
    # Apply filters
    if status:
        query = query.filter(models.Defect.status == status)
    if severity:
        query = query.filter(models.Defect.severity == severity)
    if priority:
        query = query.filter(models.Defect.priority == priority)
    if assigned_to:
        query = query.filter(models.Defect.assigned_to == assigned_to)
    if search:
        # Escape SQL wildcard characters to prevent SQL injection
        escaped_search = search.replace('%', '\\%').replace('_', '\\_')
        search_filter = or_(
            models.Defect.title.ilike(f"%{escaped_search}%"),
            models.Defect.description.ilike(f"%{escaped_search}%"),
            models.Defect.defect_id.ilike(f"%{escaped_search}%"),
            models.Defect.tags.ilike(f"%{escaped_search}%")
        )
        query = query.filter(search_filter)
    
    # Order by created_at desc and apply pagination
    return query.order_by(desc(models.Defect.created_at)).offset(skip).limit(limit).all()


def get_defect_management_detail(db: Session, defect_id: int):
    """Get defect with all related data"""
    defect = db.query(models.Defect).filter(models.Defect.id == defect_id).first()
    return defect


def create_defect_management(
    db: Session,
    defect: schemas.DefectManagementCreate,
    project_id: int,
    reported_by: int,
    max_retries: int = 5
):
    """Create a new defect with atomic defect_id generation"""
    max_retries = 5
    
    for attempt in range(max_retries):
        try:
            # Generate unique defect_id if not provided
            if not defect.defect_id:
                # Use SELECT FOR UPDATE to lock the table and prevent race conditions
                # Get all defects for this project to find the maximum defect_id number
                # This prevents ID reuse after deletions
                all_defects = db.query(models.Defect).filter(
                    models.Defect.project_id == project_id
                ).with_for_update().all()
                
                # Extract and find the maximum defect number from all existing defect_ids
                # Supports both formats: DEF-{number} and P{projectId}-DEF-{number}
                max_defect_number = 0
                for existing_defect in all_defects:
                    if existing_defect.defect_id:
                        # Try to match both formats
                        match = re.search(r'(?:P\d+-)?DEF-(\d+)', existing_defect.defect_id)
                        if match:
                            defect_number = int(match.group(1))
                            if defect_number > max_defect_number:
                                max_defect_number = defect_number
                
                # Generate ID with project prefix if project_id is provided
                if project_id:
                    defect.defect_id = f"P{project_id}-DEF-{max_defect_number + 1:03d}"
                else:
                    defect.defect_id = f"DEF-{max_defect_number + 1:03d}"
            
            db_defect = models.Defect(
                **defect.model_dump(),
                project_id=project_id,
                reported_by=reported_by
            )
            db.add(db_defect)
            db.commit()
            db.refresh(db_defect)
            
            # Create history entry for creation
            history = models.DefectHistory(
                defect_id=db_defect.id,
                user_id=reported_by,
                field_name="status",
                old_value=None,
                new_value=defect.status.value if defect.status else "open",
                change_reason="Initial defect creation"
            )
            db.add(history)
            db.commit()
            
            return db_defect
            
        except IntegrityError as e:
            # Rollback the transaction to release the lock
            db.rollback()
            
            # If this was a duplicate defect_id error and we didn't provide a defect_id,
            # try again with a different ID
            if "defect_id" in str(e) and attempt < max_retries - 1:
                # Force regeneration of defect_id on next attempt
                defect.defect_id = None
                continue
            else:
                # Re-raise if it's not a duplicate ID error or we've exhausted retries
                raise
        except Exception as e:
            db.rollback()
            raise


def update_defect_management(
    db: Session,
    defect_id: int,
    defect_update: schemas.DefectManagementUpdate,
    updated_by: int
):
    """Update defect with change tracking"""
    db_defect = db.query(models.Defect).filter(models.Defect.id == defect_id).first()
    if not db_defect:
        return None
    
    # Track changes for history
    update_data = defect_update.model_dump(exclude_unset=True)
    status_changed = False
    for field_name, new_value in update_data.items():
        old_value = getattr(db_defect, field_name)
        if field_name == "status" and old_value != new_value:
            status_changed = True
        
        # Only track if value actually changed
        if old_value != new_value:
            # Convert enum values to strings for storage
            if hasattr(old_value, 'value'):
                old_value_str = old_value.value
            else:
                old_value_str = str(old_value) if old_value is not None else None
                
            if hasattr(new_value, 'value'):
                new_value_str = new_value.value
            else:
                new_value_str = str(new_value) if new_value is not None else None
            
            # Create history entry
            history = models.DefectHistory(
                defect_id=defect_id,
                user_id=updated_by,
                field_name=field_name,
                old_value=old_value_str,
                new_value=new_value_str,
                change_reason=f"Updated {field_name}"
            )
            db.add(history)
            
            # Update the field
            setattr(db_defect, field_name, new_value)
    
    db_defect.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(db_defect)

    # Lifecycle sync: a status change means every linked execution result
    # should be re-verified.
    if status_changed:
        from app import crud
        crud.flag_linked_results_for_retest(db, defect_id)

    return db_defect


def delete_defect_management(db: Session, defect_id: int):
    """Delete a defect"""
    db_defect = db.query(models.Defect).filter(models.Defect.id == defect_id).first()
    if db_defect:
        db.delete(db_defect)
        db.commit()
        return True
    return False


# Defect Comments CRUD Functions

def get_defect_comments(db: Session, defect_id: int, skip: int = 0, limit: int = 100):
    """Get comments for a defect"""
    return db.query(models.DefectComment).filter(
        models.DefectComment.defect_id == defect_id
    ).order_by(desc(models.DefectComment.created_at)).offset(skip).limit(limit).all()


def create_defect_comment(
    db: Session,
    comment: schemas.DefectCommentCreate,
    defect_id: int,
    user_id: int
):
    """Create a new comment"""
    db_comment = models.DefectComment(
        **comment.model_dump(),
        defect_id=defect_id,
        user_id=user_id
    )
    db.add(db_comment)
    db.commit()
    db.refresh(db_comment)
    return db_comment


def update_defect_comment(
    db: Session,
    comment_id: int,
    comment_update: schemas.DefectCommentUpdate,
    user_id: int
):
    """Update a comment"""
    db_comment = db.query(models.DefectComment).filter(
        models.DefectComment.id == comment_id,
        models.DefectComment.user_id == user_id
    ).first()
    
    if db_comment:
        update_data = comment_update.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_comment, field, value)
        
        db_comment.updated_at = datetime.now(UTC)
        db.commit()
        db.refresh(db_comment)
    
    return db_comment


def delete_defect_comment(db: Session, comment_id: int, user_id: int):
    """Delete a comment"""
    db_comment = db.query(models.DefectComment).filter(
        models.DefectComment.id == comment_id,
        models.DefectComment.user_id == user_id
    ).first()
    
    if db_comment:
        db.delete(db_comment)
        db.commit()
        return True
    return False


# Defect Attachments CRUD Functions

def get_defect_attachments(db: Session, defect_id: int):
    """Get attachments for a defect"""
    return db.query(models.DefectAttachment).filter(
        models.DefectAttachment.defect_id == defect_id
    ).order_by(desc(models.DefectAttachment.uploaded_at)).all()


def create_defect_attachment(
    db: Session,
    defect_id: int,
    filename: str,
    file_path: str,
    file_size: int,
    mime_type: str,
    uploaded_by: int
):
    """Create a new attachment record"""
    db_attachment = models.DefectAttachment(
        defect_id=defect_id,
        filename=filename,
        file_path=file_path,
        file_size=file_size,
        mime_type=mime_type,
        uploaded_by=uploaded_by
    )
    db.add(db_attachment)
    db.commit()
    db.refresh(db_attachment)
    return db_attachment


def get_defect_attachment(db: Session, attachment_id: int):
    """Get a specific attachment"""
    return db.query(models.DefectAttachment).filter(
        models.DefectAttachment.id == attachment_id
    ).first()


def delete_defect_attachment(db: Session, attachment_id: int):
    """Delete an attachment"""
    db_attachment = db.query(models.DefectAttachment).filter(
        models.DefectAttachment.id == attachment_id
    ).first()
    
    if db_attachment:
        db.delete(db_attachment)
        db.commit()
        return True
    return False


# Defect History CRUD Functions

def get_defect_history(db: Session, defect_id: int, skip: int = 0, limit: int = 100):
    """Get change history for a defect"""
    return db.query(models.DefectHistory).filter(
        models.DefectHistory.defect_id == defect_id
    ).order_by(desc(models.DefectHistory.created_at)).offset(skip).limit(limit).all()


# Issue Tracker Integrations CRUD Functions

def get_issue_tracker_integrations(db: Session, project_id: int):
    """Get all integrations for a project"""
    return db.query(models.IssueTrackerIntegration).filter(
        models.IssueTrackerIntegration.project_id == project_id
    ).all()


def create_issue_tracker_integration(
    db: Session,
    integration: schemas.IssueTrackerIntegrationCreate,
    project_id: int,
    created_by: int
):
    """Create a new integration"""
    db_integration = models.IssueTrackerIntegration(
        **integration.model_dump(),
        project_id=project_id,
        created_by=created_by
    )
    db.add(db_integration)
    db.commit()
    db.refresh(db_integration)
    return db_integration


def update_issue_tracker_integration(
    db: Session,
    integration_id: int,
    integration_update: schemas.IssueTrackerIntegrationUpdate
):
    """Update an integration"""
    db_integration = db.query(models.IssueTrackerIntegration).filter(
        models.IssueTrackerIntegration.id == integration_id
    ).first()
    
    if db_integration:
        update_data = integration_update.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_integration, field, value)
        
        db_integration.updated_at = datetime.now(UTC)
        db.commit()
        db.refresh(db_integration)
    
    return db_integration


def delete_issue_tracker_integration(db: Session, integration_id: int):
    """Delete an integration"""
    db_integration = db.query(models.IssueTrackerIntegration).filter(
        models.IssueTrackerIntegration.id == integration_id
    ).first()
    
    if db_integration:
        db.delete(db_integration)
        db.commit()
        return True
    return False


def test_issue_tracker_connection(db: Session, integration_id: int):
    """Test connection to an issue tracker"""
    integration = db.query(models.IssueTrackerIntegration).filter(
        models.IssueTrackerIntegration.id == integration_id
    ).first()
    
    if not integration:
        return {"success": False, "message": "Integration not found"}
    
    try:
        # Test connection based on tracker type
        if integration.tracker_type.lower() == "jira":
            return test_jira_connection(integration)
        elif integration.tracker_type.lower() == "github":
            return test_github_connection(integration)
        else:
            return {"success": False, "message": f"Unsupported tracker type: {integration.tracker_type}"}
    except Exception as e:
        return {"success": False, "message": f"Connection failed: {str(e)}"}


def test_jira_connection(integration: models.IssueTrackerIntegration):
    """Test Jira connection"""
    try:
        # Validate URL to prevent SSRF attacks
        if not is_safe_url(integration.api_url):
            return {
                "success": False,
                "message": "Invalid or unsafe URL configuration",
                "sync_status": "error"
            }
        
        headers = {
            "Authorization": f"Bearer {integration.api_token}",
            "Content-Type": "application/json"
        }
        
        # Test basic connectivity
        response = requests.get(
            f"{integration.api_url}/rest/api/3/myself",
            headers=headers,
            timeout=10
        )
        
        if response.status_code == 200:
            # Test project access
            project_response = requests.get(
                f"{integration.api_url}/rest/api/3/project/{integration.project_key}",
                headers=headers,
                timeout=10
            )
            
            if project_response.status_code == 200:
                return {
                    "success": True,
                    "message": "Connection successful",
                    "sync_status": "synced"
                }
            else:
                return {
                    "success": False,
                    "message": f"Project {integration.project_key} not found or accessible",
                    "sync_status": "error"
                }
        else:
            return {
                "success": False,
                "message": f"Authentication failed: {response.status_code}",
                "sync_status": "error"
            }
    except Exception as e:
        return {
            "success": False,
            "message": f"Connection error: {str(e)}",
            "sync_status": "error"
        }


def test_github_connection(integration: models.IssueTrackerIntegration):
    """Test GitHub connection"""
    try:
        # Validate URL to prevent SSRF attacks
        if not is_safe_url(integration.api_url):
            return {
                "success": False,
                "message": "Invalid or unsafe URL configuration",
                "sync_status": "error"
            }
        
        headers = {
            "Authorization": f"token {integration.api_token}",
            "Accept": "application/vnd.github.v3+json"
        }
        
        # Test basic connectivity
        response = requests.get(
            f"{integration.api_url}/user",
            headers=headers,
            timeout=10
        )
        
        if response.status_code == 200:
            return {
                "success": True,
                "message": "Connection successful",
                "sync_status": "synced"
            }
        else:
            return {
                "success": False,
                "message": f"Authentication failed: {response.status_code}",
                "sync_status": "error"
            }
    except Exception as e:
        return {
            "success": False,
            "message": f"Connection error: {str(e)}",
            "sync_status": "error"
        }


def sync_defect_with_external(
    db: Session,
    defect_id: int,
    sync_data: schemas.DefectSyncRequest,
    user_id: int
):
    """Sync defect with external issue tracker"""
    defect = db.query(models.Defect).filter(models.Defect.id == defect_id).first()
    integration = db.query(models.IssueTrackerIntegration).filter(
        models.IssueTrackerIntegration.id == sync_data.integration_id
    ).first()
    
    if not defect or not integration:
        return schemas.DefectSyncResponse(
            success=False,
            message="Defect or integration not found"
        )
    
    # Validate URL to prevent SSRF attacks
    if not is_safe_url(integration.api_url):
        return schemas.DefectSyncResponse(
            success=False,
            message="Invalid or unsafe URL configuration"
        )
    
    try:
        if integration.tracker_type.lower() == "jira":
            return sync_with_jira(defect, integration, sync_data.action)
        elif integration.tracker_type.lower() == "github":
            return sync_with_github(defect, integration, sync_data.action)
        else:
            return schemas.DefectSyncResponse(
                success=False,
                message=f"Unsupported tracker type: {integration.tracker_type}"
            )
    except Exception as e:
        return schemas.DefectSyncResponse(
            success=False,
            message=f"Sync failed: {str(e)}"
        )


def sync_with_jira(
    defect: models.Defect,
    integration: models.IssueTrackerIntegration,
    action: str
):
    """Sync defect with Jira"""
    try:
        headers = {
            "Authorization": f"Bearer {integration.api_token}",
            "Content-Type": "application/json"
        }
        
        if action == "create" or not defect.external_issue_id:
            # Create new issue
            issue_data = {
                "fields": {
                    "project": {"key": integration.project_key},
                    "summary": defect.title,
                    "description": defect.description or "",
                    "issuetype": {"name": "Bug"},
                    "priority": {"name": defect.priority.value.upper()},
                    "labels": defect.tags.split(",") if defect.tags else []
                }
            }
            
            response = requests.post(
                f"{integration.api_url}/rest/api/3/issue",
                headers=headers,
                json=issue_data,
                timeout=30
            )
            
            if response.status_code == 201:
                issue_response = response.json()
                external_issue_id = issue_response["key"]
                external_issue_url = f"{integration.api_url}/browse/{external_issue_id}"
                
                # Update defect with external info
                defect.external_issue_id = external_issue_id
                defect.external_issue_url = external_issue_url
                defect.external_sync_status = "synced"
                defect.external_last_sync = datetime.now(UTC)
                
                return schemas.DefectSyncResponse(
                    success=True,
                    message="Issue created successfully in Jira",
                    external_issue_id=external_issue_id,
                    external_issue_url=external_issue_url,
                    sync_status="synced"
                )
            else:
                return schemas.DefectSyncResponse(
                    success=False,
                    message=f"Failed to create issue: {response.text}"
                )
        else:
            # Update existing issue
            issue_data = {
                "fields": {
                    "summary": defect.title,
                    "description": defect.description or "",
                    "priority": {"name": defect.priority.value.upper()}
                }
            }
            
            response = requests.put(
                f"{integration.api_url}/rest/api/3/issue/{defect.external_issue_id}",
                headers=headers,
                json=issue_data,
                timeout=30
            )
            
            if response.status_code == 204:
                defect.external_sync_status = "synced"
                defect.external_last_sync = datetime.now(UTC)
                
                return schemas.DefectSyncResponse(
                    success=True,
                    message="Issue updated successfully in Jira",
                    external_issue_id=defect.external_issue_id,
                    external_issue_url=defect.external_issue_url,
                    sync_status="synced"
                )
            else:
                return schemas.DefectSyncResponse(
                    success=False,
                    message=f"Failed to update issue: {response.text}"
                )
    except Exception as e:
        return schemas.DefectSyncResponse(
            success=False,
            message=f"Jira sync error: {str(e)}"
        )


def sync_with_github(
    defect: models.Defect,
    integration: models.IssueTrackerIntegration,
    action: str
):
    """Sync defect with GitHub"""
    try:
        headers = {
            "Authorization": f"token {integration.api_token}",
            "Accept": "application/vnd.github.v3+json"
        }
        
        # Extract owner/repo from api_url
        # Assuming api_url is like https://api.github.com/repos/owner/repo
        url_parts = integration.api_url.split("/")
        if len(url_parts) >= 7:
            owner, repo = url_parts[4], url_parts[5]
        else:
            return schemas.DefectSyncResponse(
                success=False,
                message="Invalid GitHub API URL format"
            )
        
        if action == "create" or not defect.external_issue_id:
            # Create new issue
            issue_data = {
                "title": defect.title,
                "body": defect.description or "",
                "labels": defect.tags.split(",") if defect.tags else []
            }
            
            response = requests.post(
                f"{integration.api_url}/issues",
                headers=headers,
                json=issue_data,
                timeout=30
            )
            
            if response.status_code == 201:
                issue_response = response.json()
                external_issue_id = str(issue_response["number"])
                external_issue_url = issue_response["html_url"]
                
                # Update defect with external info
                defect.external_issue_id = external_issue_id
                defect.external_issue_url = external_issue_url
                defect.external_sync_status = "synced"
                defect.external_last_sync = datetime.now(UTC)
                
                return schemas.DefectSyncResponse(
                    success=True,
                    message="Issue created successfully in GitHub",
                    external_issue_id=external_issue_id,
                    external_issue_url=external_issue_url,
                    sync_status="synced"
                )
            else:
                return schemas.DefectSyncResponse(
                    success=False,
                    message=f"Failed to create issue: {response.text}"
                )
        else:
            # Update existing issue
            issue_data = {
                "title": defect.title,
                "body": defect.description or ""
            }
            
            response = requests.patch(
                f"{integration.api_url}/issues/{defect.external_issue_id}",
                headers=headers,
                json=issue_data,
                timeout=30
            )
            
            if response.status_code == 200:
                defect.external_sync_status = "synced"
                defect.external_last_sync = datetime.now(UTC)
                
                return schemas.DefectSyncResponse(
                    success=True,
                    message="Issue updated successfully in GitHub",
                    external_issue_id=defect.external_issue_id,
                    external_issue_url=defect.external_issue_url,
                    sync_status="synced"
                )
            else:
                return schemas.DefectSyncResponse(
                    success=False,
                    message=f"Failed to update issue: {response.text}"
                )
    except Exception as e:
        return schemas.DefectSyncResponse(
            success=False,
            message=f"GitHub sync error: {str(e)}"
        )


# Defect Templates CRUD Functions

def get_defect_templates(db: Session, project_id: int):
    """Get all templates for a project"""
    return db.query(models.DefectTemplate).filter(
        models.DefectTemplate.project_id == project_id,
        models.DefectTemplate.is_active == True
    ).all()


def create_defect_template(
    db: Session,
    template: schemas.DefectTemplateCreate,
    project_id: int,
    created_by: int
):
    """Create a new defect template"""
    db_template = models.DefectTemplate(
        **template.model_dump(),
        project_id=project_id,
        created_by=created_by
    )
    db.add(db_template)
    db.commit()
    db.refresh(db_template)
    return db_template


def update_defect_template(
    db: Session,
    template_id: int,
    template_update: schemas.DefectTemplateUpdate
):
    """Update a defect template"""
    db_template = db.query(models.DefectTemplate).filter(
        models.DefectTemplate.id == template_id
    ).first()
    
    if db_template:
        update_data = template_update.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_template, field, value)
        
        db_template.updated_at = datetime.now(UTC)
        db.commit()
        db.refresh(db_template)
    
    return db_template


def delete_defect_template(db: Session, template_id: int):
    """Delete a defect template"""
    db_template = db.query(models.DefectTemplate).filter(
        models.DefectTemplate.id == template_id
    ).first()
    
    if db_template:
        db.delete(db_template)
        db.commit()
        return True
    return False
