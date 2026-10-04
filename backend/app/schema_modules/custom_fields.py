from pydantic import AliasChoices, BaseModel, EmailStr, field_validator, HttpUrl, model_validator, Field
from typing import List, Optional, Dict, Any, Union
from datetime import datetime
from ..models import Priority, Status, TestStatus, ResultStatus, Role, Permission, CustomFieldType, CUSTOM_FIELD_ENTITY_TYPES, TestType, RecycleBinType, RequirementStatus, DefectStatus, DefectSeverity, DefectPriority, DefectLinkType, MilestoneStatus, NotificationType, StepCategory, StepComplexity, DocStatus
import re

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

def normalize_entity_types(value: Optional[List[str]]) -> Optional[List[str]]:
    """Lower-case, de-duplicate and filter to the supported entity keys."""
    if value is None:
        return value
    allowed = set(CUSTOM_FIELD_ENTITY_TYPES)
    cleaned: List[str] = []
    for raw in value:
        if not isinstance(raw, str):
            continue
        key = raw.strip().lower()
        if key in allowed and key not in cleaned:
            cleaned.append(key)
    if not cleaned:
        raise ValueError(
            "entity_types must contain at least one of: "
            + ", ".join(CUSTOM_FIELD_ENTITY_TYPES)
        )
    return cleaned


def normalize_options(field_type, options):
    """Coerce legacy ``{"values": [...]}`` option payloads to a plain list.

    Ponytail: select/multiselect option length limits are interpreted as a
    *selection count* by :func:`app.crud.validate_custom_field_value`, so the
    rule keys stay named ``min_length``/``max_length`` for backwards compat.
    """
    if not options or field_type not in (CustomFieldType.SELECT, CustomFieldType.MULTISELECT):
        return options
    if isinstance(options, dict):
        if isinstance(options.get('values'), list):
            return options['values']
        raise ValueError("Options for select/multiselect must be an array or a dict with 'values' key")
    if not isinstance(options, list):
        raise ValueError("Options for select/multiselect must be an array")
    return options


def _validate_length_rules(rules: Dict[str, Any]) -> None:
    for key in ('min_length', 'max_length'):
        if key in rules and (not isinstance(rules[key], int) or isinstance(rules[key], bool) or rules[key] < 0):
            raise ValueError(f"{key} must be a non-negative integer")
    if 'min_length' in rules and 'max_length' in rules and rules['min_length'] > rules['max_length']:
        raise ValueError("min_length cannot be greater than max_length")


def _reject_unknown_rules(rules: Dict[str, Any], valid_keys: set, label: str) -> None:
    invalid_keys = set(rules.keys()) - valid_keys
    if invalid_keys:
        raise ValueError(
            f"Invalid validation rules for {label} field: {invalid_keys}. Valid keys: {valid_keys}"
        )


def _validate_text_rules(rules: Dict[str, Any]) -> None:
    _reject_unknown_rules(rules, {'min_length', 'max_length', 'regex_pattern'}, 'text')
    _validate_length_rules(rules)
    if 'regex_pattern' in rules:
        if not isinstance(rules['regex_pattern'], str):
            raise ValueError("regex_pattern must be a string")
        try:
            re.compile(rules['regex_pattern'])
        except re.error as exc:
            raise ValueError(f"Invalid regex pattern: {exc}")


def _validate_number_rules(rules: Dict[str, Any]) -> None:
    _reject_unknown_rules(rules, {'min_value', 'max_value', 'integer_only'}, 'number')
    for key in ('min_value', 'max_value'):
        if key in rules and (
            not isinstance(rules[key], (int, float)) or isinstance(rules[key], bool)
        ):
            raise ValueError(f"{key} must be a number")
    if 'min_value' in rules and 'max_value' in rules and rules['min_value'] > rules['max_value']:
        raise ValueError("min_value cannot be greater than max_value")
    if 'integer_only' in rules and not isinstance(rules['integer_only'], bool):
        raise ValueError("integer_only must be a boolean")


def _validate_date_rules(rules: Dict[str, Any]) -> None:
    _reject_unknown_rules(rules, {'min_date', 'max_date', 'future_only', 'past_only'}, 'date')
    parsed = {}
    for key in ('min_date', 'max_date'):
        if key not in rules:
            continue
        if not isinstance(rules[key], str):
            raise ValueError(f"{key} must be a string in ISO format")
        try:
            parsed[key] = datetime.fromisoformat(rules[key])
        except ValueError:
            raise ValueError(f"{key} must be in ISO format (YYYY-MM-DD)")
    if 'min_date' in parsed and 'max_date' in parsed and parsed['min_date'] > parsed['max_date']:
        raise ValueError("min_date cannot be greater than max_date")
    if rules.get('future_only') and rules.get('past_only'):
        raise ValueError("Cannot specify both future_only and past_only")
    for key in ('future_only', 'past_only'):
        if key in rules and not isinstance(rules[key], bool):
            raise ValueError(f"{key} must be a boolean")


def _validate_select_rules(rules: Dict[str, Any]) -> None:
    _reject_unknown_rules(rules, {'min_length', 'max_length'}, 'select')
    _validate_length_rules(rules)


def validate_rules_for_field_type(field_type, rules: Optional[Dict[str, Any]]) -> None:
    """Validate a rule set against a field type.

    Exposed at module level so the CRUD layer can validate the *merged* state of
    a partial update (where the payload may carry rules without a ``field_type``).
    """
    if not rules or not field_type:
        return
    if field_type == CustomFieldType.TEXT:
        _validate_text_rules(rules)
    elif field_type == CustomFieldType.NUMBER:
        _validate_number_rules(rules)
    elif field_type == CustomFieldType.DATE:
        _validate_date_rules(rules)
    elif field_type in (CustomFieldType.SELECT, CustomFieldType.MULTISELECT):
        _validate_select_rules(rules)
    elif field_type == CustomFieldType.BOOLEAN and rules:
        raise ValueError("Boolean fields do not support validation rules")


class CustomFieldDefinitionValidationMixin:
    """Shared validators for the create and update definition payloads.

    Both payloads carry the same constrained fields, so the rules live here
    once instead of being copy-pasted between the two models.
    """

    @field_validator("entity_types")
    @classmethod
    def _validate_entity_types(cls, value):
        return normalize_entity_types(value)

    @model_validator(mode='after')
    def validate_options(self):
        # On a partial update ``field_type`` is None; the merged state is
        # re-validated by the CRUD layer before it is written.
        self.options = normalize_options(self.field_type, self.options)
        return self

    @model_validator(mode='after')
    def validate_validation_rules(self):
        validate_rules_for_field_type(self.field_type, self.validation_rules)
        return self


class CustomFieldDefinitionBase(CustomFieldDefinitionValidationMixin, BaseModel):
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


class CustomFieldDefinitionCreate(CustomFieldDefinitionBase):
    project_id: int


class CustomFieldDefinitionUpdate(CustomFieldDefinitionValidationMixin, BaseModel):
    """Partial update. Every field is optional; the CRUD layer re-validates the
    merged definition (field_type + rules + options) before persisting."""

    name: Optional[str] = None
    slug: Optional[str] = None
    field_type: Optional[CustomFieldType] = None
    description: Optional[str] = None
    is_required: Optional[bool] = None
    default_value: Optional[str] = None
    options: Optional[Union[List[str], Dict[str, Any]]] = None
    validation_rules: Optional[Dict[str, Any]] = None
    entity_types: Optional[List[str]] = None


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
