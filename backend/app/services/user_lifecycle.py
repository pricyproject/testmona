from datetime import datetime, timedelta
import secrets

from sqlalchemy.orm import Session

from ..models import OnboardingChecklist, Role, UserInvitation
from ..rbac import role_value


def _safe_commit(db: Session) -> None:
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise


def create_user_invitation(db: Session, invitation: dict, invited_by_id: int):
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now() + timedelta(days=7)
    project_ids_str = ','.join(map(str, invitation.get('project_ids', []))) if invitation.get('project_ids') else ''

    db_invitation = UserInvitation(
        email=invitation['email'],
        token=token,
        role=role_value(invitation.get('role', Role.TESTER)),
        project_ids=project_ids_str,
        invited_by=invited_by_id,
        expires_at=expires_at,
        is_used=False,
    )
    db.add(db_invitation)
    _safe_commit(db)
    db.refresh(db_invitation)
    return db_invitation


def get_user_invitation_by_token(db: Session, token: str):
    return db.query(UserInvitation).filter(
        UserInvitation.token == token,
        UserInvitation.is_used == False,
    ).first()


def get_user_invitation(db: Session, invitation_id: int):
    return db.query(UserInvitation).filter(UserInvitation.id == invitation_id).first()


def get_user_invitations(db: Session, skip: int = 0, limit: int = 100):
    return db.query(UserInvitation).offset(skip).limit(limit).all()


def mark_invitation_as_used(db: Session, invitation_id: int):
    db_invitation = db.query(UserInvitation).filter(UserInvitation.id == invitation_id).first()
    if db_invitation:
        db_invitation.is_used = True
        db_invitation.accepted_at = datetime.now()
        _safe_commit(db)
        db.refresh(db_invitation)
    return db_invitation


def delete_user_invitation(db: Session, invitation_id: int):
    db_invitation = db.query(UserInvitation).filter(UserInvitation.id == invitation_id).first()
    if db_invitation:
        db.delete(db_invitation)
        _safe_commit(db)
    return db_invitation


def initialize_onboarding_checklist(db: Session, user_id: int):
    default_tasks = [
        {
            "task_key": "change_password",
            "task_name": "Change Default Password",
            "description": "Change your default password to secure your account",
        },
        {
            "task_key": "create_project",
            "task_name": "Create Your First Project",
            "description": "Create a project to start managing your tests",
        },
        {
            "task_key": "create_test_suite",
            "task_name": "Create a Test Suite",
            "description": "Organize your test cases into test suites",
        },
        {
            "task_key": "create_test_case",
            "task_name": "Create Your First Test Case",
            "description": "Write your first test case",
        },
        {
            "task_key": "review_settings",
            "task_name": "Review System Settings",
            "description": "Configure system settings for your needs",
        },
    ]

    for task in default_tasks:
        existing = db.query(OnboardingChecklist).filter(
            OnboardingChecklist.user_id == user_id,
            OnboardingChecklist.task_key == task["task_key"],
        ).first()

        if not existing:
            db.add(OnboardingChecklist(user_id=user_id, is_completed=False, **task))

    _safe_commit(db)


def get_onboarding_checklist(db: Session, user_id: int):
    return db.query(OnboardingChecklist).filter(
        OnboardingChecklist.user_id == user_id,
    ).all()


def update_onboarding_task(db: Session, user_id: int, task_key: str, is_completed: bool):
    task = db.query(OnboardingChecklist).filter(
        OnboardingChecklist.user_id == user_id,
        OnboardingChecklist.task_key == task_key,
    ).first()

    if task:
        task.is_completed = is_completed
        task.completed_at = datetime.now() if is_completed else None
        _safe_commit(db)
        db.refresh(task)

    return task
