"""
Project management routes for projects, assignments, schedules, and executions.
"""

import logging
from fastapi import Depends, HTTPException, Query, Response
from sqlalchemy import func
from sqlalchemy.orm import Session
from typing import List, Optional

from .. import crud, schemas, auth, rbac, models, crud_rbac
from .. import features as project_features
from ..database import get_db
from ..auth import get_current_active_user, check_password_change_required
from ..models import Project, TestSuite, TestCase, TestRun, User, AuditAction

logger = logging.getLogger(__name__)


def _record_project_audit(db: Session, user, action: str, project_id: int, description: str) -> None:
    """Best-effort audit trail entry for a project action. Never raises."""
    try:
        from ..services.audit_service import get_audit_service
        from ..schemas_audit import AuditTrailCreate
        from ..models import EntityType
        audit_service = get_audit_service(db)
        audit_service.create_audit_trail(AuditTrailCreate(
            user_id=user.id if user else None,
            action=action,
            entity_type=EntityType.PROJECT.value,
            entity_id=project_id,
            project_id=project_id,
            description=description,
        ))
    except Exception as e:
        logger.warning(f"Failed to create project audit trail: {e}")


def register_project_routes(app):
    """Register project management routes with the FastAPI app."""
    
    @app.post("/projects", response_model=schemas.Project)
    def create_project(
        project: schemas.ProjectCreate, 
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        # Check if user needs to change password
        check_password_change_required(current_user)
        
        if not rbac.has_permission(current_user, "manage_projects"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        if project.owner_id is None:
            project.owner_id = current_user.id
        
        # Check if project with same name already exists for the same owner
        existing_project = db.query(models.Project).filter(
            models.Project.name == project.name,
            models.Project.owner_id == project.owner_id
        ).first()
        if existing_project:
            raise HTTPException(status_code=400, detail="A project with this name already exists")

        db_project = crud.create_project(db=db, project=project)
        _record_project_audit(
            db, current_user, AuditAction.CREATE.value, db_project.id,
            f"Project '{db_project.name}' created"
        )
        return db_project

    @app.get("/projects")
    def read_projects(
        response: Response,
        skip: int = 0,
        limit: int = 100,
        status: Optional[models.Status] = Query(None, description="Filter projects by status"),
        include_archived: bool = Query(True, description="Include archived projects when no status filter is provided"),
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        try:
            accessible = rbac.get_accessible_projects(current_user, db)
            if status is not None:
                accessible = [project for project in accessible if project.status == status]
            elif not include_archived:
                accessible = [project for project in accessible if project.status != models.Status.ARCHIVED]

            total = len(accessible)
            projects = accessible[skip:skip + limit]

            # Expose the unpaginated total so the UI can drive pagination controls.
            response.headers["X-Total-Count"] = str(total)

            if not projects:
                return []

            project_ids = [project.id for project in projects]

            # Aggregate related-entity counts in three grouped queries instead of
            # running per-project COUNT(*) statements (avoids an N+1 query pattern).
            suite_counts = dict(
                db.query(TestSuite.project_id, func.count(TestSuite.id))
                .filter(TestSuite.project_id.in_(project_ids))
                .group_by(TestSuite.project_id)
                .all()
            )
            case_counts = dict(
                db.query(TestSuite.project_id, func.count(TestCase.id))
                .join(TestCase, TestCase.test_suite_id == TestSuite.id)
                .filter(
                    TestSuite.project_id.in_(project_ids),
                    ((TestCase.is_deleted.is_(None)) | (TestCase.is_deleted.is_(False))),
                )
                .group_by(TestSuite.project_id)
                .all()
            )
            run_counts = dict(
                db.query(TestRun.project_id, func.count(TestRun.id))
                .filter(TestRun.project_id.in_(project_ids))
                .group_by(TestRun.project_id)
                .all()
            )

            # Resolve owner display names in a single query.
            owner_ids = {project.owner_id for project in projects if project.owner_id}
            owner_names = {}
            if owner_ids:
                owner_names = {
                    user.id: (user.full_name or user.username or user.email)
                    for user in db.query(User).filter(User.id.in_(owner_ids)).all()
                }

            result = []
            for project in projects:
                result.append({
                    "id": project.id,
                    "name": project.name,
                    "description": project.description,
                    "status": project.status.value if hasattr(project.status, "value") else project.status,
                    "owner_id": project.owner_id,
                    "owner_name": owner_names.get(project.owner_id),
                    "features": project_features.normalize_features(project.features),
                    "created_at": project.created_at,
                    "updated_at": project.updated_at,
                    "test_suites_count": suite_counts.get(project.id, 0),
                    "test_cases_count": case_counts.get(project.id, 0),
                    "test_runs_count": run_counts.get(project.id, 0),
                })
            return result
        except Exception:
            logger.exception("Failed to list projects")
            raise HTTPException(status_code=500, detail="Failed to retrieve projects")

    @app.get("/projects/{project_id}", response_model=schemas.Project)
    def read_project(
        project_id: int, 
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        db_project = crud.get_project(db, project_id=project_id)
        if db_project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        return db_project

    @app.put("/projects/{project_id}", response_model=schemas.Project)
    def update_project(
        project_id: int, 
        project: schemas.ProjectUpdate, 
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "write", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        db_project = crud.update_project(db, project_id=project_id, project=project)
        if db_project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        _record_project_audit(
            db, current_user, AuditAction.UPDATE.value, db_project.id,
            f"Project '{db_project.name}' updated"
        )
        return db_project

    @app.get("/projects/{project_id}/features")
    def read_project_features(
        project_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Return the project's normalized feature map plus the full catalog.

        Any project member who can read the project can see which features are
        on; only managers/owners/admins may change them.
        """
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        db_project = crud.get_project(db, project_id=project_id)
        if db_project is None:
            raise HTTPException(status_code=404, detail="Project not found")

        return {
            "features": project_features.normalize_features(db_project.features),
            "catalog": list(project_features.PROJECT_FEATURES),
        }

    @app.put("/projects/{project_id}/features", response_model=schemas.Project)
    def update_project_features(
        project_id: int,
        payload: schemas.ProjectFeaturesUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Enable/disable feature modules for a project.

        Restricted to admins, the project owner, and (project) managers via the
        ``manage_projects`` permission. Unknown keys are ignored; the stored
        value is always a complete, normalized map.
        """
        if not rbac.can_manage_project(current_user, project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        db_project = crud.get_project(db, project_id=project_id)
        if db_project is None:
            raise HTTPException(status_code=404, detail="Project not found")

        merged = project_features.normalize_features(db_project.features)
        for key, value in payload.features.items():
            if key in project_features.PROJECT_FEATURE_SET:
                merged[key] = bool(value)

        db_project.features = merged
        crud.safe_commit(db)
        db.refresh(db_project)
        _record_project_audit(
            db, current_user, AuditAction.UPDATE.value, db_project.id,
            f"Project '{db_project.name}' feature toggles updated"
        )
        return db_project

    @app.delete("/projects/{project_id}", response_model=schemas.MessageResponse)
    def delete_project(
        project_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "delete", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        existing = crud.get_project(db, project_id=project_id)
        if existing is None:
            raise HTTPException(status_code=404, detail="Project not found")
        project_name = existing.name

        db_project = crud.delete_project(db, project_id=project_id)
        if db_project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        _record_project_audit(
            db, current_user, AuditAction.DELETE.value, project_id,
            f"Project '{project_name}' deleted"
        )
        return {"message": "Project deleted successfully"}

    @app.post("/projects/{project_id}/delete", response_model=schemas.MessageResponse)
    def delete_project_with_verification(
        project_id: int, 
        delete_data: dict,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "delete", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        # Get project name from request body
        project_name = delete_data.get('project_name')
        if not project_name:
            raise HTTPException(status_code=400, detail="project_name field is required")
        
        # Get project to verify name
        db_project = crud.get_project(db, project_id=project_id)
        if db_project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Verify project name matches
        if db_project.name != project_name:
            raise HTTPException(
                status_code=400,
                detail=f"Project name mismatch. Expected '{db_project.name}', got '{project_name}'"
            )

        # Delete the project
        deleted_project = crud.delete_project(db, project_id=project_id)
        if deleted_project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        _record_project_audit(
            db, current_user, AuditAction.DELETE.value, project_id,
            f"Project '{project_name}' deleted"
        )
        return {"message": "Project deleted successfully"}

    @app.post("/projects/{project_id}/clone", response_model=schemas.Project)
    def clone_project(
        project_id: int,
        clone_data: schemas.ProjectClone,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Clone a project together with its test suites and test cases."""
        check_password_change_required(current_user)

        if not rbac.has_permission(current_user, "manage_projects"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        source = crud.get_project(db, project_id=project_id)
        if source is None:
            raise HTTPException(status_code=404, detail="Project not found")

        owner_id = clone_data.owner_id or current_user.id
        new_name = (clone_data.name or f"{source.name} (Copy)").strip()

        existing_project = db.query(models.Project).filter(
            models.Project.name == new_name,
            models.Project.owner_id == owner_id
        ).first()
        if existing_project:
            raise HTTPException(status_code=400, detail="A project with this name already exists")

        source_status = source.status.value if hasattr(source.status, "value") else source.status
        new_project = crud.create_project(db, project=schemas.ProjectCreate(
            name=new_name,
            description=clone_data.description if clone_data.description is not None else source.description,
            status=source_status,
            owner_id=owner_id,
        ))

        # Carry the source project's feature toggles onto the clone so a cloned
        # project behaves like its origin instead of silently re-enabling modules.
        if isinstance(source.features, dict) and source.features:
            new_project.features = project_features.normalize_features(source.features)
            crud.safe_commit(db)
            db.refresh(new_project)

        def _enum_value(value, default):
            if value is None:
                return default
            return value.value if hasattr(value, "value") else value

        # Copy each test suite and its test cases into the new project.
        for suite in crud.get_test_suites(db, project_id=source.id):
            new_suite = crud.create_test_suite(db, test_suite=schemas.TestSuiteCreate(
                name=suite.name,
                description=suite.description,
                project_id=new_project.id,
            ))
            for case in crud.get_test_cases(db, test_suite_id=suite.id):
                is_multistep = bool(getattr(case, "is_multistep", False))
                new_case = crud.create_test_case(db, test_case=schemas.TestCaseCreate(
                    title=case.title,
                    description=case.description,
                    preconditions=case.preconditions or "",
                    steps=case.steps or "",
                    expected_result=case.expected_result or "",
                    priority=_enum_value(case.priority, "medium"),
                    status=_enum_value(case.status, "active"),
                    tags=case.tags,
                    test_suite_id=new_suite.id,
                    test_type=_enum_value(case.test_type, "manual"),
                    section_id=None,
                    order_index=case.order_index or 0,
                    is_multistep=is_multistep,
                ), created_by=current_user.id)

                if is_multistep:
                    for step in crud.get_test_case_steps(db, case.id):
                        crud.create_test_case_step(db, step=schemas.TestCaseStepCreate(
                            test_case_id=new_case.id,
                            step_number=step.step_number,
                            action=step.action or "",
                            expected_result=step.expected_result or "",
                            step_type=_enum_value(step.step_type, "manual"),
                        ))

        _record_project_audit(
            db, current_user, AuditAction.CREATE.value, new_project.id,
            f"Project '{new_project.name}' cloned from '{source.name}'"
        )
        return new_project

    # Project Assignment Endpoints
    @app.post("/project-assignments", response_model=schemas.ProjectAssignment)
    def create_project_assignment(
        assignment: schemas.ProjectAssignmentCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.can_assign_users(current_user, assignment.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        project = db.query(models.Project).filter(models.Project.id == assignment.project_id).first()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        user = db.query(models.User).filter(models.User.id == assignment.user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        if not user.is_active:
            raise HTTPException(status_code=400, detail="Cannot assign an inactive user")

        # The project owner already has implicit admin access — a redundant
        # row would just confuse the UI and the role-edit flow.
        if project.owner_id == assignment.user_id:
            raise HTTPException(status_code=400, detail="Project owner already has full access")

        existing = db.query(models.ProjectAssignment).filter(
            models.ProjectAssignment.project_id == assignment.project_id,
            models.ProjectAssignment.user_id == assignment.user_id,
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="User is already a member of this project")

        if assignment.assigned_by is None:
            assignment.assigned_by = current_user.id

        created = crud_rbac.create_project_assignment(db=db, assignment=assignment)
        _record_project_audit(
            db, current_user, AuditAction.CREATE.value, assignment.project_id,
            f"User {user.username} added as {rbac.role_value(assignment.role)}"
        )
        return created

    @app.get("/project-assignments", response_model=List[schemas.ProjectAssignment])
    def read_project_assignments(
        project_id: int = None,
        user_id: int = None,
        skip: int = 0,
        limit: int = 100,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if project_id is not None:
            if not rbac.has_permission(current_user, "read", project_id, db):
                raise HTTPException(status_code=403, detail="Insufficient permissions")
        elif user_id is not None and user_id != current_user.id and not rbac.has_permission(current_user, "manage_users"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        elif user_id is None and not rbac.has_permission(current_user, "manage_users"):
            user_id = current_user.id
        
        return crud_rbac.get_project_assignments(db, project_id=project_id, user_id=user_id, skip=skip, limit=limit)

    @app.put("/project-assignments/{assignment_id}", response_model=schemas.ProjectAssignment)
    def update_project_assignment(
        assignment_id: int,
        payload: schemas.ProjectAssignmentUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        assignment = crud_rbac.get_project_assignment(db, assignment_id=assignment_id)
        if not assignment:
            raise HTTPException(status_code=404, detail="Assignment not found")

        if not rbac.can_assign_users(current_user, assignment.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        # Prevent a manager from accidentally demoting themselves and losing
        # the ability to manage the project mid-flight. Global admins still
        # get their global privileges, so this only bites project-scoped
        # admins/managers — exactly the case we want to protect.
        if assignment.user_id == current_user.id and not getattr(current_user, "is_superuser", False) \
                and rbac.normalize_role(getattr(current_user, "role", None)) not in {models.Role.ADMIN, models.Role.MANAGER}:
            raise HTTPException(status_code=400, detail="You cannot change your own role on this project")

        # Moving an assignment between projects or users would silently change
        # who has access where; only role edits are accepted here. Removing and
        # re-adding is the path for the other cases.
        if payload.project_id is not None and payload.project_id != assignment.project_id:
            raise HTTPException(status_code=400, detail="Cannot move an assignment to a different project")
        if payload.user_id is not None and payload.user_id != assignment.user_id:
            raise HTTPException(status_code=400, detail="Cannot reassign to a different user")
        if payload.role is None:
            raise HTTPException(status_code=400, detail="Role is required")

        updated = crud_rbac.update_project_assignment(
            db,
            assignment_id=assignment_id,
            assignment=schemas.ProjectAssignmentUpdate(role=payload.role),
        )
        _record_project_audit(
            db, current_user, AuditAction.UPDATE.value, assignment.project_id,
            f"Assignment {assignment_id} role updated to {rbac.role_value(payload.role)}"
        )
        return updated

    @app.delete("/project-assignments/{assignment_id}", response_model=schemas.MessageResponse)
    def delete_project_assignment(
        assignment_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        assignment = crud_rbac.get_project_assignment(db, assignment_id=assignment_id)
        if not assignment:
            raise HTTPException(status_code=404, detail="Assignment not found")

        if not rbac.can_assign_users(current_user, assignment.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        # Block self-removal for project-scoped admins/managers (global
        # admins/managers still retain access via their global role).
        if assignment.user_id == current_user.id and not getattr(current_user, "is_superuser", False) \
                and rbac.normalize_role(getattr(current_user, "role", None)) not in {models.Role.ADMIN, models.Role.MANAGER}:
            raise HTTPException(status_code=400, detail="You cannot remove yourself from this project")

        crud_rbac.delete_project_assignment(db, assignment_id=assignment_id)
        _record_project_audit(
            db, current_user, AuditAction.DELETE.value, assignment.project_id,
            f"Assignment {assignment_id} removed"
        )
        return {"message": "Project assignment deleted successfully"}

    @app.get("/projects/{project_id}/members", response_model=List[schemas.ProjectMember])
    def read_project_members(
        project_id: int,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        """Members of a project, joined with user info. Includes the implicit
        owner row so the UI can show them even when no assignment row exists."""
        project = db.query(models.Project).filter(models.Project.id == project_id).first()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        if not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        assignments = crud_rbac.get_project_assignments(db, project_id=project_id, limit=10000)
        user_ids = {assignment.user_id for assignment in assignments}
        if project.owner_id:
            user_ids.add(project.owner_id)
        users_by_id = {
            user.id: user
            for user in db.query(models.User).filter(models.User.id.in_(user_ids)).all()
        } if user_ids else {}

        members: List[schemas.ProjectMember] = []
        seen_users: set[int] = set()
        for assignment in assignments:
            user = users_by_id.get(assignment.user_id)
            if not user:
                continue
            members.append(schemas.ProjectMember(
                assignment_id=assignment.id,
                user_id=user.id,
                project_id=project_id,
                username=user.username,
                email=user.email,
                full_name=user.full_name,
                role=rbac.normalize_role(assignment.role) or models.Role.TESTER,
                is_owner=(user.id == project.owner_id),
                assigned_at=assignment.assigned_at,
                assigned_by=assignment.assigned_by,
            ))
            seen_users.add(user.id)

        if project.owner_id and project.owner_id not in seen_users:
            owner = users_by_id.get(project.owner_id)
            if owner:
                # Owners always have full admin on their project regardless of
                # their global role, so the synthetic row reflects effective
                # access, not the owner's directory-level role.
                members.insert(0, schemas.ProjectMember(
                    assignment_id=None,
                    user_id=owner.id,
                    project_id=project_id,
                    username=owner.username,
                    email=owner.email,
                    full_name=owner.full_name,
                    role=models.Role.ADMIN,
                    is_owner=True,
                    assigned_at=None,
                    assigned_by=None,
                ))
        return members

    @app.get("/my-projects")
    def get_my_projects(
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        return rbac.get_user_projects(current_user, db)

    # Test Schedule and Execution Endpoints
    @app.post("/test-schedules", response_model=schemas.TestSchedule)
    def create_test_schedule(
        schedule: schemas.TestScheduleCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "execute"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        db_schedule = crud_rbac.create_test_schedule(db=db, schedule=schedule)
        
        # Get project_id for audit trail
        project_id = None
        if db_schedule.test_suite_id:
            from .. import crud
            test_suite = crud.get_test_suite(db, test_suite_id=db_schedule.test_suite_id)
            if test_suite:
                project_id = test_suite.project_id
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.CREATE.value,
                entity_type=EntityType.TEST_SCHEDULE.value,
                entity_id=db_schedule.id,
                project_id=project_id,
                description=f"Test schedule created for test suite {db_schedule.test_suite_id}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            logger.warning(f"Failed to create audit trail for test schedule creation: {e}")
        
        return db_schedule

    @app.get("/test-schedules", response_model=List[schemas.TestSchedule])
    def read_test_schedules(
        project_id: int = None,
        test_suite_id: int = None,
        skip: int = 0,
        limit: int = 100,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "read"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        return crud_rbac.get_test_schedules(db, project_id=project_id, test_suite_id=test_suite_id, skip=skip, limit=limit)

    @app.post("/test-executions", response_model=schemas.TestExecution)
    def create_test_execution(
        execution: schemas.TestExecutionCreate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "execute"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        db_execution = crud_rbac.create_test_execution(db=db, execution=execution)
        
        # Get project_id for audit trail
        project_id = None
        if db_execution.test_run_id:
            from .. import crud
            test_run = crud.get_test_run(db, test_run_id=db_execution.test_run_id)
            if test_run:
                project_id = test_run.project_id
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.CREATE.value,
                entity_type=EntityType.TEST_EXECUTION.value,
                entity_id=db_execution.id,
                project_id=project_id,
                description=f"Test execution created for test run {db_execution.test_run_id}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            logger.warning(f"Failed to create audit trail for test execution creation: {e}")
        
        return db_execution

    @app.get("/test-executions", response_model=List[schemas.TestExecution])
    def read_test_executions(
        test_run_id: Optional[int] = None,
        test_case_id: Optional[int] = None,
        skip: int = 0,
        limit: int = 100,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if not rbac.has_permission(current_user, "read"):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        return crud_rbac.get_test_executions(db, test_run_id=test_run_id, test_case_id=test_case_id, skip=skip, limit=limit)

    # Test Execution Settings Endpoints
    @app.get("/test-execution-settings", response_model=schemas.TestExecutionSettings)
    def read_test_execution_settings(
        project_id: int = None,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if project_id is not None and not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        settings = crud.get_test_execution_settings(db, project_id=project_id)
        if settings is None:
            # Create default settings if none exist
            default_settings = schemas.TestExecutionSettingsCreate(
                project_id=project_id,
                created_by=current_user.id
            )
            settings = crud.create_test_execution_settings(db=db, settings=default_settings)
        return settings

    @app.put("/test-execution-settings/{settings_id}", response_model=schemas.TestExecutionSettings)
    def update_test_execution_settings(
        settings_id: int,
        settings: schemas.TestExecutionSettingsUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        existing = db.query(models.TestExecutionSettings).filter(models.TestExecutionSettings.id == settings_id).first()
        if existing is None:
            raise HTTPException(status_code=404, detail="Test execution settings not found")
        if existing.project_id is not None and not rbac.has_permission(current_user, "write", existing.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        db_settings = crud.update_test_execution_settings(db, settings_id=settings_id, settings=settings)
        if db_settings is None:
            raise HTTPException(status_code=404, detail="Test execution settings not found")
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.UPDATE.value,
                entity_type=EntityType.TEST_EXECUTION_SETTINGS.value,
                entity_id=db_settings.id,
                project_id=db_settings.project_id,
                description=f"Test execution settings updated for project {db_settings.project_id}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            logger.warning(f"Failed to create audit trail for test execution settings update: {e}")
        
        return db_settings

    # Automation Settings Endpoints
    @app.get("/automation-settings", response_model=schemas.AutomationSettings)
    def read_automation_settings(
        project_id: int = None,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        if project_id is not None and not rbac.has_permission(current_user, "read", project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        settings = crud.get_automation_settings(db, project_id=project_id)
        if settings is None:
            # Create default settings if none exist
            default_settings = schemas.AutomationSettingsCreate(
                project_id=project_id,
                created_by=current_user.id
            )
            settings = crud.create_automation_settings(db=db, settings=default_settings)
        return settings

    @app.put("/automation-settings/{settings_id}", response_model=schemas.AutomationSettings)
    def update_automation_settings(
        settings_id: int,
        settings: schemas.AutomationSettingsUpdate,
        db: Session = Depends(get_db),
        current_user: schemas.User = Depends(get_current_active_user)
    ):
        existing = db.query(models.AutomationSettings).filter(models.AutomationSettings.id == settings_id).first()
        if existing is None:
            raise HTTPException(status_code=404, detail="Automation settings not found")
        if existing.project_id is not None and not rbac.has_permission(current_user, "write", existing.project_id, db):
            raise HTTPException(status_code=403, detail="Insufficient permissions")

        db_settings = crud.update_automation_settings(db, settings_id=settings_id, settings=settings)
        if db_settings is None:
            raise HTTPException(status_code=404, detail="Automation settings not found")
        
        # Create audit trail
        try:
            from ..services.audit_service import get_audit_service
            from ..schemas_audit import AuditTrailCreate
            from ..models import AuditAction, EntityType
            audit_service = get_audit_service(db)
            audit_data = AuditTrailCreate(
                user_id=current_user.id if current_user else None,
                action=AuditAction.UPDATE.value,
                entity_type=EntityType.AUTOMATION_SETTINGS.value,
                entity_id=db_settings.id,
                project_id=db_settings.project_id,
                description=f"Automation settings updated for project {db_settings.project_id}",
            )
            audit_service.create_audit_trail(audit_data)
        except Exception as e:
            logger.warning(f"Failed to create audit trail for automation settings update: {e}")
        
        return db_settings
