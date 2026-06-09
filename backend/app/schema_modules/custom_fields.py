from pydantic import AliasChoices, BaseModel, EmailStr, field_validator, HttpUrl, model_validator, Field
from typing import List, Optional, Dict, Any, Union
from datetime import datetime
from ..models import Priority, Status, TestStatus, ResultStatus, Role, Permission, CustomFieldType, TestType, RecycleBinType, RequirementStatus, DefectStatus, DefectSeverity, DefectPriority, DefectLinkType, MilestoneStatus, NotificationType, StepCategory, StepComplexity, DocStatus
import re
import html

from .versioning import (
    DateValidationRules,
    NumberValidationRules,
    SelectValidationRules,
    TestCaseVersionBase,
    TestCaseVersionCreate,
    TestCaseVersionUpdate,
    TextValidationRules,
    VersionComparisonBase,
    VersionComparisonCreate,
    VersionLockBase,
    VersionLockCreate,
    VersionTagBase,
    VersionTagCreate,
)
from ..services.webhook_security import normalize_webhook_url

from .core import *

class CustomFieldDefinitionBase(BaseModel):
    name: str
    slug: Optional[str] = None
    field_type: CustomFieldType
    description: Optional[str] = None
    is_required: bool = False
    default_value: Optional[str] = None
    options: Optional[Union[List[str], Dict[str, Any]]] = None
    validation_rules: Optional[Dict[str, Any]] = None
    # Which entities this field applies to. None => legacy behavior (test_case
    # only). Valid keys: "test_case", "test_run", "defect", "requirement".
    entity_types: Optional[List[str]] = None

    @field_validator("entity_types")
    @classmethod
    def _validate_entity_types(cls, value):
        if value is None:
            return value
        allowed = {"test_case", "test_run", "defect", "requirement"}
        cleaned: List[str] = []
        seen: set = set()
        for raw in value:
            if not isinstance(raw, str):
                continue
            key = raw.strip().lower()
            if key in allowed and key not in seen:
                seen.add(key)
                cleaned.append(key)
        if not cleaned:
            raise ValueError(
                "entity_types must contain at least one of: test_case, test_run, defect, requirement"
            )
        return cleaned

    @model_validator(mode='before')
    @classmethod
    def sanitize_html(cls, data):
        """Sanitize HTML in string fields to prevent XSS attacks"""
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, str) and key not in ['field_type']:
                    data[key] = html.escape(value)
                elif isinstance(value, list) and key == 'options':
                    # Sanitize strings in options array
                    data[key] = [html.escape(item) if isinstance(item, str) else item for item in value]
        return data

    @model_validator(mode='after')
    def validate_options(self):
        if self.options and self.field_type in [CustomFieldType.SELECT, CustomFieldType.MULTISELECT]:
            # If options is a dict with 'values' key, extract the array (legacy support)
            if isinstance(self.options, dict):
                if 'values' in self.options and isinstance(self.options['values'], list):
                    self.options = self.options['values']
                else:
                    raise ValueError("Options for select/multiselect must be an array or a dict with 'values' key")
            elif not isinstance(self.options, list):
                raise ValueError("Options for select/multiselect must be an array")
        return self

    @model_validator(mode='after')
    def validate_validation_rules(self):
        if self.validation_rules and self.field_type:
            field_type = self.field_type
            rules = self.validation_rules
            
            # Validate rules based on field type
            if field_type == CustomFieldType.TEXT:
                self._validate_text_rules(rules)
            elif field_type == CustomFieldType.NUMBER:
                self._validate_number_rules(rules)
            elif field_type == CustomFieldType.DATE:
                self._validate_date_rules(rules)
            elif field_type in [CustomFieldType.SELECT, CustomFieldType.MULTISELECT]:
                self._validate_select_rules(rules)
            elif field_type == CustomFieldType.BOOLEAN:
                if rules:
                    raise ValueError("Boolean fields do not support validation rules")
        
        return self
    
    def _validate_text_rules(self, rules: Dict[str, Any]):
        """Validate text field validation rules"""
        valid_keys = {'min_length', 'max_length', 'regex_pattern'}
        invalid_keys = set(rules.keys()) - valid_keys
        if invalid_keys:
            raise ValueError(f"Invalid validation rules for text field: {invalid_keys}. Valid keys: {valid_keys}")
        
        if 'min_length' in rules:
            if not isinstance(rules['min_length'], int) or rules['min_length'] < 0:
                raise ValueError("min_length must be a non-negative integer")
        
        if 'max_length' in rules:
            if not isinstance(rules['max_length'], int) or rules['max_length'] < 0:
                raise ValueError("max_length must be a non-negative integer")
        
        if 'min_length' in rules and 'max_length' in rules:
            if rules['min_length'] > rules['max_length']:
                raise ValueError("min_length cannot be greater than max_length")
        
        if 'regex_pattern' in rules:
            if not isinstance(rules['regex_pattern'], str):
                raise ValueError("regex_pattern must be a string")
            try:
                re.compile(rules['regex_pattern'])
            except re.error as e:
                raise ValueError(f"Invalid regex pattern: {str(e)}")
    
    def _validate_number_rules(self, rules: Dict[str, Any]):
        """Validate number field validation rules"""
        valid_keys = {'min_value', 'max_value', 'integer_only'}
        invalid_keys = set(rules.keys()) - valid_keys
        if invalid_keys:
            raise ValueError(f"Invalid validation rules for number field: {invalid_keys}. Valid keys: {valid_keys}")
        
        if 'min_value' in rules:
            if not isinstance(rules['min_value'], (int, float)):
                raise ValueError("min_value must be a number")
        
        if 'max_value' in rules:
            if not isinstance(rules['max_value'], (int, float)):
                raise ValueError("max_value must be a number")
        
        if 'min_value' in rules and 'max_value' in rules:
            if rules['min_value'] > rules['max_value']:
                raise ValueError("min_value cannot be greater than max_value")
        
        if 'integer_only' in rules:
            if not isinstance(rules['integer_only'], bool):
                raise ValueError("integer_only must be a boolean")
    
    def _validate_date_rules(self, rules: Dict[str, Any]):
        """Validate date field validation rules"""
        valid_keys = {'min_date', 'max_date', 'future_only', 'past_only'}
        invalid_keys = set(rules.keys()) - valid_keys
        if invalid_keys:
            raise ValueError(f"Invalid validation rules for date field: {invalid_keys}. Valid keys: {valid_keys}")
        
        if 'min_date' in rules:
            if not isinstance(rules['min_date'], str):
                raise ValueError("min_date must be a string in ISO format")
            try:
                datetime.fromisoformat(rules['min_date'])
            except ValueError:
                raise ValueError("min_date must be in ISO format (YYYY-MM-DD)")
        
        if 'max_date' in rules:
            if not isinstance(rules['max_date'], str):
                raise ValueError("max_date must be a string in ISO format")
            try:
                datetime.fromisoformat(rules['max_date'])
            except ValueError:
                raise ValueError("max_date must be in ISO format (YYYY-MM-DD)")
        
        if 'min_date' in rules and 'max_date' in rules:
            if datetime.fromisoformat(rules['min_date']) > datetime.fromisoformat(rules['max_date']):
                raise ValueError("min_date cannot be greater than max_date")
        
        if 'future_only' in rules and 'past_only' in rules:
            if rules['future_only'] and rules['past_only']:
                raise ValueError("Cannot specify both future_only and past_only")
        
        if 'future_only' in rules:
            if not isinstance(rules['future_only'], bool):
                raise ValueError("future_only must be a boolean")
        
        if 'past_only' in rules:
            if not isinstance(rules['past_only'], bool):
                raise ValueError("past_only must be a boolean")
    
    def _validate_select_rules(self, rules: Dict[str, Any]):
        """Validate select/multiselect field validation rules"""
        valid_keys = {'min_length', 'max_length'}
        invalid_keys = set(rules.keys()) - valid_keys
        if invalid_keys:
            raise ValueError(f"Invalid validation rules for select field: {invalid_keys}. Valid keys: {valid_keys}")
        
        if 'min_length' in rules:
            if not isinstance(rules['min_length'], int) or rules['min_length'] < 0:
                raise ValueError("min_length must be a non-negative integer")
        
        if 'max_length' in rules:
            if not isinstance(rules['max_length'], int) or rules['max_length'] < 0:
                raise ValueError("max_length must be a non-negative integer")
        
        if 'min_length' in rules and 'max_length' in rules:
            if rules['min_length'] > rules['max_length']:
                raise ValueError("min_length cannot be greater than max_length")


