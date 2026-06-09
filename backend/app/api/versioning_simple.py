from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..services.versioning_service import VersioningService
from ..auth import get_current_user
from ..rbac import has_permission
from ..models import TestCase, User
from ..schemas import (
    TestCaseVersionCreate, TestCaseVersionUpdate
)

router = APIRouter(prefix="/versioning", tags=["versioning"])


def get_versioning_service(db: Session = Depends(get_db)) -> VersioningService:
    return VersioningService(db)


def get_user_id(current_user: User) -> int:
    return current_user.id


def get_test_case_project_id(db: Session, test_case_id: int) -> int:
    test_case = db.query(TestCase).filter(
        TestCase.id == test_case_id,
        ((TestCase.is_deleted.is_(None)) | (TestCase.is_deleted.is_(False))),
    ).first()
    project_id = test_case.project_id if test_case else None
    if project_id is None and test_case and test_case.test_suite:
        project_id = test_case.test_suite.project_id
    if not test_case or project_id is None:
        raise HTTPException(status_code=404, detail="Test case not found")
    return project_id


def require_test_case_permission(
    current_user: User,
    db: Session,
    test_case_id: int,
    permission: str,
) -> int:
    project_id = get_test_case_project_id(db, test_case_id)
    if not has_permission(current_user, permission, project_id, db):
        raise HTTPException(status_code=403, detail=f"No permission to {permission} versions")
    return project_id


def require_version_permission(current_user: User, db: Session, version, permission: str) -> int:
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")
    return require_test_case_permission(current_user, db, version.test_case_id, permission)


@router.post("/test-cases/{test_case_id}/versions")
def create_version(
    test_case_id: int,
    version_data: TestCaseVersionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    versioning_service: VersioningService = Depends(get_versioning_service)
):
    """Create a new version of a test case"""
    require_test_case_permission(current_user, db, test_case_id, "write")
    
    try:
        version = versioning_service.create_version(
            test_case_id=test_case_id,
            version_data=version_data,
            created_by=get_user_id(current_user)
        )
        return {"message": "Version created successfully", "version_id": version.id}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/test-cases/{test_case_id}/versions")
def get_versions(
    test_case_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    versioning_service: VersioningService = Depends(get_versioning_service)
):
    """Get all versions of a test case"""
    require_test_case_permission(current_user, db, test_case_id, "read")
    
    versions = versioning_service.get_versions(test_case_id)
    # The current version is the latest published one; resolve its id once so
    # the frontend can flag it (avoids an is_current_version query per row).
    current_version = versioning_service.get_latest_version(test_case_id)
    current_version_id = current_version.id if current_version else None
    return [
        {
            "id": v.id,
            "version_string": v.version_string,
            "status": v.status.value,
            "title": v.title,
            "created_at": v.created_at.isoformat(),
            # Frontend (VersionHistory) reads creator.full_name / creator.username,
            # so return an object rather than a bare string.
            "creator": {
                "id": v.creator.id,
                "username": v.creator.username,
                "full_name": v.creator.full_name,
            } if v.creator else None,
            "is_current_version": v.id == current_version_id
        }
        for v in versions
    ]


@router.get("/test-cases/{test_case_id}/versions/latest")
def get_latest_version(
    test_case_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    versioning_service: VersioningService = Depends(get_versioning_service)
):
    """Get the latest published version of a test case"""
    require_test_case_permission(current_user, db, test_case_id, "read")
    
    version = versioning_service.get_latest_version(test_case_id)
    if not version:
        return None
    
    return {
        "id": version.id,
        "version_string": version.version_string,
        "status": version.status.value,
        "title": version.title,
        "created_at": version.created_at.isoformat(),
        "creator": version.creator.full_name if version.creator else "Unknown"
    }


