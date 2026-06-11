"""Shared pytest fixtures for all backend tests.

Provides:
  mem_db       — raw in-memory SQLite session, all tables created.
  seeded_db    — mem_db with two projects, users, defects, and test cases.
  values_db    — mem_db seeded for TQL value-suggestions tests.
  make_http_client — helper to build a (TestClient, SessionLocal) pair that
                      wires get_db / get_current_active_user overrides so each
                      integration test starts with a clean, isolated database.
"""

import os
import tempfile

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


# ---------------------------------------------------------------------------
# Low-level DB fixtures (used by unit tests that need DB access)
# ---------------------------------------------------------------------------

@pytest.fixture()
def mem_db():
    """Minimal in-memory SQLite session with every table created."""
    from app.database import Base
    from app import models  # noqa: F401  (registers all ORM classes)

    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture()
def seeded_db(mem_db):
    """mem_db pre-seeded with two projects, users, defects, and test cases.

    Layout
    ------
    Project 1  ← DEF-1 (OPEN/HIGH/CRITICAL, assigned to user 1)
               ← TC-1 (active/high, in suite S1)
               ← TC-3 (active/high, in suite S1, soft-deleted)
    Project 2  ← DEF-2 (OPEN)
               ← TC-2 (active/low, in suite S2)
    """
    from app import models

    db = mem_db
    db.add(models.User(id=1, username="u1", email="u@x.com", hashed_password="x", full_name="U One"))
    db.add(models.Project(id=1, name="P1", owner_id=1))
    db.add(models.Project(id=2, name="P2", owner_id=1))
    db.add(models.Defect(
        id=1, title="Login broken", defect_id="DEF-1", project_id=1,
        status=models.DefectStatus.OPEN, priority=models.DefectPriority.HIGH,
        severity=models.DefectSeverity.CRITICAL, reported_by=1, assigned_to=1,
    ))
    db.add(models.Defect(
        id=2, title="Other project", defect_id="DEF-2", project_id=2,
        status=models.DefectStatus.OPEN, reported_by=1,
    ))
    db.add(models.TestSuite(id=1, name="S1", project_id=1))
    db.add(models.TestSuite(id=2, name="S2", project_id=2))
    db.add(models.TestCase(id=1, title="TC login", test_suite_id=1, status="active", priority="high", test_type="manual"))
    db.add(models.TestCase(id=2, title="TC other", test_suite_id=2, status="active", priority="low", test_type="manual"))
    db.add(models.TestCase(id=3, title="TC deleted", test_suite_id=1, status="active", priority="high", test_type="manual", is_deleted=True))
    db.commit()
    yield db


@pytest.fixture()
def values_db(mem_db):
    """mem_db pre-seeded for TQL value-suggestions tests.

    DEF-1 / DEF-2 belong to project 1, DEF-3 to project 2 (leaked-tag must
    not appear in project-1 suggestions).
    """
    from app import models

    db = mem_db
    db.add(models.User(id=1, username="u", email="u@x.com", hashed_password="x", full_name="U"))
    db.add(models.Project(id=1, name="P1", owner_id=1))
    db.add(models.Project(id=2, name="P2", owner_id=1))
    db.add(models.Defect(id=1, title="A", defect_id="DEF-1", project_id=1, reported_by=1,
                         tags="login,auth,ui", environment="prod"))
    db.add(models.Defect(id=2, title="B", defect_id="DEF-2", project_id=1, reported_by=1,
                         tags="auth,api", environment="staging"))
    db.add(models.Defect(id=3, title="C", defect_id="DEF-3", project_id=2, reported_by=1,
                         tags="leaked-tag", environment="prod"))
    db.commit()
    yield db


# ---------------------------------------------------------------------------
# HTTP-client helper (used by integration tests)
# ---------------------------------------------------------------------------

def seed_admin_project_member(db, _engine):
    """Seed an admin-owned project plus one assigned member for route tests."""
    from app import models

    admin = models.User(
        username="admin", email="admin@b.c", hashed_password="x",
        role="admin", is_active=True, full_name="Admin",
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    project = models.Project(name="Proj", description="d", owner_id=admin.id)
    db.add(project)
    db.commit()
    db.refresh(project)
    member = models.User(
        username="bob", email="bob@b.c", hashed_password="x",
        role="user", is_active=True, full_name="Bob",
    )
    db.add(member)
    db.commit()
    db.refresh(member)
    db.add(models.ProjectAssignment(project_id=project.id, user_id=member.id))
    db.commit()
    return admin.id, project.id, {"member_id": member.id, "member_username": member.username}


def make_http_client(*, seed_fn=None):
    """Return a pytest fixture that yields a TestClient backed by an isolated
    file-based SQLite database.

    Parameters
    ----------
    seed_fn:
        Optional callable ``(db, engine) -> (user_id, project_id, extras)``
        that seeds the database and returns the IDs the test will need.  The
        ``extras`` dict is merged onto the yielded client as attributes.
        Defaults to creating a single admin user + project.
    """
    @pytest.fixture()
    def _client():
        from app.database import Base, get_db
        from app.auth import get_current_active_user, get_current_user
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
        Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)

        # ---- seed --------------------------------------------------------
        if seed_fn is not None:
            db = Session()
            user_id, project_id, extras = seed_fn(db, engine)
            db.close()
        else:
            db = Session()
            user = models.User(
                username="admin", email="a@b.c", hashed_password="x",
                role="admin", is_active=True, full_name="Admin",
            )
            db.add(user)
            db.commit()
            db.refresh(user)
            project = models.Project(name="Proj", description="d", owner_id=user.id)
            db.add(project)
            db.commit()
            db.refresh(project)
            user_id, project_id, extras = user.id, project.id, {}
            db.close()

        # ---- dependency overrides ----------------------------------------
        def override_db():
            d = Session()
            try:
                yield d
            finally:
                d.close()

        def override_user():
            d = Session()
            try:
                return d.query(models.User).filter(models.User.id == user_id).first()
            finally:
                d.close()

        main.app.dependency_overrides[get_db] = override_db
        main.app.dependency_overrides[get_current_active_user] = override_user
        main.app.dependency_overrides[get_current_user] = override_user

        c = TestClient(main.app)
        c.project_id = project_id  # type: ignore[attr-defined]
        c.SessionLocal = Session   # type: ignore[attr-defined]
        c.set_current_user = (     # type: ignore[attr-defined]
            lambda uid: [
                main.app.dependency_overrides.__setitem__(
                    dependency,
                    lambda uid=uid: Session().query(models.User).filter(models.User.id == uid).first(),
                )
                for dependency in (get_current_active_user, get_current_user)
            ]
        )
        for k, v in extras.items():
            setattr(c, k, v)

        try:
            yield c
        finally:
            main.app.dependency_overrides.clear()
            engine.dispose()
            os.unlink(path)

    return _client
