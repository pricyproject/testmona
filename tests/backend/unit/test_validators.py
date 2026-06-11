"""Unit tests for Pydantic schema validators and pure model-level logic.

Covers: RequirementChatAsk, RequirementChatMessageView, TestResult status
normalizer, chat settings normalizer, ChatAsk source-type validation.

No database or HTTP harness required.
"""

from datetime import datetime, timedelta, timezone

import pytest
from types import SimpleNamespace


# ---------------------------------------------------------------------------
# RequirementChatAsk
# ---------------------------------------------------------------------------

def test_question_validator_rejects_blank():
    from app.schemas import RequirementChatAsk
    with pytest.raises(ValueError):
        RequirementChatAsk(question="   ")
    assert RequirementChatAsk(question="  hi  ").question == "hi"


def test_chat_ask_schema_cleans_source_types():
    from app.schemas import RequirementChatAsk
    asked = RequirementChatAsk(question="hi", source_types=["defects", "defects", "test_plans"])
    assert asked.source_types == ["defects", "test_plans"]

    with pytest.raises(ValueError):
        RequirementChatAsk(question="hi", source_types=["defects", "bogus"])

    assert RequirementChatAsk(question="hi").source_types is None


def test_chat_ask_question_strip_preserves_content():
    from app.schemas import RequirementChatAsk
    ask = RequirementChatAsk(question="\t  What is login?  \n")
    assert ask.question == "What is login?"


# ---------------------------------------------------------------------------
# RequirementChatMessageView: null sources coercion
# ---------------------------------------------------------------------------

def test_message_view_coerces_null_sources():
    from app.schemas import RequirementChatMessageView
    m = SimpleNamespace(id=1, role="user", content="hi", sources=None,
                        prompt_tokens=None, created_at=datetime(2026, 6, 2))
    view = RequirementChatMessageView.model_validate(m)
    assert view.sources == []


def test_message_view_preserves_existing_sources():
    from app.schemas import RequirementChatMessageView
    sources = [{"key": "REQ-1", "title": "Login", "type": "requirement"}]
    m = SimpleNamespace(id=2, role="assistant", content="ok", sources=sources,
                        prompt_tokens=10, created_at=datetime(2026, 6, 2))
    view = RequirementChatMessageView.model_validate(m)
    assert len(view.sources) == 1
    assert view.sources[0].key == "REQ-1"
    assert view.sources[0].title == "Login"


# ---------------------------------------------------------------------------
# TestResult status normalizer (model-level validator)
# ---------------------------------------------------------------------------

def test_result_status_validator_folds_pending_to_not_started():
    from app import models
    assert models.TestResult(status="pending").status == "not_started"
    assert models.TestResult(status="not started").status == "not_started"
    assert models.TestResult(status="skipped").status == "skip"
    assert models.TestResult(status="PASSED").status == "pass"


def test_result_status_canonical_values_pass_through():
    from app import models
    for status in ("pass", "fail", "skip", "block", "not_started"):
        assert models.TestResult(status=status).status == status


def test_result_status_uppercase_variants_normalized():
    from app import models
    assert models.TestResult(status="FAIL").status == "fail"
    assert models.TestResult(status="BLOCK").status == "block"


# ---------------------------------------------------------------------------
# Requirement chat settings normalizer
# ---------------------------------------------------------------------------

def test_requirement_chat_settings_normalize_clamps():
    from app.services.ai_manager import _normalize_requirement_chat, DEFAULT_REQUIREMENT_CHAT
    assert _normalize_requirement_chat(None) == DEFAULT_REQUIREMENT_CHAT

    out = _normalize_requirement_chat({
        "enabled": False,
        "max_context_requirements": 9999,
        "history_turns": -5,
    })
    assert out["enabled"] is False
    assert out["max_context_requirements"] == 200
    assert out["history_turns"] == 0

    out2 = _normalize_requirement_chat({"max_context_requirements": 0})
    assert out2["max_context_requirements"] == 1


def test_requirement_chat_settings_defaults_applied_on_partial():
    from app.services.ai_manager import _normalize_requirement_chat, DEFAULT_REQUIREMENT_CHAT
    out = _normalize_requirement_chat({"enabled": False})
    assert out["max_context_requirements"] == DEFAULT_REQUIREMENT_CHAT["max_context_requirements"]
    assert out["history_turns"] == DEFAULT_REQUIREMENT_CHAT["history_turns"]


