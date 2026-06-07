"""Project-scoped ``project_seq`` -> global ``id`` resolution.

Frontend URLs are project-first (``/projects/2/requirements/1``) and now carry a
per-project ``project_seq``, while the entity detail/sub-resource APIs remain keyed
by the global ``id``. Rather than duplicate every entity's response serialization,
this exposes a single thin lookup that maps ``(project_id, entity, project_seq)`` to
the global ``id``; the frontend's ``getBySeq`` chains that into the existing
``getById`` to load the full record (and its sub-resources) exactly as before.

If ``project_seq`` is NULL for a row (e.g. created by a Core-insert path that
bypassed the allocator, or a legacy bookmark), the frontend falls back to treating
the URL number as a global id, so nothing 500s.
"""
from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, rbac, schemas
from ..auth import get_current_active_user
from ..database import get_db

# URL path segment -> model with a real ``project_id`` column.
_SEQ_MODELS = {
    "requirements": models.Requirement,
    "test-suites": models.TestSuite,
    "test-runs": models.TestRun,
    "test-plans": models.TestPlan,
    "defects": models.Defect,
    "milestones": models.Milestone,
    "docs": models.Doc,
    "doc-spaces": models.DocSpace,
    "shared-steps": models.SharedStep,
    "environments": models.ExecutionEnvironment,
    "test-data": models.TestDataset,
    "global-parameters": models.GlobalParameter,
    "custom-fields": models.CustomFieldDefinition,
    "requirement-folders": models.RequirementFolder,
}


def register_resolver_routes(app):
    @app.get("/projects/{project_id}/lookup/{entity}/{seq}", tags=["Resolvers"])
    def resolve_project_seq(
        project_id: int,
        entity: str,
        seq: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """Resolve a per-project ``project_seq`` to its global ``id`` within a project."""
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        if entity == "test-cases":
            # TestCase has no project_id column — scope via its suite.
            row = (
                db.query(models.TestCase.id)
                .join(models.TestSuite, models.TestCase.test_suite_id == models.TestSuite.id)
                .filter(models.TestSuite.project_id == project_id, models.TestCase.project_seq == seq)
                .first()
            )
        else:
            model = _SEQ_MODELS.get(entity)
            if model is None:
                raise HTTPException(status_code=404, detail="Unknown entity")
            row = (
                db.query(model.id)
                .filter(model.project_id == project_id, model.project_seq == seq)
                .first()
            )

        if row is None:
            raise HTTPException(status_code=404, detail="Not found")
        return {"id": row[0], "project_id": project_id, "project_seq": seq}
