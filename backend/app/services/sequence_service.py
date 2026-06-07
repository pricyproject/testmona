"""Per-project sequence allocation for ``project_seq``.

Every project-scoped, URL/badge-bearing entity carries a ``project_seq`` integer
that is unique within its project and **stable / never reused** — deleting an item
leaves a gap rather than renumbering.

Allocation is centralised as SQLAlchemy ``before_insert`` listeners (registered by
:func:`register_sequence_listeners`, called once from ``models.py``). Doing it at the
mapper level means **every** ORM create path — direct CRUD, clone, CSV/Gherkin
import, CI ingestion, AI generation — gets a number automatically, instead of each
call site having to remember. The value is ``MAX(project_seq)+1`` within the project;
for Requirements/Defects it is derived from the numeric part of the existing
``requirement_id``/``defect_id`` so the URL matches the displayed REQ-/DEF- badge.

``project_seq`` is nullable, so global rows (e.g. a project-less Doc/Space/Global
Parameter) and any bulk-`Core`-insert path that bypasses mapper events simply leave
it NULL; the frontend falls back to the global ``id`` in that case. The unique
``(project_id, project_seq)`` index added by the ``add_project_seq_numbering``
migration is the backstop against the rare concurrent-insert race.
"""
from __future__ import annotations

import re

from sqlalchemy import event, func, select
from sqlalchemy.orm import Session

_TRAILING_DIGITS = re.compile(r"(\d+)\s*$")


def seq_from_key(key) -> int | None:
    """Numeric suffix of a human key, e.g. ``REQ-007`` -> ``7`` (``None`` if absent)."""
    if not key:
        return None
    match = _TRAILING_DIGITS.search(str(key))
    return int(match.group(1)) if match else None


def next_project_seq(db: Session, model, project_id: int) -> int:
    """Session-based helper: next per-project sequence for a model with a ``project_id`` column."""
    current = (
        db.query(func.coalesce(func.max(model.project_seq), 0))
        .filter(model.project_id == project_id)
        .scalar()
    )
    return int(current or 0) + 1


def _max_seq_for_project(connection, table, project_id) -> int:
    if project_id is None:
        return 0
    value = connection.execute(
        select(func.coalesce(func.max(table.c.project_seq), 0)).where(table.c.project_id == project_id)
    ).scalar()
    return int(value or 0)


def _allocate_seq(connection, target, project_id) -> int:
    """Next per-project seq, including siblings already queued in this same flush.

    A plain ``MAX(project_seq)+1`` is unsafe when several rows of the same entity
    are added before a single flush: their ``before_insert`` events all run before
    any INSERT lands, so they'd read the same DB max and collide on the unique
    ``(project_id, project_seq)`` index. We therefore also consider pending session
    rows that were processed earlier in this flush and already carry a seq.
    """
    from sqlalchemy.orm import object_session

    next_seq = _max_seq_for_project(connection, target.__table__, project_id)
    session = object_session(target)
    if session is not None:
        cls = type(target)
        for obj in session.new:
            if obj is target or not isinstance(obj, cls):
                continue
            if getattr(obj, "project_id", None) == project_id:
                pending = getattr(obj, "project_seq", None)
                if pending:
                    next_seq = max(next_seq, int(pending))
    return next_seq + 1


def _make_direct_listener(key_attr: str | None):
    """before_insert for models that have a real ``project_id`` column."""

    def _before_insert(_mapper, connection, target):
        if getattr(target, "project_seq", None) is not None:
            return
        project_id = getattr(target, "project_id", None)
        if project_id is None:
            return  # global row (no project) — leave NULL
        seq = seq_from_key(getattr(target, key_attr, None)) if key_attr else None
        if seq is None:
            seq = _allocate_seq(connection, target, project_id)
        target.project_seq = seq

    return _before_insert


def _requirement_before_insert(_mapper, connection, target):
    """``project_seq`` is the single source of identity; derive REQ-NNN from it.

    The key is only filled when the caller didn't supply one — production create
    paths leave it blank (so it's always derived and can never diverge from the URL
    number), while fixtures that set an explicit key keep it.
    """
    project_id = getattr(target, "project_id", None)
    if project_id is None:
        return
    if getattr(target, "project_seq", None) is None:
        target.project_seq = _allocate_seq(connection, target, project_id)
    if not getattr(target, "requirement_id", None):
        target.requirement_id = f"REQ-{int(target.project_seq):03d}"


def _defect_before_insert(_mapper, connection, target):
    """``project_seq`` is the single source of identity; derive the DEF key from it."""
    project_id = getattr(target, "project_id", None)
    if project_id is None:
        return
    if getattr(target, "project_seq", None) is None:
        target.project_seq = _allocate_seq(connection, target, project_id)
    if not getattr(target, "defect_id", None):
        target.defect_id = f"P{int(project_id)}-DEF-{int(target.project_seq):03d}"


def _test_case_before_insert(_mapper, connection, target):
    """Denormalise ``project_id`` from the suite, then number within that project."""
    from .. import models

    suites = models.TestSuite.__table__

    # Callers set ``test_suite_id``; keep the denormalised ``project_id`` in sync.
    if getattr(target, "project_id", None) is None:
        suite_id = getattr(target, "test_suite_id", None)
        if suite_id is not None:
            target.project_id = connection.execute(
                select(suites.c.project_id).where(suites.c.id == suite_id)
            ).scalar()

    if getattr(target, "project_seq", None) is not None:
        return
    project_id = getattr(target, "project_id", None)
    if project_id is None:
        return
    target.project_seq = _allocate_seq(connection, target, project_id)


def _test_case_before_update(_mapper, connection, target):
    """Re-derive the denormalised ``project_id`` when a case's suite changes."""
    from sqlalchemy.orm import attributes

    if not attributes.get_history(target, "test_suite_id").has_changes():
        return
    from .. import models

    suite_id = getattr(target, "test_suite_id", None)
    if suite_id is None:
        return
    suites = models.TestSuite.__table__
    target.project_id = connection.execute(
        select(suites.c.project_id).where(suites.c.id == suite_id)
    ).scalar()


_REGISTERED = False


def register_sequence_listeners() -> None:
    """Attach the before_insert allocators. Idempotent; called once from models.py."""
    global _REGISTERED
    if _REGISTERED:
        return
    from .. import models

    # model -> the human-key attribute to derive seq from (None => MAX+1)
    direct = {
        models.CustomFieldDefinition: None,
        models.SharedStep: None,
        models.GlobalParameter: None,
        models.TestDataset: None,
        models.TestSuite: None,
        models.TestRun: None,
        models.RequirementFolder: None,
        models.TestPlan: None,
        models.Milestone: None,
        models.ExecutionEnvironment: None,
        models.DocSpace: None,
        models.Doc: None,
        models.TestTypeDefinition: None,
        models.PriorityDefinition: None,
        models.SharedStepTemplate: None,
    }
    for model, key_attr in direct.items():
        event.listen(model, "before_insert", _make_direct_listener(key_attr))
    # Requirement/Defect: project_seq is authoritative, the human key derived from it.
    event.listen(models.Requirement, "before_insert", _requirement_before_insert)
    event.listen(models.Defect, "before_insert", _defect_before_insert)
    event.listen(models.TestCase, "before_insert", _test_case_before_insert)
    event.listen(models.TestCase, "before_update", _test_case_before_update)
    _REGISTERED = True
