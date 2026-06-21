from pydantic import BaseModel, Field, ValidationInfo, field_validator
from typing import Optional, Dict, Any, List, Union
from datetime import datetime
from enum import Enum

# Import enums from models to ensure consistency
from app.models import AuditAction, EntityType

# Base schemas
class AuditTrailBase(BaseModel):
    action: AuditAction
    entity_type: EntityType
    entity_id: Optional[int] = None
    project_id: Optional[int] = None
    old_values: Optional[Dict[str, Any]] = None
    new_values: Optional[Dict[str, Any]] = None
    field_changes: Optional[Dict[str, Any]] = None
    ip_address: Optional[str] = Field(None, max_length=45)
    user_agent: Optional[str] = Field(None, max_length=500)
    session_id: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = Field(None, max_length=2000)
    additional_metadata: Optional[Dict[str, Any]] = None

class AuditTrailCreate(AuditTrailBase):
    user_id: int

class AuditTrailUpdate(BaseModel):
    description: Optional[str] = Field(None, max_length=2000)
    additional_metadata: Optional[Dict[str, Any]] = None

    @field_validator('additional_metadata')
    @classmethod
    def validate_metadata(cls, v):
        if v is not None:
            # Ensure metadata is a dict and not too large
            if not isinstance(v, dict):
                raise ValueError('additional_metadata must be a dictionary')
            # Check total size (estimate)
            import json
            if len(json.dumps(v)) > 5000:
                raise ValueError('additional_metadata is too large (max 5000 characters)')
        return v

# Response schemas
class AuditTrailResponse(AuditTrailBase):
    id: int
    user_id: int
    username: Optional[str] = None
    user_full_name: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True

class AuditTrailList(BaseModel):
    items: List[AuditTrailResponse]
    total: int
    limit: int
    offset: int

# Filter schemas
class AuditTrailFilter(BaseModel):
    user_id: Optional[int] = None
    action: Optional[AuditAction] = None
    entity_type: Optional[EntityType] = None
    entity_id: Optional[int] = None
    project_id: Optional[int] = None
    date_from: Optional[Union[str, datetime]] = None
    date_to: Optional[Union[str, datetime]] = None
    search: Optional[str] = None
    limit: int = Field(default=50, ge=1, le=1000)
    offset: int = Field(default=0, ge=0)

    @field_validator('date_from', 'date_to', mode='before')
    @classmethod
    def parse_date(cls, v, info: ValidationInfo):
        if v is None:
            return None
        if isinstance(v, datetime):
            return v
        if isinstance(v, str):
            try:
                parsed_date = datetime.strptime(v, '%Y-%m-%d')
                if info.field_name == 'date_to':
                    return parsed_date.replace(hour=23, minute=59, second=59, microsecond=999999)
                return parsed_date
            except ValueError:
                raise ValueError('Date must be in YYYY-MM-DD format')
        return v

# Activity summary schemas
class ActivityCount(BaseModel):
    action: AuditAction
    count: int

class EntityCount(BaseModel):
    entity_type: EntityType
    count: int

class TopUser(BaseModel):
    user_id: int
    username: Optional[str] = None
    full_name: Optional[str] = None
    activity_count: int

class ActivitySummary(BaseModel):
    user_id: Optional[int] = None
    project_id: Optional[int] = None
    days: int
    total_activities: int
    activity_counts: List[ActivityCount]
    entity_counts: List[EntityCount]
    date_from: datetime
    date_to: datetime
    top_users: Optional[List[TopUser]] = None
    # Audit-logging status, so the UI can distinguish "nothing happened" from
    # "logging is switched off" instead of rendering misleading zeros.
    audit_enabled: bool = True
    audit_disabled_entities: List[str] = Field(default_factory=list)
    audit_effectively_off: bool = False

# Entity history schema
class EntityHistory(BaseModel):
    entity_type: EntityType
    entity_id: int
    total_changes: int
    history: List[AuditTrailResponse]