class CustomFieldDefinitionCreate(CustomFieldDefinitionBase):
    project_id: int


class CustomFieldDefinitionUpdate(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    field_type: Optional[CustomFieldType] = None
    description: Optional[str] = None
    is_required: Optional[bool] = None
    default_value: Optional[str] = None
    options: Optional[Union[List[str], Dict[str, Any]]] = None
    validation_rules: Optional[Dict[str, Any]] = None
    entity_types: Optional[List[str]] = None

    @field_validator("entity_types")
    @classmethod
    def _validate_entity_types(cls, value):
        if value is None:
            return value
        allowed = {"test_case", "test_run", "defect", "requirement"}
        cleaned: List[str] = []
        seen: set = set()
        for raw in value:
            if not isinstance(raw, str):
                continue
            key = raw.strip().lower()
            if key in allowed and key not in seen:
                seen.add(key)
                cleaned.append(key)
        if not cleaned:
            raise ValueError(
                "entity_types must contain at least one of: test_case, test_run, defect, requirement"
            )
        return cleaned

    @model_validator(mode='before')
    @classmethod
    def sanitize_html(cls, data):
        """Sanitize HTML in string fields to prevent XSS attacks"""
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, str) and key not in ['field_type']:
                    data[key] = html.escape(value)
                elif isinstance(value, list) and key == 'options':
                    # Sanitize strings in options array
                    data[key] = [html.escape(item) if isinstance(item, str) else item for item in value]
        return data

    @model_validator(mode='after')
    def validate_options(self):
        if self.options and self.field_type in [CustomFieldType.SELECT, CustomFieldType.MULTISELECT]:
            # If options is a dict with 'values' key, extract the array (legacy support)
            if isinstance(self.options, dict):
                if 'values' in self.options and isinstance(self.options['values'], list):
                    self.options = self.options['values']
                else:
                    raise ValueError("Options for select/multiselect must be an array or a dict with 'values' key")
            elif not isinstance(self.options, list):
                raise ValueError("Options for select/multiselect must be an array")
        return self

    @model_validator(mode='after')
    def validate_validation_rules(self):
        if self.validation_rules and self.field_type:
            field_type = self.field_type
            rules = self.validation_rules
            
            # Validate rules based on field type
            if field_type == CustomFieldType.TEXT:
                self._validate_text_rules(rules)
            elif field_type == CustomFieldType.NUMBER:
                self._validate_number_rules(rules)
            elif field_type == CustomFieldType.DATE:
                self._validate_date_rules(rules)
            elif field_type in [CustomFieldType.SELECT, CustomFieldType.MULTISELECT]:
                self._validate_select_rules(rules)
            elif field_type == CustomFieldType.BOOLEAN:
                if rules:
                    raise ValueError("Boolean fields do not support validation rules")
        
        return self
    
    def _validate_text_rules(self, rules: Dict[str, Any]):
        """Validate text field validation rules"""
        valid_keys = {'min_length', 'max_length', 'regex_pattern'}
        invalid_keys = set(rules.keys()) - valid_keys
        if invalid_keys:
            raise ValueError(f"Invalid validation rules for text field: {invalid_keys}. Valid keys: {valid_keys}")
        
        if 'min_length' in rules:
            if not isinstance(rules['min_length'], int) or rules['min_length'] < 0:
                raise ValueError("min_length must be a non-negative integer")
        
        if 'max_length' in rules:
            if not isinstance(rules['max_length'], int) or rules['max_length'] < 0:
                raise ValueError("max_length must be a non-negative integer")
        
        if 'min_length' in rules and 'max_length' in rules:
            if rules['min_length'] > rules['max_length']:
                raise ValueError("min_length cannot be greater than max_length")
        
        if 'regex_pattern' in rules:
            if not isinstance(rules['regex_pattern'], str):
                raise ValueError("regex_pattern must be a string")
            try:
                re.compile(rules['regex_pattern'])
            except re.error as e:
                raise ValueError(f"Invalid regex pattern: {str(e)}")
    
    def _validate_number_rules(self, rules: Dict[str, Any]):
        """Validate number field validation rules"""
        valid_keys = {'min_value', 'max_value', 'integer_only'}
        invalid_keys = set(rules.keys()) - valid_keys
        if invalid_keys:
            raise ValueError(f"Invalid validation rules for number field: {invalid_keys}. Valid keys: {valid_keys}")
        
        if 'min_value' in rules:
            if not isinstance(rules['min_value'], (int, float)):
                raise ValueError("min_value must be a number")
        
        if 'max_value' in rules:
            if not isinstance(rules['max_value'], (int, float)):
                raise ValueError("max_value must be a number")
        
        if 'min_value' in rules and 'max_value' in rules:
            if rules['min_value'] > rules['max_value']:
                raise ValueError("min_value cannot be greater than max_value")
        
        if 'integer_only' in rules:
            if not isinstance(rules['integer_only'], bool):
                raise ValueError("integer_only must be a boolean")
    
    def _validate_date_rules(self, rules: Dict[str, Any]):
        """Validate date field validation rules"""
        valid_keys = {'min_date', 'max_date', 'future_only', 'past_only'}
        invalid_keys = set(rules.keys()) - valid_keys
        if invalid_keys:
            raise ValueError(f"Invalid validation rules for date field: {invalid_keys}. Valid keys: {valid_keys}")
        
        if 'min_date' in rules:
            if not isinstance(rules['min_date'], str):
                raise ValueError("min_date must be a string in ISO format")
            try:
                datetime.fromisoformat(rules['min_date'])
            except ValueError:
                raise ValueError("min_date must be in ISO format (YYYY-MM-DD)")
        
        if 'max_date' in rules:
            if not isinstance(rules['max_date'], str):
                raise ValueError("max_date must be a string in ISO format")
            try:
                datetime.fromisoformat(rules['max_date'])
            except ValueError:
                raise ValueError("max_date must be in ISO format (YYYY-MM-DD)")
        
        if 'min_date' in rules and 'max_date' in rules:
            if datetime.fromisoformat(rules['min_date']) > datetime.fromisoformat(rules['max_date']):
                raise ValueError("min_date cannot be greater than max_date")
        
        if 'future_only' in rules and 'past_only' in rules:
            if rules['future_only'] and rules['past_only']:
                raise ValueError("Cannot specify both future_only and past_only")
        
        if 'future_only' in rules:
            if not isinstance(rules['future_only'], bool):
                raise ValueError("future_only must be a boolean")
        
        if 'past_only' in rules:
            if not isinstance(rules['past_only'], bool):
                raise ValueError("past_only must be a boolean")
    
    def _validate_select_rules(self, rules: Dict[str, Any]):
        """Validate select/multiselect field validation rules"""
        valid_keys = {'min_length', 'max_length'}
        invalid_keys = set(rules.keys()) - valid_keys
        if invalid_keys:
            raise ValueError(f"Invalid validation rules for select field: {invalid_keys}. Valid keys: {valid_keys}")
        
        if 'min_length' in rules:
            if not isinstance(rules['min_length'], int) or rules['min_length'] < 0:
                raise ValueError("min_length must be a non-negative integer")
        
        if 'max_length' in rules:
            if not isinstance(rules['max_length'], int) or rules['max_length'] < 0:
                raise ValueError("max_length must be a non-negative integer")
        
        if 'min_length' in rules and 'max_length' in rules:
            if rules['min_length'] > rules['max_length']:
                raise ValueError("min_length cannot be greater than max_length")


