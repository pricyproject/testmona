"""Unit coverage for Work Inbox triage lifecycle (Plan B / W0).

The inbox owns two lifecycle fields on a notification — ``snoozed_until`` and
``done_at`` — layered on top of the shared ``is_read``/``archived`` primitives.
The open inbox predicate (centralised in ``crud._open_inbox_clauses`` and used by
every inbox query/count) is: actionable AND NOT archived AND (no snooze, or the
snooze has elapsed). These tests exercise that predicate plus the ``done_at``
stamp through the public crud surface.
"""

from datetime import datetime, timedelta, timezone

import pytest

from app import crud, models


ACTIONABLE = ["mention", "review"]


def _notif(db, *, user_id=1, category="mention", archived=False, is_read=False,
           snoozed_until=None, created_at=None, related_entity_type=None,
           related_entity_id=None):
    n = models.Notification(
        user_id=user_id,
        title="t",
        message="m",
        category=category,
        archived=archived,
        is_read=is_read,
        snoozed_until=snoozed_until,
        related_entity_type=related_entity_type,
        related_entity_id=related_entity_id,
    )
    if created_at is not None:
        n.created_at = created_at
    db.add(n)
    db.commit()
    db.refresh(n)
    return n


@pytest.fixture()
def inbox_db(mem_db):
    db = mem_db
    db.add(models.User(id=1, username="alice", email="a@x.com", hashed_password="x",
                       full_name="Alice", is_active=True))
    db.commit()
    return db


def _open_ids(db):
    items = crud.get_inbox_notifications(
        db, user_id=1, actionable_categories=ACTIONABLE, status="open"
    )
    return {n.id for n in items}


def test_snoozed_item_drops_out_of_open_inbox(inbox_db):
    future = datetime.now(timezone.utc) + timedelta(hours=1)
    plain = _notif(inbox_db)
    snoozed = _notif(inbox_db, snoozed_until=future)

    open_ids = _open_ids(inbox_db)
    assert plain.id in open_ids
    assert snoozed.id not in open_ids


def test_elapsed_snooze_is_open_again(inbox_db):
    past = datetime.now(timezone.utc) - timedelta(minutes=1)
    resurfaced = _notif(inbox_db, snoozed_until=past)
    assert resurfaced.id in _open_ids(inbox_db)


def test_summary_buckets_open_snoozed_done_separately(inbox_db):
    future = datetime.now(timezone.utc) + timedelta(hours=1)
    _notif(inbox_db)                                  # open + unread
    _notif(inbox_db, snoozed_until=future)            # snoozed
    _notif(inbox_db, archived=True)                   # done

    total_open, total_unread, total_snoozed, per_category = crud.get_inbox_summary(
        inbox_db, user_id=1, actionable_categories=ACTIONABLE
    )
    assert (total_open, total_unread, total_snoozed) == (1, 1, 1)
    mention = per_category["mention"]
    assert mention == {"open": 1, "snoozed": 1, "done": 1, "unread": 1}


def test_archive_stamps_done_at_and_restore_clears_it(inbox_db):
    n = _notif(inbox_db)
    assert n.done_at is None

    archived = crud.set_notification_archived(inbox_db, notification_id=n.id, archived=True)
    assert archived.archived is True
    assert archived.done_at is not None

    restored = crud.set_notification_archived(inbox_db, notification_id=n.id, archived=False)
    assert restored.archived is False
    assert restored.done_at is None


def test_bulk_archive_skips_snoozed_and_stamps_done_at(inbox_db):
    future = datetime.now(timezone.utc) + timedelta(hours=1)
    plain = _notif(inbox_db)
    snoozed = _notif(inbox_db, snoozed_until=future)

    count = crud.archive_inbox_notifications(
        inbox_db, user_id=1, actionable_categories=ACTIONABLE
    )
    assert count == 1  # only the open (non-snoozed) item

    inbox_db.refresh(plain)
    inbox_db.refresh(snoozed)
    assert plain.archived is True and plain.done_at is not None
    assert snoozed.archived is False and snoozed.done_at is None


def test_mark_all_read_skips_snoozed(inbox_db):
    future = datetime.now(timezone.utc) + timedelta(hours=1)
    plain = _notif(inbox_db)
    snoozed = _notif(inbox_db, snoozed_until=future)

    count = crud.mark_inbox_all_read(
        inbox_db, user_id=1, actionable_categories=ACTIONABLE
    )
    assert count == 1

    inbox_db.refresh(plain)
    inbox_db.refresh(snoozed)
    assert plain.is_read is True
    assert snoozed.is_read is False


# --- W1: snooze / unsnooze / sweep -----------------------------------------


def _snoozed_ids(db):
    items = crud.get_inbox_notifications(
        db, user_id=1, actionable_categories=ACTIONABLE, status="snoozed"
    )
    return {n.id for n in items}


def test_snooze_moves_item_from_open_to_snoozed(inbox_db):
    n = _notif(inbox_db)
    until = datetime.now(timezone.utc) + timedelta(hours=2)
    crud.snooze_notification(inbox_db, notification_id=n.id, until=until)

    assert n.id not in _open_ids(inbox_db)
    assert n.id in _snoozed_ids(inbox_db)


