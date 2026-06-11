"""Backend route/import wiring guardrails.

These tests are intentionally metadata-focused: they catch broken imports,
duplicate route registration, missing auth dependencies on unsafe routes, and
OpenAPI generation failures without exercising every endpoint body.
"""

from collections import defaultdict


def test_backend_app_modules_import_cleanly():
    import importlib
    import pkgutil
    import app

    failures = []
    for module_info in pkgutil.walk_packages(app.__path__, prefix="app."):
        try:
            importlib.import_module(module_info.name)
        except Exception as exc:  # pragma: no cover - assertion reports details
            failures.append(f"{module_info.name}: {type(exc).__name__}: {exc}")

    assert failures == []


def test_main_routes_have_no_duplicate_method_paths_and_include_key_features():
    from app.main import app as fastapi_app

    seen = defaultdict(list)
    for route in fastapi_app.routes:
        methods = getattr(route, "methods", None) or []
        endpoint = getattr(route, "endpoint", None)
        endpoint_name = f"{endpoint.__module__}.{endpoint.__name__}" if endpoint else str(route)
        for method in methods:
            if method not in {"HEAD", "OPTIONS"}:
                seen[(method, route.path)].append(endpoint_name)

    duplicates = {key: endpoints for key, endpoints in seen.items() if len(endpoints) > 1}
    paths = {route.path for route in fastapi_app.routes if hasattr(route, "methods")}

    assert duplicates == {}
    assert {
        "/milestones",
        "/test-plans",
        "/projects/{project_id}/test-asset-health/summary",
        "/test-runs/{test_run_id}/defect-coverage",
        "/test-runs/{test_run_id}/flakiness",
        "/coverage-reports/generate",
    } <= paths


def test_openapi_schema_builds_without_writing_file():
    from app.main import app as fastapi_app

    schema = fastapi_app.openapi()

    assert len(schema["paths"]) >= 300
    assert "/api-docs" not in schema["paths"]
    assert "schemas" in schema.get("components", {})


def test_unsafe_routes_require_auth_dependency_or_public_allowlist():
    from app.main import app as fastapi_app

    auth_dependencies = {
        "get_current_user",
        "get_current_active_user",
        "get_current_user_check_password_change",
    }
    public_unsafe_routes = {
        ("POST", "/system/setup"),
        ("POST", "/register"),
        ("POST", "/token"),
        ("POST", "/refresh"),
        ("POST", "/invitations/{token}/accept"),
    }
    failures = []

    for route in fastapi_app.routes:
        methods = (getattr(route, "methods", None) or set()) - {"HEAD", "OPTIONS", "GET"}
        for method in methods:
            if (method, route.path) in public_unsafe_routes:
                continue
            dependency_names = set()
            stack = list(getattr(getattr(route, "dependant", None), "dependencies", []) or [])
            while stack:
                dependency = stack.pop()
                dependency_names.add(getattr(dependency.call, "__name__", ""))
                stack.extend(dependency.dependencies)
            if not (dependency_names & auth_dependencies):
                failures.append(f"{method} {route.path}")

    assert failures == []