# ---------------------------------------------------------------------------
# Enhanced: edge cases for validators
# ---------------------------------------------------------------------------

def test_chat_ask_all_valid_source_types_accepted():
    from app.schemas import RequirementChatAsk
    valid = ["requirements", "defects", "test_cases", "test_plans"]
    ask = RequirementChatAsk(question="q", source_types=valid)
    assert set(ask.source_types) == set(valid)


def test_chat_ask_empty_source_types_list_treated_as_none():
    from app.schemas import RequirementChatAsk
    ask = RequirementChatAsk(question="q", source_types=[])
    assert ask.source_types is None or ask.source_types == []


# ---------------------------------------------------------------------------
# Milestones and test plans
# ---------------------------------------------------------------------------

def test_milestone_health_helpers_cover_status_edges(monkeypatch):
    from app import models
    from app.services import milestone_service

    fixed_now = datetime(2026, 6, 11, 12, tzinfo=timezone.utc)

    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return fixed_now if tz else fixed_now.replace(tzinfo=None)

    monkeypatch.setattr(milestone_service, "datetime", FixedDateTime)

    due_today = SimpleNamespace(
        target_date=datetime(2026, 6, 11, tzinfo=timezone.utc),
        status=models.MilestoneStatus.PLANNED,
    )
    old = SimpleNamespace(
        target_date=datetime(2026, 6, 10, tzinfo=timezone.utc),
        status=models.MilestoneStatus.PLANNED,
    )
    cancelled = SimpleNamespace(
        target_date=datetime(2026, 6, 1, tzinfo=timezone.utc),
        status=models.MilestoneStatus.CANCELLED,
    )

    assert milestone_service._percentage(1, 3) == 33
    assert milestone_service._percentage(5, 0) == 0
    assert milestone_service._normalize_status(models.DefectStatus.IN_PROGRESS) == "in_progress"
    assert milestone_service._is_overdue(due_today) is False
    assert milestone_service._is_overdue(old) is True
    assert milestone_service._derive_health(cancelled, open_defects=0, critical_defects=0,
                                            failed_results=0, blocked_results=0,
                                            blocked_plans=0, progress=100) == "cancelled"
    assert milestone_service._derive_health(old, open_defects=0, critical_defects=0,
                                            failed_results=0, blocked_results=0,
                                            blocked_plans=0, progress=0) == "at_risk"


def test_test_plan_and_milestone_schema_validation():
    from app import schemas

    start = datetime(2026, 6, 12, tzinfo=timezone.utc)
    end = datetime(2026, 6, 11, tzinfo=timezone.utc)

    with pytest.raises(ValueError):
        schemas.TestPlanCreate(title="Plan", project_id=1, created_by=1,
                               target_start_date=start, target_end_date=end)
    with pytest.raises(ValueError):
        schemas.TestPlanUpdate(title="   ")
    with pytest.raises(ValueError):
        schemas.MilestoneCreate(title="Milestone", project_id=1, progress_percentage=101)

    plan = schemas.TestPlanCreate(title="  Regression  ", project_id=1, created_by=1,
                                  description="<b>scope</b>")
    milestone = schemas.MilestoneCreate(title="  Release 1  ", project_id=1, progress_percentage=40)
    assert plan.title == "Regression"
    assert plan.description == "&lt;b&gt;scope&lt;/b&gt;"
    assert milestone.title == "Release 1"


def test_compute_plan_executions_rolls_up_statuses(mem_db):
    from app import models
    from app.services.test_plan_service import compute_plan_executions

    db = mem_db
    db.add(models.User(id=1, username="u", email="u@test.local", hashed_password="x"))
    db.add(models.Project(id=1, name="Project", owner_id=1))
    db.add(models.TestSuite(id=1, name="Suite", project_id=1))
    db.add(models.TestCase(id=1, title="Login", test_suite_id=1, status="active", priority="high", test_type="manual"))
    db.add(models.TestPlan(id=1, title="Plan A", project_id=1, created_by=1))
    db.add(models.TestPlan(id=2, title="Plan B", project_id=1, created_by=1))
    db.add(models.TestRun(id=1, name="Run A1", project_id=1, test_plan_id=1))
    db.add(models.TestRun(id=2, name="Run A2", project_id=1, test_plan_id=1))
    db.add(models.TestRun(id=3, name="Run B1", project_id=1, test_plan_id=2))
    db.add_all([
        models.TestResult(id=1, test_case_id=1, test_run_id=1, status="passed"),
        models.TestResult(id=2, test_case_id=1, test_run_id=1, status="failed"),
        models.TestResult(id=3, test_case_id=1, test_run_id=2, status="blocked"),
        models.TestResult(id=4, test_case_id=1, test_run_id=2, status="not_started"),
    ])
    db.commit()

    rollups = compute_plan_executions(db, [1, 2, 999])

    assert rollups[1]["run_count"] == 2
    assert rollups[1]["result_count"] == 4
    assert rollups[1]["executed_count"] == 3
    assert rollups[1]["execution_progress"] == 75
    assert rollups[1]["pass_rate"] == 33
    assert rollups[1]["execution_status"] == "failed"
    assert rollups[2]["execution_status"] == "in_progress"
    assert rollups[999]["execution_status"] == "not_started"


