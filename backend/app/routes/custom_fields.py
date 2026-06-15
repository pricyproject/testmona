"""
Custom fields routes for managing custom field definitions.
"""

from fastapi import Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional

from .. import crud, models, schemas, auth, rbac
from ..feature_guard import require_project_feature
from ..database import get_db
from ..auth import get_current_active_user


_ENTITY_TYPES = ("test_case", "test_run", "defect", "requirement")


def _resolve_entity_project(db: Session, entity_type: str, entity_id: int) -> Optional[int]:
    """Return the ``project_id`` that owns ``(entity_type, entity_id)``.

    Used by the unified endpoints to short-circuit on missing/foreign-project
    entities before doing any read or write work.
    """
    if entity_type == "test_case":
        case = crud.get_test_case(db, test_case_id=entity_id)
        if case is None or getattr(case, "is_deleted", False):
            return None
        suite = crud.get_test_suite(db, test_suite_id=case.test_suite_id)
        return suite.project_id if suite else None
    if entity_type == "test_run":
        run = db.query(models.TestRun).filter(models.TestRun.id == entity_id).first()
        return run.project_id if run else None
    if entity_type == "defect":
        defect = db.query(models.Defect).filter(models.Defect.id == entity_id).first()
        return defect.project_id if defect else None
    if entity_type == "requirement":
        req = db.query(models.Requirement).filter(models.Requirement.id == entity_id).first()
        return req.project_id if req else None
    return None


def _ensure_value_payload_matches(payload: schemas.CustomFieldValueCreate, entity_type: str, entity_id: int) -> None:
    """Sanity-check that the request body's polymorphic FK matches the URL."""
    expected_attr = f"{entity_type}_id"
    if getattr(payload, expected_attr, None) != entity_id:
        raise HTTPException(
            status_code=400,
            detail=f"Body's {expected_attr} must equal the URL's {entity_type}_id",
        )


