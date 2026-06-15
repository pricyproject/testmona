"""Integration coverage for the Work Inbox triage routes (Plan B / W1+W2).

Exercises the snooze / unsnooze / bulk endpoints end-to-end over HTTP, plus the
``status=snoozed`` view and the lazy sweep that returns due items to open.
"""

from datetime import datetime, timedelta, timezone

from conftest import make_http_client


client = make_http_client()


def _seed_notifications(client, count, *, category="mention", snoozed_until=None, spread_age=False):
    """Insert `count` inbox notifications for the authenticated admin user.

    When ``spread_age`` is set, rows are stamped with descending ``created_at``
    (item 0 oldest) so created-at ordering is unambiguous regardless of insert
    order — used to assert the ``sort`` param.
    """
    from app import models

    db = client.SessionLocal()
    try:
        admin = db.query(models.User).first()
        now = datetime.now(timezone.utc)
        ids = []
        for i in range(count):
            n = models.Notification(
                user_id=admin.id,
                title=f"Item {i}",
                message="body",
                category=category,
                snoozed_until=snoozed_until,
            )
            if spread_age:
                n.created_at = now - timedelta(days=count - i)
            db.add(n)
            db.flush()
            ids.append(n.id)
        db.commit()
        return ids
    finally:
        db.close()