# ---------------------------------------------------------------------------
# Test asset health
# ---------------------------------------------------------------------------

def test_test_asset_health_schema_and_reference_helpers():
    from app import schemas
    from app.services import test_asset_health_service as health

    item = schemas.TestDebtItemCreate(
        test_case_id=1,
        debt_type=" Duplicate ",
        severity=" HIGH ",
        suggested_action=" Merge ",
        details="  Review duplicate title  ",
    )
    assert item.debt_type == "duplicate"
    assert item.severity == "high"
    assert item.suggested_action == "merge"
    assert item.details == "Review duplicate title"
    assert health._reference_tokens("REQ-1, (BUG-22); note") == {"req-1", "bug-22"}
    assert health._candidate(7, "orphan", "missing suite").severity == "critical"

    with pytest.raises(ValueError):
        schemas.TestDebtItemCreate(test_case_id=1, debt_type="unknown", suggested_action="review")
    with pytest.raises(ValueError):
        schemas.TestDebtItemUpdate(severity="urgent")


def test_duplicate_case_detection_respects_grace_period(monkeypatch):
    from app.services import test_asset_health_service as health

    now = datetime(2026, 6, 11, tzinfo=timezone.utc)
    monkeypatch.setattr(health.settings, "test_asset_duplicate_grace_days", 7)
    old_a = SimpleNamespace(id=1, project_seq=11, title="Login works", created_at=now - timedelta(days=10))
    old_b = SimpleNamespace(id=2, project_seq=12, title=" login   works ", created_at=now - timedelta(days=9))
    fresh = SimpleNamespace(id=3, project_seq=13, title="Login works", created_at=now - timedelta(days=1))

    candidates = health._detect_duplicate_cases([old_a, old_b, fresh], now)

    assert {(c.test_case_id, c.debt_type) for c in candidates} == {(1, "duplicate"), (2, "duplicate")}
    assert all("7-day grace" in c.details for c in candidates)


# ---------------------------------------------------------------------------
# Defects, test runs, and reports
# ---------------------------------------------------------------------------

def test_defect_schemas_reject_unsafe_or_ambiguous_payloads():
    from app import schemas

    with pytest.raises(ValueError):
        schemas.DefectCreate(title="Bug", project_id=1, defect_id="CLIENT-1")
    with pytest.raises(ValueError):
        schemas.DefectCreate(title="Bug", project_id=1, external_issue_url="ftp://tracker.example/BUG-1")
    with pytest.raises(ValueError):
        schemas.TestResultFailingStepSnapshot(status="passed")
    with pytest.raises(ValueError):
        schemas.TestResultDefectLinkCreate()
    with pytest.raises(ValueError):
        schemas.TestResultDefectLinkCreate(defect_id=1, new_defect=schemas.DefectCreate(title="Bug", project_id=1))

    defect = schemas.DefectCreate(title="<script>alert(1)</script>", project_id=1,
                                  external_issue_url=" https://tracker.example/BUG-1 ")
    step = schemas.TestResultFailingStepSnapshot(step_number=2, status="BLOCKED")
    link = schemas.TestResultDefectLinkCreate(defect_id=4, failing_step=step)
    assert defect.title == "&lt;script&gt;alert(1)&lt;/script&gt;"
    assert defect.external_issue_url == "https://tracker.example/BUG-1"
    assert link.failing_step.status == "blocked"


