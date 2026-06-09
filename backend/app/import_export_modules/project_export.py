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

async def export_projects(
    project_id: Optional[int] = None,
    format: str = "json",
    include_data: bool = True,
    fields: Optional[str] = None,  # Comma-separated list of fields to include
    status_filter: Optional[str] = None,  # Filter by project status
    db: Session = Depends(get_db),
    current_user: schemas.User = Depends(auth.get_current_active_user)
):
    """
    Export project(s) to JSON or CSV format with customization options
    Only accessible by admin and manager roles

    Parameters:
    - project_id: Optional project ID to export specific project
    - format: 'json' or 'csv'
    - include_data: Whether to include related data (test suites, test cases, etc.)
    - fields: Comma-separated list of fields to include (e.g., 'id,name,description')
    - status_filter: Filter projects by status (e.g., 'active', 'archived')
    """
    # Check role-based access control
    user_role = str(current_user.role).upper()
    if user_role not in ["ADMIN", "MANAGER"]:
        raise HTTPException(
            status_code=403,
            detail="Only admin and manager roles can export projects"
        )

    if format.lower() not in ["json", "csv"]:
        raise HTTPException(status_code=400, detail="Format must be 'json' or 'csv'")

    # Parse and validate fields filter
    field_list = validate_export_fields(fields)

    # Wrap export in timeout
    try:
        result = await asyncio.wait_for(
            _perform_export(
                project_id, format, include_data, field_list, status_filter, db, current_user
            ),
            timeout=EXPORT_TIMEOUT_SECONDS
        )
        return result
    except asyncio.TimeoutError:
        raise HTTPException(
            status_code=408,
            detail=f"Export operation timed out after {EXPORT_TIMEOUT_SECONDS} seconds. Please use field filtering or status filter to reduce export size."
        )


