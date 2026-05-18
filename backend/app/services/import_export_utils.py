from datetime import datetime
from typing import Any, Dict, List, Literal, Optional
import re

import chardet
from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..models import User

MAX_ROWS_PER_IMPORT = 5000
MAX_ROWS_PER_EXPORT = 5000
MAX_STEPS_PER_TEST_CASE = 200
MAX_EXPORT_SIZE_BYTES = 50 * 1024 * 1024
IMPORT_TIMEOUT_SECONDS = 300
EXPORT_TIMEOUT_SECONDS = 300

DuplicateAction = Literal['skip', 'copy', 'update', 'rename', 'create_only', 'skip_duplicates', 'update_existing', 'create_copy']
ImportMode = Literal['create_only', 'skip_duplicates', 'update_existing', 'create_copy']

IMPORT_JOBS: Dict[str, Dict[str, Any]] = {}
IDEMPOTENCY_RECORDS: Dict[str, Dict[str, Any]] = {}
IMPORT_LOCKS: Dict[str, Dict[str, Any]] = {}

AVAILABLE_EXPORT_FIELDS = ['id', 'name', 'description', 'status', 'owner_id', 'created_at', 'updated_at']
VALID_PRIORITIES = {'low', 'medium', 'high', 'critical'}
VALID_TEST_TYPES = {'manual', 'automated', 'smoke', 'regression', 'integration', 'security', 'performance', 'usability', 'compatibility', 'exploratory'}
TEST_CASE_CSV_FIELDS = [
    'id', 'title', 'description', 'test_type', 'preconditions', 'steps', 'expected_result',
    'priority', 'status', 'reference', 'tags', 'test_suite_id', 'section_id', 'order_index',
    'is_multistep', 'multistep_data', 'external_key', 'created_at', 'updated_at',
]
IMPORT_HEADER_ALIASES = {
    'name': 'title',
    'testcase': 'title',
    'test case': 'title',
    'case title': 'title',
    'summary': 'title',
    'desc': 'description',
    'details': 'description',
    'precondition': 'preconditions',
    'prerequisite': 'preconditions',
    'prerequisites': 'preconditions',
    'test steps': 'steps',
    'procedure': 'steps',
    'actions': 'steps',
    'expected': 'expected_result',
    'expected result': 'expected_result',
    'outcome': 'expected_result',
    'type': 'test_type',
    'test type': 'test_type',
    'prio': 'priority',
    'severity': 'priority',
    'state': 'status',
    'ref': 'reference',
    'requirement': 'reference',
    'ticket': 'reference',
    'labels': 'tags',
    'section id': 'section_id',
    'order': 'order_index',
    'order index': 'order_index',
    'multi step': 'is_multistep',
    'multistep': 'is_multistep',
    'is multistep': 'is_multistep',
    'multistep data': 'multistep_data',
    'created': 'created_at',
    'created at': 'created_at',
    'creation time': 'created_at',
    'updated': 'updated_at',
    'updated at': 'updated_at',
    'external key': 'external_key',
    'external id': 'external_key',
    'external_key': 'external_key',
}


class DataValidationError(Exception):
    pass


def detect_encoding(file_bytes: bytes) -> str:
    try:
        result = chardet.detect(file_bytes)
        encoding = result['encoding'] or 'utf-8'
        if result['confidence'] < 0.7:
            encoding = 'utf-8'
        return encoding
    except Exception:
        return 'utf-8'


def validate_owner_id(db: Session, owner_id: int) -> bool:
    try:
        user = db.query(User).filter(User.id == owner_id).first()
        return user is not None
    except Exception:
        return False


def validate_date_format(date_str: str) -> bool:
    if not date_str:
        return True
    try:
        datetime.fromisoformat(date_str.replace('Z', '+00:00'))
        return True
    except Exception:
        return False


def parse_import_datetime(value: Any) -> Optional[datetime]:
    if value in (None, ''):
        return None
    if isinstance(value, datetime):
        return value

    raw_value = str(value).strip()
    if not raw_value:
        return None

    normalized = raw_value.replace('Z', '+00:00')
    try:
        return datetime.fromisoformat(normalized)
    except ValueError:
        cleaned_date = clean_date_string(raw_value)
        if cleaned_date:
            return datetime.fromisoformat(cleaned_date)
        raise DataValidationError(f"Invalid datetime value '{raw_value}'. Use ISO 8601 format.")


def parse_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    normalized = str(value).strip().lower()
    if normalized in {'true', '1', 'yes', 'y', 'on'}:
        return True
    if normalized in {'false', '0', 'no', 'n', 'off'}:
        return False
    return default