def test_unsnooze_returns_item_to_open(inbox_db):
    until = datetime.now(timezone.utc) + timedelta(hours=2)
    n = _notif(inbox_db, snoozed_until=until)
    assert n.id in _snoozed_ids(inbox_db)

    crud.unsnooze_notification(inbox_db, notification_id=n.id)
    assert n.id in _open_ids(inbox_db)
    assert n.id not in _snoozed_ids(inbox_db)


def test_sweep_clears_elapsed_snoozes_only(inbox_db):
    past = datetime.now(timezone.utc) - timedelta(minutes=1)
    future = datetime.now(timezone.utc) + timedelta(hours=1)
    due = _notif(inbox_db, snoozed_until=past)
    still = _notif(inbox_db, snoozed_until=future)

    swept = crud.sweep_due_snoozes(inbox_db, user_id=1)
    assert swept == 1
    inbox_db.refresh(due)
    inbox_db.refresh(still)
    assert due.snoozed_until is None
    assert still.snoozed_until is not None


# --- W3 (follow-up): group-by-project resolution ----------------------------


def test_resolve_inbox_projects_maps_entities_to_their_project(inbox_db):
    db = inbox_db
    project = models.Project(name="Apollo", description="d", owner_id=1)
    db.add(project)
    db.commit()
    db.refresh(project)

    requirement = models.Requirement(
        title="R1", requirement_id="REQ-1", project_id=project.id, created_by=1
    )
    db.add(requirement)
    db.commit()
    db.refresh(requirement)

    on_req = _notif(db, related_entity_type="requirement", related_entity_id=requirement.id)
    # A *_change watch variant resolves through the same base entity.
    on_req_change = _notif(db, related_entity_type="requirement_change", related_entity_id=requirement.id)
    # A project-typed notification *is* its own project id.
    on_project = _notif(db, related_entity_type="project", related_entity_id=project.id)
    # Unresolvable: a deleted/absent entity and a no-entity notification.
    on_missing = _notif(db, related_entity_type="requirement", related_entity_id=99999)
    on_none = _notif(db)

    crud.resolve_inbox_projects(db, [on_req, on_req_change, on_project, on_missing, on_none])

    assert on_req.project_id == project.id and on_req.project_name == "Apollo"
    assert on_req_change.project_id == project.id and on_req_change.project_name == "Apollo"
    assert on_project.project_id == project.id and on_project.project_name == "Apollo"
    assert on_missing.project_id is None and on_missing.project_name is None
    assert on_none.project_id is None and on_none.project_name is None


# --- W2: bulk triage actions ------------------------------------------------


def test_bulk_archive_only_touches_owned_inbox_items(inbox_db):
    inbox_db.add(models.User(id=2, username="bob", email="b@x.com",
                             hashed_password="x", full_name="Bob", is_active=True))
    inbox_db.commit()
    mine_a = _notif(inbox_db)
    mine_b = _notif(inbox_db)
    other = _notif(inbox_db, user_id=2)
    non_inbox = _notif(inbox_db, category="status")  # not an actionable inbox category

    count = crud.bulk_inbox_action(
        inbox_db, user_id=1,
        notification_ids=[mine_a.id, mine_b.id, other.id, non_inbox.id],
        action="archive", actionable_categories=ACTIONABLE,
    )
    assert count == 2  # only mine_a + mine_b
    for n in (mine_a, mine_b):
        inbox_db.refresh(n)
        assert n.archived is True and n.done_at is not None
    inbox_db.refresh(other)
    assert other.archived is False


def test_bulk_snooze_requires_until_and_defers(inbox_db):
    n = _notif(inbox_db)
    # Missing until is a no-op rather than a crash.
    assert crud.bulk_inbox_action(
        inbox_db, user_id=1, notification_ids=[n.id], action="snooze",
        actionable_categories=ACTIONABLE,
    ) == 0

    until = datetime.now(timezone.utc) + timedelta(days=1)
    count = crud.bulk_inbox_action(
        inbox_db, user_id=1, notification_ids=[n.id], action="snooze",
        actionable_categories=ACTIONABLE, until=until,
    )
    assert count == 1
    assert n.id in _snoozed_ids(inbox_db)


# --- W4: aging sort ---------------------------------------------------------


def test_sort_orders_open_by_created_at(inbox_db):
    base = datetime.now(timezone.utc)
    old = _notif(inbox_db, created_at=base - timedelta(days=5))
    mid = _notif(inbox_db, created_at=base - timedelta(days=2))
    new = _notif(inbox_db, created_at=base - timedelta(hours=1))

    newest = crud.get_inbox_notifications(
        inbox_db, user_id=1, actionable_categories=ACTIONABLE, status="open", sort="newest"
    )
    oldest = crud.get_inbox_notifications(
        inbox_db, user_id=1, actionable_categories=ACTIONABLE, status="open", sort="oldest"
    )
    assert [n.id for n in newest] == [new.id, mid.id, old.id]
    assert [n.id for n in oldest] == [old.id, mid.id, new.id]


def test_bulk_read_marks_selection_read(inbox_db):
    a = _notif(inbox_db)
    b = _notif(inbox_db)
    count = crud.bulk_inbox_action(
        inbox_db, user_id=1, notification_ids=[a.id, b.id], action="read",
        actionable_categories=ACTIONABLE,
    )
    assert count == 2
    for n in (a, b):
        inbox_db.refresh(n)
        assert n.is_read is True
