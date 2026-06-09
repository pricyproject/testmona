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
