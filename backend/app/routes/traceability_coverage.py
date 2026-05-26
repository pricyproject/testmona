"""
Traceability matrix, coverage reports, and Jira integration routes.
"""

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional

from .. import crud, schemas, auth, rbac
from ..database import get_db
from ..auth import get_current_active_user
from ..crud import (
    create_traceability_matrix_entry, get_traceability_matrix_entries, get_traceability_matrix,
    update_traceability_matrix_entry, delete_traceability_matrix_entry,
    create_coverage_report, get_coverage_reports, get_coverage_report, update_coverage_report, delete_coverage_report
)


def register_traceability_coverage_routes(app):
    """Register traceability, coverage, and Jira integration routes with the FastAPI app."""
    
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
