"""
Common routes for health checks and enum definitions.
"""

from typing import Optional

from fastapi import Depends, Query
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from .. import crud, schemas, models, auth
from ..database import get_db


def register_common_routes(app):
    """Register common routes with the FastAPI app."""

    # Health Check
    @app.get("/health")
    def health_check(db: Session = Depends(get_db)):
        """Health check endpoint — verifies DB connectivity and migration state."""
        try:
            db.execute(text("SELECT 1"))
        except Exception as exc:
            return JSONResponse(
                status_code=503,
                content={"status": "unhealthy", "db": str(exc)},
            )

        try:
            row = db.execute(text("SELECT version_num FROM alembic_version")).first()
            migration_version = row[0] if row else None
        except Exception:
            migration_version = None

        return {
            "status": "healthy",
            "db": "ok",
            "migration_version": migration_version,
        }

    # Enum Endpoints
    @app.get("/enums/priorities")
    def get_priority_enums(project_id: Optional[int] = Query(None), db: Session = Depends(get_db), current_user: schemas.User = Depends(auth.get_current_active_user)):
        """Get priority enum values (scoped to a project when project_id is given)."""
        query = db.query(models.PriorityDefinition).filter(models.PriorityDefinition.is_active == True)
        if project_id is not None:
            crud.ensure_default_priority_and_test_type_definitions(db, project_id, current_user.id)
            query = query.filter(models.PriorityDefinition.project_id == project_id)
        priority_definitions = query.order_by(models.PriorityDefinition.value.desc()).all()
        return [
            {
                "value": pd.value,
                "name": pd.name,
                "description": pd.description,
                "color": pd.color,
                "is_default": pd.is_default
            }
            for pd in priority_definitions
        ]

    @app.get("/enums/test-types")
    def get_test_type_enums(project_id: Optional[int] = Query(None), db: Session = Depends(get_db), current_user: schemas.User = Depends(auth.get_current_active_user)):
        """Get test type enum values (scoped to a project when project_id is given)."""
        query = db.query(models.TestTypeDefinition).filter(models.TestTypeDefinition.is_active == True)
        if project_id is not None:
            crud.ensure_default_priority_and_test_type_definitions(db, project_id, current_user.id)
            query = query.filter(models.TestTypeDefinition.project_id == project_id)
        test_type_definitions = query.order_by(models.TestTypeDefinition.name).all()
        return [
            {
                "name": ttd.name,
                "description": ttd.description,
                "color": ttd.color,
                "icon": ttd.icon,
                "is_default": ttd.name.strip().lower() == "manual"
            }
            for ttd in test_type_definitions
        ]

    @app.get("/enums/status")
    def get_status_enums():
        """Get status enum values"""
        return [
            {"value": "draft", "label": "Draft"},
            {"value": "active", "label": "Active"},
            {"value": "archived", "label": "Archived"},
            {"value": "deprecated", "label": "Deprecated"}
        ]

    @app.get("/enums/test-case-status")
    def get_test_case_status_enums():
        """Get test case status enum values"""
        return [
            {"value": "draft", "label": "Draft"},
            {"value": "ready", "label": "Ready"},
            {"value": "in_progress", "label": "In Progress"},
            {"value": "completed", "label": "Completed"},
            {"value": "blocked", "label": "Blocked"}
        ]

    @app.get("/enums/result-status")
    def get_result_status_enums():
        """Get test result status enum values"""
        return [
            {"value": "pass", "label": "Pass"},
            {"value": "fail", "label": "Fail"},
            {"value": "blocked", "label": "Blocked"},
            {"value": "skip", "label": "Skip"},
            {"value": "not_started", "label": "Not Started"}
        ]

    @app.get("/enums/defect-severity")
    def get_defect_severity_enums():
        """Get defect severity enum values"""
        return [
            {"value": "critical", "label": "Critical"},
            {"value": "major", "label": "Major"},
            {"value": "moderate", "label": "Moderate"},
            {"value": "minor", "label": "Minor"},
            {"value": "trivial", "label": "Trivial"}
        ]

    @app.get("/enums/defect-priority")
    def get_defect_priority_enums():
        """Get defect priority enum values"""
        return [
            {"value": "urgent", "label": "Urgent"},
            {"value": "high", "label": "High"},
            {"value": "medium", "label": "Medium"},
            {"value": "low", "label": "Low"}
        ]

    @app.get("/enums/milestone-status")
    def get_milestone_status_enums():
        """Get milestone status enum values"""
        return [
            {"value": "not_started", "label": "Not Started"},
            {"value": "in_progress", "label": "In Progress"},
            {"value": "completed", "label": "Completed"},
            {"value": "delayed", "label": "Delayed"},
            {"value": "cancelled", "label": "Cancelled"}
        ]

    @app.get("/enums/test-plan-status")
    def get_test_plan_status_enums():
        """Get test plan status enum values"""
        return [
            {"value": "draft", "label": "Draft"},
            {"value": "in_progress", "label": "In Progress"},
            {"value": "completed", "label": "Completed"},
            {"value": "archived", "label": "Archived"}
        ]
