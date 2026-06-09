from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Header, Request, status
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import and_, or_
from sqlalchemy.exc import IntegrityError
from typing import List, Dict, Any, Optional, Set
from pydantic import BaseModel, Field, field_validator
import csv
import io
import re
import json
import asyncio
import logging
import uuid
from datetime import datetime, date
from ..database import get_db
from .. import crud, schemas, auth, rbac
from ..models import Priority, Status, CustomFieldDefinition, CustomFieldValue, CustomFieldType, TestCase, TestCaseStep, TestSuite, TestCaseSection, Project, User, ImportOperation
from ..security_utils import validate_file_size, validate_file_extension, MAX_CSV_IMPORT_SIZE
from ..services.import_export_utils import (
    DuplicateAction,
    EXPORT_TIMEOUT_SECONDS,
    IDEMPOTENCY_RECORDS,
    IMPORT_JOBS,
    IMPORT_LOCKS,
    IMPORT_TIMEOUT_SECONDS,
    ImportMode,
    MAX_EXPORT_SIZE_BYTES,
    MAX_ROWS_PER_EXPORT,
    MAX_ROWS_PER_IMPORT,
    MAX_STEPS_PER_TEST_CASE,
    TEST_CASE_CSV_FIELDS,
    VALID_PRIORITIES,
    VALID_TEST_TYPES,
    DataValidationError,
    clean_date_string,
    detect_encoding,
    normalize_import_header,
    normalize_import_rows,
    normalize_multiline_text,
    normalize_priority,
    normalize_status,
    normalize_test_type,
    normalize_text,
    parse_bool,
    parse_import_datetime,
    sanitize_csv_field,
    validate_date_format,
    validate_export_fields,
    validate_owner_id,
)

from .base import router, logger

from .schemas import *
from .helpers import *
from .test_cases import *
from .project_import import *

def get_project_import_template(
    format: str = "json",
    db: Session = Depends(get_db),
    current_user: schemas.User = Depends(auth.get_current_active_user)
):
    """
    Get project import template
    Only accessible by admin and manager roles
    """
    # Check role-based access control
    user_role = str(current_user.role).upper()
    if user_role not in ["ADMIN", "MANAGER"]:
        raise HTTPException(
            status_code=403,
            detail="Only admin and manager roles can access project import template"
        )

    if format.lower() == "json":
        template_data = [
            {
                "name": "Sample Project",
                "description": "This is a sample project description",
                "status": "active",
                "owner_id": current_user.id
            }
        ]
        return {
            "filename": "project_import_template.json",
            "content": json.dumps(template_data, indent=2),
            "media_type": "application/json"
        }
    else:  # CSV
        fieldnames = ['name', 'description', 'status', 'owner_id']
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerow({
            'name': 'Sample Project',
            'description': 'This is a sample project description',
            'status': 'active',
            'owner_id': current_user.id
        })
        return {
            "filename": "project_import_template.csv",
            "content": output.getvalue(),
            "media_type": "text/csv"
        }


