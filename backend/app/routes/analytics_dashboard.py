"""
Analytics, dashboard, KPI data, test step results, and shareable reports routes.
"""

from fastapi import Depends, HTTPException, Query, Request, Response
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timedelta, UTC
import csv
import io
import json
import re

from .. import crud, schemas, auth, rbac, models
from ..feature_guard import require_project_feature
from ..database import get_db
from ..auth import get_current_active_user
from ..crud import (
    calculate_project_kpis,
    create_kpi_data, get_kpi_data, get_latest_kpi_data,
    create_test_step_result, get_test_step_results, get_test_step_results_by_test_result,
    create_shareable_report, get_shareable_reports, get_shareable_report,
    get_shareable_report_by_token, record_shareable_report_view,
    update_shareable_report, deactivate_shareable_report,
    create_root_cause_analysis, get_root_cause_analyses, get_root_cause_analysis,
    update_root_cause_analysis, delete_root_cause_analysis,
    create_dashboard_widget, get_dashboard_widgets, get_dashboard_widget,
    update_dashboard_widget, delete_dashboard_widget,
    generate_dashboard_analytics
)
from ..services.analytics_shared import (
    add_legacy_reference_links,
    get_linked_requirement_test_case_ids,
    normalize_result_status,
    build_coverage_report,
)
from ..services import notification_engine
import logging

logger = logging.getLogger(__name__)


def _notify_rca_assignee(
    db: Session,
    analysis: "models.RootCauseAnalysis",
    assigned_by: Optional[schemas.User],
    previous_assigned_to: Optional[int] = None,
) -> None:
    """Notify a root-cause-analysis assignee when they are newly assigned.

    The lightweight twin of the requirement/defect/test-plan/milestone assignment
    notifies — an RCA assignee lands work in their Work Inbox via the engine's
    ASSIGNMENT category the same way. No-op when the assignee is unchanged, on
    self-assignment, or when the analysis is unassigned. Delivery never blocks the
    write path.
    """
    assignee_id = analysis.assigned_to
    if not assignee_id or assignee_id == previous_assigned_to:
        return
    if assigned_by is not None and assignee_id == assigned_by.id:
        return
    try:
        assignee = db.query(models.User).filter(
            models.User.id == assignee_id, models.User.is_active == True
        ).first()
        if not assignee:
            return
        actor = notification_engine.actor_display_name(assigned_by)
        label = analysis.analysis_title or f"#{analysis.id}"
        batch = notification_engine.NotificationBatch()
        batch.add(
            category=notification_engine.ASSIGNMENT,
            user_ids=[assignee.id],
            actor_id=assigned_by.id if assigned_by else None,
            title="Root cause analysis assigned",
            message=f"{actor} assigned root cause analysis {label} to you.",
            related_entity_type="root_cause_analysis",
            related_entity_id=analysis.id,
        )
        batch.flush(db)
    except Exception:
        logger.exception(
            "Failed to create root cause analysis assignment notification",
            extra={"analysis_id": getattr(analysis, "id", None), "assignee_id": assignee_id},
        )


REPORT_SECTIONS = {"kpis", "summary", "recent_activity", "trends", "team_performance", "upcoming"}
REPORT_TYPE_SECTIONS = {
    "summary": {"kpis", "summary"},
    "executive": {"kpis", "summary", "recent_activity", "trends"},
    "technical": REPORT_SECTIONS,
    "release-readiness": {"kpis", "summary", "recent_activity", "trends", "upcoming"},
    "execution-summary": {"kpis", "summary", "recent_activity", "trends"},
    "defect-quality": {"kpis", "summary", "recent_activity", "trends"},
    "coverage-traceability": {"kpis", "summary", "trends"},
    "flaky-tests": {"kpis", "trends"},
    "team-activity": {"summary", "recent_activity", "team_performance"},
    "audit-compliance": {"summary", "recent_activity"},
    "milestone": {"kpis", "summary", "recent_activity", "upcoming"},
    "sprint-qa": {"kpis", "summary", "recent_activity", "trends"},
    "customer-quality": {"kpis", "summary", "recent_activity"},
}


def _period_label(time_range, period_start=None, period_end=None):
    if time_range == "custom" and period_start and period_end:
        return f"{period_start.date().isoformat()} to {period_end.date().isoformat()}"
    return {
        "24h": "Last 24 hours",
        "7d": "Last 7 days",
        "30d": "Last 30 days",
        "90d": "Last 90 days",
    }.get(time_range, "Last 30 days")


def _period_bounds(time_range, period_start=None, period_end=None):
    end = period_end or datetime.now()
    if time_range == "custom" and period_start and period_end:
        return period_start, period_end
    days = {
        "24h": 1,
        "7d": 7,
        "30d": 30,
        "90d": 90,
    }.get(time_range, 30)
    return end - timedelta(days=days), end


def _default_sections(report_type):
    return set(REPORT_TYPE_SECTIONS.get(report_type, REPORT_TYPE_SECTIONS["executive"]))


def _display_user(user):
    if not user:
        return None
    return user.full_name or user.username or user.email or f"User #{user.id}"


def _trend(current, previous):
    if previous == 0:
        return {"current": current, "trend": "up" if current > 0 else "stable", "change": current}
    change = round(current - previous, 1)
    return {
        "current": current,
        "trend": "up" if change > 0 else "down" if change < 0 else "stable",
        "change": change,
    }


def _metrics_for_period(db, project_id, start_at, end_at):
    total_test_cases = db.query(models.TestCase).join(models.TestSuite).filter(
        models.TestSuite.project_id == project_id,
        models.TestCase.is_deleted == False,
    ).count()
    results = db.query(models.TestResult).join(models.TestRun).filter(
        models.TestRun.project_id == project_id,
        models.TestResult.executed_at >= start_at,
        models.TestResult.executed_at < end_at,
    ).all()
    executed_statuses = {"passed", "failed", "blocked", "skipped"}
    statuses = [normalize_result_status(result.status) for result in results]
    executed_results = [
        result for result in results
        if normalize_result_status(result.status) in executed_statuses
    ]
    total_tests = len(executed_results)
    passed = statuses.count("passed")
    failed = statuses.count("failed")
    blocked = statuses.count("blocked")
    skipped = statuses.count("skipped")
    executed_cases = len({result.test_case_id for result in executed_results})
    execution_times = [result.execution_time for result in executed_results if result.execution_time is not None]
    completed_runs = db.query(models.TestRun).filter(
        models.TestRun.project_id == project_id,
        models.TestRun.completed_at >= start_at,
        models.TestRun.completed_at < end_at,
        models.TestRun.status.in_(["completed", "passed", "failed"]),
        models.TestRun.created_at.isnot(None),
        models.TestRun.completed_at.isnot(None),
    ).all()
    cycle_times = [
        (run.completed_at - run.created_at).total_seconds() / 3600
        for run in completed_runs
        if run.created_at and run.completed_at
    ]
    status_by_case = {}
    for result in results:
        status = normalize_result_status(result.status)
        if status in {"passed", "failed"}:
            status_by_case.setdefault(result.test_case_id, set()).add(status)
    flaky_tests = len([
        test_case_id for test_case_id, case_statuses in status_by_case.items()
        if {"passed", "failed"}.issubset(case_statuses)
    ])
    defects_found = db.query(models.Defect).filter(
        models.Defect.project_id == project_id,
        models.Defect.created_at >= start_at,
        models.Defect.created_at < end_at,
    ).count()
    period_days = max((end_at - start_at).total_seconds() / 86400, 1)
    return {
        "coverage": round((executed_cases / total_test_cases * 100) if total_test_cases else 0, 1),
        "pass_rate": round((passed / total_tests * 100) if total_tests else 0, 1),
        "failure_rate": round((failed / total_tests * 100) if total_tests else 0, 1),
        "flakiness": round((flaky_tests / len(status_by_case) * 100) if status_by_case else 0, 1),
        "cycle_time": round((sum(cycle_times) / len(cycle_times)) if cycle_times else 0, 2),
        "defect_density": round((defects_found / total_test_cases) if total_test_cases else 0, 2),
        "total_tests": total_tests,
        "passed_tests": passed,
        "failed_tests": failed,
        "blocked_tests": blocked,
        "skipped_tests": skipped,
        "avg_execution_time": round((sum(execution_times) / len(execution_times) / 3600) if execution_times else 0, 2),
        "productivity_score": round(min(100, (total_tests / period_days) * 10), 1),
        "defects_found": defects_found,
        "results": results,
    }


