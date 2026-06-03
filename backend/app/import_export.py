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
from .database import get_db
from . import crud, schemas, auth, rbac
from .models import Priority, Status, CustomFieldDefinition, CustomFieldValue, CustomFieldType, TestCase, TestCaseStep, TestSuite, TestCaseSection, Project, User, ImportOperation
from .security_utils import validate_file_size, validate_file_extension, MAX_CSV_IMPORT_SIZE
from .services.import_export_utils import (
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

router = APIRouter()
logger = logging.getLogger(__name__)

class ImportCustomFieldValuePayload(BaseModel):
    field_definition_id: int = Field(..., gt=0)
    value: str = Field(default='')


class PreviewedTestCaseImportRow(BaseModel):
    row_number: Optional[int] = Field(default=None, gt=0)
    id: Optional[int] = Field(default=None, gt=0)
    title: str = Field(..., min_length=1, max_length=255)
    test_suite_id: Optional[int] = Field(default=None, gt=0)
    section_id: Optional[int] = Field(default=None, gt=0)
    description: Optional[str] = None
    preconditions: Optional[str] = None
    steps: Optional[str] = None
    expected_result: Optional[str] = None
    priority: str = 'medium'
    test_type: str = 'manual'
    status: str = 'active'
    reference: Optional[str] = Field(default=None, max_length=255)
    external_key: Optional[str] = Field(default=None, max_length=255)
    tags: Optional[str] = Field(default=None, max_length=500)
    order_index: Optional[int] = Field(default=0, ge=0)
    is_multistep: Optional[bool] = False
    multistep_data: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    import_action: Optional[DuplicateAction] = None
    duplicate_hint: bool = False
    custom_field_values: List[ImportCustomFieldValuePayload] = Field(default_factory=list)

    @field_validator('priority')
    @classmethod
    def validate_priority(cls, value: str) -> str:
        raw_value = (value or '').lower().strip()
        priority_variants = {
            'low', 'lowest', 'l', 'minor', 'trivial',
            'medium', 'med', 'm', 'normal', 'regular',
            'high', 'h', 'major', 'important',
            'critical', 'crit', 'c', 'urgent', 'blocker',
        }
        if raw_value and raw_value not in priority_variants:
            raise ValueError('Invalid priority')
        return normalize_priority(value)

    @field_validator('test_type')
    @classmethod
    def validate_test_type(cls, value: str) -> str:
        raw_value = (value or '').lower().strip()
        test_type_variants = {
            'manual', 'm', 'automated', 'auto', 'a', 'smoke', 's',
            'regression', 'reg', 'r', 'integration', 'int', 'i',
            'performance', 'perf', 'p', 'security', 'sec', 'usability', 'ux',
            'compatibility', 'compat', 'exploratory', 'expl',
        }
        if raw_value and raw_value not in test_type_variants:
            raise ValueError('Invalid test type')
        return normalize_test_type(value)

    @field_validator('status')
    @classmethod
    def validate_status(cls, value: str) -> str:
        raw_value = (value or '').lower().strip()
        if raw_value and raw_value not in {'active', 'inactive', 'archived'}:
            raise ValueError('Invalid status')
        return normalize_status(value)


class PreviewedTestCaseImportRequest(BaseModel):
    test_suite_id: int = Field(..., gt=0)
    rows: List[PreviewedTestCaseImportRow] = Field(..., min_length=1, max_length=MAX_ROWS_PER_IMPORT)
    skip_duplicates: bool = True
    duplicate_mode: Optional[DuplicateAction] = None
    import_mode: Optional[ImportMode] = None
    filename: Optional[str] = Field(default=None, max_length=255)
    dry_run: bool = False
    import_job_id: Optional[str] = None
    chunk_index: Optional[int] = Field(default=None, ge=0)
    total_chunks: Optional[int] = Field(default=None, ge=1)


class DuplicateDetectionSummary(BaseModel):
    duplicates_by_title: int = 0
    duplicates_by_id: int = 0
    potential_duplicates: int = 0


class ImportTestCasesResponse(BaseModel):
    message: str
    errors: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    corrections: List[str] = Field(default_factory=list)
    total_rows: int
    imported_rows: int
    skipped_rows: int
    error_rows: int
    correction_rows: int
    created_ids: List[int] = Field(default_factory=list)
    duplicate_detection: DuplicateDetectionSummary
    row_results: List[Dict[str, Any]] = Field(default_factory=list)
    import_job_id: Optional[str] = None
    dry_run: bool = False


class ImportJobCreate(BaseModel):
    total_rows: int = Field(default=0, ge=0)
    total_chunks: int = Field(default=1, ge=1)
    filename: Optional[str] = None


class ExportTestCasesResponse(BaseModel):
    filename: str
    content: str
    media_type: str
    total_rows: int
    truncated: bool = False
    warnings: List[str] = Field(default_factory=list)


class DuplicateDetectionResult:
    """Result of duplicate detection"""
    def __init__(self):
        self.duplicates_by_title = []
        self.duplicates_by_id = []
        self.potential_duplicates = []


class DataCleaningResult:
    """Result of data cleaning operations"""
    def __init__(self):
        self.cleaned_fields = {}
        self.corrections_made = []
        self.unfixable_issues = []


class ValidationResult:
    """Result of validation operations"""
    def __init__(self):
        self.missing_fields = []
        self.invalid_fields = []
        self.custom_field_errors = []
        self.warnings = []


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
        from .models import AuditAction, EntityType
        from .schemas_audit import AuditTrailCreate
        from .services.audit_service import get_audit_service

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


@router.post("/import/test-cases/", response_model=ImportTestCasesResponse)
async def import_test_cases(
    request: Request,
    file: UploadFile = File(...),
    test_suite_id: Optional[int] = Form(None),
    section_id: Optional[int] = Form(None),  # Add default section for all imported test cases
    skip_duplicates: Optional[bool] = Form(True),  # Skip duplicate entries
    duplicate_mode: Optional[DuplicateAction] = Form(None),  # skip, copy, update, rename
    import_mode: Optional[ImportMode] = Form(None),  # create_only, skip_duplicates, update_existing, create_copy
    dry_run: Optional[bool] = Form(False),  # Validate without creating or updating records
    idempotency_key_header: Optional[str] = Header(None, alias='Idempotency-Key'),
    apply_corrections: Optional[bool] = Form(True),  # Apply automatic data corrections
    validate_custom_fields: Optional[bool] = Form(True),  # Validate custom fields
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.get_current_active_user),
):
    # Validate file extension
    validate_file_extension(file.filename, ['.csv'], "Import file")

    # Validate file size
    contents = await validate_file_size(file, MAX_CSV_IMPORT_SIZE, "CSV file")

    # Validate test_suite_id
    if test_suite_id is None:
        raise HTTPException(status_code=400, detail="test_suite_id is required")

    try:

        encoding = detect_encoding(contents)
        decoded_contents = contents.decode(encoding, errors='replace')
        csv_reader = csv.DictReader(io.StringIO(decoded_contents))
        rows = list(csv_reader)

        if not rows:
            raise HTTPException(status_code=400, detail="File is empty")
        if len(rows) > MAX_ROWS_PER_IMPORT:
            raise HTTPException(status_code=400, detail=f"CSV imports are limited to {MAX_ROWS_PER_IMPORT} rows")
        if not csv_reader.fieldnames:
            raise HTTPException(status_code=400, detail="CSV header row is required")
        rows = normalize_import_rows(rows, csv_reader.fieldnames)
        normalized_fieldnames = [normalize_import_header(fieldname) for fieldname in csv_reader.fieldnames]

        # Validate required columns
        required_columns = ['title']
        missing_columns = [col for col in required_columns if col not in normalized_fieldnames]
        if missing_columns:
            raise HTTPException(status_code=400, detail=f"Missing required columns: {missing_columns}")

        # Dry runs make no changes, so they must not be cached as idempotent
        # results nor take the import lock (otherwise a later real import reusing
        # the same Idempotency-Key would return the dry-run result and import
        # nothing, and a preview could block a real import).
        idempotency_record_key = None if dry_run else get_idempotency_key(request, current_user.id, 'multipart-test-case-import')
        cached_response = begin_idempotent_request(db, idempotency_record_key, current_user.id, 'multipart-test-case-import')
        if cached_response is not None:
            return cached_response

        test_suite = get_test_suite_or_404(db, test_suite_id)
        ensure_import_permission(current_user, test_suite.project_id, db)
        lock_owner = idempotency_record_key or f"request:{uuid.uuid4()}"
        lock_key = f"test-suite-import:{test_suite_id}"
        if not dry_run:
            acquire_import_lock(
                db=db,
                lock_key=lock_key,
                owner=lock_owner,
                user_id=current_user.id,
                operation='multipart-test-case-import',
                project_id=test_suite.project_id,
                test_suite_id=test_suite_id,
                filename=file.filename,
            )
        section_id = validate_section_for_suite(db, section_id, test_suite_id)
        project_id = test_suite.project_id
        custom_fields = []
        if project_id and validate_custom_fields:
            custom_fields = get_custom_fields_for_project(db, project_id)

        # Ensure default priority and test type definitions exist if they are blank in the DB
        # Use a default user ID (e.g., 1) since imports might not have a current user context
        from . import crud
        crud.ensure_default_priority_and_test_type_definitions(db, created_by=current_user.id)

        # Step 1: Apply bulk corrections if enabled
        if apply_corrections:
            rows = apply_bulk_corrections(rows)

        # Step 2: Detect duplicates and process rows with enhanced validation and cleaning
        duplicate_detection = detect_duplicates(db, rows, test_suite_id)
        imported_count = 0
        skipped_count = 0
        errors: List[str] = []
        warnings: List[str] = []
        corrections: List[str] = []
        created_ids: List[int] = []
        row_results: List[Dict[str, Any]] = []
        default_duplicate_action = get_default_duplicate_action(bool(skip_duplicates), duplicate_mode, import_mode)
        duplicate_indexes = build_duplicate_indexes(db, test_suite_id, custom_fields)
        seen_titles: Set[str] = set()
        used_titles: Set[str] = set(duplicate_indexes['title_suite'].keys())

        for index, row in enumerate(rows):
            row_num = index + 2  # +2 for header and 0-based index
            row_label = f"Row {row_num}"
            created_case: Optional[TestCase] = None
            result: Dict[str, Any] = {
                "row_number": row_num,
                "title": str(row.get('title') or ''),
                "status": "pending",
                "action": default_duplicate_action,
                "created_id": None,
                "updated_id": None,
                "existing_id": None,
                "warning": None,
                "error": None,
            }

            try:
                cleaning_result = clean_data(row)
                if cleaning_result.corrections_made:
                    corrections.extend([f"{row_label}: {correction}" for correction in cleaning_result.corrections_made])
                if cleaning_result.unfixable_issues:
                    error = f"{row_label}: {'; '.join(cleaning_result.unfixable_issues)}"
                    errors.append(error)
                    result.update({"status": "error", "error": error})
                    row_results.append(result)
                    continue

                cleaned_data = cleaning_result.cleaned_fields
                normalized_title = str(cleaned_data.get('title') or '').lower().strip()
                lookup_row = PreviewedTestCaseImportRow(
                    id=int(cleaned_data['id']) if str(cleaned_data.get('id') or '').isdigit() else None,
                    title=cleaned_data.get('title') or f'row-{row_num}',
                    reference=cleaned_data.get('reference'),
                    external_key=cleaned_data.get('external_key'),
                    section_id=int(cleaned_data['section_id']) if str(cleaned_data.get('section_id') or '').isdigit() else section_id,
                )
                duplicate_case, duplicate_match = find_duplicate_case(lookup_row, duplicate_indexes, section_id)
                duplicate_in_import = bool(normalized_title and normalized_title in seen_titles)
                is_duplicate = duplicate_case is not None or duplicate_in_import
                row_action = default_duplicate_action
                result.update({
                    "title": cleaned_data.get('title') or result["title"],
                    "action": row_action,
                    "existing_id": duplicate_case.id if duplicate_case else None,
                    "match_source": duplicate_match,
                })

                if is_duplicate and row_action == 'create_only':
                    error = f"{row_label}: duplicate test case matched by {duplicate_match or 'title in import'}"
                    errors.append(error)
                    result.update({"status": "error", "error": error})
                    row_results.append(result)
                    continue
                if is_duplicate and row_action == 'skip':
                    skipped_count += 1
                    warning = (
                        f"{row_label}: skipped duplicate title '{cleaned_data.get('title')}' (existing ID: {duplicate_case.id})"
                        if duplicate_case else f"{row_label}: skipped duplicate title within import file"
                    )
                    warnings.append(warning)
                    result.update({"status": "skipped", "warning": warning})
                    row_results.append(result)
                    continue
                if is_duplicate and row_action == 'update' and duplicate_case is None:
                    skipped_count += 1
                    warning = f"{row_label}: skipped update because duplicate exists only within this import file"
                    warnings.append(warning)
                    result.update({"status": "skipped", "warning": warning})
                    row_results.append(result)
                    continue

                validation_result = validate_required_fields(cleaned_data, custom_fields)
                row_errors = validation_result.missing_fields + validation_result.invalid_fields + validation_result.custom_field_errors
                if row_errors:
                    error = f"{row_label}: {'; '.join(row_errors)}"
                    errors.append(error)
                    result.update({"status": "error", "error": error})
                    row_results.append(result)
                    continue

                row_section_id = validate_section_for_suite(db, cleaned_data.get('section_id') or section_id, test_suite_id)
                final_title = cleaned_data['title']
                if is_duplicate and row_action == 'rename':
                    final_title = make_imported_copy_title(final_title, used_titles | seen_titles)
                    result.update({"title": final_title, "warning": f"{row_label}: renamed duplicate to '{final_title}'"})

                test_case_data = {
                    'title': final_title,
                    'description': cleaned_data.get('description'),
                    'preconditions': cleaned_data.get('preconditions', ''),
                    'steps': cleaned_data.get('steps', ''),
                    'expected_result': cleaned_data.get('expected_result', ''),
                    'priority': cleaned_data.get('priority', 'medium'),
                    'status': cleaned_data.get('status', 'active'),
                    'reference': cleaned_data.get('reference'),
                    'tags': cleaned_data.get('tags'),
                    'test_suite_id': test_suite_id,
                    'test_type': cleaned_data.get('test_type', 'manual'),
                    'section_id': row_section_id,
                    'order_index': cleaned_data.get('order_index') or 0,
                    'is_multistep': parse_bool(cleaned_data.get('is_multistep'), False)
                }
                if test_case_data['is_multistep']:
                    multistep_data = cleaned_data.get('multistep_data')
                    test_case_data['test_steps'] = parse_multistep_data(multistep_data, row_label) if multistep_data else []

                if dry_run:
                    imported_count += 1
                    result["status"] = "would_update" if row_action == 'update' and duplicate_case else "would_create"
                    row_results.append(result)
                    seen_titles.add(normalized_title)
                    if row_action == 'rename':
                        seen_titles.add(final_title.lower().strip())
                        used_titles.add(final_title.lower().strip())
                    continue

                if row_action == 'update' and duplicate_case:
                    updated_case = update_import_test_case_without_commit(db, duplicate_case, dict(test_case_data))
                    needs_commit = apply_imported_timestamps(updated_case, cleaned_data.get('created_at'), cleaned_data.get('updated_at'))
                    db.commit()
                    imported_count += 1
                    result.update({"status": "updated", "updated_id": updated_case.id})
                    row_results.append(result)
                    seen_titles.add(normalized_title)
                    add_case_to_duplicate_indexes(duplicate_indexes, updated_case, cleaned_data.get('external_key'))
                    continue

                created_case = create_import_test_case_without_commit(db, dict(test_case_data), current_user.id)
                needs_commit = apply_imported_timestamps(created_case, cleaned_data.get('created_at'), cleaned_data.get('updated_at'))

                if custom_fields and validate_custom_fields:
                    for custom_field in custom_fields:
                        field_value = cleaned_data.get(custom_field.name, '') or cleaned_data.get(custom_field.slug or '', '')
                        if field_value:
                            db.add(CustomFieldValue(
                                field_definition_id=custom_field.id,
                                test_case_id=created_case.id,
                                value=transform_custom_field_value(field_value, custom_field),
                            ))
                            needs_commit = True

                db.commit()
                imported_count += 1
                created_ids.append(created_case.id)
                result.update({"status": "created", "created_id": created_case.id})
                row_results.append(result)
                seen_titles.add(normalized_title)
                used_titles.add(final_title.lower().strip())
                add_case_to_duplicate_indexes(duplicate_indexes, created_case, cleaned_data.get('external_key'))

            except DataValidationError as e:
                db.rollback()
                errors.append(str(e))
                result.update({"status": "error", "error": str(e)})
                row_results.append(result)
            except Exception as e:
                db.rollback()
                if created_case is not None:
                    try:
                        crud.delete_test_case(db, created_case.id)
                    except Exception:
                        db.rollback()
                logger.exception("Failed to import test case row %s", row_num)
                error = f"{row_label}: {str(e)}"
                errors.append(error)
                result.update({"status": "error", "error": error})
                row_results.append(result)

        response = build_import_response(
            imported_count=imported_count,
            total_rows=len(rows),
            skipped_count=skipped_count,
            errors=errors,
            warnings=warnings,
            corrections=corrections,
            created_ids=created_ids,
            duplicate_detection=duplicate_detection,
            row_results=row_results,
            dry_run=bool(dry_run),
        )
        record_import_audit(
            db=db,
            current_user=current_user,
            project_id=test_suite.project_id,
            test_suite_id=test_suite_id,
            response=response,
            filename=file.filename,
            idempotency_key=idempotency_record_key,
        )
        complete_idempotent_request(db, idempotency_record_key, response)
        release_import_lock(db, lock_key, lock_owner)
        return response

    except HTTPException as exc:
        fail_idempotent_request(db, locals().get('idempotency_record_key'), str(exc.detail))
        release_import_lock(db, locals().get('lock_key'), locals().get('lock_owner'))
        raise
    except Exception as e:
        fail_idempotent_request(db, locals().get('idempotency_record_key'), str(e))
        release_import_lock(db, locals().get('lock_key'), locals().get('lock_owner'))
        raise HTTPException(status_code=500, detail=f"Error processing file: {str(e)}")


