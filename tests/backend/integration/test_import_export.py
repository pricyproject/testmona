"""Tests for test-case import/export bug fixes.

Self-contained: builds a fresh in-file SQLite DB and overrides ``get_db`` and
auth, mirroring tests/test_doc_hub.py.

Covers the regressions fixed in this change:
  * a dry-run import must NOT poison the Idempotency-Key cache, so a real
    import reusing the same key still imports (previously it returned the
    cached dry-run result and imported nothing);
  * CSV export emits clean ``is_multistep``/``order_index``/datetime values
    that round-trip back through import;
  * the import template endpoint does not crash when a SELECT/MULTISELECT
    custom field stores its options as a dict.
"""

import io
import os
import tempfile

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


@pytest.fixture()
def client():
    from app.database import Base, get_db
    from app.auth import get_current_active_user
    from app import models
    import app.main as main

    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    engine = create_engine(
        f"sqlite:///{path}",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    db = TestingSession()
    user = models.User(username="admin", email="a@b.c", hashed_password="x",
                       role="admin", is_active=True, full_name="Admin")
    db.add(user)
    db.commit()
    db.refresh(user)
    project = models.Project(name="Proj", description="d", owner_id=user.id)
    db.add(project)
    db.commit()
    db.refresh(project)
    suite = models.TestSuite(name="Suite", description="d", project_id=project.id)
    db.add(suite)
    db.commit()
    db.refresh(suite)
    uid, pid, sid = user.id, project.id, suite.id
    db.close()

    def override_db():
        d = TestingSession()
        try:
            yield d
        finally:
            d.close()

    def override_user():
        d = TestingSession()
        try:
            return d.query(models.User).filter(models.User.id == uid).first()
        finally:
            d.close()

    main.app.dependency_overrides[get_db] = override_db
    main.app.dependency_overrides[get_current_active_user] = override_user
    c = TestClient(main.app)
    c.project_id = pid  # type: ignore[attr-defined]
    c.suite_id = sid  # type: ignore[attr-defined]
    c.SessionLocal = TestingSession  # type: ignore[attr-defined]
    try:
        yield c
    finally:
        main.app.dependency_overrides.clear()
        engine.dispose()
        os.unlink(path)


def _import_previewed(client, rows, *, dry_run, key):
    return client.post(
        "/import-export/import/test-cases/previewed",
        json={
            "test_suite_id": client.suite_id,
            "rows": rows,
            "skip_duplicates": False,
            "import_mode": "create_only",
            "dry_run": dry_run,
        },
        headers={"Idempotency-Key": key},
    )


def test_dry_run_does_not_poison_idempotency_cache(client):
    """Validate-only (dry_run) then a real import with the SAME key must import."""
    rows = [{"title": "Login works", "priority": "high", "test_type": "manual"}]

    dry = _import_previewed(client, rows, dry_run=True, key="abc-123")
    assert dry.status_code == 200, dry.text
    assert dry.json()["dry_run"] is True
    assert dry.json()["imported_rows"] == 1
    assert dry.json()["created_ids"] == []  # nothing actually created

    # Same Idempotency-Key as the dry run: previously this returned the cached
    # dry-run response and created nothing.
    real = _import_previewed(client, rows, dry_run=False, key="abc-123")
    assert real.status_code == 200, real.text
    body = real.json()
    assert body["dry_run"] is False
    assert body["imported_rows"] == 1
    assert len(body["created_ids"]) == 1


def test_real_import_idempotency_still_dedupes(client):
    """Two identical real imports with the same key import only once."""
    rows = [{"title": "Idempotent case"}]
    first = _import_previewed(client, rows, dry_run=False, key="real-1")
    assert first.status_code == 200, first.text
    assert len(first.json()["created_ids"]) == 1

    second = _import_previewed(client, rows, dry_run=False, key="real-1")
    assert second.status_code == 200, second.text
    # Cached response is replayed verbatim -> same created ids, no new rows.
    assert second.json()["created_ids"] == first.json()["created_ids"]


def test_export_roundtrips_multistep_and_flags(client):
    """Exported CSV must re-import cleanly (is_multistep/order_index/dates)."""
    multistep = (
        '[{"step_number": 1, "action": "open app", '
        '"expected_result": "app opens", "step_type": "manual", "order_index": 0}]'
    )
    rows = [
        {"title": "Plain case", "order_index": "0", "is_multistep": "false"},
        {"title": "Steps case", "is_multistep": "true", "multistep_data": multistep},
    ]
    created = _import_previewed(client, rows, dry_run=False, key="exp-seed")
    assert created.status_code == 200, created.text
    assert created.json()["imported_rows"] == 2

    export = client.get(f"/import-export/export/test-cases/?test_suite_id={client.suite_id}")
    assert export.status_code == 200, export.text
    content = export.json()["content"]

    import csv as _csv
    parsed = list(_csv.DictReader(io.StringIO(content)))
    assert len(parsed) == 2
    by_title = {r["title"]: r for r in parsed}
    # order_index 0 and is_multistep False are emitted, not dropped to ''.
    assert by_title["Plain case"]["order_index"] == "0"
    assert by_title["Plain case"]["is_multistep"] == "false"
    assert by_title["Steps case"]["is_multistep"] == "true"
    assert "open app" in by_title["Steps case"]["multistep_data"]


def test_import_template_handles_dict_options(client):
    """SELECT custom field whose options are stored as a dict must not 500."""
    from app import models
    Session = client.SessionLocal
    db = Session()
    cf = models.CustomFieldDefinition(
        name="Environment",
        field_type=models.CustomFieldType.SELECT,
        is_required=False,
        project_id=client.project_id,
        options={"options": ["staging", "prod"]},
    )
    db.add(cf)
    db.commit()
    db.close()

    resp = client.get(
        f"/import-export/import/template?include_custom_fields=true&project_id={client.project_id}"
    )
    assert resp.status_code == 200, resp.text
    assert "Environment" in resp.json()["fieldnames"]
    assert "staging" in resp.json()["content"]