def normalize_status(status_value: str) -> str:
    if not status_value:
        return 'active'
    normalized = str(status_value).strip().lower()
    return normalized if normalized in {'active', 'inactive', 'archived'} else 'active'


def normalize_import_header(header: Optional[str]) -> str:
    if header is None:
        return ''
    stripped = str(header).replace('\ufeff', '').strip()
    normalized = re.sub(r'[\s_-]+', ' ', stripped.lower()).strip()
    canonical = normalized.replace(' ', '_')
    if canonical in TEST_CASE_CSV_FIELDS:
        return canonical
    return IMPORT_HEADER_ALIASES.get(normalized, stripped)


def normalize_import_rows(rows: List[Dict[str, Any]], fieldnames: List[Optional[str]]) -> List[Dict[str, Any]]:
    normalized_headers = [normalize_import_header(header) for header in fieldnames]
    duplicate_headers = {
        header for header in normalized_headers
        if header and normalized_headers.count(header) > 1
    }
    if duplicate_headers:
        raise HTTPException(status_code=400, detail=f"Duplicate columns after normalization: {sorted(duplicate_headers)}")

    normalized_rows: List[Dict[str, Any]] = []
    for row in rows:
        normalized_row: Dict[str, Any] = {}
        for header, value in row.items():
            normalized_header = normalize_import_header(header)
            if normalized_header:
                normalized_row[normalized_header] = value
        normalized_rows.append(normalized_row)
    return normalized_rows


def sanitize_csv_field(value: Any) -> str:
    if not value:
        return ''
    text = str(value).replace('\x00', '')
    stripped = text.lstrip()
    if stripped.startswith(('=', '+', '-', '@')) or text.startswith(('\t', '\r', '\n')):
        return f"'{text}"
    return text


def validate_export_fields(fields: Optional[str]) -> List[str]:
    if not fields:
        return []

    field_list = [field.strip() for field in fields.split(',')]
    invalid_fields = [field for field in field_list if field not in AVAILABLE_EXPORT_FIELDS]

    if invalid_fields:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid field names: {', '.join(invalid_fields)}. Available fields: {', '.join(AVAILABLE_EXPORT_FIELDS)}",
        )

    return field_list


def normalize_text(text: str) -> str:
    if not text:
        return ""
    return re.sub(r'\s+', ' ', str(text).strip())


def normalize_multiline_text(text: str) -> str:
    if not text:
        return ""
    normalized = str(text).replace('\r\n', '\n').replace('\r', '\n').strip()
    return '\n'.join(re.sub(r'[ \t]+', ' ', line).strip() for line in normalized.split('\n'))


def normalize_priority(priority: str) -> str:
    if not priority:
        return "medium"

    priority_map = {
        'low': ['low', 'lowest', 'l', 'minor', 'trivial'],
        'medium': ['medium', 'med', 'm', 'normal', 'regular'],
        'high': ['high', 'h', 'major', 'important'],
        'critical': ['critical', 'crit', 'c', 'urgent', 'blocker'],
    }

    normalized = priority.lower().strip()
    for standard, variants in priority_map.items():
        if normalized in variants:
            return standard

    return "medium"


def normalize_test_type(test_type: str) -> str:
    if not test_type:
        return "manual"

    valid_types = {
        'manual': ['manual', 'm'],
        'automated': ['automated', 'auto', 'a'],
        'smoke': ['smoke', 's'],
        'regression': ['regression', 'reg', 'r'],
        'integration': ['integration', 'int', 'i'],
        'performance': ['performance', 'perf', 'p'],
        'security': ['security', 'sec'],
        'usability': ['usability', 'ux'],
        'compatibility': ['compatibility', 'compat'],
        'exploratory': ['exploratory', 'expl'],
    }

    normalized = test_type.lower().strip()
    for standard, variants in valid_types.items():
        if normalized in variants:
            return standard

    return "manual"


def clean_date_string(date_str: str) -> Optional[str]:
    if not date_str:
        return None

    date_formats = [
        '%Y-%m-%d',
        '%m/%d/%Y',
        '%d/%m/%Y',
        '%Y/%m/%d',
        '%d-%m-%Y',
        '%m-%d-%Y',
        '%b %d, %Y',
        '%B %d, %Y',
        '%d %b %Y',
        '%d %B %Y',
    ]

    for date_format in date_formats:
        try:
            parsed_date = datetime.strptime(date_str.strip(), date_format)
            return parsed_date.strftime('%Y-%m-%d')
        except ValueError:
            continue

    return None