@router.post("/versions/compare")
def compare_versions(
    compare_data: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    versioning_service: VersioningService = Depends(get_versioning_service)
):
    """Compare two versions"""
    from_version_id = compare_data.get("from_version_id")
    to_version_id = compare_data.get("to_version_id")

    if from_version_id is None or to_version_id is None:
        raise HTTPException(status_code=422, detail="from_version_id and to_version_id are required")

    # Get versions to confirm they exist
    from_version = versioning_service.get_version(from_version_id)
    to_version = versioning_service.get_version(to_version_id)

    if not from_version or not to_version:
        raise HTTPException(status_code=404, detail="One or both versions not found")
    require_version_permission(current_user, db, from_version, "read")
    require_version_permission(current_user, db, to_version, "read")

    try:
        comparison = versioning_service.compare_versions(
            from_version_id=from_version_id,
            to_version_id=to_version_id,
            created_by=get_user_id(current_user)
        )
        return {
            "id": comparison.id,
            "from_version_id": comparison.from_version_id,
            "to_version_id": comparison.to_version_id,
            "field_differences": comparison.field_differences,
            "added_fields": comparison.added_fields,
            "removed_fields": comparison.removed_fields,
            "modified_fields": comparison.modified_fields,
            "similarity_score": comparison.similarity_score,
            "created_at": comparison.created_at.isoformat()
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/versions/branch")
def create_branch(
    branch_data: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    versioning_service: VersioningService = Depends(get_versioning_service)
):
    """Create a branch from a specific version"""
    parent_version_id = branch_data.get("parent_version_id")
    branch_name = (branch_data.get("branch_name") or "").strip()
    reason = branch_data.get("reason", "")

    if parent_version_id is None:
        raise HTTPException(status_code=422, detail="parent_version_id is required")
    if not branch_name:
        raise HTTPException(status_code=422, detail="branch_name is required")

    parent_version = versioning_service.get_version(parent_version_id)
    if not parent_version:
        raise HTTPException(status_code=404, detail="Parent version not found")
    require_version_permission(current_user, db, parent_version, "write")

    try:
        branch = versioning_service.create_branch(
            parent_version_id=parent_version_id,
            branch_name=branch_name,
            created_by=get_user_id(current_user),
            reason=reason
        )
        return {
            "id": branch.id,
            "version_string": branch.version_string,
            "status": branch.status.value,
            "title": branch.title,
            "branch_name": branch.branch_name,
            "created_at": branch.created_at.isoformat()
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/test-cases/{test_case_id}/rollback")
def rollback_to_version(
    test_case_id: int,
    rollback_data: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    versioning_service: VersioningService = Depends(get_versioning_service)
):
    """Rollback a test case to a specific version"""
    require_test_case_permission(current_user, db, test_case_id, "write")

    target_version_id = rollback_data.get("target_version_id")
    reason = rollback_data.get("reason", "Rollback")

    if target_version_id is None:
        raise HTTPException(status_code=422, detail="target_version_id is required")

    try:
        rollback_version = versioning_service.rollback_to_version(
            test_case_id=test_case_id,
            target_version_id=target_version_id,
            rollback_by=get_user_id(current_user),
            reason=reason
        )
        return {
            "id": rollback_version.id,
            "version_string": rollback_version.version_string,
            "status": rollback_version.status.value,
            "title": rollback_version.title,
            "created_at": rollback_version.created_at.isoformat()
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/test-cases/{test_case_id}/stats")
def get_version_stats(
    test_case_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    versioning_service: VersioningService = Depends(get_versioning_service)
):
    """Get version statistics for a test case"""
    require_test_case_permission(current_user, db, test_case_id, "read")
    
    versions = versioning_service.get_versions(test_case_id)
    current_version = versioning_service.get_latest_version(test_case_id)
    
    draft_versions = [v for v in versions if v.status.value == "draft"]
    published_versions = [v for v in versions if v.status.value == "published"]
    branches = [v for v in versions if v.branch_name is not None]
    
    # Get tags count
    from ..models_versioning import VersionTag
    version_ids = [v.id for v in versions]
    tags_count = (
        db.query(VersionTag).filter(VersionTag.version_id.in_(version_ids)).count()
        if version_ids
        else 0
    )
    
    # versions are ordered by version number, not creation time, so take the
    # most recent created_at explicitly
    last_updated = max((v.created_at for v in versions), default=None)
    
    return {
        "test_case_id": test_case_id,
        "total_versions": len(versions),
        "published_versions": len(published_versions),
        "draft_versions": len(draft_versions),
        "branches": len(branches),
        "tags": tags_count,
        "last_updated": last_updated.isoformat() if last_updated else None,
        "current_version": current_version.version_string if current_version else None
    }
