"""FastAPI dependency for enforcing per-project feature toggles on routes.

Usage (no handler signature change required)::

    @app.get(
        "/test-cases",
        dependencies=[Depends(require_project_feature("test_cases"))],
    )

The dependency resolves the project from ``project_id`` in the path, the query
string, or a top-level ``project_id`` in a JSON request body (so both list and
create endpoints are covered). Requests that carry no resolvable ``project_id``
(e.g. ``/test-cases/{id}``) simply skip the check — those are reached from
already-guarded entry points and remain protected in the UI. See
:mod:`app.features` for the catalog.
"""

from typing import Optional

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .database import get_db
from .features import is_feature_enabled
from .models import Project


def _coerce_id(raw) -> Optional[int]:
    try:
        return int(raw) if raw is not None else None
    except (TypeError, ValueError):
        return None


async def _resolve_project_id(request: Request) -> Optional[int]:
    # Path param (e.g. /projects/{project_id}/ai/ask) then query (?project_id=).
    project_id = _coerce_id(
        request.path_params.get("project_id") or request.query_params.get("project_id")
    )
    if project_id is not None:
        return project_id

    # Fall back to a top-level project_id in a JSON body (create endpoints).
    if request.method not in ("POST", "PUT", "PATCH"):
        return None
    if "application/json" not in request.headers.get("content-type", ""):
        return None
    try:
        # Starlette caches the body, so the route handler can still read it.
        body = await request.json()
    except Exception:
        return None
    if isinstance(body, dict):
        return _coerce_id(body.get("project_id"))
    return None


def require_project_feature(feature_key: str):
    """Build a dependency that 403s when ``feature_key`` is disabled for the project."""

    async def dependency(request: Request, db: Session = Depends(get_db)) -> None:
        project_id = await _resolve_project_id(request)
        if project_id is None:
            return

        project = db.query(Project).filter(Project.id == project_id).first()
        if project is not None and not is_feature_enabled(project, feature_key):
            raise HTTPException(
                status_code=403,
                detail=f"The '{feature_key}' feature is disabled for this project",
            )

    return dependency
