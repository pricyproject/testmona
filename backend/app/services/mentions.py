"""Shared @mention parsing/resolution helpers.

Used by both the requirement comment threads and the Doc Hub doc body so that
``@username`` tokens are resolved against a project's members the same way
everywhere — we only ever notify users who actually belong to the project.
"""

from __future__ import annotations

import re
from typing import Dict, Set

from .. import models
from sqlalchemy.orm import Session

# Matches @username tokens; usernames are alphanumerics plus _ . -
MENTION_RE = re.compile(r"@([A-Za-z0-9_.-]+)")


def project_member_users(db: Session, project_id: int) -> Dict[str, models.User]:
    """Map lowercase username -> User for everyone with access to the project
    (the owner plus assigned members). Used to resolve @mentions safely so we
    never notify users outside the project."""
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    user_ids: Set[int] = set()
    if project and project.owner_id:
        user_ids.add(project.owner_id)
    for (uid,) in (
        db.query(models.ProjectAssignment.user_id)
        .filter(models.ProjectAssignment.project_id == project_id)
        .all()
    ):
        user_ids.add(uid)
    if not user_ids:
        return {}
    users = db.query(models.User).filter(models.User.id.in_(user_ids)).all()
    return {u.username.lower(): u for u in users}


def resolve_mentions(body: str, members: Dict[str, models.User]) -> Set[int]:
    """Resolve @mention tokens in the body to project-member user ids."""
    resolved: Set[int] = set()
    for token in MENTION_RE.findall(body or ""):
        candidate = token.lower()
        # Tolerate trailing punctuation that ran into the token (e.g. "@bob.").
        user = members.get(candidate) or members.get(candidate.rstrip(".-"))
        if user is not None:
            resolved.add(user.id)
    return resolved
