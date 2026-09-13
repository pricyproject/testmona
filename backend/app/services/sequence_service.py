"""Per-project sequence allocation for ``project_seq``.

Every project-scoped, URL/badge-bearing entity carries a ``project_seq`` integer
that is unique within its project and **stable / never reused** — deleting an item
leaves a gap rather than renumbering.

Allocation is centralised as SQLAlchemy ``before_insert`` listeners (registered by
:func:`register_sequence_listeners`, called once from ``models.py``). Doing it at the
mapper level means **every** ORM create path — direct CRUD, clone, CSV/Gherkin
import, CI ingestion, AI generation — gets a number automatically, instead of each
call site having to remember. The value is ``MAX(project_seq)+1`` within the project.
``project_seq`` and the human badge agree by construction: blank keys are derived
from the allocated sequence, while an explicit ``requirement_id`` donates its
number to the sequence when free (taken numbers fail loudly instead of
diverging). ``defect_id`` is server-derived; clients cannot set it.

``project_seq`` is nullable, so global rows (e.g. a project-less Doc/Space/Global
Parameter) and any bulk-`Core`-insert path that bypasses mapper events simply leave
it NULL; the frontend falls back to the global ``id`` in that case. The unique
``(project_id, project_seq)`` index added by the ``add_project_seq_numbering``
migration is the backstop against the rare concurrent-insert race.
"""
from __future__ import annotations

import re

from sqlalchemy import event, func, select


def _max_seq_for_project(connection, table, project_id) -> int:
    if project_id is None:
        return 0
    value = connection.execute(
        select(func.coalesce(func.max(table.c.project_seq), 0)).where(table.c.project_id == project_id)
    ).scalar()
    return int(value or 0)


def _lock_project_for_seq(connection, project_id) -> None:
    """Serialise per-project seq allocation across concurrent transactions.

    ``MAX(project_seq)+1`` is racy *between* transactions: two concurrent inserts
    into the same project both read the same max and collide on the unique
    ``(project_id, project_seq)`` index — surfacing as a raw 500 IntegrityError
    under concurrent CSV import / CI ingestion / AI generation. Taking a row lock
    on the owning ``projects`` row before reading the max forces those
    transactions to serialise their allocation, so each sees the other's
    committed rows and ``MAX+1`` is always correct. The lock is held only until
    the surrounding transaction ends.

    No-op on SQLite (which omits ``FOR UPDATE`` and already serialises writers at
    the database level) and when there is no owning project.
    """
    if project_id is None:
        return
    from .. import models

    projects = models.Project.__table__
    connection.execute(
        select(projects.c.id).where(projects.c.id == project_id).with_for_update()
    ).first()


def _allocate_seq(connection, target, project_id) -> int:
    """Next per-project seq, including siblings already queued in this same flush.

    A plain ``MAX(project_seq)+1`` is unsafe when several rows of the same entity
    are added before a single flush: their ``before_insert`` events all run before
    any INSERT lands, so they'd read the same DB max and collide on the unique
    ``(project_id, project_seq)`` index. We therefore also consider pending session
    rows that were processed earlier in this flush and already carry a seq.

    Cross-transaction races are handled separately by ``_lock_project_for_seq``,
    which serialises allocation between concurrent transactions on server backends.
    """
    from sqlalchemy.orm import object_session

    _lock_project_for_seq(connection, project_id)
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


def _make_direct_listener():
    """before_insert for models that have a real ``project_id`` column."""

    def _before_insert(_mapper, connection, target):
        if getattr(target, "project_seq", None) is not None:
            return
        project_id = getattr(target, "project_id", None)
        if project_id is None:
            return  # global row (no project) — leave NULL
        target.project_seq = _allocate_seq(connection, target, project_id)

    return _before_insert


def _key_number(key) -> int | None:
    """Trailing number of a human key, e.g. ``REQ-007`` -> ``7``."""
    if not key:
        return None
    match = re.search(r"(\d+)\s*$", str(key))
    if not match:
        return None
    try:
        number = int(match.group(1))
    except ValueError:
        return None
    return number if number > 0 else None


