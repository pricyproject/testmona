from sqlalchemy.orm import Session, joinedload, noload, selectinload
from sqlalchemy.orm.attributes import set_committed_value
from sqlalchemy import and_, case, func, or_, select, text
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
from .requirements import *
from .defects_planning import *
import logging

logger = logging.getLogger(__name__)

def create_notification(db: Session, notification: NotificationCreate):
    db_notification = Notification(**notification.model_dump())
    db.add(db_notification)
    safe_commit(db)
    db.refresh(db_notification)
    return db_notification


def get_notifications(db: Session, user_id: int, skip: int = 0, limit: int = 100):
    return db.query(Notification).filter(Notification.user_id == user_id).order_by(Notification.created_at.desc()).offset(skip).limit(limit).all()


def get_notification(db: Session, notification_id: int):
    return db.query(Notification).filter(Notification.id == notification_id).first()


def update_notification(db: Session, notification_id: int, notification: NotificationUpdate):
    db_notification = db.query(Notification).filter(Notification.id == notification_id).first()
    if db_notification:
        update_data = notification.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_notification, field, value)
        safe_commit(db)
        db.refresh(db_notification)
    return db_notification


def is_active_inbox_notification(notification: "Notification", actionable_categories: List[str]) -> bool:
    """Return whether a notification is active Work Inbox work.

    Bell cleanup/delete actions must not remove actionable work before the user
    deliberately marks it done in the inbox. Done items are archived, so they may
    still be removed from notification history.
    """
    return bool(
        notification
        and notification.category in actionable_categories
        and notification.archived is False
    )


def delete_notification(db: Session, notification_id: int):
    db_notification = db.query(Notification).filter(Notification.id == notification_id).first()
    if db_notification:
        db.delete(db_notification)
        safe_commit(db)
    return db_notification


def get_unread_notification_count(db: Session, user_id: int):
    return db.query(Notification).filter(Notification.user_id == user_id, Notification.is_read == False).count()


def mark_all_notifications_as_read(db: Session, user_id: int):
    result = db.query(Notification).filter(Notification.user_id == user_id, Notification.is_read == False).update({"is_read": True})
    safe_commit(db)
    return result


def delete_old_notifications(db: Session, user_id: int, days_old: int = 30):
    """Delete notifications older than specified days for a user"""
    from datetime import datetime, timedelta
    cutoff_date = datetime.now() - timedelta(days=days_old)
    result = db.query(Notification).filter(
        Notification.user_id == user_id,
        Notification.created_at < cutoff_date,
        Notification.is_read == True  # Only delete read notifications
    ).delete()
    safe_commit(db)
    return result


def delete_old_done_inbox_notifications(
    db: Session,
    user_id: int,
    actionable_categories: List[str],
    days_old: int = 90,
):
    """Delete old done Work Inbox items for a user.

    This is separate from generic read-notification cleanup because inbox work is
    finished by ``archived/done_at``, not by ``is_read``.
    """
    if not actionable_categories:
        return 0
    cutoff_date = datetime.now(timezone.utc) - timedelta(days=days_old)
    result = db.query(Notification).filter(
        Notification.user_id == user_id,
        Notification.category.in_(actionable_categories),
        Notification.archived == True,  # noqa: E712
        Notification.done_at.isnot(None),
        Notification.done_at < cutoff_date,
    ).delete(synchronize_session=False)
    safe_commit(db)
    return result


def mark_notification_as_unread(db: Session, notification_id: int):
    """Mark a specific notification as unread"""
    db_notification = db.query(Notification).filter(Notification.id == notification_id).first()
    if db_notification:
        db_notification.is_read = False
        safe_commit(db)
        db.refresh(db_notification)
    return db_notification


def delete_all_notifications(
    db: Session,
    user_id: int,
    protected_categories: Optional[List[str]] = None,
):
    """Delete all bell notifications while preserving active Work Inbox items."""
    query = db.query(Notification).filter(Notification.user_id == user_id)
    if protected_categories:
        query = query.filter(
            or_(
                Notification.category.is_(None),
                Notification.category.notin_(protected_categories),
                Notification.archived == True,  # noqa: E712
            )
        )
    result = query.delete(synchronize_session=False)
    safe_commit(db)
    return result


def get_notifications_filtered(db: Session, user_id: int, notification_type: str = None, skip: int = 0, limit: int = 100):
    """Get notifications filtered by type"""
    from ..models import NotificationType
    query = db.query(Notification).filter(Notification.user_id == user_id)
    if notification_type:
        # Validate the type against allowed values
        allowed_types = ['info', 'success', 'warning', 'error']
        if notification_type.lower() not in allowed_types:
            return []
        # Compare against uppercase since SQLite stores enums as uppercase strings
        query = query.filter(Notification.type == notification_type.upper())
    return query.order_by(Notification.created_at.desc()).offset(skip).limit(limit).all()


def search_notifications(db: Session, user_id: int, search_query: str, skip: int = 0, limit: int = 100):
    """Search notifications by title or message"""
    if not search_query or not search_query.strip():
        return []
    # Escape SQL wildcard characters to prevent SQL injection
    escaped_query = search_query.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
    query = db.query(Notification).filter(
        Notification.user_id == user_id,
        (Notification.title.ilike(f'%{escaped_query}%', escape='\\')) | (Notification.message.ilike(f'%{escaped_query}%', escape='\\'))
    )
    return query.order_by(Notification.created_at.desc()).offset(skip).limit(limit).all()