class CustomFieldDefinition(CustomFieldDefinitionBase):
    id: int
    project_seq: Optional[int] = None  # per-project sequence (URLs/badges)
    project_id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class CustomFieldValueBase(BaseModel):
    field_definition_id: int
    # Polymorphic ownership. Exactly one of these four ids must be set —
    # enforced in CustomFieldValueCreate's validator below. The base form
    # leaves them all optional so callers reading existing rows don't see a
    # value field disappear when ownership moves between entity types.
    test_case_id: Optional[int] = None
    test_run_id: Optional[int] = None
    defect_id: Optional[int] = None
    requirement_id: Optional[int] = None
    value: Optional[str] = None

    @model_validator(mode='before')
    @classmethod
    def sanitize_html(cls, data):
        """Sanitize HTML in string fields to prevent XSS attacks"""
        if isinstance(data, dict):
            for key, val in data.items():
                if isinstance(val, str):
                    data[key] = html.escape(val)
        return data


class CustomFieldValueCreate(CustomFieldValueBase):
    @model_validator(mode='after')
    def _require_exactly_one_owner(self):
        owners = [self.test_case_id, self.test_run_id, self.defect_id, self.requirement_id]
        set_count = sum(1 for owner in owners if owner is not None)
        if set_count == 0:
            raise ValueError("Exactly one of test_case_id, test_run_id, defect_id, requirement_id is required")
        if set_count > 1:
            raise ValueError("Only one entity owner may be set per custom field value")
        return self


class CustomFieldValueUpdate(BaseModel):
    value: Optional[str] = None

    @model_validator(mode='before')
    @classmethod
    def sanitize_html(cls, data):
        if isinstance(data, dict):
            for key, val in data.items():
                if isinstance(val, str):
                    data[key] = html.escape(val)
        return data


class CustomFieldValue(CustomFieldValueBase):
    id: int
    # Echoed read-only properties so the API caller can branch on what kind
    # of entity this value belongs to without inspecting four nullable FKs.
    entity_type: Optional[str] = None
    entity_id: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class TestCaseWithCustomFields(TestCase):
    custom_field_values: List[CustomFieldValue] = []


class CustomFieldDefinitionWithValues(CustomFieldDefinition):
    values: List[CustomFieldValue] = []
