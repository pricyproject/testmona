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
from ..crud_modules.tags import split_tag_names  # module-level: handlers shadow `crud` locally
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


@router.post("/import/test-cases/", response_model=ImportTestCasesResponse)
async def import_test_cases(
    request: Request,
    file: UploadFile = File(...),
    test_suite_id: Optional[int] = Form(None),
    section_id: Optional[int] = Form(None),
    skip_duplicates: Optional[bool] = Form(True),
    duplicate_mode: Optional[DuplicateAction] = Form(None),
    import_mode: Optional[ImportMode] = Form(None),
    dry_run: Optional[bool] = Form(False),
    idempotency_key_header: Optional[str] = Header(None, alias='Idempotency-Key'),
    apply_corrections: Optional[bool] = Form(True),
    validate_custom_fields: Optional[bool] = Form(True),
    db: Session = Depends(get_db),
    current_user: User = Depends(auth.get_current_active_user),
):
    validate_file_extension(file.filename, ['.csv'], "Import file")
    contents = await validate_file_size(file, MAX_CSV_IMPORT_SIZE, "CSV file")

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

        required_columns = ['title']
        missing_columns = [col for col in required_columns if col not in normalized_fieldnames]
        if missing_columns:
            raise HTTPException(status_code=400, detail=f"Missing required columns: {missing_columns}")

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

        from .. import crud
        crud.ensure_default_priority_and_test_type_definitions(db, project_id, current_user.id)

        if apply_corrections:
            rows = apply_bulk_corrections(rows)

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
            row_num = index + 2
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
                    'tags': split_tag_names(cleaned_data.get('tags')),
                    'test_suite_id': test_suite_id,
                    'test_type': cleaned_data.get('test_type', 'manual'),
                    'section_id': row_section_id,
                    'order_index': cleaned_data.get('order_index') or 0,
                    'is_multistep': parse_bool(cleaned_data.get('is_multistep'), False),
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
                    apply_imported_timestamps(updated_case, cleaned_data.get('created_at'), cleaned_data.get('updated_at'))
                    if custom_fields and validate_custom_fields:
                        for custom_field in custom_fields:
                            field_value = cleaned_data.get(custom_field.name, '') or cleaned_data.get(custom_field.slug or '', '')
                            if field_value:
                                db.query(CustomFieldValue).filter(
                                    CustomFieldValue.test_case_id == updated_case.id,
                                    CustomFieldValue.field_definition_id == custom_field.id,
                                ).delete(synchronize_session=False)
                                db.add(CustomFieldValue(
                                    field_definition_id=custom_field.id,
                                    test_case_id=updated_case.id,
                                    value=transform_custom_field_value(field_value, custom_field),
                                ))
                    db.commit()
                    imported_count += 1
                    result.update({"status": "updated", "updated_id": updated_case.id})
                    row_results.append(result)
                    seen_titles.add(normalized_title)
                    add_case_to_duplicate_indexes(duplicate_indexes, updated_case, cleaned_data.get('external_key'))
                    continue

                created_case = create_import_test_case_without_commit(db, dict(test_case_data), current_user.id)
                apply_imported_timestamps(created_case, cleaned_data.get('created_at'), cleaned_data.get('updated_at'))

                if custom_fields and validate_custom_fields:
                    for custom_field in custom_fields:
                        field_value = cleaned_data.get(custom_field.name, '') or cleaned_data.get(custom_field.slug or '', '')
                        if field_value:
                            db.add(CustomFieldValue(
                                field_definition_id=custom_field.id,
                                test_case_id=created_case.id,
                                value=transform_custom_field_value(field_value, custom_field),
                            ))

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
                        from .. import crud
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
            from .. import crud
            crud.ensure_default_priority_and_test_type_definitions(db, test_suite.project_id, current_user.id)

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
                    'tags': split_tag_names(normalize_text(row.tags or '')),
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
                    apply_imported_timestamps(updated_case, row.created_at, row.updated_at)
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
                apply_imported_timestamps(created_case, row.created_at, row.updated_at)

                custom_value_errors = create_custom_field_values(
                    db=db,
                    test_case_id=created_case.id,
                    custom_field_values=effective_custom_field_values,
                    custom_fields_by_id=custom_fields_by_id,
                )
                if custom_value_errors:
                    db.rollback()
                    from .. import crud
                    crud.delete_test_case(db, created_case.id)
                    error = f"{row_label}: {'; '.join(custom_value_errors)}"
                    errors.append(error)
                    result.update({"status": "error", "error": error})
                    row_results.append(result)
                    continue

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
                        from .. import crud
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

    # external_key custom fields are carried by the dedicated built-in
    # ``external_key`` column, so they must not also get their own column or the
    # exported CSV would have two columns that normalize to ``external_key`` and
    # fail to re-import ("Duplicate columns after normalization").
    external_key_field_ids = get_external_key_field_ids(project_custom_fields)

    custom_field_headers: Dict[int, str] = {}
    used_headers = set(TEST_CASE_CSV_FIELDS)
    for custom_field in project_custom_fields:
        if custom_field.id in external_key_field_ids:
            continue
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
        multistep_data = ""
        if test_case.is_multistep:
            steps = sorted(getattr(test_case, 'test_steps', []) or [], key=lambda step: step.step_number)
            if steps:
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
        external_key_value = next(
            (
                value.value
                for value in getattr(test_case, 'custom_field_values', [])
                if value.field_definition_id in external_key_field_ids and (value.value or '')
            ),
            '',
        )
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
            'tags': test_case.tags_cache or '',
            'test_suite_id': test_case.test_suite_id,
            'section_id': test_case.section_id or '',
            'order_index': str(test_case.order_index if test_case.order_index is not None else 0),
            'is_multistep': 'true' if getattr(test_case, 'is_multistep', False) else 'false',
            'multistep_data': multistep_data,
            'external_key': external_key_value or '',
            'created_at': test_case.created_at.isoformat() if test_case.created_at else '',
            'updated_at': test_case.updated_at.isoformat() if test_case.updated_at else '',
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
    validate_file_extension(file.filename, ['.csv'], "Import file")
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

        if apply_corrections:
            rows = apply_bulk_corrections(rows)

        duplicate_detection = detect_duplicates(db, rows, test_suite_id)

        validation_errors = []
        validation_warnings = []
        corrections = []
        valid_rows = 0

        for index, row in enumerate(rows):
            row_num = index + 2
            row_has_errors = False

            cleaning_result = clean_data(row)
            if cleaning_result.corrections_made:
                corrections.extend([f"Row {row_num}: {correction}" for correction in cleaning_result.corrections_made])
            if cleaning_result.unfixable_issues:
                validation_errors.extend([f"Row {row_num}: {issue}" for issue in cleaning_result.unfixable_issues])
                row_has_errors = True

            cleaned_data = cleaning_result.cleaned_fields
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
                    "by_title": duplicate_detection.duplicates_by_title[:10],
                    "by_id": duplicate_detection.duplicates_by_id[:10],
                },
            },
            "custom_fields_found": len(custom_fields),
            "custom_field_names": [cf.name for cf in custom_fields],
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error validating file: {str(e)}")


@router.get("/import/template")
def get_import_template(
    include_custom_fields: Optional[bool] = False,
    project_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """Get CSV import template with optional custom fields"""
    fieldnames = [
        'title', 'description', 'test_type', 'preconditions', 'steps', 'expected_result',
        'reference', 'priority', 'status', 'tags', 'section_id', 'order_index', 'is_multistep', 'multistep_data',
    ]

    custom_fields = []
    if include_custom_fields and project_id:
        custom_fields = get_custom_fields_for_project(db, project_id)
        fieldnames.extend([cf.name for cf in custom_fields])

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
        'multistep_data': '',
    }

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
                "options": cf.options,
            }
            for cf in custom_fields
        ],
    }