def get_notifications_filtered_and_searched(db: Session, user_id: int, notification_type: str = None, search_query: str = None, skip: int = 0, limit: int = 100):
    """Get notifications filtered by type and search query"""
    from ..models import NotificationType
    query = db.query(Notification).filter(Notification.user_id == user_id)
    
    if notification_type:
        # Validate the type against allowed values
        allowed_types = ['info', 'success', 'warning', 'error']
        if notification_type.lower() not in allowed_types:
            return []
        # Compare against uppercase since SQLite stores enums as uppercase strings
        query = query.filter(Notification.type == notification_type.upper())
    
    if search_query and search_query.strip():
        # Escape SQL wildcard characters to prevent SQL injection
        escaped_query = search_query.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
        query = query.filter(
            (Notification.title.ilike(f'%{escaped_query}%', escape='\\')) | (Notification.message.ilike(f'%{escaped_query}%', escape='\\'))
        )
    
    return query.order_by(Notification.created_at.desc()).offset(skip).limit(limit).all()


def bulk_update_notifications(db: Session, user_id: int, notification_ids: List[int], is_read: bool = None):
    """Bulk update notifications (mark as read/unread)"""
    query = db.query(Notification).filter(
        Notification.user_id == user_id,
        Notification.id.in_(notification_ids)
    )
    result = 0
    if is_read is not None:
        result = query.update({"is_read": is_read}, synchronize_session=False)
    safe_commit(db)
    return result


def bulk_delete_notifications(
    db: Session,
    user_id: int,
    notification_ids: List[int],
    protected_categories: Optional[List[str]] = None,
):
    """Bulk delete bell notifications, skipping active Work Inbox items."""
    query = db.query(Notification).filter(
        Notification.user_id == user_id,
        Notification.id.in_(notification_ids)
    )
    if protected_categories:
        query = query.filter(
            or_(
                Notification.category.is_(None),
                Notification.category.notin_(protected_categories),
                Notification.archived == True,  # noqa: E712
            )
        )
    result = query.delete(synchronize_session=False)
    safe_commit(db)
    return result


# --- Work Inbox -------------------------------------------------------------
# The inbox is the subset of a user's notifications whose category the
# notification engine marks "actionable". ``open`` items are not archived;
# ``done`` items have been archived (handled) but kept for history.

def _open_inbox_clauses(now: Optional[datetime] = None):
    """The "open Work Inbox" predicate as reusable SQLAlchemy filter clauses.

    A notification is in the open inbox iff it is NOT archived AND not currently
    snoozed (no snooze set, or the snooze has already elapsed). The *actionable*
    (category) and *user* parts of the predicate are applied by each caller since
    they need per-call parameters; everything else lives here so the list, the
    summary counts, and the bulk triage actions can never drift apart on what
    "open" means.
    """
    if now is None:
        now = datetime.now(timezone.utc)
    return (
        Notification.archived == False,  # noqa: E712
        or_(Notification.snoozed_until.is_(None), Notification.snoozed_until <= now),
    )


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _apply_inbox_filters(
    query,
    actionable_categories: List[str],
    status: str = "open",
    category: Optional[str] = None,
    unread_only: bool = False,
    search: Optional[str] = None,
    actor_id: Optional[int] = None,
    project_id: Optional[int] = None,
    actor_joined: bool = False,
):
    if category:
        if category not in actionable_categories:
            return None
        query = query.filter(Notification.category == category)
    if status == "open":
        query = query.filter(*_open_inbox_clauses())
    elif status == "snoozed":
        query = query.filter(
            Notification.archived == False,  # noqa: E712
            Notification.snoozed_until.isnot(None),
            Notification.snoozed_until > datetime.now(timezone.utc),
        )
    elif status == "done":
        query = query.filter(Notification.archived == True)  # noqa: E712
    if unread_only:
        query = query.filter(Notification.is_read == False)  # noqa: E712
    if actor_id is not None:
        query = query.filter(Notification.actor_id == actor_id)
    if project_id is not None:
        query = _apply_inbox_project_filter(query, project_id)
    if search and search.strip():
        term = f"%{_escape_like(search.strip())}%"
        if not actor_joined:
            query = query.outerjoin(User, User.id == Notification.actor_id)
        query = query.filter(
            or_(
                Notification.title.ilike(term, escape="\\"),
                Notification.message.ilike(term, escape="\\"),
                User.full_name.ilike(term, escape="\\"),
                User.username.ilike(term, escape="\\"),
            )
        )
    return query


def _apply_inbox_project_filter(query, project_id: int):
    """Narrow notifications to a related entity owned by ``project_id``.

    Notifications intentionally store loose entity references, so project scoping
    is expressed as a small OR ladder over the entity tables the inbox supports.
    """
    models = _inbox_project_models()
    clauses = [
        and_(
            Notification.related_entity_type == "project",
            Notification.related_entity_id == project_id,
        )
    ]
    for entity_type, model in models.items():
        clauses.append(
            and_(
                Notification.related_entity_type.in_((entity_type, f"{entity_type}_change")),
                Notification.related_entity_id.in_(
                    select(model.id).where(model.project_id == project_id)
                ),
            )
        )
    return query.filter(or_(*clauses))


def get_inbox_notifications(
    db: Session,
    user_id: int,
    actionable_categories: List[str],
    status: str = "open",
    category: Optional[str] = None,
    unread_only: bool = False,
    search: Optional[str] = None,
    actor_id: Optional[int] = None,
    project_id: Optional[int] = None,
    sort: str = "newest",
    skip: int = 0,
    limit: int = 50,
):
    """List a user's Work Inbox items.

    ``status`` is one of ``open`` (actionable, not archived, not currently
    snoozed), ``snoozed`` (not archived, snoozed into the future), ``done``
    (archived), or ``all``. ``category`` optionally narrows to a single actionable
    category, ``actor_id``, ``search``, and ``unread_only`` narrow the server-side
    result set before pagination. ``sort`` is ``newest`` (default) or ``oldest`` —
    ordering by ``created_at`` so "oldest first" surfaces the most-aged work and
    paginates correctly server-side.
    """
    if not actionable_categories:
        return []
    query = db.query(Notification).filter(
        Notification.user_id == user_id,
        Notification.category.in_(actionable_categories),
    )
    query = _apply_inbox_filters(
        query, actionable_categories, status, category, unread_only, search, actor_id, project_id
    )
    if query is None:
        return []
    order = Notification.created_at.asc() if sort == "oldest" else Notification.created_at.desc()
    return (
        query.order_by(order)
        .offset(skip)
        .limit(limit)
        .all()
    )