@router.post("/import/projects/validate")
async def validate_project_import(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: schemas.User = Depends(auth.get_current_active_user)
):
    """
    Validate project import file without actually importing
    Returns detailed row-by-row validation with preview data
    Only accessible by admin and manager roles
    """
    # Check role-based access control
    user_role = str(current_user.role).upper()
    if user_role not in ["ADMIN", "MANAGER"]:
        raise HTTPException(
            status_code=403,
            detail="Only admin and manager roles can validate project imports"
        )

    # Validate file size
    MAX_FILE_SIZE = 10 * 1024 * 1024
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File size exceeds 10MB limit")

    # Detect and handle character encoding
    try:
        encoding = detect_encoding(content)
        decoded_content = content.decode(encoding)
    except UnicodeDecodeError:
        try:
            decoded_content = content.decode('utf-8', errors='ignore')
        except Exception:
            raise HTTPException(status_code=400, detail="Unable to decode file. Please ensure file is UTF-8 encoded.")

    validation_errors = []
    validation_warnings = []
    valid_rows = 0
    preview_data = []
    conflicts = []

    try:
        if file.filename.endswith('.json'):
            try:
                projects_data = json.loads(decoded_content)
                if not isinstance(projects_data, list):
                    projects_data = [projects_data]
            except json.JSONDecodeError:
                raise HTTPException(status_code=400, detail="Invalid JSON format")

            # Validate row count limit
            if len(projects_data) > MAX_ROWS_PER_IMPORT:
                raise HTTPException(
                    status_code=400,
                    detail=f"File contains {len(projects_data)} rows. Maximum allowed is {MAX_ROWS_PER_IMPORT} rows per import."
                )

            for index, project_data in enumerate(projects_data):
                row_num = index + 1
                row_errors = []
                row_warnings = []

                if not isinstance(project_data, dict):
                    row_errors.append("Invalid data format, expected object")
                    validation_errors.append(f"Row {row_num}: Invalid data format, expected object")
                    preview_data.append({
                        "row": row_num,
                        "data": project_data,
                        "valid": False,
                        "errors": row_errors,
                        "warnings": row_warnings
                    })
                    continue

                if not project_data.get('name', '').strip():
                    row_errors.append("Missing required field 'name'")
                    validation_errors.append(f"Row {row_num}: Missing required field 'name'")

                # Validate owner_id exists
                owner_id = project_data.get('owner_id', current_user.id)
                if owner_id and not validate_owner_id(db, owner_id):
                    row_errors.append(f"Owner ID {owner_id} does not exist")
                    validation_errors.append(f"Row {row_num}: Owner ID {owner_id} does not exist")

                # Validate date formats
                created_at = project_data.get('created_at')
                updated_at = project_data.get('updated_at')
                if created_at and not validate_date_format(created_at):
                    row_errors.append("Invalid created_at date format. Use ISO 8601 format.")
                    validation_errors.append(f"Row {row_num}: Invalid created_at date format")
                if updated_at and not validate_date_format(updated_at):
                    row_errors.append("Invalid updated_at date format. Use ISO 8601 format.")
                    validation_errors.append(f"Row {row_num}: Invalid updated_at date format")

                # Check for potential duplicates
                project_name = project_data.get('name', '').strip()
                existing_project = db.query(Project).filter(
                    Project.name == project_name,
                    Project.owner_id == owner_id
                ).first()

                if existing_project:
                    conflict_info = {
                        "row": row_num,
                        "existing_id": existing_project.id,
                        "existing_name": existing_project.name,
                        "action_required": "skip, update, or merge"
                    }
                    conflicts.append(conflict_info)
                    row_warnings.append(f"Project '{project_name}' already exists (ID: {existing_project.id})")
                    validation_warnings.append(f"Row {row_num}: Project '{project_name}' already exists")

                if not row_errors:
                    valid_rows += 1

                preview_data.append({
                    "row": row_num,
                    "data": project_data,
                    "valid": len(row_errors) == 0,
                    "errors": row_errors,
                    "warnings": row_warnings,
                    "has_conflict": existing_project is not None
                })

        elif file.filename.endswith('.csv'):
            try:
                csv_reader = csv.DictReader(io.StringIO(decoded_content))
                projects_data = list(csv_reader)

                if not projects_data:
                    raise HTTPException(status_code=400, detail="File is empty")

                # Validate row count limit
                if len(projects_data) > MAX_ROWS_PER_IMPORT:
                    raise HTTPException(
                        status_code=400,
                        detail=f"File contains {len(projects_data)} rows. Maximum allowed is {MAX_ROWS_PER_IMPORT} rows per import."
                    )

                required_columns = ['name']
                missing_columns = [col for col in required_columns if col not in projects_data[0]]
                if missing_columns:
                    raise HTTPException(status_code=400, detail=f"Missing required columns: {missing_columns}")

                # Validate consistent column count
                expected_columns = len(projects_data[0])
                for index, row in enumerate(projects_data):
                    if len(row) != expected_columns:
                        validation_errors.append(f"Row {index + 1} has {len(row)} columns, expected {expected_columns}")

                for index, project_data in enumerate(projects_data):
                    row_num = index + 1
                    row_errors = []
                    row_warnings = []

                    if not project_data.get('name', '').strip():
                        row_errors.append("Missing required field 'name'")
                        validation_errors.append(f"Row {row_num}: Missing required field 'name'")

                    # Validate owner_id exists
                    owner_id = project_data.get('owner_id', current_user.id) if project_data.get('owner_id') else current_user.id
                    if owner_id and not validate_owner_id(db, owner_id):
                        row_errors.append(f"Owner ID {owner_id} does not exist")
                        validation_errors.append(f"Row {row_num}: Owner ID {owner_id} does not exist")

                    # Check for potential duplicates
                    project_name = project_data.get('name', '').strip()
                    existing_project = db.query(Project).filter(
                        Project.name == project_name,
                        Project.owner_id == owner_id
                    ).first()

                    if existing_project:
                        conflict_info = {
                            "row": row_num,
                            "existing_id": existing_project.id,
                            "existing_name": existing_project.name,
                            "action_required": "skip, update, or merge"
                        }
                        conflicts.append(conflict_info)
                        row_warnings.append(f"Project '{project_name}' already exists (ID: {existing_project.id})")
                        validation_warnings.append(f"Row {row_num}: Project '{project_name}' already exists")

                    if not row_errors:
                        valid_rows += 1

                    preview_data.append({
                        "row": row_num,
                        "data": project_data,
                        "valid": len(row_errors) == 0,
                        "errors": row_errors,
                        "warnings": row_warnings,
                        "has_conflict": existing_project is not None
                    })

            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Invalid CSV format: {str(e)}")
        else:
            raise HTTPException(status_code=400, detail="Only JSON and CSV files are supported")

        return {
            "valid": len(validation_errors) == 0,
            "total_rows": len(projects_data) if 'projects_data' in locals() else 0,
            "valid_rows": valid_rows,
            # Count distinct invalid rows, not the number of error messages
            # (a single row can contribute several error messages).
            "invalid_rows": sum(1 for row in preview_data if not row.get("valid", False)),
            "errors": validation_errors,
            "warnings": validation_warnings,
            "preview_data": preview_data,
            "conflicts": conflicts
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error validating file: {str(e)}")
