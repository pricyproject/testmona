from sqlalchemy.orm import Session, joinedload, noload, selectinload
from sqlalchemy.orm.attributes import set_committed_value
from sqlalchemy import func, or_, text
from sqlalchemy.exc import IntegrityError, OperationalError
from typing import List, Optional
from datetime import datetime, timedelta, timezone
import re
from .. import schemas
from ..services.execution_timing import apply_test_result_execution_timing
from ..services.user_lifecycle import (
    create_user_invitation,
    delete_user_invitation,
    get_onboarding_checklist,
    get_user_invitation,
    get_user_invitation_by_token,
    get_user_invitations,
    initialize_onboarding_checklist,
    mark_invitation_as_used,
    update_onboarding_task,
)
from ..models import Project, TestSuite, TestCase, TestCaseStep, TestRun, TestResult, User, Role, CustomFieldDefinition, CustomFieldValue, CustomFieldType, JiraIntegration, JiraIssue, Requirement, Defect, TestPlan, Milestone, TraceabilityMatrix, CoverageReport, Notification, TestCaseSection, SharedStep, GlobalParameter, TestDataset, TestMindmap, ImpactAnalysis, ExecutionEnvironment, ExecutionLog, TestSchedule, ExecutionEngine, TestRunEnvironment, DefectComment, DefectAttachment, DefectHistory, DefectWorkflow, DefectTemplate, TestResultDefectLink, DefectLinkType, DefectStatus, IssueTrackerIntegration, SyncLog, KPIData, TestStepResult, ShareableReport, RootCauseAnalysis, DashboardWidget, TestCaseRevision, RequirementStatus, Priority, EntityType, TestTypeDefinition, PriorityDefinition, SharedStepTemplate, TestExecutionSettings, NotificationSettings, AutomationSettings, SystemSettings, requirement_test_case_links, requirement_test_plan_links, RequirementVersion, RequirementChatConversation, RequirementChatMessage, RequirementFolder
from ..schemas import (
    ProjectCreate, ProjectUpdate,
    TestSuiteCreate, TestSuiteUpdate,
    TestCaseCreate, TestCaseUpdate,
    TestRunCreate, TestRunUpdate,
    TestResultCreate, TestResultUpdate,
    UserCreate, UserUpdate,
    CustomFieldDefinitionCreate, CustomFieldDefinitionUpdate,
    CustomFieldValueCreate, CustomFieldValueUpdate,
    JiraIntegrationCreate, JiraIntegrationUpdate,
    JiraIssueCreate, JiraIssueUpdate,
    RequirementCreate, RequirementUpdate,
    DefectCreate, DefectUpdate,
    TestPlanCreate, TestPlanUpdate,
    MilestoneCreate, MilestoneUpdate,
    TraceabilityMatrixCreate,
    CoverageReportCreate,
    NotificationCreate, NotificationUpdate,
    TestCaseSectionCreate, TestCaseSectionUpdate,
    TestCaseRevisionCreate,
    TestCaseStepCreate, TestCaseStepUpdate,
    KPIDataCreate, TestStepResultCreate, ShareableReportCreate, RootCauseAnalysisCreate,
    DashboardWidgetCreate,
    TestTypeDefinitionCreate, TestTypeDefinitionUpdate,
    PriorityDefinitionCreate, PriorityDefinitionUpdate,
    SharedStepTemplateCreate, SharedStepTemplateUpdate,
    TestExecutionSettingsCreate, TestExecutionSettingsUpdate,
    NotificationSettingsCreate, NotificationSettingsUpdate,
    AutomationSettingsCreate, AutomationSettingsUpdate,
    SystemSettingsCreate, SystemSettingsUpdate
)

from .projects import *
from .test_management import *
from .users import *
from .custom_fields import *
from .integrations import *

def get_requirement(db: Session, requirement_id: int):
    return db.query(Requirement).filter(Requirement.id == requirement_id).first()


def _enum_value(value):
    """Return the stored string for an enum-or-string column value."""
    return getattr(value, "value", value)