def get_inbox_actor_options(
    db: Session,
    user_id: int,
    actionable_categories: List[str],
    status: str = "open",
    category: Optional[str] = None,
    unread_only: bool = False,
    search: Optional[str] = None,
    project_id: Optional[int] = None,
):
    """Return every actor represented in the current inbox filter, not just the page."""
    if not actionable_categories:
        return []
    query = db.query(Notification).join(User, User.id == Notification.actor_id).filter(
        Notification.user_id == user_id,
        Notification.category.in_(actionable_categories),
        Notification.actor_id.isnot(None),
    )
    query = _apply_inbox_filters(
        query, actionable_categories, status, category, unread_only, search, project_id=project_id, actor_joined=True
    )
    if query is None:
        return []
    rows = (
        query.with_entities(User.id, User.full_name, User.username)
        .distinct()
        .all()
    )
    return sorted(
        ((uid, full_name or username) for uid, full_name, username in rows if full_name or username),
        key=lambda row: row[1].lower(),
    )


def get_inbox_project_options(
    db: Session,
    user_id: int,
    actionable_categories: List[str],
    status: str = "open",
    category: Optional[str] = None,
    unread_only: bool = False,
    search: Optional[str] = None,
    actor_id: Optional[int] = None,
):
    """Return projects represented in the current inbox filter."""
    if not actionable_categories:
        return []
    query = db.query(Notification).filter(
        Notification.user_id == user_id,
        Notification.category.in_(actionable_categories),
    )
    query = _apply_inbox_filters(query, actionable_categories, status, category, unread_only, search, actor_id)
    if query is None:
        return []
    notifications = query.all()
    resolve_inbox_projects(db, notifications)
    projects = {
        n.project_id: n.project_name
        for n in notifications
        if getattr(n, "project_id", None) is not None and getattr(n, "project_name", None)
    }
    return sorted(projects.items(), key=lambda row: row[1].lower())


def resolve_actor_names(db: Session, notifications: List["Notification"]) -> None:
    """Attach an ``actor_name`` display string to each notification in place.

    Bulk-loads the actor users for a page in one query (no N+1) and sets a
    transient ``actor_name`` attribute the API schema serializes. Notifications
    with no actor, or whose actor was deleted, simply get ``None``.
    """
    actor_ids = {n.actor_id for n in notifications if getattr(n, "actor_id", None)}
    names: dict = {}
    if actor_ids:
        rows = (
            db.query(User.id, User.full_name, User.username)
            .filter(User.id.in_(actor_ids))
            .all()
        )
        names = {uid: (full_name or username) for uid, full_name, username in rows}
    for n in notifications:
        n.actor_name = names.get(getattr(n, "actor_id", None))


def _inbox_project_models():
    """Map of inbox entity type -> model with a direct ``project_id`` column.

    ``Doc`` is imported lazily to keep this module's (already huge) top-level
    model import list unchanged and sidestep import ordering. The ``project``
    entity type isn't here — it *is* its own project id (handled in the caller).
    """
    from ..models import Doc

    return {
        "requirement": Requirement,
        "defect": Defect,
        "test_case": TestCase,
        "test_plan": TestPlan,
        "test_run": TestRun,
        "doc": Doc,
    }


def resolve_inbox_projects(db: Session, notifications: List["Notification"]) -> None:
    """Attach transient ``project_id``/``project_name`` to each notification.

    Notifications store only ``(related_entity_type, related_entity_id)``; the
    Work Inbox "group by project" view needs the owning project. We batch one
    query per entity type (no N+1) to map each entity to its ``project_id``, then
    a single query to name those projects. The ``*_change`` watch variants share
    their base type's model, the ``project`` entity type is its own id, and
    anything unresolvable (or a deleted entity) is left as ``None``.
    """
    models = _inbox_project_models()

    def base_type(t):
        return t[:-7] if t and t.endswith("_change") else t

    # Collect entity ids to resolve, grouped by model.
    by_model: dict = {}
    for n in notifications:
        n.project_id = None
        n.project_name = None
        etype = base_type(getattr(n, "related_entity_type", None))
        eid = getattr(n, "related_entity_id", None)
        if eid is None or etype == "project":
            continue
        model = models.get(etype)
        if model is not None:
            by_model.setdefault(model, set()).add(eid)

    resolved: dict = {}
    for model, ids in by_model.items():
        for eid, pid in db.query(model.id, model.project_id).filter(model.id.in_(ids)).all():
            resolved[(model, eid)] = pid

    project_ids = set()
    for n in notifications:
        etype = base_type(getattr(n, "related_entity_type", None))
        eid = getattr(n, "related_entity_id", None)
        if eid is None:
            continue
        if etype == "project":
            n.project_id = eid
        else:
            model = models.get(etype)
            if model is not None:
                n.project_id = resolved.get((model, eid))
        if n.project_id is not None:
            project_ids.add(n.project_id)

    if project_ids:
        names = dict(
            db.query(Project.id, Project.name).filter(Project.id.in_(project_ids)).all()
        )
        for n in notifications:
            if n.project_id is not None:
                n.project_name = names.get(n.project_id)


