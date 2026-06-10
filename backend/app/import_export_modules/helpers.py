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

def get_custom_field_options(field_def: CustomFieldDefinition) -> List[str]:
    if not field_def.options:
        return []
    if isinstance(field_def.options, list):
        return [str(option) for option in field_def.options]
    if isinstance(field_def.options, dict):
        options = field_def.options.get('options')
        if isinstance(options, list):
            return [str(option) for option in options]
        return [str(option) for option in field_def.options.values()]
    return []


def detect_duplicates(db: Session, rows: List[Dict[str, Any]], test_suite_id: int) -> DuplicateDetectionResult:
    """Detect duplicate test cases by title and ID"""
    result = DuplicateDetectionResult()

    # Get existing test cases in the test suite
    existing_cases = db.query(TestCase).filter(TestCase.test_suite_id == test_suite_id).all()
    existing_titles = {case.title.lower(): case for case in existing_cases}
    existing_ids = {case.id: case for case in existing_cases}

    # Track titles and IDs from current import
    import_titles = {}
    import_ids = {}

    for index, row in enumerate(rows):
        title = normalize_text(row.get('title', ''))
        case_id = str(row.get('id', '')).strip()

        if title:
            if title.lower() in existing_titles:
                result.duplicates_by_title.append({
                    'row': index + 2,  # +2 for header and 0-based index
                    'title': title,
                    'existing_id': existing_titles[title.lower()].id,
                    'action': 'skip_or_update'
                })

            if title.lower() in import_titles:
                result.duplicates_by_title.append({
                    'row': index + 2,
                    'title': title,
                    'duplicate_row': import_titles[title.lower()],
                    'action': 'duplicate_in_import'
                })
            else:
                import_titles[title.lower()] = index + 2

        if case_id and case_id.isdigit():
            case_id_int = int(case_id)
            if case_id_int in existing_ids:
                result.duplicates_by_id.append({
                    'row': index + 2,
                    'id': case_id_int,
                    'existing_title': existing_ids[case_id_int].title,
                    'action': 'skip_or_update'
                })

            if case_id_int in import_ids:
                result.duplicates_by_id.append({
                    'row': index + 2,
                    'id': case_id_int,
                    'duplicate_row': import_ids[case_id_int],
                    'action': 'duplicate_in_import'
                })
            else:
                import_ids[case_id_int] = index + 2

    return result


def clean_data(row: Dict[str, Any]) -> DataCleaningResult:
    """Clean and standardize data in a row"""
    result = DataCleaningResult()
    cleaned = {}

    # Clean text fields
    text_fields = ['title', 'description', 'reference', 'external_key', 'tags', 'multistep_data']
    multiline_fields = ['preconditions', 'steps', 'expected_result']
    for field in text_fields:
        original_value = row.get(field, '')
        cleaned_value = normalize_text(original_value)

        if original_value != cleaned_value:
            result.corrections_made.append(f"Row: {field} normalized from '{original_value}' to '{cleaned_value}'")

        cleaned[field] = cleaned_value if cleaned_value else None

    for field in multiline_fields:
        original_value = row.get(field, '')
        cleaned_value = normalize_multiline_text(original_value)

        if original_value != cleaned_value:
            result.corrections_made.append(f"Row: {field} normalized")

        cleaned[field] = cleaned_value if cleaned_value else None

    # Clean priority
    original_priority = row.get('priority', '')
    cleaned_priority = normalize_priority(original_priority)
    if original_priority != cleaned_priority:
        result.corrections_made.append(f"Row: priority normalized from '{original_priority}' to '{cleaned_priority}'")
    cleaned['priority'] = cleaned_priority

    # Clean test type
    original_test_type = row.get('test_type', '')
    cleaned_test_type = normalize_test_type(original_test_type)
    if original_test_type != cleaned_test_type:
        result.corrections_made.append(f"Row: test_type normalized from '{original_test_type}' to '{cleaned_test_type}'")
    cleaned['test_type'] = cleaned_test_type

    original_status = row.get('status', '')
    cleaned_status = normalize_status(original_status)
    if original_status and str(original_status).strip().lower() != cleaned_status:
        result.corrections_made.append(f"Row: status normalized from '{original_status}' to '{cleaned_status}'")
    cleaned['status'] = cleaned_status

    cleaned['is_multistep'] = parse_bool(row.get('is_multistep'), False)

    # Clean numeric fields
    numeric_fields = ['section_id', 'order_index']
    for field in numeric_fields:
        value = row.get(field, '')
        if value and str(value).strip():
            try:
                cleaned_value = int(str(value).strip())
                if str(value) != str(cleaned_value):
                    result.corrections_made.append(f"Row: {field} converted from '{value}' to '{cleaned_value}'")
                cleaned[field] = cleaned_value
            except ValueError:
                result.unfixable_issues.append(f"Row: {field} has invalid numeric value '{value}'")
                cleaned[field] = None
        else:
            cleaned[field] = None

    # Preserve custom/unknown CSV columns so project custom fields can be imported by name or slug.
    known_fields = set(text_fields + multiline_fields + ['priority', 'test_type', 'status', 'is_multistep'] + numeric_fields)
    for field, value in row.items():
        if field in known_fields or field is None:
            continue
        cleaned[field] = normalize_text(value)

    result.cleaned_fields = cleaned
    return result