def record_requirement_version(
    db: Session,
    requirement: Requirement,
    action: str = "updated",
    actor_id: Optional[int] = None,
    change_note: Optional[str] = None,
    commit: bool = True,
) -> RequirementVersion:
    """Snapshot the requirement's current content as a new version row.

    Version numbers are dense and 1-based per requirement. Failures here must
    never break the underlying create/update, so callers wrap accordingly.
    """
    latest = (
        db.query(RequirementVersion)
        .filter(RequirementVersion.requirement_id == requirement.id)
        .order_by(RequirementVersion.version_number.desc())
        .first()
    )

    # For routine saves, skip recording when none of the snapshotted content
    # actually changed (e.g. an update that only touched assignee/parent).
    # 'created' and 'restored' always record so the timeline stays meaningful.
    if action == "updated" and latest is not None:
        unchanged = (
            latest.title == requirement.title
            and latest.description == requirement.description
            and latest.acceptance_criteria == requirement.acceptance_criteria
            and latest.status == _enum_value(requirement.status)
            and latest.priority == _enum_value(requirement.priority)
            and latest.tags == requirement.tags
            and latest.estimated_effort == requirement.estimated_effort
        )
        if unchanged:
            return latest

    last_number = latest.version_number if latest is not None else 0
    version = RequirementVersion(
        requirement_id=requirement.id,
        version_number=last_number + 1,
        action=action,
        title=requirement.title,
        description=requirement.description,
        acceptance_criteria=requirement.acceptance_criteria,
        status=_enum_value(requirement.status),
        priority=_enum_value(requirement.priority),
        tags=requirement.tags,
        estimated_effort=requirement.estimated_effort,
        change_note=change_note,
        created_by=actor_id,
    )
    db.add(version)
    if commit:
        safe_commit(db)
        db.refresh(version)
    return version


def restore_requirement_version(
    db: Session,
    requirement: Requirement,
    version: RequirementVersion,
    actor_id: Optional[int] = None,
    change_note: Optional[str] = None,
) -> Requirement:
    """Apply a prior version's content to the requirement and log a new version."""
    requirement.title = version.title
    requirement.description = version.description
    requirement.acceptance_criteria = version.acceptance_criteria
    if version.status:
        requirement.status = RequirementStatus(version.status)
    if version.priority:
        requirement.priority = Priority(version.priority)
    requirement.tags = version.tags
    requirement.estimated_effort = version.estimated_effort
    safe_commit(db)
    db.refresh(requirement)
    record_requirement_version(
        db,
        requirement,
        action="restored",
        actor_id=actor_id,
        change_note=change_note or f"Restored from v{version.version_number}",
    )
    return requirement


def get_requirements(
    db: Session,
    project_id: int = None,
    skip: int = 0,
    limit: int = 100,
    milestone_id: int = None,
):
    query = db.query(Requirement)
    if project_id:
        query = query.filter(Requirement.project_id == project_id)
    if milestone_id:
        query = (
            query
            .join(requirement_test_plan_links, requirement_test_plan_links.c.requirement_id == Requirement.id)
            .join(TestPlan, TestPlan.id == requirement_test_plan_links.c.test_plan_id)
            .filter(TestPlan.milestone_id == milestone_id)
            .distinct()
        )
    return query.offset(skip).limit(limit).all()


# --- Requirement folders / categories --------------------------------------

def _requirement_folder_counts(db: Session, project_id: int) -> dict:
    """Number of requirements filed directly under each folder in a project."""
    rows = (
        db.query(Requirement.folder_id, func.count(Requirement.id))
        .filter(Requirement.project_id == project_id, Requirement.folder_id.isnot(None))
        .group_by(Requirement.folder_id)
        .all()
    )
    return {folder_id: count for folder_id, count in rows}


def get_requirement_folders(db: Session, project_id: int):
    folders = (
        db.query(RequirementFolder)
        .filter(RequirementFolder.project_id == project_id)
        .order_by(RequirementFolder.order_index.asc(), RequirementFolder.name.asc())
        .all()
    )
    counts = _requirement_folder_counts(db, project_id)
    for folder in folders:
        # Transient attribute read by the Pydantic view (not persisted).
        folder.requirement_count = counts.get(folder.id, 0)
    return folders


def get_requirement_folder(db: Session, folder_id: int):
    return db.query(RequirementFolder).filter(RequirementFolder.id == folder_id).first()


def _requirement_folder_descendant_ids(db: Session, folder_id: int) -> set:
    """Ids of a folder plus all of its descendants (for cycle prevention)."""
    ids = {folder_id}
    frontier = [folder_id]
    while frontier:
        children = (
            db.query(RequirementFolder.id)
            .filter(RequirementFolder.parent_folder_id.in_(frontier))
            .all()
        )
        next_frontier = [cid for (cid,) in children if cid not in ids]
        ids.update(next_frontier)
        frontier = next_frontier
    return ids


