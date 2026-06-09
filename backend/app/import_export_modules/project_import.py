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
from .project_export import *

async def import_projects(
    file: UploadFile = File(...),
    merge_strategy: str = Form("skip"),  # skip, update, or merge
    partial_import: bool = Form(False),  # Allow partial import with error isolation
    selected_rows: Optional[str] = Form(None),  # Comma-separated 1-based row numbers to import
    db: Session = Depends(get_db),
    current_user: schemas.User = Depends(auth.get_current_active_user)
):
    """
    Import project(s) from JSON or CSV file
    Only accessible by admin and manager roles

    When `selected_rows` is provided, only those 1-based row numbers are imported;
    this lets the import-preview row selection actually take effect.
    """
    # Check role-based access control
    user_role = str(current_user.role).upper()
    if user_role not in ["ADMIN", "MANAGER"]:
        raise HTTPException(
            status_code=403,
            detail="Only admin and manager roles can import projects"
        )

    # Validate merge strategy
    if merge_strategy not in ["skip", "update", "merge"]:
        raise HTTPException(status_code=400, detail="merge_strategy must be 'skip', 'update', or 'merge'")

    # Validate file size (10MB limit)
    MAX_FILE_SIZE = 10 * 1024 * 1024
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File size exceeds 10MB limit")

    # Detect and handle character encoding
    try:
        encoding = detect_encoding(content)
        decoded_content = content.decode(encoding)
    except UnicodeDecodeError:
        # Fallback to UTF-8 with error handling
        try:
            decoded_content = content.decode('utf-8', errors='ignore')
        except Exception:
            raise HTTPException(status_code=400, detail="Unable to decode file. Please ensure file is UTF-8 encoded.")

    # Determine file format
    if file.filename.endswith('.json'):
        try:
            projects_data = json.loads(decoded_content)
            if not isinstance(projects_data, list):
                projects_data = [projects_data]
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid JSON format")
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

            # Validate required columns
            required_columns = ['name']
            missing_columns = [col for col in required_columns if col not in projects_data[0]]
            if missing_columns:
                raise HTTPException(status_code=400, detail=f"Missing required columns: {missing_columns}")

            # Validate consistent column count across all rows
            expected_columns = len(projects_data[0])
            for index, row in enumerate(projects_data):
                if len(row) != expected_columns:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Row {index + 1} has {len(row)} columns, expected {expected_columns}. CSV must have consistent column count."
                    )

        except Exception as e:
            if "CSV" in str(e):
                raise
            raise HTTPException(status_code=400, detail=f"Invalid CSV format: {str(e)}")
    else:
        raise HTTPException(status_code=400, detail="Only JSON and CSV files are supported")

    # Parse the optional row-selection filter (1-based row numbers).
    selected_row_set: Optional[Set[int]] = None
    if selected_rows is not None and selected_rows.strip() != "":
        try:
            selected_row_set = {
                int(token.strip())
                for token in selected_rows.split(",")
                if token.strip() != ""
            }
        except ValueError:
            raise HTTPException(status_code=400, detail="selected_rows must be comma-separated integers")

    # Wrap import in timeout
    try:
        result = await asyncio.wait_for(
            _perform_import(
                projects_data, file.filename, merge_strategy, partial_import, db, current_user,
                selected_row_set
            ),
            timeout=IMPORT_TIMEOUT_SECONDS
        )
        return result
    except asyncio.TimeoutError:
        raise HTTPException(
            status_code=408,
            detail=f"Import operation timed out after {IMPORT_TIMEOUT_SECONDS} seconds. Please try importing fewer rows at a time."
        )