def validate_required_fields(row: Dict[str, Any], custom_fields: List[CustomFieldDefinition] = None) -> ValidationResult:
    """Validate required fields including custom fields"""
    result = ValidationResult()

    # Standard required fields
    required_fields = ['title']
    for field in required_fields:
        if not str(row.get(field, '') or '').strip():
            result.missing_fields.append(f"Missing required field: {field}")
    title = str(row.get('title', '') or '').strip()
    if len(title) > 255:
        result.invalid_fields.append("Title must be 255 characters or less")
    if len(str(row.get('reference', '') or '').strip()) > 255:
        result.invalid_fields.append("Reference must be 255 characters or less")
    if len(str(row.get('tags', '') or '').strip()) > 500:
        result.invalid_fields.append("Tags must be 500 characters or less")
    order_index = row.get('order_index')
    if order_index is not None and int(order_index) < 0:
        result.invalid_fields.append("Order index must be 0 or greater")
    for date_field in ['created_at', 'updated_at']:
        if row.get(date_field):
            try:
                parse_import_datetime(row.get(date_field))
            except DataValidationError as exc:
                result.invalid_fields.append(f"{date_field}: {str(exc)}")

    # Validate custom fields if provided
    if custom_fields:
        for custom_field in custom_fields:
            field_name = custom_field.name
            field_value = row.get(field_name, '') or row.get(custom_field.slug or '', '')

            if custom_field.is_required and not str(field_value).strip():
                result.missing_fields.append(f"Missing required custom field: {field_name}")

            # Validate field type
            if field_value:
                validation_error = validate_custom_field_type(field_value, custom_field)
                if validation_error:
                    result.invalid_fields.append(validation_error)

    return result


