from sqlalchemy.orm import Session, joinedload
from sqlalchemy import and_, or_, desc, func, cast, String
from typing import Optional, List, Dict, Any, Union
from datetime import datetime, timedelta
from fastapi import Depends
import json

from ..models import AuditTrail, User, Project, EntityType
from .request_context import current_client_ip, current_user_agent
from ..schemas_audit import (
    AuditTrailCreate, AuditTrailUpdate, AuditTrailResponse, 
    AuditTrailFilter, ActivitySummary, EntityHistory, 
    ActivityCount, EntityCount, TopUser
)
from ..database import get_db

class AuditService:
    def __init__(self, db: Session):
        self.db = db

    def _is_audit_enabled(self, entity_type: Optional[Union[str, EntityType]] = None) -> bool:
        """Check if audit logging is enabled globally and for the specific entity type
        
        Critical entity types (SYSTEM_SETTING, USER) are always audited regardless of configuration
        to maintain security and compliance.
        """
        # Critical entity types that must always be audited
        CRITICAL_ENTITY_TYPES = {"system_setting", "user"}
        entity_type_value = entity_type.value if isinstance(entity_type, EntityType) else entity_type
        
        try:
            from ..crud import get_system_setting
            setting = get_system_setting(self.db, key="audit_trail_config")
            if setting is None:
                # Default: audit is enabled for all entities
                return True
            
            try:
                config_data = json.loads(setting.value) if setting.value else {}
            except (json.JSONDecodeError, TypeError):
                # If config is invalid, default to enabled
                return True
            
            # Validate config_data structure
            if not isinstance(config_data, dict):
                return True
            
            # Critical entity types are always audited
            if entity_type_value and entity_type_value in CRITICAL_ENTITY_TYPES:
                return True
            
            # Check global enabled flag first
            # If globally disabled, entity-specific settings are ignored
            global_enabled = config_data.get("enabled", True)
            if not isinstance(global_enabled, bool):
                global_enabled = True  # Default to True if invalid type
            
            if not global_enabled:
                return False
            
            # Check entity-specific setting if provided
            if entity_type_value:
                entity_settings = config_data.get("entity_settings", {})
                if not isinstance(entity_settings, dict):
                    entity_settings = {}
                # If entity type is explicitly set to False, disable it
                # If not set or set to True, enable it (default behavior)
                entity_enabled = entity_settings.get(entity_type_value, True)
                if not isinstance(entity_enabled, bool):
                    entity_enabled = True  # Default to True if invalid type
                return entity_enabled
            
            return True
        except Exception as e:
            # If there's any error checking config, default to enabled to avoid losing audit data
            print(f"Error checking audit config: {e}")
            return True

    def create_audit_trail(self, audit_data: AuditTrailCreate) -> Optional[AuditTrail]:
        """Create a new audit trail entry if audit is enabled for the entity type"""
        # Check if audit is enabled for this entity type
        if not self._is_audit_enabled(audit_data.entity_type):
            # Audit is disabled for this entity type, skip logging
            return None

        audit_payload = audit_data.model_dump()
        audit_payload["ip_address"] = audit_payload.get("ip_address") or current_client_ip()
        audit_payload["user_agent"] = audit_payload.get("user_agent") or current_user_agent()
        audit_trail = AuditTrail(**audit_payload)
        self.db.add(audit_trail)
        self.db.commit()
        self.db.refresh(audit_trail)
        return audit_trail

    def get_audit_trail_by_id(self, audit_id: int) -> Optional[AuditTrail]:
        """Get audit trail by ID"""
        return self.db.query(AuditTrail).filter(AuditTrail.id == audit_id).first()

    def _build_audit_trail_query(self, filters: AuditTrailFilter):
        query = self.db.query(AuditTrail).options(joinedload(AuditTrail.user))

        if filters.user_id:
            query = query.filter(AuditTrail.user_id == filters.user_id)

        if filters.action:
            query = query.filter(AuditTrail.action == filters.action)

        if filters.entity_type:
            query = query.filter(AuditTrail.entity_type == filters.entity_type)

        if filters.entity_id:
            query = query.filter(AuditTrail.entity_id == filters.entity_id)

        if filters.project_id:
            query = query.filter(AuditTrail.project_id == filters.project_id)

        if filters.date_from:
            query = query.filter(AuditTrail.created_at >= filters.date_from)

        if filters.date_to:
            query = query.filter(AuditTrail.created_at <= filters.date_to)

        if filters.search and filters.search.strip():
            search_pattern = f"%{filters.search.strip()}%"
            query = query.filter(
                or_(
                    AuditTrail.description.ilike(search_pattern),
                    cast(AuditTrail.entity_type, String).ilike(search_pattern),
                    cast(AuditTrail.action, String).ilike(search_pattern)
                )
            )

        return query

    def get_audit_trails(self, filters: AuditTrailFilter) -> tuple[List[AuditTrail], int]:
        """Get audit trails with filtering and pagination"""
        query = self._build_audit_trail_query(filters)
        total = query.count()
        audit_trails = query.order_by(desc(AuditTrail.created_at)).offset(filters.offset).limit(filters.limit).all()

        return audit_trails, total

    def get_visible_audit_trails(
        self,
        filters: AuditTrailFilter,
        current_user_id: int,
        accessible_project_ids: List[int],
        is_superuser: bool = False,
    ) -> tuple[List[AuditTrail], int]:
        """Get audit trails visible to a user before pagination is applied."""
        query = self._build_audit_trail_query(filters)

        if not is_superuser:
            visibility_filters = [AuditTrail.user_id == current_user_id]
            if accessible_project_ids:
                visibility_filters.append(AuditTrail.project_id.in_(accessible_project_ids))
            query = query.filter(or_(*visibility_filters))

        total = query.count()
        audit_trails = query.order_by(desc(AuditTrail.created_at)).offset(filters.offset).limit(filters.limit).all()

        return audit_trails, total

    def get_entity_history(self, entity_type: str, entity_id: int) -> EntityHistory:
        """Get complete history for a specific entity"""
        audit_trails = self.db.query(AuditTrail).filter(
            and_(
                AuditTrail.entity_type == entity_type,
                AuditTrail.entity_id == entity_id
            )
        ).order_by(desc(AuditTrail.created_at)).all()

        return EntityHistory(
            entity_type=entity_type,
            entity_id=entity_id,
            total_changes=len(audit_trails),
            history=[AuditTrailResponse.from_orm(audit) for audit in audit_trails]
        )

    def get_user_activity_summary(self, user_id: int, days: int = 30) -> ActivitySummary:
        """Get activity summary for a specific user"""
        date_from = datetime.utcnow() - timedelta(days=days)
        date_to = datetime.utcnow()

        # Get all audit trails for the user in the date range
        audit_trails = self.db.query(AuditTrail).filter(
            and_(
                AuditTrail.user_id == user_id,
                AuditTrail.created_at >= date_from,
                AuditTrail.created_at <= date_to
            )
        ).all()

        # Count by action
        activity_counts = (
            self.db.query(
                AuditTrail.action,
                func.count(AuditTrail.id).label('count')
            )
            .filter(
                and_(
                    AuditTrail.user_id == user_id,
                    AuditTrail.created_at >= date_from,
                    AuditTrail.created_at <= date_to
                )
            )
            .group_by(AuditTrail.action)
            .all()
        )

        # Count by entity type
        entity_counts = (
            self.db.query(
                AuditTrail.entity_type,
                func.count(AuditTrail.id).label('count')
            )
            .filter(
                and_(
                    AuditTrail.user_id == user_id,
                    AuditTrail.created_at >= date_from,
                    AuditTrail.created_at <= date_to
                )
            )
            .group_by(AuditTrail.entity_type)
            .all()
        )

        return ActivitySummary(
            user_id=user_id,
            days=days,
            total_activities=len(audit_trails),
            activity_counts=[ActivityCount(action=action, count=count) for action, count in activity_counts],
            entity_counts=[EntityCount(entity_type=entity_type, count=count) for entity_type, count in entity_counts],
            date_from=date_from,
            date_to=date_to
        )

    def get_project_activity_summary(self, project_id: int, days: int = 30) -> ActivitySummary:
        """Get activity summary for a specific project"""
        date_from = datetime.utcnow() - timedelta(days=days)
        date_to = datetime.utcnow()

        # Get all audit trails for the project in the date range
        audit_trails = self.db.query(AuditTrail).filter(
            and_(
                AuditTrail.project_id == project_id,
                AuditTrail.created_at >= date_from,
                AuditTrail.created_at <= date_to
            )
        ).all()

        # Count by action
        activity_counts = (
            self.db.query(
                AuditTrail.action,
                func.count(AuditTrail.id).label('count')
            )
            .filter(
                and_(
                    AuditTrail.project_id == project_id,
                    AuditTrail.created_at >= date_from,
                    AuditTrail.created_at <= date_to
                )
            )
            .group_by(AuditTrail.action)
            .all()
        )

        # Count by entity type
        entity_counts = (
            self.db.query(
                AuditTrail.entity_type,
                func.count(AuditTrail.id).label('count')
            )
            .filter(
                and_(
                    AuditTrail.project_id == project_id,
                    AuditTrail.created_at >= date_from,
                    AuditTrail.created_at <= date_to
                )
            )
            .group_by(AuditTrail.entity_type)
            .all()
        )

        # Get top users with user information
        from ..models import User
        top_users = (
            self.db.query(
                AuditTrail.user_id,
                User.username,
                User.full_name,
                func.count(AuditTrail.id).label('activity_count')
            )
            .join(User, AuditTrail.user_id == User.id)
            .filter(
                and_(
                    AuditTrail.project_id == project_id,
                    AuditTrail.created_at >= date_from,
                    AuditTrail.created_at <= date_to
                )
            )
            .group_by(AuditTrail.user_id, User.username, User.full_name)
            .order_by(desc(func.count(AuditTrail.id)))
            .limit(10)
            .all()
        )

        return ActivitySummary(
            project_id=project_id,
            days=days,
            total_activities=len(audit_trails),
            activity_counts=[ActivityCount(action=action, count=count) for action, count in activity_counts],
            entity_counts=[EntityCount(entity_type=entity_type, count=count) for entity_type, count in entity_counts],
            date_from=date_from,
            date_to=date_to,
            top_users=[TopUser(user_id=user_id, username=username, full_name=full_name, activity_count=activity_count) for user_id, username, full_name, activity_count in top_users]
        )

    def get_recent_activities(self, limit: int = 50, project_id: Optional[int] = None) -> List[AuditTrail]:
        """Get recent activities"""
        query = self.db.query(AuditTrail)
        
        if project_id:
            query = query.filter(AuditTrail.project_id == project_id)
        
        return query.order_by(desc(AuditTrail.created_at)).limit(limit).all()

    def update_audit_trail(self, audit_id: int, update_data: AuditTrailUpdate) -> Optional[AuditTrail]:
        """Update audit trail (limited fields for security)"""
        audit_trail = self.get_audit_trail_by_id(audit_id)
        if not audit_trail:
            return None
        
        for field, value in update_data.model_dump(exclude_unset=True).items():
            setattr(audit_trail, field, value)
        
        self.db.commit()
        self.db.refresh(audit_trail)
        return audit_trail

    def delete_audit_trail(self, audit_id: int) -> bool:
        """Delete audit trail (admin only)"""
        audit_trail = self.get_audit_trail_by_id(audit_id)
        if not audit_trail:
            return False
        
        self.db.delete(audit_trail)
        self.db.commit()
        return True

    def log_action(
        self,
        user_id: int,
        action: str,
        entity_type: str,
        entity_id: Optional[int] = None,
        project_id: Optional[int] = None,
        old_values: Optional[Dict[str, Any]] = None,
        new_values: Optional[Dict[str, Any]] = None,
        description: Optional[str] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        session_id: Optional[str] = None,
        additional_metadata: Optional[Dict[str, Any]] = None
    ) -> Optional[AuditTrail]:
        """Convenience method to log an action
        
        Returns None if audit is disabled for the entity type.
        """
        # Calculate field changes
        field_changes = None
        if old_values and new_values:
            field_changes = {}
            for key in old_values:
                if key in new_values and old_values[key] != new_values[key]:
                    field_changes[key] = {
                        'old': old_values[key],
                        'new': new_values[key]
                    }

        audit_data = AuditTrailCreate(
            user_id=user_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            project_id=project_id,
            old_values=old_values,
            new_values=new_values,
            field_changes=field_changes,
            ip_address=ip_address,
            user_agent=user_agent,
            session_id=session_id,
            description=description,
            additional_metadata=additional_metadata
        )
        
        return self.create_audit_trail(audit_data)

# Dependency to get audit service
def get_audit_service(db: Session = Depends(get_db)) -> AuditService:
    return AuditService(db)
