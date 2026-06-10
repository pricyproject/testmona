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