def test_test_run_and_shareable_report_validation():
    from app import schemas

    with pytest.raises(ValueError):
        schemas.TestRunAssign(assigned_to=0)
    with pytest.raises(ValueError):
        schemas.ShareableReportRequest(project_id=1, title="Report", report_type="unknown")
    with pytest.raises(ValueError):
        schemas.ShareableReportRequest(project_id=1, title="Report", report_type="summary",
                                       access_level="restricted")
    with pytest.raises(ValueError):
        schemas.ShareableReportRequest(project_id=1, title="Report", report_type="summary",
                                       time_range="custom")

    start = datetime(2026, 6, 1, tzinfo=timezone.utc)
    end = datetime(2026, 6, 11, tzinfo=timezone.utc)
    request = schemas.ShareableReportRequest(
        project_id=1,
        title="  Quality Report  ",
        report_type=" Executive ",
        access_level=" Restricted ",
        shared_with=["QA@EXAMPLE.COM", "qa@example.com", 5],
        include_sections=["kpis", "summary", "kpis"],
        export_formats=["CSV", "json", "csv"],
        time_range="custom",
        period_start=start,
        period_end=end,
    )
    assert request.title == "Quality Report"
    assert request.report_type == "executive"
    assert request.access_level == "restricted"
    assert request.shared_with == ["qa@example.com", 5]
    assert request.include_sections == ["kpis", "summary"]
    assert request.export_formats == ["csv", "json"]


def test_test_run_defect_coverage_and_flakiness_reports(mem_db):
    from app import crud, models

    db = mem_db
    now = datetime(2026, 6, 11, tzinfo=timezone.utc)
    db.add(models.User(id=1, username="u", email="u2@test.local", hashed_password="x"))
    db.add(models.Project(id=1, name="Project", owner_id=1))
    db.add(models.TestSuite(id=1, name="Suite", project_id=1))
    db.add(models.TestCase(id=1, title="Case 1", test_suite_id=1, status="active", priority="high", test_type="manual"))
    db.add(models.TestCase(id=2, title="Case 2", test_suite_id=1, status="active", priority="medium", test_type="manual"))
    db.add(models.TestRun(id=1, name="Current", project_id=1))
    db.add(models.TestRun(id=2, name="Previous", project_id=1))
    db.add(models.Defect(id=1, title="Open bug", defect_id="DEF-1", project_id=1,
                         status=models.DefectStatus.OPEN, severity=models.DefectSeverity.HIGH,
                         priority=models.DefectPriority.HIGH, reported_by=1))
    db.add_all([
        models.TestResult(id=1, test_case_id=1, test_run_id=1, status="failed", executed_at=now, retest_needed=True),
        models.TestResult(id=2, test_case_id=2, test_run_id=1, status="blocked", executed_at=now),
        models.TestResult(id=3, test_case_id=1, test_run_id=2, status="passed", executed_at=now - timedelta(days=1)),
        models.TestResult(id=4, test_case_id=1, test_run_id=2, status="failed", executed_at=now - timedelta(days=2)),
        models.TestResult(id=5, test_case_id=2, test_run_id=2, status="passed", executed_at=now - timedelta(days=1)),
    ])
    db.add(models.TestResultDefectLink(test_result_id=1, defect_id=1, link_type="found"))
    db.commit()

    coverage = crud.get_test_run_defect_coverage(db, 1)
    flakiness = crud.get_test_run_flakiness(db, 1)

    assert coverage == {
        "test_run_id": 1,
        "total_results": 2,
        "failed_or_blocked": 2,
        "linked": 1,
        "unlinked": 1,
        "open_defects": 1,
        "retest_needed": 1,
    }
    assert flakiness[1] == {"runs": 3, "fails": 2, "flaky": True}
    assert flakiness[2] == {"runs": 2, "fails": 1, "flaky": False}


def test_analytics_shared_normalizers_and_reference_links():
    from app.services import analytics_shared

    linked = {1: set(), 2: set()}
    requirements = [SimpleNamespace(id=1, requirement_id="REQ-1"), SimpleNamespace(id=2, requirement_id="REQ-2")]
    test_cases = [SimpleNamespace(id=10, reference="covers (REQ-1), BUG-2"), SimpleNamespace(id=11, reference="none")]

    analytics_shared.add_legacy_reference_links(linked, requirements, test_cases)

    assert analytics_shared.normalize_result_status(" fail ") == "failed"
    assert analytics_shared.normalize_result_status(None) == ""
    assert analytics_shared.get_reference_tokens("REQ-1, [DEF-22] req-1") == ["req-1", "def-22"]
    assert linked == {1: {10}, 2: set()}