@router.post("/import-jobs")
async def create_import_job(
    payload: ImportJobCreate,
    current_user: User = Depends(auth.get_current_active_user),
):
    job_id = str(uuid.uuid4())
    now = datetime.now().isoformat()
    IMPORT_JOBS[job_id] = {
        "id": job_id,
        "status": "pending",
        "filename": payload.filename,
        "total_rows": payload.total_rows,
        "total_chunks": payload.total_chunks,
        "processed_rows": 0,
        "imported_rows": 0,
        "skipped_rows": 0,
        "error_rows": 0,
        "created_by": current_user.id,
        "created_at": now,
        "updated_at": now,
    }
    return IMPORT_JOBS[job_id]


@router.get("/import-jobs/{job_id}")
async def get_import_job(
    job_id: str,
    current_user: User = Depends(auth.get_current_active_user),
):
    job = IMPORT_JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Import job not found")
    if job.get("created_by") != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to view this import job")
    return job


@router.post("/import/test-cases/previewed", response_model=ImportTestCasesResponse)
async def import_previewed_test_cases(
    payload: PreviewedTestCaseImportRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.get_current_active_user),
    idempotency_key_header: Optional[str] = Header(None, alias='Idempotency-Key'),
):
    """Import mapped and previewed test cases from the frontend CSV workflow."""
    # Dry runs make no changes, so they must not be cached as idempotent results
    # nor take the import lock. Caching a dry run would make a later *real* import
    # that reuses the same Idempotency-Key return the dry-run result and import
    # nothing, while taking the lock would let a preview block a real import.
    idempotency_record_key = None if payload.dry_run else get_idempotency_key(request, current_user.id, 'previewed-test-case-import')
    cached_response = begin_idempotent_request(db, idempotency_record_key, current_user.id, 'previewed-test-case-import')
    if cached_response is not None:
        return cached_response

    test_suite = get_test_suite_or_404(db, payload.test_suite_id)
    ensure_import_permission(current_user, test_suite.project_id, db)

    lock_owner = idempotency_record_key or f"request:{uuid.uuid4()}"
    lock_key = f"test-suite-import:{payload.test_suite_id}"
    if not payload.dry_run:
        acquire_import_lock(
            db=db,
            lock_key=lock_key,
            owner=lock_owner,
            user_id=current_user.id,
            operation='previewed-test-case-import',
            project_id=test_suite.project_id,
            test_suite_id=payload.test_suite_id,
            filename=payload.filename,
        )

    try:
        custom_fields = get_custom_fields_for_project(db, test_suite.project_id)
        custom_fields_by_id = normalize_custom_field_lookup(custom_fields)

        if not payload.dry_run:
            crud.ensure_default_priority_and_test_type_definitions(db, created_by=current_user.id)

        imported_count = 0
        skipped_count = 0
        errors: List[str] = []
        warnings: List[str] = []
        created_ids: List[int] = []
        seen_titles: Set[str] = set()
        duplicate_detection = DuplicateDetectionResult()

        update_import_job(payload.import_job_id, status="running")
        row_results: List[Dict[str, Any]] = []
        default_duplicate_action = get_default_duplicate_action(payload.skip_duplicates, payload.duplicate_mode, payload.import_mode)
        duplicate_indexes = build_duplicate_indexes(db, payload.test_suite_id, custom_fields)
        used_titles: Set[str] = set(duplicate_indexes['title_suite'].keys())

        for index, row in enumerate(payload.rows, start=1):
            row_number = row.row_number or index
            row_label = f"Row {row_number}"
            normalized_title = row.title.lower().strip()
            duplicate_case, duplicate_match = find_duplicate_case(row, duplicate_indexes, row.section_id)
            duplicate_in_import = normalized_title in seen_titles
            is_duplicate = duplicate_case is not None or duplicate_in_import
            row_action = normalize_import_action(row.import_action or default_duplicate_action, payload.skip_duplicates)
            created_case: Optional[TestCase] = None
            result: Dict[str, Any] = {
                "row_number": row_number,
                "title": row.title,
                "status": "pending",
                "action": row_action,
                "created_id": None,
                "updated_id": None,
                "existing_id": duplicate_case.id if duplicate_case else None,
                "match_source": duplicate_match,
                "warning": None,
                "error": None,
            }

            try:
                if is_duplicate:
                    duplicate_entry = {
                        'row': row_number,
                        'title': row.title,
                        'existing_id': duplicate_case.id if duplicate_case else None,
                        'action': row_action,
                        'match_source': duplicate_match or 'title_in_import',
                    }
                    if duplicate_match == 'id':
                        duplicate_detection.duplicates_by_id.append(duplicate_entry)
                    else:
                        duplicate_detection.duplicates_by_title.append(duplicate_entry)

                if is_duplicate and row_action == 'create_only':
                    error = f"{row_label}: duplicate test case matched by {duplicate_match or 'title in import'}"
                    errors.append(error)
                    result.update({"status": "error", "error": error})
                    row_results.append(result)
                    continue

                if is_duplicate and row_action == 'skip':
                    skipped_count += 1
                    warning = (
                        f"{row_label}: skipped duplicate title '{row.title}' (existing ID: {duplicate_case.id})"
                        if duplicate_case else f"{row_label}: skipped duplicate title within import file"
                    )
                    warnings.append(warning)
                    result.update({"status": "skipped", "warning": warning})
                    row_results.append(result)
                    continue

                if is_duplicate and row_action == 'update' and duplicate_case is None:
                    skipped_count += 1
                    warning = f"{row_label}: skipped update because duplicate exists only within this import file"
                    warnings.append(warning)
                    result.update({"status": "skipped", "warning": warning})
                    row_results.append(result)
                    continue

                if row.test_suite_id is not None and row.test_suite_id != payload.test_suite_id:
                    error = f"{row_label}: row test_suite_id does not match target test suite"
                    errors.append(error)
                    result.update({"status": "error", "error": error})
                    row_results.append(result)
                    continue

                section_id = validate_section_for_suite(db, row.section_id, payload.test_suite_id)
                custom_value_errors: List[str] = []
                effective_custom_field_values = merge_external_key_custom_value(row, custom_fields)

                required_custom_field_ids = {field.id for field in custom_fields if field.is_required}
                provided_custom_field_ids = {value.field_definition_id for value in effective_custom_field_values if str(value.value or '').strip()}
                missing_required_custom_fields = required_custom_field_ids - provided_custom_field_ids
                if missing_required_custom_fields:
                    missing_names = [custom_fields_by_id[field_id].name for field_id in missing_required_custom_fields if field_id in custom_fields_by_id]
                    custom_value_errors.append(f"Missing required custom fields: {', '.join(missing_names)}")

                if custom_value_errors:
                    error = f"{row_label}: {'; '.join(custom_value_errors)}"
                    errors.append(error)
                    result.update({"status": "error", "error": error})
                    row_results.append(result)
                    continue

                final_title = normalize_text(row.title)
                if is_duplicate and row_action == 'rename':
                    final_title = make_imported_copy_title(final_title, used_titles | seen_titles)
                    result["title"] = final_title
                    result["warning"] = f"{row_label}: renamed duplicate to '{final_title}'"

                test_case_data = {
                    'title': final_title,
                    'description': normalize_text(row.description or ''),
                    'preconditions': normalize_multiline_text(row.preconditions or ''),
                    'steps': normalize_multiline_text(row.steps or ''),
                    'expected_result': normalize_multiline_text(row.expected_result or ''),
                    'priority': normalize_priority(row.priority),
                    'status': normalize_status(row.status),
                    'reference': normalize_text(row.reference or ''),
                    'tags': normalize_text(row.tags or ''),
                    'test_suite_id': payload.test_suite_id,
                    'test_type': normalize_test_type(row.test_type),
                    'section_id': section_id,
                    'order_index': row.order_index or 0,
                    'is_multistep': row.is_multistep or False,
                }

                if row.is_multistep and row.multistep_data:
                    test_case_data['test_steps'] = parse_multistep_data(row.multistep_data, row_label)

                if payload.dry_run:
                    imported_count += 1
                    result["status"] = "would_update" if row_action == 'update' and duplicate_case else "would_create"
                    row_results.append(result)
                    seen_titles.add(normalized_title)
                    if row_action == 'rename':
                        seen_titles.add(final_title.lower().strip())
                        used_titles.add(final_title.lower().strip())
                    continue

                if row_action == 'update' and duplicate_case:
                    updated_case = update_import_test_case_without_commit(db, duplicate_case, dict(test_case_data))
                    needs_commit = apply_imported_timestamps(updated_case, row.created_at, row.updated_at)
                    provided_field_ids = {value.field_definition_id for value in effective_custom_field_values}
                    if provided_field_ids:
                        db.query(CustomFieldValue).filter(
                            CustomFieldValue.test_case_id == updated_case.id,
                            CustomFieldValue.field_definition_id.in_(provided_field_ids),
                        ).delete(synchronize_session=False)
                    custom_value_errors = create_custom_field_values(
                        db=db,
                        test_case_id=updated_case.id,
                        custom_field_values=effective_custom_field_values,
                        custom_fields_by_id=custom_fields_by_id,
                    )
                    if custom_value_errors:
                        db.rollback()
                        error = f"{row_label}: {'; '.join(custom_value_errors)}"
                        errors.append(error)
                        result.update({"status": "error", "error": error})
                        row_results.append(result)
                        continue
                    db.commit()
                    imported_count += 1
                    result.update({"status": "updated", "updated_id": updated_case.id})
                    row_results.append(result)
                    seen_titles.add(normalized_title)
                    add_case_to_duplicate_indexes(duplicate_indexes, updated_case, row.external_key)
                    continue

                created_case = create_import_test_case_without_commit(db, dict(test_case_data), current_user.id)
                needs_commit = apply_imported_timestamps(created_case, row.created_at, row.updated_at)

                custom_value_errors = create_custom_field_values(
                    db=db,
                    test_case_id=created_case.id,
                    custom_field_values=effective_custom_field_values,
                    custom_fields_by_id=custom_fields_by_id,
                )
                if custom_value_errors:
                    db.rollback()
                    crud.delete_test_case(db, created_case.id)
                    error = f"{row_label}: {'; '.join(custom_value_errors)}"
                    errors.append(error)
                    result.update({"status": "error", "error": error})
                    row_results.append(result)
                    continue

                if custom_value_errors or effective_custom_field_values:
                    needs_commit = True

                db.commit()
                imported_count += 1
                created_ids.append(created_case.id)
                result.update({"status": "created", "created_id": created_case.id})
                row_results.append(result)
                seen_titles.add(normalized_title)
                used_titles.add(final_title.lower().strip())
                add_case_to_duplicate_indexes(duplicate_indexes, created_case, row.external_key)

            except HTTPException as exc:
                db.rollback()
                error = f"{row_label}: {exc.detail}"
                errors.append(error)
                result.update({"status": "error", "error": error})
                row_results.append(result)
            except DataValidationError as exc:
                db.rollback()
                errors.append(str(exc))
                result.update({"status": "error", "error": str(exc)})
                row_results.append(result)
            except Exception as exc:
                db.rollback()
                if created_case is not None:
                    try:
                        crud.delete_test_case(db, created_case.id)
                    except Exception:
                        db.rollback()
                error = f"{row_label}: {str(exc)}"
                errors.append(error)
                result.update({"status": "error", "error": error})
                row_results.append(result)

        response = build_import_response(
            imported_count=imported_count,
            total_rows=len(payload.rows),
            skipped_count=skipped_count,
            errors=errors,
            warnings=warnings,
            created_ids=created_ids,
            duplicate_detection=duplicate_detection,
            row_results=row_results,
            import_job_id=payload.import_job_id,
            dry_run=payload.dry_run,
        )
        increment_import_job(payload.import_job_id, response)
        record_import_audit(
            db=db,
            current_user=current_user,
            project_id=test_suite.project_id,
            test_suite_id=payload.test_suite_id,
            response=response,
            filename=payload.filename,
            idempotency_key=idempotency_record_key,
        )
        complete_idempotent_request(db, idempotency_record_key, response)
        release_import_lock(db, lock_key, lock_owner)
        return response



    except HTTPException as exc:
        fail_idempotent_request(db, idempotency_record_key, str(exc.detail))
        release_import_lock(db, lock_key, lock_owner)
        raise
    except Exception as exc:
        fail_idempotent_request(db, idempotency_record_key, str(exc))
        release_import_lock(db, lock_key, lock_owner)
        logger.exception("Failed to import previewed test cases")
        raise HTTPException(status_code=500, detail=f"Error importing test cases: {str(exc)}")