def get_inbox_summary(db: Session, user_id: int, actionable_categories: List[str]):
    """Return per-category open/snoozed/done/unread counts and matching totals.

    Counting open, snoozed and done per category lets the inbox rail show
    meaningful filters in any view and hide categories that have nothing in them.
    Only currently-open items (not archived, not snoozed — the shared
    :func:`_open_inbox_clauses` predicate) feed the open totals/badges; a snoozed
    item is deferred work and a done item is finished, so neither is "open".
    ``unread`` counts only open items the user hasn't seen yet.

    Returns ``(total_open, total_unread, total_snoozed, per_category)``.
    """
    if not actionable_categories:
        return 0, 0, 0, {}
    now = datetime.now(timezone.utc)
    # 1 = not archived but snoozed into the future; archived rows are "done"
    # regardless and are bucketed first below.
    snoozed_flag = case(
        (
            and_(
                Notification.snoozed_until.isnot(None),
                Notification.snoozed_until > now,
            ),
            1,
        ),
        else_=0,
    )
    rows = (
        db.query(
            Notification.category,
            Notification.archived,
            snoozed_flag.label("snoozed"),
            func.count(Notification.id),
            func.sum(case((Notification.is_read == False, 1), else_=0)),  # noqa: E712
        )
        .filter(
            Notification.user_id == user_id,
            Notification.category.in_(actionable_categories),
        )
        .group_by(Notification.category, Notification.archived, snoozed_flag)
        .all()
    )
    per_category: dict = {}
    for cat, archived, snoozed, count, unread in rows:
        entry = per_category.setdefault(
            cat, {"open": 0, "snoozed": 0, "done": 0, "unread": 0}
        )
        n = int(count or 0)
        if archived:
            entry["done"] += n
        elif snoozed:
            entry["snoozed"] += n
        else:
            entry["open"] += n
            entry["unread"] += int(unread or 0)
    total_open = sum(v["open"] for v in per_category.values())
    total_unread = sum(v["unread"] for v in per_category.values())
    total_snoozed = sum(v["snoozed"] for v in per_category.values())
    return total_open, total_unread, total_snoozed, per_category


def set_notification_archived(db: Session, notification_id: int, archived: bool):
    """Mark a single notification archived (done) or restore it to the inbox.

    Archiving stamps ``done_at``; restoring clears it, so the timestamp always
    tracks whether the item is currently in the done state.
    """
    db_notification = db.query(Notification).filter(Notification.id == notification_id).first()
    if db_notification:
        db_notification.archived = archived
        db_notification.done_at = datetime.now(timezone.utc) if archived else None
        safe_commit(db)
        db.refresh(db_notification)
    return db_notification


def archive_inbox_notifications(
    db: Session,
    user_id: int,
    actionable_categories: List[str],
    category: Optional[str] = None,
):
    """Archive (mark done) every currently-open inbox item, optionally one
    category only.

    Operates on the visible open set (shared :func:`_open_inbox_clauses`
    predicate) so snoozed items are left untouched. An unknown ``category`` is a
    no-op (returns 0) rather than silently widening the scope to every category.
    """
    if category is not None and category not in actionable_categories:
        return 0
    query = db.query(Notification).filter(
        Notification.user_id == user_id,
        Notification.category.in_(actionable_categories),
        *_open_inbox_clauses(),
    )
    if category:
        query = query.filter(Notification.category == category)
    result = query.update(
        {"archived": True, "done_at": datetime.now(timezone.utc)},
        synchronize_session=False,
    )
    safe_commit(db)
    return result


def mark_inbox_all_read(
    db: Session,
    user_id: int,
    actionable_categories: List[str],
    category: Optional[str] = None,
):
    """Mark every currently-open inbox item read, optionally scoped to one
    category.

    Operates on the visible open set (shared :func:`_open_inbox_clauses`
    predicate). An unknown ``category`` is a no-op (returns 0) rather than marking
    everything.
    """
    if category is not None and category not in actionable_categories:
        return 0
    query = db.query(Notification).filter(
        Notification.user_id == user_id,
        Notification.category.in_(actionable_categories),
        Notification.is_read == False,  # noqa: E712
        *_open_inbox_clauses(),
    )
    if category:
        query = query.filter(Notification.category == category)
    result = query.update({"is_read": True}, synchronize_session=False)
    safe_commit(db)
    return result


def unsnooze_inbox_notifications(
    db: Session,
    user_id: int,
    actionable_categories: List[str],
    category: Optional[str] = None,
):
    """Clear every future snooze in the user's inbox, optionally by category."""
    if category is not None and category not in actionable_categories:
        return 0
    query = db.query(Notification).filter(
        Notification.user_id == user_id,
        Notification.category.in_(actionable_categories),
        Notification.archived == False,  # noqa: E712
        Notification.snoozed_until.isnot(None),
        Notification.snoozed_until > datetime.now(timezone.utc),
    )
    if category:
        query = query.filter(Notification.category == category)
    result = query.update({"snoozed_until": None}, synchronize_session=False)
    safe_commit(db)
    return result


def snooze_notification(db: Session, notification_id: int, until: datetime):
    """Defer a single notification until ``until`` (Open → Snoozed).

    A snoozed item drops out of the open inbox (see :func:`_open_inbox_clauses`)
    until the time passes. Snoozing never archives, and clears any prior
    ``done_at`` so a restored-then-snoozed item is consistently "not done".
    """
    db_notification = db.query(Notification).filter(Notification.id == notification_id).first()
    if db_notification:
        db_notification.snoozed_until = until
        db_notification.archived = False
        db_notification.done_at = None
        safe_commit(db)
        db.refresh(db_notification)
    return db_notification


def unsnooze_notification(db: Session, notification_id: int):
    """Clear a notification's snooze, returning it to the open inbox immediately."""
    db_notification = db.query(Notification).filter(Notification.id == notification_id).first()
    if db_notification:
        db_notification.snoozed_until = None
        safe_commit(db)
        db.refresh(db_notification)
    return db_notification