def _requirement_before_insert(_mapper, connection, target):
    """Keep the REQ-NNN badge and the URL number (``project_seq``) in sync.

    A caller-supplied key donates its number: ``REQ-007`` takes sequence 7 when
    free, so badge and URL always agree. A taken number fails loudly (400 via
    the route's ``ValueError`` mapping) instead of silently diverging. Blank
    keys are derived from the allocated sequence as before.
    """
    project_id = getattr(target, "project_id", None)
    if project_id is None:
        return
    if getattr(target, "project_seq", None) is None:
        key = (getattr(target, "requirement_id", None) or "").strip()
        number = _key_number(key)
        if number is not None:
            table = target.__table__
            taken = connection.execute(
                select(func.count())
                .select_from(table)
                .where(table.c.project_id == project_id)
                .where(
                    (table.c.project_seq == number)
                    | (table.c.requirement_id == key)
                )
            ).scalar()
            if taken:
                raise ValueError(
                    f"Requirement number {number} is already taken in this project"
                )
            target.project_seq = number
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


def _doc_before_update(_mapper, connection, target):
    """Reallocate ``project_seq`` when a doc moves to a space in another project.

    Same hazard as a test case changing suites across projects: ``project_seq``
    is only unique *within* a project, so carrying the old number over would
    collide on the unique ``(project_id, project_seq)`` index and 500 the
    update. Moving into a global (project-less) space keeps the old number —
    global rows are excluded from per-project lookups, so it is harmless.
    """
    from sqlalchemy.orm import attributes

    if not attributes.get_history(target, "space_id").has_changes():
        return
    from .. import models

    space_id = getattr(target, "space_id", None)
    if space_id is None:
        return
    spaces = models.DocSpace.__table__
    new_project_id = connection.execute(
        select(spaces.c.project_id).where(spaces.c.id == space_id)
    ).scalar()
    old_project_id = getattr(target, "project_id", None)
    target.project_id = new_project_id
    if new_project_id is not None and new_project_id != old_project_id:
        target.project_seq = _allocate_seq(connection, target, new_project_id)


def _test_case_before_update(_mapper, connection, target):
    """Re-derive the denormalised ``project_id`` when a case's suite changes.

    ``project_seq`` is only unique *within* a project, so when the suite move
    also moves the case into a different project, a fresh sequence must be
    allocated there — carrying the old one over would collide with an existing
    case on the unique ``(project_id, project_seq)`` index and 500 the update.
    """
    from sqlalchemy.orm import attributes

    if not attributes.get_history(target, "test_suite_id").has_changes():
        return
    from .. import models

    suite_id = getattr(target, "test_suite_id", None)
    if suite_id is None:
        return
    suites = models.TestSuite.__table__
    new_project_id = connection.execute(
        select(suites.c.project_id).where(suites.c.id == suite_id)
    ).scalar()
    old_project_id = getattr(target, "project_id", None)
    target.project_id = new_project_id
    if new_project_id is not None and new_project_id != old_project_id:
        target.project_seq = _allocate_seq(connection, target, new_project_id)


_REGISTERED = False


def register_sequence_listeners() -> None:
    """Attach the before_insert allocators. Idempotent; called once from models.py."""
    global _REGISTERED
    if _REGISTERED:
        return
    from .. import models

    direct = {
        models.CustomFieldDefinition,
        models.SharedStep,
        models.GlobalParameter,
        models.TestDataset,
        models.TestSuite,
        models.TestRun,
        models.MatrixRun,
        models.RequirementFolder,
        models.TestPlan,
        models.Milestone,
        models.ExecutionEnvironment,
        models.DocSpace,
        models.Doc,
        models.TestTypeDefinition,
        models.PriorityDefinition,
        models.SharedStepTemplate,
    }
    for model in direct:
        event.listen(model, "before_insert", _make_direct_listener())
    # Requirement/Defect: project_seq is authoritative, the human key derived from it.
    event.listen(models.Requirement, "before_insert", _requirement_before_insert)
    event.listen(models.Defect, "before_insert", _defect_before_insert)
    event.listen(models.TestCase, "before_insert", _test_case_before_insert)
    event.listen(models.TestCase, "before_update", _test_case_before_update)
    event.listen(models.Doc, "before_update", _doc_before_update)
    _REGISTERED = True
