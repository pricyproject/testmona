"""
Analytics, dashboard, KPI data, test step results, and shareable reports routes.
"""

from fastapi import Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timedelta

from .. import crud, schemas, auth, rbac, models
from ..database import get_db
from ..auth import get_current_active_user
from ..crud import (
    calculate_project_kpis,
    create_kpi_data, get_kpi_data, get_latest_kpi_data,
    create_test_step_result, get_test_step_results, get_test_step_results_by_test_result,
    create_shareable_report, get_shareable_reports, get_shareable_report_by_token, update_shareable_report,
    create_root_cause_analysis, get_root_cause_analyses, get_root_cause_analysis,
    update_root_cause_analysis, delete_root_cause_analysis,
    create_dashboard_widget, get_dashboard_widgets, get_dashboard_widget,
    update_dashboard_widget, delete_dashboard_widget,
    generate_dashboard_analytics
)


def _build_shareable_report_content(db, project_id, report_type, title, generated_by):
    """Build a point-in-time analytics snapshot to store inside a shareable report.

    Without this the report would only carry a metadata header and no data. The
    depth of the snapshot varies by report_type:
      - summary:   headline KPIs + entity counts
      - executive: the above + recent activity
      - technical: everything, including KPI trends, team performance and upcoming items
    """
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    content = {
        "title": title,
        "report_type": report_type,
        "generated_at": datetime.now().isoformat(),
        "generated_by": generated_by,
        "project_id": project_id,
        "project_name": project.name if project else None,
    }
    try:
        analytics = generate_dashboard_analytics(db, project_id, "30d")
        kpi = analytics.get("kpi_data", {})

        def kpi_value(key):
            return (kpi.get(key) or {}).get("current", 0)

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

        content["summary"] = {
            "total_test_cases": total_test_cases,
            "total_test_suites": len(test_suite_ids),
            "total_test_runs": db.query(models.TestRun).filter(models.TestRun.project_id == project_id).count(),
            "total_requirements": db.query(models.Requirement).filter(models.Requirement.project_id == project_id).count(),
            "total_defects": db.query(models.Defect).filter(models.Defect.project_id == project_id).count(),
        }
        content["kpis"] = {
            "coverage_percent": kpi_value("coverage"),
            "pass_rate_percent": kpi_value("passRate"),
            "failure_rate_percent": kpi_value("failureTrends"),
            "flakiness_percent": kpi_value("flakiness"),
            "cycle_time_hours": kpi_value("cycleTime"),
            "defect_density": kpi_value("defectDensity"),
        }
        if report_type in ("executive", "technical"):
            content["recent_activity"] = analytics.get("recent_activity", {})
        if report_type == "technical":
            content["kpi_trends"] = kpi
            content["team_performance"] = analytics.get("team_performance", {})
            content["upcoming"] = analytics.get("upcoming_items", {})
        content["data_available"] = True
    except Exception as exc:
        print(f"Failed to build shareable report content for project {project_id}: {exc}")
        content["data_available"] = False
        content["error"] = "Analytics data could not be generated for this report."
    return content