def create_requirement_folder(db: Session, folder: "schemas.RequirementFolderCreate"):
    db_folder = RequirementFolder(
        name=folder.name.strip(),
        description=(folder.description or None),
        project_id=folder.project_id,
        parent_folder_id=folder.parent_folder_id,
    )
    db.add(db_folder)
    safe_commit(db)
    db.refresh(db_folder)
    db_folder.requirement_count = 0
    return db_folder


def update_requirement_folder(db: Session, folder_id: int, folder: "schemas.RequirementFolderUpdate"):
    db_folder = get_requirement_folder(db, folder_id)
    if not db_folder:
        return None
    update_data = folder.model_dump(exclude_unset=True)
    if "name" in update_data and update_data["name"]:
        db_folder.name = update_data["name"].strip()
    if "description" in update_data:
        db_folder.description = update_data["description"] or None
    if "parent_folder_id" in update_data:
        db_folder.parent_folder_id = update_data["parent_folder_id"]
    safe_commit(db)
    db.refresh(db_folder)
    counts = _requirement_folder_counts(db, db_folder.project_id)
    db_folder.requirement_count = counts.get(db_folder.id, 0)
    return db_folder


def delete_requirement_folder(db: Session, folder_id: int):
    """Delete a folder, moving its child folders and any filed requirements up
    to the deleted folder's parent (so nothing becomes orphaned/invisible)."""
    db_folder = get_requirement_folder(db, folder_id)
    if not db_folder:
        return False
    new_parent = db_folder.parent_folder_id
    db.query(RequirementFolder).filter(
        RequirementFolder.parent_folder_id == folder_id
    ).update({RequirementFolder.parent_folder_id: new_parent}, synchronize_session=False)
    db.query(Requirement).filter(
        Requirement.folder_id == folder_id
    ).update({Requirement.folder_id: new_parent}, synchronize_session=False)
    db.delete(db_folder)
    safe_commit(db)
    return True


# --- Requirement project-wide AI chat --------------------------------------

_UNSET = object()

def create_chat_conversation(db: Session, project_id: int, created_by: int, title: str = "New conversation"):
    conversation = RequirementChatConversation(
        project_id=project_id,
        created_by=created_by,
        title=(title or "New conversation")[:255],
    )
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    return conversation