def sweep_due_snoozes(db: Session, user_id: Optional[int] = None):
    """Clear elapsed snoozes so due items rejoin the open inbox.

    The open predicate already treats an elapsed snooze as open, so this is a
    lazy tidy-up rather than a correctness requirement: nulling
    ``snoozed_until`` keeps the dedicated "Snoozed" view and its counts honest.
    When ``user_id`` is omitted every elapsed snooze is swept, so inactive users do
    not retain stale snooze timestamps indefinitely while the app is in use.
    Returns how many rows resurfaced.
    """
    now = datetime.now(timezone.utc)
    query = db.query(Notification).filter(
        Notification.snoozed_until.isnot(None),
        Notification.snoozed_until <= now,
    )
    if user_id is not None:
        query = query.filter(Notification.user_id == user_id)
    result = query.update({"snoozed_until": None}, synchronize_session=False)
    if result:
        safe_commit(db)
    return result


def bulk_inbox_action(
    db: Session,
    user_id: int,
    notification_ids: List[int],
    action: str,
    actionable_categories: List[str],
    until: Optional[datetime] = None,
):
    """Apply one triage ``action`` to a set of the user's inbox items at once.

    Scoped to the caller's own actionable notifications, so an id that isn't
    theirs (or isn't an inbox category) is silently skipped rather than touched.
    ``snooze`` requires ``until``. Returns the number of rows actually updated.
    """
    if not notification_ids or not actionable_categories:
        return 0
    query = db.query(Notification).filter(
        Notification.id.in_(notification_ids),
        Notification.user_id == user_id,
        Notification.category.in_(actionable_categories),
    )
    now = datetime.now(timezone.utc)
    if action == "archive":
        values = {"archived": True, "done_at": now}
    elif action == "unarchive":
        values = {"archived": False, "done_at": None}
    elif action == "read":
        values = {"is_read": True}
    elif action == "unread":
        values = {"is_read": False}
    elif action == "snooze":
        if until is None:
            raise ValueError("until is required when action is 'snooze'")
        values = {"snoozed_until": until, "archived": False, "done_at": None}
    else:
        return 0
    result = query.update(values, synchronize_session=False)
    safe_commit(db)
    return result


# Analytics and Reporting CRUD functions

# KPI Data CRUD
def create_kpi_data(db: Session, kpi_data: KPIDataCreate):
    db_kpi = KPIData(**kpi_data.model_dump())
    db.add(db_kpi)
    safe_commit(db)
    db.refresh(db_kpi)
    return db_kpi


def get_kpi_data(db: Session, project_id: int, metric_type: str = None, time_period: str = None, skip: int = 0, limit: int = 100):
    query = db.query(KPIData).filter(KPIData.project_id == project_id)
    if metric_type:
        query = query.filter(KPIData.metric_type == metric_type)
    if time_period:
        query = query.filter(KPIData.time_period == time_period)
    return query.order_by(KPIData.recorded_at.desc()).offset(skip).limit(limit).all()


def get_latest_kpi_data(db: Session, project_id: int, metric_types: List[str] = None):
    query = db.query(KPIData).filter(KPIData.project_id == project_id)
    if metric_types:
        query = query.filter(KPIData.metric_type.in_(metric_types))
    
    # Get latest record for each metric type
    latest_records = []
    for metric_type in metric_types or ["coverage", "pass_rate", "failure_trends", "flakiness", "cycle_time"]:
        latest = query.filter(KPIData.metric_type == metric_type).order_by(KPIData.recorded_at.desc()).first()
        if latest:
            latest_records.append(latest)
    
    return latest_records


# Test Step Results CRUD
def create_test_step_result(db: Session, step_result: TestStepResultCreate):
    db_step = TestStepResult(**step_result.model_dump())
    db.add(db_step)
    safe_commit(db)
    db.refresh(db_step)
    return db_step


def get_test_step_results(db: Session, project_id: int = None, test_run_id: int = None, test_case_id: int = None, 
                         filter_type: str = "all", skip: int = 0, limit: int = 100):
    query = db.query(TestStepResult).join(TestResult).join(TestCase)
    
    if project_id:
        query = query.join(TestSuite).filter(TestSuite.project_id == project_id)
    if test_run_id:
        query = query.filter(TestResult.test_run_id == test_run_id)
    if test_case_id:
        query = query.filter(TestResult.test_case_id == test_case_id)
    
    if filter_type == "failed":
        query = query.filter(TestStepResult.step_status == "failed")
    elif filter_type == "slow":
        query = query.filter(TestStepResult.step_duration > 5.0)  # Steps taking more than 5 seconds
    
    return query.order_by(TestStepResult.created_at.desc()).offset(skip).limit(limit).all()


def get_test_step_results_by_test_result(db: Session, test_result_id: int):
    return db.query(TestStepResult).filter(TestStepResult.test_result_id == test_result_id).order_by(TestStepResult.step_number).all()


def replace_test_step_results(db: Session, test_result_id: int, step_results: list):
    """Replace all per-step results for a test result with the provided list.

    Used by the execution page to record each step's outcome in one shot.
    """
    db.query(TestStepResult).filter(TestStepResult.test_result_id == test_result_id).delete()
    for item in step_results:
        data = item.model_dump() if hasattr(item, "model_dump") else dict(item)
        data.pop("test_result_id", None)
        db.add(TestStepResult(test_result_id=test_result_id, **data))
    safe_commit(db)
    return get_test_step_results_by_test_result(db, test_result_id)