def _team_performance_for_period(metrics):
    member_stats = {}
    for result in metrics["results"]:
        if not result.executed_by:
            continue
        status = normalize_result_status(result.status)
        user = result.executor
        entry = member_stats.setdefault(result.executed_by, {
            "user_id": result.executed_by,
            "name": _display_user(user) or f"User #{result.executed_by}",
            "executed": 0,
            "passed": 0,
            "failed": 0,
            "blocked": 0,
            "skipped": 0,
            "avg_execution_time_hours": 0,
            "_durations": [],
        })
        entry["executed"] += 1
        if status in {"passed", "failed", "blocked", "skipped"}:
            entry[status] += 1
        if result.execution_time is not None:
            entry["_durations"].append(result.execution_time / 3600)
    members = []
    for entry in member_stats.values():
        durations = entry.pop("_durations")
        entry["avg_execution_time_hours"] = round(sum(durations) / len(durations), 2) if durations else 0
        members.append(entry)
    members.sort(key=lambda item: item["executed"], reverse=True)
    return {
        "active_testers": len(member_stats),
        "avg_execution_time": metrics["avg_execution_time"],
        "productivity_score": metrics["productivity_score"],
        "members": members[:10],
    }


def _upcoming_items(db, project_id):
    scheduled_runs = db.query(models.TestRun).filter(
        models.TestRun.project_id == project_id,
        models.TestRun.status == "scheduled",
    ).order_by(models.TestRun.created_at.asc()).limit(10).all()
    pending_reviews = db.query(models.TestCase).join(models.TestSuite).filter(
        models.TestSuite.project_id == project_id,
        models.TestCase.status.in_(["pending_review", "draft"]),
        models.TestCase.is_deleted == False,
    ).order_by(models.TestCase.created_at.desc()).limit(10).all()
    milestone = db.query(models.Milestone).filter(
        models.Milestone.project_id == project_id,
        models.Milestone.target_date.isnot(None),
        models.Milestone.target_date >= datetime.now(),
        models.Milestone.status.notin_([models.MilestoneStatus.COMPLETED, models.MilestoneStatus.CANCELLED]),
    ).order_by(models.Milestone.target_date.asc()).first()
    return {
        "scheduled_runs_count": db.query(models.TestRun).filter(
            models.TestRun.project_id == project_id,
            models.TestRun.status == "scheduled",
        ).count(),
        "pending_reviews_count": db.query(models.TestCase).join(models.TestSuite).filter(
            models.TestSuite.project_id == project_id,
            models.TestCase.status.in_(["pending_review", "draft"]),
            models.TestCase.is_deleted == False,
        ).count(),
        "release_deadline": milestone.target_date.strftime("%Y-%m-%d") if milestone and milestone.target_date else "N/A",
        "milestone": {
            "id": milestone.id,
            "title": milestone.title,
            "target_date": milestone.target_date.isoformat() if milestone.target_date else None,
        } if milestone else None,
        "scheduled_runs": [
            {
                "id": run.id,
                "name": run.name,
                "status": run.status,
                "priority": run.priority,
                "assigned_to": _display_user(run.assignee),
            }
            for run in scheduled_runs
        ],
        "pending_reviews": [
            {
                "id": test_case.id,
                "title": test_case.title,
                "status": test_case.status,
                "priority": test_case.priority,
            }
            for test_case in pending_reviews
        ],
    }


def _build_shareable_report_content(
    db,
    project_id,
    report_type,
    title,
    generated_by,
    time_range="30d",
    period_start=None,
    period_end=None,
    include_sections=None,
    snapshot_mode="snapshot",
    export_formats=None,
):
    """Build a point-in-time analytics snapshot to store inside a shareable report.

    Without this the report would only carry a metadata header and no data. The
    depth of the snapshot varies by report_type:
      - summary:   headline KPIs + entity counts
      - executive: the above + recent activity
      - technical: everything, including KPI trends, team performance and upcoming items
    """
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    period_start_at, period_end_at = _period_bounds(time_range, period_start, period_end)
    content = {
        "title": title,
        "report_type": report_type,
        "generated_at": datetime.now().isoformat(),
        "generated_by": generated_by,
        "project_id": project_id,
        "project_name": project.name if project else None,
        "time_range": time_range,
        "period": {
            "label": _period_label(time_range, period_start, period_end),
            "start": period_start_at.isoformat(),
            "end": period_end_at.isoformat(),
            "analytics_source_range": "exact" if time_range == "custom" else time_range,
        },
        "snapshot_mode": snapshot_mode,
        "include_sections": list(include_sections or _default_sections(report_type)),
        "export_formats": list(export_formats or ["json", "csv"]),
    }
    try:
        sections = set(content["include_sections"]) & REPORT_SECTIONS
        duration = period_end_at - period_start_at
        previous_start_at = period_start_at - duration
        previous_end_at = period_start_at
        current_metrics = _metrics_for_period(db, project_id, period_start_at, period_end_at)
        previous_metrics = _metrics_for_period(db, project_id, previous_start_at, previous_end_at)
        kpi = {
            "coverage": _trend(current_metrics["coverage"], previous_metrics["coverage"]),
            "passRate": _trend(current_metrics["pass_rate"], previous_metrics["pass_rate"]),
            "failureTrends": _trend(current_metrics["failure_rate"], previous_metrics["failure_rate"]),
            "flakiness": _trend(current_metrics["flakiness"], previous_metrics["flakiness"]),
            "cycleTime": _trend(current_metrics["cycle_time"], previous_metrics["cycle_time"]),
            "defectDensity": _trend(current_metrics["defect_density"], previous_metrics["defect_density"]),
        }

        test_suite_ids = [
            row.id for row in db.query(models.TestSuite.id)
            .filter(models.TestSuite.project_id == project_id).all()
        ]
        total_test_cases = (
            db.query(models.TestCase)
            .filter(models.TestCase.test_suite_id.in_(test_suite_ids), models.TestCase.is_deleted == False)
            .count()
            if test_suite_ids else 0
        )

        if "summary" in sections:
            content["summary"] = {
                "scope": "current_inventory",
                "total_test_cases": total_test_cases,
                "total_test_suites": len(test_suite_ids),
                "total_test_runs": db.query(models.TestRun).filter(models.TestRun.project_id == project_id).count(),
                "total_requirements": db.query(models.Requirement).filter(models.Requirement.project_id == project_id).count(),
                "total_defects": db.query(models.Defect).filter(models.Defect.project_id == project_id).count(),
            }
        if "kpis" in sections:
            content["kpis"] = {
                "coverage_percent": current_metrics["coverage"],
                "pass_rate_percent": current_metrics["pass_rate"],
                "failure_rate_percent": current_metrics["failure_rate"],
                "flakiness_percent": current_metrics["flakiness"],
                "cycle_time_hours": current_metrics["cycle_time"],
                "defect_density": current_metrics["defect_density"],
            }
        if "recent_activity" in sections:
            content["recent_activity"] = {
                "scope": "selected_period",
                "test_runs_started": db.query(models.TestRun).filter(
                    models.TestRun.project_id == project_id,
                    models.TestRun.created_at >= period_start_at,
                    models.TestRun.created_at < period_end_at,
                ).count(),
                "tests_executed": current_metrics["total_tests"],
                "defects_found": current_metrics["defects_found"],
            }
        if "trends" in sections:
            content["kpi_trends"] = kpi
        if "team_performance" in sections:
            content["team_performance"] = _team_performance_for_period(current_metrics)
        if "upcoming" in sections:
            content["upcoming"] = _upcoming_items(db, project_id)
        content["data_available"] = True
    except Exception as exc:
        logger.warning(f"Failed to build shareable report content for project {project_id}: {exc}")
        content["data_available"] = False
        content["error"] = "Analytics data could not be generated for this report."
    return content