def register_analytics_dashboard_routes(app):
    """Register analytics and dashboard routes with the FastAPI app."""

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
            print(f"Error in get_dashboard_analytics: {exc}")
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
                # Get all projects user has access to
                projects = db.query(models.Project).all()
            
            projects = [p for p in projects if p and rbac.has_permission(current_user, "read", p.id, db)]
            
            # Initialize counters
            total_test_cases = 0
            total_test_suites = 0
            total_test_runs = 0
            total_requirements = 0
            total_defects = 0
            total_milestones = 0
            total_test_plans = 0
            total_projects = len(projects)
            
            # Test execution results
            total_passed = 0
            total_failed = 0
            total_blocked = 0
            total_skipped = 0
            total_not_tested = 0
            
            for project in projects:
                # Count test cases
                active_test_cases_query = db.query(models.TestCase).join(models.TestSuite).filter(
                    models.TestSuite.project_id == project.id,
                    models.TestCase.is_deleted == False
                )
                test_case_ids = [row[0] for row in active_test_cases_query.with_entities(models.TestCase.id).all()]
                total_test_cases += len(test_case_ids)
                
                # Count test suites
                total_test_suites += db.query(models.TestSuite).filter(
                    models.TestSuite.project_id == project.id
                ).count()
                
                # Count test runs
                total_test_runs += db.query(models.TestRun).filter(
                    models.TestRun.project_id == project.id
                ).count()
                
                # Count requirements
                total_requirements += db.query(models.Requirement).filter(
                    models.Requirement.project_id == project.id
                ).count()
                
                # Count defects
                total_defects += db.query(models.Defect).filter(
                    models.Defect.project_id == project.id
                ).count()
                
                # Count milestones (handle potential schema issues)
                try:
                    total_milestones += db.query(models.Milestone).filter(
                        models.Milestone.project_id == project.id
                    ).count()
                except Exception as e:
                    # If milestone query fails due to schema issues, skip it
                    print(f"Error counting milestones for project {project.id}: {e}")
                    total_milestones += 0
                
                # Count test plans
                total_test_plans += db.query(models.TestPlan).filter(
                    models.TestPlan.project_id == project.id
                ).count()
                
                # Count test execution results
                for test_case_id in test_case_ids:
                    latest_result = db.query(models.TestResult).filter(
                        models.TestResult.test_case_id == test_case_id
                    ).order_by(
                        models.TestResult.executed_at.desc(),
                        models.TestResult.created_at.desc(),
                        models.TestResult.id.desc()
                    ).first()
                    
                    if latest_result:
                        normalized_status = (latest_result.status or "").lower()
                        if normalized_status in {"pass", "passed"}:
                            total_passed += 1
                        elif normalized_status in {"fail", "failed"}:
                            total_failed += 1
                        elif normalized_status in {"block", "blocked"}:
                            total_blocked += 1
                        elif normalized_status in {"skip", "skipped"}:
                            total_skipped += 1
                        elif normalized_status == "not_tested":
                            total_not_tested += 1
                        else:
                            total_not_tested += 1
                    else:
                        total_not_tested += 1
            
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
                    { "status": "not_tested", "count": total_not_tested }
                ],
                "passRate": pass_rate,
                "totalExecuted": total_executed,
                "totalNotTested": total_not_tested
            }
        except HTTPException:
            raise
        except Exception as e:
            print(f"Error in get_dashboard_statistics: {e}")
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
            print(f"Failed to create audit trail for KPI data creation: {e}")
        
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
            print(f"Failed to create audit trail for test step result creation: {e}")
        
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
        if not title:
            raise HTTPException(status_code=400, detail="Report title is required")
        if request.report_type not in {"executive", "technical", "summary"}:
            raise HTTPException(status_code=400, detail="Invalid report type")
        if request.access_level not in {"read-only", "edit"}:
            raise HTTPException(status_code=400, detail="Invalid access level")
        if request.expires_in_days is not None and not 1 <= request.expires_in_days <= 365:
            raise HTTPException(status_code=400, detail="expires_in_days must be between 1 and 365")
        
        # Build a real analytics snapshot so the report actually carries data.
        report_content = _build_shareable_report_content(
            db, request.project_id, request.report_type, title, current_user.username
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
            print(f"Failed to create audit trail for shareable report creation: {e}")
        
        return db_report

    @app.get("/analytics/shareable-reports/{project_id}", response_model=List[schemas.ShareableReport])
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
        
        return get_shareable_reports(db, project_id, created_by, skip, limit)

    @app.get("/analytics/shareable-reports/shared/{share_token}")
    def get_shared_report(
        share_token: str,
        db: Session = Depends(get_db)
    ):
        """Public viewer endpoint. Returns the report with regenerated content for
        legacy stub reports, enforces active/expiry, and tracks views."""
        report = get_shareable_report_by_token(db, share_token)
        if not report or not report.is_active:
            raise HTTPException(status_code=404, detail="Shared report not found or expired")
        if report.expires_at and report.expires_at < datetime.now(report.expires_at.tzinfo):
            raise HTTPException(status_code=410, detail="Shareable report has expired")

        # Legacy reports stored only a metadata stub — regenerate a live snapshot.
        content = report.report_content or {}
        if "kpis" not in content and "summary" not in content:
            content = _build_shareable_report_content(
                db, report.project_id, report.report_type, report.title, "system"
            )

        # view_count and last_viewed are already incremented inside
        # get_shareable_report_by_token, so no manual bump needed here.

        return {
            "id": report.id,
            "project_id": report.project_id,
            "title": report.title,
            "report_type": report.report_type,
            "report_content": content,
            "access_level": report.access_level,
            "shared_with": report.shared_with or [],
            "view_count": report.view_count,
            "expires_at": report.expires_at.isoformat() if report.expires_at else None,
            "generated_at": report.created_at.isoformat() if report.created_at else None,
        }

    @app.get("/analytics/shareable-reports/{report_id}/download")
    def download_shareable_report(
        report_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        report = db.query(models.ShareableReport).filter(
            models.ShareableReport.id == report_id,
            models.ShareableReport.is_active == True,
        ).first()
        if not report:
            raise HTTPException(status_code=404, detail="Shareable report not found")
        if not rbac.has_permission(current_user, "read", report.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        if report.expires_at and report.expires_at < datetime.now(report.expires_at.tzinfo):
            raise HTTPException(status_code=410, detail="Shareable report has expired")

        # Legacy reports were stored with only a metadata stub (no analytics).
        # Regenerate a live snapshot for those so the download still has data.
        content = report.report_content or {}
        if "kpis" not in content and "summary" not in content:
            content = _build_shareable_report_content(
                db, report.project_id, report.report_type, report.title, "system"
            )

        # Track downloads so view_count and last_viewed are meaningful, and audit
        # who pulled the report (compliance trail).
        try:
            report.view_count = (report.view_count or 0) + 1
            report.last_viewed = datetime.now()
            db.commit()
        except Exception as exc:
            print(f"Failed to record view for shareable report {report.id}: {exc}")
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
            print(f"Failed to write audit for shareable report download: {exc}")

        return {
            "id": report.id,
            "project_id": report.project_id,
            "title": report.title,
            "report_type": report.report_type,
            "report_content": content,
            "access_level": report.access_level,
            "shared_with": report.shared_with or [],
            "view_count": report.view_count,
            "expires_at": report.expires_at.isoformat() if report.expires_at else None,
            "generated_at": report.created_at.isoformat() if report.created_at else None,
        }

    @app.put("/analytics/shareable-reports/{report_id}", response_model=schemas.ShareableReport)
    def update_shareable_report_endpoint(
        report_id: int,
        report: dict,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_report = get_shareable_report_by_token(db, str(report_id))
        if not db_report:
            raise HTTPException(status_code=404, detail="Shareable report not found")

        if not rbac.has_permission(current_user, "write", db_report.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        db_report = update_shareable_report(db, report_id=report_id, report=report)
        
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
            print(f"Failed to create audit trail for shareable report update: {e}")

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
            print(f"Failed to create audit trail for root cause analysis creation: {e}")
        
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

        updated = update_root_cause_analysis(db, analysis_id=analysis_id, analysis_data=analysis)

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
            print(f"Failed to create audit trail for root cause analysis update: {e}")

        return updated

    @app.delete("/analytics/root-cause-analysis/{analysis_id}")
    def delete_root_cause_analysis_endpoint(
        analysis_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_analysis = get_root_cause_analysis(db, analysis_id)
        if not db_analysis:
            raise HTTPException(status_code=404, detail="Root cause analysis not found")
        if not rbac.has_permission(current_user, "delete", db_analysis.project_id, db):
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
            print(f"Failed to create audit trail for root cause analysis deletion: {e}")

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
            print(f"Failed to create audit trail for dashboard widget creation: {e}")
        
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
            print(f"Failed to create audit trail for dashboard widget update: {e}")

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
        from datetime import datetime, timedelta
        from ..models import TestCase, TestResult, TestSuite, TestRun, AuditTrail, AuditAction, EntityType
        
        if granularity != "day":
            raise HTTPException(status_code=400, detail="Only day granularity is currently supported")
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        try:
            end_dt = datetime.fromisoformat(end_date.replace('Z', '+00:00')) if end_date else datetime.utcnow()
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

    @app.delete("/analytics/dashboard-widgets/{widget_id}")
    def delete_dashboard_widget_endpoint(
        widget_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_widget = get_dashboard_widget(db, widget_id)
        if not db_widget:
            raise HTTPException(status_code=404, detail="Dashboard widget not found")

        if not rbac.has_permission(current_user, "delete", db_widget.project_id, db):
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
            print(f"Failed to create audit trail for dashboard widget deletion: {e}")

        return {"message": "Dashboard widget deleted successfully"}
