from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .logging_config import configure_logging

# Configure structured (JSON in production) logging before anything else logs,
# so uvicorn and every module-level logger share one ingestion-friendly pipeline.
configure_logging()

from .import_export import router as import_export_router
from .api.audit import router as audit_router
from .api.versioning_simple import router as versioning_router
from .api.defect_management import router as defect_management_router
from .openapi_config import get_openapi_config

# Import middleware and utilities from separate modules
from .middleware import RateLimitMiddleware, RequestMetadataMiddleware, SecurityHeadersMiddleware

# Swagger UI / ReDoc are relocated off the bare ``/docs`` path so the Doc Hub
# API (``GET /docs`` and friends) can own it.
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Migrations are run by docker-entrypoint.sh (or `python migrate.py upgrade`)
    # before the process starts. Running them here again would race across replicas.
    from .setup_security import announce_setup_token
    from .database import SessionLocal
    db = SessionLocal()
    try:
        announce_setup_token(db)
    finally:
        db.close()
    from .token_cleanup import start_token_cleanup
    start_token_cleanup()
    yield


app = FastAPI(
    **get_openapi_config(),
    docs_url="/api-docs",
    redoc_url="/api-redoc",
    swagger_ui_oauth2_redirect_url="/api-docs/oauth2-redirect",
    lifespan=lifespan,
)

# Capture request IP/user-agent for service-layer audit logging.
app.add_middleware(RequestMetadataMiddleware)

# Add security headers middleware (for CSRF protection)
app.add_middleware(SecurityHeadersMiddleware)

# Add rate limiting middleware (1000 requests per 60 seconds per IP)
app.add_middleware(RateLimitMiddleware, calls=1000, period=60)

# Add CORS middleware. Origins come from the ALLOWED_ORIGINS setting
# (comma-separated) so production deployments are not locked to localhost.
allowed_origins = [origin.strip() for origin in settings.allowed_origins.split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins or ["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # Expose pagination total so the browser can read it cross-origin.
    expose_headers=["X-Total-Count"],
)

app.include_router(import_export_router, prefix="/import-export", tags=["Import/Export"])
app.include_router(audit_router, prefix="/audit-trails", tags=["Audit Trails"])
app.include_router(versioning_router, tags=["Versioning"])
app.include_router(defect_management_router, tags=["Defect Management"])

# Register modular routes
from .routes.common import register_common_routes
from .routes.auth import register_auth_routes
from .routes.users import register_user_routes
from .routes.system_settings import register_system_settings_routes
from .routes.projects import register_project_routes
from .routes.test_management import register_test_management_routes
from .routes.requirements_defects_plans import register_requirements_defects_plans_routes
from .routes.requirement_history import register_requirement_history_routes
from .routes.traceability_coverage import register_traceability_coverage_routes
from .routes.analytics_dashboard import register_analytics_dashboard_routes
from .routes.remaining_routes import register_remaining_routes
from .routes.notifications import register_notifications_routes
from .routes.inbox import register_inbox_routes
from .routes.definitions import register_definitions_routes
from .routes.tags import register_tags_routes
from .routes.custom_fields import register_custom_fields_routes
from .routes.shared_steps import register_shared_steps_routes
from .routes.tokens_webhooks import register_tokens_and_webhooks_routes
from .routes.saved_filters_and_bulk import register_saved_filters_and_bulk_routes
from .routes.datasets import register_dataset_routes
from .routes.ai_manager import register_ai_manager_routes
from .routes.ai_generation import register_ai_generation_routes
from .routes.project_ai_chat import register_project_ai_chat_routes
from .routes.docs import register_docs_routes
from .routes.advanced_search import register_advanced_search_routes
from .routes.resolvers import register_resolver_routes
from .routes.test_asset_health import register_test_asset_health_routes

register_common_routes(app)
register_auth_routes(app)
register_user_routes(app)
register_system_settings_routes(app)
register_project_routes(app)
register_test_management_routes(app)
# Register before requirements_defects_plans so the static /requirements/coverage
# and /requirements/comments/* paths are matched ahead of /requirements/{requirement_id}.
register_requirement_history_routes(app)
register_requirements_defects_plans_routes(app)
register_traceability_coverage_routes(app)
register_analytics_dashboard_routes(app)
register_remaining_routes(app)
register_notifications_routes(app)
register_inbox_routes(app)
register_definitions_routes(app)
register_tags_routes(app)
register_custom_fields_routes(app)
register_shared_steps_routes(app)
register_tokens_and_webhooks_routes(app)
register_saved_filters_and_bulk_routes(app)
register_dataset_routes(app)
register_ai_manager_routes(app)
register_ai_generation_routes(app)
register_project_ai_chat_routes(app)
register_docs_routes(app)
register_advanced_search_routes(app)
register_resolver_routes(app)
register_test_asset_health_routes(app)


