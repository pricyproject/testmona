"""Unit tests for the viewer read-only guard.

``enforce_viewer_read_only`` is the choke-point security gate wired into
``app/auth.py``. Testing it directly verifies the access matrix for all
authenticated routes at once, without needing a real JWT per route.

No database or HTTP harness required.
"""

import types

import pytest
from fastapi import HTTPException

from app.rbac import enforce_viewer_read_only


def _user(role="viewer", is_superuser=False):
    return types.SimpleNamespace(role=role, is_superuser=is_superuser)


def _allowed(user, method, path):
    """Return True if the guard lets the request through; False on 403."""
    try:
        enforce_viewer_read_only(user, method, path)
        return True
    except HTTPException as exc:
        assert exc.status_code == 403
        return False


# ---------------------------------------------------------------------------
# Viewer: blocked content writes
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("method,path", [
    ("POST", "/test-cases"),
    ("PUT", "/requirements/5"),
    ("DELETE", "/defects/3"),
    ("PATCH", "/test-cases/bulk"),
    ("POST", "/requirements/bulk/delete"),
    ("POST", "/projects/1/ai/conversations"),
    ("DELETE", "/users/me"),
    ("POST", "/notifications/"),
    ("POST", "/docs/release-notes/generate"),
])
def test_viewer_blocked_writes(method, path):
    assert _allowed(_user(), method, path) is False


# ---------------------------------------------------------------------------
# Viewer: allowed reads and self-service writes
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("method,path", [
    ("GET", "/test-cases"),
    ("GET", "/requirements/5"),
    ("HEAD", "/projects"),
    ("POST", "/token"),
    ("POST", "/logout"),
    ("POST", "/users/me/change-password"),
    ("POST", "/users/me/2fa/enable"),
    ("POST", "/users/me/avatar"),
    ("PUT", "/users/me"),
    ("PUT", "/users/me/notification-preferences"),
    ("PUT", "/users/me/onboarding-checklist/explore_test_cases"),
    ("PUT", "/notifications/12"),
    ("PUT", "/notifications/12/mark-unread"),
    ("POST", "/notifications/mark-all-read"),
    ("POST", "/notifications/bulk-update"),
    ("DELETE", "/notifications/all"),
    ("DELETE", "/notifications/7"),
    ("POST", "/saved-filters"),
    ("PUT", "/saved-filters/9"),
    ("DELETE", "/saved-filters/9"),
    ("POST", "/advanced-search/saved"),
])
def test_viewer_allowed(method, path):
    assert _allowed(_user(), method, path) is True


# ---------------------------------------------------------------------------
# Reverse-proxy prefix tolerance
# ---------------------------------------------------------------------------

def test_viewer_prefix_tolerant():
    assert _allowed(_user(), "POST", "/api/test-cases") is False
    assert _allowed(_user(), "PUT", "/api/users/me") is True


# ---------------------------------------------------------------------------
# Guard is a no-op for non-viewer roles and superusers
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("user", [
    _user(role="tester"),
    _user(role="manager"),
    _user(role="admin"),
    _user(role="viewer", is_superuser=True),
])
def test_non_viewers_unaffected(user):
    assert _allowed(user, "POST", "/test-cases") is True
    assert _allowed(user, "DELETE", "/defects/3") is True


# ---------------------------------------------------------------------------
# Enhanced: edge cases and boundary conditions
# ---------------------------------------------------------------------------

def test_viewer_cannot_post_to_any_project_subresource():
    """Any POST under /projects/<id>/<module> is a write and must be blocked."""
    for module in ("test-cases", "requirements", "defects", "test-runs", "test-plans", "milestones"):
        assert _allowed(_user(), "POST", f"/projects/1/{module}") is False


def test_viewer_can_get_any_project_subresource():
    for module in ("test-cases", "requirements", "defects", "test-runs", "test-plans", "milestones"):
        assert _allowed(_user(), "GET", f"/projects/1/{module}") is True


def test_viewer_blocked_on_bulk_operations():
    bulk_paths = [
        "/test-cases/bulk",
        "/requirements/bulk/delete",
        "/defects/bulk/update",
    ]
    for path in bulk_paths:
        for method in ("POST", "PUT", "PATCH", "DELETE"):
            result = _allowed(_user(), method, path)
            if method in ("POST", "PUT", "PATCH", "DELETE"):
                assert result is False, f"Expected blocked: {method} {path}"


def test_read_methods_on_write_paths_unblocked():
    """GET/HEAD on write-only-in-practice paths must not be blocked for viewers."""
    assert _allowed(_user(), "GET", "/test-cases/bulk") is True
    assert _allowed(_user(), "HEAD", "/defects/3") is True


def test_options_method_not_blocked():
    """OPTIONS (CORS preflight) must never be blocked by the viewer guard."""
    assert _allowed(_user(), "OPTIONS", "/test-cases") is True
    assert _allowed(_user(), "OPTIONS", "/requirements/bulk/delete") is True


# ---------------------------------------------------------------------------
# Role and permission normalization
# ---------------------------------------------------------------------------

def test_role_normalization_accepts_enum_names_values_and_case():
    from app.models import Role
    from app.rbac import normalize_role, role_value

    assert normalize_role(Role.VIEWER) == Role.VIEWER
    assert normalize_role(" VIEWER ") == Role.VIEWER
    assert normalize_role("manager") == Role.MANAGER
    assert normalize_role("unknown") is None
    assert normalize_role(None) is None
    assert role_value("viewer") == Role.VIEWER.value
    assert role_value("unknown", default=Role.ADMIN) == Role.ADMIN.value


def test_permission_aliases_apply_to_global_permissions():
    from app.rbac import has_global_permission, normalize_permission

    assert normalize_permission(" View ") == "read"
    assert has_global_permission(_user(role="viewer"), "view") is True
    assert has_global_permission(_user(role="viewer"), "write") is False


def test_viewer_notification_allowlist_requires_expected_path_shape():
    assert _allowed(_user(), "PUT", "/notifications/42") is True
    assert _allowed(_user(), "PUT", "/notifications/not-a-number") is False
    assert _allowed(_user(), "DELETE", "/notifications/cleanup") is True
    assert _allowed(_user(), "DELETE", "/notifications/cleanup/extra") is False
