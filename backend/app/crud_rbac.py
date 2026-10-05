from sqlalchemy.orm import Session
from typing import List, Optional
import logging
from .models import ProjectAssignment, TestSchedule, TestExecution, TestRun, User
from .schemas import (
    ProjectAssignmentCreate, ProjectAssignmentUpdate,
    TestScheduleCreate, TestScheduleUpdate,
    TestExecutionCreate, TestExecutionUpdate,
    UserCreate, UserUpdate
)
from .auth import get_password_hash

logger = logging.getLogger(__name__)


def get_project_assignment(db: Session, assignment_id: int):
    return db.query(ProjectAssignment).filter(ProjectAssignment.id == assignment_id).first()


def get_project_assignments(db: Session, project_id: int = None, user_id: int = None, skip: int = 0, limit: int = 100):
    query = db.query(ProjectAssignment)
    if project_id:
        query = query.filter(ProjectAssignment.project_id == project_id)
    if user_id:
        query = query.filter(ProjectAssignment.user_id == user_id)
    return query.offset(skip).limit(limit).all()


def create_project_assignment(db: Session, assignment: ProjectAssignmentCreate):
    db_assignment = ProjectAssignment(**assignment.model_dump())
    try:
        db.add(db_assignment)
        db.commit()
        db.refresh(db_assignment)
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to create project assignment: {e}")
        raise
    return db_assignment


def update_project_assignment(db: Session, assignment_id: int, assignment: ProjectAssignmentUpdate):
    db_assignment = db.query(ProjectAssignment).filter(ProjectAssignment.id == assignment_id).first()
    if db_assignment:
        try:
            for key, value in assignment.model_dump(exclude_unset=True).items():
                setattr(db_assignment, key, value)
            db.commit()
            db.refresh(db_assignment)
        except Exception as e:
            db.rollback()
            logger.error(f"Failed to update project assignment {assignment_id}: {e}")
            raise
    return db_assignment


def delete_project_assignment(db: Session, assignment_id: int):
    db_assignment = db.query(ProjectAssignment).filter(ProjectAssignment.id == assignment_id).first()
    if db_assignment:
        try:
            db.delete(db_assignment)
            db.commit()
        except Exception as e:
            db.rollback()
            logger.error(f"Failed to delete project assignment {assignment_id}: {e}")
            raise
    return db_assignment


def get_test_schedule(db: Session, schedule_id: int):
    return db.query(TestSchedule).filter(TestSchedule.id == schedule_id).first()


def get_test_schedules(
    db: Session,
    project_id: int = None,
    test_suite_id: int = None,
    skip: int = 0,
    limit: int = 100,
    allowed_project_ids: Optional[List[int]] = None,
):
    query = db.query(TestSchedule)
    if project_id:
        query = query.filter(TestSchedule.project_id == project_id)
    if test_suite_id:
        query = query.filter(TestSchedule.test_suite_id == test_suite_id)
    # Caller-supplied filters must never widen access: when the caller passes
    # the set of projects the user may see, an unscoped request is narrowed to it.
    if allowed_project_ids is not None:
        query = query.filter(TestSchedule.project_id.in_(allowed_project_ids))
    return query.offset(skip).limit(limit).all()


def create_test_schedule(db: Session, schedule: TestScheduleCreate):
    db_schedule = TestSchedule(**schedule.model_dump())
    try:
        db.add(db_schedule)
        db.commit()
        db.refresh(db_schedule)
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to create test schedule: {e}")
        raise
    return db_schedule


def update_test_schedule(db: Session, schedule_id: int, schedule: TestScheduleUpdate):
    db_schedule = db.query(TestSchedule).filter(TestSchedule.id == schedule_id).first()
    if db_schedule:
        try:
            for key, value in schedule.model_dump(exclude_unset=True).items():
                setattr(db_schedule, key, value)
            db.commit()
            db.refresh(db_schedule)
        except Exception as e:
            db.rollback()
            logger.error(f"Failed to update test schedule {schedule_id}: {e}")
            raise
    return db_schedule


def delete_test_schedule(db: Session, schedule_id: int):
    db_schedule = db.query(TestSchedule).filter(TestSchedule.id == schedule_id).first()
    if db_schedule:
        try:
            db.delete(db_schedule)
            db.commit()
        except Exception as e:
            db.rollback()
            logger.error(f"Failed to delete test schedule {schedule_id}: {e}")
            raise
    return db_schedule


def get_test_execution(db: Session, execution_id: int):
    return db.query(TestExecution).filter(TestExecution.id == execution_id).first()


def get_test_executions(
    db: Session,
    test_run_id: int = None,
    test_case_id: int = None,
    skip: int = 0,
    limit: int = 100,
    allowed_project_ids: Optional[List[int]] = None,
):
    query = db.query(TestExecution)
    if test_run_id:
        query = query.filter(TestExecution.test_run_id == test_run_id)
    if test_case_id:
        query = query.filter(TestExecution.test_case_id == test_case_id)
    # TestExecution has no project column; its project is the run's, so the
    # access filter has to join through TestRun.
    if allowed_project_ids is not None:
        query = query.join(
            TestRun, TestExecution.test_run_id == TestRun.id
        ).filter(TestRun.project_id.in_(allowed_project_ids))
    return query.offset(skip).limit(limit).all()


def create_test_execution(db: Session, execution: TestExecutionCreate):
    db_execution = TestExecution(**execution.model_dump())
    try:
        db.add(db_execution)
        db.commit()
        db.refresh(db_execution)
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to create test execution: {e}")
        raise
    return db_execution


def update_test_execution(db: Session, execution_id: int, execution: TestExecutionUpdate):
    db_execution = db.query(TestExecution).filter(TestExecution.id == execution_id).first()
    if db_execution:
        try:
            for key, value in execution.model_dump(exclude_unset=True).items():
                setattr(db_execution, key, value)
            db.commit()
            db.refresh(db_execution)
        except Exception as e:
            db.rollback()
            logger.error(f"Failed to update test execution {execution_id}: {e}")
            raise
    return db_execution


def delete_test_execution(db: Session, execution_id: int):
    db_execution = db.query(TestExecution).filter(TestExecution.id == execution_id).first()
    if db_execution:
        try:
            db.delete(db_execution)
            db.commit()
        except Exception as e:
            db.rollback()
            logger.error(f"Failed to delete test execution {execution_id}: {e}")
            raise
    return db_execution


def update_user_role(db: Session, user_id: int, role: str):
    db_user = db.query(User).filter(User.id == user_id).first()
    if db_user:
        try:
            from .rbac import role_value
            db_user.role = role_value(role)
            db.commit()
            db.refresh(db_user)
        except Exception as e:
            db.rollback()
            logger.error(f"Failed to update role for user {user_id}: {e}")
            raise
    return db_user


def get_users_by_role(db: Session, role: str, skip: int = 0, limit: int = 100):
    from .rbac import role_value
    return db.query(User).filter(User.role == role_value(role)).offset(skip).limit(limit).all()

