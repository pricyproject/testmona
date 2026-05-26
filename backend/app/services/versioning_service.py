from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import and_, desc
from datetime import datetime, timedelta
import json
import difflib

from ..models import TestCase, User
from ..models_versioning import (
    TestCaseVersion, VersionComparison, VersionTag, VersionLock, 
    VersionWorkflow, VersionStatus, VersionAction
)
from ..schemas import (
    TestCaseVersionCreate, TestCaseVersionUpdate
)


class VersioningService:
    """Enhanced versioning service for test cases"""
    
    def __init__(self, db: Session):
        self.db = db

    @staticmethod
    def _active_test_case_filter() -> Any:
        return (TestCase.is_deleted.is_(None)) | (TestCase.is_deleted.is_(False))
    
    def create_version(
        self, 
        test_case_id: int, 
        version_data: TestCaseVersionCreate,
        created_by: int,
        parent_version_id: Optional[int] = None
    ) -> TestCaseVersion:
        """Create a new version of a test case"""
        
        # Get test case
        test_case = self.db.query(TestCase).filter(
            TestCase.id == test_case_id,
            self._active_test_case_filter(),
        ).first()
        if not test_case:
            raise ValueError("Test case not found")
        
        # Determine version numbers
        if parent_version_id:
            parent_version = self.db.query(TestCaseVersion).filter(
                TestCaseVersion.id == parent_version_id,
                TestCaseVersion.test_case_id == test_case_id,
                TestCaseVersion.test_case.has(self._active_test_case_filter()),
            ).first()
            if not parent_version:
                raise ValueError("Parent version not found")
            
            # For branches, use same version numbers
            version_major = parent_version.version_major
            version_minor = parent_version.version_minor
            version_patch = parent_version.version_patch
        else:
            # Get latest published version to determine next version
            latest = self.get_latest_version(test_case_id)
            if latest:
                # Auto-increment patch version for updates
                version_major = latest.version_major
                version_minor = latest.version_minor
                version_patch = latest.version_patch + 1
            else:
                # First version
                version_major = 1
                version_minor = 0
                version_patch = 0
        
        # Create new version
        new_version = TestCaseVersion(
            test_case_id=test_case_id,
            version_major=version_major,
            version_minor=version_minor,
            version_patch=version_patch,
            version_label=version_data.version_label,
            version_name=version_data.version_name,
            description=version_data.description,
            status=VersionStatus.DRAFT,
            
            # Copy current test case data
            title=test_case.title,
            test_type=test_case.test_type,
            preconditions=test_case.preconditions,
            steps=test_case.steps,
            expected_result=test_case.expected_result,
            priority=test_case.priority,
            tags=test_case.tags,
            
            # Custom fields snapshot
            custom_fields_data=self._get_custom_fields_snapshot(test_case_id),
            
            # Change tracking
            changed_fields=version_data.changed_fields,
            change_summary=version_data.change_summary,
            change_reason=version_data.change_reason,
            
            # Branching
            parent_version_id=parent_version_id,
            branch_name=version_data.branch_name,
            
            created_by=created_by
        )
        
        self.db.add(new_version)
        self.db.commit()
        self.db.refresh(new_version)
        
        return new_version
    
    def get_versions(self, test_case_id: int) -> List[TestCaseVersion]:
        """Get all versions of a test case"""
        return self.db.query(TestCaseVersion).filter(
            TestCaseVersion.test_case_id == test_case_id,
            TestCaseVersion.test_case.has(self._active_test_case_filter()),
        ).order_by(
            desc(TestCaseVersion.version_major),
            desc(TestCaseVersion.version_minor),
            desc(TestCaseVersion.version_patch)
        ).all()
    
    def get_latest_version(self, test_case_id: int) -> Optional[TestCaseVersion]:
        """Get the latest published version of a test case"""
        return self.db.query(TestCaseVersion).filter(
            and_(
                TestCaseVersion.test_case_id == test_case_id,
                TestCaseVersion.test_case.has(self._active_test_case_filter()),
                TestCaseVersion.status == VersionStatus.PUBLISHED
            )
        ).order_by(
            desc(TestCaseVersion.version_major),
            desc(TestCaseVersion.version_minor),
            desc(TestCaseVersion.version_patch)
        ).first()
    
    def get_version(self, version_id: int) -> Optional[TestCaseVersion]:
        """Get a specific version"""
        return self.db.query(TestCaseVersion).filter(
            TestCaseVersion.id == version_id,
            TestCaseVersion.test_case.has(self._active_test_case_filter()),
        ).first()
    
    def update_version(
        self, 
        version_id: int, 
        update_data: TestCaseVersionUpdate,
        updated_by: int
    ) -> TestCaseVersion:
        """Update a version (only draft versions can be updated)"""
        version = self.get_version(version_id)
        if not version:
            raise ValueError("Version not found")
        
        if version.status != VersionStatus.DRAFT:
            raise ValueError("Only draft versions can be updated")
        
        # Update fields
        for field, value in update_data.model_dump(exclude_unset=True).items():
            setattr(version, field, value)
        
        self.db.commit()
        self.db.refresh(version)
        return version
    
    def publish_version(self, version_id: int, published_by: int) -> TestCaseVersion:
        """Publish a version"""
        version = self.get_version(version_id)
        if not version:
            raise ValueError("Version not found")
        
        if version.status != VersionStatus.APPROVED:
            raise ValueError("Version must be approved before publishing")
        
        version.status = VersionStatus.PUBLISHED
        version.published_at = datetime.utcnow()
        
        # Update the actual test case with this version's data
        test_case = self.db.query(TestCase).filter(
            TestCase.id == version.test_case_id,
            self._active_test_case_filter(),
        ).first()
        if test_case:
            test_case.title = version.title
            test_case.test_type = version.test_type
            test_case.preconditions = version.preconditions
            test_case.steps = version.steps
            test_case.expected_result = version.expected_result
            test_case.priority = version.priority
            test_case.tags = version.tags
            
            # Update custom fields
            self._update_custom_fields_from_version(version.test_case_id, version.custom_fields_data)
        
        self.db.commit()
        self.db.refresh(version)
        return version
    
    def rollback_to_version(
        self, 
        test_case_id: int, 
        target_version_id: int,
        rollback_by: int,
        reason: str
    ) -> TestCaseVersion:
        """Rollback a test case to a specific version"""
        target_version = self.get_version(target_version_id)
        if not target_version:
            raise ValueError("Target version not found")
        
        # Create new version based on the target version
        rollback_version = self.create_version(
            test_case_id=test_case_id,
            version_data=TestCaseVersionCreate(
                version_name=f"Rollback to {target_version.version_string}",
                change_summary=f"Rollback to version {target_version.version_string}",
                change_reason=reason,
                changed_fields={"action": "rollback", "target_version": target_version.version_string}
            ),
            created_by=rollback_by,
            parent_version_id=target_version_id
        )
        
        # Copy data from target version
        rollback_version.title = target_version.title
        rollback_version.test_type = target_version.test_type
        rollback_version.preconditions = target_version.preconditions
        rollback_version.steps = target_version.steps
        rollback_version.expected_result = target_version.expected_result
        rollback_version.priority = target_version.priority
        rollback_version.tags = target_version.tags
        rollback_version.custom_fields_data = target_version.custom_fields_data
        
        self.db.commit()
        self.db.refresh(rollback_version)
        
        return rollback_version
    
    def compare_versions(
        self, 
        from_version_id: int, 
        to_version_id: int,
        created_by: int
    ) -> VersionComparison:
        """Compare two versions and store the comparison results"""
        from_version = self.get_version(from_version_id)
        to_version = self.get_version(to_version_id)
        
        if not from_version or not to_version:
            raise ValueError("One or both versions not found")
        
        # Perform detailed comparison
        comparison_result = self._perform_detailed_comparison(from_version, to_version)
        
        # Check if comparison already exists
        existing = self.db.query(VersionComparison).filter(
            and_(
                VersionComparison.from_version_id == from_version_id,
                VersionComparison.to_version_id == to_version_id
            )
        ).first()
        
        if existing:
            # Update existing comparison
            for field, value in comparison_result.items():
                setattr(existing, field, value)
            comparison = existing
        else:
            # Create new comparison
            comparison = VersionComparison(
                from_version_id=from_version_id,
                to_version_id=to_version_id,
                created_by=created_by,
                **comparison_result
            )
            self.db.add(comparison)
        
        self.db.commit()
        self.db.refresh(comparison)
        return comparison
    
    def create_branch(
        self, 
        parent_version_id: int, 
        branch_name: str,
        created_by: int,
        reason: str
    ) -> TestCaseVersion:
        """Create a branch from a specific version"""
        parent_version = self.get_version(parent_version_id)
        if not parent_version:
            raise ValueError("Parent version not found")
        
        # Create new version as branch
        branch_version = self.create_version(
            test_case_id=parent_version.test_case_id,
            version_data=TestCaseVersionCreate(
                version_name=f"Branch: {branch_name}",
                branch_name=branch_name,
                change_summary=f"Created branch '{branch_name}' from {parent_version.version_string}",
                change_reason=reason
            ),
            created_by=created_by,
            parent_version_id=parent_version_id
        )
        
        return branch_version
    
    def merge_branch(
        self, 
        branch_version_id: int, 
        target_version_id: int,
        merged_by: int,
        merge_reason: str
    ) -> TestCaseVersion:
        """Merge a branch into another version"""
        branch_version = self.get_version(branch_version_id)
        target_version = self.get_version(target_version_id)
        
        if not branch_version or not target_version:
            raise ValueError("Branch or target version not found")
        
        if not branch_version.branch_name:
            raise ValueError("Source version is not a branch")
        
        # Mark branch as merged
        branch_version.is_merged = True
        branch_version.merged_into_version_id = target_version_id
        
        # Create new version with merged changes
        merged_version = self.create_version(
            test_case_id=branch_version.test_case_id,
            version_data=TestCaseVersionCreate(
                version_name=f"Merge: {branch_version.branch_name} -> {target_version.version_string}",
                change_summary=f"Merged branch '{branch_version.branch_name}'",
                change_reason=merge_reason,
                changed_fields={"action": "merge", "branch": branch_version.branch_name}
            ),
            created_by=merged_by,
            parent_version_id=target_version_id
        )
        
        # Apply branch changes to merged version
        merged_version.title = branch_version.title
        merged_version.test_type = branch_version.test_type
        merged_version.preconditions = branch_version.preconditions
        merged_version.steps = branch_version.steps
        merged_version.expected_result = branch_version.expected_result
        merged_version.priority = branch_version.priority
        merged_version.tags = branch_version.tags
        merged_version.custom_fields_data = branch_version.custom_fields_data
        
        self.db.commit()
        self.db.refresh(merged_version)
        return merged_version
    
    def lock_version(
        self, 
        test_case_id: int, 
        version_id: Optional[int],
        lock_type: str,
        locked_by: int,
        reason: str,
        expires_hours: int = 24
    ) -> VersionLock:
        """Lock a test case or specific version"""
        # Release existing locks
        self.release_locks(test_case_id, version_id)
        
        lock = VersionLock(
            test_case_id=test_case_id,
            version_id=version_id,
            lock_type=lock_type,
            lock_reason=reason,
            locked_by=locked_by,
            expires_at=datetime.utcnow() + timedelta(hours=expires_hours)
        )
        
        self.db.add(lock)
        self.db.commit()
        self.db.refresh(lock)
        return lock
    
    def release_locks(self, test_case_id: int, version_id: Optional[int] = None):
        """Release all locks for a test case or version"""
        query = self.db.query(VersionLock).filter(
            and_(
                VersionLock.test_case_id == test_case_id,
                VersionLock.is_active == True
            )
        )
        
        if version_id:
            query = query.filter(VersionLock.version_id == version_id)
        
        locks = query.all()
        for lock in locks:
            lock.is_active = False
            lock.released_at = datetime.utcnow()
        
        self.db.commit()
    
    def add_tag(
        self, 
        version_id: int, 
        created_by: int,
        tag_name: str,
        tag_type: str = "release",
        description: str = ""
    ) -> VersionTag:
        """Add a tag to a version"""
        tag = VersionTag(
            version_id=version_id,
            tag_name=tag_name,
            tag_type=tag_type,
            description=description,
            created_by=created_by
        )
        
        self.db.add(tag)
        self.db.commit()
        self.db.refresh(tag)
        return tag
    
    def _get_custom_fields_snapshot(self, test_case_id: int) -> Dict[str, Any]:
        """Get snapshot of custom field values for a test case"""
        from ..models import CustomFieldValue, CustomFieldDefinition
        
        values = self.db.query(CustomFieldValue).filter(
            CustomFieldValue.test_case_id == test_case_id
        ).all()
        
        snapshot = {}
        for value in values:
            field_def = self.db.query(CustomFieldDefinition).filter(
                CustomFieldDefinition.id == value.field_definition_id
            ).first()
            if field_def:
                snapshot[field_def.name] = {
                    "value": value.value,
                    "type": field_def.field_type.value,
                    "field_id": value.field_definition_id
                }
        
        return snapshot
    
    def _update_custom_fields_from_version(self, test_case_id: int, custom_fields_data: Dict[str, Any]):
        """Update custom fields from version snapshot"""
        from ..models import CustomFieldValue
        
        # Clear existing custom field values
        self.db.query(CustomFieldValue).filter(
            CustomFieldValue.test_case_id == test_case_id
        ).delete()
        
        # Create new values from snapshot
        for field_name, field_data in custom_fields_data.items():
            value = CustomFieldValue(
                test_case_id=test_case_id,
                field_definition_id=field_data["field_id"],
                value=field_data["value"]
            )
            self.db.add(value)
    
    def _perform_detailed_comparison(
        self, 
        from_version: TestCaseVersion, 
        to_version: TestCaseVersion
    ) -> Dict[str, Any]:
        """Perform detailed comparison between two versions"""
        field_differences = {}
        added_fields = {}
        removed_fields = {}
        modified_fields = {}
        
        # Fields to compare
        fields_to_compare = [
            'title', 'test_type', 'preconditions', 'steps', 
            'expected_result', 'priority', 'tags'
        ]
        
        for field in fields_to_compare:
            from_value = getattr(from_version, field)
            to_value = getattr(to_version, field)
            
            if from_value != to_value:
                field_differences[field] = {
                    'from': from_value,
                    'to': to_value,
                    'diff': self._get_text_diff(from_value or "", to_value or "")
                }
                modified_fields[field] = {
                    'from': from_value,
                    'to': to_value
                }
        
        # Compare custom fields
        from_custom = from_version.custom_fields_data or {}
        to_custom = to_version.custom_fields_data or {}
        
        all_custom_fields = set(from_custom.keys()) | set(to_custom.keys())
        
        for field_name in all_custom_fields:
            from_value = from_custom.get(field_name, {}).get('value', '')
            to_value = to_custom.get(field_name, {}).get('value', '')
            
            if field_name not in from_custom:
                added_fields[field_name] = to_value
            elif field_name not in to_custom:
                removed_fields[field_name] = from_value
            elif from_value != to_value:
                field_differences[f"custom_{field_name}"] = {
                    'from': from_value,
                    'to': to_value,
                    'diff': self._get_text_diff(from_value or "", to_value or "")
                }
                modified_fields[f"custom_{field_name}"] = {
                    'from': from_value,
                    'to': to_value
                }
        
        # Calculate similarity score
        similarity_score = self._calculate_similarity_score(from_version, to_version)
        
        return {
            'field_differences': field_differences,
            'added_fields': added_fields,
            'removed_fields': removed_fields,
            'modified_fields': modified_fields,
            'similarity_score': similarity_score
        }
    
    def _get_text_diff(self, from_text: str, to_text: str) -> str:
        """Generate text diff using difflib"""
        from_lines = from_text.splitlines(keepends=True)
        to_lines = to_text.splitlines(keepends=True)
        
        diff = difflib.unified_diff(
            from_lines, 
            to_lines, 
            fromfile='from_version',
            tofile='to_version',
            lineterm=''
        )
        
        return '\n'.join(diff)
    
    def _calculate_similarity_score(
        self, 
        from_version: TestCaseVersion, 
        to_version: TestCaseVersion
    ) -> int:
        """Calculate similarity score between two versions (0-100)"""
        fields_to_compare = [
            'title', 'test_type', 'preconditions', 'steps', 
            'expected_result', 'priority', 'tags'
        ]
        
        total_fields = len(fields_to_compare)
        similar_fields = 0
        
        for field in fields_to_compare:
            from_value = getattr(from_version, field) or ""
            to_value = getattr(to_version, field) or ""
            
            if from_value == to_value:
                similar_fields += 1
            else:
                # Calculate text similarity for text fields
                similarity = difflib.SequenceMatcher(None, from_value, to_value).ratio()
                if similarity > 0.8:  # 80% similarity threshold
                    similar_fields += 1
        
        # Compare custom fields
        from_custom = from_version.custom_fields_data or {}
        to_custom = to_version.custom_fields_data or {}
        
        all_custom_fields = set(from_custom.keys()) | set(to_custom.keys())
        total_fields += len(all_custom_fields)
        
        for field_name in all_custom_fields:
            from_value = from_custom.get(field_name, {}).get('value', '')
            to_value = to_custom.get(field_name, {}).get('value', '')
            
            if from_value == to_value:
                similar_fields += 1
            else:
                similarity = difflib.SequenceMatcher(None, from_value, to_value).ratio()
                if similarity > 0.8:
                    similar_fields += 1
        
        return int((similar_fields / total_fields) * 100) if total_fields > 0 else 0