# Shareable Reports CRUD
def create_shareable_report(db: Session, report: ShareableReportCreate, created_by: int):
    import secrets
    share_token = secrets.token_urlsafe(32)
    
    db_report = ShareableReport(**report.model_dump(), share_token=share_token, created_by=created_by)
    db.add(db_report)
    safe_commit(db)
    db.refresh(db_report)
    return db_report


def get_shareable_reports(db: Session, project_id: int, created_by: int = None, skip: int = 0, limit: int = 100):
    query = db.query(ShareableReport).filter(ShareableReport.project_id == project_id, ShareableReport.is_active == True)
    if created_by:
        query = query.filter(ShareableReport.created_by == created_by)
    return query.order_by(ShareableReport.created_at.desc()).offset(skip).limit(limit).all()


def get_shareable_report(db: Session, report_id: int):
    return db.query(ShareableReport).filter(ShareableReport.id == report_id).first()


def get_shareable_report_by_token(db: Session, share_token: str):
    report = db.query(ShareableReport).filter(ShareableReport.share_token == share_token, ShareableReport.is_active == True).first()
    return report


def record_shareable_report_view(db: Session, report: ShareableReport):
    if report:
        report.view_count = (report.view_count or 0) + 1
        report.last_viewed = func.now()
        safe_commit(db)
    return report


def update_shareable_report(db: Session, report_id: int, report_data: dict):
    db_report = db.query(ShareableReport).filter(ShareableReport.id == report_id).first()
    if db_report:
        for key, value in report_data.items():
            setattr(db_report, key, value)
        safe_commit(db)
        db.refresh(db_report)
    return db_report


def deactivate_shareable_report(db: Session, report_id: int):
    db_report = db.query(ShareableReport).filter(ShareableReport.id == report_id).first()
    if db_report:
        db_report.is_active = False
        safe_commit(db)
        db.refresh(db_report)
    return db_report


# Root Cause Analysis CRUD
def create_root_cause_analysis(db: Session, analysis: RootCauseAnalysisCreate):
    db_analysis = RootCauseAnalysis(**analysis.model_dump())
    db.add(db_analysis)
    safe_commit(db)
    db.refresh(db_analysis)
    return db_analysis


def get_root_cause_analyses(db: Session, project_id: int, requirement_id: int = None, test_case_id: int = None, 
                           defect_id: int = None, status: str = None, skip: int = 0, limit: int = 100):
    query = db.query(RootCauseAnalysis).filter(RootCauseAnalysis.project_id == project_id)
    if requirement_id:
        query = query.filter(RootCauseAnalysis.requirement_id == requirement_id)
    if test_case_id:
        query = query.filter(RootCauseAnalysis.test_case_id == test_case_id)
    if defect_id:
        query = query.filter(RootCauseAnalysis.defect_id == defect_id)
    if status:
        query = query.filter(RootCauseAnalysis.status == status)
    return query.order_by(RootCauseAnalysis.created_at.desc()).offset(skip).limit(limit).all()


def update_root_cause_analysis(db: Session, analysis_id: int, analysis_data: dict):
    db_analysis = db.query(RootCauseAnalysis).filter(RootCauseAnalysis.id == analysis_id).first()
    if db_analysis:
        for key, value in analysis_data.items():
            setattr(db_analysis, key, value)
        db_analysis.updated_at = func.now()
        safe_commit(db)
        db.refresh(db_analysis)
    return db_analysis


def get_root_cause_analysis(db: Session, analysis_id: int):
    return db.query(RootCauseAnalysis).filter(RootCauseAnalysis.id == analysis_id).first()


def delete_root_cause_analysis(db: Session, analysis_id: int):
    db_analysis = db.query(RootCauseAnalysis).filter(RootCauseAnalysis.id == analysis_id).first()
    if db_analysis:
        db.delete(db_analysis)
        safe_commit(db)
    return db_analysis


# Dashboard Widgets CRUD
def create_dashboard_widget(db: Session, widget: DashboardWidgetCreate):
    db_widget = DashboardWidget(**widget.model_dump())
    db.add(db_widget)
    safe_commit(db)
    db.refresh(db_widget)
    return db_widget


def get_dashboard_widgets(db: Session, user_id: int, project_id: int = None):
    query = db.query(DashboardWidget).filter(DashboardWidget.user_id == user_id, DashboardWidget.is_visible == True)
    if project_id:
        query = query.filter(DashboardWidget.project_id == project_id)
    return query.order_by(DashboardWidget.position_y, DashboardWidget.position_x).all()


def get_dashboard_widget(db: Session, widget_id: int):
    return db.query(DashboardWidget).filter(DashboardWidget.id == widget_id).first()


def update_dashboard_widget(db: Session, widget_id: int, widget_data: dict):
    db_widget = db.query(DashboardWidget).filter(DashboardWidget.id == widget_id).first()
    if db_widget:
        for key, value in widget_data.items():
            setattr(db_widget, key, value)
        db_widget.updated_at = func.now()
        safe_commit(db)
        db.refresh(db_widget)
    return db_widget


def delete_dashboard_widget(db: Session, widget_id: int):
    db_widget = db.query(DashboardWidget).filter(DashboardWidget.id == widget_id).first()
    if db_widget:
        db.delete(db_widget)
        safe_commit(db)
    return db_widget


# Analytics aggregation functions
def _normalized_result_status(status: str) -> str:
    status_map = {
        "pass": "passed",
        "passed": "passed",
        "fail": "failed",
        "failed": "failed",
        "block": "blocked",
        "blocked": "blocked",
        "skip": "skipped",
        "skipped": "skipped",
        "not_started": "not_started",
    }
    return status_map.get((status or "").lower(), (status or "").lower())


