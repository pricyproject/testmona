from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import init_db
from .import_export import router as import_export_router
from .api.audit import router as audit_router
from .api.versioning_simple import router as versioning_router
from .api.defect_management import router as defect_management_router
from .openapi_config import get_openapi_config

# Import middleware and utilities from separate modules
from .middleware import RateLimitMiddleware, RequestMetadataMiddleware, SecurityHeadersMiddleware

app = FastAPI(**get_openapi_config())

# Capture request IP/user-agent for service-layer audit logging.
app.add_middleware(RequestMetadataMiddleware)

# Add security headers middleware (for CSRF protection)
app.add_middleware(SecurityHeadersMiddleware)

# Add rate limiting middleware (1000 requests per 60 seconds per IP)
app.add_middleware(RateLimitMiddleware, calls=1000, period=60)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
from .routes.definitions import register_definitions_routes
from .routes.custom_fields import register_custom_fields_routes
from .routes.shared_steps import register_shared_steps_routes
from .routes.tokens_webhooks import register_tokens_and_webhooks_routes
from .routes.saved_filters_and_bulk import register_saved_filters_and_bulk_routes
from .routes.datasets import register_dataset_routes
from .routes.ai_manager import register_ai_manager_routes
from .routes.ai_generation import register_ai_generation_routes

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
register_definitions_routes(app)
register_custom_fields_routes(app)
register_shared_steps_routes(app)
register_tokens_and_webhooks_routes(app)
register_saved_filters_and_bulk_routes(app)
register_dataset_routes(app)
register_ai_manager_routes(app)
register_ai_generation_routes(app)


@app.on_event("startup")
def startup_event():
    """Initialize database on startup"""
    init_db()
    # Start token cleanup job after database is ready
    from .token_cleanup import start_token_cleanup
    start_token_cleanup()