async def _perform_import(
    projects_data: list,
    filename: str,
    merge_strategy: str,
    partial_import: bool,
    db: Session,
    current_user: schemas.User,
    selected_rows: Optional[Set[int]] = None
) -> dict:
    """Perform the actual import operation (wrapped in timeout)"""
    imported_count = 0
    updated_count = 0
    skipped_count = 0
    errors = []
    successful_imports = []
    failed_imports = []

    valid_statuses = {'active', 'inactive', 'archived'}

    # Only CSV supports basic project info only
    if filename.endswith('.csv'):
        # CSV import - basic project info only
        for index, project_data in enumerate(projects_data):
            row_num = index + 1

            # Honor the import-preview row selection, if one was supplied.
            if selected_rows is not None and row_num not in selected_rows:
                continue

            try:
                project_name = project_data.get('name', '').strip()
                project_description = project_data.get('description', '')
                project_status = (project_data.get('status') or 'active')
                if isinstance(project_status, str):
                    project_status = project_status.strip().lower()
                if project_status not in valid_statuses:
                    project_status = 'active'
                owner_id = project_data.get('owner_id', current_user.id) if project_data.get('owner_id') else current_user.id

                if not project_name:
                    errors.append(f"Row {row_num}: Missing required field 'name'")
                    failed_imports.append({"row": row_num, "error": "Missing required field 'name'", "data": project_data})
                    if not partial_import:
                        db.rollback()
                        raise HTTPException(status_code=400, detail=f"Import failed at row {row_num}: Missing required field 'name'. Use partial_import=True to continue with valid rows.")

                # Validate owner_id exists
                if owner_id and not validate_owner_id(db, owner_id):
                    errors.append(f"Row {row_num}: Owner ID {owner_id} does not exist")
                    failed_imports.append({"row": row_num, "error": f"Owner ID {owner_id} does not exist", "data": project_data})
                    if not partial_import:
                        db.rollback()
                        raise HTTPException(status_code=400, detail=f"Import failed at row {row_num}: Owner ID {owner_id} does not exist. Use partial_import=True to continue with valid rows.")

                existing_project = db.query(Project).filter(
                    Project.name == project_name,
                    Project.owner_id == owner_id
                ).first()

                if existing_project:
                    if merge_strategy == "skip":
                        skipped_count += 1
                        continue
                    elif merge_strategy == "update":
                        crud.update_project(
                            db,
                            project_id=existing_project.id,
                            project=schemas.ProjectUpdate(
                                name=project_name,
                                description=project_description,
                                status=project_status
                            )
                        )
                        updated_count += 1
                    elif merge_strategy == "merge":
                        suffix = 1
                        new_name = f"{project_name} (imported)"
                        while db.query(Project).filter(Project.name == new_name).first():
                            suffix += 1
                            new_name = f"{project_name} (imported {suffix})"

                        crud.create_project(
                            db,
                            project=schemas.ProjectCreate(
                                name=new_name,
                                description=project_description,
                                status=project_status,
                                owner_id=owner_id
                            )
                        )
                        imported_count += 1
                else:
                    crud.create_project(
                        db,
                        project=schemas.ProjectCreate(
                            name=project_name,
                            description=project_description,
                            status=project_status,
                            owner_id=owner_id
                        )
                    )
                    imported_count += 1
                    successful_imports.append({"row": row_num, "name": project_name})

            except Exception as e:
                error_msg = f"Row {row_num}: {str(e)}"
                errors.append(error_msg)
                failed_imports.append({"row": row_num, "error": error_msg, "data": project_data})
                if not partial_import:
                    # If not partial import, rollback entire transaction
                    db.rollback()
                    raise HTTPException(status_code=400, detail=f"Import failed at row {row_num}: {str(e)}. Use partial_import=True to continue with valid rows.")
    else:
        # JSON import - full data support
        # Validate row count limit
        if len(projects_data) > MAX_ROWS_PER_IMPORT:
            raise HTTPException(
                status_code=400,
                detail=f"File contains {len(projects_data)} rows. Maximum allowed is {MAX_ROWS_PER_IMPORT} rows per import."
            )

        for index, project_data in enumerate(projects_data):
            row_num = index + 1

            # Honor the import-preview row selection, if one was supplied.
            if selected_rows is not None and row_num not in selected_rows:
                continue

            # Per-project maps translating IDs from the export file to the
            # freshly created rows, so nested references resolve correctly.
            custom_field_id_map: Dict[int, int] = {}
            test_case_id_map: Dict[int, int] = {}

            try:
                project_name = project_data.get('name', '').strip()
                project_description = project_data.get('description', '')
                project_status = (project_data.get('status') or 'active')
                if isinstance(project_status, str):
                    project_status = project_status.strip().lower()
                if project_status not in valid_statuses:
                    project_status = 'active'
                owner_id = project_data.get('owner_id', current_user.id)

                if not project_name:
                    errors.append(f"Row {row_num}: Missing required field 'name'")
                    failed_imports.append({"row": row_num, "error": "Missing required field 'name'", "data": project_data})
                    if not partial_import:
                        db.rollback()
                        raise HTTPException(status_code=400, detail=f"Import failed at row {row_num}: Missing required field 'name'. Use partial_import=True to continue with valid rows.")
                    continue

                # Validate owner_id exists
                if owner_id and not validate_owner_id(db, owner_id):
                    errors.append(f"Row {row_num}: Owner ID {owner_id} does not exist")
                    failed_imports.append({"row": row_num, "error": f"Owner ID {owner_id} does not exist", "data": project_data})
                    if not partial_import:
                        db.rollback()
                        raise HTTPException(status_code=400, detail=f"Import failed at row {row_num}: Owner ID {owner_id} does not exist. Use partial_import=True to continue with valid rows.")
                    continue

                # Validate date formats
                created_at = project_data.get('created_at')
                updated_at = project_data.get('updated_at')
                if created_at and not validate_date_format(created_at):
                    errors.append(f"Row {row_num}: Invalid created_at date format. Use ISO 8601 format.")
                    failed_imports.append({"row": row_num, "error": "Invalid created_at date format", "data": project_data})
                    if not partial_import:
                        db.rollback()
                        raise HTTPException(status_code=400, detail=f"Import failed at row {row_num}: Invalid created_at date format. Use partial_import=True to continue with valid rows.")
                    continue
                if updated_at and not validate_date_format(updated_at):
                    errors.append(f"Row {row_num}: Invalid updated_at date format. Use ISO 8601 format.")
                    failed_imports.append({"row": row_num, "error": "Invalid updated_at date format", "data": project_data})
                    if not partial_import:
                        db.rollback()
                        raise HTTPException(status_code=400, detail=f"Import failed at row {row_num}: Invalid updated_at date format. Use partial_import=True to continue with valid rows.")
                    continue

                existing_project = db.query(Project).filter(
                    Project.name == project_name,
                    Project.owner_id == owner_id
                ).first()

                project_id = None

                if existing_project:
                    if merge_strategy == "skip":
                        skipped_count += 1
                        continue
                    elif merge_strategy == "update":
                        # Update existing project
                        updated_project = crud.update_project(
                            db,
                            project_id=existing_project.id,
                            project=schemas.ProjectUpdate(
                                name=project_name,
                                description=project_description,
                                status=project_status
                            )
                        )
                        project_id = existing_project.id
                        updated_count += 1
                    elif merge_strategy == "merge":
                        # Merge strategy - create new project with suffix
                        suffix = 1
                        new_name = f"{project_name} (imported)"
                        while db.query(Project).filter(Project.name == new_name).first():
                            suffix += 1
                            new_name = f"{project_name} (imported {suffix})"

                        new_project = crud.create_project(
                            db,
                            project=schemas.ProjectCreate(
                                name=new_name,
                                description=project_description,
                                status=project_status,
                                owner_id=owner_id
                            )
                        )
                        project_id = new_project.id
                        imported_count += 1
                else:
                    # Create new project
                    new_project = crud.create_project(
                        db,
                        project=schemas.ProjectCreate(
                            name=project_name,
                            description=project_description,
                            status=project_status,
                            owner_id=owner_id
                        )
                    )
                    project_id = new_project.id
                    imported_count += 1

                # Ensure default priority and test type definitions exist if they are blank in the DB
                crud.ensure_default_priority_and_test_type_definitions(db, project_id, owner_id)

                # Import custom field definitions first
                if 'custom_field_definitions' in project_data:
                    for cf_data in project_data['custom_field_definitions']:
                        try:
                            new_cf = crud.create_custom_field_definition(
                                db,
                                field=schemas.CustomFieldDefinitionCreate(
                                    name=cf_data['name'],
                                    field_type=cf_data['field_type'],
                                    is_required=cf_data['is_required'],
                                    options=cf_data.get('options'),
                                    validation_rules=cf_data.get('validation_rules'),
                                    project_id=project_id
                                )
                            )
                            # Remember old -> new id so custom field values can be remapped.
                            if cf_data.get('id') is not None and new_cf is not None:
                                custom_field_id_map[cf_data['id']] = new_cf.id
                        except Exception as cf_error:
                            errors.append(f"Row {row_num}: Failed to import custom field '{cf_data['name']}': {str(cf_error)}")

                # Import test suites and test cases
                if 'test_suites' in project_data:
                    for ts_data in project_data['test_suites']:
                        try:
                            # Create test suite
                            new_suite = crud.create_test_suite(
                                db,
                                test_suite=schemas.TestSuiteCreate(
                                    name=ts_data['name'],
                                    description=ts_data.get('description'),
                                    project_id=project_id
                                )
                            )

                            # Import test cases
                            if 'test_cases' in ts_data:
                                for tc_data in ts_data['test_cases']:
                                    try:
                                        # Create test case with required creator
                                        new_case = crud.create_test_case(
                                            db,
                                            test_case=schemas.TestCaseCreate(
                                                title=tc_data['title'],
                                                description=tc_data.get('description'),
                                                preconditions=tc_data.get('preconditions', ''),
                                                steps=tc_data.get('steps', ''),
                                                expected_result=tc_data.get('expected_result', ''),
                                                priority=tc_data.get('priority', 'medium'),
                                                status=tc_data.get('status', 'active'),
                                                tags=tc_data.get('tags'),
                                                test_suite_id=new_suite.id,
                                                test_type=tc_data.get('test_type', 'manual'),
                                                section_id=tc_data.get('section_id'),
                                                order_index=tc_data.get('order_index', 0),
                                                is_multistep=tc_data.get('is_multistep', False)
                                            ),
                                            created_by=current_user.id
                                        )

                                        # Remember old -> new id so test results can be remapped.
                                        if tc_data.get('id') is not None:
                                            test_case_id_map[tc_data['id']] = new_case.id

                                        # Import test case steps if multistep
                                        if tc_data.get('is_multistep') and 'test_case_steps' in tc_data:
                                            for step_data in tc_data['test_case_steps']:
                                                try:
                                                    crud.create_test_case_step(
                                                        db,
                                                        step=schemas.TestCaseStepCreate(
                                                            test_case_id=new_case.id,
                                                            step_number=step_data['step_number'],
                                                            action=step_data.get('action'),
                                                            expected_result=step_data.get('expected_result'),
                                                            step_type=step_data.get('step_type', 'manual')
                                                        )
                                                    )
                                                except Exception as step_error:
                                                    errors.append(f"Row {row_num}: Failed to import test case step: {str(step_error)}")

                                        # Import custom field values, remapping the
                                        # field definition id from the export file.
                                        if 'custom_field_values' in tc_data:
                                            for cfv_data in tc_data['custom_field_values']:
                                                try:
                                                    old_field_id = cfv_data.get('field_definition_id')
                                                    mapped_field_id = custom_field_id_map.get(old_field_id)
                                                    if mapped_field_id is None:
                                                        errors.append(
                                                            f"Row {row_num}: Skipped custom field value "
                                                            f"(no imported field definition for id {old_field_id})"
                                                        )
                                                        continue
                                                    db.add(CustomFieldValue(
                                                        field_definition_id=mapped_field_id,
                                                        test_case_id=new_case.id,
                                                        value=cfv_data['value']
                                                    ))
                                                    db.commit()
                                                except Exception as cfv_error:
                                                    errors.append(f"Row {row_num}: Failed to import custom field value: {str(cfv_error)}")

                                    except Exception as tc_error:
                                        error_msg = f"Row {row_num}: Failed to import test case '{tc_data.get('title')}': {str(tc_error)}"
                                        errors.append(error_msg)
                                        if not partial_import:
                                            db.rollback()
                                            raise HTTPException(status_code=400, detail=error_msg)

                        except Exception as ts_error:
                            errors.append(f"Row {row_num}: Failed to import test suite '{ts_data['name']}': {str(ts_error)}")

                # Import test runs and test results
                if 'test_runs' in project_data:
                    for tr_data in project_data['test_runs']:
                        try:
                            # Create test run
                            new_run = crud.create_test_run(
                                db,
                                test_run=schemas.TestRunCreate(
                                    name=tr_data['name'],
                                    description=tr_data.get('description'),
                                    status=tr_data.get('status', 'active'),
                                    project_id=project_id
                                )
                            )

                            # Import test results, remapping the test case id from
                            # the export file to the freshly imported test case.
                            if 'test_results' in tr_data:
                                for result_data in tr_data['test_results']:
                                    try:
                                        old_case_id = result_data.get('test_case_id')
                                        test_case_id = test_case_id_map.get(old_case_id)
                                        if test_case_id is None:
                                            errors.append(
                                                f"Row {row_num}: Skipped test result "
                                                f"(no imported test case for id {old_case_id})"
                                            )
                                            continue

                                        crud.create_test_result(
                                            db,
                                            test_result=schemas.TestResultCreate(
                                                test_case_id=test_case_id,
                                                test_run_id=new_run.id,
                                                status=result_data.get('status', 'not_started'),
                                                actual_result=result_data.get('actual_result'),
                                                comments=result_data.get('comments'),
                                                execution_time=result_data.get('execution_time', 0),
                                                executed_by=result_data.get('executed_by')
                                            )
                                        )
                                    except Exception as result_error:
                                        errors.append(f"Row {row_num}: Failed to import test result: {str(result_error)}")

                        except Exception as tr_error:
                            errors.append(f"Row {row_num}: Failed to import test run '{tr_data['name']}': {str(tr_error)}")

                # Import test plans
                if 'test_plans' in project_data:
                    for tp_data in project_data['test_plans']:
                        try:
                            crud.create_test_plan(
                                db,
                                test_plan=schemas.TestPlanCreate(
                                    title=tp_data.get('title', tp_data.get('name')),
                                    description=tp_data.get('description'),
                                    status=tp_data.get('status', 'active'),
                                    target_start_date=tp_data.get('start_date'),
                                    target_end_date=tp_data.get('end_date'),
                                    project_id=project_id,
                                    created_by=current_user.id
                                )
                            )
                        except Exception as tp_error:
                            errors.append(f"Row {row_num}: Failed to import test plan '{tp_data.get('name', tp_data.get('title'))}': {str(tp_error)}")

                # Import milestones
                if 'milestones' in project_data:
                    valid_milestone_statuses = {'planned', 'in_progress', 'completed', 'cancelled'}
                    for ms_data in project_data['milestones']:
                        milestone_title = ms_data.get('title') or ms_data.get('name') or 'Imported milestone'
                        milestone_status = ms_data.get('status') if ms_data.get('status') in valid_milestone_statuses else 'planned'
                        try:
                            crud.create_milestone(
                                db,
                                milestone=schemas.MilestoneCreate(
                                    title=milestone_title,
                                    description=ms_data.get('description'),
                                    status=milestone_status,
                                    target_date=ms_data.get('target_date') or ms_data.get('due_date'),
                                    actual_date=ms_data.get('actual_date'),
                                    progress_percentage=ms_data.get('progress_percentage', 0),
                                    project_id=project_id,
                                    created_by=current_user.id
                                )
                            )
                        except Exception as ms_error:
                            errors.append(f"Row {row_num}: Failed to import milestone '{milestone_title}': {str(ms_error)}")

                # Import requirements
                if 'requirements' in project_data:
                    for req_data in project_data['requirements']:
                        try:
                            crud.create_requirement(
                                db,
                                requirement=schemas.RequirementCreate(
                                    title=req_data['title'],
                                    description=req_data.get('description'),
                                    priority=req_data.get('priority', 'medium'),
                                    status=req_data.get('status', 'draft'),
                                    project_id=project_id
                                )
                            )
                        except Exception as req_error:
                            errors.append(f"Row {row_num}: Failed to import requirement '{req_data['title']}': {str(req_error)}")

                # Import defects
                if 'defects' in project_data:
                    for defect_data in project_data['defects']:
                        try:
                            crud.create_defect(
                                db,
                                defect=schemas.DefectCreate(
                                    title=defect_data['title'],
                                    description=defect_data.get('description'),
                                    severity=defect_data.get('severity', 'medium'),
                                    priority=defect_data.get('priority', 'medium'),
                                    status=defect_data.get('status', 'open'),
                                    reported_by=defect_data.get('reported_by', current_user.id),
                                    project_id=project_id
                                )
                            )
                        except Exception as defect_error:
                            errors.append(f"Row {row_num}: Failed to import defect '{defect_data['title']}': {str(defect_error)}")

                db.commit()

            except Exception as e:
                db.rollback()
                errors.append(f"Row {row_num}: {str(e)}")

    return {
        "message": f"Successfully imported {imported_count} project(s)" + (f", updated {updated_count}" if updated_count > 0 else "") + (f", skipped {skipped_count}" if skipped_count > 0 else ""),
        "imported_count": imported_count,
        "updated_count": updated_count,
        "skipped_count": skipped_count,
        "errors": errors,
        "successful_imports": successful_imports,
        "failed_imports": failed_imports if partial_import else [],
        "partial_import": partial_import
    }