def calculate_project_kpis(db: Session, project_id: int, time_period: str = "7d"):
    from datetime import datetime, timedelta
    from ..models import Defect, TestRun, TestResult, TestCase, TestSuite
    from sqlalchemy import func
    
    time_mapping = {"24h": 1, "7d": 7, "30d": 30, "90d": 90}
    days = time_mapping.get(time_period, 7)
    current_start_date = datetime.now() - timedelta(days=days)

    total_test_cases = db.query(TestCase).join(TestSuite).filter(
        TestSuite.project_id == project_id,
        TestCase.is_deleted == False,
    ).count()

    current_results = db.query(TestResult).join(TestRun).filter(
        TestRun.project_id == project_id,
        TestResult.executed_at >= current_start_date,
    ).all()

    current_statuses = [_normalized_result_status(result.status) for result in current_results]
    executed_statuses = {"passed", "failed", "blocked", "skipped"}
    executed_results = [result for result in current_results if _normalized_result_status(result.status) in executed_statuses]
    
    total_tests = len(executed_results)
    passed_tests = current_statuses.count("passed")
    failed_tests = current_statuses.count("failed")
    blocked_tests = current_statuses.count("blocked")
    skipped_tests = current_statuses.count("skipped")
    pass_rate = (passed_tests / total_tests * 100) if total_tests > 0 else 0
    
    executed_test_cases = len({result.test_case_id for result in executed_results})
    coverage = (executed_test_cases / total_test_cases * 100) if total_test_cases > 0 else 0
    
    execution_times = [result.execution_time for result in executed_results if result.execution_time is not None]
    avg_execution_time = (sum(execution_times) / len(execution_times) / 3600) if execution_times else 0
    
    completed_runs = db.query(TestRun).filter(
        TestRun.project_id == project_id,
        TestRun.status.in_(["completed", "passed", "failed"]),
        TestRun.created_at >= current_start_date,
        TestRun.completed_at.isnot(None),
    ).all()
    cycle_times = [
        (run.completed_at - run.created_at).total_seconds() / 3600
        for run in completed_runs
        if run.created_at and run.completed_at
    ]
    cycle_time = sum(cycle_times) / len(cycle_times) if cycle_times else 0
    
    test_case_results = {}
    for result in current_results:
        normalized_status = _normalized_result_status(result.status)
        if normalized_status in {"passed", "failed"}:
            test_case_results.setdefault(result.test_case_id, set()).add(normalized_status)
    flaky_tests = len([
        test_case_id for test_case_id, statuses in test_case_results.items()
        if {"passed", "failed"}.issubset(statuses)
    ])
    flakiness = (flaky_tests / len(test_case_results) * 100) if test_case_results else 0
    
    current_failure_rate = (failed_tests / total_tests * 100) if total_tests else 0
    
    total_defects = db.query(Defect).filter(Defect.project_id == project_id).count()
    defect_density = (total_defects / total_test_cases) if total_test_cases > 0 else 0
    productivity_score = min(100, (total_tests / days) * 10) if days > 0 else 0
    
    return {
        "coverage": round(coverage, 1),
        "pass_rate": round(pass_rate, 1),
        "failure_trends": round(current_failure_rate, 1),
        "flakiness": round(flakiness, 1),
        "cycle_time": round(cycle_time, 2),
        "defect_density": round(defect_density, 2),
        "total_tests": total_tests,
        "passed_tests": passed_tests,
        "failed_tests": failed_tests,
        "blocked_tests": blocked_tests,
        "skipped_tests": skipped_tests,
        "avg_execution_time": round(avg_execution_time, 2),
        "productivity_score": round(productivity_score, 1)
    }


