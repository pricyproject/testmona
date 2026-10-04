"""FastAPI dependency for enforcing per-project feature toggles on routes.

Usage (no handler signature change required)::

    @app.get(
        "/test-cases",
        dependencies=[Depends(require_project_feature("test_cases"))],
    )

The dependency resolves the project from ``project_id`` in the path, the query
string, or a top-level ``project_id`` in a JSON request body (so both list and
create endpoints are covered). When none of those carry it, it falls back to the
owning suite — ``test_suite_id``, ``section_id`` or ``test_case_id`` in
path/query/body — so ``/test-suites/{id}``, the section routes and the
single-entity test-case routes are covered too.
Requests that still carry no resolvable reference simply skip the check; they are
reached from already-guarded entry points and remain protected in the UI. See
:mod:`app.features` for the catalog.
"""

from typing import Optional

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .database import get_db
from .features import is_feature_enabled
from .models import Project, TestCase, TestCaseSection, TestSuite


def _coerce_id(raw) -> Optional[int]:
    try:
        return int(raw) if raw is not None else None
    except (TypeError, ValueError):
        return None


async def _json_body(request: Request):
    if request.method not in ("POST", "PUT", "PATCH"):
        return None
    if "application/json" not in request.headers.get("content-type", ""):
        return None
    try:
        # Starlette caches the body, so the route handler can still read it.
        body = await request.json()
    except Exception:
        return None
    return body if isinstance(body, dict) else None


async def _resolve_project_id(request: Request, db: Session) -> Optional[int]:
    # Path param (e.g. /projects/{project_id}/ai/ask) then query (?project_id=).
    project_id = _coerce_id(
        request.path_params.get("project_id") or request.query_params.get("project_id")
    )
    if project_id is not None:
        return project_id

    body = await _json_body(request)

    # Fall back to a top-level project_id in a JSON body (create endpoints).
    if body is not None:
        project_id = _coerce_id(body.get("project_id"))
        if project_id is not None:
            return project_id

    # Last resort for routes that only carry an entity id (e.g. PUT
    # /test-suites/{test_suite_id}, DELETE /test-cases/{test_case_id}): resolve
    # the project through the owning suite so the toggle is enforced there too.
    suite_id = _coerce_id(
        request.path_params.get("test_suite_id")
        or request.query_params.get("test_suite_id")
        or (body or {}).get("test_suite_id")
    )
    if suite_id is None:
        section_id = _coerce_id(
            request.path_params.get("section_id")
            or request.query_params.get("section_id")
            or (body or {}).get("section_id")
        )
        if section_id is not None:
            suite_id = (
                db.query(TestCaseSection.test_suite_id)
                .filter(TestCaseSection.id == section_id)
                .scalar()
            )
    if suite_id is None:
        case_id = _coerce_id(
            request.path_params.get("test_case_id")
            or request.query_params.get("test_case_id")
            or (body or {}).get("test_case_id")
        )
        if case_id is None:
            return None
        suite_id = (
            db.query(TestCase.test_suite_id).filter(TestCase.id == case_id).scalar()
        )
    if suite_id is None:
        return None
    return db.query(TestSuite.project_id).filter(TestSuite.id == suite_id).scalar()


def require_project_feature(feature_key: str):
    """Build a dependency that 403s when ``feature_key`` is disabled for the project."""

    async def dependency(request: Request, db: Session = Depends(get_db)) -> None:
        project_id = await _resolve_project_id(request, db)
        if project_id is None:
            return

        project = db.query(Project).filter(Project.id == project_id).first()
        if project is not None and not is_feature_enabled(project, feature_key):
            raise HTTPException(
                status_code=403,
                detail=f"The '{feature_key}' feature is disabled for this project",
            )

    return dependency


def require_any_project_feature(*feature_keys: str):
    """403 only when *every* listed feature is disabled for the project.

    For routes shared by two modules — e.g. test-case sections, which both the
    Test Cases page and the Test Suite page write to. Such a route stays
    available while either owning module is on.
    """
    keys = tuple(feature_keys)

    async def dependency(request: Request, db: Session = Depends(get_db)) -> None:
        project_id = await _resolve_project_id(request, db)
        if project_id is None:
            return

        project = db.query(Project).filter(Project.id == project_id).first()
        if project is not None and not any(
            is_feature_enabled(project, key) for key in keys
        ):
            raise HTTPException(
                status_code=403,
                detail=f"The '{'/'.join(keys)}' features are disabled for this project",
            )

    return dependency