def register_custom_fields_routes(app):
    """Register custom fields routes with the FastAPI app."""
    
    @app.get("/custom-fields/definitions",
             dependencies=[Depends(require_project_feature("custom_fields"))])
    def get_custom_fields_definitions(
        project_id: int,
        skip: int = 0,
        limit: int = 100,
        entity_type: Optional[str] = Query(None, description="Filter to definitions that apply to this entity type"),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """List custom field definitions for a project.

        ``entity_type`` (optional, one of test_case/test_run/defect/
        requirement) filters to definitions targeting that entity. A
        definition with NULL/empty ``entity_types`` is treated as
        test-case-only to preserve pre-unification behavior.
        """
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        if entity_type is not None and entity_type not in _ENTITY_TYPES:
            raise HTTPException(status_code=400, detail=f"Unsupported entity_type: {entity_type}")

        rows = crud.get_custom_field_definitions(db, project_id=project_id, skip=skip, limit=limit)
        if entity_type is not None:
            rows = [row for row in rows if crud.field_definition_applies_to(row, entity_type)]
        return rows

    @app.post("/custom-fields/definitions", response_model=schemas.CustomFieldDefinition,
              dependencies=[Depends(require_project_feature("custom_fields"))])
    def create_custom_fields_definition(
        field: schemas.CustomFieldDefinitionCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Create custom field definition - endpoint to match frontend expectations"""
        if not rbac.has_permission(current_user, "write", field.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return crud.create_custom_field_definition(db=db, field=field, user_id=current_user.id)

    @app.get("/custom-fields/definitions/{field_id}", response_model=schemas.CustomFieldDefinition)
    def get_custom_fields_definition(
        field_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Get custom field definition by ID - endpoint to match frontend expectations"""
        field = crud.get_custom_field_definition(db, field_id=field_id)
        if field is None:
            raise HTTPException(status_code=404, detail="Custom field definition not found")
        
        if not rbac.has_permission(current_user, "read", field.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return field

    @app.put("/custom-fields/definitions/{field_id}", response_model=schemas.CustomFieldDefinition)
    def update_custom_fields_definition(
        field_id: int,
        field: schemas.CustomFieldDefinitionUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Update custom field definition - endpoint to match frontend expectations"""
        # Check permissions first by getting the existing field
        existing_field = crud.get_custom_field_definition(db, field_id=field_id)
        if existing_field is None:
            raise HTTPException(status_code=404, detail="Custom field definition not found")
        
        if not rbac.has_permission(current_user, "write", existing_field.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        # Reuse existing CRUD function
        return crud.update_custom_field_definition(db, field_id=field_id, field=field, user_id=current_user.id)

    @app.delete("/custom-fields/definitions/{field_id}", response_model=schemas.MessageResponse)
    def delete_custom_fields_definition(
        field_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Delete custom field definition - endpoint to match frontend expectations"""
        # Check permissions first by getting the existing field
        existing_field = crud.get_custom_field_definition(db, field_id=field_id)
        if existing_field is None:
            raise HTTPException(status_code=404, detail="Custom field definition not found")
        
        if not rbac.has_permission(current_user, "delete", existing_field.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        # Reuse existing CRUD function
        crud.delete_custom_field_definition(db, field_id=field_id, user_id=current_user.id)
        return {"message": "Custom field definition deleted successfully"}

    @app.get("/test-cases/{test_case_id}/with-custom-fields", response_model=schemas.TestCaseWithCustomFields)
    def get_test_case_with_custom_fields(
        test_case_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Get test case with custom fields"""
        test_case = crud.get_test_case(db, test_case_id=test_case_id)
        if test_case is None:
            raise HTTPException(status_code=404, detail="Test case not found")

        test_suite = crud.get_test_suite(db, test_suite_id=test_case.test_suite_id)
        if not rbac.has_permission(current_user, "read", test_suite.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        return crud.get_test_case_with_custom_fields(db, test_case_id=test_case_id)

    # ----------------------------------------------------------------------
    # Unified polymorphic endpoints — same engine for cases/runs/defects/reqs
    # ----------------------------------------------------------------------

    @app.get(
        "/custom-fields/entities/{entity_type}/{entity_id}/values",
        response_model=List[schemas.CustomFieldValue],
    )
    def list_entity_custom_field_values(
        entity_type: str,
        entity_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        """List custom field values attached to one entity (case/run/defect/requirement)."""
        if entity_type not in _ENTITY_TYPES:
            raise HTTPException(status_code=400, detail=f"Unsupported entity_type: {entity_type}")
        project_id = _resolve_entity_project(db, entity_type, entity_id)
        if project_id is None:
            raise HTTPException(status_code=404, detail=f"{entity_type} not found")
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return crud.get_custom_field_values(db, entity_type=entity_type, entity_id=entity_id)

    @app.post(
        "/custom-fields/entities/{entity_type}/{entity_id}/values",
        response_model=schemas.CustomFieldValue,
        status_code=201,
    )
    def create_entity_custom_field_value(
        entity_type: str,
        entity_id: int,
        payload: schemas.CustomFieldValueCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        if entity_type not in _ENTITY_TYPES:
            raise HTTPException(status_code=400, detail=f"Unsupported entity_type: {entity_type}")
        _ensure_value_payload_matches(payload, entity_type, entity_id)

        project_id = _resolve_entity_project(db, entity_type, entity_id)
        if project_id is None:
            raise HTTPException(status_code=404, detail=f"{entity_type} not found")
        if not rbac.has_permission(current_user, "write", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        try:
            return crud.create_custom_field_value(db=db, value=payload, user_id=current_user.id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    @app.put(
        "/custom-fields/entities/{entity_type}/{entity_id}/values/{value_id}",
        response_model=schemas.CustomFieldValue,
    )
    def update_entity_custom_field_value(
        entity_type: str,
        entity_id: int,
        value_id: int,
        payload: schemas.CustomFieldValueUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        if entity_type not in _ENTITY_TYPES:
            raise HTTPException(status_code=400, detail=f"Unsupported entity_type: {entity_type}")
        db_value = crud.get_custom_field_value(db, value_id=value_id)
        if db_value is None:
            raise HTTPException(status_code=404, detail="Custom field value not found")
        # Verify the URL identifies the owner of this value — block cross-entity edits.
        if getattr(db_value, f"{entity_type}_id", None) != entity_id:
            raise HTTPException(status_code=404, detail="Custom field value does not belong to this entity")

        project_id = _resolve_entity_project(db, entity_type, entity_id)
        if project_id is None:
            raise HTTPException(status_code=404, detail=f"{entity_type} not found")
        if not rbac.has_permission(current_user, "write", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        try:
            return crud.update_custom_field_value(db, value_id=value_id, value=payload, user_id=current_user.id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    @app.delete("/custom-fields/entities/{entity_type}/{entity_id}/values/{value_id}", status_code=204)
    def delete_entity_custom_field_value(
        entity_type: str,
        entity_id: int,
        value_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user),
    ):
        if entity_type not in _ENTITY_TYPES:
            raise HTTPException(status_code=400, detail=f"Unsupported entity_type: {entity_type}")
        db_value = crud.get_custom_field_value(db, value_id=value_id)
        if db_value is None:
            raise HTTPException(status_code=404, detail="Custom field value not found")
        if getattr(db_value, f"{entity_type}_id", None) != entity_id:
            raise HTTPException(status_code=404, detail="Custom field value does not belong to this entity")

        project_id = _resolve_entity_project(db, entity_type, entity_id)
        if project_id is None:
            raise HTTPException(status_code=404, detail=f"{entity_type} not found")
        if not rbac.has_permission(current_user, "delete", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        crud.delete_custom_field_value(db, value_id=value_id, user_id=current_user.id)
        return

    # Custom Field Definition Endpoints (original path)
    @app.post("/custom-field-definitions/", response_model=schemas.CustomFieldDefinition)
    def create_custom_field_definition_original(
        field: schemas.CustomFieldDefinitionCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "write", field.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return crud.create_custom_field_definition(db=db, field=field, user_id=current_user.id)

    @app.get("/custom-field-definitions")
    def read_custom_field_definitions_original(
        project_id: int = None,
        skip: int = 0,
        limit: int = 100,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if project_id is not None and not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        if not project_id:
            return []
        
        return crud.get_custom_field_definitions(db, project_id=project_id, skip=skip, limit=limit)

    @app.get("/custom-field-definitions/{field_id}", response_model=schemas.CustomFieldDefinition)
    def read_custom_field_definition_original(
        field_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        field = crud.get_custom_field_definition(db, field_id=field_id)
        if field is None:
            raise HTTPException(status_code=404, detail="Custom field definition not found")
        
        if not rbac.has_permission(current_user, "read", field.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return field

    @app.put("/custom-field-definitions/{field_id}", response_model=schemas.CustomFieldDefinition)
    def update_custom_field_definition_original(
        field_id: int,
        field: schemas.CustomFieldDefinitionUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_field = crud.get_custom_field_definition(db, field_id=field_id)
        if db_field is None:
            raise HTTPException(status_code=404, detail="Custom field definition not found")
        
        if not rbac.has_permission(current_user, "write", db_field.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return crud.update_custom_field_definition(db, field_id=field_id, field=field, user_id=current_user.id)

    @app.delete("/custom-field-definitions/{field_id}", response_model=schemas.MessageResponse)
    def delete_custom_field_definition_original(
        field_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_field = crud.get_custom_field_definition(db, field_id=field_id)
        if db_field is None:
            raise HTTPException(status_code=404, detail="Custom field definition not found")
        
        if not rbac.has_permission(current_user, "delete", db_field.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        crud.delete_custom_field_definition(db, field_id=field_id, user_id=current_user.id)
        return {"message": "Custom field definition deleted successfully"}

    @app.get("/custom-field-definitions/{field_id}/with-values", response_model=schemas.CustomFieldDefinitionWithValues)
    def read_custom_field_definition_with_values(
        field_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        field = crud.get_custom_field_definition(db, field_id=field_id)
        if field is None:
            raise HTTPException(status_code=404, detail="Custom field definition not found")
        
        if not rbac.has_permission(current_user, "read", field.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        # Get values for this field
        values = crud.get_custom_field_values(db, field_definition_id=field_id)
        
        # Return field with values (manual construction since we don't have a direct relationship)
        field_dict = field.__dict__.copy()
        field_dict['values'] = values
        return schemas.CustomFieldDefinitionWithValues(**field_dict)

    # Custom Field Value Endpoints
    @app.post("/custom-field-values/", response_model=schemas.CustomFieldValue)
    def create_custom_field_value(
        value: schemas.CustomFieldValueCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        test_case = crud.get_test_case(db, test_case_id=value.test_case_id)
        if not test_case or getattr(test_case, "is_deleted", False):
            raise HTTPException(status_code=404, detail="Test case not found")

        test_suite = crud.get_test_suite(db, test_suite_id=test_case.test_suite_id)
        if not test_suite:
            raise HTTPException(status_code=404, detail="Test suite not found for this test case")
        if not rbac.has_permission(current_user, "write", test_suite.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        return crud.create_custom_field_value(db=db, value=value, user_id=current_user.id)

    @app.get("/custom-field-values/", response_model=List[schemas.CustomFieldValue])
    def read_custom_field_values(
        test_case_id: int = None,
        field_definition_id: int = None,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        project_id = None
        if test_case_id is not None:
            test_case = crud.get_test_case(db, test_case_id=test_case_id)
            if not test_case or getattr(test_case, "is_deleted", False):
                raise HTTPException(status_code=404, detail="Test case not found")
            test_suite = crud.get_test_suite(db, test_suite_id=test_case.test_suite_id)
            if test_suite:
                project_id = test_suite.project_id
        elif field_definition_id is not None:
            field_def = crud.get_custom_field_definition(db, field_id=field_definition_id)
            if field_def is None:
                raise HTTPException(status_code=404, detail="Custom field definition not found")
            project_id = field_def.project_id
        else:
            raise HTTPException(status_code=400, detail="At least one of test_case_id or field_definition_id is required")

        if project_id is not None and not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        return crud.get_custom_field_values(db, test_case_id=test_case_id, field_definition_id=field_definition_id)

    @app.get("/custom-field-values/{value_id}", response_model=schemas.CustomFieldValue)
    def read_custom_field_value(
        value_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        value = crud.get_custom_field_value(db, value_id=value_id)
        if value is None:
            raise HTTPException(status_code=404, detail="Custom field value not found")

        test_case = crud.get_test_case(db, test_case_id=value.test_case_id)
        if not test_case or getattr(test_case, "is_deleted", False):
            raise HTTPException(status_code=404, detail="Test case not found")
        test_suite = crud.get_test_suite(db, test_suite_id=test_case.test_suite_id)
        if not test_suite:
            raise HTTPException(status_code=404, detail="Test suite not found for this test case")
        if not rbac.has_permission(current_user, "read", test_suite.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        return value

    @app.put("/custom-field-values/{value_id}", response_model=schemas.CustomFieldValue)
    def update_custom_field_value(
        value_id: int,
        value: schemas.CustomFieldValueUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_value = crud.get_custom_field_value(db, value_id=value_id)
        if db_value is None:
            raise HTTPException(status_code=404, detail="Custom field value not found")

        test_case = crud.get_test_case(db, test_case_id=db_value.test_case_id)
        if not test_case or getattr(test_case, "is_deleted", False):
            raise HTTPException(status_code=404, detail="Test case not found")
        test_suite = crud.get_test_suite(db, test_suite_id=test_case.test_suite_id)
        if not test_suite:
            raise HTTPException(status_code=404, detail="Test suite not found for this test case")
        if not rbac.has_permission(current_user, "write", test_suite.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        return crud.update_custom_field_value(db, value_id=value_id, value=value, user_id=current_user.id)

    @app.delete("/custom-field-values/{value_id}", response_model=schemas.MessageResponse)
    def delete_custom_field_value(
        value_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_value = crud.get_custom_field_value(db, value_id=value_id)
        if db_value is None:
            raise HTTPException(status_code=404, detail="Custom field value not found")

        test_case = crud.get_test_case(db, test_case_id=db_value.test_case_id)
        if not test_case or getattr(test_case, "is_deleted", False):
            raise HTTPException(status_code=404, detail="Test case not found")
        test_suite = crud.get_test_suite(db, test_suite_id=test_case.test_suite_id)
        if not test_suite:
            raise HTTPException(status_code=404, detail="Test suite not found for this test case")
        if not rbac.has_permission(current_user, "delete", test_suite.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        crud.delete_custom_field_value(db, value_id=value_id, user_id=current_user.id)
        return {"message": "Custom field value deleted successfully"}