def validate_custom_field_type(value: str, field_def: CustomFieldDefinition) -> Optional[str]:
    """Validate custom field value against its type and rules"""
    value_str = str(value).strip()

    if field_def.field_type == CustomFieldType.NUMBER:
        try:
            float(value_str)
        except ValueError:
            return f"Invalid number for field '{field_def.name}': {value_str}"

    elif field_def.field_type == CustomFieldType.DATE:
        if not clean_date_string(value_str):
            return f"Invalid date format for field '{field_def.name}': {value_str}"

    elif field_def.field_type == CustomFieldType.BOOLEAN:
        boolean_values = ['true', 'false', 'yes', 'no', '1', '0', 'on', 'off']
        if value_str.lower() not in boolean_values:
            return f"Invalid boolean value for field '{field_def.name}': {value_str}"

    elif field_def.field_type == CustomFieldType.SELECT:
        options = get_custom_field_options(field_def)
        if options and value_str not in options:
            return f"Invalid option for field '{field_def.name}': {value_str}. Valid options: {options}"

    elif field_def.field_type == CustomFieldType.MULTISELECT:
        options = get_custom_field_options(field_def)
        if options:
            selected_values = [v.strip() for v in value_str.split(',') if v.strip()]
            invalid_values = [v for v in selected_values if v not in options]
            if invalid_values:
                return f"Invalid options for field '{field_def.name}': {invalid_values}. Valid options: {options}"

    # Apply validation rules
    if field_def.validation_rules:
        rules = field_def.validation_rules

        if field_def.field_type in [CustomFieldType.TEXT, CustomFieldType.SELECT, CustomFieldType.MULTISELECT]:
            min_length = rules.get('min_length')
            max_length = rules.get('max_length')
            regex_pattern = rules.get('regex_pattern')

            if min_length and len(value_str) < min_length:
                return f"Field '{field_def.name}' too short. Minimum length: {min_length}"

            if max_length and len(value_str) > max_length:
                return f"Field '{field_def.name}' too long. Maximum length: {max_length}"

            if regex_pattern and field_def.field_type == CustomFieldType.TEXT:
                try:
                    if not re.match(regex_pattern, value_str):
                        return f"Field '{field_def.name}' does not match required pattern"
                except re.error:
                    pass  # Pattern validation already done at definition level

        elif field_def.field_type == CustomFieldType.NUMBER:
            try:
                num_value = float(value_str)
                min_value = rules.get('min_value')
                max_value = rules.get('max_value')
                integer_only = rules.get('integer_only', False)

                if integer_only and not value_str.isdigit() and not (value_str.startswith('-') and value_str[1:].isdigit()):
                    return f"Field '{field_def.name}' must be an integer"

                if min_value is not None and num_value < min_value:
                    return f"Field '{field_def.name}' too small. Minimum value: {min_value}"

                if max_value is not None and num_value > max_value:
                    return f"Field '{field_def.name}' too large. Maximum value: {max_value}"
            except ValueError:
                pass  # Already caught above

        elif field_def.field_type == CustomFieldType.DATE:
            try:
                from datetime import datetime
                date_value = datetime.fromisoformat(value_str)
                min_date = rules.get('min_date')
                max_date = rules.get('max_date')
                future_only = rules.get('future_only', False)
                past_only = rules.get('past_only', False)

                if min_date:
                    min_dt = datetime.fromisoformat(min_date)
                    if date_value < min_dt:
                        return f"Field '{field_def.name}' must be after {min_date}"

                if max_date:
                    max_dt = datetime.fromisoformat(max_date)
                    if date_value > max_dt:
                        return f"Field '{field_def.name}' must be before {max_date}"

                if future_only and date_value <= datetime.now():
                    return f"Field '{field_def.name}' must be a future date"

                if past_only and date_value >= datetime.now():
                    return f"Field '{field_def.name}' must be a past date"
            except ValueError:
                pass  # Already caught above

    return None


def get_custom_fields_for_project(db: Session, project_id: int) -> List[CustomFieldDefinition]:
    """Get custom field definitions for a project"""
    return db.query(CustomFieldDefinition).filter(
        CustomFieldDefinition.project_id == project_id
    ).all()


def get_test_suite_or_404(db: Session, test_suite_id: int) -> TestSuite:
    test_suite = db.query(TestSuite).filter(TestSuite.id == test_suite_id).first()
    if not test_suite:
        raise HTTPException(status_code=404, detail="Test suite not found")
    return test_suite


def ensure_import_permission(current_user: User, project_id: int, db: Session) -> None:
    if not rbac.has_permission(current_user, "write", project_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to import test cases for this project",
        )


def validate_section_for_suite(db: Session, section_id: Optional[int], test_suite_id: int) -> Optional[int]:
    if section_id is None:
        return None

    section = db.query(TestCaseSection).filter(TestCaseSection.id == section_id).first()
    if not section or section.test_suite_id != test_suite_id:
        raise HTTPException(status_code=400, detail="Selected section does not belong to the target test suite")
    return section_id


def normalize_custom_field_lookup(custom_fields: List[CustomFieldDefinition]) -> Dict[int, CustomFieldDefinition]:
    return {field.id: field for field in custom_fields}


