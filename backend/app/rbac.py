from functools import wraps
from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from .models import User, Role, Project, ProjectAssignment
from typing import List, Optional


PROJECT_PERMISSION_ALIASES = {
    "view": "read",
}


ROLE_PERMISSIONS = {
    Role.ADMIN: {"read", "write", "delete", "execute", "manage_users", "manage_projects"},
    Role.MANAGER: {"read", "write", "delete", "execute", "manage_projects"},
    Role.TESTER: {"read", "write", "execute"},
    Role.VIEWER: {"read"},
}


def normalize_permission(permission: str) -> str:
    normalized = permission.strip().lower()
    return PROJECT_PERMISSION_ALIASES.get(normalized, normalized)


def normalize_role(role: object) -> Optional[Role]:
    """Normalize DB strings, enum names, and enum values to a Role enum."""
    if isinstance(role, Role):
        return role
    if not isinstance(role, str):
        return None

    normalized = role.strip().lower()
    for candidate in Role:
        if normalized in {candidate.value.lower(), candidate.name.lower()}:
            return candidate
    return None


def role_value(role: object, default: Role = Role.TESTER) -> str:
    normalized_role = normalize_role(role)
    return (normalized_role or default).value


def is_role(user: User, role: Role) -> bool:
    return normalize_role(getattr(user, "role", None)) == role


def has_global_permission(user: User, permission: str) -> bool:
    if getattr(user, "is_superuser", False):
        return True
    normalized_role = normalize_role(getattr(user, "role", None))
    if not normalized_role:
        return False
    return normalize_permission(permission) in ROLE_PERMISSIONS.get(normalized_role, set())


def has_permission(user: User, permission: str, project_id: int = None, db: Session = None) -> bool:
    """Check if user has required permission"""
    permission = normalize_permission(permission)
    
    # Superusers have all permissions
    if getattr(user, "is_superuser", False):
        return True

    normalized_role = normalize_role(getattr(user, "role", None))
    global_permissions = ROLE_PERMISSIONS.get(normalized_role, set())
    
    # Non-project permissions use the user's global role only.
    if project_id is None:
        return permission in global_permissions
    
    if db is None:
        return False

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        return False

    # Global admin/manager permissions apply to all projects.
    if normalized_role in {Role.ADMIN, Role.MANAGER} and permission in global_permissions:
        return True

    # Project owners can manage their own project, but not global user admin.
    if project.owner_id == user.id and permission != "manage_users":
        return True

    assignment = db.query(ProjectAssignment).filter(
        ProjectAssignment.user_id == user.id,
        ProjectAssignment.project_id == project_id
    ).first()

    if not assignment:
        return False

    assignment_role = normalize_role(assignment.role)
    assignment_permissions = ROLE_PERMISSIONS.get(assignment_role, set())
    return permission in assignment_permissions


def require_permission(permission: str, project_id_param: str = None):
    """Decorator to require specific permission"""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            current_user = kwargs.get('current_user')
            if not current_user:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Authentication required"
                )
            
            project_id = None
            if project_id_param:
                project_id = kwargs.get(project_id_param)
            db = kwargs.get("db")
            
            if not has_permission(current_user, permission, project_id, db):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Insufficient permissions. Required: {permission}"
                )
            
            return await func(*args, **kwargs)
        return wrapper
    return decorator


def get_accessible_projects(user: User, db: Session) -> List[Project]:
    """Get projects that user has access to"""
    if getattr(user, "is_superuser", False) or is_role(user, Role.ADMIN) or is_role(user, Role.MANAGER):
        return db.query(Project).all()
    
    # Get projects through assignments
    assignments = db.query(ProjectAssignment).filter(
        ProjectAssignment.user_id == user.id
    ).all()
    
    project_ids = [assignment.project_id for assignment in assignments]
    return db.query(Project).filter(Project.id.in_(project_ids)).all()


def can_manage_project(user: User, project_id: int, db: Session) -> bool:
    """Check if user can manage a specific project"""
    return has_permission(user, "manage_projects", project_id, db)


def can_assign_users(user: User, project_id: int, db: Session) -> bool:
    """Check if user can assign other users to a project"""
    return can_manage_project(user, project_id, db)


def get_user_projects(user: User, db: Session):
    """Get projects with user's role in each project"""
    if getattr(user, "is_superuser", False) or is_role(user, Role.ADMIN) or is_role(user, Role.MANAGER):
        projects = db.query(Project).all()
        return [
            {"project": p, "role": role_value(getattr(user, "role", None), Role.ADMIN), "assigned_at": None}
            for p in projects
        ]

    assignments = db.query(ProjectAssignment).filter(
        ProjectAssignment.user_id == user.id
    ).all()

    result = []
    for assignment in assignments:
        project = db.query(Project).filter(
            Project.id == assignment.project_id
        ).first()
        if project:
            result.append({
                "project": project,
                "role": role_value(assignment.role),
                "assigned_at": assignment.assigned_at
            })

    return result
