from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_
from typing import List, Dict, Any, Optional, Set
import csv
import io
import re
import json
import chardet
import asyncio
from datetime import datetime, date
from .database import get_db
from . import crud, schemas, auth, rbac
from .models import Priority, Status, CustomFieldDefinition, CustomFieldValue, CustomFieldType, TestCase, Project, User
from .security_utils import validate_file_size, validate_file_extension, MAX_CSV_IMPORT_SIZE

router = APIRouter()

# Constants for edge case handling
MAX_ROWS_PER_IMPORT = 500  # Maximum rows per import file
MAX_EXPORT_SIZE_BYTES = 50 * 1024 * 1024  # 50MB max export size
IMPORT_TIMEOUT_SECONDS = 300  # 5 minutes timeout for import
EXPORT_TIMEOUT_SECONDS = 300  # 5 minutes timeout for export
AVAILABLE_EXPORT_FIELDS = ['id', 'name', 'description', 'status', 'owner_id', 'created_at', 'updated_at']


class DataValidationError(Exception):
    """Custom exception for data validation errors"""
    pass


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


def detect_encoding(file_bytes: bytes) -> str:
    """Detect character encoding of file bytes"""
    try:
        result = chardet.detect(file_bytes)
        encoding = result['encoding'] or 'utf-8'
        # Fallback to utf-8 if confidence is low
        if result['confidence'] < 0.7:
            encoding = 'utf-8'
        return encoding
    except:
        return 'utf-8'


def validate_owner_id(db: Session, owner_id: int) -> bool:
    """Validate that owner_id references an existing user"""
    try:
        user = db.query(User).filter(User.id == owner_id).first()
        return user is not None
    except:
        return False


def validate_date_format(date_str: str) -> bool:
    """Validate ISO 8601 date format"""
    if not date_str:
        return True  # Empty dates are allowed
    try:
        # Try parsing as ISO format
        datetime.fromisoformat(date_str.replace('Z', '+00:00'))
        return True
    except:
        return False


def sanitize_csv_field(value: str) -> str:
    """Sanitize field value to prevent CSV injection"""
    if not value:
        return ''
    # Remove dangerous characters that could cause CSV injection
    value = str(value)
    # Check for CSV injection patterns
    if any(char in value for char in ['=', '+', '-', '@', '\t', '\r', '\n']):
        # Escape with quote if contains special characters
        if '"' in value:
            value = value.replace('"', '""')
        return f'"{value}"'
    return value


def validate_export_fields(fields: Optional[str]) -> List[str]:
    """Validate export field names against available fields"""
    if not fields:
        return []
    
    field_list = [f.strip() for f in fields.split(',')]
    invalid_fields = [f for f in field_list if f not in AVAILABLE_EXPORT_FIELDS]
    
    if invalid_fields:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid field names: {', '.join(invalid_fields)}. Available fields: {', '.join(AVAILABLE_EXPORT_FIELDS)}"
        )
    
    return field_list


def normalize_text(text: str) -> str:
    """Normalize text by removing extra whitespace and standardizing format"""
    if not text:
        return ""
    return re.sub(r'\s+', ' ', str(text).strip())


def normalize_priority(priority: str) -> str:
    """Normalize priority values to standard format"""
    if not priority:
        return "medium"
    
    priority_map = {
        'low': ['low', 'l', 'minor', 'trivial'],
        'medium': ['medium', 'med', 'm', 'normal', 'regular'],
        'high': ['high', 'h', 'major', 'important'],
        'critical': ['critical', 'crit', 'c', 'urgent', 'blocker']
    }
    
    normalized = priority.lower().strip()
    for standard, variants in priority_map.items():
        if normalized in variants:
            return standard
    
    return "medium"  # Default fallback


def normalize_test_type(test_type: str) -> str:
    """Normalize test type values"""
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
        'exploratory': ['exploratory', 'expl']
    }
    
    normalized = test_type.lower().strip()
    for standard, variants in valid_types.items():
        if normalized in variants:
            return standard
    
    return "manual"  # Default fallback