def get_chat_conversations(db: Session, project_id: int, created_by: int,
                           archived: bool = False, skip: int = 0, limit: int = 100):
    return (
        db.query(RequirementChatConversation)
        .filter(
            RequirementChatConversation.project_id == project_id,
            RequirementChatConversation.created_by == created_by,
            RequirementChatConversation.archived == archived,
        )
        .order_by(RequirementChatConversation.pinned.desc(), RequirementChatConversation.updated_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )


def get_chat_conversation_by_public_id(db: Session, public_id: str):
    return (
        db.query(RequirementChatConversation)
        .filter(RequirementChatConversation.public_id == public_id)
        .first()
    )


def update_chat_conversation(db: Session, conversation_id: int,
                             title: Optional[str] = None, archived: Optional[bool] = None,
                             share_scope: Optional[str] = None,
                             pinned: Optional[bool] = None,
                             share_expires_at=_UNSET,
                             share_allowed_user_ids=_UNSET):
    conversation = get_chat_conversation(db, conversation_id)
    if conversation is None:
        return None
    if title is not None:
        conversation.title = title[:255]
    if archived is not None:
        conversation.archived = archived
    if pinned is not None:
        conversation.pinned = pinned
    if share_scope is not None:
        conversation.share_scope = share_scope
    if share_expires_at is not _UNSET or share_scope == "private":
        conversation.share_expires_at = share_expires_at
    if share_allowed_user_ids is not _UNSET or share_scope in {"private", "project"}:
        conversation.share_allowed_user_ids = share_allowed_user_ids
    db.commit()
    db.refresh(conversation)
    return conversation


def get_chat_conversation(db: Session, conversation_id: int):
    return (
        db.query(RequirementChatConversation)
        .filter(RequirementChatConversation.id == conversation_id)
        .first()
    )


def add_chat_message(db: Session, conversation_id: int, role: str, content: str,
                     sources: Optional[list] = None, prompt_tokens: Optional[int] = None):
    message = RequirementChatMessage(
        conversation_id=conversation_id,
        role=role,
        content=content,
        sources=sources if sources is not None else [],
        prompt_tokens=prompt_tokens,
    )
    db.add(message)
    # Touch the parent so conversation lists sort by latest activity.
    conversation = get_chat_conversation(db, conversation_id)
    if conversation is not None:
        conversation.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(message)
    return message


def delete_chat_messages(db: Session, message_ids: list):
    if not message_ids:
        return 0
    deleted = (
        db.query(RequirementChatMessage)
        .filter(RequirementChatMessage.id.in_(message_ids))
        .delete(synchronize_session=False)
    )
    db.commit()
    return deleted


def delete_chat_conversation(db: Session, conversation_id: int):
    conversation = get_chat_conversation(db, conversation_id)
    if conversation is None:
        return None
    db.delete(conversation)
    db.commit()
    return conversation


def create_requirement(db: Session, requirement: RequirementCreate):
    # Validate estimated_effort
    if requirement.estimated_effort is not None and requirement.estimated_effort < 0:
        raise ValueError("Estimated effort must be a positive number")
    
    # Create the requirement object
    db_requirement = Requirement()
    db_requirement.title = requirement.title
    db_requirement.description = requirement.description
    db_requirement.requirement_id = requirement.requirement_id
    db_requirement.project_id = requirement.project_id
    db_requirement.created_by = requirement.created_by
    
    # Handle optional fields
    if requirement.parent_requirement_id:
        db_requirement.parent_requirement_id = requirement.parent_requirement_id
    if requirement.folder_id:
        db_requirement.folder_id = requirement.folder_id
    if requirement.assigned_to:
        db_requirement.assigned_to = requirement.assigned_to
    if requirement.tags:
        db_requirement.tags = requirement.tags
    if requirement.acceptance_criteria:
        db_requirement.acceptance_criteria = requirement.acceptance_criteria
    if requirement.estimated_effort is not None:
        # `is not None` (not truthiness) so a legitimate 0 is stored, not dropped.
        db_requirement.estimated_effort = requirement.estimated_effort
    
    # Handle enums - convert to proper enum objects
    if requirement.status:
        db_requirement.status = RequirementStatus(requirement.status)
    if requirement.priority:
        db_requirement.priority = Priority(requirement.priority)
    
    db.add(db_requirement)
    safe_commit(db)
    db.refresh(db_requirement)

    # Seed the version history with the initial state. Never let a history
    # failure roll back the requirement that was just created.
    try:
        record_requirement_version(
            db, db_requirement, action="created", actor_id=db_requirement.created_by
        )
    except Exception:
        db.rollback()

    return db_requirement


def update_requirement(
    db: Session,
    requirement_id: int,
    requirement: RequirementUpdate,
    actor_id: Optional[int] = None,
):
    db_requirement = db.query(Requirement).filter(Requirement.id == requirement_id).first()
    if db_requirement:
        update_data = requirement.model_dump(exclude_unset=True)

        # Handle enum conversions
        if 'status' in update_data and update_data['status'] is not None:
            update_data['status'] = RequirementStatus(update_data['status'])
        if 'priority' in update_data and update_data['priority'] is not None:
            update_data['priority'] = Priority(update_data['priority'])

        # Validate estimated_effort
        if 'estimated_effort' in update_data and update_data['estimated_effort'] is not None:
            if update_data['estimated_effort'] < 0:
                raise ValueError("Estimated effort must be a positive number")

        for key, value in update_data.items():
            setattr(db_requirement, key, value)
        safe_commit(db)
        db.refresh(db_requirement)

        # Snapshot the new state for version history.
        try:
            record_requirement_version(
                db, db_requirement, action="updated", actor_id=actor_id
            )
        except Exception:
            db.rollback()
    return db_requirement


def delete_requirement(db: Session, requirement_id: int):
    db_requirement = db.query(Requirement).filter(Requirement.id == requirement_id).first()
    if db_requirement:
        from ..models import TraceabilityMatrix, requirement_test_case_links

        # Detach child requirements so their parent FK does not dangle.
        db.query(Requirement).filter(
            Requirement.parent_requirement_id == requirement_id
        ).update({Requirement.parent_requirement_id: None}, synchronize_session=False)

        # Remove every association / traceability row that references this
        # requirement, otherwise the rows are orphaned (or the delete 500s
        # when foreign keys are enforced).
        db.execute(
            requirement_test_plan_links.delete().where(
                requirement_test_plan_links.c.requirement_id == requirement_id
            )
        )
        db.execute(
            requirement_test_case_links.delete().where(
                requirement_test_case_links.c.requirement_id == requirement_id
            )
        )
        db.query(TraceabilityMatrix).filter(
            TraceabilityMatrix.requirement_id == requirement_id
        ).delete(synchronize_session=False)

        db.delete(db_requirement)
        safe_commit(db)
    return db_requirement