def create_custom_field_values(
    db: Session,
    test_case_id: int,
    custom_field_values: List[ImportCustomFieldValuePayload],
    custom_fields_by_id: Dict[int, CustomFieldDefinition],
) -> List[str]:
    errors: List[str] = []
    seen_field_ids: Set[int] = set()

    for custom_value in custom_field_values:
        if custom_value.field_definition_id in seen_field_ids:
            errors.append(f"Duplicate custom field value for field {custom_value.field_definition_id}")
            continue
        seen_field_ids.add(custom_value.field_definition_id)

        field_def = custom_fields_by_id.get(custom_value.field_definition_id)
        if not field_def:
            errors.append(f"Custom field {custom_value.field_definition_id} is not available for this project")
            continue

        value = str(custom_value.value or '').strip()
        if not value:
            if field_def.is_required:
                errors.append(f"Missing required custom field: {field_def.name}")
            continue

        validation_error = validate_custom_field_type(value, field_def)
        if validation_error:
            errors.append(validation_error)
            continue

        db.add(CustomFieldValue(
            field_definition_id=field_def.id,
            test_case_id=test_case_id,
            value=transform_custom_field_value(value, field_def),
        ))

    return errors


def apply_imported_timestamps(test_case: TestCase, created_at: Any = None, updated_at: Any = None) -> bool:
    has_changes = False
    parsed_created_at = parse_import_datetime(created_at)
    parsed_updated_at = parse_import_datetime(updated_at)

    if parsed_created_at:
        test_case.created_at = parsed_created_at
        has_changes = True
    if parsed_updated_at:
        test_case.updated_at = parsed_updated_at
        has_changes = True

    return has_changes


def normalize_import_action(action: Optional[str], skip_duplicates: bool = True) -> str:
    if action == 'create_only':
        return 'create_only'
    if action in {'skip', 'skip_duplicates'}:
        return 'skip'
    if action in {'update', 'update_existing'}:
        return 'update'
    if action in {'copy', 'rename', 'create_copy'}:
        return 'rename'
    return 'skip' if skip_duplicates else 'rename'


def get_default_duplicate_action(skip_duplicates: bool, duplicate_mode: Optional[str], import_mode: Optional[str] = None) -> str:
    return normalize_import_action(import_mode or duplicate_mode, skip_duplicates)


def get_idempotency_key(request: Request, user_id: int, operation: str) -> Optional[str]:
    raw_key = request.headers.get('Idempotency-Key') or request.headers.get('idempotency-key')
    if not raw_key:
        return None
    key = str(raw_key).strip()
    if not key:
        return None
    if len(key) > 255:
        raise HTTPException(status_code=400, detail="Idempotency-Key must be 255 characters or fewer")
    return f"{operation}:{user_id}:{key}"


def get_import_operation(db: Session, record_key: str) -> Optional[ImportOperation]:
    return db.query(ImportOperation).filter(ImportOperation.idempotency_key == record_key).first()


def begin_idempotent_request(
    db: Session,
    record_key: Optional[str],
    user_id: int,
    operation: str,
) -> Optional[Dict[str, Any]]:
    if not record_key:
        return None

    record = get_import_operation(db, record_key)
    if not record:
        db.add(ImportOperation(
            idempotency_key=record_key,
            operation=operation,
            status="processing",
            user_id=user_id,
        ))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            record = get_import_operation(db, record_key)
        else:
            return None

    if not record:
        return None

    if record.status == "completed":
        return record.response_data or {}
    if record.status == "failed":
        record.status = "processing"
        record.response_data = None
        record.error_message = None
        record.completed_at = None
        db.commit()
        return None
    raise HTTPException(status_code=409, detail="An import with this Idempotency-Key is already in progress")


def complete_idempotent_request(db: Session, record_key: Optional[str], response: Dict[str, Any]) -> None:
    if record_key:
        record = get_import_operation(db, record_key)
        if record:
            record.status = "completed"
            record.response_data = response
            record.error_message = None
            record.completed_at = datetime.now()
            db.commit()


def fail_idempotent_request(db: Session, record_key: Optional[str], error_message: Optional[str] = None) -> None:
    if not record_key:
        return
    record = get_import_operation(db, record_key)
    if record and record.status == "processing":
        record.status = "failed"
        record.error_message = error_message
        record.completed_at = datetime.now()
        db.commit()