@router.get("/export/test-cases/", response_model=ExportTestCasesResponse)
def export_test_cases(
    test_suite_id: int,
    format: str = "csv",
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.get_current_active_user),
):
    if format.lower() != "csv":
        raise HTTPException(status_code=400, detail="Only CSV format is supported")

    test_suite = get_test_suite_or_404(db, test_suite_id)
    if not rbac.has_permission(current_user, "read", test_suite.project_id, db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to export test cases for this project")
    project_custom_fields = get_custom_fields_for_project(db, test_suite.project_id)

    test_cases = (
        db.query(TestCase)
        .options(
            selectinload(TestCase.custom_field_values),
            selectinload(TestCase.test_steps),
        )
        .filter(TestCase.test_suite_id == test_suite_id)
        .order_by(TestCase.id)
        .limit(MAX_ROWS_PER_EXPORT + 1)
        .all()
    )
    truncated = len(test_cases) > MAX_ROWS_PER_EXPORT
    if truncated:
        test_cases = test_cases[:MAX_ROWS_PER_EXPORT]

    # Prepare data for CSV export with enhanced fields including multistep support
    custom_field_headers: Dict[int, str] = {}
    used_headers = set(TEST_CASE_CSV_FIELDS)
    for custom_field in project_custom_fields:
        header = sanitize_csv_field(custom_field.name.strip() if custom_field.name else '') or custom_field.slug or f"custom_field_{custom_field.id}"
        if header in used_headers:
            header = custom_field.slug or f"{header}_{custom_field.id}"
        while header in used_headers:
            header = f"{header}_{custom_field.id}"
        used_headers.add(header)
        custom_field_headers[custom_field.id] = header

    fieldnames = TEST_CASE_CSV_FIELDS + list(custom_field_headers.values())

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()

    for test_case in test_cases:
        # Get multistep data if applicable
        multistep_data = ""
        if test_case.is_multistep:
            steps = sorted(getattr(test_case, 'test_steps', []) or [], key=lambda step: step.step_number)
            if steps:
                # Format multistep data as JSON string for CSV
                multistep_data = json.dumps([
                    {
                        'step_number': step.step_number,
                        'action': step.action,
                        'expected_result': step.expected_result,
                        'step_type': step.step_type,
                        'data': step.data if isinstance(step.data, dict) else None,
                        'order_index': step.order_index or 0,
                    }
                    for step in steps
                ])

        custom_values = {
            custom_field_headers[value.field_definition_id]: value.value or ''
            for value in getattr(test_case, 'custom_field_values', [])
            if value.field_definition_id in custom_field_headers
        }
        row_data = {
            'id': test_case.id,
            'title': test_case.title,
            'description': test_case.description or '',
            'test_type': test_case.test_type or 'manual',
            'preconditions': test_case.preconditions or '',
            'steps': test_case.steps or '',
            'expected_result': test_case.expected_result or '',
            'priority': test_case.priority or 'medium',
            'status': test_case.status or 'active',
            'reference': test_case.reference or '',
            'tags': test_case.tags or '',
            'test_suite_id': test_case.test_suite_id,
            'section_id': test_case.section_id or '',
            # Render numbers/booleans/dates explicitly: sanitize_csv_field() treats
            # any falsy value as '', which would otherwise drop order_index 0 and
            # is_multistep False and emit a capitalised "True"/"False".
            'order_index': str(test_case.order_index if test_case.order_index is not None else 0),
            'is_multistep': 'true' if getattr(test_case, 'is_multistep', False) else 'false',
            'multistep_data': multistep_data,
            'created_at': test_case.created_at.isoformat() if test_case.created_at else '',
            'updated_at': test_case.updated_at.isoformat() if test_case.updated_at else ''
        }
        row_data.update(custom_values)
        writer.writerow({key: sanitize_csv_field(value) for key, value in row_data.items()})

        if output.tell() > MAX_EXPORT_SIZE_BYTES:
            raise HTTPException(status_code=413, detail="Export is too large. Narrow the test suite or export fewer test cases.")

    return {
        "filename": "test_cases.csv",
        "content": output.getvalue(),
        "media_type": "text/csv",
        "total_rows": len(test_cases),
        "truncated": truncated,
        "warnings": [f"Export limited to the first {MAX_ROWS_PER_EXPORT} test cases"] if truncated else [],
    }


def transform_custom_field_value(value: str, field_def: CustomFieldDefinition) -> str:
    """Transform custom field value based on its type"""
    value_str = str(value).strip()

    if field_def.field_type == CustomFieldType.NUMBER:
        try:
            # Convert to float and back to string to normalize format
            num_value = float(value_str)
            return str(num_value)
        except ValueError:
            return value_str

    elif field_def.field_type == CustomFieldType.DATE:
        cleaned_date = clean_date_string(value_str)
        return cleaned_date if cleaned_date else value_str

    elif field_def.field_type == CustomFieldType.BOOLEAN:
        # Normalize boolean values
        boolean_map = {
            'true': 'true', 'yes': 'true', '1': 'true', 'on': 'true',
            'false': 'false', 'no': 'false', '0': 'false', 'off': 'false'
        }
        return boolean_map.get(value_str.lower(), value_str)

    elif field_def.field_type == CustomFieldType.MULTISELECT:
        # Split and clean multiselect values
        values = [v.strip() for v in value_str.split(',') if v.strip()]
        return ', '.join(values)

    return value_str


@router.post("/import/test-cases/validate")
async def validate_import_file(
    file: UploadFile = File(...),
    test_suite_id: int = Form(...),
    skip_duplicates: Optional[bool] = Form(True),
    apply_corrections: Optional[bool] = Form(True),
    validate_custom_fields: Optional[bool] = Form(True),
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.get_current_active_user),
):
    """Validate import file without actually importing data"""
    # Validate file extension
    validate_file_extension(file.filename, ['.csv'], "Import file")

    # Validate file size
    contents = await validate_file_size(file, MAX_CSV_IMPORT_SIZE, "CSV file")

    try:
        encoding = detect_encoding(contents)
        csv_reader = csv.DictReader(io.StringIO(contents.decode(encoding, errors='replace')))
        rows = list(csv_reader)

        if not rows:
            raise HTTPException(status_code=400, detail="File is empty")
        if len(rows) > MAX_ROWS_PER_IMPORT:
            raise HTTPException(status_code=400, detail=f"CSV imports are limited to {MAX_ROWS_PER_IMPORT} rows")
        if not csv_reader.fieldnames:
            raise HTTPException(status_code=400, detail="CSV header row is required")

        # Normalize headers/aliases exactly like the import endpoint so validation
        # results match what an actual import would do (e.g. a "Name" or "Summary"
        # column maps to title instead of being reported as a missing field).
        rows = normalize_import_rows(rows, csv_reader.fieldnames)
        normalized_fieldnames = [normalize_import_header(fieldname) for fieldname in csv_reader.fieldnames]
        missing_columns = [col for col in ['title'] if col not in normalized_fieldnames]
        if missing_columns:
            raise HTTPException(status_code=400, detail=f"Missing required columns: {missing_columns}")

        test_suite = get_test_suite_or_404(db, test_suite_id)
        ensure_import_permission(current_user, test_suite.project_id, db)
        project_id = test_suite.project_id
        custom_fields = []
        if project_id and validate_custom_fields:
            custom_fields = get_custom_fields_for_project(db, project_id)

        # Apply bulk corrections if enabled
        if apply_corrections:
            rows = apply_bulk_corrections(rows)

        # Detect duplicates
        duplicate_detection = detect_duplicates(db, rows, test_suite_id)

        # Validate all rows
        validation_errors = []
        validation_warnings = []
        corrections = []
        valid_rows = 0

        for index, row in enumerate(rows):
            row_num = index + 2
            row_has_errors = False

            # Clean data
            cleaning_result = clean_data(row)
            if cleaning_result.corrections_made:
                corrections.extend([f"Row {row_num}: {correction}" for correction in cleaning_result.corrections_made])
            if cleaning_result.unfixable_issues:
                validation_errors.extend([f"Row {row_num}: {issue}" for issue in cleaning_result.unfixable_issues])
                row_has_errors = True

            cleaned_data = cleaning_result.cleaned_fields

            # Validate
            validation_result = validate_required_fields(cleaned_data, custom_fields)

            if validation_result.missing_fields:
                validation_errors.append(f"Row {row_num}: {'; '.join(validation_result.missing_fields)}")
                row_has_errors = True

            if validation_result.invalid_fields:
                validation_errors.append(f"Row {row_num}: {'; '.join(validation_result.invalid_fields)}")
                row_has_errors = True

            if validation_result.custom_field_errors:
                validation_errors.append(f"Row {row_num}: {'; '.join(validation_result.custom_field_errors)}")
                row_has_errors = True

            try:
                validate_section_for_suite(db, cleaned_data.get('section_id'), test_suite_id)
            except HTTPException as exc:
                validation_errors.append(f"Row {row_num}: {exc.detail}")
                row_has_errors = True

            if parse_bool(cleaned_data.get('is_multistep'), False) and cleaned_data.get('multistep_data'):
                try:
                    parse_multistep_data(cleaned_data.get('multistep_data'), f"Row {row_num}")
                except DataValidationError as exc:
                    validation_errors.append(str(exc))
                    row_has_errors = True

            if not row_has_errors:
                valid_rows += 1

        return {
            "valid": len(validation_errors) == 0,
            "total_rows": len(rows),
            "valid_rows": valid_rows,
            "invalid_rows": len(validation_errors),
            "errors": validation_errors,
            "warnings": validation_warnings,
            "corrections": corrections,
            "duplicate_detection": {
                "duplicates_by_title": len(duplicate_detection.duplicates_by_title),
                "duplicates_by_id": len(duplicate_detection.duplicates_by_id),
                "details": {
                    "by_title": duplicate_detection.duplicates_by_title[:10],  # Limit to first 10
                    "by_id": duplicate_detection.duplicates_by_id[:10]
                }
            },
            "custom_fields_found": len(custom_fields),
            "custom_field_names": [cf.name for cf in custom_fields]
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error validating file: {str(e)}")


@router.get("/import/template")
def get_import_template(
    include_custom_fields: Optional[bool] = False,
    project_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    """Get CSV import template with optional custom fields"""

    # Standard fields
    fieldnames = [
        'title', 'description', 'test_type', 'preconditions', 'steps', 'expected_result',
        'reference',
        'priority', 'status', 'tags', 'section_id', 'order_index', 'is_multistep', 'multistep_data'
    ]

    # Add custom fields if requested
    custom_fields = []
    if include_custom_fields and project_id:
        custom_fields = get_custom_fields_for_project(db, project_id)
        fieldnames.extend([cf.name for cf in custom_fields])

    # Create sample data
    sample_data = {
        'title': 'Sample Test Case Title',
        'description': 'This is a sample test case description',
        'test_type': 'manual',
        'preconditions': 'User is logged in',
        'steps': '1. Navigate to home page\n2. Click login button\n3. Enter credentials',
        'expected_result': 'User is successfully logged in',
        'reference': 'REQ-123',
        'priority': 'medium',
        'status': 'active',
        'tags': 'smoke, regression',
        'section_id': '1',
        'order_index': '1',
        'is_multistep': 'false',
        'multistep_data': ''
    }

    # Add sample custom field values
    for custom_field in custom_fields:
        if custom_field.field_type == CustomFieldType.TEXT:
            sample_data[custom_field.name] = f'Sample {custom_field.name}'
        elif custom_field.field_type == CustomFieldType.NUMBER:
            sample_data[custom_field.name] = '123'
        elif custom_field.field_type == CustomFieldType.DATE:
            sample_data[custom_field.name] = '2024-01-01'
        elif custom_field.field_type == CustomFieldType.BOOLEAN:
            sample_data[custom_field.name] = 'true'
        elif custom_field.field_type == CustomFieldType.SELECT:
            field_options = get_custom_field_options(custom_field)
            sample_data[custom_field.name] = field_options[0] if field_options else ''
        elif custom_field.field_type == CustomFieldType.MULTISELECT:
            field_options = get_custom_field_options(custom_field)
            sample_data[custom_field.name] = ', '.join(field_options[:2]) if field_options else ''

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerow(sample_data)

    return {
        "filename": "test_case_import_template.csv",
        "content": output.getvalue(),
        "media_type": "text/csv",
        "fieldnames": fieldnames,
        "custom_fields": [
            {
                "name": cf.name,
                "type": cf.field_type.value,
                "required": cf.is_required,
                "options": cf.options
            } for cf in custom_fields
        ]
    }


@router.get("/export/test-results/")
def export_test_results(
    test_run_id: int = None,
    format: str = "csv",
    db: Session = Depends(get_db)
):
    if format.lower() != "csv":
        raise HTTPException(status_code=400, detail="Only CSV format is supported")

    test_results = crud.get_test_results(db, test_run_id=test_run_id)

    # Prepare data for CSV export
    fieldnames = [
        'id', 'test_case_id', 'test_case_title', 'test_run_id', 'status',
        'actual_result', 'comments', 'execution_time', 'executed_by',
        'executed_at', 'created_at'
    ]

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()

    for result in test_results:
        writer.writerow({
            'id': result.id,
            'test_case_id': result.test_case_id,
            'test_case_title': result.test_case.title if result.test_case else '',
            'test_run_id': result.test_run_id,
            'status': result.status.value,
            'actual_result': result.actual_result or '',
            'comments': result.comments or '',
            'execution_time': result.execution_time or 0,
            'executed_by': result.executed_by or '',
            'executed_at': result.executed_at,
            'created_at': result.created_at
        })

    return {
        "filename": "test_results.csv",
        "content": output.getvalue(),
        "media_type": "text/csv"
    }


@router.get("/export/projects/")
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
                from .models import TestCase
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
                    from .models import CustomFieldValue
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
            from .models import TestRun, TestResult
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
                from .models import TestPlan
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
                from .models import Milestone
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
                from .models import Requirement
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
                from .models import Defect
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
                from .models import CustomFieldDefinition
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


@router.post("/import/projects/")
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
                crud.ensure_default_priority_and_test_type_definitions(db, created_by=owner_id)

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
                                                status=result_data.get('status', 'pending'),
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


@router.get("/import/projects/template")
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
