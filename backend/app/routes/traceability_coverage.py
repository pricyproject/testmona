"""
Traceability matrix, coverage reports, and Jira integration routes.
"""

from fastapi import Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional

from .. import crud, schemas, auth, rbac, models
from ..database import get_db
from ..auth import get_current_active_user
from ..crud import (
    create_traceability_matrix_entry, get_traceability_matrix_entries, get_traceability_matrix,
    update_traceability_matrix_entry, delete_traceability_matrix_entry,
    create_coverage_report, get_coverage_reports, get_coverage_report, update_coverage_report, delete_coverage_report
)
from ._analytics_shared import (
    normalize_result_status,
    enum_value,
    get_linked_requirement_test_case_ids,
    add_legacy_reference_links,
)


def register_traceability_coverage_routes(app):
    """Register traceability, coverage, and Jira integration routes with the FastAPI app."""

    @app.get("/analytics/traceability-matrix")
    def get_traceability_matrix_get(
        project_id: int,
        priority: Optional[str] = Query(None, description="Filter by requirement priority (low/medium/high/critical)"),
        coverage_status: Optional[str] = Query(None, description="'covered' or 'uncovered'"),
        test_status: Optional[str] = Query(None, description="Show requirements that have a TC with this status"),
        search: Optional[str] = Query(None, description="Substring match on requirement title or key"),
        skip: int = Query(0, ge=0),
        limit: int = Query(50, ge=1, le=200),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Detailed traceability matrix with server-side filters and pagination.
        Headline coverage numbers (total/covered/uncovered/coverage_percentage)
        are always reported for the FULL project so filters don't distort them."""
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        from ..models import Defect, DefectStatus, Requirement, TestCase, TestResult, TestSuite, TraceabilityMatrix

        requirements = db.query(Requirement).filter(Requirement.project_id == project_id).all()
        requirement_ids = [requirement.id for requirement in requirements]
        test_suite_ids = [row.id for row in db.query(TestSuite.id).filter(TestSuite.project_id == project_id).all()]
        project_test_case_ids = [
            row.id for row in db.query(TestCase.id).filter(
                TestCase.test_suite_id.in_(test_suite_ids),
                TestCase.is_deleted == False,
            ).all()
        ] if test_suite_ids else []

        traceability_entries = []
        if requirement_ids and project_test_case_ids:
            traceability_entries = db.query(TraceabilityMatrix).filter(
                TraceabilityMatrix.requirement_id.in_(requirement_ids),
                TraceabilityMatrix.test_case_id.in_(project_test_case_ids),
            ).all()

        entries_by_requirement = {}
        for entry in traceability_entries:
            entries_by_requirement.setdefault(entry.requirement_id, {})[entry.test_case_id] = entry

        linked_test_case_ids = get_linked_requirement_test_case_ids(db, requirement_ids, project_test_case_ids)
        project_test_cases_by_id = {}
        if project_test_case_ids:
            project_test_cases_by_id = {
                test_case.id: test_case
                for test_case in db.query(TestCase).filter(TestCase.id.in_(project_test_case_ids)).all()
            }
        add_legacy_reference_links(linked_test_case_ids, requirements, list(project_test_cases_by_id.values()))

        # Open defects grouped by test_case_id — one batch query so the matrix
        # stays O(reqs × tcs) instead of O(reqs × tcs × defect_lookups).
        open_defect_statuses = (DefectStatus.OPEN, DefectStatus.IN_PROGRESS, DefectStatus.REOPENED)
        open_defects_by_tc: dict[int, list] = {}
        if project_test_case_ids:
            open_defect_rows = db.query(Defect).filter(
                Defect.project_id == project_id,
                Defect.test_case_id.in_(project_test_case_ids),
                Defect.status.in_(open_defect_statuses),
            ).all()
            for defect in open_defect_rows:
                open_defects_by_tc.setdefault(defect.test_case_id, []).append(defect)

        detailed_requirements = []
        covered_requirements = 0
        for requirement in requirements:
            entries = entries_by_requirement.get(requirement.id, {})
            linked_ids = linked_test_case_ids.get(requirement.id, set())
            if linked_ids:
                covered_requirements += 1

            test_cases = []
            for test_case_id in sorted(linked_ids):
                test_case = project_test_cases_by_id.get(test_case_id)
                if not test_case:
                    continue
                entry = entries.get(test_case_id)
                latest_result = db.query(TestResult).filter(
                    TestResult.test_case_id == test_case.id
                ).order_by(TestResult.executed_at.desc()).first()
                status = normalize_result_status(latest_result.status) if latest_result else "not_tested"
                tc_open_defects = open_defects_by_tc.get(test_case.id, [])
                test_cases.append({
                    "id": test_case.id,
                    "title": test_case.title,
                    "status": status,
                    "test_run_id": latest_result.test_run_id if latest_result else None,
                    "coverage_type": entry.coverage_type if entry and entry.coverage_type else "functional",
                    "coverage_percentage": entry.coverage_percentage if entry and entry.coverage_percentage is not None else 100,
                    "last_executed": latest_result.executed_at.isoformat() if latest_result and latest_result.executed_at else None,
                    "open_defects_count": len(tc_open_defects),
                    "open_defects": [
                        {
                            "id": defect.id,
                            "defect_id": defect.defect_id,
                            "title": defect.title,
                            "severity": enum_value(defect.severity),
                            "status": enum_value(defect.status),
                        }
                        for defect in tc_open_defects[:5]
                    ],
                })

            requirement_open_defects = sum(test_case["open_defects_count"] for test_case in test_cases)
            detailed_requirements.append({
                "requirement_id": requirement.id,
                "requirement_key": requirement.requirement_id,
                "requirement_title": requirement.title,
                "requirement_status": enum_value(requirement.status),
                "requirement_priority": enum_value(requirement.priority),
                "total_test_cases": len(test_cases),
                "passed_count": len([test_case for test_case in test_cases if test_case["status"] == "passed"]),
                "failed_count": len([test_case for test_case in test_cases if test_case["status"] == "failed"]),
                "blocked_count": len([test_case for test_case in test_cases if test_case["status"] == "blocked"]),
                "skipped_count": len([test_case for test_case in test_cases if test_case["status"] == "skipped"]),
                "not_tested_count": len([test_case for test_case in test_cases if test_case["status"] == "not_tested"]),
                "open_defects_count": requirement_open_defects,
                "test_cases": test_cases,
            })

        total_requirements = len(requirements)

        # Apply filters (server-side so the UI stays fast on big projects).
        filtered = detailed_requirements
        if priority:
            normalized_priority = priority.strip().lower()
            filtered = [
                r for r in filtered
                if str(r["requirement_priority"] or "").strip().lower() == normalized_priority
            ]
        if coverage_status:
            cs = coverage_status.strip().lower()
            if cs == "covered":
                filtered = [r for r in filtered if r["total_test_cases"] > 0]
            elif cs == "uncovered":
                filtered = [r for r in filtered if r["total_test_cases"] == 0]
        if test_status:
            ts = test_status.strip().lower()
            filtered = [
                r for r in filtered
                if any(tc["status"] == ts for tc in r["test_cases"])
            ]
        if search:
            q = search.strip().lower()
            if q:
                filtered = [
                    r for r in filtered
                    if q in str(r["requirement_title"] or "").lower()
                    or q in str(r["requirement_key"] or "").lower()
                ]

        matched_requirements = len(filtered)
        page = filtered[skip:skip + limit]

        return {
            "project_id": project_id,
            "total_requirements": total_requirements,
            "covered_requirements": covered_requirements,
            "uncovered_requirements": max(total_requirements - covered_requirements, 0),
            "coverage_percentage": round((covered_requirements / total_requirements * 100) if total_requirements else 0, 2),
            "matched_requirements": matched_requirements,
            "skip": skip,
            "limit": limit,
            "requirements": page,
        }

    # Traceability Matrix Endpoints
    @app.post("/traceability-matrix/", response_model=schemas.TraceabilityMatrix)
    def create_traceability_entry(
        entry: schemas.TraceabilityMatrixCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        # Check permissions on both requirement and test case
        requirement = crud.get_requirement(db, entry.requirement_id)
        test_case = crud.get_test_case(db, entry.test_case_id)

        if not requirement or not test_case:
            raise HTTPException(status_code=404, detail="Requirement or test case not found")

        if not rbac.has_permission(current_user, "write", requirement.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        db_entry = create_traceability_matrix_entry(db=db, entry=entry)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.CREATE.value,
                entity_type=EntityType.TRACEABILITY_ENTRY.value,
                entity_id=db_entry.id,
                project_id=requirement.project_id,
                description=f"Traceability entry created for requirement {entry.requirement_id} and test case {entry.test_case_id}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for traceability entry creation: {e}")
        
        return db_entry

    @app.get("/traceability-matrix")
    def read_traceability_matrix(
        requirement_id: Optional[int] = None,
        test_case_id: Optional[int] = None,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "read"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        try:
            return get_traceability_matrix_entries(db, requirement_id=requirement_id, test_case_id=test_case_id)
        except Exception as e:
            print(f"Error in read_traceability_matrix: {e}")
            return []

    @app.put("/traceability-matrix/{entry_id}", response_model=schemas.TraceabilityMatrix)
    def update_traceability_entry(
        entry_id: int,
        entry: dict,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_entry = crud.get_traceability_matrix(db, entry_id)
        if not db_entry:
            raise HTTPException(status_code=404, detail="Traceability entry not found")

        requirement = crud.get_requirement(db, db_entry.requirement_id)
        if not rbac.has_permission(current_user, "write", requirement.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        db_entry = update_traceability_matrix_entry(db, entry_id=entry_id, entry=entry)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.UPDATE.value,
                entity_type=EntityType.TRACEABILITY_ENTRY.value,
                entity_id=entry_id,
                project_id=requirement.project_id,
                description=f"Traceability entry updated for requirement {db_entry.requirement_id} and test case {db_entry.test_case_id}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for traceability entry update: {e}")

        return db_entry

    @app.delete("/traceability-matrix/{entry_id}")
    def delete_traceability_entry(
        entry_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_entry = get_traceability_matrix(db, entry_id)
        if not db_entry:
            raise HTTPException(status_code=404, detail="Traceability entry not found")

        requirement = crud.get_requirement(db, db_entry.requirement_id)
        if not rbac.has_permission(current_user, "delete", requirement.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        # Store data for audit trail before deletion
        entry_id_val = db_entry.id
        requirement_id = db_entry.requirement_id
        test_case_id = db_entry.test_case_id
        project_id = requirement.project_id

        delete_traceability_matrix_entry(db, entry_id=entry_id)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.DELETE.value,
                entity_type=EntityType.TRACEABILITY_ENTRY.value,
                entity_id=entry_id_val,
                project_id=project_id,
                description=f"Traceability entry deleted for requirement {requirement_id} and test case {test_case_id}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for traceability entry deletion: {e}")

        return {"message": "Traceability entry deleted successfully"}

    # Coverage Reports Endpoints
    @app.post("/coverage-reports/", response_model=schemas.CoverageReport)
    def create_coverage_report_endpoint(
        report: schemas.CoverageReportCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "write", report.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        db_report = create_coverage_report(db=db, report=report)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.CREATE.value,
                entity_type=EntityType.COVERAGE_REPORT.value,
                entity_id=db_report.id,
                project_id=db_report.project_id,
                description=f"Coverage report created for project {db_report.project_id}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for coverage report creation: {e}")

        return db_report

    @app.get("/coverage-reports/", response_model=List[schemas.CoverageReport])
    def read_coverage_reports(
        project_id: int,
        test_run_id: int = None,
        skip: int = 0,
        limit: int = 100,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        return get_coverage_reports(db, project_id=project_id, test_run_id=test_run_id, skip=skip, limit=limit)

    @app.get("/coverage-reports/{report_id}", response_model=schemas.CoverageReport)
    def read_coverage_report(
        report_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        report = get_coverage_report(db, report_id=report_id)
        if report is None:
            raise HTTPException(status_code=404, detail="Coverage report not found")

        if not rbac.has_permission(current_user, "read", report.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        return report

    @app.put("/coverage-reports/{report_id}", response_model=schemas.CoverageReport)
    def update_coverage_report_endpoint(
        report_id: int,
        report_data: dict,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_report = get_coverage_report(db, report_id=report_id)
        if db_report is None:
            raise HTTPException(status_code=404, detail="Coverage report not found")

        if not rbac.has_permission(current_user, "write", db_report.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        db_report = update_coverage_report(db, report_id=report_id, report=report_data)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.UPDATE.value,
                entity_type=EntityType.COVERAGE_REPORT.value,
                entity_id=db_report.id,
                project_id=db_report.project_id,
                description=f"Coverage report updated for project {db_report.project_id}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for coverage report update: {e}")

        return db_report

    @app.delete("/coverage-reports/{report_id}")
    def delete_coverage_report_endpoint(
        report_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_report = get_coverage_report(db, report_id=report_id)
        if db_report is None:
            raise HTTPException(status_code=404, detail="Coverage report not found")

        if not rbac.has_permission(current_user, "delete", db_report.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        # Store data for audit trail before deletion
        report_id_val = db_report.id
        project_id = db_report.project_id

        delete_coverage_report(db, report_id=report_id)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.DELETE.value,
                entity_type=EntityType.COVERAGE_REPORT.value,
                entity_id=report_id_val,
                project_id=project_id,
                description=f"Coverage report deleted for project {project_id}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for coverage report deletion: {e}")

        return {"message": "Coverage report deleted successfully"}

    # Jira Integration Endpoints
    @app.post("/jira-integrations/", response_model=schemas.JiraIntegration)
    def create_jira_integration(
        integration: schemas.JiraIntegrationCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "write", integration.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        db_integration = crud.create_jira_integration(db=db, integration=integration)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.CREATE.value,
                entity_type=EntityType.JIRA_INTEGRATION.value,
                entity_id=db_integration.id,
                project_id=db_integration.project_id,
                description=f"Jira integration created for project {db_integration.project_id}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for Jira integration creation: {e}")
        
        return db_integration

    @app.get("/jira-integrations/", response_model=List[schemas.JiraIntegration])
    def read_jira_integrations(
        project_id: int,
        skip: int = 0,
        limit: int = 100,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return crud.get_jira_integrations(db, project_id=project_id, skip=skip, limit=limit)

    @app.get("/jira-integrations/{integration_id}", response_model=schemas.JiraIntegration)
    def read_jira_integration(
        integration_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        integration = crud.get_jira_integration(db, integration_id=integration_id)
        if integration is None:
            raise HTTPException(status_code=404, detail="Jira integration not found")
        
        if not rbac.has_permission(current_user, "read", integration.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return integration

    @app.put("/jira-integrations/{integration_id}", response_model=schemas.JiraIntegration)
    def update_jira_integration(
        integration_id: int,
        integration: schemas.JiraIntegrationUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_integration = crud.get_jira_integration(db, integration_id=integration_id)
        if db_integration is None:
            raise HTTPException(status_code=404, detail="Jira integration not found")

        if not rbac.has_permission(current_user, "write", db_integration.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        db_integration = crud.update_jira_integration(db, integration_id=integration_id, integration=integration)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.UPDATE.value,
                entity_type=EntityType.JIRA_INTEGRATION.value,
                entity_id=db_integration.id,
                project_id=db_integration.project_id,
                description=f"Jira integration updated for project {db_integration.project_id}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for Jira integration update: {e}")

        return db_integration

    @app.delete("/jira-integrations/{integration_id}")
    def delete_jira_integration(
        integration_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_integration = crud.get_jira_integration(db, integration_id=integration_id)
        if db_integration is None:
            raise HTTPException(status_code=404, detail="Jira integration not found")

        if not rbac.has_permission(current_user, "delete", db_integration.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        # Store data for audit trail before deletion
        integration_id_val = db_integration.id
        project_id = db_integration.project_id

        crud.delete_jira_integration(db, integration_id=integration_id)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.DELETE.value,
                entity_type=EntityType.JIRA_INTEGRATION.value,
                entity_id=integration_id_val,
                project_id=project_id,
                description=f"Jira integration deleted for project {project_id}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for Jira integration deletion: {e}")

        return {"message": "Jira integration deleted successfully"}

    @app.post("/jira-integrations/{integration_id}/test-connection")
    def test_jira_connection(
        integration_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        integration = crud.get_jira_integration(db, integration_id=integration_id)
        if integration is None:
            raise HTTPException(status_code=404, detail="Jira integration not found")

        if not rbac.has_permission(current_user, "read", integration.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        # Test connection to Jira
        try:
            from ..jira_service import test_jira_connection
            result = test_jira_connection(integration)
            return {"status": "success", "message": "Connection successful"} if result else {"status": "failed", "message": "Connection failed"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    # Jira Issues Endpoints
    @app.post("/jira-issues/", response_model=schemas.JiraIssue)
    def create_jira_issue(
        issue: schemas.JiraIssueCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        integration = crud.get_jira_integration(db, integration_id=issue.integration_id)
        if not integration:
            raise HTTPException(status_code=404, detail="Jira integration not found")

        if not rbac.has_permission(current_user, "write", integration.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        db_issue = crud.create_jira_issue(db=db, issue=issue)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.CREATE.value,
                entity_type=EntityType.JIRA_ISSUE.value,
                entity_id=db_issue.id,
                project_id=integration.project_id,
                description=f"Jira issue created: {issue.jira_key or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for Jira issue creation: {e}")

        return db_issue

    @app.get("/jira-issues")
    def read_jira_issues(
        integration_id: int,
        skip: int = 0,
        limit: int = 100,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        integration = crud.get_jira_integration(db, integration_id=integration_id)
        if not integration:
            raise HTTPException(status_code=404, detail="Jira integration not found")

        if not rbac.has_permission(current_user, "read", integration.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        return crud.get_jira_issues(db, integration_id=integration_id, skip=skip, limit=limit)

    @app.post("/jira-issues/{issue_id}/sync-with-jira")
    def sync_jira_issue(
        issue_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        issue = crud.get_jira_issue(db, issue_id=issue_id)
        if not issue:
            raise HTTPException(status_code=404, detail="Jira issue not found")

        integration = crud.get_jira_integration(db, integration_id=issue.integration_id)
        if not integration:
            raise HTTPException(status_code=404, detail="Jira integration not found")

        if not rbac.has_permission(current_user, "write", integration.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        # Sync with Jira
        try:
            from ..jira_service import sync_jira_issue
            updated_issue = sync_jira_issue(db, issue)
            return {"status": "success", "issue": updated_issue}
        except Exception:
            raise HTTPException(status_code=500, detail="Failed to sync Jira issue")

    @app.put("/jira-issues/{issue_id}", response_model=schemas.JiraIssue)
    def update_jira_issue(
        issue_id: int,
        issue: schemas.JiraIssueUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_issue = crud.get_jira_issue(db, issue_id=issue_id)
        if db_issue is None:
            raise HTTPException(status_code=404, detail="Jira issue not found")

        integration = crud.get_jira_integration(db, integration_id=db_issue.integration_id)
        if not integration:
            raise HTTPException(status_code=404, detail="Jira integration not found")

        if not rbac.has_permission(current_user, "write", integration.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        db_issue = crud.update_jira_issue(db, issue_id=issue_id, issue=issue)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.UPDATE.value,
                entity_type=EntityType.JIRA_ISSUE.value,
                entity_id=db_issue.id,
                project_id=integration.project_id,
                description=f"Jira issue updated: {db_issue.jira_key or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for Jira issue update: {e}")

        return db_issue

    # Additional traceability endpoints
    @app.get("/traceability-matrix/{project_id}")
    def get_project_traceability_matrix(
        project_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        try:
            return get_traceability_matrix(db, project_id=project_id)
        except Exception as e:
            print(f"Error in get_project_traceability_matrix: {e}")
            return []

    @app.get("/traceability-matrix-entries/", response_model=List[schemas.TraceabilityMatrix])
    def read_all_traceability_entries(
        skip: int = 0,
        limit: int = 100,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "read"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        try:
            return get_traceability_matrix_entries(db, skip=skip, limit=limit)
        except Exception as e:
            print(f"Error in read_all_traceability_entries: {e}")
            return []

    @app.post("/traceability-matrix-entries/", response_model=schemas.TraceabilityMatrix)
    def create_traceability_entry_v2(
        entry: schemas.TraceabilityMatrixCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        # Check permissions on both requirement and test case
        requirement = crud.get_requirement(db, entry.requirement_id)
        test_case = crud.get_test_case(db, entry.test_case_id)

        if not requirement or not test_case:
            raise HTTPException(status_code=404, detail="Requirement or test case not found")

        if not rbac.has_permission(current_user, "write", requirement.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        return create_traceability_matrix_entry(db=db, entry=entry)

    @app.post("/coverage-reports/generate")
    def generate_coverage_report(
        report_data: dict,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        project_id = report_data.get('project_id')
        test_run_id = report_data.get('test_run_id')

        if not project_id:
            raise HTTPException(status_code=400, detail="project_id is required")

        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        # Generate coverage report
        try:
            from ..crud import generate_coverage_report
            report = generate_coverage_report(db, project_id=project_id, test_run_id=test_run_id)
            return {"status": "success", "report": report}
        except Exception as e:
            return {"status": "error", "message": str(e)}
