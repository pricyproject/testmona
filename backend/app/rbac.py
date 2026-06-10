import re
from functools import wraps
from fastapi import HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session
from .models import User, Role, Project, ProjectAssignment
from typing import List, Optional, Pattern, Tuple


PROJECT_PERMISSION_ALIASES = {
    "view": "read",
}


# HTTP methods that never mutate state — always allowed for any authenticated user.
SAFE_METHODS = {"GET", "HEAD", "OPTIONS", "TRACE"}


def _m_re(method: str, pattern: str) -> Tuple[str, Pattern]:
    return (method.upper(), re.compile(pattern))


# Self-service writes a read-only ``viewer`` is still allowed to perform. Matched with
# ``re.search`` against ``request.url.path`` so an optional reverse-proxy "/api" prefix
# does not break matching. Anything not listed here is blocked for viewers.
_VIEWER_WRITE_ALLOWLIST: List[Tuple[str, Pattern]] = [
    # account & session
    _m_re("POST", r"/(token|refresh|logout)$"),
    _m_re("POST", r"/users/me/change-password$"),
    _m_re("POST", r"/users/me/2fa/(setup|enable|disable|recovery-codes)$"),
    _m_re("POST", r"/users/me/avatar$"),
    _m_re("PUT", r"/users/me$"),
    _m_re("PUT", r"/users/me/notification-preferences$"),
    _m_re("PUT", r"/users/me/onboarding-checklist/.+$"),
    # own notifications
    _m_re("PUT", r"/notifications/\d+(/mark-unread)?$"),
    _m_re("POST", r"/notifications/mark-all-read$"),
    _m_re("POST", r"/notifications/bulk-update$"),
    _m_re("DELETE", r"/notifications/(all|cleanup|bulk-delete|\d+)$"),
    # personal saved views / searches
    _m_re("POST", r"/saved-filters$"),
    _m_re("PUT", r"/saved-filters/\d+$"),
    _m_re("DELETE", r"/saved-filters/\d+$"),
    _m_re("POST", r"/advanced-search/saved$"),
]


def enforce_viewer_read_only(user: object, method: str, path: str) -> None:
    """Global read-only gate for the ``viewer`` role.

    No-op for superusers and any non-viewer role; viewers may issue safe (read) methods
    and the self-service writes in ``_VIEWER_WRITE_ALLOWLIST``. Everything else raises 403.
    This is defense-in-depth on top of the per-route ``has_permission`` checks: it covers
    every authenticated route because every one resolves through ``auth.get_current_user``.
    """
    if getattr(user, "is_superuser", False):
        return
    if normalize_role(getattr(user, "role", None)) != Role.VIEWER:
        return
    if method.upper() in SAFE_METHODS:
        return
    for allowed_method, pattern in _VIEWER_WRITE_ALLOWLIST:
        if allowed_method == method.upper() and pattern.search(path):
            return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Viewer role is read-only",
    )


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
    
    # Get projects through assignments and ownership.
    assignments = db.query(ProjectAssignment).filter(
        ProjectAssignment.user_id == user.id
    ).all()
    
    project_ids = [assignment.project_id for assignment in assignments]
    return db.query(Project).filter(
        or_(Project.owner_id == user.id, Project.id.in_(project_ids))
    ).all()


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
    seen_project_ids = set()
    for project in db.query(Project).filter(Project.owner_id == user.id).all():
        result.append({
            "project": project,
            "role": role_value(getattr(user, "role", None), Role.MANAGER),
            "assigned_at": None
        })
        seen_project_ids.add(project.id)

    for assignment in assignments:
        if assignment.project_id in seen_project_ids:
            continue
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