def clean_date_string(date_str: str) -> Optional[str]:
    """Clean and standardize date strings"""
    if not date_str:
        return None
    
    # Common date formats to try
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
        '%d %B %Y'
    ]
    
    for fmt in date_formats:
        try:
            parsed_date = datetime.strptime(date_str.strip(), fmt)
            return parsed_date.strftime('%Y-%m-%d')
        except ValueError:
            continue
    
    return None


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
    text_fields = ['title', 'description', 'preconditions', 'steps', 'expected_result', 'tags']
    for field in text_fields:
        original_value = row.get(field, '')
        cleaned_value = normalize_text(original_value)
        
        if original_value != cleaned_value:
            result.corrections_made.append(f"Row: {field} normalized from '{original_value}' to '{cleaned_value}'")
        
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
    
    result.cleaned_fields = cleaned
    return result


def validate_required_fields(row: Dict[str, Any], custom_fields: List[CustomFieldDefinition] = None) -> ValidationResult:
    """Validate required fields including custom fields"""
    result = ValidationResult()
    
    # Standard required fields
    required_fields = ['title']
    for field in required_fields:
        if not row.get(field, '').strip():
            result.missing_fields.append(f"Missing required field: {field}")
    
    # Validate custom fields if provided
    if custom_fields:
        for custom_field in custom_fields:
            field_name = custom_field.name
            field_value = row.get(field_name, '')
            
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
        if field_def.options and value_str not in field_def.options:
            return f"Invalid option for field '{field_def.name}': {value_str}. Valid options: {field_def.options}"
    
    elif field_def.field_type == CustomFieldType.MULTISELECT:
        if field_def.options:
            selected_values = [v.strip() for v in value_str.split(',') if v.strip()]
            invalid_values = [v for v in selected_values if v not in field_def.options]
            if invalid_values:
                return f"Invalid options for field '{field_def.name}': {invalid_values}. Valid options: {field_def.options}"
    
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


