from typing import Any, Dict, Optional

from pydantic import BaseModel, Field


class TextValidationRules(BaseModel):
    min_length: Optional[int] = Field(None, ge=0, description="Minimum string length")
    max_length: Optional[int] = Field(None, ge=0, description="Maximum string length")
    regex_pattern: Optional[str] = Field(None, description="Regex pattern for validation")


class NumberValidationRules(BaseModel):
    min_value: Optional[float] = Field(None, description="Minimum numeric value")
    max_value: Optional[float] = Field(None, description="Maximum numeric value")
    integer_only: Optional[bool] = Field(False, description="Require integer values only")


class DateValidationRules(BaseModel):
    min_date: Optional[str] = Field(None, description="Minimum date (ISO format)")
    max_date: Optional[str] = Field(None, description="Maximum date (ISO format)")
    future_only: Optional[bool] = Field(False, description="Require future dates only")
    past_only: Optional[bool] = Field(False, description="Require past dates only")


class SelectValidationRules(BaseModel):
    min_length: Optional[int] = Field(None, ge=0, description="Minimum string length for selected option")
    max_length: Optional[int] = Field(None, ge=0, description="Maximum string length for selected option")


class TestCaseVersionBase(BaseModel):
    version_name: Optional[str] = None
    version_label: Optional[str] = None
    description: Optional[str] = None
    change_summary: Optional[str] = None
    change_reason: Optional[str] = None
    changed_fields: Optional[Dict[str, Any]] = None
    branch_name: Optional[str] = None


class TestCaseVersionCreate(TestCaseVersionBase):
    pass


class TestCaseVersionUpdate(BaseModel):
    version_name: Optional[str] = None
    version_label: Optional[str] = None
    description: Optional[str] = None
    change_summary: Optional[str] = None
    change_reason: Optional[str] = None
    changed_fields: Optional[Dict[str, Any]] = None


class VersionComparisonBase(BaseModel):
    comparison_type: str = "full"


class VersionComparisonCreate(VersionComparisonBase):
    pass


class VersionTagBase(BaseModel):
    tag_name: str
    tag_type: str = "release"
    description: Optional[str] = None
    color: str = "#007bff"


class VersionTagCreate(VersionTagBase):
    pass


class VersionLockBase(BaseModel):
    lock_type: str = "edit"
    lock_reason: Optional[str] = None
    expires_hours: int = 24


class VersionLockCreate(VersionLockBase):
    pass