def acquire_import_lock(
    db: Session,
    lock_key: str,
    owner: str,
    user_id: int,
    operation: str,
    project_id: Optional[int] = None,
    test_suite_id: Optional[int] = None,
    filename: Optional[str] = None,
) -> None:
    existing = db.query(ImportOperation).filter(
        ImportOperation.lock_key == lock_key,
        ImportOperation.status == "processing",
        ImportOperation.idempotency_key != owner,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Another import is already running for this test suite. Wait for it to finish or retry with the same Idempotency-Key.")

    record = get_import_operation(db, owner)
    if not record:
        record = ImportOperation(
            idempotency_key=owner,
            operation=operation,
            status="processing",
            user_id=user_id,
        )
        db.add(record)
    record.lock_key = lock_key
    record.project_id = project_id
    record.test_suite_id = test_suite_id
    record.filename = filename
    db.commit()


def release_import_lock(db: Session, lock_key: Optional[str], owner: Optional[str]) -> None:
    if not lock_key or not owner:
        return
    record = get_import_operation(db, owner)
    if record and record.lock_key == lock_key and record.status == "processing":
        record.status = "released"
        record.completed_at = datetime.now()
        db.commit()


def transform_custom_field_value(value: str, field_def: CustomFieldDefinition) -> str:
    value_str = str(value).strip()
    if field_def.field_type == CustomFieldType.NUMBER:
        try:
            return str(float(value_str))
        except ValueError:
            return value_str
    elif field_def.field_type == CustomFieldType.DATE:
        cleaned_date = clean_date_string(value_str)
        return cleaned_date if cleaned_date else value_str
    elif field_def.field_type == CustomFieldType.BOOLEAN:
        boolean_map = {
            'true': 'true', 'yes': 'true', '1': 'true', 'on': 'true',
            'false': 'false', 'no': 'false', '0': 'false', 'off': 'false',
        }
        return boolean_map.get(value_str.lower(), value_str)
    elif field_def.field_type == CustomFieldType.MULTISELECT:
        values = [v.strip() for v in value_str.split(',') if v.strip()]
        return ', '.join(values)
    return value_str


def normalize_match_value(value: Any) -> str:
    return str(value or '').strip().lower()


def get_external_key_field_ids(custom_fields: List[CustomFieldDefinition]) -> Set[int]:
    return {
        field.id for field in custom_fields
        if normalize_match_value(field.slug) == 'external_key' or normalize_match_value(field.name).replace(' ', '_') == 'external_key'
    }


def build_duplicate_indexes(db: Session, test_suite_id: int, custom_fields: List[CustomFieldDefinition]) -> Dict[str, Dict[Any, TestCase]]:
    existing_cases = db.query(TestCase).filter(TestCase.test_suite_id == test_suite_id).all()
    by_id = {case.id: case for case in existing_cases}
    by_reference = {normalize_match_value(case.reference): case for case in existing_cases if normalize_match_value(case.reference)}
    by_title_suite = {normalize_match_value(case.title): case for case in existing_cases if normalize_match_value(case.title)}
    by_title_section = {
        (normalize_match_value(case.title), case.section_id): case
        for case in existing_cases
        if normalize_match_value(case.title) and case.section_id is not None
    }
    by_external_key: Dict[str, TestCase] = {}
    external_key_field_ids = get_external_key_field_ids(custom_fields)
    if external_key_field_ids:
        values = db.query(CustomFieldValue).filter(
            CustomFieldValue.field_definition_id.in_(external_key_field_ids),
            CustomFieldValue.test_case_id.in_(by_id.keys()),
        ).all()
        for value in values:
            normalized_value = normalize_match_value(value.value)
            if normalized_value and value.test_case_id in by_id:
                by_external_key[normalized_value] = by_id[value.test_case_id]

    return {
        'id': by_id,
        'reference': by_reference,
        'external_key': by_external_key,
        'title_section': by_title_section,
        'title_suite': by_title_suite,
    }


def find_duplicate_case(row: PreviewedTestCaseImportRow, indexes: Dict[str, Dict[Any, TestCase]], fallback_section_id: Optional[int]) -> tuple[Optional[TestCase], Optional[str]]:
    if row.id and row.id in indexes['id']:
        return indexes['id'][row.id], 'id'
    normalized_reference = normalize_match_value(row.reference)
    if normalized_reference and normalized_reference in indexes['reference']:
        return indexes['reference'][normalized_reference], 'reference'
    normalized_external_key = normalize_match_value(row.external_key)
    if normalized_external_key and normalized_external_key in indexes['external_key']:
        return indexes['external_key'][normalized_external_key], 'external_key'
    normalized_title = normalize_match_value(row.title)
    section_id = row.section_id or fallback_section_id
    if normalized_title and section_id is not None and (normalized_title, section_id) in indexes['title_section']:
        return indexes['title_section'][(normalized_title, section_id)], 'title_section'
    if normalized_title and normalized_title in indexes['title_suite']:
        return indexes['title_suite'][normalized_title], 'title_suite'
    return None, None


def record_import_audit(
    db: Session,
    current_user: User,
    project_id: Optional[int],
    test_suite_id: int,
    response: Dict[str, Any],
    filename: Optional[str] = None,
    idempotency_key: Optional[str] = None,
) -> None:
    try:
        from ..models import AuditAction, EntityType
        from ..schemas_audit import AuditTrailCreate
        from ..services.audit_service import get_audit_service

        row_results = response.get('row_results') or []
        created_ids = response.get('created_ids') or []
        skipped_ids = [row.get('existing_id') for row in row_results if row.get('status') == 'skipped' and row.get('existing_id')]
        updated_ids = [row.get('updated_id') for row in row_results if row.get('updated_id')]
        audit_service = get_audit_service(db)
        audit_service.create_audit_trail(AuditTrailCreate(
            user_id=current_user.id,
            action=AuditAction.IMPORT,
            entity_type=EntityType.TEST_CASE,
            entity_id=test_suite_id,
            project_id=project_id,
            description=f"Imported test cases into suite {test_suite_id}",
            new_values={
                "filename": filename,
                "row_count": response.get('total_rows', 0),
                "imported_rows": response.get('imported_rows', 0),
                "skipped_rows": response.get('skipped_rows', 0),
                "error_rows": response.get('error_rows', 0),
                "created_ids": created_ids,
                "updated_ids": updated_ids,
                "skipped_ids": skipped_ids,
                "errors": response.get('errors', []),
                "dry_run": response.get('dry_run', False),
                "import_job_id": response.get('import_job_id'),
                "idempotency_key": idempotency_key,
            },
            additional_metadata={"source": "test_case_import"},
        ))
    except Exception:
        db.rollback()
        logger.exception("Failed to record test case import audit trail")


def make_imported_copy_title(base_title: str, used_titles: Set[str]) -> str:
    date_suffix = datetime.now().strftime('%Y-%m-%d')
    candidate = f"{base_title} (Imported {date_suffix})"
    counter = 2
    while candidate.lower().strip() in used_titles:
        candidate = f"{base_title} (Imported {date_suffix} {counter})"
        counter += 1
    return candidate


def update_import_job(job_id: Optional[str], **updates: Any) -> None:
    if not job_id or job_id not in IMPORT_JOBS:
        return
    IMPORT_JOBS[job_id].update(updates)
    IMPORT_JOBS[job_id]["updated_at"] = datetime.now().isoformat()


def increment_import_job(job_id: Optional[str], result: Dict[str, Any]) -> None:
    if not job_id or job_id not in IMPORT_JOBS:
        return
    job = IMPORT_JOBS[job_id]
    job["processed_rows"] = int(job.get("processed_rows", 0)) + int(result.get("total_rows", 0))
    job["imported_rows"] = int(job.get("imported_rows", 0)) + int(result.get("imported_rows", 0))
    job["skipped_rows"] = int(job.get("skipped_rows", 0)) + int(result.get("skipped_rows", 0))
    job["error_rows"] = int(job.get("error_rows", 0)) + int(result.get("error_rows", 0))
    job["status"] = "completed" if job["processed_rows"] >= int(job.get("total_rows", 0)) else "running"
    job["updated_at"] = datetime.now().isoformat()


def parse_multistep_data(multistep_data: Optional[str], row_label: str) -> List[schemas.TestCaseStepCreate]:
    if not multistep_data:
        return []

    try:
        steps_data = json.loads(multistep_data)
    except json.JSONDecodeError as exc:
        raise DataValidationError(f"{row_label}: invalid multistep data: {str(exc)}")

    if not isinstance(steps_data, list):
        raise DataValidationError(f"{row_label}: invalid multistep data: value must be a JSON array")
    if len(steps_data) > MAX_STEPS_PER_TEST_CASE:
        raise DataValidationError(f"{row_label}: multistep data is limited to {MAX_STEPS_PER_TEST_CASE} steps")

    steps: List[schemas.TestCaseStepCreate] = []
    for step_index, step_data in enumerate(steps_data, start=1):
        if not isinstance(step_data, dict):
            raise DataValidationError(f"{row_label}: step {step_index} must be an object")

        action = str(step_data.get('action', '')).strip()
        expected_result = str(step_data.get('expected_result', '')).strip()
        if not action:
            raise DataValidationError(f"{row_label}: step {step_index} action is required")
        if not expected_result:
            raise DataValidationError(f"{row_label}: step {step_index} expected_result is required")

        try:
            step_number = int(step_data.get('step_number') or step_index)
        except (TypeError, ValueError):
            raise DataValidationError(f"{row_label}: step {step_index} step_number must be a positive integer")
        if step_number <= 0:
            raise DataValidationError(f"{row_label}: step {step_index} step_number must be a positive integer")

        try:
            order_index = int(step_data.get('order_index') or step_index - 1)
        except (TypeError, ValueError):
            raise DataValidationError(f"{row_label}: step {step_index} order_index must be a whole number")
        if order_index < 0:
            raise DataValidationError(f"{row_label}: step {step_index} order_index must be a whole number")

        data = step_data.get('data')
        if data is not None and not isinstance(data, dict):
            raise DataValidationError(f"{row_label}: step {step_index} data must be an object")

        steps.append(schemas.TestCaseStepCreate(
            step_number=step_number,
            action=action,
            expected_result=expected_result,
            step_type=str(step_data.get('step_type') or 'manual').strip() or 'manual',
            data=data,
            order_index=order_index,
        ))

    return steps


def create_import_test_case_without_commit(
    db: Session,
    test_case_data: Dict[str, Any],
    created_by: int,
) -> TestCase:
    test_steps_data = test_case_data.pop('test_steps', None) or []
    db_test_case = TestCase(**test_case_data)
    db_test_case.created_by = created_by
    if test_steps_data:
        db_test_case.is_multistep = True

    db.add(db_test_case)
    db.flush()

    for step_data in test_steps_data:
        step_dict = step_data.model_dump(exclude={'test_case_id'})
        db.add(TestCaseStep(**step_dict, test_case_id=db_test_case.id))

    db.flush()
    return db_test_case


def update_import_test_case_without_commit(
    db: Session,
    test_case: TestCase,
    test_case_data: Dict[str, Any],
) -> TestCase:
    test_steps_data = test_case_data.pop('test_steps', None)

    for key, value in test_case_data.items():
        if key != 'test_suite_id':
            setattr(test_case, key, value)

    if test_steps_data is not None or not test_case_data.get('is_multistep'):
        db.query(TestCaseStep).filter(TestCaseStep.test_case_id == test_case.id).delete(synchronize_session=False)

    if test_steps_data:
        for step_data in test_steps_data:
            step_dict = step_data.model_dump(exclude={'test_case_id'})
            db.add(TestCaseStep(**step_dict, test_case_id=test_case.id))

    db.flush()
    return test_case


def add_case_to_duplicate_indexes(
    indexes: Dict[str, Dict[Any, TestCase]],
    test_case: TestCase,
    external_key: Optional[str] = None,
) -> None:
    indexes['id'][test_case.id] = test_case
    normalized_reference = normalize_match_value(test_case.reference)
    normalized_title = normalize_match_value(test_case.title)
    normalized_external_key = normalize_match_value(external_key)
    if normalized_reference:
        indexes['reference'][normalized_reference] = test_case
    if normalized_external_key:
        indexes['external_key'][normalized_external_key] = test_case
    if normalized_title:
        indexes['title_suite'][normalized_title] = test_case
        if test_case.section_id is not None:
            indexes['title_section'][(normalized_title, test_case.section_id)] = test_case


def merge_external_key_custom_value(
    row: PreviewedTestCaseImportRow,
    custom_fields: List[CustomFieldDefinition],
) -> List[ImportCustomFieldValuePayload]:
    values = list(row.custom_field_values)
    external_key = normalize_text(row.external_key or '')
    if not external_key:
        return values

    provided_field_ids = {value.field_definition_id for value in values}
    external_key_field_ids = get_external_key_field_ids(custom_fields)
    missing_field_ids = external_key_field_ids - provided_field_ids
    for field_id in missing_field_ids:
        values.append(ImportCustomFieldValuePayload(field_definition_id=field_id, value=external_key))
    return values


def build_import_response(
    imported_count: int,
    total_rows: int,
    skipped_count: int,
    errors: List[str],
    warnings: List[str],
    created_ids: Optional[List[int]] = None,
    corrections: Optional[List[str]] = None,
    duplicate_detection: Optional[DuplicateDetectionResult] = None,
    row_results: Optional[List[Dict[str, Any]]] = None,
    import_job_id: Optional[str] = None,
    dry_run: bool = False,
) -> Dict[str, Any]:
    action_label = "validated" if dry_run else "imported"
    message_parts = [f"Successfully {action_label} {imported_count} test cases"]
    if skipped_count > 0:
        message_parts.append(f"{skipped_count} rows skipped")
    if errors:
        message_parts.append(f"{len(errors)} errors")
    if corrections:
        message_parts.append(f"{len(corrections)} automatic corrections applied")

    return {
        "message": ", ".join(message_parts),
        "errors": errors,
        "warnings": warnings,
        "corrections": corrections or [],
        "total_rows": total_rows,
        "imported_rows": imported_count,
        "skipped_rows": skipped_count,
        "error_rows": len(errors),
        "correction_rows": len(corrections or []),
        "created_ids": created_ids or [],
        "row_results": row_results or [],
        "import_job_id": import_job_id,
        "dry_run": dry_run,
        "duplicate_detection": {
            "duplicates_by_title": len(duplicate_detection.duplicates_by_title) if duplicate_detection else 0,
            "duplicates_by_id": len(duplicate_detection.duplicates_by_id) if duplicate_detection else 0,
            "potential_duplicates": len(duplicate_detection.potential_duplicates) if duplicate_detection else 0,
        },
    }


def apply_bulk_corrections(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Apply bulk corrections to common data issues"""
    corrected_rows = []

    for row in rows:
        corrected_row = row.copy()

        # Fix common title issues
        title = corrected_row.get('title', '')
        if title:
            # Remove leading/trailing special characters
            title = re.sub(r'^[\W_]+|[\W_]+$', '', str(title))
            # Capitalize first letter of each word (title case)
            title = ' '.join(word.capitalize() for word in title.split())
            corrected_row['title'] = title

        # Fix common tag issues
        tags = corrected_row.get('tags', '')
        if tags:
            # Split by common delimiters and clean
            tag_list = re.split(r'[,;|\s]+', str(tags))
            tag_list = [tag.strip().lower() for tag in tag_list if tag.strip()]
            corrected_row['tags'] = ', '.join(sorted(set(tag_list)))  # Remove duplicates and sort

        # Fix step numbering
        steps = corrected_row.get('steps', '')
        if steps:
            # Auto-number steps if not already numbered
            step_lines = str(steps).split('\n')
            numbered_steps = []
            step_num = 1

            for line in step_lines:
                line = line.strip()
                if line and not re.match(r'^\d+\.', line):
                    numbered_steps.append(f"{step_num}. {line}")
                    step_num += 1
                else:
                    numbered_steps.append(line)
                    # Extract step number if present
                    match = re.match(r'^(\d+)\.', line)
                    if match:
                        step_num = int(match.group(1)) + 1

            corrected_row['steps'] = '\n'.join(numbered_steps)

        corrected_rows.append(corrected_row)

    return corrected_rows
