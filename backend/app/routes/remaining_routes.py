"""
Remaining routes for execution environments, additional analytics endpoints, and audit trails.
"""

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime
import re

from .. import crud, schemas, auth, rbac, models
from ..database import get_db
from ..auth import get_current_active_user


def register_remaining_routes(app):
    """Register remaining routes with the FastAPI app."""
    
    def normalize_result_status(status: str) -> str:
        status_map = {
            "pass": "passed",
            "passed": "passed",
            "fail": "failed",
            "failed": "failed",
            "block": "blocked",
            "blocked": "blocked",
            "skip": "skipped",
            "skipped": "skipped",
            "not_tested": "not_tested",
        }
        return status_map.get((status or "").lower(), (status or "").lower())

    def enum_value(value):
        return getattr(value, "value", value)

    def get_reference_tokens(value: str | None) -> list[str]:
        raw_value = value or ""
        tokens = [
            token.strip("()[]{}\"'.,").lower()
            for token in re.split(r"[\s,;|]+", raw_value)
            if token.strip("()[]{}\"'.,")
        ]
        tokens.extend(token.lower() for token in re.findall(r"[a-z]+-\d+", raw_value, flags=re.IGNORECASE))
        return list(dict.fromkeys(tokens))

    def add_legacy_reference_links(linked_test_case_ids: dict[int, set[int]], requirements: list, test_cases: list) -> None:
        for requirement in requirements:
            requirement_key = str(requirement.requirement_id or "").lower()
            if not requirement_key:
                continue
            for test_case in test_cases:
                if requirement_key in get_reference_tokens(test_case.reference):
                    linked_test_case_ids.setdefault(requirement.id, set()).add(test_case.id)

    def get_linked_requirement_test_case_ids(db: Session, requirement_ids: list[int], project_test_case_ids: list[int]) -> dict[int, set[int]]:
        linked_test_case_ids = {requirement_id: set() for requirement_id in requirement_ids}
        if not requirement_ids or not project_test_case_ids:
            return linked_test_case_ids

        traceability_rows = db.query(
            models.TraceabilityMatrix.requirement_id,
            models.TraceabilityMatrix.test_case_id,
        ).filter(
            models.TraceabilityMatrix.requirement_id.in_(requirement_ids),
            models.TraceabilityMatrix.test_case_id.in_(project_test_case_ids),
        ).all()
        association_rows = db.query(
            models.requirement_test_case_links.c.requirement_id,
            models.requirement_test_case_links.c.test_case_id,
        ).filter(
            models.requirement_test_case_links.c.requirement_id.in_(requirement_ids),
            models.requirement_test_case_links.c.test_case_id.in_(project_test_case_ids),
        ).all()

        for requirement_id, test_case_id in traceability_rows + association_rows:
            linked_test_case_ids.setdefault(requirement_id, set()).add(test_case_id)

        return linked_test_case_ids

    def build_coverage_report(db: Session, project_id: int, generated: bool = False):
        from ..models import TestCase, TestSuite, TestResult, TestRun, Requirement, TraceabilityMatrix, PriorityDefinition

        test_suite_ids = [row.id for row in db.query(TestSuite.id).filter(TestSuite.project_id == project_id).all()]
        test_cases_query = db.query(TestCase).filter(TestCase.test_suite_id.in_(test_suite_ids), TestCase.is_deleted == False)
        test_cases = test_cases_query.all() if test_suite_ids else []
        test_case_ids = [test_case.id for test_case in test_cases]
        total_test_cases = len(test_cases)

        test_run_ids = [row.id for row in db.query(TestRun.id).filter(TestRun.project_id == project_id).all()]
        test_results = db.query(TestResult).filter(TestResult.test_run_id.in_(test_run_ids)).all() if test_run_ids else []
        latest_by_test_case = {}
        for result in test_results:
            current = latest_by_test_case.get(result.test_case_id)
            if current is None or (result.executed_at and current.executed_at and result.executed_at > current.executed_at):
                latest_by_test_case[result.test_case_id] = result
            elif current is None or (result.executed_at and not current.executed_at):
                latest_by_test_case[result.test_case_id] = result

        normalized_statuses = [normalize_result_status(result.status) for result in latest_by_test_case.values()]
        executed_statuses = {"passed", "failed", "blocked", "skipped"}
        executed_test_cases = len([status for status in normalized_statuses if status in executed_statuses])
        passed_test_cases = normalized_statuses.count("passed")
        failed_test_cases = normalized_statuses.count("failed")
        blocked_test_cases = normalized_statuses.count("blocked")
        skipped_test_cases = normalized_statuses.count("skipped")
        not_tested_cases = max(total_test_cases - executed_test_cases, 0)

        requirements = db.query(Requirement).filter(Requirement.project_id == project_id).all()
        total_requirements = len(requirements)
        requirement_ids = [requirement.id for requirement in requirements]
        linked_test_case_ids = get_linked_requirement_test_case_ids(db, requirement_ids, test_case_ids)
        add_legacy_reference_links(linked_test_case_ids, requirements, test_cases)
        covered_requirements = len([requirement_id for requirement_id, linked_ids in linked_test_case_ids.items() if linked_ids])
        coverage_percentage = (covered_requirements / total_requirements * 100) if total_requirements else 0

        priority_definitions = db.query(PriorityDefinition).filter(PriorityDefinition.is_active == True).order_by(PriorityDefinition.value.desc()).all()
        priority_names = [priority.name.lower() for priority in priority_definitions] or ["critical", "high", "medium", "low"]
        priority_coverage = {priority_name: 0 for priority_name in priority_names}
        linked_requirement_ids = {requirement_id for requirement_id, linked_ids in linked_test_case_ids.items() if linked_ids}
        for priority_name in priority_names:
            priority_requirements = [
                requirement for requirement in requirements
                if str(enum_value(requirement.priority) or "").lower() == priority_name
            ]
            if priority_requirements:
                covered_priority = len([requirement for requirement in priority_requirements if requirement.id in linked_requirement_ids])
                priority_coverage[priority_name] = round((covered_priority / len(priority_requirements)) * 100, 2)

        return {
            "id": f"COV-{datetime.now().strftime('%Y%m%d%H%M%S')}" if generated else "COV-DYNAMIC",
            "title": f"Coverage Report - {datetime.now().strftime('%Y-%m-%d')}" if generated else "Current Coverage Report",
            "generated_at": datetime.now().isoformat(),
            "coverage_percentage": round(coverage_percentage, 2),
            "total_requirements": total_requirements,
            "covered_requirements": covered_requirements,
            "test_cases_count": total_test_cases,
            "executed_tests": executed_test_cases,
            "report_data": {
                "by_priority": priority_coverage,
                "by_status": {
                    "passed": round((passed_test_cases / executed_test_cases * 100) if executed_test_cases else 0, 2),
                    "failed": round((failed_test_cases / executed_test_cases * 100) if executed_test_cases else 0, 2),
                    "blocked": round((blocked_test_cases / executed_test_cases * 100) if executed_test_cases else 0, 2),
                    "skipped": round((skipped_test_cases / executed_test_cases * 100) if executed_test_cases else 0, 2),
                    "not_tested": round((not_tested_cases / total_test_cases * 100) if total_test_cases else 0, 2),
                },
            },
        }

    
    # Execution Environment Endpoints
    @app.get("/execution-environments/", response_model=List[schemas.ExecutionEnvironment])
    def get_execution_environments(
        project_id: int = None,
        skip: int = 0,
        limit: int = 100,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if project_id is not None and not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        environments = crud.get_execution_environments(db, project_id=project_id)
        return environments[skip:skip+limit]

    @app.get("/execution-environments/{environment_id}", response_model=schemas.ExecutionEnvironment)
    def get_execution_environment(
        environment_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        environment = crud.get_execution_environment(db, environment_id=environment_id)
        if environment is None:
            raise HTTPException(status_code=404, detail="Environment not found")
        
        if not rbac.has_permission(current_user, "read", environment.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return environment

    @app.post("/execution-environments/", response_model=schemas.ExecutionEnvironment)
    def create_execution_environment(
        environment: schemas.ExecutionEnvironmentCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "manage", environment.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        db_environment = crud.create_execution_environment(db, environment.model_dump())
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.CREATE.value,
                entity_type=EntityType.EXECUTION_ENVIRONMENT.value,
                entity_id=db_environment.id,
                project_id=db_environment.project_id,
                description=f"Execution environment created: {environment.name or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for execution environment creation: {e}")
        
        return db_environment

    @app.put("/execution-environments/{environment_id}", response_model=schemas.ExecutionEnvironment)
    def update_execution_environment(
        environment_id: int,
        environment: schemas.ExecutionEnvironmentUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_environment = crud.get_execution_environment(db, environment_id=environment_id)
        if db_environment is None:
            raise HTTPException(status_code=404, detail="Environment not found")
        
        if not rbac.has_permission(current_user, "manage", db_environment.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        update_data = environment.model_dump(exclude_unset=True)
        db_environment = crud.update_execution_environment(db, environment_id, update_data)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.UPDATE.value,
                entity_type=EntityType.EXECUTION_ENVIRONMENT.value,
                entity_id=db_environment.id,
                project_id=db_environment.project_id,
                description=f"Execution environment updated: {db_environment.name or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for execution environment update: {e}")
        
        return db_environment

    @app.delete("/execution-environments/{environment_id}")
    def delete_execution_environment(
        environment_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        db_environment = crud.get_execution_environment(db, environment_id=environment_id)
        if db_environment is None:
            raise HTTPException(status_code=404, detail="Environment not found")
        
        if not rbac.has_permission(current_user, "manage", db_environment.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        # Store data for audit trail before deletion
        environment_id_val = db_environment.id
        environment_name = db_environment.name
        project_id = db_environment.project_id
        
        crud.delete_execution_environment(db, environment_id)
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.DELETE.value,
                entity_type=EntityType.EXECUTION_ENVIRONMENT.value,
                entity_id=environment_id_val,
                project_id=project_id,
                description=f"Execution environment deleted: {environment_name or 'Untitled'}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            print(f"Failed to create audit trail for execution environment deletion: {e}")
        
        return {"message": "Environment deleted successfully"}

    # Environments Endpoints (for frontend compatibility)
    @app.get("/environments", response_model=List[schemas.ExecutionEnvironment])
    def get_environments(
        project_id: int = None,
        skip: int = 0,
        limit: int = 100,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Get environments - endpoint to match frontend expectations"""
        if project_id is not None and not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        environments = crud.get_execution_environments(db, project_id=project_id)
        return environments[skip:skip+limit]

    @app.get("/environments/{environment_id}", response_model=schemas.ExecutionEnvironment)
    def get_environment(
        environment_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Get environment by ID - endpoint to match frontend expectations"""
        environment = crud.get_execution_environment(db, environment_id=environment_id)
        if environment is None:
            raise HTTPException(status_code=404, detail="Environment not found")
        
        if not rbac.has_permission(current_user, "read", environment.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return environment

    @app.post("/environments", response_model=schemas.ExecutionEnvironment)
    def create_environment(
        environment: schemas.ExecutionEnvironmentCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Create environment - endpoint to match frontend expectations"""
        if not rbac.has_permission(current_user, "manage", environment.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return crud.create_execution_environment(db, environment.model_dump())

    @app.put("/environments/{environment_id}", response_model=schemas.ExecutionEnvironment)
    def update_environment(
        environment_id: int,
        environment: schemas.ExecutionEnvironmentUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Update environment - endpoint to match frontend expectations"""
        db_environment = crud.get_execution_environment(db, environment_id=environment_id)
        if db_environment is None:
            raise HTTPException(status_code=404, detail="Environment not found")
        
        if not rbac.has_permission(current_user, "manage", db_environment.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        update_data = environment.model_dump(exclude_unset=True)
        return crud.update_execution_environment(db, environment_id, update_data)

    @app.delete("/environments/{environment_id}")
    def delete_environment(
        environment_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Delete environment - endpoint to match frontend expectations"""
        db_environment = crud.get_execution_environment(db, environment_id=environment_id)
        if db_environment is None:
            raise HTTPException(status_code=404, detail="Environment not found")
        
        if not rbac.has_permission(current_user, "manage", db_environment.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        crud.delete_execution_environment(db, environment_id)
        return {"message": "Environment deleted successfully"}

    # Additional Analytics GET Endpoints
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
            # Use real analytics calculation from CRUD
            return crud.generate_dashboard_analytics(db, project_id, time_range)
        except Exception as e:
            print(f"Error in get_dashboard_analytics_get: {e}")
            raise HTTPException(status_code=500, detail="Failed to generate analytics")

    @app.get("/analytics/granular-insights")
    def get_granular_insights_get(
        project_id: int,
        filter_type: str = "all",
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Get granular insights for a project"""
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        # Use real KPI data from CRUD
        kpis = crud.calculate_project_kpis(db, project_id, "7d")
        
        return {
            "project_id": project_id,
            "filter_type": filter_type,
            "insights": [
                {
                    "category": "Test Execution",
                    "metric": "Average Execution Time",
                    "value": f"{kpis['avg_execution_time']}h",
                    "trend": "stable",
                    "details": "Based on recent test runs"
                },
                {
                    "category": "Defect Analysis",
                    "metric": "Defect Density",
                    "value": str(kpis['defect_density']),
                    "trend": "stable",
                    "details": f"Defects per {kpis['total_tests']} tests"
                },
                {
                    "category": "Test Coverage",
                    "metric": "Coverage",
                    "value": f"{kpis['coverage']}%",
                    "trend": "stable",
                    "details": f"{kpis['passed_tests']} passed out of {kpis['total_tests']}"
                }
            ]
        }

    @app.get("/analytics/traceability-matrix")
    def get_traceability_matrix_get(
        project_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Get a detailed traceability matrix for the reports page, including latest execution run IDs."""
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        from ..models import Requirement, TestCase, TestResult, TestSuite, TraceabilityMatrix

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
                test_cases.append({
                    "id": test_case.id,
                    "title": test_case.title,
                    "status": status,
                    "test_run_id": latest_result.test_run_id if latest_result else None,
                    "coverage_type": entry.coverage_type if entry and entry.coverage_type else "functional",
                    "coverage_percentage": entry.coverage_percentage if entry and entry.coverage_percentage is not None else 100,
                    "last_executed": latest_result.executed_at.isoformat() if latest_result and latest_result.executed_at else None,
                })

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
                "test_cases": test_cases,
            })

        total_requirements = len(requirements)
        return {
            "project_id": project_id,
            "total_requirements": total_requirements,
            "covered_requirements": covered_requirements,
            "uncovered_requirements": max(total_requirements - covered_requirements, 0),
            "coverage_percentage": round((covered_requirements / total_requirements * 100) if total_requirements else 0, 2),
            "requirements": detailed_requirements,
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
            latest_statuses.append(normalize_result_status(latest_result.status) if latest_result else "not_tested")

        total_tests = len(test_cases)
        passed = latest_statuses.count("passed")
        failed = latest_statuses.count("failed")
        blocked = latest_statuses.count("blocked")
        skipped = latest_statuses.count("skipped")
        not_tested = latest_statuses.count("not_tested")
        executed = passed + failed + blocked + skipped

        return {
            "project_id": project_id,
            "summary": {
                "total_test_cases": total_tests,
                "executed_test_cases": executed,
                "not_tested_test_cases": not_tested,
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
                "not_tested": not_tested,
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
                "not_tested": round((not_tested / total_tests) * 100, 1) if total_tests else 0,
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
        
        # Use real root cause analyses from CRUD
        analyses = crud.get_root_cause_analyses(db, project_id=project_id)
        
        # Convert to response format
        return [
            {
                "id": f"RCA-{analysis.id}",
                "title": analysis.title or f"Root Cause Analysis {analysis.id}",
                "created_at": analysis.created_at.isoformat() if analysis.created_at else datetime.now().isoformat(),
                "defect_id": analysis.defect_id,
                "root_cause": analysis.root_cause,
                "severity": analysis.severity,
                "recommendations": analysis.recommendations or []
            }
            for analysis in analyses
        ]

    # Audit Endpoint
    @app.get("/audit/project-activity-summary")
    def get_project_activity_summary_direct(
        project_id: int,
        days: int = 7,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Get project activity summary - direct endpoint to match frontend expectations"""
        if days < 1 or days > 365:
            raise HTTPException(status_code=400, detail="days must be between 1 and 365")
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        # Import the audit service
        from ..services.audit_service import get_audit_service
        audit_service = get_audit_service(db)
        
        # Get the activity summary from the audit service
        summary = audit_service.get_project_activity_summary(project_id, days)
        return summary