def generate_dashboard_analytics(db: Session, project_id: int, time_period: str = "7d"):
    from datetime import datetime, timedelta
    import sqlalchemy as sa
    from ..models import TestRun, TestResult, TestCase, TestSuite
    
    # Get current KPI data
    kpis = calculate_project_kpis(db, project_id, time_period)
    
    # Calculate previous period data for trends
    time_mapping = {"24h": 1, "7d": 7, "30d": 30, "90d": 90}
    days = time_mapping.get(time_period, 7)
    
    # Get previous period data by doubling the days lookback
    start_date = datetime.now() - timedelta(days=days * 2)
    end_date = datetime.now() - timedelta(days=days)
    
    # Get test results from previous period
    previous_results = db.query(TestResult).join(TestRun).filter(
        TestRun.project_id == project_id,
        TestResult.executed_at >= start_date,
        TestResult.executed_at < end_date
    ).all()
    
    # Calculate previous period metrics
    prev_total_tests = len(previous_results)
    prev_statuses = [_normalized_result_status(r.status) for r in previous_results]
    prev_passed_tests = prev_statuses.count('passed')
    prev_failed_tests = prev_statuses.count('failed')
    
    prev_pass_rate = (prev_passed_tests / prev_total_tests * 100) if prev_total_tests > 0 else 0
    
    # Calculate previous coverage
    total_test_cases = db.query(TestCase).join(TestSuite).filter(TestSuite.project_id == project_id, TestCase.is_deleted == False).count()
    prev_executed_test_cases = len(set([r.test_case_id for r in previous_results]))
    prev_coverage = (prev_executed_test_cases / total_test_cases * 100) if total_test_cases > 0 else 0
    
    # Calculate previous flakiness
    prev_test_case_results = {}
    for result in previous_results:
        if result.test_case_id not in prev_test_case_results:
            prev_test_case_results[result.test_case_id] = set()
        prev_test_case_results[result.test_case_id].add(_normalized_result_status(result.status))
    
    prev_flaky_tests = len([tc_id for tc_id, statuses in prev_test_case_results.items() 
                           if len(statuses) > 1 and ('passed' in statuses and 'failed' in statuses)])
    prev_flakiness = (prev_flaky_tests / len(prev_test_case_results) * 100) if prev_test_case_results else 0
    
    prev_failure_trends = (prev_failed_tests / prev_total_tests * 100) if prev_total_tests > 0 else 0
    
    # Previous cycle time
    prev_test_runs = db.query(TestRun).filter(
        TestRun.project_id == project_id,
        TestRun.created_at >= start_date,
        TestRun.created_at < end_date
    ).all()
    
    prev_completed_runs = [run for run in prev_test_runs if run.status in ('completed', 'passed', 'failed')]
    prev_cycle_times = []
    for run in prev_completed_runs:
        if hasattr(run, 'completed_at') and run.completed_at:
            duration = (run.completed_at - run.created_at).total_seconds() / 3600
            prev_cycle_times.append(duration)
    
    prev_cycle_time = sum(prev_cycle_times) / len(prev_cycle_times) if prev_cycle_times else 0
    
    # Calculate previous defect density.
    # Defect density is a cumulative metric (all defects / all test cases), so the
    # previous-period baseline must also be cumulative: every defect created before
    # the current period began. Comparing cumulative-now vs cumulative-then yields a
    # meaningful trend instead of mixing an all-time count with a single-period count.
    from ..models import Defect
    prev_defects = db.query(Defect).filter(
        Defect.project_id == project_id,
        Defect.created_at < end_date
    ).count()
    prev_defect_density = (prev_defects / total_test_cases) if total_test_cases > 0 else 0
    
    previous_kpis = {
        "coverage": prev_coverage,
        "pass_rate": prev_pass_rate,
        "failure_trends": prev_failure_trends,
        "flakiness": prev_flakiness,
        "cycle_time": prev_cycle_time,
        "defect_density": prev_defect_density
    }
    
    # Calculate trends
    def calculate_trend(current, previous):
        if previous == 0:
            return {"current": current, "trend": "up" if current > 0 else "stable", "change": current}
        change = current - previous
        trend = "up" if change > 0 else "down" if change < 0 else "stable"
        return {"current": current, "trend": trend, "change": round(change, 1)}
    
    # Get recent activity data
    today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    test_runs_today = db.query(TestRun).filter(
        TestRun.project_id == project_id,
        TestRun.created_at >= today_start
    ).count()
    
    # Get tests executed today
    tests_executed_today = db.query(TestResult).join(TestRun).filter(
        TestRun.project_id == project_id,
        TestResult.executed_at >= today_start
    ).count()
    
    # Get defects logged today from the defects table (actual defects, not failed runs)
    defects_found_today = db.query(Defect).filter(
        Defect.project_id == project_id,
        Defect.created_at >= today_start
    ).count()
    
    # Get team performance data for the selected period. Prefer actual executors; fallback to assigned runs.
    current_period_start = datetime.now() - timedelta(days=days)
    active_testers = db.query(TestResult.executed_by).join(TestRun).filter(
        TestRun.project_id == project_id,
        TestResult.executed_at >= current_period_start,
        TestResult.executed_by.isnot(None)
    ).distinct().count()
    if active_testers == 0:
        active_testers = db.query(TestRun.assigned_to).filter(
            TestRun.project_id == project_id,
            TestRun.created_at >= current_period_start,
            TestRun.assigned_to.isnot(None)
        ).distinct().count()
    
    # Get upcoming items
    scheduled_runs = db.query(TestRun).filter(
        TestRun.project_id == project_id,
        TestRun.status == 'scheduled'
    ).count()
    
    # Get pending reviews (test cases with status 'pending_review' or similar)
    # TestCase doesn't have direct project_id, need to join through TestSuite
    pending_reviews = db.query(TestCase).join(TestSuite).filter(
        TestSuite.project_id == project_id,
        TestCase.status.in_(['pending_review', 'draft'])
    ).count()
    
    # Release deadline - derived from the nearest upcoming, not-yet-finished milestone.
    release_deadline = "N/A"
    try:
        from ..models import Milestone, MilestoneStatus
        upcoming_milestone = db.query(Milestone).filter(
            Milestone.project_id == project_id,
            Milestone.target_date.isnot(None),
            Milestone.target_date >= datetime.now(),
            Milestone.status.notin_([MilestoneStatus.COMPLETED, MilestoneStatus.CANCELLED]),
        ).order_by(Milestone.target_date.asc()).first()
        if upcoming_milestone and upcoming_milestone.target_date:
            release_deadline = upcoming_milestone.target_date.strftime("%Y-%m-%d")
    except Exception as exc:
        logger.warning(f"Could not determine release deadline for project {project_id}: {exc}")
        release_deadline = "N/A"
    
    return {
        "project_id": project_id,
        "time_period": time_period,
        "generated_at": datetime.now().isoformat(),
        "kpi_data": {
            "coverage": calculate_trend(kpis["coverage"], previous_kpis["coverage"]),
            "passRate": calculate_trend(kpis["pass_rate"], previous_kpis["pass_rate"]),
            "failureTrends": calculate_trend(kpis["failure_trends"], previous_kpis["failure_trends"]),
            "flakiness": calculate_trend(kpis["flakiness"], previous_kpis["flakiness"]),
            "cycleTime": calculate_trend(kpis["cycle_time"], previous_kpis["cycle_time"]),
            "defectDensity": calculate_trend(kpis["defect_density"], previous_kpis["defect_density"])
        },
        "recent_activity": {
            "test_runs_today": test_runs_today,
            "tests_executed": tests_executed_today,
            "defects_found": defects_found_today
        },
        "team_performance": {
            "active_testers": active_testers,
            "avg_execution_time": kpis["avg_execution_time"],
            "productivity_score": kpis["productivity_score"]
        },
        "upcoming_items": {
            "scheduled_runs": scheduled_runs,
            "pending_reviews": pending_reviews,
            "release_deadline": release_deadline
        }
    }