async def _perform_export(
    project_id: Optional[int],
    format: str,
    include_data: bool,
    field_list: List[str],
    status_filter: Optional[str],
    db: Session,
    current_user: schemas.User
) -> dict:
    """Perform the actual export operation (wrapped in timeout)"""
    # Restrict the export to projects the requesting user can actually access,
    # so role-based access control is honored (not just the admin/manager gate).
    accessible_ids = {p.id for p in rbac.get_accessible_projects(current_user, db)}
    if not accessible_ids:
        raise HTTPException(status_code=404, detail="No projects found")

    query = db.query(Project).filter(Project.id.in_(accessible_ids))

    # Apply status filter ('all' or empty means no filtering)
    if status_filter and status_filter.strip().lower() not in ("", "all"):
        try:
            status_enum = Status(status_filter.lower())
            query = query.filter(Project.status == status_enum)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid status filter: {status_filter}")

    if project_id:
        query = query.filter(Project.id == project_id)

    projects = query.limit(1000).all()

    if not projects:
        raise HTTPException(status_code=404, detail="No projects found")

    export_data = []
    for project in projects:
        project_data = {
            "id": project.id,
            "name": sanitize_csv_field(project.name),
            "description": sanitize_csv_field(project.description or ""),
            "status": project.status.value if hasattr(project.status, 'value') else str(project.status),
            "owner_id": project.owner_id,
            "created_at": project.created_at.isoformat() if project.created_at else None,
            "updated_at": project.updated_at.isoformat() if project.updated_at else None,
        }

        # Apply field filtering if specified
        if field_list:
            filtered_data = {}
            for field in field_list:
                if field in project_data:
                    filtered_data[field] = project_data[field]
            project_data = filtered_data

        # Include related data if requested
        if include_data:
            # Get test suites with full data
            test_suites = crud.get_test_suites(db, project_id=project.id)
            project_data["test_suites"] = []
            for ts in test_suites:
                suite_data = {
                    "id": ts.id,
                    "name": ts.name,
                    "description": ts.description or "",
                    "created_at": ts.created_at.isoformat() if ts.created_at else None,
                }

                # Get test cases for this suite
                from ..models import TestCase
                test_cases = db.query(TestCase).filter(TestCase.test_suite_id == ts.id).all()
                suite_data["test_cases"] = []

                for tc in test_cases:
                    case_data = {
                        "id": tc.id,
                        "title": tc.title,
                        "description": tc.description or "",
                        "preconditions": tc.preconditions or "",
                        "steps": tc.steps or "",
                        "expected_result": tc.expected_result or "",
                        "priority": tc.priority.value if hasattr(tc.priority, 'value') else (tc.priority or "medium"),
                        "status": tc.status.value if hasattr(tc.status, 'value') else (tc.status or "active"),
                        "tags": tc.tags or "",
                        "test_type": tc.test_type.value if hasattr(tc.test_type, 'value') else (tc.test_type or "manual"),
                        "section_id": tc.section_id,
                        "order_index": tc.order_index or 0,
                        "is_multistep": getattr(tc, 'is_multistep', False),
                        "created_at": tc.created_at.isoformat() if tc.created_at else None,
                        "updated_at": tc.updated_at.isoformat() if tc.updated_at else None,
                    }

                    # Get test case steps if multistep
                    if case_data["is_multistep"]:
                        steps = crud.get_test_case_steps(db, tc.id)
                        case_data["test_case_steps"] = [
                            {
                                "id": step.id,
                                "step_number": step.step_number,
                                "action": step.action or "",
                                "expected_result": step.expected_result or "",
                                "step_type": step.step_type.value if step.step_type else "manual",
                            }
                            for step in steps
                        ]

                    # Get custom field values
                    from ..models import CustomFieldValue
                    custom_field_values = db.query(CustomFieldValue).filter(
                        CustomFieldValue.test_case_id == tc.id
                    ).all()
                    case_data["custom_field_values"] = [
                        {
                            "field_definition_id": cfv.field_definition_id,
                            "value": cfv.value,
                        }
                        for cfv in custom_field_values
                    ]

                    suite_data["test_cases"].append(case_data)

                project_data["test_suites"].append(suite_data)

            # Get test runs with test results
            from ..models import TestRun, TestResult
            test_runs = db.query(TestRun).filter(TestRun.project_id == project.id).all()
            project_data["test_runs"] = []

            for tr in test_runs:
                run_data = {
                    "id": tr.id,
                    "name": tr.name,
                    "description": tr.description or "",
                    "status": tr.status.value if hasattr(tr.status, 'value') else str(tr.status) if tr.status else "active",
                    "created_at": tr.created_at.isoformat() if tr.created_at else None,
                    "updated_at": tr.updated_at.isoformat() if tr.updated_at else None,
                }

                # Get test results for this run
                test_results = db.query(TestResult).filter(TestResult.test_run_id == tr.id).all()
                run_data["test_results"] = [
                    {
                        "id": result.id,
                        "test_case_id": result.test_case_id,
                        "status": result.status.value if hasattr(result.status, 'value') else str(result.status) if result.status else "pending",
                        "actual_result": result.actual_result or "",
                        "comments": result.comments or "",
                        "execution_time": result.execution_time or 0,
                        "executed_by": result.executed_by,
                        "executed_at": result.executed_at.isoformat() if result.executed_at else None,
                    }
                    for result in test_results
                ]

                project_data["test_runs"].append(run_data)

            # Get test plans (handle missing columns gracefully)
            try:
                from ..models import TestPlan
                test_plans = crud.get_test_plans(db, project_id=project.id)
                project_data["test_plans"] = [
                    {
                        "id": tp.id,
                        "title": tp.title,
                        "description": tp.description or "",
                        "status": tp.status.value if hasattr(tp.status, 'value') else str(tp.status) if tp.status else "active",
                        "target_start_date": tp.target_start_date.isoformat() if tp.target_start_date else None,
                        "target_end_date": tp.target_end_date.isoformat() if tp.target_end_date else None,
                        "created_at": tp.created_at.isoformat() if tp.created_at else None,
                    }
                    for tp in test_plans
                ]
            except Exception as e:
                # Handle missing columns gracefully
                print(f"Warning: Could not export test plans due to: {str(e)}")
                project_data["test_plans"] = []

            # Get milestones (handle missing columns gracefully)
            try:
                from ..models import Milestone
                milestones = crud.get_milestones(db, project_id=project.id)
                project_data["milestones"] = [
                    {
                        "id": ms.id,
                        "title": ms.title,
                        "description": ms.description or "",
                        "status": ms.status.value if hasattr(ms.status, 'value') else str(ms.status) if ms.status else "planned",
                        "target_date": ms.target_date.isoformat() if ms.target_date else None,
                        "actual_date": ms.actual_date.isoformat() if ms.actual_date else None,
                        "progress_percentage": ms.progress_percentage or 0,
                        "created_at": ms.created_at.isoformat() if ms.created_at else None,
                    }
                    for ms in milestones
                ]
            except Exception as e:
                print(f"Warning: Could not export milestones due to: {str(e)}")
                project_data["milestones"] = []

            # Get requirements (handle missing columns gracefully)
            try:
                from ..models import Requirement
                requirements = crud.get_requirements(db, project_id=project.id)
                project_data["requirements"] = [
                    {
                        "id": req.id,
                        "title": req.title,
                        "description": req.description or "",
                        "priority": req.priority.value if hasattr(req.priority, 'value') else str(req.priority) if req.priority else "medium",
                        "status": req.status.value if hasattr(req.status, 'value') else str(req.status) if req.status else "draft",
                        "created_at": req.created_at.isoformat() if req.created_at else None,
                    }
                    for req in requirements
                ]
            except Exception as e:
                print(f"Warning: Could not export requirements due to: {str(e)}")
                project_data["requirements"] = []

            # Get defects (handle missing columns gracefully)
            try:
                from ..models import Defect
                defects = crud.get_defects(db, project_id=project.id)
                project_data["defects"] = [
                    {
                        "id": defect.id,
                        "title": defect.title,
                        "description": defect.description or "",
                        "severity": defect.severity.value if hasattr(defect.severity, 'value') else str(defect.severity) if defect.severity else "medium",
                        "priority": defect.priority.value if hasattr(defect.priority, 'value') else str(defect.priority) if defect.priority else "medium",
                        "status": defect.status.value if hasattr(defect.status, 'value') else str(defect.status) if defect.status else "open",
                        "reported_by": defect.reported_by,
                        "created_at": defect.created_at.isoformat() if defect.created_at else None,
                    }
                    for defect in defects
                ]
            except Exception as e:
                print(f"Warning: Could not export defects due to: {str(e)}")
                project_data["defects"] = []

            # Get custom field definitions (handle missing columns gracefully)
            try:
                from ..models import CustomFieldDefinition
                custom_fields = db.query(CustomFieldDefinition).filter(
                    CustomFieldDefinition.project_id == project.id
                ).all()
                project_data["custom_field_definitions"] = [
                    {
                        "id": cf.id,
                        "name": cf.name,
                        "field_type": cf.field_type.value if hasattr(cf.field_type, 'value') else str(cf.field_type) if cf.field_type else "text",
                        "is_required": cf.is_required,
                        "options": cf.options or [],
                        "validation_rules": cf.validation_rules or {},
                    }
                    for cf in custom_fields
                ]
            except Exception as e:
                print(f"Warning: Could not export custom field definitions due to: {str(e)}")
                project_data["custom_field_definitions"] = []

        export_data.append(project_data)

    if format.lower() == "json":
        json_content = json.dumps(export_data, indent=2, default=str)

        # Check export file size
        if len(json_content.encode('utf-8')) > MAX_EXPORT_SIZE_BYTES:
            raise HTTPException(
                status_code=400,
                detail=f"Export would exceed maximum size of {MAX_EXPORT_SIZE_BYTES / 1024 / 1024:.0f}MB. Please use field filtering, status filter, or disable include_data to reduce export size."
            )

        return {
            "filename": f"projects_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json",
            "content": json_content,
            "media_type": "application/json"
        }
    else:  # CSV - limited to basic info only (CSV cannot handle nested structures)
        if include_data:
            # For CSV with data, export counts only
            fieldnames = [
                'id', 'name', 'description', 'status', 'owner_id',
                'test_suites_count', 'test_cases_count', 'test_runs_count',
                'test_plans_count', 'milestones_count', 'requirements_count', 'defects_count',
                'created_at', 'updated_at'
            ]

            output = io.StringIO()
            writer = csv.DictWriter(output, fieldnames=fieldnames)
            writer.writeheader()

            for project_data in export_data:
                writer.writerow({
                    'id': project_data['id'],
                    'name': project_data['name'],
                    'description': project_data['description'],
                    'status': project_data['status'],
                    'owner_id': project_data['owner_id'],
                    'test_suites_count': len(project_data.get('test_suites', [])),
                    'test_cases_count': sum(len(ts.get('test_cases', [])) for ts in project_data.get('test_suites', [])),
                    'test_runs_count': len(project_data.get('test_runs', [])),
                    'test_plans_count': len(project_data.get('test_plans', [])),
                    'milestones_count': len(project_data.get('milestones', [])),
                    'requirements_count': len(project_data.get('requirements', [])),
                    'defects_count': len(project_data.get('defects', [])),
                    'created_at': project_data['created_at'],
                    'updated_at': project_data['updated_at']
                })

            return {
                "filename": f"projects_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv",
                "content": output.getvalue(),
                "media_type": "text/csv"
            }
        else:
            # Basic CSV export without data
            fieldnames = [
                'id', 'name', 'description', 'status', 'owner_id',
                'created_at', 'updated_at'
            ]

            output = io.StringIO()
            writer = csv.DictWriter(output, fieldnames=fieldnames)
            writer.writeheader()

            for project_data in export_data:
                writer.writerow({
                    'id': project_data.get('id', ''),
                    'name': project_data.get('name', ''),
                    'description': project_data.get('description', ''),
                    'status': project_data.get('status', ''),
                    'owner_id': project_data.get('owner_id', ''),
                    'created_at': project_data.get('created_at', ''),
                    'updated_at': project_data.get('updated_at', '')
                })

            csv_content = output.getvalue()

            # Check export file size
            if len(csv_content.encode('utf-8')) > MAX_EXPORT_SIZE_BYTES:
                raise HTTPException(
                    status_code=400,
                    detail=f"Export would exceed maximum size of {MAX_EXPORT_SIZE_BYTES / 1024 / 1024:.0f}MB. Please use field filtering or status filter to reduce export size."
                )

            return {
                "filename": f"projects_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv",
                "content": csv_content,
                "media_type": "text/csv"
            }