def test_snooze_moves_item_out_of_open_into_snoozed(client):
    (nid,) = _seed_notifications(client, 1)
    until = (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat()

    resp = client.post(f"/inbox/{nid}/snooze", json={"until": until})
    assert resp.status_code == 200, resp.text

    open_ids = {n["id"] for n in client.get("/inbox", params={"status": "open"}).json()}
    snoozed_ids = {n["id"] for n in client.get("/inbox", params={"status": "snoozed"}).json()}
    assert nid not in open_ids
    assert nid in snoozed_ids

    summary = client.get("/inbox/summary").json()
    assert summary["total_snoozed"] == 1
    assert summary["total_open"] == 0


def test_snooze_rejects_past_time(client):
    (nid,) = _seed_notifications(client, 1)
    past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    resp = client.post(f"/inbox/{nid}/snooze", json={"until": past})
    assert resp.status_code == 422


def test_unsnooze_returns_to_open(client):
    until = datetime.now(timezone.utc) + timedelta(hours=3)
    (nid,) = _seed_notifications(client, 1, snoozed_until=until)

    resp = client.post(f"/inbox/{nid}/unsnooze")
    assert resp.status_code == 200, resp.text

    open_ids = {n["id"] for n in client.get("/inbox", params={"status": "open"}).json()}
    assert nid in open_ids


def test_unsnooze_all_returns_snoozed_items_to_open(client):
    until = datetime.now(timezone.utc) + timedelta(hours=3)
    ids = _seed_notifications(client, 3, snoozed_until=until)

    resp = client.post("/inbox/unsnooze-all")
    assert resp.status_code == 200, resp.text
    assert resp.json()["unsnoozed_count"] == 3

    open_ids = {n["id"] for n in client.get("/inbox", params={"status": "open"}).json()}
    assert set(ids) <= open_ids


def test_due_snooze_is_swept_back_to_open_on_read(client):
    # A snooze already in the past should resurface (and be cleared) on next read.
    past = datetime.now(timezone.utc) - timedelta(minutes=5)
    (nid,) = _seed_notifications(client, 1, snoozed_until=past)

    open_ids = {n["id"] for n in client.get("/inbox", params={"status": "open"}).json()}
    assert nid in open_ids
    # And it is no longer counted as snoozed.
    assert client.get("/inbox/summary").json()["total_snoozed"] == 0


def test_due_snooze_sweep_is_global_on_read(client):
    from app import models

    past = datetime.now(timezone.utc) - timedelta(minutes=5)
    _seed_notifications(client, 1, snoozed_until=past)
    db = client.SessionLocal()
    try:
        other = models.User(username="inactive", email="inactive@b.c", hashed_password="x", is_active=True)
        db.add(other)
        db.commit()
        db.refresh(other)
        note = models.Notification(
            user_id=other.id,
            title="Other due",
            message="body",
            category="mention",
            snoozed_until=past,
        )
        db.add(note)
        db.commit()
        other_note_id = note.id
    finally:
        db.close()

    assert client.get("/inbox", params={"status": "open"}).status_code == 200
    db = client.SessionLocal()
    try:
        assert db.get(models.Notification, other_note_id).snoozed_until is None
    finally:
        db.close()


def test_inbox_search_and_actor_filter_are_server_side(client):
    from app import models

    ids = _seed_notifications(client, 60)
    db = client.SessionLocal()
    try:
        actor = models.User(username="deepactor", email="deep@b.c", hashed_password="x", full_name="Deep Actor", is_active=True)
        db.add(actor)
        db.commit()
        db.refresh(actor)
        db.query(models.Notification).filter(models.Notification.id == ids[-1]).update({
            "title": "Needle on a later page",
            "actor_id": actor.id,
        })
        db.commit()
        actor_id = actor.id
    finally:
        db.close()

    found = client.get("/inbox", params={"search": "Needle", "limit": 50})
    assert found.status_code == 200, found.text
    assert [n["id"] for n in found.json()] == [ids[-1]]

    actors = client.get("/inbox/actors")
    assert actors.status_code == 200, actors.text
    assert {a["id"] for a in actors.json()} == {actor_id}

    actor_search = client.get("/inbox/actors", params={"search": "Deep Actor"})
    assert actor_search.status_code == 200, actor_search.text
    assert actor_search.json() == [{"id": actor_id, "name": "Deep Actor"}]

    filtered = client.get("/inbox", params={"actor_id": actor_id})
    assert filtered.status_code == 200, filtered.text
    assert [n["id"] for n in filtered.json()] == [ids[-1]]


def test_bulk_archive_and_snooze(client):
    ids = _seed_notifications(client, 3)

    # Bulk archive two of them.
    resp = client.post("/inbox/bulk", json={"ids": ids[:2], "action": "archive"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["affected_count"] == 2

    open_ids = {n["id"] for n in client.get("/inbox", params={"status": "open"}).json()}
    done_ids = {n["id"] for n in client.get("/inbox", params={"status": "done"}).json()}
    assert open_ids == {ids[2]}
    assert set(ids[:2]) <= done_ids

    # Bulk snooze the remaining open one.
    until = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    resp = client.post("/inbox/bulk", json={"ids": [ids[2]], "action": "snooze", "until": until})
    assert resp.status_code == 200, resp.text
    assert resp.json()["affected_count"] == 1
    snoozed_ids = {n["id"] for n in client.get("/inbox", params={"status": "snoozed"}).json()}
    assert ids[2] in snoozed_ids


def test_bulk_snooze_without_until_is_rejected(client):
    ids = _seed_notifications(client, 1)
    resp = client.post("/inbox/bulk", json={"ids": ids, "action": "snooze"})
    assert resp.status_code == 422


def test_archive_all_records_audit_and_skips_snoozed(client):
    from app import models

    ids = _seed_notifications(client, 2)
    until = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    client.post("/inbox/bulk", json={"ids": [ids[1]], "action": "snooze", "until": until})

    resp = client.post("/inbox/archive-all")
    assert resp.status_code == 200, resp.text
    assert resp.json()["archived_count"] == 1

    db = client.SessionLocal()
    try:
        archived = db.get(models.Notification, ids[0])
        snoozed = db.get(models.Notification, ids[1])
        assert archived.archived is True
        assert snoozed.archived is False
        audit = db.query(models.AuditTrail).filter(
            models.AuditTrail.entity_type == models.EntityType.NOTIFICATION,
            models.AuditTrail.description == "Work Inbox action: archive_all",
        ).first()
        assert audit is not None
        assert audit.additional_metadata["affected_count"] == 1
    finally:
        db.close()


def test_sort_oldest_first(client):
    # item 0 is the oldest; default newest-first returns them reversed.
    ids = _seed_notifications(client, 3, spread_age=True)

    newest = [n["id"] for n in client.get("/inbox", params={"status": "open"}).json()]
    oldest = [n["id"] for n in client.get("/inbox", params={"status": "open", "sort": "oldest"}).json()]
    assert newest == list(reversed(ids))
    assert oldest == ids


def test_sort_param_is_validated(client):
    resp = client.get("/inbox", params={"status": "open", "sort": "sideways"})
    assert resp.status_code == 422


def test_unknown_inbox_category_is_rejected(client):
    resp = client.get("/inbox", params={"category": "not_a_category"})
    assert resp.status_code == 400


def test_summary_open_total_excludes_snoozed(client):
    # W5: the navbar badge reads total_open, which must not count snoozed work.
    ids = _seed_notifications(client, 3)
    until = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    client.post("/inbox/bulk", json={"ids": ids[:2], "action": "snooze", "until": until})

    summary = client.get("/inbox/summary").json()
    assert summary["total_open"] == 1
    assert summary["total_snoozed"] == 2


def test_done_then_restore_round_trip(client):
    # W7: a single item archives to Done and restores back to Open.
    (nid,) = _seed_notifications(client, 1)

    archived = client.post(f"/inbox/{nid}/archive")
    assert archived.status_code == 200, archived.text
    assert archived.json()["archived"] is True
    assert archived.json()["done_at"] is not None
    assert nid in {n["id"] for n in client.get("/inbox", params={"status": "done"}).json()}
    assert nid not in {n["id"] for n in client.get("/inbox", params={"status": "open"}).json()}

    restored = client.post(f"/inbox/{nid}/unarchive")
    assert restored.status_code == 200, restored.text
    assert restored.json()["archived"] is False
    assert restored.json()["done_at"] is None
    assert nid in {n["id"] for n in client.get("/inbox", params={"status": "open"}).json()}


def test_badge_math_across_buckets(client):
    # W5/W7: summary totals must partition cleanly into open / snoozed / done,
    # with unread counted only against open items.
    ids = _seed_notifications(client, 5)
    until = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    client.post("/inbox/bulk", json={"ids": ids[:2], "action": "snooze", "until": until})  # 2 snoozed
    client.post("/inbox/bulk", json={"ids": ids[2:3], "action": "archive"})                # 1 done
    client.post("/inbox/bulk", json={"ids": ids[3:4], "action": "read"})                   # 1 open, read
    # ids[4] stays open + unread.

    summary = client.get("/inbox/summary").json()
    assert summary["total_open"] == 2          # ids[3] (read) + ids[4] (unread)
    assert summary["total_snoozed"] == 2
    assert summary["total_unread"] == 1        # only ids[4]
    done_total = sum(c["done"] for c in summary["categories"])
    assert done_total == 1
