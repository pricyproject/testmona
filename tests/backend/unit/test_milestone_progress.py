"""Milestone progress should track test execution automatically.

These cover the recompute service that keeps a milestone's stored
``progress_percentage`` and ``status`` in sync with its underlying test
results, so users no longer have to edit progress by hand.
"""

import pytest

from app import models
from app.crud_modules.test_management import (
    create_test_result,
    delete_test_result,
    update_test_result,
    update_test_run,
)
from app.schemas import (
    TestResultCreate as ResultCreate,
    TestResultUpdate as ResultUpdate,
    TestRunUpdate as RunUpdate,
)
from app.services.milestone_service import (
    enrich_milestone,
    recompute_milestone_progress,
)


@pytest.fixture()
def project_db(mem_db):
    db = mem_db
    db.add(models.User(id=1, username="u1", email="u@x.com", hashed_password="x", full_name="U One"))
    db.add(models.Project(id=1, name="P1", owner_id=1))
    db.add(models.TestSuite(id=1, name="S1", project_id=1))
    db.add(models.TestCase(id=1, title="TC1", test_suite_id=1, status="active", priority="high", test_type="manual"))
    db.add(models.TestCase(id=2, title="TC2", test_suite_id=1, status="active", priority="high", test_type="manual"))
    db.commit()
    return db


def _make_milestone_with_run(db, *, link="direct"):
    """Create a milestone, a plan, and a run linked either ``direct``ly to the
    milestone or via its ``plan``."""
    milestone = models.Milestone(id=1, title="M1", project_id=1, status=models.MilestoneStatus.PLANNED, progress_percentage=0)
    db.add(milestone)
    plan = models.TestPlan(id=1, title="TP1", project_id=1, milestone_id=1, created_by=1)
    db.add(plan)
    run = models.TestRun(
        id=1, name="R1", project_id=1,
        milestone_id=1 if link == "direct" else None,
        test_plan_id=1 if link == "plan" else None,
    )
    db.add(run)
    db.commit()
    return milestone, plan, run


@pytest.mark.parametrize("link", ["direct", "plan"])
def test_recording_results_updates_progress_and_status(project_db, link):
    db = project_db
    milestone, _plan, run = _make_milestone_with_run(db, link=link)

    # Two planned-but-unexecuted results: nothing executed yet.
    create_test_result(db, ResultCreate(test_run_id=1, test_case_id=1, status="not_started"))
    create_test_result(db, ResultCreate(test_run_id=1, test_case_id=2, status="not_started"))
    db.refresh(milestone)
    assert milestone.status == models.MilestoneStatus.PLANNED
    assert milestone.progress_percentage == 0

    # Execute one of the two -> 50% executed, status flips to in-progress.
    result = db.query(models.TestResult).filter(models.TestResult.test_case_id == 1).first()
    update_test_result(db, result.id, ResultUpdate(status="passed"))
    db.refresh(milestone)
    assert milestone.status == models.MilestoneStatus.IN_PROGRESS
    assert milestone.progress_percentage == 50

    # Execute the second -> 100% executed.
    result2 = db.query(models.TestResult).filter(models.TestResult.test_case_id == 2).first()
    update_test_result(db, result2.id, ResultUpdate(status="failed"))
    db.refresh(milestone)
    assert milestone.progress_percentage == 100


def test_deleting_result_recomputes_progress(project_db):
    db = project_db
    milestone, _plan, _run = _make_milestone_with_run(db)
    create_test_result(db, ResultCreate(test_run_id=1, test_case_id=1, status="passed"))
    r2 = create_test_result(db, ResultCreate(test_run_id=1, test_case_id=2, status="not_started"))
    db.refresh(milestone)
    assert milestone.progress_percentage == 50  # 1 of 2 executed

    # Removing the unexecuted result leaves only the executed one -> 100%.
    delete_test_result(db, r2.id)
    db.refresh(milestone)
    assert milestone.progress_percentage == 100


def test_relinking_run_moves_progress_between_milestones(project_db):
    db = project_db
    db.add(models.Milestone(id=1, title="M1", project_id=1, status=models.MilestoneStatus.PLANNED, progress_percentage=0))
    db.add(models.Milestone(id=2, title="M2", project_id=1, status=models.MilestoneStatus.PLANNED, progress_percentage=0))
    db.add(models.TestRun(id=1, name="R1", project_id=1, milestone_id=1))
    db.commit()
    create_test_result(db, ResultCreate(test_run_id=1, test_case_id=1, status="passed"))

    m1 = db.get(models.Milestone, 1)
    m2 = db.get(models.Milestone, 2)
    db.refresh(m1)
    assert m1.status == models.MilestoneStatus.IN_PROGRESS
    assert m1.progress_percentage == 100

    # Move the run to M2: M1 loses its only run, M2 gains it.
    update_test_run(db, 1, RunUpdate(milestone_id=2))
    db.refresh(m1)
    db.refresh(m2)
    assert m1.progress_percentage == 0           # no execution left -> recomputed to 0
    assert m2.status == models.MilestoneStatus.IN_PROGRESS
    assert m2.progress_percentage == 100


def test_completed_milestone_is_left_untouched(project_db):
    db = project_db
    milestone = models.Milestone(id=1, title="M1", project_id=1, status=models.MilestoneStatus.COMPLETED, progress_percentage=100)
    db.add(milestone)
    db.add(models.TestRun(id=1, name="R1", project_id=1, milestone_id=1))
    db.commit()

    # A late not_started result must not reopen or regress a closed milestone.
    create_test_result(db, ResultCreate(test_run_id=1, test_case_id=1, status="not_started"))
    db.refresh(milestone)
    assert milestone.status == models.MilestoneStatus.COMPLETED
    assert milestone.progress_percentage == 100


def test_recompute_is_idempotent(project_db):
    db = project_db
    milestone, _plan, _run = _make_milestone_with_run(db)
    create_test_result(db, ResultCreate(test_run_id=1, test_case_id=1, status="passed"))
    db.refresh(milestone)

    # Re-running against an already-current milestone changes nothing.
    assert recompute_milestone_progress(db, milestone) is False
    enrich_milestone(db, milestone)
    assert milestone.progress_percentage == 100