def _normalized_access_level(access_level):
    # Legacy reports may contain "edit"; shared reports are view-only until a
    # real collaborative editing workflow exists.
    if access_level == "edit":
        return "read-only"
    return access_level or "public"


def _serialize_shareable_report(report, content=None):
    return {
        "id": report.id,
        "project_id": report.project_id,
        "title": report.title,
        "report_type": report.report_type,
        "report_content": content if content is not None else (report.report_content or {}),
        "access_level": _normalized_access_level(report.access_level),
        "shared_with": report.shared_with or [],
        "share_token": report.share_token,
        "created_by": report.created_by,
        "created_by_display": _display_user(getattr(report, "creator", None)) or f"User #{report.created_by}",
        "view_count": report.view_count or 0,
        "last_viewed": report.last_viewed,
        "expires_at": report.expires_at,
        "created_at": report.created_at,
        "is_active": report.is_active,
    }


def _legacy_or_live_content(db, report):
    content = report.report_content or {}
    if content.get("snapshot_mode") == "live" or ("kpis" not in content and "summary" not in content):
        period = content.get("period") or {}
        period_start = _parse_optional_datetime(period.get("start"))
        period_end = _parse_optional_datetime(period.get("end"))
        content = _build_shareable_report_content(
            db,
            report.project_id,
            report.report_type,
            report.title,
            "system",
            time_range=content.get("time_range", "30d"),
            period_start=period_start,
            period_end=period_end,
            snapshot_mode=content.get("snapshot_mode", "snapshot"),
            include_sections=content.get("include_sections"),
            export_formats=content.get("export_formats"),
        )
    return content


def _parse_optional_datetime(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value))
    except ValueError:
        return None


def _shareable_report_payload(db, report, include_token=False):
    content = _legacy_or_live_content(db, report)
    payload = _serialize_shareable_report(report, content)
    if not include_token:
        payload.pop("share_token", None)
    payload["expires_at"] = report.expires_at.isoformat() if report.expires_at else None
    payload["generated_at"] = report.created_at.isoformat() if report.created_at else None
    return payload


def _user_can_open_restricted_report(current_user, report):
    if not current_user:
        return False
    recipients = report.shared_with or []
    recipient_keys = {str(item).strip().lower() for item in recipients}
    return (
        current_user.id == report.created_by
        or str(current_user.id) in recipient_keys
        or (current_user.email or "").strip().lower() in recipient_keys
    )


def _optional_user_from_request(request: Request, db: Session):
    auth_header = request.headers.get("authorization") or ""
    if not auth_header.lower().startswith("bearer "):
        return None
    token = auth_header.split(" ", 1)[1].strip()
    if not token:
        return None
    try:
        from jose import JWTError, jwt
        from ..config import settings
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        username = payload.get("sub")
        if not username:
            return None
        return crud.get_user_by_username(db, username)
    except Exception:
        return None


def _validate_report_not_expired(report):
    if not report or not report.is_active:
        raise HTTPException(status_code=404, detail="Shareable report not found")
    if report.expires_at and report.expires_at < datetime.now(report.expires_at.tzinfo):
        raise HTTPException(status_code=410, detail="Shareable report has expired")


def _safe_report_filename(report, extension):
    safe_title = re.sub(r"[^\w.-]+", "_", report.title or f"report-{report.id}").strip("_")
    return f"{safe_title or f'report-{report.id}'}.{extension}"