@router.post("/import/test-cases/")
async def import_test_cases(
    file: UploadFile = File(...),
    test_suite_id: Optional[int] = Form(None),
    section_id: Optional[int] = Form(None),  # Add default section for all imported test cases
    skip_duplicates: Optional[bool] = Form(True),  # Skip duplicate entries
    apply_corrections: Optional[bool] = Form(True),  # Apply automatic data corrections
    validate_custom_fields: Optional[bool] = Form(True),  # Validate custom fields
    db: Session = Depends(get_db)
):
    # Validate file extension
    validate_file_extension(file.filename, ['.csv'], "Import file")
    
    # Validate file size
    contents = await validate_file_size(file, MAX_CSV_IMPORT_SIZE, "CSV file")
    
    # Validate test_suite_id
    if test_suite_id is None:
        raise HTTPException(status_code=400, detail="test_suite_id is required")
    
    try:
        
        # Read CSV file
        csv_reader = csv.DictReader(io.StringIO(contents.decode('utf-8')))
        rows = list(csv_reader)
        
        if not rows:
            raise HTTPException(status_code=400, detail="File is empty")
        
        # Validate required columns
        required_columns = ['title']
        missing_columns = [col for col in required_columns if col not in rows[0]]
        if missing_columns:
            raise HTTPException(status_code=400, detail=f"Missing required columns: {missing_columns}")
        
        # Get project ID for custom field validation
        test_suite = db.query(TestCase).filter(TestCase.id == test_suite_id).first()
        if not test_suite:
            raise HTTPException(status_code=404, detail="Test suite not found")
        
        project_id = test_suite.project_id if test_suite else None
        custom_fields = []
        if project_id and validate_custom_fields:
            custom_fields = get_custom_fields_for_project(db, project_id)
        
        # Ensure default priority and test type definitions exist if they are blank in the DB
        # Use a default user ID (e.g., 1) since imports might not have a current user context
        from . import crud
        crud.ensure_default_priority_and_test_type_definitions(db, created_by=1)
        
        # Step 1: Apply bulk corrections if enabled
        if apply_corrections:
            rows = apply_bulk_corrections(rows)
        
        # Step 2: Detect duplicates
        duplicate_detection = detect_duplicates(db, rows, test_suite_id)
        
        # Step 3: Process rows with enhanced validation and cleaning
        imported_count = 0
        skipped_count = 0
        errors = []
        warnings = []
        corrections = []
        duplicate_rows = set()
        
        # Collect duplicate row numbers to skip
        if skip_duplicates:
            for dup in duplicate_detection.duplicates_by_title:
                duplicate_rows.add(dup['row'])
                warnings.append(f"Row {dup['row']}: Skipped duplicate title '{dup['title']}' (existing ID: {dup['existing_id']})")
            
            for dup in duplicate_detection.duplicates_by_id:
                duplicate_rows.add(dup['row'])
                warnings.append(f"Row {dup['row']}: Skipped duplicate ID '{dup['id']}' (existing title: '{dup['existing_title']}')")
            
            # Handle duplicates within import file
            for dup in duplicate_detection.duplicates_by_title:
                if dup.get('action') == 'duplicate_in_import':
                    duplicate_rows.add(dup['row'])
                    warnings.append(f"Row {dup['row']}: Skipped duplicate within import file (first occurrence at row {dup['duplicate_row']})")
        
        for index, row in enumerate(rows):
            row_num = index + 2  # +2 for header and 0-based index
            
            # Skip duplicates if enabled
            if skip_duplicates and row_num in duplicate_rows:
                skipped_count += 1
                continue
            
            try:
                # Step 4: Clean data
                cleaning_result = clean_data(row)
                if cleaning_result.corrections_made:
                    corrections.extend([f"Row {row_num}: {correction}" for correction in cleaning_result.corrections_made])
                
                if cleaning_result.unfixable_issues:
                    errors.extend([f"Row {row_num}: {issue}" for issue in cleaning_result.unfixable_issues])
                    continue
                
                # Use cleaned data
                cleaned_data = cleaning_result.cleaned_fields
                
                # Step 5: Validate required fields
                validation_result = validate_required_fields(cleaned_data, custom_fields)
                
                if validation_result.missing_fields:
                    errors.append(f"Row {row_num}: {'; '.join(validation_result.missing_fields)}")
                    continue
                
                if validation_result.invalid_fields:
                    errors.append(f"Row {row_num}: {'; '.join(validation_result.invalid_fields)}")
                    continue
                
                if validation_result.custom_field_errors:
                    errors.append(f"Row {row_num}: {'; '.join(validation_result.custom_field_errors)}")
                    continue
                
                # Step 6: Build test case data with cleaned values
                test_case_data = {
                    'title': cleaned_data['title'],
                    'description': cleaned_data.get('description'),
                    'preconditions': cleaned_data.get('preconditions', ''),
                    'steps': cleaned_data.get('steps', ''),
                    'expected_result': cleaned_data.get('expected_result', ''),
                    'priority': cleaned_data.get('priority', 'medium'),
                    'status': 'active',
                    'tags': cleaned_data.get('tags'),
                    'test_suite_id': test_suite_id,
                    'test_type': cleaned_data.get('test_type', 'manual'),
                    'section_id': cleaned_data.get('section_id') or section_id,
                    'order_index': cleaned_data.get('order_index') or 0,
                    'is_multistep': cleaned_data.get('is_multistep', False)
                }
                
                # Step 7: Create test case with required creator
                created_case = crud.create_test_case(db=db, test_case=schemas.TestCaseCreate(**test_case_data), created_by=1)
                
                # Step 8: Handle multistep data if present
                multistep_data = cleaned_data.get('multistep_data')
                if test_case_data['is_multistep'] and multistep_data:
                    try:
                        # Parse multistep data from JSON string
                        steps_data = json.loads(multistep_data)
                        if isinstance(steps_data, list):
                            for step_data in steps_data:
                                step_create_data = {
                                    'test_case_id': created_case.id,
                                    'step_number': step_data.get('step_number', 1),
                                    'action': step_data.get('action', ''),
                                    'expected_result': step_data.get('expected_result', ''),
                                    'step_type': step_data.get('step_type', 'manual')
                                }
                                crud.create_test_case_step(db=db, step=schemas.TestCaseStepCreate(**step_create_data))
                    except (json.JSONDecodeError, KeyError, ValueError) as e:
                        # Log error but don't fail the import
                        print(f"Warning: Failed to parse multistep data for test case {created_case.id}: {e}")
                
                # Step 9: Handle custom fields if present
                if custom_fields and validate_custom_fields:
                    for custom_field in custom_fields:
                        field_name = custom_field.name
                        field_value = cleaned_data.get(field_name, '')
                        
                        if field_value:
                            # Transform value based on field type
                            transformed_value = transform_custom_field_value(field_value, custom_field)
                            
                            # Create custom field value
                            custom_field_value = CustomFieldValue(
                                field_definition_id=custom_field.id,
                                test_case_id=created_case.id,
                                value=transformed_value
                            )
                            db.add(custom_field_value)
                    
                    db.commit()
                
                imported_count += 1
                
            except Exception as e:
                errors.append(f"Row {row_num}: {str(e)}")
        
        # Build comprehensive response
        message_parts = [f"Successfully imported {imported_count} test cases"]
        if skipped_count > 0:
            message_parts.append(f"{skipped_count} rows skipped (duplicates)")
        if errors:
            message_parts.append(f"{len(errors)} errors")
        if corrections:
            message_parts.append(f"{len(corrections)} automatic corrections applied")
        
        return {
            "message": ", ".join(message_parts),
            "errors": errors,
            "warnings": warnings,
            "corrections": corrections,
            "total_rows": len(rows),
            "imported_rows": imported_count,
            "skipped_rows": skipped_count,
            "error_rows": len(errors),
            "correction_rows": len(corrections),
            "duplicate_detection": {
                "duplicates_by_title": len(duplicate_detection.duplicates_by_title),
                "duplicates_by_id": len(duplicate_detection.duplicates_by_id),
                "potential_duplicates": len(duplicate_detection.potential_duplicates)
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing file: {str(e)}")


@router.get("/export/test-cases/")
def export_test_cases(
    test_suite_id: int = None,
    format: str = "csv",
    db: Session = Depends(get_db)
):
    if format.lower() != "csv":
        raise HTTPException(status_code=400, detail="Only CSV format is supported")
    
    test_cases = crud.get_test_cases(db, test_suite_id=test_suite_id)
    
    # Prepare data for CSV export with enhanced fields including multistep support
    fieldnames = [
        'id', 'title', 'description', 'test_type', 'preconditions', 'steps', 'expected_result',
        'priority', 'status', 'tags', 'test_suite_id', 'section_id', 'order_index',
        'is_multistep', 'multistep_data', 'created_at', 'updated_at'
    ]
    
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    
    for test_case in test_cases:
        # Get multistep data if applicable
        multistep_data = ""
        if test_case.is_multistep:
            # Fetch steps for multistep test cases
            steps = crud.get_test_case_steps(db, test_case.id)
            if steps:
                # Format multistep data as JSON string for CSV
                multistep_data = json.dumps([
                    {
                        'step_number': step.step_number,
                        'action': step.action,
                        'expected_result': step.expected_result,
                        'step_type': step.step_type
                    }
                    for step in steps
                ])
        
        writer.writerow({
            'id': test_case.id,
            'title': test_case.title,
            'description': test_case.description or '',
            'test_type': test_case.test_type or 'manual',
            'preconditions': test_case.preconditions or '',
            'steps': test_case.steps or '',
            'expected_result': test_case.expected_result or '',
            'priority': test_case.priority or 'medium',
            'status': test_case.status or 'active',
            'tags': test_case.tags or '',
            'test_suite_id': test_case.test_suite_id,
            'section_id': test_case.section_id or '',
            'order_index': test_case.order_index or 0,
            'is_multistep': getattr(test_case, 'is_multistep', False),
            'multistep_data': multistep_data,
            'created_at': test_case.created_at,
            'updated_at': test_case.updated_at or ''
        })
    
    return {
        "filename": "test_cases.csv",
        "content": output.getvalue(),
        "media_type": "text/csv"
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
    db: Session = Depends(get_db)
):
    """Validate import file without actually importing data"""
    # Validate file extension
    validate_file_extension(file.filename, ['.csv'], "Import file")
    
    # Validate file size
    contents = await validate_file_size(file, MAX_CSV_IMPORT_SIZE, "CSV file")
    
    try:
        csv_reader = csv.DictReader(io.StringIO(contents.decode('utf-8')))
        rows = list(csv_reader)
        
        if not rows:
            raise HTTPException(status_code=400, detail="File is empty")
        
        # Get project and custom fields
        from .crud import get_test_suite  # Import the function
        test_suite = get_test_suite(db, test_suite_id)
        if not test_suite:
            raise HTTPException(status_code=404, detail="Test suite not found")
        
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
            
            # Clean data
            cleaning_result = clean_data(row)
            if cleaning_result.corrections_made:
                corrections.extend([f"Row {row_num}: {correction}" for correction in cleaning_result.corrections_made])
            
            cleaned_data = cleaning_result.cleaned_fields
            
            # Validate
            validation_result = validate_required_fields(cleaned_data, custom_fields)
            
            if validation_result.missing_fields:
                validation_errors.append(f"Row {row_num}: {'; '.join(validation_result.missing_fields)}")
            
            if validation_result.invalid_fields:
                validation_errors.append(f"Row {row_num}: {'; '.join(validation_result.invalid_fields)}")
            
            if validation_result.custom_field_errors:
                validation_errors.append(f"Row {row_num}: {'; '.join(validation_result.custom_field_errors)}")
            
            if not (validation_result.missing_fields or validation_result.invalid_fields or validation_result.custom_field_errors):
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
            sample_data[custom_field.name] = custom_field.options[0] if custom_field.options else ''
        elif custom_field.field_type == CustomFieldType.MULTISELECT:
            sample_data[custom_field.name] = ', '.join(custom_field.options[:2]) if custom_field.options else ''
    
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
    # Get projects to export
    query = db.query(Project)
    
    # Apply status filter
    if status_filter:
        try:
            from .models import ProjectStatus
            status_enum = ProjectStatus(status_filter.lower())
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
    db: Session = Depends(get_db),
    current_user: schemas.User = Depends(auth.get_current_active_user)
):
    """
    Import project(s) from JSON or CSV file
    Only accessible by admin and manager roles
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
        except:
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
    
    # Wrap import in timeout
    try:
        result = await asyncio.wait_for(
            _perform_import(
                projects_data, file.filename, merge_strategy, partial_import, db, current_user
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
    current_user: schemas.User
) -> dict:
    """Perform the actual import operation (wrapped in timeout)"""
    imported_count = 0
    updated_count = 0
    skipped_count = 0
    errors = []
    successful_imports = []
    failed_imports = []
    
    # Only CSV supports basic project info only
    if filename.endswith('.csv'):
        # CSV import - basic project info only
        for index, project_data in enumerate(projects_data):
            row_num = index + 1
            
            try:
                project_name = project_data.get('name', '').strip()
                project_description = project_data.get('description', '')
                project_status = project_data.get('status', 'active')
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
            
            try:
                project_name = project_data.get('name', '').strip()
                project_description = project_data.get('description', '')
                project_status = project_data.get('status', 'active')
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
                            crud.create_custom_field_definition(
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
                                            created_by=1
                                        )
                                        
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
                                        
                                        # Import custom field values
                                        if 'custom_field_values' in tc_data:
                                            for cfv_data in tc_data['custom_field_values']:
                                                try:
                                                    db.add(CustomFieldValue(
                                                        field_definition_id=cfv_data['field_definition_id'],
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
                            
                            # Import test results
                            if 'test_results' in tr_data:
                                for result_data in tr_data['test_results']:
                                    try:
                                        # Map test case ID from export to new test case ID
                                        # This is simplified - in production, you'd need a mapping
                                        test_case_id = result_data.get('test_case_id')
                                        
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
        except:
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
            "invalid_rows": len(validation_errors),
            "errors": validation_errors,
            "warnings": validation_warnings,
            "preview_data": preview_data,
            "conflicts": conflicts
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error validating file: {str(e)}")