def _csv_scalar(value):
    """Render a leaf value as a clean CSV cell (no Python reprs like True/None)."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return value


def _flatten_csv_value(section_name, metric_path, value, rows):
    """Recursively flatten nested dicts/lists into dotted/indexed metric rows so
    they render as readable cells instead of stringified Python objects."""
    if isinstance(value, dict):
        if not value:
            rows.append({"section": section_name, "metric": metric_path, "value": ""})
            return
        for key, sub_value in value.items():
            child_path = f"{metric_path}.{key}" if metric_path else str(key)
            _flatten_csv_value(section_name, child_path, sub_value, rows)
    elif isinstance(value, (list, tuple)):
        if not value:
            rows.append({"section": section_name, "metric": metric_path, "value": ""})
            return
        for index, sub_value in enumerate(value):
            _flatten_csv_value(section_name, f"{metric_path}[{index}]", sub_value, rows)
    else:
        rows.append({"section": section_name, "metric": metric_path, "value": _csv_scalar(value)})


def _flatten_csv_rows(content):
    rows = []
    for section_name in ("kpis", "summary", "recent_activity", "kpi_trends", "team_performance", "upcoming"):
        section = content.get(section_name)
        if section is None:
            continue
        _flatten_csv_value(section_name, "", section, rows)
    return rows


def _csv_response(report, content):
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=["section", "metric", "value"])
    writer.writeheader()
    rows = _flatten_csv_rows(content)
    if rows:
        writer.writerows(rows)
    else:
        writer.writerow({"section": "report", "metric": "data_available", "value": _csv_scalar(content.get("data_available", False))})
    # Prepend a UTF-8 BOM so Excel renders non-ASCII (Persian/Arabic) names and
    # titles correctly instead of as mojibake.
    return Response(
        content="﻿" + output.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{_safe_report_filename(report, "csv")}"'},
    )


def _json_download_response(report, payload):
    return Response(
        content=json.dumps(payload, default=str, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{_safe_report_filename(report, "json")}"'},
    )


def register_analytics_dashboard_routes(app):
    """Register analytics and dashboard routes with the FastAPI app."""

    @app.get("/analytics/dashboard/analytics")
    def get_dashboard_analytics_get(
        project_id: int,
        time_range: str = "7d",
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Get dashboard analytics for a project with time range filtering"""
        if time_range not in {"24h", "7d", "30d", "90d"}:
            raise HTTPException(status_code=400, detail="time_range must be one of 24h, 7d, 30d, or 90d")
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        try:
            return generate_dashboard_analytics(db, project_id, time_range)
        except Exception as e:
            logger.warning(f"Error in get_dashboard_analytics_get: {e}")
            raise HTTPException(status_code=500, detail="Failed to generate analytics")

    @app.get("/analytics/time-series")
    def get_analytics_time_series(
        project_id: int,
        time_range: str = "30d",
        granularity: str = "day",
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Daily project quality trend for reports overview charts."""
        if time_range not in {"24h", "7d", "30d", "90d"}:
            raise HTTPException(status_code=400, detail="time_range must be one of 24h, 7d, 30d, or 90d")
        if granularity != "day":
            raise HTTPException(status_code=400, detail="Only day granularity is currently supported")
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        from sqlalchemy import func
        from ..models import Defect, TestCase, TestResult, TestRun, TestSuite

        days = {"24h": 1, "7d": 7, "30d": 30, "90d": 90}[time_range]
        end_dt = datetime.now(UTC)
        start_dt = end_dt - timedelta(days=days)
        test_suite_ids = [row.id for row in db.query(TestSuite.id).filter(TestSuite.project_id == project_id).all()]
        total_test_cases = (
            db.query(TestCase)
            .filter(TestCase.test_suite_id.in_(test_suite_ids), TestCase.is_deleted == False)
            .count()
            if test_suite_ids else 0
        )

        result_rows = db.query(
            func.date(TestResult.executed_at).label("date"),
            TestResult.status.label("status"),
            func.count(TestResult.id).label("count"),
        ).join(TestRun).filter(
            TestRun.project_id == project_id,
            TestResult.executed_at >= start_dt,
            TestResult.executed_at <= end_dt,
            TestResult.executed_at.isnot(None),
        ).group_by(func.date(TestResult.executed_at), TestResult.status).all()

        added_rows = db.query(
            func.date(TestCase.created_at).label("date"),
            func.count(TestCase.id).label("count"),
        ).join(TestSuite).filter(
            TestSuite.project_id == project_id,
            TestCase.created_at >= start_dt,
            TestCase.created_at <= end_dt,
            TestCase.is_deleted == False,
        ).group_by(func.date(TestCase.created_at)).all()

        defect_rows = db.query(
            func.date(Defect.created_at).label("date"),
            func.count(Defect.id).label("count"),
        ).filter(
            Defect.project_id == project_id,
            Defect.created_at >= start_dt,
            Defect.created_at <= end_dt,
        ).group_by(func.date(Defect.created_at)).all()

        by_date: dict[str, dict[str, int]] = {}
        for row in result_rows:
            date_key = str(row.date)
            status = normalize_result_status(row.status)
            by_date.setdefault(date_key, {"passed": 0, "failed": 0, "blocked": 0, "skipped": 0})
            if status in by_date[date_key]:
                by_date[date_key][status] += int(row.count or 0)

        added_by_date = {str(row.date): int(row.count or 0) for row in added_rows}
        defects_by_date = {str(row.date): int(row.count or 0) for row in defect_rows}
        current_coverage = build_coverage_report(db, project_id).get("coverage_percentage", 0)

        points = []
        current_day = start_dt.date()
        while current_day <= end_dt.date():
            date_key = current_day.isoformat()
            statuses = by_date.get(date_key, {"passed": 0, "failed": 0, "blocked": 0, "skipped": 0})
            executed = sum(statuses.values())
            passed = statuses["passed"]
            failed = statuses["failed"]
            points.append({
                "date": date_key,
                "executed": executed,
                "passed": passed,
                "failed": failed,
                "blocked": statuses["blocked"],
                "skipped": statuses["skipped"],
                "pass_rate": round((passed / executed) * 100, 1) if executed else 0,
                "failure_rate": round((failed / executed) * 100, 1) if executed else 0,
                "test_cases_added": added_by_date.get(date_key, 0),
                "defects_found": defects_by_date.get(date_key, 0),
            })
            current_day += timedelta(days=1)

        return {
            "project_id": project_id,
            "time_range": time_range,
            "granularity": granularity,
            "start_date": start_dt.isoformat(),
            "end_date": end_dt.isoformat(),
            "total_test_cases": total_test_cases,
            "points": points,
            "summary": {
                "total_executed": sum(point["executed"] for point in points),
                "total_passed": sum(point["passed"] for point in points),
                "total_failed": sum(point["failed"] for point in points),
                "total_defects": sum(point["defects_found"] for point in points),
                "current_requirement_coverage": current_coverage,
            },
        }

    @app.get("/analytics/granular-insights")
    def get_granular_insights_get(
        project_id: int,
        filter_type: str = "all",
        time_range: str = "7d",
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Get granular quality insights with real period-over-period trends."""
        if time_range not in {"24h", "7d", "30d", "90d"}:
            raise HTTPException(status_code=400, detail="time_range must be one of 24h, 7d, 30d, or 90d")
        if filter_type not in {"all", "failed", "slow"}:
            raise HTTPException(status_code=400, detail="filter_type must be one of all, failed, or slow")
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        # generate_dashboard_analytics already computes each metric together with a
        # real trend (up/down/stable + change) by comparing the selected period to
        # the one before it, so the insights carry genuine trends instead of "stable".
        analytics = generate_dashboard_analytics(db, project_id, time_range)
        kpi = analytics["kpi_data"]

        def insight(category, metric, metric_key, suffix, detail_unit):
            data = kpi.get(metric_key) or {"current": 0, "trend": "stable", "change": 0}
            change = data.get("change", 0)
            return {
                "category": category,
                "metric": metric,
                "value": f"{data.get('current', 0)}{suffix}",
                "trend": data.get("trend", "stable"),
                "change": change,
                "details": f"{change}{detail_unit} vs the previous period",
            }

        insights = [
            # kpi_data["coverage"] is execution coverage (test cases executed / total),
            # NOT requirement coverage — keep the label honest and distinct.
            insight("Test Execution", "Execution Coverage", "coverage", "%", "%"),
            insight("Test Execution", "Pass Rate", "passRate", "%", "%"),
            insight("Test Execution", "Failure Rate", "failureTrends", "%", "%"),
            insight("Test Stability", "Flakiness", "flakiness", "%", "%"),
            insight("Test Execution", "Cycle Time", "cycleTime", "h", "h"),
            insight("Defect Analysis", "Defect Density", "defectDensity", "", ""),
        ]

        # filter_type narrows the insights to the metrics relevant to that view.
        if filter_type == "failed":
            insights = [i for i in insights if i["metric"] in {"Failure Rate", "Flakiness"}]
        elif filter_type == "slow":
            insights = [i for i in insights if i["metric"] == "Cycle Time"]

        return {
            "project_id": project_id,
            "filter_type": filter_type,
            "time_range": time_range,
            "insights": insights,
        }

    @app.get("/analytics/coverage-reports")
    def get_coverage_reports_get(
        project_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Get the current dynamically generated coverage report for a project."""
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return [build_coverage_report(db, project_id)]

    @app.post("/analytics/coverage-reports/generate")
    def generate_coverage_report_post(
        request: dict,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Generate a fresh coverage report payload for the reports page."""
        project_id = request.get("project_id")
        if not isinstance(project_id, int) or project_id <= 0:
            raise HTTPException(status_code=400, detail="project_id must be a positive integer")
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return build_coverage_report(db, project_id, generated=True)

    @app.get("/analytics/test-execution-status")
    def get_test_execution_status_get(
        project_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Get test execution status for a project."""
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        from ..models import TestCase, TestResult, TestSuite

        test_cases = db.query(TestCase).join(TestSuite).filter(
            TestSuite.project_id == project_id,
            TestCase.is_deleted == False,
        ).all()
        latest_statuses = []
        for test_case in test_cases:
            latest_result = db.query(TestResult).filter(
                TestResult.test_case_id == test_case.id
            ).order_by(TestResult.executed_at.desc()).first()
            latest_statuses.append(normalize_result_status(latest_result.status) if latest_result else "not_started")

        total_tests = len(test_cases)
        passed = latest_statuses.count("passed")
        failed = latest_statuses.count("failed")
        blocked = latest_statuses.count("blocked")
        skipped = latest_statuses.count("skipped")
        not_started = latest_statuses.count("not_started")
        executed = passed + failed + blocked + skipped

        return {
            "project_id": project_id,
            "summary": {
                "total_test_cases": total_tests,
                "executed_test_cases": executed,
                "not_started_test_cases": not_started,
                "passed_test_cases": passed,
                "failed_test_cases": failed,
                "blocked_test_cases": blocked,
                "skipped_test_cases": skipped,
            },
            "status": {
                "total_tests": total_tests,
                "executed": executed,
                "passed": passed,
                "failed": failed,
                "blocked": blocked,
                "skipped": skipped,
                "not_started": not_started,
            },
            "execution_rate": round((executed / total_tests) * 100, 1) if total_tests else 0,
            "success_rate": round((passed / executed) * 100, 1) if executed else 0,
            "status_percentages": {
                "passed": round((passed / executed) * 100, 1) if executed else 0,
                "failed": round((failed / executed) * 100, 1) if executed else 0,
                "blocked": round((blocked / executed) * 100, 1) if executed else 0,
                "skipped": round((skipped / executed) * 100, 1) if executed else 0,
            },
            "overall_percentages": {
                "passed": round((passed / total_tests) * 100, 1) if total_tests else 0,
                "failed": round((failed / total_tests) * 100, 1) if total_tests else 0,
                "blocked": round((blocked / total_tests) * 100, 1) if total_tests else 0,
                "skipped": round((skipped / total_tests) * 100, 1) if total_tests else 0,
                "not_started": round((not_started / total_tests) * 100, 1) if total_tests else 0,
            },
            "last_execution": datetime.now().isoformat(),
        }

    @app.get("/analytics/root-cause-analyses")
    def get_root_cause_analyses_get(
        project_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Get root cause analyses for a project"""
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        analyses = get_root_cause_analyses(db, project_id=project_id)
        return [
            {
                "id": analysis.id,
                "analysis_title": analysis.analysis_title,
                "root_cause": analysis.root_cause,
                "impact_assessment": analysis.impact_assessment,
                "resolution_time_hours": analysis.resolution_time_hours,
                "fix_commit_hash": analysis.fix_commit_hash,
                "status": analysis.status,
                "severity": analysis.severity,
                "defect_id": analysis.defect_id,
                "requirement_id": analysis.requirement_id,
                "test_case_id": analysis.test_case_id,
                "created_at": analysis.created_at.isoformat() if analysis.created_at else None,
            }
            for analysis in analyses
        ]

    # Dashboard Analytics
    @app.post("/analytics/dashboard")
    def get_dashboard_analytics(
        request: dict,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        project_id = request.get("project_id")
        if not isinstance(project_id, int) or project_id <= 0:
            raise HTTPException(status_code=400, detail="project_id must be a positive integer")
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        time_period = request.get("time_period", "7d")
        if time_period not in {"24h", "7d", "30d", "90d"}:
            raise HTTPException(status_code=400, detail="time_period must be one of 24h, 7d, 30d, or 90d")

        try:
            return generate_dashboard_analytics(db, project_id, time_period)
        except HTTPException:
            raise
        except Exception as exc:
            logger.warning(f"Error in get_dashboard_analytics: {exc}")
            raise HTTPException(status_code=500, detail="Failed to generate dashboard analytics")

    @app.get("/dashboard/statistics")
    def get_dashboard_statistics(
        project_id: Optional[int] = Query(None, ge=1),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """
        Get comprehensive dashboard statistics for all entities.
        If project_id is provided, returns stats for that project only.
        Otherwise returns global statistics across all projects the user has access to.
        """
        try:
            # Get projects user has access to
            if project_id:
                project = db.query(models.Project).filter(models.Project.id == project_id).first()
                if not project:
                    raise HTTPException(status_code=404, detail="Project not found")
                if not rbac.has_permission(current_user, "read", project.id, db):
                    raise HTTPException(status_code=403, detail="Insufficient permissions")
                projects = [project]
            else:
                # Cap to 500 projects to prevent unbounded scans
                projects = db.query(models.Project).limit(500).all()

            projects = [p for p in projects if p and rbac.has_permission(current_user, "read", p.id, db)]
            total_projects = len(projects)
            project_ids = [p.id for p in projects]

            from sqlalchemy import func as _func

            if not project_ids:
                total_test_cases = total_test_suites = total_test_runs = 0
                total_requirements = total_defects = total_milestones = total_test_plans = 0
                total_passed = total_failed = total_blocked = total_skipped = total_not_started = 0
                open_critical_defects = untested_requirements = stale_tests = 0
                readiness_pass_rate = readiness_executed = 0
                readiness_requirement_ids = readiness_test_case_ids = []
            else:
                # Batch-fetch all active test case IDs across all projects in one query
                active_suite_filter = (models.TestSuite.status.is_(None)) | (models.TestSuite.status == models.Status.ACTIVE)
                active_case_filter = (models.TestCase.status.is_(None)) | (models.TestCase.status == "active")
                not_deleted_case_filter = (models.TestCase.is_deleted.is_(None)) | (models.TestCase.is_deleted == False)
                tc_rows = (
                    db.query(models.TestCase.id, models.TestCase.reference)
                    .join(models.TestSuite)
                    .filter(
                        models.TestSuite.project_id.in_(project_ids),
                        not_deleted_case_filter,
                    )
                    .all()
                )
                all_test_case_ids = [row.id for row in tc_rows]
                total_test_cases = len(all_test_case_ids)

                readiness_tc_rows = (
                    db.query(models.TestCase.id, models.TestCase.reference)
                    .join(models.TestSuite)
                    .filter(
                        models.TestSuite.project_id.in_(project_ids),
                        active_suite_filter,
                        active_case_filter,
                        not_deleted_case_filter,
                    )
                    .all()
                )
                readiness_test_case_ids = [row.id for row in readiness_tc_rows]

                # Aggregate counts with single queries
                total_test_suites = (
                    db.query(_func.count(models.TestSuite.id))
                    .filter(models.TestSuite.project_id.in_(project_ids))
                    .scalar() or 0
                )
                total_test_runs = (
                    db.query(_func.count(models.TestRun.id))
                    .filter(models.TestRun.project_id.in_(project_ids))
                    .scalar() or 0
                )
                total_requirements = (
                    db.query(_func.count(models.Requirement.id))
                    .filter(models.Requirement.project_id.in_(project_ids))
                    .scalar() or 0
                )
                total_defects = (
                    db.query(_func.count(models.Defect.id))
                    .filter(models.Defect.project_id.in_(project_ids))
                    .scalar() or 0
                )
                try:
                    total_milestones = (
                        db.query(_func.count(models.Milestone.id))
                        .filter(models.Milestone.project_id.in_(project_ids))
                        .scalar() or 0
                    )
                except Exception as e:
                    logger.warning("Error counting milestones: %s", e)
                    total_milestones = 0
                total_test_plans = (
                    db.query(_func.count(models.TestPlan.id))
                    .filter(models.TestPlan.project_id.in_(project_ids))
                    .scalar() or 0
                )

                open_critical_defects = (
                    db.query(_func.count(models.Defect.id))
                    .filter(
                        models.Defect.project_id.in_(project_ids),
                        models.Defect.severity == models.DefectSeverity.CRITICAL,
                        models.Defect.status.in_([
                            models.DefectStatus.OPEN,
                            models.DefectStatus.IN_PROGRESS,
                            models.DefectStatus.REOPENED,
                        ]),
                    )
                    .scalar() or 0
                )

                stale_tests = (
                    db.query(_func.count(models.TestDebtItem.id))
                    .join(models.TestCase, models.TestDebtItem.test_case_id == models.TestCase.id)
                    .join(models.TestSuite, models.TestCase.test_suite_id == models.TestSuite.id)
                    .filter(
                        models.TestDebtItem.project_id.in_(project_ids),
                        models.TestDebtItem.debt_type == "stale",
                        models.TestDebtItem.resolved_at.is_(None),
                        active_suite_filter,
                        active_case_filter,
                        not_deleted_case_filter,
                    )
                    .scalar() or 0
                )

                # Latest result per test case — single batch query instead of per-row loop
                total_passed = total_failed = total_blocked = total_skipped = total_not_started = 0
                latest_status_by_test_case = {}
                if all_test_case_ids:
                    latest_id_subq = (
                        db.query(
                            models.TestResult.test_case_id,
                            _func.max(models.TestResult.id).label("max_id"),
                        )
                        .filter(models.TestResult.test_case_id.in_(all_test_case_ids))
                        .group_by(models.TestResult.test_case_id)
                        .subquery()
                    )
                    latest_statuses = (
                        db.query(models.TestResult.test_case_id, models.TestResult.status)
                        .join(latest_id_subq, models.TestResult.id == latest_id_subq.c.max_id)
                        .all()
                    )
                    for test_case_id, status in latest_statuses:
                        normalized = normalize_result_status(status)
                        latest_status_by_test_case[test_case_id] = normalized
                        if normalized == "passed":
                            total_passed += 1
                        elif normalized == "failed":
                            total_failed += 1
                        elif normalized == "blocked":
                            total_blocked += 1
                        elif normalized == "skipped":
                            total_skipped += 1
                        else:
                            total_not_started += 1
                    # Cases with no result at all
                    total_not_started += total_test_cases - len(latest_statuses)
                else:
                    total_not_started = 0

                requirements = db.query(models.Requirement).filter(models.Requirement.project_id.in_(project_ids)).all()
                readiness_requirements = [
                    requirement for requirement in requirements
                    if requirement.status != models.RequirementStatus.DEPRECATED
                ]
                readiness_requirement_ids = [requirement.id for requirement in readiness_requirements]
                requirement_ids = [requirement.id for requirement in requirements]
                linked_test_case_ids = get_linked_requirement_test_case_ids(db, requirement_ids, readiness_test_case_ids)
                add_legacy_reference_links(linked_test_case_ids, requirements, readiness_tc_rows)
                executed_statuses = {"passed", "failed", "blocked", "skipped"}
                executed_test_case_ids = {
                    test_case_id
                    for test_case_id, status in latest_status_by_test_case.items()
                    if test_case_id in readiness_test_case_ids and status in executed_statuses
                }
                readiness_passed = len([
                    test_case_id for test_case_id in readiness_test_case_ids
                    if latest_status_by_test_case.get(test_case_id) == "passed"
                ])
                readiness_executed = len(executed_test_case_ids)
                readiness_pass_rate = round((readiness_passed / readiness_executed) * 100) if readiness_executed > 0 else 0
                untested_requirements = len([
                    requirement for requirement in readiness_requirements
                    if not linked_test_case_ids.get(requirement.id, set()).intersection(executed_test_case_ids)
                ])
            
            # Calculate pass rate
            total_executed = total_passed + total_failed + total_blocked + total_skipped
            pass_rate = round((total_passed / total_executed) * 100) if total_executed > 0 else 0
            
            return {
                "totalTestCases": total_test_cases,
                "totalTestSuites": total_test_suites,
                "totalTestRuns": total_test_runs,
                "totalRequirements": total_requirements,
                "totalDefects": total_defects,
                "totalMilestones": total_milestones,
                "totalTestPlans": total_test_plans,
                "totalProjects": total_projects,
                "testResults": [
                    { "status": "passed", "count": total_passed },
                    { "status": "failed", "count": total_failed },
                    { "status": "blocked", "count": total_blocked },
                    { "status": "skipped", "count": total_skipped },
                    { "status": "not_started", "count": total_not_started }
                ],
                "passRate": pass_rate,
                "totalExecuted": total_executed,
                "totalNotStarted": total_not_started,
                "releaseReadiness": {
                    "passRate": readiness_pass_rate,
                    "openCriticalDefects": open_critical_defects,
                    "untestedRequirements": untested_requirements,
                    "staleTests": stale_tests,
                    "activeRequirements": len(readiness_requirement_ids),
                    "activeTestCases": len(readiness_test_case_ids),
                    "executedTestCases": readiness_executed,
                }
            }
        except HTTPException:
            raise
        except Exception as e:
            logger.warning(f"Error in get_dashboard_statistics: {e}")
            raise HTTPException(status_code=500, detail="Failed to load dashboard statistics")

    @app.get("/analytics/kpi/{project_id}")
    def get_project_kpis(
        project_id: int,
        time_period: str = "7d",
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        kpis = calculate_project_kpis(db, project_id, time_period)
        return {"project_id": project_id, "time_period": time_period, "kpis": kpis}

    # KPI Data Management
    @app.post("/analytics/kpi-data", response_model=schemas.KPIData)
    def create_kpi_data_endpoint(
        kpi_data: schemas.KPIDataCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "write", kpi_data.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        db_kpi = create_kpi_data(db=db, kpi_data=kpi_data)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.CREATE.value,
                entity_type=EntityType.KPI_DATA.value,
                entity_id=db_kpi.id,
                project_id=db_kpi.project_id,
                description=f"KPI data created for project {db_kpi.project_id}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            logger.warning(f"Failed to create audit trail for KPI data creation: {e}")
        
        return db_kpi

    @app.get("/analytics/kpi-data/{project_id}", response_model=List[schemas.KPIData])
    def get_kpi_data_endpoint(
        project_id: int,
        metric_type: str = None,
        time_period: str = None,
        skip: int = 0,
        limit: int = 100,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return get_kpi_data(db, project_id, metric_type, time_period, skip, limit)

    # Granular Test Step Insights
    @app.post("/analytics/granular-insights", response_model=schemas.GranularInsightsResponse)
    def get_granular_insights(
        request: schemas.GranularInsightsRequest,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if request.project_id is not None and not rbac.has_permission(current_user, "read", request.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        step_results = get_test_step_results(
            db, request.project_id, request.test_run_id, 
            request.test_case_id, request.filter_type
        )
        
        # Calculate summary statistics
        total_steps = len(step_results)
        passed_steps = len([s for s in step_results if s.step_status == "passed"])
        failed_steps = len([s for s in step_results if s.step_status == "failed"])
        avg_duration = sum(s.step_duration for s in step_results) / total_steps if total_steps > 0 else 0
        
        summary = {
            "total_steps": total_steps,
            "passed_steps": passed_steps,
            "failed_steps": failed_steps,
            "avg_duration": avg_duration,
            "pass_rate": (passed_steps / total_steps * 100) if total_steps > 0 else 0
        }
        
        return schemas.GranularInsightsResponse(
            test_step_results=step_results,
            summary=summary
        )

    @app.post("/analytics/test-steps", response_model=schemas.TestStepResult)
    def create_test_step_result_endpoint(
        step_result: schemas.TestStepResultCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        # Verify user has permission for the test result's project
        test_result = db.query(models.TestResult).filter(models.TestResult.id == step_result.test_result_id).first()
        if not test_result:
            raise HTTPException(status_code=404, detail="Test result not found")
        
        test_case = db.query(models.TestCase).filter(models.TestCase.id == test_result.test_case_id).first()
        if not rbac.has_permission(current_user, "write", test_case.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        db_step = create_test_step_result(db=db, step_result=step_result)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.CREATE.value,
                entity_type=EntityType.TEST_STEP_RESULT.value,
                entity_id=db_step.id,
                project_id=test_case.project_id,
                description=f"Test step result created for test result {step_result.test_result_id}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            logger.warning(f"Failed to create audit trail for test step result creation: {e}")
        
        return db_step

    @app.get("/analytics/test-steps/{test_result_id}", response_model=List[schemas.TestStepResult])
    def get_test_step_results_endpoint(
        test_result_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        # Verify user has permission for the test result's project
        test_result = db.query(models.TestResult).filter(models.TestResult.id == test_result_id).first()
        if not test_result:
            raise HTTPException(status_code=404, detail="Test result not found")
        
        test_case = db.query(models.TestCase).filter(models.TestCase.id == test_result.test_case_id).first()
        if not rbac.has_permission(current_user, "read", test_case.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return get_test_step_results_by_test_result(db, test_result_id)

    # Shareable Reports
    @app.post("/analytics/shareable-reports", response_model=schemas.ShareableReport)
    def create_shareable_report_endpoint(
        request: schemas.ShareableReportRequest,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "write", request.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        title = request.title.strip()
        if request.expires_in_days is not None and not 1 <= request.expires_in_days <= 365:
            raise HTTPException(status_code=400, detail="expires_in_days must be between 1 and 365")
        duplicate = db.query(models.ShareableReport).filter(
            models.ShareableReport.project_id == request.project_id,
            models.ShareableReport.is_active == True,
            models.ShareableReport.title.ilike(title),
        ).first()
        if duplicate:
            raise HTTPException(status_code=409, detail="An active shareable report with this title already exists")
        
        # Build a real analytics snapshot so the report actually carries data.
        report_content = _build_shareable_report_content(
            db,
            request.project_id,
            request.report_type,
            title,
            current_user.username,
            time_range=request.time_range,
            period_start=request.period_start,
            period_end=request.period_end,
            include_sections=request.include_sections or _default_sections(request.report_type),
            snapshot_mode=request.snapshot_mode,
            export_formats=request.export_formats,
        )
        
        # Set expiration date
        expires_at = None
        if request.expires_in_days:
            expires_at = datetime.now() + timedelta(days=request.expires_in_days)
        
        report_data = schemas.ShareableReportCreate(
            project_id=request.project_id,
            title=title,
            report_type=request.report_type,
            report_content=report_content,
            access_level=request.access_level,
            shared_with=request.shared_with,
            expires_at=expires_at
        )
        
        db_report = create_shareable_report(db=db, report=report_data, created_by=current_user.id)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.CREATE.value,
                entity_type=EntityType.SHAREABLE_REPORT.value,
                entity_id=db_report.id,
                project_id=db_report.project_id,
                description=f"Shareable report created: {request.title}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            logger.warning(f"Failed to create audit trail for shareable report creation: {e}")
        
        return db_report

    @app.get("/analytics/shareable-reports/{project_id}", response_model=List[schemas.ShareableReport],
             dependencies=[Depends(require_project_feature("reports"))])
    def get_shareable_reports_endpoint(
        project_id: int,
        created_by: int = None,
        skip: int = 0,
        limit: int = 100,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        reports = get_shareable_reports(db, project_id, created_by, skip, limit)
        return [_serialize_shareable_report(report) for report in reports]

    @app.get("/analytics/shareable-reports/shared/{share_token}")
    def get_shared_report(
        share_token: str,
        request: Request,
        db: Session = Depends(get_db)
    ):
        """Public viewer endpoint. Returns the report with regenerated content for
        legacy stub reports, enforces active/expiry, and tracks views."""
        report = get_shareable_report_by_token(db, share_token)
        _validate_report_not_expired(report)
        if _normalized_access_level(report.access_level) == "restricted":
            current_viewer = _optional_user_from_request(request, db)
            if not _user_can_open_restricted_report(current_viewer, report):
                raise HTTPException(status_code=401, detail="Authentication is required to view this restricted report")

        record_shareable_report_view(db, report)
        return _shareable_report_payload(db, report)

    @app.get("/analytics/shareable-reports/{report_id}/preview")
    def preview_shareable_report(
        report_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        report = get_shareable_report(db, report_id)
        _validate_report_not_expired(report)
        if not rbac.has_permission(current_user, "read", report.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return _shareable_report_payload(db, report, include_token=True)

    @app.get("/analytics/shareable-reports/{report_id}/download")
    def download_shareable_report(
        report_id: int,
        format: str = Query("json", pattern="^(json|csv)$"),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        report = get_shareable_report(db, report_id)
        _validate_report_not_expired(report)
        if not rbac.has_permission(current_user, "read", report.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        # Track downloads so view_count and last_viewed are meaningful, and audit
        # who pulled the report (compliance trail).
        try:
            record_shareable_report_view(db, report)
        except Exception as exc:
            logger.warning(f"Failed to record view for shareable report {report.id}: {exc}")
            db.rollback()
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_service.create_audit_trail(AuditTrailCreate(
                user_id=current_user.id,
                action=AuditAction.EXECUTE.value,
                entity_type=EntityType.SHAREABLE_REPORT.value,
                entity_id=report.id,
                project_id=report.project_id,
                description=f"Shareable report downloaded: {report.title}",
            ))
        except Exception as exc:
            logger.warning(f"Failed to write audit for shareable report download: {exc}")

        payload = _shareable_report_payload(db, report, include_token=True)
        if format == "csv":
            return _csv_response(report, payload["report_content"])
        return _json_download_response(report, payload)

    @app.put("/analytics/shareable-reports/{report_id}", response_model=schemas.ShareableReport)
    def update_shareable_report_endpoint(
        report_id: int,
        report: dict,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_report = get_shareable_report(db, report_id)
        if not db_report:
            raise HTTPException(status_code=404, detail="Shareable report not found")

        if not rbac.has_permission(current_user, "write", db_report.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        allowed_fields = {"title", "access_level", "shared_with", "expires_at", "is_active"}
        report_data = {key: value for key, value in report.items() if key in allowed_fields}
        if "title" in report_data:
            title = str(report_data["title"]).strip()
            if not title:
                raise HTTPException(status_code=400, detail="Report title is required")
            report_data["title"] = title
        if "access_level" in report_data:
            level = str(report_data["access_level"]).strip().lower()
            if level not in {"public", "restricted", "read-only"}:
                raise HTTPException(status_code=400, detail="Invalid access level")
            report_data["access_level"] = level
        db_report = update_shareable_report(db, report_id=report_id, report_data=report_data)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.UPDATE.value,
                entity_type=EntityType.SHAREABLE_REPORT.value,
                entity_id=db_report.id,
                project_id=db_report.project_id,
                description=f"Shareable report updated: {db_report.title}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            logger.warning(f"Failed to create audit trail for shareable report update: {e}")

        return db_report

    @app.post("/analytics/shareable-reports/{report_id}/regenerate", response_model=schemas.ShareableReport)
    def regenerate_shareable_report(
        report_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_report = get_shareable_report(db, report_id)
        _validate_report_not_expired(db_report)
        if not rbac.has_permission(current_user, "write", db_report.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        existing_content = db_report.report_content or {}
        period = existing_content.get("period") or {}
        report_content = _build_shareable_report_content(
            db,
            db_report.project_id,
            db_report.report_type,
            db_report.title,
            current_user.username,
            time_range=existing_content.get("time_range", "30d"),
            period_start=_parse_optional_datetime(period.get("start")),
            period_end=_parse_optional_datetime(period.get("end")),
            include_sections=existing_content.get("include_sections"),
            snapshot_mode=existing_content.get("snapshot_mode", "snapshot"),
            export_formats=existing_content.get("export_formats"),
        )
        return update_shareable_report(
            db,
            report_id=report_id,
            report_data={"report_content": report_content},
        )

    @app.delete("/analytics/shareable-reports/{report_id}", response_model=schemas.ShareableReport)
    def revoke_shareable_report(
        report_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_report = get_shareable_report(db, report_id)
        if not db_report:
            raise HTTPException(status_code=404, detail="Shareable report not found")
        if not rbac.has_permission(current_user, "write", db_report.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        db_report = deactivate_shareable_report(db, report_id)
        return db_report

    # Root Cause Analysis
    @app.post("/analytics/root-cause-analysis", response_model=schemas.RootCauseAnalysis)
    def create_root_cause_analysis_endpoint(
        analysis: schemas.RootCauseAnalysisCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "write", analysis.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        # The creator is recorded as the discoverer regardless of any client input.
        analysis.discovered_by = current_user.id
        if not (analysis.analysis_title or "").strip():
            raise HTTPException(status_code=400, detail="analysis_title is required")
        if not (analysis.root_cause or "").strip():
            raise HTTPException(status_code=400, detail="root_cause is required")

        db_analysis = create_root_cause_analysis(db=db, analysis=analysis)

        _notify_rca_assignee(db, db_analysis, current_user)

        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.CREATE.value,
                entity_type=EntityType.ROOT_CAUSE_ANALYSIS.value,
                entity_id=db_analysis.id,
                project_id=db_analysis.project_id,
                description=f"Root cause analysis created: {analysis.analysis_title or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            logger.warning(f"Failed to create audit trail for root cause analysis creation: {e}")
        
        return db_analysis

    @app.get("/analytics/root-cause-analysis/{project_id}", response_model=List[schemas.RootCauseAnalysis])
    def get_root_cause_analyses_endpoint(
        project_id: int,
        skip: int = 0,
        limit: int = 100,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return get_root_cause_analyses(db, project_id, skip, limit)

    @app.put("/analytics/root-cause-analysis/{analysis_id}", response_model=schemas.RootCauseAnalysis)
    def update_root_cause_analysis_endpoint(
        analysis_id: int,
        analysis: dict,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_analysis = get_root_cause_analysis(db, analysis_id)
        if not db_analysis:
            raise HTTPException(status_code=404, detail="Root cause analysis not found")

        if not rbac.has_permission(current_user, "write", db_analysis.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        # Don't let clients overwrite identity fields.
        for protected in ("id", "project_id", "discovered_by", "created_at"):
            analysis.pop(protected, None)

        prior_assigned_to = db_analysis.assigned_to

        updated = update_root_cause_analysis(db, analysis_id=analysis_id, analysis_data=analysis)

        if "assigned_to" in analysis:
            _notify_rca_assignee(db, updated, current_user, previous_assigned_to=prior_assigned_to)

        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_service.create_audit_trail(AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.UPDATE.value,
                entity_type=EntityType.ROOT_CAUSE_ANALYSIS.value,
                entity_id=analysis_id,
                project_id=updated.project_id,
                description=f"Root cause analysis updated: {updated.analysis_title or 'Untitled'}",
            ))
        except Exception as e:
            logger.warning(f"Failed to create audit trail for root cause analysis update: {e}")

        return updated

    @app.delete("/analytics/root-cause-analysis/{analysis_id}", response_model=schemas.MessageResponse)
    def delete_root_cause_analysis_endpoint(
        analysis_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_analysis = get_root_cause_analysis(db, analysis_id)
        if not db_analysis:
            raise HTTPException(status_code=404, detail="Root cause analysis not found")
        if not rbac.has_permission(current_user, "manage_projects", db_analysis.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        analysis_title = db_analysis.analysis_title
        project_id = db_analysis.project_id
        delete_root_cause_analysis(db, analysis_id=analysis_id)

        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_service.create_audit_trail(AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.DELETE.value,
                entity_type=EntityType.ROOT_CAUSE_ANALYSIS.value,
                entity_id=analysis_id,
                project_id=project_id,
                description=f"Root cause analysis deleted: {analysis_title or 'Untitled'}",
            ))
        except Exception as e:
            logger.warning(f"Failed to create audit trail for root cause analysis deletion: {e}")

        return {"message": "Root cause analysis deleted successfully"}

    # Dashboard Widgets
    @app.post("/analytics/dashboard-widgets", response_model=schemas.DashboardWidget)
    def create_dashboard_widget_endpoint(
        widget: schemas.DashboardWidgetCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "write", widget.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        db_widget = create_dashboard_widget(db=db, widget=widget)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.CREATE.value,
                entity_type=EntityType.DASHBOARD_WIDGET.value,
                entity_id=db_widget.id,
                project_id=db_widget.project_id,
                description=f"Dashboard widget created: {widget.widget_type or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            logger.warning(f"Failed to create audit trail for dashboard widget creation: {e}")
        
        return db_widget

    @app.get("/analytics/dashboard-widgets/{project_id}", response_model=List[schemas.DashboardWidget])
    def get_dashboard_widgets_endpoint(
        project_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        return get_dashboard_widgets(db, current_user.id, project_id)

    @app.put("/analytics/dashboard-widgets/{widget_id}", response_model=schemas.DashboardWidget)
    def update_dashboard_widget_endpoint(
        widget_id: int,
        widget: dict,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_widget = get_dashboard_widget(db, widget_id)
        if not db_widget:
            raise HTTPException(status_code=404, detail="Dashboard widget not found")

        if not rbac.has_permission(current_user, "write", db_widget.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        db_widget = update_dashboard_widget(db, widget_id=widget_id, widget_data=widget)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.UPDATE.value,
                entity_type=EntityType.DASHBOARD_WIDGET.value,
                entity_id=widget_id,
                project_id=db_widget.project_id,
                description=f"Dashboard widget updated: {db_widget.widget_type or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            logger.warning(f"Failed to create audit trail for dashboard widget update: {e}")

        return db_widget

    @app.get("/analytics/test-activity")
    def get_test_activity(
        project_id: int,
        start_date: str = None,
        end_date: str = None,
        granularity: str = 'day',
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Get project-scoped test case activity over time."""
        from sqlalchemy import func
        from datetime import datetime, timedelta, UTC
        from ..models import TestCase, TestResult, TestSuite, TestRun, AuditTrail, AuditAction, EntityType
        
        if granularity != "day":
            raise HTTPException(status_code=400, detail="Only day granularity is currently supported")
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        try:
            end_dt = datetime.fromisoformat(end_date.replace('Z', '+00:00')) if end_date else datetime.now(UTC)
            start_dt = datetime.fromisoformat(start_date.replace('Z', '+00:00')) if start_date else end_dt - timedelta(days=30)
        except ValueError:
            raise HTTPException(status_code=400, detail="start_date and end_date must be valid ISO 8601 datetimes")

        if start_dt > end_dt:
            raise HTTPException(status_code=400, detail="start_date must be before or equal to end_date")
        if (end_dt.date() - start_dt.date()).days > 366:
            raise HTTPException(status_code=400, detail="Date range cannot exceed 366 days")
        
        test_cases_added = db.query(
            func.date(TestCase.created_at).label('date'),
            func.count(TestCase.id).label('count')
        ).join(TestSuite).filter(
            TestSuite.project_id == project_id,
            TestCase.created_at >= start_dt,
            TestCase.created_at <= end_dt,
            TestCase.is_deleted == False,
        ).group_by(func.date(TestCase.created_at)).all()
        
        test_cases_modified = db.query(
            func.date(TestCase.updated_at).label('date'),
            func.count(TestCase.id).label('count')
        ).join(TestSuite).filter(
            TestSuite.project_id == project_id,
            TestCase.updated_at >= start_dt,
            TestCase.updated_at <= end_dt,
            TestCase.updated_at.isnot(None),
            TestCase.is_deleted == False,
        ).group_by(func.date(TestCase.updated_at)).all()
        
        test_executions = db.query(
            func.date(TestResult.executed_at).label('date'),
            func.count(TestResult.id).label('count')
        ).join(TestRun).filter(
            TestRun.project_id == project_id,
            TestResult.executed_at >= start_dt,
            TestResult.executed_at <= end_dt,
            TestResult.executed_at.isnot(None)
        ).group_by(func.date(TestResult.executed_at)).all()
        
        # Test cases deleted are soft-deletes with no per-row timestamp, so the
        # delete date is sourced from the audit trail (action=DELETE, entity=test_case).
        test_cases_deleted = db.query(
            func.date(AuditTrail.created_at).label('date'),
            func.count(AuditTrail.id).label('count')
        ).filter(
            AuditTrail.project_id == project_id,
            AuditTrail.entity_type == EntityType.TEST_CASE,
            AuditTrail.action == AuditAction.DELETE,
            AuditTrail.created_at >= start_dt,
            AuditTrail.created_at <= end_dt,
        ).group_by(func.date(AuditTrail.created_at)).all()

        added_dict = {str(item.date): item.count for item in test_cases_added}
        modified_dict = {str(item.date): item.count for item in test_cases_modified}
        executed_dict = {str(item.date): item.count for item in test_executions}
        deleted_dict = {str(item.date): item.count for item in test_cases_deleted}
        
        activity_data = []
        current_date = start_dt.date()
        end_date_obj = end_dt.date()
        while current_date <= end_date_obj:
            date_str = str(current_date)
            activity_data.append({
                'date': date_str,
                'added': added_dict.get(date_str, 0),
                'modified': modified_dict.get(date_str, 0),
                'executed': executed_dict.get(date_str, 0),
                'deleted': deleted_dict.get(date_str, 0)
            })
            current_date += timedelta(days=1)
        
        summary = {
            'total_added': sum(item['added'] for item in activity_data),
            'total_modified': sum(item['modified'] for item in activity_data),
            'total_executed': sum(item['executed'] for item in activity_data),
            'total_deleted': sum(item['deleted'] for item in activity_data),
        }

        return {
            'project_id': project_id,
            'start_date': start_dt.isoformat(),
            'end_date': end_dt.isoformat(),
            'granularity': granularity,
            'activity_data': activity_data,
            'activity': activity_data,
            'summary': summary,
        }

    @app.delete("/analytics/dashboard-widgets/{widget_id}", response_model=schemas.MessageResponse)
    def delete_dashboard_widget_endpoint(
        widget_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_widget = get_dashboard_widget(db, widget_id)
        if not db_widget:
            raise HTTPException(status_code=404, detail="Dashboard widget not found")

        if not rbac.has_permission(current_user, "manage_projects", db_widget.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        # Store data for audit trail before deletion
        widget_id_val = db_widget.id
        widget_type = db_widget.widget_type
        project_id = db_widget.project_id

        delete_dashboard_widget(db, widget_id=widget_id)

        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.DELETE.value,
                entity_type=EntityType.DASHBOARD_WIDGET.value,
                entity_id=widget_id_val,
                project_id=project_id,
                description=f"Dashboard widget deleted: {widget_type or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            logger.warning(f"Failed to create audit trail for dashboard widget deletion: {e}")

        return {"message": "Dashboard widget deleted successfully"}
